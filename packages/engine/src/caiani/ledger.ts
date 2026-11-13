/*
 * Petri — Copyright (C) 2026 Nicolas Picotto
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Traducción a TypeScript, MODIFICADA, de código de:
 *   JMAB / modelo Benchmark — Copyright (C) 2013 Alessandro Caiani and Antoine Godin
 *   (GNU GPL v3 o posterior). https://github.com/S120/jmab, https://github.com/S120/benchmark
 * Clases de origen: jmab.agents.AbstractBank.transfer, modellone.agents.CentralBank.transfer,
 *   jmab.agents.SimpleAbstractAgent.cleanSM, jmab.goods.Loan / Bond (remove, update),
 *   modellone.agents.CapitalFirm.computeDebtPayments / payInterests, modellone.agents.Bank.payInterests
 *   (referencia: benchmarkModel.jar del paper; fuente equivalente en reference/jmab-2015).
 * Modificaciones: ver docs/ledger-contratos.md (cada diferencia con el original está documentada
 *   como adaptación).
 */

/**
 * Ledger de contratos del port de Caiani (P1). Diseño en docs/ledger-contratos.md.
 *
 * - Cada contrato tiene un solo saldo, que es activo del tenedor y pasivo del emisor: las filas de la
 *   matriz de balances suman cero por construcción (como los ítems compartidos de JMAB).
 * - Cada agente guarda, por tipo, las listas de ids de sus activos y pasivos en el orden de JMAB
 *   (orden de inserción; la limpieza conserva el orden).
 * - Las operaciones de este archivo son la única forma de modificar saldos. Cada una registra su
 *   categoría de flujo (flows.ts verifica las invariantes de flujos con ese registro).
 * - Las operaciones son atómicas: si una pata dejaría un saldo con signo prohibido, tiran un error
 *   sin haber modificado nada.
 */

import { assertMicro, assertNonNegativeMicro, type Micro } from './money';

export type AgentId = number;
export type ContractId = number;

export const SECTORS = ['household', 'consumptionFirm', 'capitalFirm', 'bank', 'government', 'centralBank'] as const;
export type Sector = (typeof SECTORS)[number];

/** Tipos de contrato, en el orden de los ids de JMAB (StaticValues.SM_*: 0, 1, 4, 5, 6, 7). */
export const CONTRACT_KINDS = ['cash', 'deposit', 'loan', 'bond', 'reserves', 'advance'] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

export const SECTOR_INDEX: Readonly<Record<Sector, number>> = {
  household: 0,
  consumptionFirm: 1,
  capitalFirm: 2,
  bank: 3,
  government: 4,
  centralBank: 5,
};
export const KIND_INDEX: Readonly<Record<ContractKind, number>> = {
  cash: 0,
  deposit: 1,
  loan: 2,
  bond: 3,
  reserves: 4,
  advance: 5,
};

/** Tenedores y emisores permitidos por tipo (escenario base de Caiani; ledger-contratos.md, sec. 1). */
export const ALLOWED: Readonly<Record<ContractKind, { holders: readonly Sector[]; issuers: readonly Sector[] }>> = {
  cash: { holders: ['household', 'consumptionFirm', 'capitalFirm', 'bank'], issuers: ['centralBank'] },
  deposit: { holders: ['household', 'consumptionFirm', 'capitalFirm'], issuers: ['bank'] },
  loan: { holders: ['bank'], issuers: ['consumptionFirm', 'capitalFirm'] },
  bond: { holders: ['bank', 'centralBank'], issuers: ['government'] },
  // La cuenta del gobierno en el BC es un "Deposit" de tipo reservas en JMAB.
  reserves: { holders: ['bank', 'government'], issuers: ['centralBank'] },
  advance: { holders: ['centralBank'], issuers: ['bank'] },
};

/** Tipos que funcionan como medio de pago (`pay`, `payTo`). */
const MONEY_KINDS: readonly ContractKind[] = ['cash', 'deposit', 'reserves'];

export type Amortization = 'fixedCapital' | 'onlyInterest';

export interface Contract {
  id: ContractId;
  kind: ContractKind;
  holder: AgentId;
  issuer: AgentId;
  /** Saldo en µ. ≥ 0 salvo las reservas, que pueden quedar negativas durante el tick (sec. 2.4). */
  amount: Micro;
  /** Edad en ticks. Solo cambia para préstamos, bonos y adelantos (los demás no tienen `update`). */
  age: number;
  rate: number;
  // Préstamos y adelantos.
  length?: number;
  amortization?: Amortization;
  initialAmount?: Micro;
  // Bonos.
  quantity?: number;
  price?: number;
  maturity?: number;
}

export interface ContractTerms {
  rate?: number;
  age?: number;
  length?: number;
  amortization?: Amortization;
  /** Por defecto, el monto con que se abre (como el constructor de Loan). */
  initialAmount?: Micro;
  quantity?: number;
  price?: number;
  maturity?: number;
}

export interface AgentAccounts {
  id: AgentId;
  sector: Sector;
  /** Por índice de tipo (KIND_INDEX): ids en orden de inserción. */
  assets: ContractId[][];
  liabilities: ContractId[][];
}

/**
 * Categorías de flujo: filas de la matriz de transacciones (cuadro 2 del paper). Las corrientes
 * cambian el patrimonio financiero de las partes; las financieras solo cambian la composición del
 * balance (sus filas son las de variación de stocks).
 */
export const FLOW_CATEGORIES = {
  consumption: 'current',
  wages: 'current',
  unemploymentBenefits: 'current',
  investment: 'current',
  taxes: 'current',
  depositInterest: 'current',
  bondInterest: 'current',
  loanInterest: 'current',
  advanceInterest: 'current',
  dividends: 'current',
  centralBankProfits: 'current',
  /** Pérdida del tenedor y ganancia del emisor: quiebras, quitas, préstamos que vencen con saldo. */
  writeOff: 'current',
  loans: 'financial',
  advances: 'financial',
  bonds: 'financial',
  /** Movimientos entre cuentas propias y entre efectivo y depósitos. */
  deposits: 'financial',
} as const;
export type FlowCategory = keyof typeof FLOW_CATEGORIES;

export interface FlowRecord {
  category: FlowCategory;
  /** Quien paga (pierde patrimonio en un flujo corriente). */
  payer: AgentId;
  payee: AgentId;
  amount: Micro;
  /** Contratos cuyo saldo cambió en esta operación. */
  contracts: ContractId[];
}

export interface LedgerStats {
  /** Veces que una operación llevó las reservas de un banco de ≥ 0 a < 0 (decisión de Nico, 2026-11-13). */
  negativeReservesBank: number;
  /** Lo mismo para la cuenta del gobierno en el BC (en JMAB queda negativa por diseño con déficit). */
  negativeReservesGovernment: number;
  /**
   * Préstamos y adelantos que la limpieza cerró con saldo (JMAB los borra sin registrar). En la corrida
   * base no debería pasar: los préstamos iniciales cierran en cero (verificado en P2, inicializacion.md).
   */
  writtenOffAtExpiry: number;
}

export interface Ledger {
  nextContractId: ContractId;
  /** Contratos abiertos por id. Las claves son enteras: el recorrido es en orden creciente. */
  contracts: Record<number, Contract>;
  agents: AgentAccounts[];
  /** Registro de flujos desde el último `beginPeriod` (flows.ts). */
  flowLog: FlowRecord[];
  /**
   * Variación acumulada de saldos desde el último `beginPeriod`, por tipo, sector del tenedor y
   * sector del emisor: índice (kind · 6 + sector tenedor) · 6 + sector emisor.
   */
  movements: Micro[];
  stats: LedgerStats;
}

export const MOVEMENT_CELLS = CONTRACT_KINDS.length * SECTORS.length * SECTORS.length;

export function movementIndex(kind: ContractKind, holder: Sector, issuer: Sector): number {
  return (KIND_INDEX[kind] * SECTORS.length + SECTOR_INDEX[holder]) * SECTORS.length + SECTOR_INDEX[issuer];
}

export function createLedger(): Ledger {
  return {
    nextContractId: 0,
    contracts: {},
    agents: [],
    flowLog: [],
    movements: new Array<number>(MOVEMENT_CELLS).fill(0),
    stats: { negativeReservesBank: 0, negativeReservesGovernment: 0, writtenOffAtExpiry: 0 },
  };
}

export function addAgent(ledger: Ledger, sector: Sector): AgentId {
  const id = ledger.agents.length;
  ledger.agents.push({
    id,
    sector,
    assets: CONTRACT_KINDS.map(() => []),
    liabilities: CONTRACT_KINDS.map(() => []),
  });
  return id;
}

export function agentOf(ledger: Ledger, id: AgentId): AgentAccounts {
  const a = ledger.agents[id];
  if (!a) throw new Error(`ledger: no existe el agente ${id}`);
  return a;
}

export function contractOf(ledger: Ledger, id: ContractId): Contract {
  const c = ledger.contracts[id];
  if (!c) throw new Error(`ledger: no existe el contrato ${id} (¿ya se cerró?)`);
  return c;
}

/** Ids de los activos (`side = 'assets'`) o pasivos de un agente de un tipo, en orden de JMAB. */
export function contractIds(
  ledger: Ledger,
  agent: AgentId,
  side: 'assets' | 'liabilities',
  kind: ContractKind,
): readonly ContractId[] {
  return agentOf(ledger, agent)[side][KIND_INDEX[kind]] as ContractId[];
}

/** Primer contrato de un tipo (como `getItemStockMatrix(true, id)` de JMAB), o undefined. */
export function firstAsset(ledger: Ledger, agent: AgentId, kind: ContractKind): Contract | undefined {
  const id = contractIds(ledger, agent, 'assets', kind)[0];
  return id === undefined ? undefined : contractOf(ledger, id);
}

/** Activos financieros − pasivos financieros (los bienes reales no están en el ledger). */
export function netFinancialWorth(ledger: Ledger, agent: AgentId): Micro {
  const a = agentOf(ledger, agent);
  let nw = 0;
  for (const list of a.assets) for (const id of list) nw += contractOf(ledger, id).amount;
  for (const list of a.liabilities) for (const id of list) nw -= contractOf(ledger, id).amount;
  assertMicro(nw, 'patrimonio financiero');
  return nw;
}

// ---------------------------------------------------------------------------------------------
// Aplicación atómica de patas
// ---------------------------------------------------------------------------------------------

type Leg = [ContractId, Micro];

function mergeLegs(legs: readonly Leg[]): Leg[] {
  const out: Leg[] = [];
  for (const [id, d] of legs) {
    const prev = out.find((l) => l[0] === id);
    if (prev) prev[1] += d;
    else out.push([id, d]);
  }
  return out;
}

/** Valida todas las patas y recién después las aplica; registra el flujo. */
function applyLegs(
  ledger: Ledger,
  legs: readonly Leg[],
  category: FlowCategory,
  payer: AgentId,
  payee: AgentId,
  amount: Micro,
): void {
  const merged = mergeLegs(legs);
  for (const [id, d] of merged) {
    const c = contractOf(ledger, id);
    const after = c.amount + d;
    assertMicro(after, `saldo del contrato ${id}`);
    if (after < 0 && c.kind !== 'reserves') {
      throw new Error(
        `ledger: el ${c.kind} ${id} (tenedor ${c.holder}, emisor ${c.issuer}) quedaría en ${after} µ ` +
          `con "${category}"; solo las reservas pueden quedar negativas (ledger-contratos.md, sec. 2.4)`,
      );
    }
  }
  for (const [id, d] of merged) {
    if (d === 0) continue;
    const c = contractOf(ledger, id);
    const before = c.amount;
    c.amount = before + d;
    if (c.kind === 'reserves' && before >= 0 && c.amount < 0) {
      if (agentOf(ledger, c.holder).sector === 'government') ledger.stats.negativeReservesGovernment += 1;
      else ledger.stats.negativeReservesBank += 1;
    }
    const cell = movementIndex(c.kind, agentOf(ledger, c.holder).sector, agentOf(ledger, c.issuer).sector);
    ledger.movements[cell] = (ledger.movements[cell] as number) + d;
  }
  ledger.flowLog.push({ category, payer, payee, amount, contracts: merged.map((l) => l[0]) });
}

// ---------------------------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------------------------

/**
 * Crea un contrato al final de las listas del tenedor y del emisor (orden de inserción de JMAB).
 * Con `amount` > 0 registra el flujo como un `credit` (el emisor le da al tenedor un derecho).
 */
export function open(
  ledger: Ledger,
  kind: ContractKind,
  holder: AgentId,
  issuer: AgentId,
  amount: Micro,
  terms: ContractTerms,
  category: FlowCategory,
): ContractId {
  assertNonNegativeMicro(amount, `monto de apertura de ${kind}`);
  const h = agentOf(ledger, holder);
  const i = agentOf(ledger, issuer);
  const allowed = ALLOWED[kind];
  if (!allowed.holders.includes(h.sector) || !allowed.issuers.includes(i.sector)) {
    throw new Error(`ledger: un ${kind} no puede tener tenedor ${h.sector} y emisor ${i.sector}`);
  }
  if (kind === 'loan' || kind === 'advance') {
    if (!terms.length || terms.length <= 0 || !terms.amortization) {
      throw new Error(`ledger: un ${kind} necesita length > 0 y amortization`);
    }
  }
  if (kind === 'bond' && (terms.quantity === undefined || terms.price === undefined || terms.maturity === undefined)) {
    throw new Error('ledger: un bono necesita quantity, price y maturity');
  }
  const id = ledger.nextContractId;
  ledger.nextContractId = id + 1;
  const c: Contract = { id, kind, holder, issuer, amount: 0, age: terms.age ?? 0, rate: terms.rate ?? 0 };
  if (kind === 'loan' || kind === 'advance') {
    c.length = terms.length;
    c.amortization = terms.amortization;
    c.initialAmount = terms.initialAmount ?? amount;
    assertNonNegativeMicro(c.initialAmount, 'initialAmount');
  }
  if (kind === 'bond') {
    c.quantity = terms.quantity;
    c.price = terms.price;
    c.maturity = terms.maturity;
  }
  ledger.contracts[id] = c;
  (h.assets[KIND_INDEX[kind]] as ContractId[]).push(id);
  (i.liabilities[KIND_INDEX[kind]] as ContractId[]).push(id);
  if (amount > 0) applyLegs(ledger, [[id, amount]], category, issuer, holder, amount);
  return id;
}

/**
 * Sube el saldo de un contrato: el emisor le paga al tenedor sin movimiento de dinero (interés
 * capitalizado de los depósitos, `Bank.payDepositInterests`) o se amplían los dos balances (crédito
 * acreditado en un depósito, compra de bonos por el BC).
 */
export function credit(ledger: Ledger, contract: ContractId, amount: Micro, category: FlowCategory): void {
  assertNonNegativeMicro(amount, 'monto de credit');
  if (amount === 0) return;
  const c = contractOf(ledger, contract);
  applyLegs(ledger, [[contract, amount]], category, c.issuer, c.holder, amount);
}

/**
 * Baja el saldo de un contrato sin contrapartida en otro: el tenedor le paga al emisor con un pasivo
 * del propio emisor (amortización de un préstamo, interés de un adelanto pagado con reservas), o
 * pierde ese monto (`writeOff`: quiebras, quitas).
 */
export function debit(ledger: Ledger, contract: ContractId, amount: Micro, category: FlowCategory): void {
  assertNonNegativeMicro(amount, 'monto de debit');
  if (amount === 0) return;
  const c = contractOf(ledger, contract);
  applyLegs(ledger, [[contract, -amount]], category, c.holder, c.issuer, amount);
}

/** Quita: pérdida del tenedor, ganancia del emisor. */
export function writeDown(ledger: Ledger, contract: ContractId, amount: Micro): void {
  debit(ledger, contract, amount, 'writeOff');
}

function balancingAccount(ledger: Ledger, bank: AgentId, kind: 'cash' | 'reserves'): ContractId {
  const id = contractIds(ledger, bank, 'assets', kind)[0];
  if (id === undefined) throw new Error(`ledger: el banco ${bank} no tiene cuenta de ${kind} para liquidar`);
  return id;
}

/**
 * Patas de liquidación para pasar valor de un pasivo del agente `from` (emisor de la cuenta que paga)
 * al agente `to` (emisor de la cuenta que cobra, o el cobrador directo en `payTo`).
 * - Mismo agente: nada (se extingue o se crea un pasivo del mismo emisor).
 * - Un banco que entrega: baja su cuenta de liquidación. Un banco que recibe: sube la suya.
 * - El BC no tiene cuenta de liquidación: sus pasivos (reservas, efectivo) ya cambiaron en las patas.
 * La cuenta de liquidación es el efectivo del banco si el pago involucra efectivo
 * (`AbstractBank.getCounterpartItem`), y las reservas en los demás casos (`AbstractBank.transfer`,
 * `CentralBank.transfer`).
 */
function settlementLegs(ledger: Ledger, from: AgentId, to: AgentId, via: 'cash' | 'reserves', amount: Micro): Leg[] {
  if (from === to || amount === 0) return [];
  const legs: Leg[] = [];
  for (const [agent, sign] of [
    [from, -1],
    [to, 1],
  ] as const) {
    const sector = agentOf(ledger, agent).sector;
    if (sector === 'bank') legs.push([balancingAccount(ledger, agent, via), sign * amount]);
    else if (sector !== 'centralBank') {
      throw new Error(`ledger: solo bancos y el BC liquidan pagos; llegó ${sector} (${agent})`);
    }
  }
  return legs;
}

function assertMoney(c: Contract, role: string): void {
  if (!MONEY_KINDS.includes(c.kind)) throw new Error(`ledger: ${role} tiene que ser efectivo, depósito o reservas, es ${c.kind}`);
}

/**
 * Pago de cuenta a cuenta: baja `from`, sube `to` y, si los emisores difieren, liquida entre ellos.
 * Cubre los casos de JMAB:
 * - mismo banco: solo los dos saldos;
 * - bancos distintos: reservas del banco pagador → reservas del banco cobrador (`AbstractBank.transfer`);
 * - desde la cuenta del gobierno en el BC: suben el depósito y las reservas del banco del cobrador
 *   (`CentralBank.transfer`);
 * - hacia la cuenta del gobierno (impuestos): bajan el depósito y las reservas del banco del pagador
 *   (`Households.payTaxes`);
 * - efectivo ↔ depósito: el efectivo del banco cambia en espejo.
 */
export function pay(ledger: Ledger, from: ContractId, to: ContractId, amount: Micro, category: FlowCategory): void {
  assertNonNegativeMicro(amount, 'monto del pago');
  if (amount === 0) return;
  const f = contractOf(ledger, from);
  const t = contractOf(ledger, to);
  assertMoney(f, 'la cuenta que paga');
  assertMoney(t, 'la cuenta que cobra');
  const via = f.kind === 'cash' || t.kind === 'cash' ? 'cash' : 'reserves';
  const legs: Leg[] = [[from, -amount], [to, amount], ...settlementLegs(ledger, f.issuer, t.issuer, via, amount)];
  applyLegs(ledger, legs, category, f.holder, t.holder, amount);
}

/**
 * Pago a un banco o al BC desde una cuenta: baja `from` y el cobrador recibe el valor como
 * reducción de su pasivo (si emitió esa cuenta) o en sus reservas (si no). Es como la empresa paga
 * su préstamo a un banco que puede no ser el de su depósito (`CapitalFirm.payInterests`) y como el
 * banco paga sus adelantos con reservas (`Bank.payInterests`).
 */
export function payTo(ledger: Ledger, from: ContractId, payee: AgentId, amount: Micro, category: FlowCategory): void {
  assertNonNegativeMicro(amount, 'monto del pago');
  if (amount === 0) return;
  const f = contractOf(ledger, from);
  assertMoney(f, 'la cuenta que paga');
  const via = f.kind === 'cash' ? 'cash' : 'reserves';
  const legs: Leg[] = [[from, -amount], ...settlementLegs(ledger, f.issuer, payee, via, amount)];
  applyLegs(ledger, legs, category, f.holder, payee, amount);
}

// ---------------------------------------------------------------------------------------------
// Préstamos y adelantos
// ---------------------------------------------------------------------------------------------

/**
 * Cuota de un préstamo o adelanto en su edad actual (`computeDebtPayments` de JMAB):
 * - nada si la edad es 0 (el préstamo se dio este tick);
 * - interés = tasa × saldo;
 * - capital, amortización `fixedCapital`: en JMAB, initialAmount / length por cuota. Acá la cuota
 *   de la edad a es redondeo(A·a/L) − redondeo(A·(a−1)/L), con A = initialAmount y L = length: cada
 *   cuota difiere de A/L en menos de 1 µ y la suma de las cuotas de las edades 1..L es exactamente A,
 *   así que el préstamo cierra en cero (adaptación aprobada por Nico, 2026-11-13; en JMAB el redondeo
 *   de double deja residuos que `cleanSM` borra sin registrar). Los préstamos iniciales, que arrancan
 *   con edad j + 1, tienen saldo A − redondeo(A·j/L) y cierran en cero (docs/inicializacion.md).
 * - capital, `onlyInterest`: todo el saldo cuando la edad llega a length.
 * El capital nunca supera el saldo.
 */
export function installment(loan: Contract): { interest: Micro; principal: Micro } {
  if (loan.kind !== 'loan' && loan.kind !== 'advance') throw new Error(`installment: ${loan.kind} no es un préstamo`);
  if (loan.age <= 0) return { interest: 0, principal: 0 };
  const L = loan.length as number;
  const A = loan.initialAmount as number;
  const interest = Math.round(loan.rate * loan.amount);
  let principal = 0;
  if (loan.amortization === 'fixedCapital') {
    if (loan.age <= L) principal = Math.round((A * loan.age) / L) - Math.round((A * (loan.age - 1)) / L);
  } else if (loan.age === L) {
    principal = loan.amount;
  }
  return { interest: interest === 0 ? 0 : interest, principal: Math.min(principal, loan.amount) };
}

/**
 * Paga la cuota de un préstamo (o adelanto) desde la cuenta `from`: interés y capital al prestamista
 * (con liquidación si el banco de la cuenta es otro) y baja el saldo del préstamo.
 * El chequeo de liquidez es de la regla que llama (en Caiani, la empresa que no llega quiebra).
 * Si `from` no es una cuenta de reservas y no alcanza, tira error sin modificar nada.
 */
export function serviceLoan(ledger: Ledger, loan: ContractId, from: ContractId): { interest: Micro; principal: Micro } {
  const l = contractOf(ledger, loan);
  const f = contractOf(ledger, from);
  if (f.holder !== l.issuer) throw new Error(`serviceLoan: la cuenta ${from} no es del deudor ${l.issuer}`);
  const due = installment(l);
  if (f.kind !== 'reserves' && f.amount < due.interest + due.principal) {
    throw new Error(`serviceLoan: la cuenta ${from} tiene ${f.amount} µ y la cuota es ${due.interest + due.principal} µ`);
  }
  const isAdvance = l.kind === 'advance';
  payTo(ledger, from, l.holder, due.interest, isAdvance ? 'advanceInterest' : 'loanInterest');
  payTo(ledger, from, l.holder, due.principal, isAdvance ? 'advances' : 'loans');
  debit(ledger, loan, due.principal, isAdvance ? 'advances' : 'loans');
  return due;
}

// ---------------------------------------------------------------------------------------------
// Limpieza de fin de tick
// ---------------------------------------------------------------------------------------------

const AGING: readonly ContractKind[] = ['loan', 'bond', 'advance'];

/**
 * `SimpleAbstractAgent.cleanSM`: recorre los activos del agente por tipo, cada lista de atrás para
 * adelante; suma 1 a la edad de préstamos, bonos y adelantos, y cierra:
 * - préstamos y adelantos con saldo 0 o edad > length (`Loan.remove`);
 * - bonos con maturity < edad (`Bond.remove`).
 * Un préstamo que cierra con saldo se condona antes de cerrarlo con un `writeOff` explícito y se
 * cuenta en `writtenOffAtExpiry`; JMAB lo borra sin registrar el flujo. En la corrida base no debería
 * pasar (los préstamos iniciales cierran en cero; P2). Un bono que cierra con saldo es
 * un error del port (se rescata al vencer).
 */
export function cleanup(ledger: Ledger, agent: AgentId): void {
  const a = agentOf(ledger, agent);
  for (const kind of CONTRACT_KINDS) {
    if (!AGING.includes(kind)) continue;
    const list = a.assets[KIND_INDEX[kind]] as ContractId[];
    for (let k = list.length - 1; k >= 0; k--) {
      const id = list[k] as ContractId;
      const c = contractOf(ledger, id);
      c.age += 1;
      const remove =
        kind === 'bond' ? (c.maturity as number) < c.age : c.amount === 0 || c.age > (c.length as number);
      if (!remove) continue;
      if (c.amount !== 0) {
        if (kind === 'bond') throw new Error(`cleanup: el bono ${id} vence con saldo ${c.amount} µ sin rescatar`);
        ledger.stats.writtenOffAtExpiry += 1;
        writeDown(ledger, id, c.amount);
      }
      list.splice(k, 1);
      const liab = agentOf(ledger, c.issuer).liabilities[KIND_INDEX[kind]] as ContractId[];
      liab.splice(liab.indexOf(id), 1);
      delete ledger.contracts[id];
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Invariante estructural
// ---------------------------------------------------------------------------------------------

/** Chequeo desde cero de la estructura (sec. 2.5). Devuelve la lista de problemas (vacía si está bien). */
export function checkLedger(ledger: Ledger): string[] {
  const errors: string[] = [];
  const seen = new Map<ContractId, number>();
  for (const a of ledger.agents) {
    for (const side of ['assets', 'liabilities'] as const) {
      a[side].forEach((list, k) => {
        for (const id of list) {
          const c = ledger.contracts[id];
          if (!c) {
            errors.push(`agente ${a.id}: ${side} lista el contrato ${id}, que no existe`);
            continue;
          }
          if (KIND_INDEX[c.kind] !== k) errors.push(`contrato ${id} en la lista de tipo equivocada`);
          if ((side === 'assets' ? c.holder : c.issuer) !== a.id) errors.push(`contrato ${id} en la lista de otro agente`);
          seen.set(id, (seen.get(id) ?? 0) + 1);
        }
      });
    }
  }
  for (const key in ledger.contracts) {
    const c = ledger.contracts[key] as Contract;
    if (c.id !== Number(key)) errors.push(`contrato ${key} con id ${c.id}`);
    if (c.id >= ledger.nextContractId) errors.push(`contrato ${c.id} ≥ nextContractId`);
    if (seen.get(c.id) !== 2) errors.push(`contrato ${c.id} aparece ${seen.get(c.id) ?? 0} veces en las listas (deberían ser 2)`);
    if (!Number.isSafeInteger(c.amount)) errors.push(`contrato ${c.id}: saldo no entero ${c.amount}`);
    if (c.amount < 0 && c.kind !== 'reserves') errors.push(`contrato ${c.id} (${c.kind}): saldo negativo ${c.amount}`);
    const h = ledger.agents[c.holder];
    const i = ledger.agents[c.issuer];
    if (!h || !i) {
      errors.push(`contrato ${c.id}: tenedor o emisor inexistente`);
      continue;
    }
    if (!ALLOWED[c.kind].holders.includes(h.sector) || !ALLOWED[c.kind].issuers.includes(i.sector)) {
      errors.push(`contrato ${c.id}: ${c.kind} con tenedor ${h.sector} y emisor ${i.sector}`);
    }
  }
  return errors;
}

export function assertLedger(ledger: Ledger): void {
  const errors = checkLedger(ledger);
  if (errors.length > 0) throw new Error(`ledger inconsistente:\n${errors.slice(0, 20).join('\n')}`);
}
