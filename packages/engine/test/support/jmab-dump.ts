/**
 * Arnés del oráculo (V1, V3): lee los volcados de `oracle.StateDump` (JSON Lines), reconstruye un
 * `CaianiState` desde un volcado y compara un estado del port contra un volcado.
 * Formato del volcado y del oráculo: docs/inicializacion.md (sec. 4) y docs/reglas-caiani.md.
 *
 * Tolerancias (plan-port-caiani.md, sec. 4, V3; regla de los montos en reglas-caiani.md, sec. 1): montos,
 * 2 µ en el evento suelto y 2 µ por evento en el encadenado (`V3_AMOUNT_TOL`, `chainedAmountTol`); double
 * calculados a partir de montos, 1e-6 relativo; double que no dependen de montos, 1e-9 relativo. En el
 * encadenado, además, montos y double de montos pasan con ρ·S (escala de los flujos; `CompareOptions.scale`).
 */
import { readFileSync } from 'node:fs';
import {
  INITIALISER,
  KIND_INDEX,
  LAG,
  LAG_DEPTH,
  RULES,
  STRUCTURE,
  EXPECTATION,
  addAgent,
  beginPeriod,
  checkLedger,
  contractIds,
  contractOf,
  createLedger,
  toMicro,
  MICRO_PER_UNIT,
  type AgentFlags,
  type AgentId,
  type BankState,
  type CaianiState,
  type CapitalGoodStock,
  type ConsumptionGoodStock,
  type Contract,
  type ContractKind,
  type Expectations,
  type FirmState,
  type HouseholdState,
  type Lags,
  type Sector,
} from '../../src/caiani';

export type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface DumpMeta {
  round: number;
  /** JMAB: 0 capital, 1 consumo, 2 bancos, 3 hogares, 4 BC, 5 gobierno. */
  populations: number[][];
  aggregate: J;
  markets: { class: string; buyers: number[]; sellers: number[] }[];
}

export interface Dump {
  meta: DumpMeta;
  agents: Map<number, J>;
}

/**
 * El oráculo escribe los double no finitos como cadenas (`Double.toString`: "NaN", "Infinity",
 * "-Infinity"; StateDump.java). Se pasan a number al leer. Ningún campo de texto de JMAB toma esos valores.
 */
const NON_FINITE: Record<string, number> = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity };
const reviveNonFinite = (_k: string, v: unknown): unknown => (typeof v === 'string' && Object.hasOwn(NON_FINITE, v) ? NON_FINITE[v] : v);

export function readDump(path: string): Dump {
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.length > 0);
  const meta = JSON.parse(lines[0]!, reviveNonFinite).meta as DumpMeta;
  const agents = new Map<number, J>();
  for (const line of lines.slice(1)) {
    const d = JSON.parse(line, reviveNonFinite) as { id: number; agent: J };
    agents.set(d.id, d.agent);
  }
  return { meta, agents };
}

/** SM_* de JMAB → tipo de contrato del ledger. 2 y 3 son bienes reales. */
export const SM_KIND: Record<number, ContractKind> = { 0: 'cash', 1: 'deposit', 4: 'loan', 5: 'bond', 6: 'reserves', 7: 'advance' };
const SM_CONTRACTS = [0, 1, 4, 5, 6, 7];
const AMORT: Record<number, 'fixedCapital' | 'onlyInterest'> = { 0: 'fixedCapital', 2: 'onlyInterest' };

/**
 * Port ↔ JMAB. El port crea los agentes en el orden de creación de JMAB (consumo, capital, bancos,
 * gobierno, hogares, BC), y en cada población los ids de JMAB crecen con la creación.
 */
export function idMaps(meta: DumpMeta): { toJ: (id: AgentId) => number; fromJ: (j: number) => AgentId; jmabIds: number[] } {
  const sorted = (p: number) => meta.populations[p]!.slice().sort((a, b) => a - b);
  const jmabIds = [...sorted(1), ...sorted(0), ...sorted(2), ...sorted(5), ...sorted(3), ...sorted(4)];
  const inv = new Map<number, AgentId>();
  jmabIds.forEach((j, i) => inv.set(j, i));
  return {
    jmabIds,
    toJ: (id) => {
      const j = jmabIds[id];
      if (j === undefined) throw new Error(`sin id de JMAB para el agente ${id} del port`);
      return j;
    },
    fromJ: (j) => {
      const id = inv.get(j);
      if (id === undefined) throw new Error(`el id de JMAB ${j} no está en el volcado`);
      return id;
    },
  };
}

const ref = (x: J | null | undefined): number | null => (x === null || x === undefined ? null : (x['@agent'] as number));
/** Lista de referencias a agentes (`{"@agent": id}`) → ids del port; `null` si JMAB tiene null. */
function agentRefs(x: J[] | null | undefined, fromJ: (j: number) => AgentId): AgentId[] | null {
  return x === null || x === undefined ? null : x.map((e) => fromJ(ref(e)!));
}
const strat = (j: J, key: number): J => j['AbstractAgent.strategy'].strategies[String(key)];

function flagsOf(j: J): AgentFlags {
  return { active: (j['SimpleAbstractAgent.activeAgent'] as boolean[]).slice(), defaulted: j['SimpleAbstractAgent.defaulted'] as boolean };
}

function lagsOf(j: J | null, where: string): Lags {
  const out: Lags = {};
  if (!j) return out;
  for (const [id, pv] of Object.entries(j)) {
    if (pv.nbLags !== LAG_DEPTH) throw new Error(`${where}: rezago ${id} con nbLags ${pv.nbLags}`);
    const obs = pv.passedValues as Record<string, number>;
    const keys = Object.keys(obs);
    if (keys.length === 0) continue;
    const m: Record<number, number> = {};
    for (const k of keys) m[Number(k)] = obs[k]!;
    out[Number(id)] = m;
  }
  return out;
}

function expectationsOf(j: J | null): Expectations {
  const out: Expectations = {};
  if (!j) return out;
  for (const [id, e] of Object.entries(j)) {
    out[Number(id)] = {
      passed: (e.passedValues as number[][]).map((r) => [r[0]!, r[1]!] as [number, number]),
      expectation: e.expectation,
      lambda: e.adaptiveParam,
    };
  }
  return out;
}

function consumptionGoodOf(it: J, fromJ: (j: number) => AgentId): ConsumptionGoodStock {
  return {
    quantity: it['AbstractItem.quantity'],
    value: it['AbstractItem.value'],
    price: it['AbstractGood.price'],
    unitCost: it['AbstractGood.unitCost'],
    age: it['AbstractItem.age'],
    producer: fromJ(ref(it['AbstractGood.producer'])!),
    duration: it['consumptionGoodDuration'],
  };
}

function capitalGoodOf(it: J, fromJ: (j: number) => AgentId): CapitalGoodStock {
  return {
    quantity: it['AbstractItem.quantity'],
    value: it['AbstractItem.value'],
    price: it['AbstractGood.price'],
    unitCost: it['AbstractGood.unitCost'],
    age: it['AbstractItem.age'],
    producer: fromJ(ref(it['AbstractGood.producer'])!),
    productivity: it['productivity'],
    duration: it['capitalDuration'],
    amortization: it['capitalAmortization'],
    capitalLaborRatio: it['capitalLaborRatio'],
    obsolete: it['obsolete'],
  };
}

/**
 * Reconstruye el estado del port desde un volcado (para V3: arrancar el port en cualquier tick).
 * Los contratos se emparejan por "@oid" (el mismo objeto en la lista del tenedor y en la del emisor)
 * y cada lista conserva el orden de JMAB. Los saldos pasan a µ con `toMicro`.
 */
/** Saldo de JMAB (en µ, `double` sin redondear) de cada contrato de un estado reconstruido con `stateFromDump`. */
export const INPUT_VALUES = new WeakMap<CaianiState, Map<number, number>>();

export function stateFromDump(d: Dump): CaianiState {
  const inputValues = new Map<number, number>();
  const s = buildStateFromDump(d, inputValues);
  INPUT_VALUES.set(s, inputValues);
  return s;
}

function buildStateFromDump(d: Dump, inputValues: Map<number, number>): CaianiState {
  const { meta, agents } = d;
  const { toJ, fromJ, jmabIds } = idMaps(meta);
  const agentOf = (id: AgentId): J => {
    const a = agents.get(toJ(id));
    if (!a) throw new Error(`falta el agente ${toJ(id)} en el volcado`);
    return a;
  };
  const P = meta.populations;
  const sectors: [number, Sector][] = [
    [P[1]!.length, 'consumptionFirm'],
    [P[0]!.length, 'capitalFirm'],
    [P[2]!.length, 'bank'],
    [P[5]!.length, 'government'],
    [P[3]!.length, 'household'],
    [P[4]!.length, 'centralBank'],
  ];
  const ledger = createLedger();
  for (const [n, sector] of sectors) for (let i = 0; i < n; i++) addAgent(ledger, sector);
  if (ledger.agents.length !== jmabIds.length) throw new Error('cantidad de agentes inconsistente');

  // Contratos: se crean desde los activos del tenedor y se ubican después en las listas del emisor.
  const byOid = new Map<number, number>();
  let next = 0;
  for (let id = 0; id < ledger.agents.length; id++) {
    const sm = agentOf(id)['SimpleAbstractAgent.stockMatrix'] as J[][][];
    for (const k of SM_CONTRACTS) {
      const kind = SM_KIND[k]!;
      for (const it of sm[0]![k]!) {
        const oid = it['@oid'] as number;
        if (oid === undefined) throw new Error('el volcado no tiene "@oid" (oráculo anterior a P3)');
        if (byOid.has(oid)) throw new Error(`el ítem ${oid} aparece como activo de dos agentes`);
        const holder = fromJ(ref(it['AbstractItem.assetHolder'])!);
        const issuer = fromJ(ref(it['AbstractItem.liabilityHolder'])!);
        if (holder !== id) throw new Error(`ítem ${oid}: está en ${toJ(id)} y su tenedor es ${toJ(holder)}`);
        if (holder === issuer) throw new Error(`ítem ${oid}: ${kind} de ${toJ(id)} consigo mismo (bonos sin vender: falta portar)`);
        const c: Contract = {
          id: next,
          kind,
          holder,
          issuer,
          amount: toMicro(it['AbstractItem.value']),
          age: it['AbstractItem.age'],
          rate: it['interestRate'] ?? 0,
        };
        if (kind === 'loan' || kind === 'advance') {
          c.length = it['length'];
          const am = AMORT[it['amortization'] as number];
          if (!am) throw new Error(`ítem ${oid}: amortización ${it['amortization']} no portada`);
          c.amortization = am;
          c.initialAmount = toMicro(it['initialAmount']);
        }
        if (kind === 'bond') {
          c.quantity = it['AbstractItem.quantity'];
          c.price = it['price'];
          c.maturity = it['maturity'];
        }
        ledger.contracts[next] = c;
        inputValues.set(next, (it['AbstractItem.value'] as number) * MICRO_PER_UNIT);
        (ledger.agents[id]!.assets[KIND_INDEX[kind]] as number[]).push(next);
        byOid.set(oid, next);
        next++;
      }
    }
  }
  ledger.nextContractId = next;
  for (let id = 0; id < ledger.agents.length; id++) {
    const sm = agentOf(id)['SimpleAbstractAgent.stockMatrix'] as J[][][];
    for (const k of SM_CONTRACTS) {
      const kind = SM_KIND[k]!;
      for (const it of sm[1]![k]!) {
        const cid = byOid.get(it['@oid'] as number);
        if (cid === undefined) throw new Error(`el pasivo ${it['@oid']} de ${toJ(id)} no es activo de nadie`);
        if (ledger.contracts[cid]!.issuer !== id) throw new Error(`el pasivo ${it['@oid']} de ${toJ(id)} tiene otro emisor`);
        (ledger.agents[id]!.liabilities[KIND_INDEX[kind]] as number[]).push(cid);
      }
    }
  }
  // Contratos que el tenedor tiene y el emisor no lista: el segundo depósito de una empresa que quebró
  // (`FirmBankruptcyFireSales` lo saca solo de la lista del banco; reglas-caiani.md, sec. 19).
  const listed = new Set<number>();
  for (const a of ledger.agents) for (const list of a.liabilities) for (const cid of list) listed.add(cid);
  for (let cid = 0; cid < next; cid++) {
    if (listed.has(cid)) continue;
    const c = ledger.contracts[cid]!;
    if (c.kind !== 'deposit') throw new Error(`el ${c.kind} ${cid} de ${toJ(c.holder)} no está en la lista de su emisor ${toJ(c.issuer)}`);
    c.delisted = true;
  }
  const problems = checkLedger(ledger);
  if (problems.length > 0) throw new Error(`ledger reconstruido inválido: ${problems.slice(0, 5).join('; ')}`);

  const ids = (p: number) => meta.populations[p]!.map(fromJ);
  const firstOf = (sector: Sector) => ledger.agents.findIndex((a) => a.sector === sector);
  const range = (sector: Sector) => ledger.agents.filter((a) => a.sector === sector).map((a) => a.id);
  const goods = (id: AgentId, k: 2 | 3): J[] => (agentOf(id)['SimpleAbstractAgent.stockMatrix'] as J[][][])[0]![k]!;

  const households: HouseholdState[] = range('household').map((id) => {
    const j = agentOf(id);
    if (goods(id, 3).length > 0) throw new Error(`hogar ${toJ(id)} con bienes de capital: falta portar`);
    const emp = ref(j['AbstractHousehold.employer']);
    return {
      ...flagsOf(j),
      id,
      wage: j['AbstractHousehold.wage'],
      employer: emp === null ? null : fromJ(emp),
      dividendsReceived: toMicro(j['Households.dividendsReceived']),
      interestReceived: toMicro(j['Households.interestsReceived']),
      demand: j['Households.demand'],
      consumptionGoods: goods(id, 2).map((it) => consumptionGoodOf(it, fromJ)),
      previousSeller: fromJ(ref(strat(j, 0)['previousGoodSupplier'])!),
      previousBank: fromJ(ref(strat(j, 11)['previousDepositSupplier'])!),
      lags: lagsOf(j['SimpleAbstractAgent.passedValues'], `hogar ${toJ(id)}`),
      expectations: expectationsOf(j['SimpleAbstractAgent.expectations']),
    };
  });
  const firm = (id: AgentId, consumption: boolean): FirmState => {
    const j = agentOf(id);
    const lender = ref(strat(j, 1)['previousLender']);
    const capSup = consumption ? ref(strat(j, 0)['previousSupplier']) : null;
    return {
      ...flagsOf(j),
      id,
      desiredOutput: j['AbstractFirm.desiredOutput'],
      bailoutCost: toMicro(j['AbstractFirm.bailoutCost']),
      markUp: strat(j, 5)['markUp'],
      expectedVariableCosts: j[consumption ? 'ConsumptionFirm.expectedVariableCosts' : 'CapitalFirm.expectedVariableCosts'],
      employees: (j['AbstractFirm.employees'] as J[]).map((e) => fromJ(ref(e)!)),
      consumptionGoods: goods(id, 2).map((it) => consumptionGoodOf(it, fromJ)),
      capitalGoods: goods(id, 3).map((it) => capitalGoodOf(it, fromJ)),
      previousBank: fromJ(ref(strat(j, 11)['previousDepositSupplier'])!),
      previousLender: lender === null ? null : fromJ(lender),
      previousCapitalSupplier: capSup === null ? null : fromJ(capSup),
      amountResearch: consumption ? 0 : j['CapitalFirm.amountResearch'],
      capitalProductivity: consumption ? 0 : j['CapitalFirm.capitalProductivity'],
      desiredCapacityGrowth: consumption ? j['ConsumptionFirm.desiredCapacityGrowth'] : 0,
      desiredRealCapitalDemand: consumption ? j['ConsumptionFirm.desiredRealCapitalDemand'] : 0,
      interestReceived: toMicro(j[consumption ? 'ConsumptionFirm.interestReceived' : 'CapitalFirm.interestReceived']),
      debtBurden: toMicro(j[consumption ? 'ConsumptionFirm.debtBurden' : 'CapitalFirm.debtBurden']),
      debtInterests: toMicro(j[consumption ? 'ConsumptionFirm.debtInterests' : 'CapitalFirm.debtInterests']),
      creditDemanded: toMicro(j[consumption ? 'ConsumptionFirm.creditDemanded' : 'CapitalFirm.creditDemanded']),
      laborDemand: j['AbstractFirm.laborDemand'],
      selectedCapitalSuppliers: agentRefs(j['ConsumptionFirm.selectedCapitalGoodSuppliers'], fromJ),
      lags: lagsOf(j['SimpleAbstractAgent.passedValues'], `empresa ${toJ(id)}`),
      expectations: expectationsOf(j['SimpleAbstractAgent.expectations']),
    };
  };
  const banks: BankState[] = range('bank').map((id) => {
    const j = agentOf(id);
    return {
      ...flagsOf(j),
      id,
      lags: lagsOf(j['SimpleAbstractAgent.passedValues'], `banco ${toJ(id)}`),
      expectations: expectationsOf(j['SimpleAbstractAgent.expectations']),
      liquidityRatio: j['liquidityRatio'],
      capitalRatio: j['capitalRatio'],
      bailoutCost: toMicro(j['bailoutCost']),
      currentNonPerformingLoans: toMicro(j['AbstractBank.currentNonPerformingLoans']),
      bankInterestRate: j['bankInterestRate'],
      totalLoanSupply: j['totalLoanSupply'],
      depositInterestRate: j['depositInterestRate'],
      totInterestsDeposits: toMicro(j['totInterestsDeposits']),
      bondInterestRate: j['bondInterestRate'],
    };
  });
  const gov = firstOf('government');
  const jg = agentOf(gov);
  const cb = firstOf('centralBank');
  const jc = agentOf(cb);
  const simple = [1, 2, 3, 4, 6, 7].map((i) => meta.markets[i]!);
  const lists = (m: { buyers: number[]; sellers: number[] }) => ({ buyers: m.buyers.map(fromJ), sellers: m.sellers.map(fromJ) });
  const ledgerState = ledger;
  beginPeriod(ledgerState);
  return {
    init: INITIALISER,
    structure: STRUCTURE,
    rules: RULES,
    round: meta.round,
    ledger: ledgerState,
    populations: {
      capitalFirms: ids(0),
      consumptionFirms: ids(1),
      banks: ids(2),
      households: ids(3),
      centralBank: cb,
      government: gov,
    },
    markets: {
      consumption: lists(simple[0]!),
      credit: lists(simple[1]!),
      labor: lists(simple[2]!),
      deposit: lists(simple[3]!),
      reservesBonds: lists(simple[4]!),
      reservesBasel: lists(simple[5]!),
    },
    households,
    consumptionFirms: range('consumptionFirm').map((id) => firm(id, true)),
    capitalFirms: range('capitalFirm').map((id) => firm(id, false)),
    banks,
    government: {
      ...flagsOf(jg),
      id: gov,
      employees: (jg['Government.employees'] as J[]).map((e) => fromJ(ref(e)!)),
      laborDemand: jg['Government.laborDemand'],
      wageBill: toMicro(jg['Government.wageBill']),
      doleExpenditure: toMicro(jg['doleExpenditure']),
    },
    centralBank: {
      ...flagsOf(jc),
      id: cb,
      interestsOnAdvances: toMicro(jc['interestsOnAdvances']),
      interestsOnBonds: toMicro(jc['interestsOnBonds']),
    },
    aggregateLags: lagsOf(meta.aggregate, 'agregados'),
  };
}

export interface CompareResult {
  diffs: string[];
  /** Diferencias por encima de la tolerancia (las primeras 40 en `diffs`). */
  total: number;
  counts: {
    contracts: number;
    goods: number;
    lags: number;
    expectations: number;
    maxAmountDiff: number;
    maxRelPure: number;
    maxRelFromAmounts: number;
  };
  /**
   * Montos, por tipo de campo (la etiqueta sin ids ni índices): diferencia máxima en µ, cuántos se
   * compararon y cuántos superan la tolerancia. Es lo que se informa en cada corrida de V3.
   */
  amountFields: Record<string, { max: number; n: number; over: number }>;
  /**
   * `double` que superan su tolerancia, por tipo de campo: diferencia relativa máxima y cuántos. Sirve para
   * informar los campos reportados (`REPORTED_FIELDS` del test) sin que tapen otras diferencias.
   */
  doubleFieldsOver: Record<string, { max: number; over: number }>;
  /**
   * Solo con `scale` (encadenado): por tipo de campo, el peor cociente diferencia / S y cuántos valores pasan
   * **solo** por ρ·S (superan la tolerancia base: 2k µ o 10⁻⁶ relativo), y el ρ·S más grande (lo que afloja la
   * regla: en µ para los montos, en unidades del campo para los `double`).
   */
  scaled: Record<string, { maxErrOverS: number; byScale: number; maxRhoS: number }>;
}

/**
 * Regla de tolerancia de los montos en V3 (reglas-caiani.md, sec. 1, "Tolerancias"; propuesta del
 * 2026-11-13). Una sola regla para todos los montos, sin casos por campo:
 * - evento suelto (arranca del volcado de JMAB): 2 µ, la verificación estricta;
 * - encadenado: 2 µ por evento corrido desde el volcado (deriva acotada, lineal en la cadena).
 */
export const V3_AMOUNT_TOL = 2; // µ
export const chainedAmountTol = (eventsRun: number): number => V3_AMOUNT_TOL * eventsRun;
/** ρ de la regla del encadenado por escala de los flujos (la tolerancia relativa de los `double` de montos). */
export const V3_CHAIN_RHO = 1e-6;

export interface CompareOptions {
  /** Tolerancia de los montos, en µ (por defecto, la del evento suelto). */
  amountTol?: number;
  /**
   * Encadenado: escala de los flujos de cada valor (reglas-caiani.md, sec. 1, "Regla del encadenado por escala
   * de los flujos"). Con esto, un monto pasa si su diferencia es ≤ max(`amountTol`, ρ·S) y un `double` de
   * montos si es ≤ max(10⁻⁶ relativo, ρ·S). Los `double` puros no cambian. Sin `scale`, la regla de siempre.
   */
  scale?: ScaleSource;
  /**
   * Evento suelto: error de entrada de cada contrato (µ; port − JMAB: el redondeo de su saldo inicial y el que le
   * llegó por traspasos de saldos enteros). Con esta opción, los montos se comparan contra el valor de JMAB en
   * `double` (sin pasarlo a µ) y a la diferencia de un contrato se le descuenta su error de entrada (decisiones de
   * Nico, 2026-11-13; ver `InputCarry`, test/support/input-carry.ts).
   */
  carry?: (contract: number) => number;
}

/** Escalas S(v) del encadenado (las da `ChainScales`, test/support/chain-scale.ts). */
export interface ScaleSource {
  rho: number;
  /** S de un contrato del ledger (en µ): |saldo al empezar la cadena| + Σ |monto| de los flujos que lo tocaron. */
  contract(id: number): number;
  /** S de cualquier otro valor (montos en µ, `double` en sus unidades), por etiqueta, dado su valor actual. */
  value(label: string, port: number): number;
}

/**
 * Rezagos que se calculan a partir de montos (tolerancia relativa 10⁻⁶): patrimonio, ingreso neto del hogar
 * (salario + intereses + dividendos − impuestos, evento 17) y consumo real deseado (sale del ingreso y del
 * patrimonio, evento 17).
 */
const LAGS_FROM_AMOUNTS: readonly number[] = [LAG.NETWEALTH, LAG.INCOME, LAG.CONSUMPTION];

const PURE_TOL = 1e-9;
const AMOUNTS_TOL = 1e-6;

/** Tipo de campo de una etiqueta: sin ids de agentes ni índices de listas. */
const fieldKind = (what: string): string => what.replace(/\d+/g, '#');

/**
 * Compara el estado del port con un volcado de JMAB, campo por campo (lo que el port modela hasta
 * ahora). Devuelve las diferencias por encima de la tolerancia y estadísticas de precisión.
 */
export function compareState(s: CaianiState, d: Dump, opts: CompareOptions = {}): CompareResult {
  const amountTol = opts.amountTol ?? V3_AMOUNT_TOL;
  const { meta, agents } = d;
  const { toJ } = idMaps(meta);
  const diffs: string[] = [];
  let total = 0;
  const counts = { contracts: 0, goods: 0, lags: 0, expectations: 0, maxAmountDiff: 0, maxRelPure: 0, maxRelFromAmounts: 0 };
  const amountFields: CompareResult['amountFields'] = {};
  const doubleFieldsOver: CompareResult['doubleFieldsOver'] = {};
  const note = (msg: string) => {
    total++;
    if (diffs.length < 40) diffs.push(msg);
  };
  const rel = (a: number, b: number) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));
  const scale = opts.scale;
  const scaled: CompareResult['scaled'] = {};
  /** ¿Pasa por ρ·S? Anota el peor diferencia / S y si hizo falta la escala. */
  const byScale = (what: string, diff: number, S: number, baseOk: boolean): boolean => {
    if (!scale) return false;
    const st = (scaled[fieldKind(what)] ??= { maxErrOverS: 0, byScale: 0, maxRhoS: 0 });
    st.maxRhoS = Math.max(st.maxRhoS, scale.rho * S);
    if (diff > 0) st.maxErrOverS = Math.max(st.maxErrOverS, S > 0 ? diff / S : Infinity);
    const ok = diff <= scale.rho * S;
    if (ok && !baseOk) st.byScale++;
    return ok;
  };
  const close = (what: string, port: number, java: number, fromAmounts = false) => {
    const r = Number.isNaN(port) && Number.isNaN(java) ? 0 : rel(port, java);
    const tol = fromAmounts ? AMOUNTS_TOL : PURE_TOL;
    if (fromAmounts) counts.maxRelFromAmounts = Math.max(counts.maxRelFromAmounts, r);
    else counts.maxRelPure = Math.max(counts.maxRelPure, r);
    const baseOk = r <= tol;
    const scaleOk = fromAmounts && scale !== undefined && Number.isFinite(port) && Number.isFinite(java) && byScale(what, Math.abs(port - java), scale.value(what, port), baseOk);
    if (!baseOk && !scaleOk) {
      const st = (doubleFieldsOver[fieldKind(what)] ??= { max: 0, over: 0 });
      st.over++;
      st.max = Math.max(st.max, r);
      note(`${what}: port ${port}, JMAB ${java} (rel ${r})`);
    }
  };
  /** Montos: la misma tolerancia para todos (`amountTol`, arriba). */
  const amount = (what: string, port: number, java: number, contract?: number) => {
    const carried = contract !== undefined && opts.carry ? opts.carry(contract) : 0;
    const dd = Math.abs(port - carried - (opts.carry ? java * MICRO_PER_UNIT : toMicro(java)));
    counts.maxAmountDiff = Math.max(counts.maxAmountDiff, dd);
    const k = fieldKind(what);
    const st = (amountFields[k] ??= { max: 0, n: 0, over: 0 });
    st.n++;
    st.max = Math.max(st.max, dd);
    const baseOk = dd <= amountTol;
    const S = scale ? (contract !== undefined ? scale.contract(contract) : scale.value(what, port)) : 0;
    if (!byScale(what, dd, S, baseOk) && !baseOk) {
      st.over++;
      const sTxt = scale ? `, ρ·S ${scale.rho * S} µ` : '';
      note(`${what}: port ${port} µ, JMAB ${java} (diferencia ${dd} µ, tolerancia ${amountTol} µ${sTxt})`);
    }
  };
  const same = (what: string, port: unknown, java: unknown) => {
    if (port !== java) note(`${what}: port ${String(port)}, JMAB ${String(java)}`);
  };
  const agentJ = (id: AgentId): J => {
    const a = agents.get(toJ(id));
    if (!a) throw new Error(`falta el agente ${toJ(id)} en el volcado`);
    return a;
  };
  const flags = (w: string, f: AgentFlags, j: J) => {
    same(`${w} activo`, f.active.join(), (j['SimpleAbstractAgent.activeAgent'] as boolean[]).join());
    same(`${w} defaulted`, f.defaulted, j['SimpleAbstractAgent.defaulted']);
  };

  // Ronda, órdenes de las poblaciones y de los mercados, agregados.
  same('ronda', s.round, meta.round);
  const P = s.populations;
  same('población capital', P.capitalFirms.map(toJ).join(), meta.populations[0]!.join());
  same('población consumo', P.consumptionFirms.map(toJ).join(), meta.populations[1]!.join());
  same('población bancos', P.banks.map(toJ).join(), meta.populations[2]!.join());
  same('población hogares', P.households.map(toJ).join(), meta.populations[3]!.join());
  const marketLists = [
    { buyers: P.consumptionFirms, sellers: P.capitalFirms },
    s.markets.consumption,
    s.markets.credit,
    s.markets.labor,
    s.markets.deposit,
    { buyers: P.banks, sellers: [P.government] },
    s.markets.reservesBonds,
    s.markets.reservesBasel,
  ];
  if (meta.markets.length !== marketLists.length) note(`mercados: port ${marketLists.length}, JMAB ${meta.markets.length}`);
  marketLists.forEach((m, i) => {
    same(`mercado ${i} compradores`, m.buyers.map(toJ).join(), meta.markets[i]!.buyers.join());
    same(`mercado ${i} vendedores`, m.sellers.map(toJ).join(), meta.markets[i]!.sellers.join());
  });
  const lagsCompare = (w: string, port: Lags, jl: J | null) => {
    const jlags = jl ?? {};
    for (const [lid, pv] of Object.entries(jlags)) {
      for (const [period, v] of Object.entries(pv.passedValues as Record<string, number>)) {
        counts.lags++;
        const p = port[Number(lid)]?.[Number(period)];
        if (p === undefined) {
          note(`${w} rezago ${lid}[${period}]: falta en el port (JMAB ${v})`);
          continue;
        }
        close(`${w} rezago ${lid}[${period}]`, p, v, LAGS_FROM_AMOUNTS.includes(Number(lid)));
      }
    }
    for (const [lid, m] of Object.entries(port)) {
      for (const period of Object.keys(m)) {
        if (jlags[lid]?.passedValues?.[period] === undefined) note(`${w} rezago ${lid}[${period}]: sobra en el port`);
      }
    }
  };
  lagsCompare('agregados', s.aggregateLags, meta.aggregate);

  const firmOf = new Map<AgentId, FirmState>();
  for (const f of [...s.consumptionFirms, ...s.capitalFirms]) firmOf.set(f.id, f);
  const householdOf = new Map<AgentId, HouseholdState>();
  for (const h of s.households) householdOf.set(h.id, h);

  // Contratos y bienes reales, agente por agente.
  for (let id = 0; id < s.ledger.agents.length; id++) {
    const j = agentJ(id);
    const sm = j['SimpleAbstractAgent.stockMatrix'] as J[][][];
    for (const [side, sideName] of [
      [0, 'assets'],
      [1, 'liabilities'],
    ] as const) {
      for (const k of SM_CONTRACTS) {
        const kind = SM_KIND[k]!;
        const items = sm[side]![k]!;
        const cids = contractIds(s.ledger, id, sideName, kind);
        if (cids.length !== items.length) {
          note(`${toJ(id)} ${sideName} ${kind}: port ${cids.length} contratos, JMAB ${items.length}`);
          continue;
        }
        cids.forEach((cid, n) => {
          const c = contractOf(s.ledger, cid);
          const it = items[n]!;
          const w = `${toJ(id)} ${sideName} ${kind}[${n}]`;
          counts.contracts++;
          same(`${w} tenedor`, toJ(c.holder), ref(it['AbstractItem.assetHolder']));
          same(`${w} emisor`, toJ(c.issuer), ref(it['AbstractItem.liabilityHolder']));
          amount(`${w} saldo`, c.amount, it['AbstractItem.value'], c.id);
          same(`${w} edad`, c.age, it['AbstractItem.age']);
          if ('interestRate' in it) same(`${w} tasa`, c.rate, it['interestRate']);
          if (kind === 'loan' || kind === 'advance') {
            same(`${w} plazo`, c.length, it['length']);
            same(`${w} amortización`, c.amortization, AMORT[it['amortization'] as number]);
            amount(`${w} initialAmount`, c.initialAmount as number, it['initialAmount']);
          }
          if (kind === 'bond') {
            same(`${w} cantidad`, c.quantity, it['AbstractItem.quantity']);
            same(`${w} precio`, c.price, it['price']);
            same(`${w} vencimiento`, c.maturity, it['maturity']);
          }
        });
      }
    }
    const f = firmOf.get(id) ?? householdOf.get(id);
    const jc = sm[0]![2]!;
    const jk = sm[0]![3]!;
    if (!f) {
      if (jc.length + jk.length > 0) note(`${toJ(id)} tiene bienes en JMAB y no es empresa ni hogar en el port`);
      continue;
    }
    const isHousehold = householdOf.has(id);
    same(`${toJ(id)} cantidad de bienes de consumo`, f.consumptionGoods.length, jc.length);
    same(`${toJ(id)} cantidad de bienes de capital`, isHousehold ? 0 : (f as FirmState).capitalGoods.length, jk.length);
    f.consumptionGoods.forEach((g, n) => {
      const it = jc[n];
      if (!it) return;
      const w = `${toJ(id)} bien de consumo [${n}]`;
      counts.goods++;
      // Lo vendido sale de la demanda de los hogares, que sale de montos (eventos 17 y 18); lo comprado por
      // un hogar vale lo que pagó.
      close(`${w} cantidad`, g.quantity, it['AbstractItem.quantity'], true);
      close(`${w} valor`, g.value, it['AbstractItem.value'], isHousehold);
      close(`${w} precio`, g.price, it['AbstractGood.price']);
      close(`${w} costo unitario`, g.unitCost, it['AbstractGood.unitCost']);
      same(`${w} edad`, g.age, it['AbstractItem.age']);
      same(`${w} productor`, toJ(g.producer), ref(it['AbstractGood.producer']));
      same(`${w} duración`, g.duration, it['consumptionGoodDuration']);
    });
    if (isHousehold) continue;
    (f as FirmState).capitalGoods.forEach((g, n) => {
      const it = jk[n];
      if (!it) return;
      const w = `${toJ(id)} bien de capital [${n}]`;
      counts.goods++;
      close(`${w} cantidad`, g.quantity, it['AbstractItem.quantity']);
      close(`${w} valor`, g.value, it['AbstractItem.value']);
      close(`${w} precio`, g.price, it['AbstractGood.price']);
      close(`${w} costo unitario`, g.unitCost, it['AbstractGood.unitCost']);
      same(`${w} edad`, g.age, it['AbstractItem.age']);
      same(`${w} productor`, toJ(g.producer), ref(it['AbstractGood.producer']));
      same(`${w} productividad`, g.productivity, it['productivity']);
      same(`${w} duración`, g.duration, it['capitalDuration']);
      same(`${w} amortización`, g.amortization, it['capitalAmortization']);
      same(`${w} capital/trabajo`, g.capitalLaborRatio, it['capitalLaborRatio']);
      same(`${w} obsoleto`, g.obsolete, it['obsolete']);
    });
  }

  const expCompare = (w: string, port: Expectations, je: J | null) => {
    const jex = je ?? {};
    same(`${w} expectativas`, Object.keys(port).sort().join(), Object.keys(jex).sort().join());
    for (const [eid, e] of Object.entries(jex)) {
      const pe = port[Number(eid)];
      if (!pe) continue;
      counts.expectations++;
      const fromAmounts = Number(eid) === EXPECTATION.DEPOSITS;
      same(`${w} expectativa ${eid} filas`, pe.passed.length, e.passedValues.length);
      (e.passedValues as number[][]).forEach((row, r) => {
        const pr = pe.passed[r];
        if (!pr) return;
        close(`${w} expectativa ${eid}[${r}][0]`, pr[0], row[0]!, fromAmounts);
        close(`${w} expectativa ${eid}[${r}][1]`, pr[1], row[1]!, fromAmounts);
      });
      close(`${w} expectativa ${eid}`, pe.expectation, e.expectation, fromAmounts);
      same(`${w} λ ${eid}`, pe.lambda, e.adaptiveParam);
    }
  };

  for (const h of s.households) {
    const j = agentJ(h.id);
    const w = `hogar ${toJ(h.id)}`;
    flags(w, h, j);
    same(`${w} empleador`, h.employer === null ? null : toJ(h.employer), ref(j['AbstractHousehold.employer']));
    close(`${w} salario`, h.wage, j['AbstractHousehold.wage']);
    amount(`${w} dividendos`, h.dividendsReceived, j['Households.dividendsReceived']);
    amount(`${w} intereses de depósitos`, h.interestReceived, j['Households.interestsReceived']);
    close(`${w} demanda de consumo`, h.demand, j['Households.demand'], true);
    same(`${w} vendedor previo`, toJ(h.previousSeller), ref(strat(j, 0)['previousGoodSupplier']));
    same(`${w} banco previo`, toJ(h.previousBank), ref(strat(j, 11)['previousDepositSupplier']));
    lagsCompare(w, h.lags, j['SimpleAbstractAgent.passedValues']);
    expCompare(w, h.expectations, j['SimpleAbstractAgent.expectations']);
  }
  for (const f of [...s.consumptionFirms, ...s.capitalFirms]) {
    const j = agentJ(f.id);
    const w = `empresa ${toJ(f.id)}`;
    flags(w, f, j);
    same(`${w} empleados`, f.employees.map(toJ).join(), (j['AbstractFirm.employees'] as J[]).map(ref).join());
    close(`${w} producción deseada`, f.desiredOutput, j['AbstractFirm.desiredOutput']);
    amount(`${w} costo de rescate`, f.bailoutCost, j['AbstractFirm.bailoutCost']);
    close(`${w} margen`, f.markUp, strat(j, 5)['markUp']);
    const evc = j['ConsumptionFirm.expectedVariableCosts'] ?? j['CapitalFirm.expectedVariableCosts'];
    close(`${w} costo variable esperado`, f.expectedVariableCosts, evc);
    same(`${w} banco previo`, toJ(f.previousBank), ref(strat(j, 11)['previousDepositSupplier']));
    same(`${w} prestamista previo`, f.previousLender === null ? null : toJ(f.previousLender), ref(strat(j, 1)['previousLender']));
    if (j['ConsumptionFirm.desiredCapacityGrowth'] !== undefined) {
      close(`${w} crecimiento deseado de la capacidad`, f.desiredCapacityGrowth, j['ConsumptionFirm.desiredCapacityGrowth'], true);
      close(`${w} demanda real de capital`, f.desiredRealCapitalDemand, j['ConsumptionFirm.desiredRealCapitalDemand'], true);
    }
    if (j['CapitalFirm.amountResearch'] !== undefined) close(`${w} I+D`, f.amountResearch, j['CapitalFirm.amountResearch']);
    if (j['CapitalFirm.capitalProductivity'] !== undefined) {
      close(`${w} productividad del capital`, f.capitalProductivity, j['CapitalFirm.capitalProductivity']);
    }
    amount(`${w} intereses de depósitos`, f.interestReceived, j['ConsumptionFirm.interestReceived'] ?? j['CapitalFirm.interestReceived']);
    const jf = (k: string) => j[`ConsumptionFirm.${k}`] ?? j[`CapitalFirm.${k}`];
    amount(`${w} servicio de la deuda`, f.debtBurden, jf('debtBurden'));
    amount(`${w} intereses de la deuda`, f.debtInterests, jf('debtInterests'));
    amount(`${w} crédito pedido`, f.creditDemanded, jf('creditDemanded'));
    same(`${w} demanda de trabajo`, f.laborDemand, j['AbstractFirm.laborDemand']);
    const sel = (l: AgentId[] | null) => (l === null ? 'null' : l.map(toJ).join());
    const jsel = j['ConsumptionFirm.selectedCapitalGoodSuppliers'] as J[] | null | undefined;
    same(`${w} vendedores de capital vistos`, sel(f.selectedCapitalSuppliers), jsel === null || jsel === undefined ? 'null' : jsel.map(ref).join());
    if (f.previousCapitalSupplier !== null) {
      same(`${w} proveedor de capital previo`, toJ(f.previousCapitalSupplier), ref(strat(j, 0)['previousSupplier']));
    }
    lagsCompare(w, f.lags, j['SimpleAbstractAgent.passedValues']);
    expCompare(w, f.expectations, j['SimpleAbstractAgent.expectations']);
  }
  for (const b of s.banks) {
    const j = agentJ(b.id);
    const w = `banco ${toJ(b.id)}`;
    flags(w, b, j);
    close(`${w} ratio de liquidez`, b.liquidityRatio, j['liquidityRatio'], true);
    close(`${w} ratio de capital`, b.capitalRatio, j['capitalRatio'], true);
    amount(`${w} costo de rescate`, b.bailoutCost, j['bailoutCost']);
    amount(`${w} morosidad del tick`, b.currentNonPerformingLoans, j['AbstractBank.currentNonPerformingLoans']);
    close(`${w} tasa de préstamos`, b.bankInterestRate, j['bankInterestRate']);
    close(`${w} oferta de crédito`, b.totalLoanSupply, j['totalLoanSupply'], true);
    close(`${w} tasa de depósitos`, b.depositInterestRate, j['depositInterestRate']);
    amount(`${w} intereses pagados a depósitos`, b.totInterestsDeposits, j['totInterestsDeposits']);
    close(`${w} tasa de bonos`, b.bondInterestRate, j['bondInterestRate']);
    lagsCompare(w, b.lags, j['SimpleAbstractAgent.passedValues']);
    expCompare(w, b.expectations, j['SimpleAbstractAgent.expectations']);
  }
  const jg = agentJ(s.government.id);
  flags('gobierno', s.government, jg);
  same('empleados públicos', s.government.employees.map(toJ).join(), (jg['Government.employees'] as J[]).map(ref).join());
  same('demanda de trabajo del gobierno', s.government.laborDemand, jg['Government.laborDemand']);
  amount('gobierno masa salarial', s.government.wageBill, jg['Government.wageBill']);
  amount('gobierno seguro de desempleo', s.government.doleExpenditure, jg['doleExpenditure']);
  const jcb = agentJ(s.centralBank.id);
  flags('BC', s.centralBank, jcb);
  amount('BC intereses de adelantos', s.centralBank.interestsOnAdvances, jcb['interestsOnAdvances']);
  amount('BC intereses de bonos', s.centralBank.interestsOnBonds, jcb['interestsOnBonds']);

  return { diffs, total, counts, amountFields, doubleFieldsOver, scaled };
}
