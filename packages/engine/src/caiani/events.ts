/*
 * Petri — Copyright (C) 2026 Nicolas Picotto
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Traducción a TypeScript, MODIFICADA, de código de:
 *   JMAB / modelo Benchmark — Copyright (C) 2013 Alessandro Caiani and Antoine Godin
 *   (GNU GPL v3 o posterior). https://github.com/S120/jmab, https://github.com/S120/benchmark
 * Clases de origen: ver cada evento (referencia: benchmarkModel.jar del paper; fuente equivalente en
 *   reference/jmab-2015).
 * Modificaciones: ver docs/reglas-caiani.md (cada diferencia con el original está documentada).
 */

/**
 * Eventos del tick de JMAB (P3), en el orden de `modelFile.xml` (lista `events`). Cada función es un
 * evento: modifica el estado como lo hacen los `onTicArrived` de los agentes que lo escuchan.
 * Registro regla por regla (ecuación, línea de JMAB, verificación): docs/reglas-caiani.md.
 */

import { agentOf, closeContract, contractIds, delistFromIssuer, contractOf, credit, firstAsset, installments, netFinancialWorth, open, pay, rawInstallments, setContractRate, writeDown, type AgentId, type ContractKind, type Ledger } from './ledger';
import { CarryRounder, MICRO_PER_UNIT, allocateLargestRemainder, toMicro, toUnits, type Micro } from './money';
import { PaymentBatch, type SettleReport } from './payments';
import { expNeg } from '../detmath';
import { logistic } from '../creditRisk';
import type { CaianiRng } from './rng';
import { flooring, ge, gt, lt, record, rounding } from './decisions';
import { derivedInput, derivedPayment, derivedRounded, derivedValue, inputsActive, scaleTerms, type InputTerm } from './derived';
import {
  EXPECTATION,
  LAG,
  MKT,
  getLag,
  setLag,
  updateExpectation,
  addObservation,
  goodValue,
  type BankState,
  type CaianiState,
  type CapitalGoodStock,
  type ConsumptionGoodStock,
  type Expectations,
  type FirmState,
  type GovernmentState,
  type HouseholdState,
} from './state';

/** Índices de los eventos de comportamiento (orden de modelFile.xml, líneas 43–80). */
export const EVENT = {
  COMPUTE_EXPECTATIONS: 0,
  CAPITAL_PRICE: 1,
  CONSUMPTION_PRICE: 2,
  CAPITAL_MARKET_1: 3,
  RD_DECISION: 4,
  INVESTMENT_DEMAND: 5,
  CREDIT_SUPPLY: 6,
  DEPOSIT_SUPPLY: 7,
  DEPOSIT_INTEREST: 8,
  CREDIT_DEMAND: 9,
  CREDIT_MARKET: 10,
  LABOR_SUPPLY: 11,
  LABOR_DEMAND: 12,
  GOVERNMENT_LABOR: 13,
  LABOR_MARKET: 14,
  PRODUCTION: 15,
  RD_OUTCOME: 16,
  CONSUMPTION_DEMAND: 17,
  CONSUMPTION_MARKET: 18,
} as const;

/**
 * Orden de despacho: dentro de un evento, JMAB llama a los agentes en **orden de creación** (el de
 * suscripción al planificador), no en el de la lista de la población. Verificado con el oráculo en los
 * eventos 1 y 2 (reglas-caiani.md, sec. 1). Los arreglos del estado ya están en orden de creación.
 */

/** `SimpleAbstractAgent.computeExpectations`: recalcula cada expectativa con sus observaciones. */
function computeExpectations(e: Expectations): void {
  for (const key of Object.keys(e)) updateExpectation(e[Number(key)]!);
}

/** Suma de los saldos de un lado y tipo de un agente, en µ (como `getItemsStockMatrix` + suma). */
function sumContracts(ledger: Ledger, agent: AgentId, side: 'assets' | 'liabilities', kind: ContractKind): Micro {
  let s = 0;
  for (const id of contractIds(ledger, agent, side, kind)) s += contractOf(ledger, id).amount;
  return s;
}

/**
 * `TargetExpectedInventoriesOutputStrategy.computeOutput`:
 *   Y* = max(0, Sᵉ + (share·Sᵉ − inventario))
 * con Sᵉ la expectativa de ventas reales y el inventario el primer ítem del tipo de bien producido.
 */
export const SITE_TARGET_OUTPUT = 'TargetExpectedInventoriesOutputStrategy.computeOutput';

export function targetOutput(expectedRealSales: number, inventoryQuantity: number, share: number): number {
  const expInv = expectedRealSales * share;
  const x = expectedRealSales + (expInv - inventoryQuantity);
  // Decisión: el piso 0. Escala: la de los términos (el resultado sale de una resta).
  record(SITE_TARGET_OUTPUT, x > 0, x, 0, 'pure', Math.max(Math.abs(expectedRealSales), Math.abs(expInv), Math.abs(inventoryQuantity)));
  return Math.max(0, x);
}

function firmOutput(f: FirmState, inventoryQuantity: number, share: number): void {
  const exp = f.expectations[EXPECTATION.REALSALES];
  if (!exp) throw new Error(`empresa ${f.id} sin expectativa de ventas reales`);
  f.desiredOutput = targetOutput(exp.expectation, inventoryQuantity, share);
}

/**
 * Evento 0, `computeExpectationsTic` (TIC_COMPUTEEXPECTATIONS). Lo escuchan:
 * - empresas de capital (`CopyOfCapitalFirm2WagesEnd.onTicArrived`): bailoutCost = 0, defaulted =
 *   false, expectativas, `determineOutput` (`CapitalFirm.determineOutput`): producción deseada y
 *   activa en el mercado de capital si inventario + ⌊Y*⌋ > 0;
 * - empresas de consumo (`CopyOfConsumptionFirm2WagesEnd`): lo mismo; `ConsumptionFirm.determineOutput`
 *   las activa en el mercado de capital siempre (como compradoras);
 * - hogares (`Households.onTicArrived`): expectativas;
 * - bancos (`Bank.onTicArrived`): bailoutCost = 0, morosidad del tick = 0, defaulted = false,
 *   expectativas, ratio de liquidez y ratio de capital;
 * - BC (`CentralBank.onTicArrived`): ganancias por adelantos y por bonos; activo en adelantos.
 * El gobierno no lo escucha. No hay sorteos ni interacción entre agentes: el orden no importa.
 */
export function computeExpectationsEvent(s: CaianiState): void {
  const L = s.ledger;

  for (const k of s.capitalFirms) {
    k.bailoutCost = 0;
    k.defaulted = false;
    computeExpectations(k.expectations);
    // getItemStockMatrix(true, SM_CAPGOOD): el primer bien de capital es el inventario propio.
    const inv = k.capitalGoods[0];
    if (!inv) throw new Error(`empresa de capital ${k.id} sin inventario (JMAB: NullPointerException)`);
    firmOutput(k, inv.quantity, s.rules.inventoryShareCapital);
    // Decisión: con inventario > 0 queda activa; sin inventario, el borde es Y* = 1 (⌊Y*⌋ > 0).
    const activeK = inv.quantity + Math.floor(k.desiredOutput) > 0;
    if (inv.quantity !== 0) record('CapitalFirm.determineOutput activo (inventario)', activeK, inv.quantity, 0, 'pure');
    else record('CapitalFirm.determineOutput activo (⌊Y*⌋)', activeK, k.desiredOutput, 1, 'pure');
    k.active[MKT.CAPGOOD] = activeK;
  }

  for (const c of s.consumptionFirms) {
    c.bailoutCost = 0;
    c.defaulted = false;
    computeExpectations(c.expectations);
    const inv = c.consumptionGoods[0];
    if (!inv) throw new Error(`empresa de consumo ${c.id} sin inventario (JMAB: NullPointerException)`);
    firmOutput(c, inv.quantity, s.rules.inventoryShareConsumption);
    c.active[MKT.CAPGOOD] = true;
  }

  for (const h of s.households) computeExpectations(h.expectations);

  for (const b of s.banks) {
    b.bailoutCost = 0;
    b.currentNonPerformingLoans = 0;
    b.defaulted = false;
    computeExpectations(b.expectations);
    const deposits = sumContracts(L, b.id, 'liabilities', 'deposit');
    const reserves = sumContracts(L, b.id, 'assets', 'reserves');
    // Cociente de sumas en µ: igual al de JMAB salvo el redondeo de los saldos.
    b.liquidityRatio = record('Bank.onTicArrived depósitos = 0', deposits === 0, deposits, 0, 'amount') ? 0 : reserves / deposits;
    const loans = toUnits(sumContracts(L, b.id, 'assets', 'loan'));
    // Como JMAB: sin préstamos da Infinity (o NaN si el patrimonio también es 0).
    b.capitalRatio = getLag(b.lags, LAG.NETWEALTH, s.round, 1) / loans;
  }

  const cb = s.centralBank;
  cb.interestsOnAdvances = 0;
  cb.interestsOnBonds = 0;
  const advances = contractIds(L, cb.id, 'assets', 'advance');
  if (advances.length !== 0) {
    let v = 0;
    for (const id of advances) v += contractOf(L, id).amount;
    cb.interestsOnAdvances = Math.round(v * s.rules.centralBankAdvancesRate);
  }
  // getItemStockMatrix(true, SM_BONDS): solo el primer bono, con su propia tasa.
  const bond = firstAsset(L, cb.id, 'bond');
  if (bond) cb.interestsOnBonds = Math.round(bond.amount * bond.rate);
  cb.active[MKT.ADVANCES] = true;
}

// ---------------------------------------------------------------------------------------------
// Eventos 1 y 2: precios
// ---------------------------------------------------------------------------------------------

export const SITE_MARKUP = 'AdaptiveMarkUpOnAC.computePrice';

/**
 * `AdaptiveMarkUpOnAC.computePrice`. Devuelve el precio nuevo y actualiza el margen de la empresa:
 * - referencia = inventario / ventas reales del período anterior;
 * - piso anterior = precio / (1 + margen);
 * - margen ∓= λ·margen·|N(0, σ)|: baja si la referencia supera el umbral, sube si no;
 * - precio = piso·(1 + margen), con el piso del período (o el anterior si el piso es 0);
 * - nunca por debajo del piso.
 * `lowerBound` es `getPriceLowerBound` (que además fija `expectedVariableCosts`); JMAB lo llama
 * varias veces, pero no tiene más efectos que ese, así que una sola llamada da lo mismo.
 */
export function adaptiveMarkUpPrice(
  f: FirmState,
  inventoryQuantity: number,
  price: number,
  pastRealSales: number,
  lowerBound: () => number,
  rng: CaianiRng,
  r: { markUpThreshold: number; markUpAdaptive: number; markUpSigma: number },
): number {
  const reference = inventoryQuantity / pastRealSales;
  const previousLowerBound = price / (1 + f.markUp);
  const x = rng.foldedNormal(SITE_MARKUP, r.markUpSigma);
  if (gt(`${SITE_MARKUP} referencia > umbral`, reference, r.markUpThreshold, 'pure')) f.markUp -= r.markUpAdaptive * f.markUp * x;
  else f.markUp += r.markUpAdaptive * f.markUp * x;
  const lb = lowerBound();
  const p = record(`${SITE_MARKUP} piso ≠ 0`, lb !== 0, lb, 0, 'pure') ? lb * (1 + f.markUp) : previousLowerBound * (1 + f.markUp);
  return gt(`${SITE_MARKUP} precio > piso`, p, lb, 'pure') ? p : lb;
}

/**
 * Trabajadores para producir `output` con las añadas de capital (`ConsumptionFirm.getRequiredWorkers`
 * y la rama sin producción de `getPriceLowerBound`): se usan primero las añadas más productivas (a
 * igual productividad, en el orden de la lista) y cada una necesita cantidad / (capital/trabajo)
 * trabajadores. Sin redondear (el redondeo lo hace quien llama).
 */
export function requiredWorkers(capital: readonly CapitalGoodStock[], output: number): number {
  const prods: number[] = [];
  for (const g of capital) if (!prods.includes(g.productivity)) prods.push(g.productivity);
  prods.sort((a, b) => b - a);
  let residual = output;
  let workers = 0;
  for (const p of prods) {
    for (const g of capital) {
      if (g.productivity !== p) continue;
      if (gt('ConsumptionFirm.getRequiredWorkers residual > capacidad de la añada', residual, g.productivity * g.quantity, 'pure')) {
        workers += g.quantity / g.capitalLaborRatio;
        residual -= g.productivity * g.quantity;
      } else {
        const requiredCapital = residual / g.productivity;
        workers += requiredCapital / g.capitalLaborRatio;
        residual -= requiredCapital * g.productivity;
      }
    }
  }
  return workers;
}

function wageExpectation(f: FirmState): number {
  const e = f.expectations[EXPECTATION.WAGES];
  if (!e) throw new Error(`empresa ${f.id} sin expectativa de salarios`);
  return e.expectation;
}

/**
 * Evento 1, `capitalPriceTic`: `CapitalFirm.computePrice` (565–574) en cada empresa de capital, en
 * orden de creación. Piso: `getPriceLowerBound` (810–814) = salario esperado / productividad del trabajo.
 */
export function capitalPriceEvent(s: CaianiState, rng: CaianiRng): void {
  for (const k of s.capitalFirms) {
    const inv = k.capitalGoods[0];
    if (!inv) throw new Error(`empresa de capital ${k.id} sin inventario (JMAB: NullPointerException en getPrice)`);
    const price = adaptiveMarkUpPrice(
      k,
      inv.quantity,
      inv.price,
      getLag(k.lags, LAG.REALSALES, s.round, 1),
      () => (k.expectedVariableCosts = wageExpectation(k) / s.rules.capitalLaborProductivity),
      rng,
      s.rules,
    );
    inv.price = price;
    setLag(k.lags, LAG.PRICE, s.round, price);
  }
}

/**
 * Piso del precio de la empresa de consumo (`ConsumptionFirm.getPriceLowerBound`, 826–881):
 * - con producción deseada: salario esperado × trabajadores requeridos (redondeados) / producción;
 * - sin producción: salario esperado × trabajadores para el inventario (sin redondear) / inventario
 *   (con inventario 0 da NaN, como en JMAB 2015; inicializacion.md, "De 2015 a 2016").
 */
export function consumptionLowerBound(c: FirmState): number {
  const w = wageExpectation(c);
  if (c.desiredOutput > 0) {
    const workers = requiredWorkers(c.capitalGoods, c.desiredOutput);
    return (w * rounding('ConsumptionFirm.getPriceLowerBound Math.round(trabajadores)', workers, Math.round(workers), 'pure')) / c.desiredOutput;
  }
  const inv = c.consumptionGoods[0];
  if (!inv) throw new Error(`empresa de consumo ${c.id} sin inventario (JMAB: NullPointerException)`);
  return (w * requiredWorkers(c.capitalGoods, inv.quantity)) / inv.quantity;
}

/** Evento 2, `consumptionPriceTic`: `ConsumptionFirm.computePrice` (683–690), en orden de creación. */
export function consumptionPriceEvent(s: CaianiState, rng: CaianiRng): void {
  for (const c of s.consumptionFirms) {
    const inv = c.consumptionGoods[0];
    if (!inv) throw new Error(`empresa de consumo ${c.id} sin inventario (JMAB: NullPointerException en getPrice)`);
    const price = adaptiveMarkUpPrice(
      c,
      inv.quantity,
      inv.price,
      getLag(c.lags, LAG.REALSALES, s.round, 1),
      () => (c.expectedVariableCosts = consumptionLowerBound(c)),
      rng,
      s.rules,
    );
    inv.price = price;
    setLag(c.lags, LAG.PRICE, s.round, price);
  }
}

// ---------------------------------------------------------------------------------------------
// Evento 3: primera etapa del mercado de capital
// ---------------------------------------------------------------------------------------------

export const SITE_BROCHURE_FIRST = 'BrochureSelectionRandomRobinBuyerMixer.invokeFirstInteractions';

/** Identidad: los eventos piden las mezclas con ids del port (el arnés de V3 los traduce a JMAB). */
const ownId = (id: AgentId): number => id;

/**
 * Elección de vendedores de los mezcladores `…SelectionRandomRobinBuyerMixer`: mezcla la lista de
 * vendedores **en el lugar** (`sellers.shuffle(prng)`: el orden queda para el comprador siguiente y
 * para el tick siguiente) y toma los primeros `nbSellers` activos en el mercado, en ese orden.
 */
function selectSellers(
  sellers: AgentId[],
  nbSellers: number,
  isActive: (id: AgentId) => boolean,
  rng: CaianiRng,
  site: string,
): AgentId[] {
  rng.shuffle(site, 'sellers', sellers, ownId);
  const selected: AgentId[] = [];
  for (let i = 0; i < sellers.length && selected.length < nbSellers; i++) {
    const k = sellers[i]!;
    if (isActive(k)) selected.push(k);
  }
  return selected;
}

/**
 * Evento 3, `capitalMarketTic1` (TIC_CAPITALMARKET1): primera etapa del `BrochureMarket` de capital
 * (`AbstractTwoStepMarketSimulation.eventOccurred` → `BrochureMarket.firstStep` →
 * `BrochureSelectionRandomRobinBuyerMixer.invokeFirstInteractions`). Ningún agente lo tiene en
 * `activeTicEvents`: actúa solo el mezclador.
 * - Compradores: la lista de la **población** de empresas de consumo (el `BrochureMarket` no tiene
 *   lista propia), mezclada en el lugar; no se filtra por activas.
 * - Para cada comprador, en ese orden: la lista de la población de empresas de capital se mezcla en el
 *   lugar y se toman las primeras `nbSellers` (5, XML 255) activas en el mercado de capital
 *   (`active[MKT_CAPGOOD]`, fijado en el evento 0).
 * - Si hay al menos una, `ConsumptionFirm.onAgentArrival` (208–216) guarda la lista en
 *   `selectedCapitalGoodSuppliers`. Si no, no hay evento y la empresa conserva la lista anterior.
 */
export function capitalMarketFirstStepEvent(s: CaianiState, rng: CaianiRng): void {
  const buyers = s.populations.consumptionFirms;
  const sellers = s.populations.capitalFirms;
  const firstC = s.consumptionFirms[0]!.id;
  const firstK = s.capitalFirms[0]!.id;
  const consumptionFirm = (id: AgentId): FirmState => {
    const c = s.consumptionFirms[id - firstC];
    if (!c || c.id !== id) throw new Error(`el agente ${id} no es una empresa de consumo`);
    return c;
  };
  const isActive = (id: AgentId): boolean => {
    const k = s.capitalFirms[id - firstK];
    if (!k || k.id !== id) throw new Error(`el agente ${id} no es una empresa de capital`);
    return k.active[MKT.CAPGOOD]!;
  };
  rng.shuffle(SITE_BROCHURE_FIRST, 'buyers', buyers, ownId);
  for (const b of buyers) {
    const selected = selectSellers(sellers, s.rules.capitalMarketSellers, isActive, rng, SITE_BROCHURE_FIRST);
    if (selected.length > 0) consumptionFirm(b).selectedCapitalSuppliers = selected;
  }
}

// ---------------------------------------------------------------------------------------------
// Evento 4: decisión de I+D
// ---------------------------------------------------------------------------------------------

/**
 * Evento 4, `rdDecisionTic` (TIC_RDDECISION): solo lo escuchan las empresas de capital
 * (`CopyOfCapitalFirm2WagesEnd.onTicArrived` 69–70 → `CapitalFirm.researchDecision` 542–545):
 *   amountResearch = ventas nominales del período anterior (`getPassedValue(LAG_NOMINALSALES, 1)`)
 *                    × researchShare
 * (`RandDInvestmentSharePastSales.computeRandDInvestment`). En el base `researchShare` = 0 (XML 1821):
 * da 0 salvo que las ventas sean infinitas o NaN; igual se calcula como JMAB, incluida la excepción si
 * falta el rezago. Sin sorteos.
 */
export function rdDecisionEvent(s: CaianiState): void {
  for (const k of s.capitalFirms) {
    k.amountResearch = getLag(k.lags, LAG.NOMINALSALES, s.round, 1) * s.rules.researchShare;
  }
}

// ---------------------------------------------------------------------------------------------
// Evento 5: demanda de inversión
// ---------------------------------------------------------------------------------------------

export const SITE_SWITCHING = 'AbstractSwitchingStrategy.switches';

/**
 * `SwitchingStrategySimple.getProbability(previous, potential)`:
 * - pago (`payOrReceive` = true): si potential < previous, 1 − e^{λ(potential − previous)/potential}; si no, 0;
 * - cobro: si previous < potential, 1 − e^{λ(previous − potential)/previous}; si no, 0.
 * La exponencial va con `expNeg` (detmath). Un exponente positivo (montos negativos) no se porta: error.
 */
export function switchingProbability(previous: number, potential: number, lambda: number, payOrReceive: boolean): number {
  let x: number;
  if (payOrReceive) {
    if (!lt(`${SITE_SWITCHING} potencial < previo`, potential, previous, 'pure')) return 0;
    x = (lambda * (previous - potential)) / potential;
  } else {
    if (!lt(`${SITE_SWITCHING} previo < potencial`, previous, potential, 'pure')) return 0;
    x = (lambda * (potential - previous)) / previous;
  }
  if (!(x >= 0)) throw new Error(`switchingProbability: exponente positivo (previous ${previous}, potential ${potential})`);
  return 1 - expNeg(x);
}

/**
 * `AbstractSwitchingStrategy.switches`: con p = 1 cambia y con p = 0 no, **sin sortear**; si no, una
 * Bernoulli(p).
 */
export function switches(previous: number, potential: number, lambda: number, payOrReceive: boolean, rng: CaianiRng): boolean {
  const p = switchingProbability(previous, potential, lambda, payOrReceive);
  if (p === 1) return true;
  if (p === 0) return false;
  return rng.bernoulli(SITE_SWITCHING, p);
}

/**
 * Atractivo de un bien de capital (`BestQualityPriceCapitalSupplierWithSwitching.selectGoodSupplier`):
 *   ((salario esperado / (productividad × capital/trabajo)) × duración) / precio
 * = ahorro de salarios por unidad de capital durante su vida, por peso.
 */
export function capitalAttractiveness(expectedWages: number, g: CapitalGoodStock): number {
  const laborProductivity = g.productivity * g.capitalLaborRatio;
  return ((expectedWages / laborProductivity) * g.duration) / g.price;
}

/**
 * `RealCapitalDemandWithPayBackPeriod.computeRealCapitalDemand(seller)`. Recorre las añadas de la
 * empresa (en el orden de la lista):
 * - capacidad actual += productividad × cantidad, si la edad no es −1;
 * - si ((productividad del trabajo vieja − nueva) / salario esperado × (duración − edad)) − precio nuevo > 0,
 *   la añada queda obsoleta (`setObsolete(true)`; nunca se vuelve a false acá);
 * - si no, y le queda más de un período (duración − edad > 1), suma a la capacidad residual.
 * Capacidad deseada = (1 + crecimiento deseado) × capacidad actual; demanda =
 * `(int) Math.round((deseada − residual) / productividad nueva)` si deseada ≥ residual, si no 0.
 */
export function realCapitalDemand(c: FirmState, newCapital: CapitalGoodStock): number {
  const lpNew = newCapital.productivity * newCapital.capitalLaborRatio;
  const w = wageExpectation(c);
  let currentCapacity = 0;
  let residualCapacity = 0;
  for (const old of c.capitalGoods) {
    const lpOld = old.productivity * old.capitalLaborRatio;
    if (old.age !== -1) currentCapacity += old.productivity * old.quantity;
    const saving = ((lpOld - lpNew) / w) * (old.duration - old.age);
    // x − p > 0 ⇔ x > p en double (IEEE, con subnormales): se registra contra el precio.
    if (record('RealCapitalDemandWithPayBackPeriod obsolescencia', saving - newCapital.price > 0, saving, newCapital.price, 'pure')) {
      old.obsolete = true;
    } else if (old.duration - old.age > 1) {
      residualCapacity += old.productivity * old.quantity;
    }
  }
  const desiredCapacity = (1 + c.desiredCapacityGrowth) * currentCapacity;
  if (ge('RealCapitalDemandWithPayBackPeriod deseada ≥ residual', desiredCapacity, residualCapacity, 'pure')) {
    const x = (desiredCapacity - residualCapacity) / newCapital.productivity;
    return rounding('RealCapitalDemandWithPayBackPeriod Math.round(demanda)', x, javaRoundToInt(x), 'pure');
  }
  return 0;
}

/** `(int) Math.round(x)` de Java 6 para x ≥ 0 finito: ⌊x + 0,5⌋. */
function javaRoundToInt(x: number): number {
  if (!(x >= 0) || x >= 2147483647) throw new Error(`javaRoundToInt: fuera de rango ${x}`);
  return Math.floor(x + 0.5);
}

/**
 * Evento 5, `investmentDemandTic` (TIC_INVESTMENTDEMAND): solo las empresas de consumo, en orden de
 * creación (`CopyOfConsumptionFirm2WagesEnd.onTicArrived` 72–75):
 * 1. `BestQualityPriceCapitalSupplierWithSwitching.selectGoodSupplier` (114–150) sobre `selectedCapitalGoodSuppliers`:
 *    el más atractivo de los vistos en el evento 3 (el primero en caso de empate); el proveedor previo
 *    se reemplaza si está inactivo en el mercado de capital, o con probabilidad `switchingProbability`
 *    si es menos atractivo. Con `payOrReceive` = true y "más atractivo = mayor", esa probabilidad es
 *    siempre 0 (ver reglas-caiani.md): en la práctica solo se cambia de proveedor si el previo está
 *    inactivo. Se porta tal cual.
 * 2. `ConsumptionFirm.computeDesiredInvestment` (421–427) con `RealCapitalDemandWithPayBackPeriod` (97–130): demanda real de capital al proveedor elegido; si es
 *    > 0, la empresa queda activa en el mercado de capital (nunca se desactiva acá).
 * El "mercado activo" de `isActive` es el último que fijó un evento de mercado: el de capital (evento 3).
 */
export function investmentDemandEvent(s: CaianiState, rng: CaianiRng): void {
  for (const c of s.consumptionFirms) {
    const sellers = c.selectedCapitalSuppliers;
    if (sellers === null || sellers.length === 0) {
      throw new Error(`empresa de consumo ${c.id} sin vendedores de capital (JMAB: excepción en sellers.get(0))`);
    }
    computeDesiredInvestment(s, c, selectCapitalSupplier(s, c, sellers, rng));
  }
}

function capitalFirmById(s: CaianiState, id: AgentId): FirmState {
  const k = s.capitalFirms[id - s.capitalFirms[0]!.id];
  if (!k || k.id !== id) throw new Error(`el agente ${id} no es una empresa de capital`);
  return k;
}

/** Inventario de una empresa de capital (`getItemStockMatrix(true, productionStockId)`). */
function capitalOffered(s: CaianiState, id: AgentId): CapitalGoodStock {
  const g = capitalFirmById(s, id).capitalGoods[0];
  if (!g) throw new Error(`empresa de capital ${id} sin inventario (JMAB: NullPointerException)`);
  return g;
}

/**
 * `BestQualityPriceCapitalSupplierWithSwitching.selectGoodSupplier(sellers, 0, true)` (114–150): el más
 * atractivo de `sellers` (el primero en caso de empate; **no** mira si están activos); atractivo del previo =
 * −∞ si está inactivo en el mercado de capital; si el previo es menos atractivo, se reemplaza por el mejor si
 * su atractivo es −∞ o con `switches`. Devuelve el previo (actualizado). Eventos 5 y 19.
 */
function selectCapitalSupplier(s: CaianiState, c: FirmState, sellers: readonly AgentId[], rng: CaianiRng): AgentId {
  const w = wageExpectation(c);
  let best = sellers[0]!;
  let maxAttr = -Infinity;
  for (const k of sellers) {
    const a = capitalAttractiveness(w, capitalOffered(s, k));
    if (gt('BestQualityPriceCapitalSupplierWithSwitching mejor atractivo', a, maxAttr, 'pure')) {
      best = k;
      maxAttr = a;
    }
  }
  const prev = c.previousCapitalSupplier;
  if (prev === null) throw new Error(`empresa de consumo ${c.id} sin proveedor de capital previo (JMAB: NullPointerException)`);
  const prevAttr = capitalFirmById(s, prev).active[MKT.CAPGOOD] ? capitalAttractiveness(w, capitalOffered(s, prev)) : -Infinity;
  // Si el previo es el mejor, los dos atractivos son el mismo cálculo: no es una decisión que pueda
  // darse vuelta y no se registra. Un empate con otra empresa sí se registra.
  const prevWorse = prev === best ? prevAttr < maxAttr : lt('BestQualityPriceCapitalSupplierWithSwitching previo < mejor', prevAttr, maxAttr, 'pure');
  if (prevWorse) {
    if (prevAttr === -Infinity || switches(prevAttr, maxAttr, s.rules.capitalSwitchingLambda, s.rules.capitalSwitchingPayOrReceive, rng)) {
      c.previousCapitalSupplier = best;
    }
  }
  return c.previousCapitalSupplier!;
}

/**
 * `ConsumptionFirm.computeDesiredInvestment` (421–427): demanda real de capital al proveedor dado
 * (`RealCapitalDemandWithPayBackPeriod`); si es > 0, activa en el mercado de capital (nunca desactiva).
 */
function computeDesiredInvestment(s: CaianiState, c: FirmState, supplier: AgentId): void {
  c.desiredRealCapitalDemand = realCapitalDemand(c, capitalOffered(s, supplier));
  if (c.desiredRealCapitalDemand > 0) c.active[MKT.CAPGOOD] = true;
}

// ---------------------------------------------------------------------------------------------
// Evento 6: oferta de crédito de los bancos
// ---------------------------------------------------------------------------------------------

export const SITE_INTEREST_RATE = 'CopyOfAdaptiveInterestRateAverageThreshold.computeInterestRate';

/** Parámetros de una `CopyOfAdaptiveInterestRateAverageThreshold` (uno por mercado). */
export interface AdaptiveRateParams {
  /** `adaptiveParameter`. */
  adaptive: number;
  /** `increase`: si es false, con la referencia por encima del promedio la tasa baja. */
  increase: boolean;
  /** Desvío de la normal plegada de la estrategia. */
  sigma: number;
  /** `Bank.getInterestRateUpperBound(mktId)`: +∞ en crédito, `advancesInterestRate` en depósitos. */
  upperBound: number;
  /** Nombre de la variable de referencia, para el registro de decisiones. */
  reference: string;
}

/**
 * `CopyOfAdaptiveInterestRateAverageThreshold.computeInterestRate` (47–103), para los dos mercados en
 * que la usan los bancos:
 * - promedios sobre `banks`, en el orden de la lista de la población (`banks.getAgents()`; importa para
 *   la suma en double): umbral = referencia media, tasa media = tasa del mercado rezagada un período.
 *   Crédito (64–80): solo los bancos con préstamos y patrimonio > 0 (sin ninguno, 0/0 = NaN), con el
 *   ratio de capital y `LAG_LOANINTEREST`. Depósitos (53–63): todos los bancos, con el ratio de
 *   liquidez y `LAG_DEPOSITINTEREST`. Quien llama arma `banks`;
 * - con `increase` = false: si la referencia del banco supera el umbral, tasa = media − a·media·|N|; si
 *   no, media + a·media·|N|. Un sorteo por banco en cualquier rama;
 * - acotada a [0, techo] (`Bank.getInterestRateLowerBound` = 0 en los dos mercados). `Math.max`/`min`
 *   de Java y de JS propagan NaN igual.
 */
export function adaptiveInterestRate(
  referenceVariable: number,
  banks: readonly { ratio: number; pastRate: number }[],
  rng: CaianiRng,
  p: AdaptiveRateParams,
): number {
  let tot = 0;
  let inter = 0;
  for (const b of banks) {
    tot += b.ratio;
    inter += b.pastRate;
  }
  const n = banks.length;
  const threshold = tot / n;
  const avInterest = inter / n;
  // `adaptiveParameter*avInterest*distribution.nextDouble()`: se evalúa de izquierda a derecha.
  const step = () => p.adaptive * avInterest * rng.foldedNormal(SITE_INTEREST_RATE, p.sigma);
  let iR: number;
  // La referencia (ratio de capital o de liquidez) sale de montos.
  if (gt(`${SITE_INTEREST_RATE} ${p.reference} > promedio`, referenceVariable, threshold, 'fromAmounts')) {
    iR = p.increase ? avInterest + step() : avInterest - step();
  } else {
    iR = p.increase ? avInterest - step() : avInterest + step();
  }
  record(`${SITE_INTEREST_RATE} piso 0`, iR > 0, iR, 0, 'pure', avInterest);
  if (p.upperBound !== Infinity) record(`${SITE_INTEREST_RATE} techo`, iR < p.upperBound, iR, p.upperBound, 'pure');
  return Math.min(Math.max(iR, 0), p.upperBound);
}

/**
 * Evento 6, `creditSupplyTic` (TIC_CREDITSUPPLY): solo los bancos, en orden de creación
 * (`Bank.onTicArrived` 199–202):
 * 1. `determineBankGenericInterestRate` (273–277): `bankInterestRate` con `adaptiveInterestRate`
 *    (crédito: bancos con préstamos y patrimonio > 0, ratio de capital, techo +∞). Los
 *    promedios leen el ratio de capital del evento 0 y la tasa rezagada: no dependen de las tasas que
 *    ya fijaron los otros bancos en este evento.
 * 2. `determineCreditSupply` (378–387): `InfiniteSupplyCreditStrategy` → +∞; se guarda en
 *    `totalLoanSupply` y en el rezago `LAG_BANKTOTLOANSUPPLY` del período, y el banco queda activo en
 *    el mercado de crédito si la oferta es > 0 (siempre, con +∞).
 */
export function creditSupplyEvent(s: CaianiState, rng: CaianiRng): void {
  const L = s.ledger;
  const firstB = s.banks[0]!.id;
  const bank = (id: AgentId) => {
    const b = s.banks[id - firstB];
    if (!b || b.id !== id) throw new Error(`el agente ${id} no es un banco`);
    return b;
  };
  // `getNumericBalanceSheet()[0][SM_LOAN] != 0 && getNetWealth() > 0`. No cambia dentro del evento.
  const eligible = s.populations.banks
    .map(bank)
    .filter((b) => {
      const loans = sumContracts(L, b.id, 'assets', 'loan');
      return (
        record(`${SITE_INTEREST_RATE} préstamos ≠ 0`, loans !== 0, loans, 0, 'amount') &&
        gt(`${SITE_INTEREST_RATE} patrimonio > 0`, netFinancialWorth(L, b.id), 0, 'amount')
      );
    })
    .map((b) => ({ ratio: b.capitalRatio, pastRate: getLag(b.lags, LAG.LOANINTEREST, s.round, 1) }));
  const p: AdaptiveRateParams = {
    adaptive: s.rules.loanRateAdaptive,
    increase: s.rules.loanRateIncrease,
    sigma: s.rules.loanRateSigma,
    upperBound: Infinity, // Bank.getInterestRateUpperBound(MKT_CREDIT)
    reference: 'ratio de capital',
  };
  for (const b of s.banks) {
    b.bankInterestRate = adaptiveInterestRate(b.capitalRatio, eligible, rng, p);
    const loanSupply = Infinity; // InfiniteSupplyCreditStrategy.computeCreditSupply
    b.totalLoanSupply = loanSupply;
    setLag(b.lags, LAG.BANKTOTLOANSUPPLY, s.round, loanSupply);
    if (b.totalLoanSupply > 0) b.active[MKT.CREDIT] = true;
  }
}

// ---------------------------------------------------------------------------------------------
// Evento 7: tasa de los depósitos
// ---------------------------------------------------------------------------------------------

/**
 * Evento 7, `depSupplyTic` (TIC_DEPOSITSUPPLY): solo los bancos, en orden de creación
 * (`Bank.onTicArrived` 203–205 → `determineDepositInterestRate` 369–375): `depositInterestRate` con
 * `adaptiveInterestRate` en el mercado de depósitos (`banksDepInterestStrategy`, XML 2512–2520):
 * promedios de **todos** los bancos (ratio de liquidez del evento 0 y `LAG_DEPOSITINTEREST` del período
 * anterior), techo = `advancesInterestRate` del banco; y el banco queda activo en depósitos.
 */
export function depositSupplyEvent(s: CaianiState, rng: CaianiRng): void {
  const firstB = s.banks[0]!.id;
  const all = s.populations.banks.map((id) => {
    const b = s.banks[id - firstB];
    if (!b || b.id !== id) throw new Error(`el agente ${id} no es un banco`);
    return { ratio: b.liquidityRatio, pastRate: getLag(b.lags, LAG.DEPOSITINTEREST, s.round, 1) };
  });
  const p: AdaptiveRateParams = {
    adaptive: s.rules.depositRateAdaptive,
    increase: s.rules.depositRateIncrease,
    sigma: s.rules.depositRateSigma,
    upperBound: s.rules.bankAdvancesInterestRate, // Bank.getInterestRateUpperBound(MKT_DEPOSIT)
    reference: 'ratio de liquidez',
  };
  for (const b of s.banks) {
    b.depositInterestRate = adaptiveInterestRate(b.liquidityRatio, all, rng, p);
    b.active[MKT.DEPOSIT] = true;
  }
}

// ---------------------------------------------------------------------------------------------
// Evento 8: intereses de los depósitos
// ---------------------------------------------------------------------------------------------

/**
 * Evento 8, `depInterestTic` (TIC_DEPINTERESTS): solo los bancos, en orden de creación
 * (`Bank.onTicArrived` 196–198 → `payDepositInterests` 392–403). Para cada depósito del banco, en el
 * orden de su lista:
 * - interés = tasa **del contrato** × saldo; el depositante lo registra con `interestPaid`, que
 *   **asigna** (no suma: si un agente tuviera dos depósitos quedaría el último, como en JMAB);
 * - el saldo se capitaliza (`setValue(valor·(1 + tasa))`): no hay contrapartida en dinero, el banco
 *   le paga al depositante con su propio pasivo (`credit`, flujo `depositInterest`);
 * - `totInterestsDeposits` = suma de los intereses del banco.
 * En µ: los intereses del banco se redondean **con arrastre** sobre su lista de depósitos (`CarryRounder`,
 * decisión de Nico del 2026-11-13): cada uno queda a < 1 µ de saldo × tasa y el total, a ≤ 1 µ de la suma
 * de JMAB. El saldo nuevo es saldo + interés, y `interestReceived` y `totInterestsDeposits` son lo
 * acreditado.
 */
export function depositInterestEvent(s: CaianiState): void {
  const L = s.ledger;
  const holderOf = new Map<AgentId, { interestReceived: Micro }>();
  for (const h of s.households) holderOf.set(h.id, h);
  for (const f of s.consumptionFirms) holderOf.set(f.id, f);
  for (const f of s.capitalFirms) holderOf.set(f.id, f);
  for (const b of s.banks) {
    let tot = 0;
    const rounder = new CarryRounder();
    for (const id of contractIds(L, b.id, 'liabilities', 'deposit')) {
      const c = contractOf(L, id);
      const interest = rounder.add(c.amount * c.rate);
      const depositor = holderOf.get(c.holder);
      if (!depositor) throw new Error(`depósito ${id} del banco ${b.id}: el tenedor ${c.holder} no es hogar ni empresa`);
      depositor.interestReceived = interest;
      tot += interest;
      credit(L, id, interest, 'depositInterest');
    }
    b.totInterestsDeposits = tot;
  }
}

// ---------------------------------------------------------------------------------------------
// Evento 9: demanda de crédito de las empresas
// ---------------------------------------------------------------------------------------------

/**
 * `computeDebtPayments` (`ConsumptionFirm` 355–396, `CapitalFirm` 490–530): por cada préstamo de la
 * empresa (sus pasivos), con edad > 0, interés = tasa × saldo y capital según la amortización; con edad 0
 * (dado en este tick), nada. Devuelve el servicio total (`debtBurden`) y los intereses (`debtInterests`).
 * En µ, con `installments` del ledger (redondeo con arrastre sobre la lista; el evento 20 la usa igual para
 * `debtBurden`, y paga los montos sin redondear con redondeo controlado): los totales quedan a ≤ 1 µ de los de JMAB
 * (ledger-contratos.md; reglas-caiani.md, sec. 10).
 */
export function debtPayments(L: Ledger, firm: AgentId): { burden: Micro; interests: Micro } {
  let burden = 0;
  let interests = 0;
  for (const due of installments(L, firm, 'loan')) {
    burden += due.interest + due.principal;
    interests += due.interest;
  }
  return { burden, interests };
}

/**
 * `PeckingOrderTheory.computeCreditDemand` (XML 1855–1861 y 2152–2158, `stocksId` = [SM_DEP, SM_CASH]):
 * crédito = max(requerimiento − (depósitos + efectivo), 0). El requerimiento llega en unidades de
 * Caiani (double, como en JMAB) y se pasa a µ antes de restar.
 */
export const SITE_PECKING_ORDER = 'PeckingOrderTheory.computeCreditDemand';

export function peckingOrderCreditDemand(L: Ledger, firm: AgentId, requirement: number): Micro {
  const liquidity = sumContracts(L, firm, 'assets', 'deposit') + sumContracts(L, firm, 'assets', 'cash');
  const req = toMicro(requirement);
  return gt(`${SITE_PECKING_ORDER} requerimiento > liquidez`, req, liquidity, 'amount', undefined, firm) ? req - liquidity : 0;
}

/** `ConsumptionFirm.getRequiredWorkers` (267–298): trabajadores para la producción deseada, `(int) Math.round`. */
function consumptionRequiredWorkersInt(c: FirmState): number {
  const w = requiredWorkers(c.capitalGoods, c.desiredOutput);
  return rounding('ConsumptionFirm.getRequiredWorkers Math.round(trabajadores)', w, javaRoundToInt(w), 'pure');
}

function expectationOf(f: FirmState, id: number): number {
  const e = f.expectations[id];
  if (!e) throw new Error(`empresa ${f.id} sin expectativa ${id}`);
  return e.expectation;
}

/**
 * Requerimiento financiero de una empresa de consumo (`CopyOfConsumptionFirm2WagesEnd.computeCreditDemand`,
 * 197–235), en unidades de Caiani y en el orden de evaluación de Java:
 * - amortización = Σ cantidad × precio / amortización de las añadas con 0 ≤ edad < amortización (orden de la lista);
 * - ganancia esperada Πᵉ = Sᵉ nominal − N·wᵉ + intereses cobrados − intereses de la deuda
 *   + (0,1·Sᵉ real − ⌊inventario⌋)·costo unitario − amortización;
 * - impuestos esperados = Πᵉ·τ; dividendos esperados = Πᵉ·(1 − τ)·profitShare;
 * - inversión = demanda real de capital × precio del **primer** vendedor visto en el evento 3
 *   (`selectedCapitalGoodSuppliers.get(0)`, no el proveedor elegido en el evento 5: así está en JMAB);
 * - requerimiento = N·wᵉ + inversión + servicio de la deuda − intereses cobrados + impuestos + dividendos
 *   − Sᵉ nominal + shareOfExpIncomeAsDeposit·N·wᵉ.
 * N = `getRequiredWorkers()` (redondeado).
 */
export function consumptionFinancialRequirement(s: CaianiState, c: FirmState): number {
  const r = s.rules;
  const firstK = s.capitalFirms[0]!.id;
  const expRealSales = expectationOf(c, EXPECTATION.REALSALES);
  const inventories = c.consumptionGoods[0];
  if (!inventories) throw new Error(`empresa de consumo ${c.id} sin inventario (JMAB: NullPointerException)`);
  const uc = inventories.unitCost;
  const inv = Math.trunc(inventories.quantity); // (int) inventories.getQuantity()
  const expRevenues = expectationOf(c, EXPECTATION.NOMINALSALES);
  const nbWorkers = consumptionRequiredWorkersInt(c);
  const expWages = wageExpectation(c);
  let capitalAmortization = 0;
  for (const cap of c.capitalGoods) {
    if (cap.age >= 0 && cap.age < cap.amortization) capitalAmortization += (cap.quantity * cap.price) / cap.amortization;
  }
  const interestReceived = toUnits(c.interestReceived);
  const expectedProfits =
    expRevenues - nbWorkers * expWages + interestReceived - toUnits(c.debtInterests) + (r.inventoryShareConsumption * expRealSales - inv) * uc - capitalAmortization;
  const expectedTaxes = expectedProfits * r.profitTaxRate;
  const expectedDividends = expectedProfits * (1 - r.profitTaxRate) * r.firmProfitShareConsumption;
  const firstSeller = c.selectedCapitalSuppliers?.[0];
  if (firstSeller === undefined) throw new Error(`empresa de consumo ${c.id} sin vendedores de capital (JMAB: excepción en get(0))`);
  const k = s.capitalFirms[firstSeller - firstK];
  if (!k || k.id !== firstSeller) throw new Error(`el agente ${firstSeller} no es una empresa de capital`);
  const kInv = k.capitalGoods[0];
  if (!kInv) throw new Error(`empresa de capital ${k.id} sin inventario (JMAB: NullPointerException en getPrice)`);
  const investment = c.desiredRealCapitalDemand * kInv.price;
  return (
    nbWorkers * expWages +
    investment +
    toUnits(c.debtBurden) -
    interestReceived +
    expectedTaxes +
    expectedDividends -
    expRevenues +
    r.shareOfExpIncomeAsDepositConsumption * (nbWorkers * expWages)
  );
}

/**
 * Requerimiento financiero de una empresa de capital (`CopyOfCapitalFirm2WagesEnd.computeCreditDemand`,
 * 195–222), en el orden de evaluación de Java. Como el de consumo, sin inversión ni amortización, con la
 * I+D (⌊amountResearch / wᵉ⌋·wᵉ, 0 en el base) y con los dividendos sumados **antes** que los impuestos
 * (el orden importa para el bit a bit). N = `CapitalFirm.getRequiredWorkers` (535–537) =
 * `(int) Math.round(Y* / laborProductivity)`; inventario y costo unitario, los del primer bien de capital.
 */
export function capitalFinancialRequirement(s: CaianiState, k: FirmState): number {
  const r = s.rules;
  const expRealSales = expectationOf(k, EXPECTATION.REALSALES);
  const inventories = k.capitalGoods[0];
  if (!inventories) throw new Error(`empresa de capital ${k.id} sin inventario (JMAB: NullPointerException)`);
  const uc = inventories.unitCost;
  const inv = Math.trunc(inventories.quantity);
  const nbWorkers = capitalRequiredWorkersInt(s, k);
  const expWages = wageExpectation(k);
  const expRevenues = expectationOf(k, EXPECTATION.NOMINALSALES);
  const interestReceived = toUnits(k.interestReceived);
  const expectedProfits =
    expRevenues - nbWorkers * expWages + interestReceived - toUnits(k.debtInterests) + (r.inventoryShareCapital * expRealSales - inv) * uc;
  const expectedTaxes = expectedProfits * r.profitTaxRate;
  const expectedDividends = expectedProfits * (1 - r.profitTaxRate) * r.firmProfitShareCapital;
  return (
    nbWorkers * expWages +
    Math.floor(k.amountResearch / expWages) * expWages +
    toUnits(k.debtBurden) -
    interestReceived +
    expectedDividends +
    expectedTaxes -
    expRevenues +
    r.shareOfExpIncomeAsDepositCapital * (nbWorkers * expWages)
  );
}

/** `CapitalFirm.getRequiredWorkers` (535–537): `(int) Math.round(Y* / laborProductivity)`. */
function capitalRequiredWorkersInt(s: CaianiState, k: FirmState): number {
  const x = k.desiredOutput / s.rules.capitalLaborProductivity;
  return rounding('CapitalFirm.getRequiredWorkers Math.round(Y*/productividad)', x, javaRoundToInt(x), 'pure');
}

/**
 * Evento 9, `creditDemandTic` (TIC_CREDITDEMAND). Lo escuchan las empresas de capital
 * (`CopyOfCapitalFirm2WagesEnd.onTicArrived` 72–73) y las de consumo (`CopyOfConsumptionFirm2WagesEnd`
 * 76–77), en orden de creación (no hay sorteos ni interacción: el orden no importa). Cada una:
 * 1. `computeDebtPayments`: servicio de la deuda e intereses del tick;
 * 2. requerimiento financiero (arriba) y crédito pedido con `PeckingOrderTheory`;
 * 3. si el crédito pedido es > 0, queda activa en el mercado de crédito (nunca se desactiva acá).
 */
export function creditDemandEvent(s: CaianiState): void {
  const L = s.ledger;
  const demand = (f: FirmState, requirement: () => number) => {
    const d = debtPayments(L, f.id);
    f.debtBurden = d.burden;
    f.debtInterests = d.interests;
    f.creditDemanded = peckingOrderCreditDemand(L, f.id, requirement());
    if (f.creditDemanded > 0) f.active[MKT.CREDIT] = true;
  };
  for (const k of s.capitalFirms) demand(k, () => capitalFinancialRequirement(s, k));
  for (const c of s.consumptionFirms) demand(c, () => consumptionFinancialRequirement(s, c));
}

// ---------------------------------------------------------------------------------------------
// Evento 10: mercado de crédito
// ---------------------------------------------------------------------------------------------

export const SITE_CREDIT_MIXER = 'SelectionRandomRobinBuyerMixer.invokeInteractions';
export const SITE_CREDIT_SUPPLY = 'ExpectedReturnCreditSupply.computeSpecificSupply';

/** `Math.pow(b, n)` con n entero ≥ 0, como producto (principio 4: sin `pow`). No es bit a bit igual a Java. */
function powInt(b: number, n: number): number {
  let r = 1;
  for (let k = 0; k < n; k++) r *= b;
  return r;
}

/** `Bank.getInterestRate(idLoanSM, …)` (134–140): max(tasa del banco, tasa de bonos); el premio por empresa está comentado. */
export function loanInterestRate(b: BankState): number {
  return Math.max(b.bankInterestRate, b.bondInterestRate);
}

/**
 * `DeterministicLogisticCashFlowComputer.getDefaultProbability`: con OCF el flujo de caja operativo del
 * período anterior (`LAG_OPERATINGCASHFLOW`, 1), cuota = tasa × monto + monto / plazo y a la aversión al
 * riesgo del banco con ese tipo de empresa:
 *   p = 1 / (1 + e^{(OCF − a·cuota)/cuota})
 * Con `logistic` de creditRisk (expNeg; error relativo < 10⁻¹²; e^{x} con x > 40 se trata como infinito:
 * p = 0 en vez de ~e^{−x}). Con cuota 0 el exponente es ±∞ (p = 0 o 1, como Java) o NaN.
 */
export function logisticDefaultProbability(ocf: number, interestRate: number, amount: number, length: number, riskAversion: number): number {
  const payments = interestRate * amount + amount / length;
  const x = (ocf - riskAversion * payments) / payments;
  if (Number.isNaN(x)) return NaN;
  return logistic(-x);
}

/**
 * `ExpectedReturnCreditSupply.computeSpecificSupply` (binaryDecision = false, XML 2567–2574): lo que el
 * banco está dispuesto a prestarle a la empresa. Recorre monto = pedido·(1 − i/100), i = 0…100, y devuelve
 * el primero con rendimiento esperado ≥ 0 (0 si ninguno):
 * - recupero esperado = min(1, Σ valor del capital × haircut / Σ saldo de los préstamos de la empresa);
 * - p = probabilidad de default (arriba), con la tasa del banco y el plazo de la empresa (20);
 * - rendimiento esperado (q = 1 − p, s = 1/plazo, r = tasa, m = monto, D = plazo):
 *     p·[Σ_{t=0}^{D−1} (q^t·(−1 + s·t)·m·(1 − recupero) + q^{t+1}·r·m) + Σ_{t=1}^{D−2} q^{t+1}·(t − 0,5·t·s·(1 + t))·r·m]
 *     + q^D·r·m·(D − 0,5·(D − 1)·s·D)
 * Montos en unidades de Caiani (double), como JMAB. Las potencias son productos y la exponencial es
 * `expNeg`: el rendimiento no es bit a bit el de Java; lo que importa es su signo (decisión registrada,
 * con la escala de la suma de los términos en valor absoluto). Con monto 0 (i = 100) el rendimiento es 0
 * (o NaN, y entonces devuelve 0 igual).
 */
export function expectedReturnCreditSupply(s: CaianiState, bank: BankState, firm: FirmState, required: number, isConsumption: boolean): number {
  const r = s.rules;
  const L = s.ledger;
  let totCurrentDebt = 0;
  for (const id of contractIds(L, firm.id, 'liabilities', 'loan')) totCurrentDebt += toUnits(contractOf(L, id).amount);
  let capitalValue = 0;
  for (const g of firm.capitalGoods) capitalValue += goodValue(g, firm.id) * r.creditSupplyHaircut;
  const expectedShareRecovered = Math.min(1, capitalValue / totCurrentDebt);
  const duration = r.firmLoanLength; // decideLoanLength
  const shareRepaid = 1 / duration;
  const interest = loanInterestRate(bank);
  const ocf = getLag(firm.lags, LAG.OPERATINGCASHFLOW, s.round, 1);
  const riskAversion = isConsumption ? r.riskAversionC : r.riskAversionK; // Bank.getRiskAversion
  for (let i = 0; i < 101; i++) {
    const amount = required * (1 - i / 100);
    const probability = logisticDefaultProbability(ocf, interest, amount, duration, riskAversion);
    const q = 1 - probability;
    let er = 0;
    let abs = 0;
    for (let t = 0; t < duration; t++) {
      const a = powInt(q, t) * (-1 + shareRepaid * t) * amount * (1 - expectedShareRecovered);
      const b = powInt(q, t + 1) * interest * amount;
      er += a + b;
      abs += Math.abs(a) + Math.abs(b);
    }
    for (let t = 1; t < duration - 1; t++) {
      const c = powInt(q, t + 1) * (t - 0.5 * t * shareRepaid * (1 + t)) * interest * amount;
      er += c;
      abs += Math.abs(c);
    }
    er = er * probability;
    const last = powInt(q, duration) * interest * amount * (duration - 0.5 * (duration - 1) * shareRepaid * duration);
    er += last;
    const scale = Math.abs(probability) * abs + Math.abs(last);
    // Con monto 0 (i = 100) se devuelve 0 por cualquier rama: no es una decisión y no se registra.
    if (amount === 0) return 0;
    if (ge(`${SITE_CREDIT_SUPPLY} rendimiento esperado ≥ 0`, er, 0, 'fromAmounts', scale)) return amount;
  }
  return 0;
}

/**
 * `CheapestLenderWithSwitching.selectLender`: el banco más barato de los vistos (el primero en caso de
 * empate); el previo se reemplaza si su tasa es mayor y, o bien no está disponible (muerto, sin oferta
 * para esta empresa o inactivo en crédito: tasa +∞), o `switches(previa, mínima)` con la estrategia de
 * cambio del prestamista (pago, λ = ln 2 / 0,15). Calcular la oferta del previo no tiene efectos.
 */
function selectLender(s: CaianiState, firm: FirmState, lenders: readonly BankState[], isConsumption: boolean, rng: CaianiRng): BankState {
  const required = toUnits(firm.creditDemanded);
  let minRate = Infinity;
  let minLender = lenders[0]!;
  for (const b of lenders) {
    const rate = loanInterestRate(b);
    if (lt('CheapestLenderWithSwitching más barato', rate, minRate, 'pure')) {
      minRate = rate;
      minLender = b;
    }
  }
  if (firm.previousLender === null) throw new Error(`empresa ${firm.id} sin prestamista previo (JMAB: NullPointerException)`);
  const prev = bankById(s, firm.previousLender);
  // `isDead()`: la población de bancos es fija y nadie muere en el base (NoEntryPopulationHandler).
  // La oferta es 0 o al menos el 1% del pedido: se decide (y se registra) en expectedReturnCreditSupply.
  const available = expectedReturnCreditSupply(s, prev, firm, required, isConsumption) > 0 && prev.active[MKT.CREDIT]!;
  const previousRate = available ? loanInterestRate(prev) : Infinity;
  // Si el previo es el más barato, las dos tasas son el mismo cálculo: no se registra.
  const prevWorse = prev === minLender ? previousRate > minRate : gt('CheapestLenderWithSwitching previo > mínimo', previousRate, minRate, 'pure');
  if (prevWorse) {
    if (previousRate === Infinity || switches(previousRate, minRate, s.rules.lenderSwitchingLambda, s.rules.lenderSwitchingPayOrReceive, rng)) {
      firm.previousLender = minLender.id;
    }
  }
  return bankById(s, firm.previousLender);
}

function bankById(s: CaianiState, id: AgentId): BankState {
  const b = s.banks[id - s.banks[0]!.id];
  if (!b || b.id !== id) throw new Error(`el agente ${id} no es un banco`);
  return b;
}

/**
 * `ConstrainedCreditMechanism.execute` (XML 338–341): préstamo de min(pedido, oferta del banco, oferta
 * total del banco), a la tasa del banco, edad 0, plazo 20, capital fijo. Se acredita en el depósito de
 * la empresa **en ese banco** (el primero, `getItemStockMatrix(true, SM_DEP, banco)`); si no tiene, se
 * abre uno con la tasa de depósitos del banco. El pedido baja en el monto prestado; si se le dio todo,
 * la empresa queda inactiva en crédito. La oferta total del banco baja en el monto (+∞ en el base: no
 * cambia) y, si llega a 0, el banco queda inactivo. Un préstamo de 0 también se crea (lo cierra `cleanSM`).
 */
const SITE_CREDIT_MECHANISM = 'ConstrainedCreditMechanism.execute';
function creditTransaction(s: CaianiState, firm: FirmState, bank: BankState, isConsumption: boolean): void {
  const L = s.ledger;
  const required = firm.creditDemanded;
  const offered = expectedReturnCreditSupply(s, bank, firm, toUnits(required), isConsumption);
  // Math.min(required, Math.min(offered, totalLoanSupply)), en µ. La oferta es pedido·(1 − i/100): nunca lo supera.
  const amountUnits = Math.min(toUnits(required), Math.min(offered, bank.totalLoanSupply));
  const amount = Math.min(required, toMicro(amountUnits));
  open(L, 'loan', bank.id, firm.id, amount, { rate: loanInterestRate(bank), age: 0, length: s.rules.firmLoanLength, amortization: 'fixedCapital' }, 'loans');
  let deposit: number | undefined;
  for (const id of contractIds(L, firm.id, 'assets', 'deposit')) {
    if (contractOf(L, id).issuer === bank.id) {
      deposit = id;
      break;
    }
  }
  if (deposit === undefined) open(L, 'deposit', firm.id, bank.id, amount, { rate: bank.depositInterestRate }, 'loans');
  else credit(L, deposit, amount, 'loans');
  firm.creditDemanded = required - amount;
  // "Se le dio todo": en µ. Un pedido que en JMAB es un residuo de punto flotante (6,6·10⁻¹⁴ en el tick 293 de la
  // semilla 102) es 0 en µ y la empresa sale del mercado; en JMAB sigue activa. Es una decisión frágil (decisión de
  // Nico, 2026-11-13: "0 en µ es 0"; reglas-caiani.md, sec. 22).
  if (record(`${SITE_CREDIT_MECHANISM} se le dio todo`, amount === required, amount, required, 'amount', undefined, firm.id)) firm.active[MKT.CREDIT] = false;
  bank.totalLoanSupply -= toUnits(amount);
  if (bank.totalLoanSupply === 0) bank.active[MKT.CREDIT] = false;
}

/**
 * Evento 10, `creditMarketTic` (TIC_CREDITMARKET): `SimpleMarketSimulation` del crédito (XML 303–341), con
 * listas propias (`s.markets.credit`: compradores = empresas de capital y de consumo, vendedores = bancos)
 * y `nbRuns` = 1. Si no hay ningún comprador activo con algún vendedor activo, el mercado está cerrado y
 * no pasa nada (ni siquiera las mezclas). Si no, `SelectionRandomRobinBuyerMixer`:
 * - mezcla los compradores (en el lugar);
 * - para cada comprador activo en crédito: mezcla los vendedores (en el lugar) y toma los primeros 3
 *   activos (`selectSellers`); si hay alguno, la empresa elige prestamista (`selectLender`) y se ejecuta
 *   el crédito (`creditTransaction`), en el momento (el evento de llegada es sincrónico).
 */
export function creditMarketEvent(s: CaianiState, rng: CaianiRng): void {
  const m = s.markets.credit;
  const firmOf = new Map<AgentId, { f: FirmState; consumption: boolean }>();
  for (const f of s.consumptionFirms) firmOf.set(f.id, { f, consumption: true });
  for (const f of s.capitalFirms) firmOf.set(f.id, { f, consumption: false });
  const buyer = (id: AgentId) => {
    const b = firmOf.get(id);
    if (!b) throw new Error(`el agente ${id} no es una empresa`);
    return b;
  };
  const sellerActive = (id: AgentId) => bankById(s, id).active[MKT.CREDIT]!;
  // AbstractMarketMixer.closed
  const open_ = m.buyers.some((id) => buyer(id).f.active[MKT.CREDIT]) && m.sellers.some(sellerActive);
  if (!open_) return;
  rng.shuffle(SITE_CREDIT_MIXER, 'buyers', m.buyers, ownId);
  for (const id of m.buyers) {
    const { f, consumption } = buyer(id);
    if (!f.active[MKT.CREDIT]) continue;
    const selected = selectSellers(m.sellers, s.rules.creditMarketSellers, sellerActive, rng, SITE_CREDIT_MIXER);
    if (selected.length === 0) continue;
    const lender = selectLender(
      s,
      f,
      selected.map((b) => bankById(s, b)),
      consumption,
      rng,
    );
    creditTransaction(s, f, lender, consumption);
  }
}

// ---------------------------------------------------------------------------------------------
// Eventos 11 a 14: mercado de trabajo
// ---------------------------------------------------------------------------------------------

export const SITE_WAGE = 'AdaptiveWageStrategy.computeWage';

function householdById(s: CaianiState, id: AgentId): HouseholdState {
  const h = s.households[id - s.households[0]!.id];
  if (!h || h.id !== id) throw new Error(`el agente ${id} no es un hogar`);
  return h;
}

/**
 * `Households.getMicroReferenceVariableForWage` (393–403). Ocupado: 0. Desocupado:
 *   (1 + Σ_{i=1}^{L−1} LAG_EMPLOYED(t − i)) / L,  L = `employmentWageLag` = 4.
 * Así está en JMAB: la variable se llama `averageUnemployment` y arranca en 1 (el desocupado de hoy),
 * pero suma los rezagos de **ocupado** (`LAG_EMPLOYED` = 1 si tenía empleador). Un desocupado de los
 * cuatro trimestres da 1/4; uno que trabajó en alguno de los tres anteriores, ≥ 1/2 (reglas-caiani.md,
 * sec. 12, hallazgo). Los valores son k/4 exactos: la comparación con el umbral no se registra.
 */
export function wageMicroReference(s: CaianiState, h: HouseholdState): number {
  if (h.employer !== null) return 0;
  const L = s.rules.employmentWageLag;
  let averageUnemployment = 1;
  for (let i = 1; i < L; i++) averageUnemployment += getLag(h.lags, LAG.EMPLOYED, s.round, i);
  return averageUnemployment / L;
}

/**
 * `Households.getMacroReferenceVariableForWage` (423–428): desocupado, 0; ocupado, el desempleo agregado
 * del período anterior (`getAggregateValue(LAG_AGGUNEMPLOYMENT, 1)`).
 */
export function wageMacroReference(s: CaianiState, h: HouseholdState): number {
  return h.employer === null ? 0 : getLag(s.aggregateLags, LAG.AGGUNEMPLOYMENT, s.round, 1);
}

/**
 * `AdaptiveWageStrategy.computeWage` (XML 2800–2806): si la referencia micro supera 0,49, el salario baja
 * w·|N(0; 0,0094)|; si no, y la referencia macro es ≤ 0,08, sube w·|N|; si no, queda igual. Piso:
 * `getWageLowerBound` = 0 (`Households` 375–378). Un sorteo solo en las ramas que cambian el salario.
 */
export function adaptiveWage(s: CaianiState, h: HouseholdState, rng: CaianiRng): number {
  const r = s.rules;
  let wage = h.wage;
  if (wageMicroReference(s, h) > r.wageMicroThreshold) {
    wage -= r.wageMicroAdaptive * wage * rng.foldedNormal(SITE_WAGE, r.wageSigma);
  } else if (!gt(`${SITE_WAGE} desempleo agregado > umbral`, wageMacroReference(s, h), r.wageMacroThreshold, 'pure')) {
    wage += r.wageMacroAdaptive * wage * rng.foldedNormal(SITE_WAGE, r.wageSigma);
  }
  return Math.max(wage, 0);
}

/**
 * Evento 11, `laborSupplyTic` (TIC_LABORSUPPLY): los hogares, en orden de creación
 * (`Households.onTicArrived` 186–188 → `computeWage` 203–209): salario de reserva con `adaptiveWage` y,
 * si no tiene empleador, activo en el mercado de trabajo (acá nunca se desactiva).
 */
export function laborSupplyEvent(s: CaianiState, rng: CaianiRng): void {
  for (const h of s.households) {
    h.wage = adaptiveWage(s, h, rng);
    if (h.employer === null) h.active[MKT.LABOR] = true;
  }
}

/** Empleador en el mercado de trabajo: empresa o gobierno. */
type Employer = FirmState | GovernmentState;

/** `AbstractFirm.fireAgent` (129–133), `Government.fireAgent` (312–): sin empleador y activo en trabajo. */
function fire(s: CaianiState, worker: AgentId): void {
  const h = householdById(s, worker);
  h.employer = null;
  h.active[MKT.LABOR] = true;
}

/** `cleanEmployeeList` (`AbstractFirm` 215–223, `Government` 298–306): saca a los que no tienen empleador, conserva el orden. */
function cleanEmployeeList(s: CaianiState, e: Employer): void {
  e.employees = e.employees.filter((id) => householdById(s, id).employer !== null);
}

/**
 * Ajuste de la planta, común a `computeLaborDemand` de las empresas de consumo
 * (`CopyOfConsumptionFirm2WagesEnd` 166–190), de capital (`CopyOfCapitalFirm2WagesEnd` 163–189) y del
 * gobierno (`GovernmentAntiCyclical` 146–167):
 * 1. Rotación: `Collections.shuffle(employees)` y despide a los primeros, `for (i = 0; i < turnover·N; i++)`
 *    con la comparación en `double` (con N = 50 y turnover = 0,05 despide 3: i = 0, 1, 2 < 2,5). La mezcla
 *    se pide aunque la lista esté vacía (JMAB la registra igual).
 * 2. `cleanEmployeeList`; N = empleados que quedan; requeridos = `required()` (se calcula después de la
 *    rotación, como en JMAB).
 * 3. Si requeridos > N: `laborDemand` = requeridos − N, activo en trabajo. Si no: `laborDemand` = 0,
 *    inactivo, **otra mezcla** (aunque no haya que despedir a nadie) y despide a los primeros N − requeridos.
 * 4. `cleanEmployeeList`.
 */
function adjustWorkforce(s: CaianiState, e: Employer, site: string, required: () => number, rng: CaianiRng): void {
  const turnover = s.rules.laborTurnover;
  let currentWorkers = e.employees.length;
  rng.shuffleEmployees(site, e.id, e.employees, ownId);
  for (let i = 0; i < turnover * currentWorkers; i++) fire(s, e.employees[i]!);
  cleanEmployeeList(s, e);
  currentWorkers = e.employees.length;
  const nbWorkers = required();
  if (nbWorkers > currentWorkers) {
    e.laborDemand = nbWorkers - currentWorkers;
    e.active[MKT.LABOR] = true;
  } else {
    e.laborDemand = 0;
    e.active[MKT.LABOR] = false;
    rng.shuffleEmployees(site, e.id, e.employees, ownId);
    for (let i = 0; i < currentWorkers - nbWorkers; i++) fire(s, e.employees[i]!);
  }
  cleanEmployeeList(s, e);
}

export const SITE_LABOR_DEMAND_CONSUMPTION = 'CopyOfConsumptionFirm2WagesEnd.computeLaborDemand';
export const SITE_LABOR_DEMAND_CAPITAL = 'CopyOfCapitalFirm2WagesEnd.computeLaborDemand';
export const SITE_LABOR_DEMAND_GOVERNMENT = 'GovernmentAntiCyclical.computeLaborDemand';

/**
 * Evento 12, `laborDemandTic` (TIC_LABORDEMAND): las empresas, en orden de creación (primero las de consumo,
 * después las de capital: verificado con el orden de los sorteos del oráculo), con `adjustWorkforce`.
 * Requeridos: consumo, `getRequiredWorkers()` (267–298, redondeado); capital, `getRequiredWorkers()`
 * (535–537) + `(int) Math.round(amountResearch / salario esperado)` (0 sin I+D).
 */
export function laborDemandEvent(s: CaianiState, rng: CaianiRng): void {
  for (const c of s.consumptionFirms) adjustWorkforce(s, c, SITE_LABOR_DEMAND_CONSUMPTION, () => consumptionRequiredWorkersInt(c), rng);
  for (const k of s.capitalFirms) {
    adjustWorkforce(
      s,
      k,
      SITE_LABOR_DEMAND_CAPITAL,
      () => {
        const x = k.amountResearch / wageExpectation(k);
        return capitalRequiredWorkersInt(s, k) + rounding('CopyOfCapitalFirm2WagesEnd.computeLaborDemand Math.round(I+D/salario)', x, javaRoundToInt(x), 'pure');
      },
      rng,
    );
  }
}

/**
 * Evento 13, `governmentLaborTic` (TIC_GOVERNMENTLABOR): `GovernmentAntiCyclical.computeLaborDemand`
 * (146–167) con `adjustWorkforce` y requeridos = `fixedLaborDemand` (1.360).
 */
export function governmentLaborEvent(s: CaianiState, rng: CaianiRng): void {
  adjustWorkforce(s, s.government, SITE_LABOR_DEMAND_GOVERNMENT, () => s.rules.governmentLaborDemand, rng);
}

export const SITE_LABOR_MIXER = 'SelectionRandomRobinBuyerMixer.invokeInteractions';
export const SITE_GOVERNMENT_WORKERS = 'SelectRandomWorkerStrategy.selectWorkers';

/**
 * `UnconstrainedLaborMechanism.execute`: el hogar pasa a tener empleador, el empleador lo agrega al final
 * de su lista (`addEmployee`: `laborDemand` − 1), el hogar queda inactivo en trabajo y, si la demanda llegó
 * a 0, también el empleador.
 */
function hire(s: CaianiState, e: Employer, worker: AgentId): void {
  const h = householdById(s, worker);
  h.employer = e.id;
  e.laborDemand -= 1;
  e.employees.push(worker);
  h.active[MKT.LABOR] = false;
  if (e.laborDemand === 0) e.active[MKT.LABOR] = false;
}

/**
 * `SelectCheapestWorkerStrategy.selectWorker`: el de menor salario de reserva entre los vistos (el primero
 * en caso de empate; si todos son NaN, el primero).
 */
function cheapestWorker(s: CaianiState, workers: readonly AgentId[]): AgentId {
  let minWage = Infinity;
  let cheapest = workers[0]!;
  for (const id of workers) {
    const w = householdById(s, id).wage;
    if (lt('SelectCheapestWorkerStrategy más barato', w, minWage, 'pure')) {
      minWage = w;
      cheapest = id;
    }
  }
  return cheapest;
}

/**
 * Evento 14, `laborMarketTic` (TIC_LABORMARKET): `SimpleMarketSimulation` del trabajo (XML 345–378), con
 * listas propias (`s.markets.labor`: compradores = empresas de capital, de consumo y el gobierno;
 * vendedores = hogares) y `nbRuns` = 8.000: repite el mezclador mientras el mercado no esté cerrado
 * (`AbstractMarketMixer.closed`: algún comprador activo y algún vendedor activo). En cada ronda,
 * `SelectionRandomRobinBuyerMixer` mezcla los compradores y, para cada uno activo en trabajo, mezcla los
 * vendedores y toma los primeros 10 activos (`selectSellers`). Llegada:
 * - empresa (`ConsumptionFirm` 239–243, `CapitalFirm` 274–278): contrata **uno**, el más barato
 *   (`cheapestWorker`);
 * - gobierno (`Government.onAgentArrival` 159–168, `SelectRandomWorkerStrategy`): mezcla una copia de los
 *   vistos y contrata a los primeros min(`laborDemand`, vistos).
 */
export function laborMarketEvent(s: CaianiState, rng: CaianiRng): void {
  const m = s.markets.labor;
  const employerOf = new Map<AgentId, Employer>();
  for (const f of s.consumptionFirms) employerOf.set(f.id, f);
  for (const f of s.capitalFirms) employerOf.set(f.id, f);
  employerOf.set(s.government.id, s.government);
  const employer = (id: AgentId): Employer => {
    const e = employerOf.get(id);
    if (!e) throw new Error(`el agente ${id} no es empleador`);
    return e;
  };
  const sellerActive = (id: AgentId) => householdById(s, id).active[MKT.LABOR]!;
  const closed = () => !(m.buyers.some((id) => employer(id).active[MKT.LABOR]) && m.sellers.some(sellerActive));
  for (let run = 0; run < s.rules.laborMarketRuns && !closed(); run++) {
    rng.shuffle(SITE_LABOR_MIXER, 'buyers', m.buyers, ownId);
    for (const id of m.buyers) {
      const e = employer(id);
      if (!e.active[MKT.LABOR]) continue;
      const selected = selectSellers(m.sellers, s.rules.laborMarketSellers, sellerActive, rng, SITE_LABOR_MIXER);
      if (selected.length === 0) continue;
      if (e === s.government) {
        rng.shuffle(SITE_GOVERNMENT_WORKERS, 'workers', selected, ownId);
        const n = Math.min(e.laborDemand, selected.length);
        for (let i = 0; i < n; i++) hire(s, e, selected[i]!);
      } else {
        hire(s, e, cheapestWorker(s, selected));
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Evento 15: producción
// ---------------------------------------------------------------------------------------------

/** `AbstractFirm.getWageBill` (189–195): suma de los salarios de los empleados, en el orden de la lista. */
function wageBill(s: CaianiState, f: FirmState): number {
  let w = 0;
  for (const id of f.employees) w += householdById(s, id).wage;
  return w;
}

/**
 * `CapitalGood.setQuantity` (184–193): cambia la cantidad y recalcula el valor contable,
 * precio × cantidad × (1 − edad / amortización). `ConsumptionGood` no lo recalcula.
 */
function setCapitalGoodQuantity(g: CapitalGoodStock, quantity: number): void {
  g.quantity = quantity;
  g.value = g.price * g.quantity * (1 - g.age / g.amortization);
}

/**
 * `ConsumptionFirm.produce` (440–500). Con empleados: recorre las añadas de capital (todas, en el orden de
 * la lista) sumando capacidad (cantidad × productividad), valor (`getValue`: el valor contable, porque la
 * empresa no es el productor) y amortización (precio × cantidad / amortización); después las usa de la más
 * productiva a la menos (a igual productividad, en el orden de la lista; `TreeMap.descendingKeySet`): si los
 * trabajadores que quedan alcanzan para la añada entera (cantidad / capital-trabajo < restantes), produce
 * productividad × cantidad; si no, capital-trabajo × restantes × productividad (usa una fracción) y no
 * quedan trabajadores. Suma la producción al inventario y fija el costo unitario = (amortización + masa
 * salarial) / producción. Sin empleados: solo capacidad y valor. Activa en el mercado de consumo si el
 * inventario es > 0. Rezagos: producción, capacidad y valor financiero del capital.
 */
function consumptionProduce(s: CaianiState, c: FirmState): void {
  let outputQty = 0;
  let capacity = 0;
  let capValue = 0;
  const inventories = c.consumptionGoods[0];
  if (!inventories) throw new Error(`empresa de consumo ${c.id} sin inventario (JMAB: NullPointerException)`);
  if (c.employees.length > 0) {
    let amortisationCosts = 0;
    for (const g of c.capitalGoods) {
      capacity += g.quantity * g.productivity;
      capValue += goodValue(g, c.id);
      amortisationCosts += (g.price * g.quantity) / g.amortization;
    }
    const prods: number[] = [];
    for (const g of c.capitalGoods) if (!prods.includes(g.productivity)) prods.push(g.productivity);
    prods.sort((a, b) => b - a);
    let residualWorkers = c.employees.length;
    for (const p of prods) {
      for (const g of c.capitalGoods) {
        if (g.productivity !== p) continue;
        const employedWorkers = g.quantity / g.capitalLaborRatio;
        // No se registra como decisión: en el umbral las dos ramas dan la misma producción (es continua).
        if (employedWorkers < residualWorkers) {
          outputQty += g.productivity * g.quantity;
          residualWorkers -= employedWorkers;
        } else {
          outputQty += g.capitalLaborRatio * residualWorkers * g.productivity;
          residualWorkers = 0;
        }
      }
    }
    inventories.quantity = inventories.quantity + outputQty;
    inventories.unitCost = (amortisationCosts + wageBill(s, c)) / outputQty;
  } else {
    for (const g of c.capitalGoods) {
      capacity += g.quantity * g.productivity;
      capValue += goodValue(g, c.id);
    }
  }
  c.active[MKT.CONSGOOD] = inventories.quantity > 0;
  setLag(c.lags, LAG.PRODUCTION, s.round, outputQty);
  setLag(c.lags, LAG.CAPACITY, s.round, capacity);
  setLag(c.lags, LAG.CAPITALFINANCIALVALUE, s.round, capValue);
}

/**
 * `CapitalFirm.produce` (394–420). Con empleados: trabajadores para la producción = `getRequiredWorkers()`
 * (`(int) Math.round(Y* / 2)`). Si la empresa no cubrió su demanda de trabajo (`laborDemand` > 0, caso
 * restringido): trabajadores de I+D = ⌊amountResearch / wᵉ⌋, total = producción + I+D, y los dedicados a
 * producir = `Math.round(producción / total × empleados)` con **división entera** de Java
 * (producción / total vale 1 sin I+D y 0 con I+D > 0: así está en JMAB). Producción = trabajadores ×
 * productividad del trabajo (2). Suma la producción al inventario (`CapitalGood.setQuantity`, que
 * recalcula el valor contable) y fija el costo unitario = masa salarial / producción. Rezago: producción.
 * Sin empleados, solo el rezago (0).
 */
function capitalProduce(s: CaianiState, k: FirmState): void {
  let outputQty = 0;
  if (k.employees.length > 0) {
    const outputLaborDemand = capitalRequiredWorkersInt(s, k);
    if (k.laborDemand > 0) {
      const researchDemandLabor = Math.floor(k.amountResearch / wageExpectation(k));
      const totalDemandLabor = outputLaborDemand + researchDemandLabor;
      if (totalDemandLabor === 0) throw new Error(`empresa de capital ${k.id}: 0/0 entero (JMAB: ArithmeticException)`);
      const actualOutputLabor = Math.trunc(outputLaborDemand / totalDemandLabor) * k.employees.length;
      outputQty = actualOutputLabor * s.rules.capitalLaborProductivity;
    } else {
      outputQty = outputLaborDemand * s.rules.capitalLaborProductivity;
    }
    const inventories = k.capitalGoods[0];
    if (!inventories) throw new Error(`empresa de capital ${k.id} sin inventario (JMAB: NullPointerException)`);
    setCapitalGoodQuantity(inventories, inventories.quantity + outputQty);
    inventories.unitCost = wageBill(s, k) / outputQty;
  }
  setLag(k.lags, LAG.PRODUCTION, s.round, outputQty);
}

/**
 * Evento 15, `productionTic` (TIC_PRODUCTION): las empresas, en orden de creación (consumo y después
 * capital; `CopyOfConsumptionFirm2WagesEnd.onTicArrived` 82–84, `CopyOfCapitalFirm2WagesEnd` 78–80). Sin
 * sorteos ni interacción.
 */
export function productionEvent(s: CaianiState): void {
  for (const c of s.consumptionFirms) consumptionProduce(s, c);
  for (const k of s.capitalFirms) capitalProduce(s, k);
}

// ---------------------------------------------------------------------------------------------
// Evento 16: resultado de la I+D
// ---------------------------------------------------------------------------------------------

/** `(int)` de Java aplicado a un double: trunca hacia 0; NaN da 0; satura en los extremos de `int`. */
function javaInt(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x >= 2147483647) return 2147483647;
  if (x <= -2147483648) return -2147483648;
  return Math.trunc(x);
}

/**
 * Investigadores de la empresa de capital en el tick (`CapitalFirm.researchOutcome` 361–373), con empleados:
 * - demanda de I+D = `(int) Math.floor(amountResearch / wᵉ)`;
 * - si no cubrió su demanda de trabajo (`laborDemand` > 0): requeridos para producir (`getRequiredWorkers()`),
 *   total = requeridos + I+D, dedicados a producir = `Math.round(requeridos · empleados / total)` con aritmética
 *   **entera** de Java (el `Math.round` de un `int` no cambia nada), investigadores = empleados − dedicados;
 * - si no: investigadores = demanda de I+D.
 * Con I+D nula (el base) da 0. Un total 0 es la `ArithmeticException` de JMAB: error.
 */
export function researchWorkers(s: CaianiState, k: FirmState): number {
  const researchLaborDemand = javaInt(Math.floor(k.amountResearch / wageExpectation(k)));
  if (k.laborDemand > 0) {
    const outputLaborDemand = capitalRequiredWorkersInt(s, k);
    const totalLaborDesired = outputLaborDemand + researchLaborDemand;
    const actualLabor = k.employees.length;
    if (totalLaborDesired === 0) throw new Error(`empresa de capital ${k.id}: división entera por 0 (JMAB: ArithmeticException)`);
    const actualOutputLabor = Math.trunc((outputLaborDemand * actualLabor) / totalLaborDesired);
    return actualLabor - actualOutputLabor;
  }
  return researchLaborDemand;
}

/**
 * Evento 16, `rdOutcomeTic` (TIC_RDOUTCOME): solo las empresas de capital, en orden de creación
 * (`CopyOfCapitalFirm2WagesEnd.onTicArrived` 81–82 → `CapitalFirm.researchOutcome` 360–379). Con empleados:
 * - ganancia de productividad (`RandDOutcomeBetaDistribution.computeRandDOutcome`): 0 sin investigadores, sin
 *   sorteos; con investigadores, una Bernoulli(1 − e^{−0,05·n}) y, si sale, 0,2 × Beta(2, 5) (XML 1831–1837);
 * - `capitalProductivity` += ganancia;
 * - `UpdateInventoriesProductivityWithCost.updateInventoriesProductivity` (XML 1839–1842): el inventario pasa
 *   a cantidad × (1 − `inventoriesLostShare`) con `CapitalGood.setQuantity` (que **recalcula el valor
 *   contable**, `setCapitalGoodQuantity`) y toma la productividad de la empresa.
 * Sin empleados no hace nada.
 *
 * **Rama no portada:** con investigadores (I+D > 0) el resultado necesita una Beta, que el `Rng` no tiene. En
 * el base `researchShare` = 0 (XML 1821) y nunca hay investigadores: el port tira un error si aparecen.
 */
export function rdOutcomeEvent(s: CaianiState): void {
  for (const k of s.capitalFirms) {
    if (k.employees.length === 0) continue;
    const researchers = researchWorkers(s, k);
    if (researchers !== 0) {
      throw new Error(
        `empresa de capital ${k.id}: ${researchers} investigadores; el resultado de la I+D (Bernoulli y Beta) no está ` +
          'portado (researchShare = 0 en el base; reglas-caiani.md, sec. 16)',
      );
    }
    const productivityGain = 0; // computeRandDOutcome(0)
    k.capitalProductivity = k.capitalProductivity + productivityGain;
    const inventories = k.capitalGoods[0];
    if (!inventories) throw new Error(`empresa de capital ${k.id} sin inventario (JMAB: NullPointerException)`);
    setCapitalGoodQuantity(inventories, inventories.quantity * (1 - s.rules.inventoriesLostShare));
    inventories.productivity = k.capitalProductivity;
  }
}

// ---------------------------------------------------------------------------------------------
// Evento 17: demanda de consumo
// ---------------------------------------------------------------------------------------------

export const SITE_CONSUMPTION_DEMAND = 'Households.computeConsumptionDemand';

/**
 * Salario medio de los ocupados que usa el ingreso del desocupado (`Households.getNetIncome` 352–364): suma de
 * los salarios de los hogares con empleador, en el orden de la lista de la población, sobre cuántos son
 * (0/0 = NaN sin ocupados, como en Java).
 */
export function averageEmployedWage(s: CaianiState): number {
  let averageWage = 0;
  let employed = 0;
  for (const id of s.populations.households) {
    const h = householdById(s, id);
    if (h.employer !== null) {
      averageWage += h.wage;
      employed += 1;
    }
  }
  return averageWage / employed;
}

/**
 * `getNetWealth` del hogar (`SimpleAbstractAgent.getNumericBalanceSheet`): activos − pasivos. Los financieros
 * salen del ledger (µ, exactos) y los bienes de consumo que compró en el tick, de su valor (`double`).
 */
export function householdNetWealth(s: CaianiState, h: HouseholdState, balance?: (contract: number) => number): number {
  let goods = 0;
  for (const g of h.consumptionGoods) goods += g.value;
  if (!balance) return toUnits(netFinancialWorth(s.ledger, h.id)) + goods;
  // Con pagos pendientes de un lote (`PaymentBatch.balance`), en µ como `double`.
  const a = agentOf(s.ledger, h.id);
  let nw = 0;
  for (const list of a.assets) for (const id of list) nw += balance(id);
  for (const list of a.liabilities) for (const id of list) nw -= balance(id);
  return nw / MICRO_PER_UNIT + goods;
}

/** `Households.getGrossIncome` (458–460): salario si tiene empleador (`AbstractHousehold` 67–74) + intereses + dividendos. */
export function householdGrossIncome(h: HouseholdState): number {
  return (h.employer === null ? 0 : h.wage) + toUnits(h.interestReceived) + toUnits(h.dividendsReceived);
}

/** `IncomeWealthTaxStrategy.computeTaxes`: max(alícuota del patrimonio × patrimonio + alícuota del ingreso × ingreso bruto, 0). */
export function householdTaxes(s: CaianiState, h: HouseholdState): number {
  return Math.max(s.rules.householdWealthTaxRate * householdNetWealth(s, h) + s.rules.householdIncomeTaxRate * householdGrossIncome(h), 0);
}

/**
 * `Households.getNetIncome` (346–366): ocupado, ingreso bruto − impuestos; desocupado, seguro de desempleo
 * (`unemploymentBenefit` × salario medio de los ocupados) + ingreso bruto − impuestos.
 */
export function householdNetIncome(s: CaianiState, h: HouseholdState, averageWage: () => number): number {
  const taxes = householdTaxes(s, h);
  if (h.employer !== null) return householdGrossIncome(h) - taxes;
  return s.rules.unemploymentBenefit * averageWage() + householdGrossIncome(h) - taxes;
}

/**
 * Evento 17, `consumptionDemandTic` (TIC_CONSUMPTIONDEMAND): los hogares, en orden de creación
 * (`Households.onTicArrived` 189–191 → `computeConsumptionDemand` 263–271):
 * - `updateIncome`: rezago `LAG_INCOME` = ingreso neto;
 * - demanda real (`ConsumptionFixedPropensitiesOOIWWithPersistency.computeRealConsumptionDemand`, XML 2778–2787):
 *   persistencia × consumo del período anterior + (1 − persistencia) × (c₁ × ingreso neto / pᵉ + c₂ × patrimonio / pᵉ),
 *   con pᵉ la expectativa del precio de consumo, persistencia 0, c₁ = 0,385808 y c₂ = 0,25;
 * - rezago `LAG_CONSUMPTION` = demanda; activo en el mercado de consumo si la demanda es > 0 (nunca lo apaga).
 * Sin sorteos ni interacción: el salario medio de los ocupados (que JMAB recalcula para cada desocupado) se
 * calcula una vez, porque nada de lo que lee cambia dentro del evento.
 */
export function consumptionDemandEvent(s: CaianiState): void {
  const r = s.rules;
  let avg: number | undefined;
  const averageWage = (): number => (avg ??= averageEmployedWage(s));
  for (const h of s.households) {
    const netIncome = householdNetIncome(s, h, averageWage);
    setLag(h.lags, LAG.INCOME, s.round, netIncome);
    const pe = h.expectations[EXPECTATION.CONSPRICE];
    if (!pe) throw new Error(`hogar ${h.id} sin expectativa del precio de consumo`);
    const pastConsumption = getLag(h.lags, LAG.CONSUMPTION, s.round, 1);
    const fromIncome = r.propensityOutOfIncome * (netIncome / pe.expectation);
    const fromWealth = r.propensityOutOfWealth * (householdNetWealth(s, h) / pe.expectation);
    h.demand = r.consumptionPersistency * pastConsumption + (1 - r.consumptionPersistency) * (fromIncome + fromWealth);
    setLag(h.lags, LAG.CONSUMPTION, s.round, h.demand);
    // La demanda sale de una suma: la escala de la decisión es la de sus términos.
    if (gt(`${SITE_CONSUMPTION_DEMAND} demanda > 0`, h.demand, 0, 'fromAmounts', Math.abs(fromIncome) + Math.abs(fromWealth))) {
      h.active[MKT.CONSGOOD] = true;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Evento 18: mercado de consumo
// ---------------------------------------------------------------------------------------------

export const SITE_CONSUMPTION_MIXER = 'SelectionRandomRobinBuyerMixer.invokeInteractions';
export const SITE_CHEAPEST_SUPPLIER = 'CheapestGoodSupplierWithSwitching.selectGoodSupplier';
export const SITE_AT_ONCE = 'AtOnceMechanism.execute';

function consumptionFirmById(s: CaianiState, id: AgentId): FirmState {
  const c = s.consumptionFirms[id - s.consumptionFirms[0]!.id];
  if (!c || c.id !== id) throw new Error(`el agente ${id} no es una empresa de consumo`);
  return c;
}

/** `ConsumptionFirm.getPrice` (802–805): el precio de su inventario. */
function consumptionPrice(c: FirmState): number {
  const inv = c.consumptionGoods[0];
  if (!inv) throw new Error(`empresa de consumo ${c.id} sin inventario (JMAB: NullPointerException)`);
  return inv.price;
}

/**
 * `CheapestGoodSupplierWithSwitching.selectGoodSupplier`: el más barato de los vistos (el primero si hay
 * empate); precio del proveedor previo = +∞ si está inactivo en el mercado activo (consumo); si el previo es
 * más caro, cambia si su precio es +∞ o con `switches` (pago, λ = ln 2 / 0,2: `switchingStrategy3`, XML
 * 1780–1786). Devuelve el proveedor (el previo, actualizado). `isDead` es siempre falso (población fija).
 */
export function selectGoodSupplier(s: CaianiState, h: HouseholdState, sellers: readonly AgentId[], rng: CaianiRng): AgentId {
  let minPrice = Infinity;
  let minSupplier = sellers[0]!;
  for (const id of sellers) {
    const p = consumptionPrice(consumptionFirmById(s, id));
    if (lt(`${SITE_CHEAPEST_SUPPLIER} más barato`, p, minPrice, 'pure')) {
      minPrice = p;
      minSupplier = id;
    }
  }
  const previous = consumptionFirmById(s, h.previousSeller);
  const previousPrice = previous.active[MKT.CONSGOOD] ? consumptionPrice(previous) : Infinity;
  // Si el previo es el más barato, los dos precios son el mismo: no es una decisión que pueda darse vuelta.
  const previousDearer =
    h.previousSeller === minSupplier ? previousPrice > minPrice : gt(`${SITE_CHEAPEST_SUPPLIER} previo más caro`, previousPrice, minPrice, 'pure');
  if (previousDearer) {
    if (previousPrice === Infinity || switches(previousPrice, minPrice, s.rules.consumerSwitchingLambda, s.rules.consumerSwitchingPayOrReceive, rng)) {
      h.previousSeller = minSupplier;
    }
  }
  return h.previousSeller;
}

/**
 * `AtOnceMechanism.execute` (hogar, empresa de consumo), con los pagos al lote del evento (`batch`):
 * 1. cantidad = min(demanda, inventario); monto = cantidad × precio;
 * 2. cuenta que cobra: el primer depósito de la empresa (`ConsumptionFirm.getPayableStock`); cuenta que paga:
 *    el primer depósito del hogar (`Households.getPayingStocks`: depósitos y después efectivo);
 *    `reallocateLiquidity` no mueve nada mientras las demás cuentas del hogar estén en 0 (el efectivo de los
 *    hogares es siempre 0: inicializacion.md, sec. 5); si no, error (rama no portada);
 * 3. si el depósito (saldo en µ + pagos pendientes del lote) no alcanza: el hogar queda inactivo y compra
 *    ⌊depósito / precio⌋;
 * 4. si compra algo: pago al depósito de la empresa (`AbstractBank.transfer`, al lote), un `ConsumptionGood`
 *    nuevo al final de los bienes del hogar (valor = monto, unidades de Caiani; costo unitario 0; edad 0;
 *    duración la del inventario), el inventario baja (`ConsumptionGood.setQuantity` no recalcula el valor),
 *    la demanda baja; el hogar queda inactivo si la demanda llegó a 0 o el depósito a 0; la empresa, si se
 *    quedó sin inventario.
 */
function consumptionPurchase(s: CaianiState, h: HouseholdState, c: FirmState, batch: PaymentBatch): void {
  const L = s.ledger;
  const demand = h.demand;
  const output = c.consumptionGoods[0];
  if (!output) throw new Error(`empresa de consumo ${c.id} sin inventario (JMAB: NullPointerException)`);
  const price = output.price;
  let quantity = record(`${SITE_AT_ONCE} demanda ≤ inventario`, demand <= output.quantity, demand, output.quantity, 'fromAmounts')
    ? demand
    : output.quantity; // Math.min(demand, inventario)
  let totalAmount = quantity * price;
  const payable = firstAsset(L, c.id, 'deposit');
  if (!payable) throw new Error(`empresa de consumo ${c.id} sin depósito (JMAB: NullPointerException)`);
  const target = firstAsset(L, h.id, 'deposit');
  if (!target) throw new Error(`hogar ${h.id} sin depósito (JMAB: NullPointerException)`);
  const needed = totalAmount * MICRO_PER_UNIT;
  if (batch.balance(target.id) < needed) {
    const others = [...contractIds(L, h.id, 'assets', 'deposit'), ...contractIds(L, h.id, 'assets', 'cash')];
    if (others.some((id) => id !== target.id && batch.balance(id) !== 0)) {
      throw new Error(`hogar ${h.id}: reallocateLiquidity con otra cuenta con saldo (no portado; reglas-caiani.md, sec. 17)`);
    }
  }
  if (lt(`${SITE_AT_ONCE} depósito < monto`, batch.balance(target.id), needed, 'amount')) {
    h.active[MKT.CONSGOOD] = false;
    quantity = flooring(`${SITE_AT_ONCE} cantidad con el depósito`, batch.balance(target.id) / MICRO_PER_UNIT / price, 'fromAmounts');
    totalAmount = quantity * price;
  }
  if (quantity > 0) {
    batch.pay(target.id, payable.id, totalAmount * MICRO_PER_UNIT, 'consumption');
    const good: ConsumptionGoodStock = {
      quantity,
      value: totalAmount,
      price,
      unitCost: 0,
      age: 0,
      producer: c.id,
      duration: output.duration,
    };
    h.consumptionGoods.push(good);
    output.quantity = output.quantity - quantity;
    h.demand = demand - quantity;
    if (h.demand === 0 || record(`${SITE_AT_ONCE} depósito agotado`, batch.balance(target.id) === 0, batch.balance(target.id), 0, 'amount')) {
      h.active[MKT.CONSGOOD] = false;
    }
    if (output.quantity === 0) c.active[MKT.CONSGOOD] = false;
  }
}

/**
 * Evento 18, `consumptionMarketTic` (TIC_CONSUMPTIONMARKET): `SimpleMarketSimulation` del consumo (XML 265–283),
 * con listas propias (`s.markets.consumption`: compradores = hogares, vendedores = empresas de consumo) y
 * `nbRuns` = 100: repite el mezclador mientras el mercado no esté cerrado. En cada ronda,
 * `SelectionRandomRobinBuyerMixer` (`nbSellers` = 5, XML 291–295) mezcla los compradores y, para cada hogar
 * activo en consumo, mezcla los vendedores y toma los primeros 5 activos (`selectSellers`). Llegada
 * (`Households.onAgentArrival` 163–167): elige el proveedor (`selectGoodSupplier`) y compra
 * (`AtOnceMechanism`, `consumptionPurchase`).
 *
 * Los pagos van a un lote (`PaymentBatch`) y se registran al cerrar el evento con redondeo controlado
 * (decisión de Nico, 2026-11-13; reglas-caiani.md, sec. 1, "Reservas"). Devuelve el informe del cierre.
 */
export function consumptionMarketEvent(s: CaianiState, rng: CaianiRng): SettleReport {
  const m = s.markets.consumption;
  const r = s.rules;
  const batch = new PaymentBatch(s.ledger);
  const sellerActive = (id: AgentId) => consumptionFirmById(s, id).active[MKT.CONSGOOD]!;
  const closed = () => !(m.buyers.some((id) => householdById(s, id).active[MKT.CONSGOOD]) && m.sellers.some(sellerActive));
  for (let run = 0; run < r.consumptionMarketRuns && !closed(); run++) {
    rng.shuffle(SITE_CONSUMPTION_MIXER, 'buyers', m.buyers, ownId);
    for (const id of m.buyers) {
      const h = householdById(s, id);
      if (!h.active[MKT.CONSGOOD]) continue;
      const selected = selectSellers(m.sellers, r.consumptionMarketSellers, sellerActive, rng, SITE_CONSUMPTION_MIXER);
      if (selected.length === 0) continue;
      const seller = selectGoodSupplier(s, h, selected, rng);
      consumptionPurchase(s, h, consumptionFirmById(s, seller), batch);
    }
  }
  return batch.settle();
}

// ---------------------------------------------------------------------------------------------
// Evento 19: segunda etapa del mercado de capital
// ---------------------------------------------------------------------------------------------

export const SITE_BROCHURE_SECOND = 'BrochureSelectionRandomRobinBuyerMixer.invokeSecondInteractions';
export const SITE_DESIRED_GROWTH = 'InvestmentCapacityOperatingCashFlowExpected.computeDesiredGrowth';
export const SITE_REALLOCATE = 'AbstractMechanism.reallocateLiquidity';

/**
 * `InvestmentCapacityOperatingCashFlowExpected.computeDesiredGrowth` (XML 2121–2130): capacidad = Σ cantidad ×
 * productividad de las añadas (todas); K = `LAG_CAPITALFINANCIALVALUE` del período anterior; tasa de flujo de
 * caja = `LAG_OPERATINGCASHFLOW` del período anterior / K (se calcula antes de mirar si K es 0, como Java).
 * Si la capacidad o K son 0, −1; si no, max(−1, w_cf·(OCF/K − cf*)/cf* + w_u·(Yᵈ / capacidad − u*)/u*).
 */
export function desiredCapacityGrowth(s: CaianiState, c: FirmState): number {
  const r = s.rules;
  let capacity = 0;
  for (const g of c.capitalGoods) capacity += g.quantity * g.productivity;
  const capitalValue = getLag(c.lags, LAG.CAPITALFINANCIALVALUE, s.round, 1);
  const cashFlowRate = getLag(c.lags, LAG.OPERATINGCASHFLOW, s.round, 1) / capitalValue;
  const noCapacity = record(`${SITE_DESIRED_GROWTH} capacidad = 0`, capacity === 0, capacity, 0, 'pure');
  if (noCapacity || record(`${SITE_DESIRED_GROWTH} K = 0`, capitalValue === 0, capitalValue, 0, 'pure')) return -1;
  const g =
    (r.investmentCashFlowWeight * (cashFlowRate - r.investmentTargetCashFlow)) / r.investmentTargetCashFlow +
    (r.investmentCapacityWeight * (c.desiredOutput / capacity - r.investmentTargetCapacityUtilization)) / r.investmentTargetCapacityUtilization;
  // Math.max(−1, g) de Java (NaN si g es NaN, igual que en JS).
  return Number.isNaN(g) ? g : gt(`${SITE_DESIRED_GROWTH} max(−1, g)`, g, -1, 'fromAmounts') ? g : -1;
}

/**
 * Compra de capital: `AtOnceMechanism.execute` con `CapitalGood` (el mismo mecanismo que el consumo, evento 18).
 * - cantidad = min(demanda, inventario del vendedor); monto = cantidad × precio del inventario
 *   (`CapitalFirm.getPrice`);
 * - cuenta que cobra: el primer depósito del vendedor (`CapitalFirm.getPayableStock`); cuentas que pagan
 *   (`ConsumptionFirm.getPayingStocks`, MKT_CAPGOOD): los depósitos de la empresa con el efectivo insertado
 *   antes del último (`add(size − 1, cash)`); la cuenta que paga es el primer depósito de esa lista;
 * - `reallocateLiquidity`: si el primer depósito no alcanza, se le pasa lo que falte desde las otras cuentas,
 *   en el orden de la lista (otro depósito: pago entre bancos, categoría `deposits`). Con efectivo distinto de
 *   0, **error** (no portado: las empresas tienen efectivo 0 siempre);
 * - si aun así no alcanza: inactiva en capital y compra ⌊depósito / precio⌋;
 * - si la cantidad es > 0: pago (categoría `investment`, con `PaymentBatch`), añada nueva al final de la lista
 *   (valor = monto, edad −1, costo unitario 0, productividad, duración, amortización y capital/trabajo del
 *   inventario), inventario − cantidad (`CapitalGood.setQuantity` recalcula el valor contable), demanda −
 *   cantidad; inactiva si la demanda o el depósito llegan a 0; el vendedor, inactivo si se queda sin inventario.
 */
function capitalPurchase(s: CaianiState, c: FirmState, k: FirmState, batch: PaymentBatch): void {
  const L = s.ledger;
  const demand = c.desiredRealCapitalDemand;
  const output = k.capitalGoods[0];
  if (!output) throw new Error(`empresa de capital ${k.id} sin inventario (JMAB: NullPointerException)`);
  const price = output.price;
  // Math.min(demanda, inventario). No se registra como decisión: en el empate las dos ramas dan lo mismo (y en
  // el base los dos son enteros: la demanda sale de un Math.round y el inventario, de trabajadores × 2).
  let quantity = demand <= output.quantity ? demand : output.quantity;
  let totalAmount = quantity * price;
  const payable = firstAsset(L, k.id, 'deposit');
  if (!payable) throw new Error(`empresa de capital ${k.id} sin depósito (JMAB: NullPointerException)`);
  const deposits = contractIds(L, c.id, 'assets', 'deposit');
  const cash = contractIds(L, c.id, 'assets', 'cash')[0];
  if (deposits.length === 0 || cash === undefined) {
    throw new Error(`empresa de consumo ${c.id} sin depósito o sin efectivo (JMAB: IndexOutOfBoundsException en getPayingStocks)`);
  }
  const paying = [...deposits];
  paying.splice(paying.length - 1, 0, cash);
  const target = deposits[0]!;
  const needed = totalAmount * MICRO_PER_UNIT;
  // reallocateLiquidity(totalAmount, paying, target)
  let raised = batch.balance(target);
  for (let i = 0; i < paying.length && lt(`${SITE_REALLOCATE} reunido < monto`, raised, needed, 'amount', undefined, c.id); i++) {
    const id = paying[i]!;
    if (id === target) continue;
    const thisAmount = batch.balance(id);
    const remAmount = Math.max(0, thisAmount + raised - needed);
    const transfer = thisAmount - remAmount;
    raised += transfer;
    if (id === cash) {
      if (transfer !== 0) throw new Error(`empresa de consumo ${c.id}: reallocateLiquidity con efectivo (no portado; reglas-caiani.md, sec. 18)`);
    } else if (transfer !== 0) {
      batch.pay(id, target, transfer, 'deposits'); // payingSupplier.transfer(payingStock, targetStock, monto)
    }
  }
  // Las decisiones de la compra pasan la empresa: un vuelco por un residuo de JMAB (el depósito que `reallocateLiquidity`
  // deja exactamente en el monto en µ y apenas por debajo en JMAB; tick 133, empresa 8140) es una decisión frágil dada
  // vuelta respecto de JMAB (reglas-caiani.md, sec. 1).
  if (lt(`${SITE_AT_ONCE} capital: depósito < monto`, batch.balance(target), needed, 'amount', undefined, c.id)) {
    c.active[MKT.CAPGOOD] = false;
    quantity = flooring(`${SITE_AT_ONCE} capital: cantidad con el depósito`, batch.balance(target) / MICRO_PER_UNIT / price, 'fromAmounts');
    totalAmount = quantity * price;
  }
  if (quantity > 0) {
    batch.pay(target, payable.id, totalAmount * MICRO_PER_UNIT, 'investment');
    c.capitalGoods.push({
      quantity,
      value: totalAmount,
      price,
      unitCost: 0,
      age: -1,
      producer: k.id,
      productivity: output.productivity,
      duration: output.duration,
      amortization: output.amortization,
      capitalLaborRatio: output.capitalLaborRatio,
      obsolete: false,
    });
    setCapitalGoodQuantity(output, output.quantity - quantity);
    c.desiredRealCapitalDemand = demand - quantity;
    if (
      c.desiredRealCapitalDemand === 0 ||
      record(`${SITE_AT_ONCE} capital: depósito agotado`, batch.balance(target) === 0, batch.balance(target), 0, 'amount')
    ) {
      c.active[MKT.CAPGOOD] = false;
    }
    if (output.quantity === 0) k.active[MKT.CAPGOOD] = false;
  }
}

/**
 * Evento 19, `capitalMarketTic2` (TIC_CAPITALMARKET2): segunda etapa del `BrochureMarket` de capital
 * (`AbstractTwoStepMarketSimulation.eventOccurred` → `BrochureMarket.secondStep` →
 * `BrochureSelectionRandomRobinBuyerMixer.invokeSecondInteractions`): mezcla la lista de compradores (la de la
 * población de empresas de consumo, en el lugar) y, a cada una activa en el mercado de capital, le manda la
 * llegada (`ConsumptionFirm.onAgentArrival` 216–227, rama de la segunda etapa):
 * 1. `desiredCapacityGrowth` = `computeDesiredGrowth()` (lo usa la demanda de abajo y la del evento 5 del tick
 *    siguiente);
 * 2. con n = vendedores vistos + 1 (fijo), mientras i < n, la demanda real sea > 0 y queden vendedores vistos:
 *    elige proveedor (`selectGoodSupplier` sobre los vistos: puede ser el previo, que no está en la lista),
 *    recalcula la demanda real con ese proveedor (`computeDesiredInvestment`), compra (`capitalPurchase`) y
 *    **saca al proveedor de `selectedCapitalGoodSuppliers`** (`remove`: la misma lista que guardó el evento 3,
 *    modificada en el lugar; si el proveedor no estaba en ella, no cambia). La compra puede ser de 0 (vendedor
 *    sin inventario): igual se lo saca.
 * Los pagos se registran al cerrar el evento con redondeo controlado (`PaymentBatch`).
 */
export function capitalMarketSecondStepEvent(s: CaianiState, rng: CaianiRng): SettleReport {
  const buyers = s.populations.consumptionFirms;
  const batch = new PaymentBatch(s.ledger);
  rng.shuffle(SITE_BROCHURE_SECOND, 'buyers', buyers, ownId);
  for (const id of buyers) {
    const c = consumptionFirmById(s, id);
    if (!c.active[MKT.CAPGOOD]) continue;
    c.desiredCapacityGrowth = desiredCapacityGrowth(s, c);
    const list = c.selectedCapitalSuppliers;
    if (list === null) throw new Error(`empresa de consumo ${c.id} sin vendedores de capital (JMAB: NullPointerException)`);
    const nbSellers = list.length + 1;
    for (let i = 0; i < nbSellers && c.desiredRealCapitalDemand > 0 && list.length > 0; i++) {
      const supplier = selectCapitalSupplier(s, c, list, rng);
      computeDesiredInvestment(s, c, supplier);
      capitalPurchase(s, c, capitalFirmById(s, supplier), batch);
      const at = list.indexOf(supplier);
      if (at >= 0) list.splice(at, 1);
    }
  }
  return batch.settle();
}

// ---------------------------------------------------------------------------------------------
// Evento 20: servicio de la deuda de las empresas
// ---------------------------------------------------------------------------------------------

export const SITE_PAY_INTERESTS = 'ConsumptionFirm/CapitalFirm.payInterests';
export const SITE_BANKRUPTCY = 'FirmBankruptcyFireSales.bankrupt';

/** Lo que una quiebra deja para después de cerrar el lote de pagos del evento (con los saldos ya redondeados). */
type AfterSettle = (() => void)[];

/**
 * Saldo de una cuenta del agente con los pagos pendientes del lote, en µ: tiene que ser entero (la quiebra
 * reparte la liquidez por restos mayores; los pagos que la preceden en el evento son traspasos de saldos enteros).
 */
function integerBalance(batch: PaymentBatch, contract: number, what: string): Micro {
  const v = batch.balance(contract);
  if (!Number.isSafeInteger(v)) throw new Error(`${SITE_BANKRUPTCY}: ${what} no es entero en µ (${v}): no portado`);
  return v;
}

/**
 * Quiebra de una empresa, `FirmBankruptcyFireSales.bankrupt` (XML 1883–1886 y 2177–2180; quita `haircutVal` = 0,5,
 * 1888–1890, el mismo bean que la oferta de crédito). Propuesta aprobada por Nico (2026-11-13; reglas-caiani.md,
 * sec. 19). Los pagos van al lote del evento; lo que JMAB hace con `setValue(0)` va a `after` (después del cierre):
 * 1. **Dos depósitos:** pasa todo el segundo al primero (`transfer`) y saca el segundo **solo de la lista del
 *    banco** (`delistFromIssuer`): la empresa lo conserva (en 0) hasta que lo suelta en el mercado de depósitos o lo
 *    vuelve a usar. Tiene efecto en JMAB (el oráculo lo muestra con saldo y fuera de la lista del banco durante
 *    trimestres): se reproduce (reglas-caiani.md, sec. 19).
 * 2. **Efectivo** al primer depósito.
 * 3. **Liquidez** = el primer depósito. Deuda = Σ saldos de los préstamos (en el orden de su lista).
 * 4. Si la deuda no es 0: **reparto** de la liquidez entre los préstamos en proporción a su saldo, por **restos
 *    mayores** con desempate por id del préstamo (ledger-contratos.md, sec. 2.1); si la liquidez alcanza, cada uno
 *    cobra su saldo. Cada parte baja el depósito y el préstamo (`repay`, con reservas si el prestamista es otro
 *    banco). **El depósito queda en 0** (`setValue(0)`): si la liquidez superaba la deuda, el excedente se borra
 *    con una quita explícita (`writeOff`: ganancia del banco, pérdida de la empresa; rareza de JMAB).
 * 5. Empresa de consumo: **aporte de los dueños**. D = min(quita × Σ valor de las añadas, pérdida de los bancos)
 *    va a `bailoutCost`; cada hogar (en el orden de la población), por cada préstamo, paga
 *    D × patrimonio del hogar / patrimonio total × pérdida del préstamo / pérdida total, con el patrimonio del
 *    hogar recalculado en cada pago y las pérdidas actualizadas después de cada uno (como JMAB). Va al lote como
 *    `bailout` (categoría `ownersBailout`, redondeo controlado). Lo que supere el saldo de un préstamo va como
 *    sobrepago (`bailoutExcess`). Si la pérdida total cruza 0 por el sobrepago, el aporte da negativo y el hogar
 *    cobra (`bailoutRefund`: el préstamo sube; decisión de Nico, 2026-11-13). Un depósito de hogar que quedaría
 *    negativo es un error explícito (JMAB no lo chequea; no pasa en los 400 trimestres de la corrida base).
 * 6. Lo que queda de cada préstamo se condona (`writeOff`) y suma a `currentNonPerformingLoans` del prestamista,
 *    menos el sobrepago (la pérdida negativa de JMAB).
 * Si la deuda es 0, JMAB no hace nada más (ni pone el depósito en 0).
 */
function firmBankruptcy(s: CaianiState, f: FirmState, batch: PaymentBatch, after: AfterSettle): void {
  const L = s.ledger;
  f.defaulted = true; // ConsumptionFirm/CapitalFirm.bankruptcy: antes de la estrategia
  const deposits = contractIds(L, f.id, 'assets', 'deposit');
  const deposit = deposits[0]!;
  if (deposits.length === 2) {
    const second = deposits[1]!;
    batch.pay(second, deposit, batch.balance(second), 'deposits');
    delistFromIssuer(L, second); // deposit2.getLiabilityHolder().removeItemStockMatrix(deposit2, …): solo el banco
  }
  const cash = contractIds(L, f.id, 'assets', 'cash')[0]!;
  if (batch.balance(cash) > 0) batch.pay(cash, deposit, batch.balance(cash), 'deposits');
  const liquidity = integerBalance(batch, deposit, `la liquidez de la empresa ${f.id}`);
  const loans = [...contractIds(L, f.id, 'liabilities', 'loan')];
  const debts = loans.map((id) => integerBalance(batch, id, `el préstamo ${id}`));
  let totalDebt = 0;
  for (const d of debts) totalDebt += d;
  if (totalDebt === 0) return;
  const coversDebt = ge(`${SITE_BANKRUPTCY} liquidez ≥ deuda`, liquidity, totalDebt, 'amount');
  /** Préstamos que recibieron aportes de los dueños (grupo del redondeo controlado: un redondeo). */
  const touched = loans.map(() => false);
  let paid: number[];
  if (coversDebt) {
    paid = debts;
    loans.forEach((loan, i) => batch.payLoan('repay', deposit, loan, paid[i]!));
  } else if (liquidity === 0) {
    paid = loans.map(() => 0);
  } else {
    // Camino (a) (decisión de Nico, 2026-11-14; reemplaza los restos mayores): cada préstamo, en el orden de la lista,
    // liquidez × saldo / deuda en `double` como JMAB, y el último lo que queda; el lote reparte exactamente la liquidez
    // (`paySplit`). Error de entrada (sec. 1): la parte i depende de la liquidez (las cuentas líquidas de la empresa) con
    // coeficiente deudaᵢ / deuda y de cada saldo j con liquidez × (δᵢⱼ / deuda − deudaᵢ / deuda²).
    const liquid = [...deposits, cash];
    paid = batch.paySplit(deposit, liquidity, debts, (i, amount) => {
      batch.payLoan('repay', deposit, loans[i]!, amount);
      // Con un solo préstamo la parte es la liquidez entera (traspaso entero: ya la lleva el `InputCarry`).
      if (inputsActive() && loans.length > 1) {
        const terms: InputTerm[] = liquid.map((contract) => ({ contract, coef: debts[i]! / totalDebt }));
        loans.forEach((contract, j) => terms.push({ contract, coef: liquidity * ((j === i ? 1 : 0) / totalDebt - debts[i]! / (totalDebt * totalDebt)) }));
        derivedPayment(deposit, loans[i]!, terms, 'repay');
      }
    });
  }
  // Excedente: solo si la liquidez cubre la deuda (enteros). Sin cubrirla, el reparto es exacto (`paySplit`).
  const surplus = coversDebt ? liquidity - totalDebt : 0;
  if (surplus > 0) after.push(() => writeDown(L, deposit, surplus));
  // Pérdidas de los bancos, en unidades de Caiani como en JMAB (banksLosses, totalBanksLoss).
  const losses = loans.map((_, i) => toUnits(debts[i]! - paid[i]!));
  /** Índices en el lote de los sobrepagos de cada préstamo (para la morosidad, con los montos ya redondeados). */
  const excess: number[][] = [];
  let totalLoss = 0;
  for (const x of losses) totalLoss += x;
  if (s.consumptionFirms.includes(f)) {
    let capitalValue = 0;
    for (const g of f.capitalGoods) capitalValue += goodValue(g, f.id) * s.rules.creditSupplyHaircut;
    const owners = gt(`${SITE_BANKRUPTCY} valor del capital > pérdida`, capitalValue, totalLoss, 'fromAmounts') ? totalLoss : capitalValue;
    f.bailoutCost = toMicro(owners);
    const wealth = (h: HouseholdState) => householdNetWealth(s, h, (id) => batch.balance(id));
    // Lo que todavía puede bajar cada préstamo con los aportes (µ). Por el orden de JMAB (el patrimonio del hogar y
    // las pérdidas se actualizan entre préstamo y préstamo), los aportes a un préstamo pueden superar su saldo: en
    // JMAB el préstamo queda negativo hasta el `setValue(0)` y la morosidad suma una pérdida negativa. El port lo
    // reproduce con un sobrepago explícito (decisión de Nico, 2026-11-13): el aporte cancela el préstamo hasta su
    // saldo y lo que sobra llega igual al prestamista (`bailoutExcess`).
    const room = loans.map((_, i) => debts[i]! - paid[i]!);
    for (const [i] of loans.entries()) excess[i] = [];
    let totalWealth = 0;
    for (const id of s.populations.households) totalWealth += wealth(householdById(s, id));
    const initialLosses = losses.map((x) => x);
    const initialTotalLoss = totalLoss;
    // Error de entrada de los aportes (regla de la sec. 1 de reglas-caiani.md, aplicada a los aportes de los dueños por
    // decisión de Nico, 2026-11-14). Cada aporte es a = D × w / W × l_i / Λ: a primer orden, su error relativo es el
    // del patrimonio del hogar (w: sus contratos), menos el del total (W: los de todos los hogares), más el de la
    // pérdida del préstamo (l_i = deuda_i − parte de la liquidez, con la parte ≈ liquidez × deuda_i / deuda), menos el
    // de la pérdida total (Λ = deuda − liquidez), y si D es toda la pérdida (D = Λ) se cancela con este último. Los
    // coeficientes van por unidad de aporte (grupo con coeficiente a); se usan los valores al empezar el reparto.
    let own: ((h: HouseholdState) => InputTerm[]) | null = null;
    let allHouseholds: InputTerm[] = [];
    let perLoan: InputTerm[][] = [];
    if (inputsActive()) {
      const contractsOf = (id: AgentId): InputTerm[] => {
        const a = agentOf(L, id);
        const t: InputTerm[] = [];
        for (const list of a.assets) for (const c of list) t.push({ contract: c, coef: 1 });
        for (const list of a.liabilities) for (const c of list) t.push({ contract: c, coef: -1 });
        return t;
      };
      own = (h) => contractsOf(h.id);
      allHouseholds = s.populations.households.flatMap((id) => contractsOf(id));
      const liquidityContracts = [...deposits, cash];
      const kappa = owners === totalLoss ? 0 : -1 / initialTotalLoss;
      const liq = toUnits(liquidity);
      const debt = toUnits(totalDebt);
      perLoan = loans.map((_, i) => {
        const li = initialLosses[i]!;
        if (li === 0) return [];
        const di = toUnits(debts[i]!);
        const t: InputTerm[] = loans.map((loan, j) => ({
          contract: loan,
          coef: ((j === i ? 1 - liq / debt : 0) + (liq * di) / (debt * debt)) / li + kappa,
        }));
        // La liquidez entra solo si se reparte acá: en la quiebra por salarios ya se repartió entre los empleados (queda
        // en 0) y su δ se fue con esas cuotas.
        if (liquidity > 0) for (const c of liquidityContracts) t.push({ contract: c, coef: -di / debt / li - kappa });
        return t;
      });
    }
    for (const id of s.populations.households) {
      const h = householdById(s, id);
      const target = firstAsset(L, h.id, 'deposit');
      if (!target) throw new Error(`hogar ${h.id} sin depósito (JMAB: NullPointerException)`);
      loans.forEach((loan, i) => {
        const amount = (((owners * wealth(h)) / totalWealth) * losses[i]!) / totalLoss;
        if (!Number.isFinite(amount)) throw new Error(`${SITE_BANKRUPTCY}: aporte ${amount} del hogar ${h.id} (pérdida total 0: no portado)`);
        // El signo del aporte es el de pérdida del préstamo / pérdida total (el patrimonio de los hogares es > 0).
        // Las dos bajan con cada aporte y, por el sobrepago, pueden cruzar el 0 (rareza de JMAB, caiani-referencia.md):
        // la decisión se mide con la más cercana a 0, relativa a su valor al empezar el reparto.
        const dLoss = Math.abs(losses[i]!) / initialLosses[i]!;
        const dTotal = Math.abs(totalLoss) / initialTotalLoss;
        const refund = record(
          `${SITE_BANKRUPTCY} aporte negativo`,
          amount < 0,
          dLoss <= dTotal ? losses[i]! : totalLoss,
          0,
          'fromAmounts',
          dLoss <= dTotal ? initialLosses[i]! : initialTotalLoss,
        );
        if (refund) {
          // Aporte negativo (decisión de Nico, 2026-11-13): el hogar cobra y el préstamo sube (`bailoutRefund`).
          // JMAB: `depositHH.setValue(dep − amountToPay)` y `loan.setValue(loan − amountToPay)` con amountToPay < 0,
          // y las reservas al revés.
          const micro = -amount * MICRO_PER_UNIT;
          batch.refundBailout(loan, target.id, micro);
          touched[i] = true;
          room[i] = room[i]! + micro;
          losses[i] = losses[i]! - amount;
          totalLoss -= amount;
          return;
        }
        const micro = amount * MICRO_PER_UNIT;
        if (batch.balance(target.id) < micro) {
          throw new Error(`${SITE_BANKRUPTCY}: el depósito del hogar ${h.id} quedaría negativo (JMAB no lo chequea; no portado, reglas-caiani.md, sec. 19)`);
        }
        // No se registra como decisión: el reparto entre el préstamo y el sobrepago es continuo (part + sobrepago =
        // aporte), así que un vuelco no cambia nada más allá de la diferencia que lo provoca.
        const part = micro <= room[i]! ? micro : room[i]!;
        batch.payLoan('bailout', target.id, loan, part);
        if (own) {
          const w = wealth(h);
          derivedPayment(
            target.id,
            loan,
            [
              { group: own(h), coef: amount / w },
              { group: allHouseholds, coef: -amount / totalWealth },
              { group: perLoan[i]!, coef: amount },
            ],
            'bailout',
          );
        }
        touched[i] = true;
        room[i] = room[i]! - part;
        if (micro > part) excess[i]!.push(batch.payLoan('bailoutExcess', target.id, loan, micro - part));
        losses[i] = losses[i]! - amount;
        totalLoss -= amount;
      });
    }
  }
  after.push(() => {
    loans.forEach((loan, i) => {
      const c = contractOf(L, loan);
      const rest = c.amount;
      writeDown(L, loan, rest);
      // banksLosses[i] de JMAB: lo que queda del préstamo, menos lo que los hogares pagaron de más (sobrepago).
      let over = 0;
      for (const k of excess[i] ?? []) over += batch.settledAmount(k);
      bankById(s, c.holder).currentNonPerformingLoans += rest - over;
      // Agregado derivado (reglas-caiani.md, sec. 1): la pérdida del préstamo sale de su parte de la liquidez
      // (restos mayores), de lo que bajó con los aportes (grupo del lote) y del sobrepago (otro grupo), y de los
      // saldos de entrada del préstamo y del depósito de la empresa.
      const npl = 'currentNonPerformingLoans';
      // La parte de la liquidez y los aportes van al mismo grupo del lote (el préstamo): un redondeo.
      derivedRounded(c.holder, npl, ((!coversDebt && liquidity > 0) || touched[i] ? 1 : 0) + ((excess[i] ?? []).length > 0 ? 1 : 0));
      derivedInput(c.holder, npl, loan);
      derivedInput(c.holder, npl, deposit);
    });
  });
}

/**
 * `payInterests` de la empresa (`ConsumptionFirm` 634–673, `CapitalFirm` 303–348; iguales salvo que la de capital
 * vuelve a poner `defaulted` = true después de la quiebra):
 * 1. `computeDebtPayments`: `debtBurden` y `debtInterests` con `installments` (la misma función y la misma lista
 *    que el evento 9);
 * 2. si tiene **exactamente dos** depósitos, pasa todo el segundo al primero (`transfer`: pago entre bancos);
 * 3. si tiene efectivo > 0, lo pasa al primer depósito (el efectivo del banco sube en espejo);
 * 4. si el primer depósito ≥ `debtBurden`: paga cada préstamo en el orden de su lista, interés y capital desde
 *    el depósito (con reservas si el prestamista es otro banco; el préstamo baja en el capital). Los montos son
 *    los de JMAB en `double` (`rawInstallments`: tasa × saldo, A/L − c o el saldo en la última cuota) y van al
 *    lote del evento: redondeo controlado al cerrarlo (decisión de Nico, 2026-11-13). La cuota pagada de un
 *    préstamo puede diferir en 1 µ de la de `installments`; el total de la empresa, en < 1 µ;
 * 5. si no, quiebra (`firmBankruptcy`).
 */
function payLoanInterests(s: CaianiState, f: FirmState, batch: PaymentBatch, after: AfterSettle): void {
  const L = s.ledger;
  let burden = 0;
  let interests = 0;
  for (const due of installments(L, f.id, 'loan')) {
    burden += due.interest + due.principal;
    interests += due.interest;
  }
  f.debtBurden = burden;
  f.debtInterests = interests;
  const deposits = contractIds(L, f.id, 'assets', 'deposit');
  const deposit = deposits[0];
  if (deposit === undefined) throw new Error(`empresa ${f.id} sin depósito (JMAB: IndexOutOfBoundsException)`);
  if (deposits.length === 2) batch.pay(deposits[1]!, deposit, batch.balance(deposits[1]!), 'deposits');
  const cash = contractIds(L, f.id, 'assets', 'cash')[0];
  if (cash === undefined) throw new Error(`empresa ${f.id} sin efectivo (JMAB: IndexOutOfBoundsException)`);
  if (batch.balance(cash) > 0) batch.pay(cash, deposit, batch.balance(cash), 'deposits');
  const liquidity = batch.balance(deposit);
  if (ge(`${SITE_PAY_INTERESTS} liquidez ≥ servicio`, liquidity, burden, 'amount')) {
    const raw = rawInstallments(L, f.id, 'loan');
    contractIds(L, f.id, 'liabilities', 'loan').forEach((loan, i) => {
      const due = raw[i]!;
      const c = contractOf(L, loan);
      batch.payLoan('interest', deposit, loan, due.interest);
      const principal = Math.min(due.principal, c.amount);
      batch.payLoan('repay', deposit, loan, principal);
      // Error de entrada (regla de la sec. 1, aplicada al evento 20 por decisión de Nico, 2026-11-14): el interés es
      // tasa × saldo (en µ); el capital, monto inicial (en µ) / plazo, salvo la última cuota o el tope en el saldo,
      // que pagan el saldo entero (su δ ya lo lleva el `InputCarry` como traspaso entero).
      if (due.interest > 0) derivedPayment(deposit, loan, [{ contract: loan, coef: c.rate }], 'interest');
      if (principal > 0 && principal !== c.amount && c.amortization === 'fixedCapital' && c.length) {
        derivedPayment(deposit, loan, [{ contract: loan, field: 'initialAmount', coef: 1 / c.length }], 'repay');
      }
    });
  } else {
    firmBankruptcy(s, f, batch, after);
  }
}

/**
 * Evento 20, `creditInterestsTic` (TIC_CREDINTERESTS): solo las empresas, en orden de creación (consumo, después
 * capital): `CopyOfConsumptionFirm2WagesEnd.onTicArrived` 88–89 y `CopyOfCapitalFirm2WagesEnd` 87–88 →
 * `payInterests`. Sin sorteos. La matriz `debtPayments` de JMAB es de trabajo y no se porta. Los pagos van a un
 * lote (`PaymentBatch`) que se cierra al final con redondeo controlado; después, lo que las quiebras dejan en 0.
 */
export function creditInterestsEvent(s: CaianiState): SettleReport {
  const batch = new PaymentBatch(s.ledger);
  const after: AfterSettle = [];
  for (const f of [...s.consumptionFirms, ...s.capitalFirms]) payLoanInterests(s, f, batch, after);
  const report = batch.settle();
  for (const fn of after) fn();
  return report;
}

// ---------------------------------------------------------------------------------------------
// Evento 21: pago de salarios y del seguro de desempleo
// ---------------------------------------------------------------------------------------------

export const SITE_PAY_WAGES_CONSUMPTION = 'CopyOfConsumptionFirm2WagesEnd.payWages';
export const SITE_PAY_WAGES_CAPITAL = 'CopyOfCapitalFirm2WagesEnd.payWages';
export const SITE_PAY_WAGES_GOVERNMENT = 'Government.payWages';

/**
 * `payWages` de la empresa (`CopyOfConsumptionFirm2WagesEnd` 105–155, `CopyOfCapitalFirm2WagesEnd` 106–155, iguales),
 * si tiene empleados:
 * 1. junta los dos depósitos y el efectivo en el primero, como en el evento 20 (al lote, saldos enteros);
 * 2. masa salarial W = Σ salarios de los empleados (`getWageBill`, en el orden de la lista);
 * 3. si W > depósito (descuento = depósito / W < `minWageDiscount` = 1): mezcla los empleados
 *    (`Collections.shuffle`), les reparte el depósito en partes iguales (JMAB: W × descuento / n a cada uno) y lo pone
 *    en 0; después **quiebra** (`firmBankruptcy`, con liquidez 0). El reparto es por **restos mayores** con desempate
 *    por id del hogar (ledger-contratos.md, sec. 2.1: reparto proporcional de la liquidez de una empresa quebrada): la
 *    suma es exactamente el depósito y queda en 0, como el `setValue(0)` de JMAB;
 * 4. si no: mezcla los empleados y le paga a cada uno su salario **solo si salario < depósito** (estricto, con el
 *    depósito que va bajando; el que no cobra no se despide). Los pagos van al lote en `double` (redondeo controlado).
 */
function payFirmWages(s: CaianiState, f: FirmState, site: string, batch: PaymentBatch, after: AfterSettle, rng: CaianiRng): void {
  if (f.employees.length === 0) return;
  const L = s.ledger;
  const deposits = contractIds(L, f.id, 'assets', 'deposit');
  const deposit = deposits[0];
  if (deposit === undefined) throw new Error(`empresa ${f.id} sin depósito (JMAB: IndexOutOfBoundsException)`);
  if (deposits.length === 2) batch.pay(deposits[1]!, deposit, batch.balance(deposits[1]!), 'deposits');
  const cash = contractIds(L, f.id, 'assets', 'cash')[0];
  if (cash === undefined) throw new Error(`empresa ${f.id} sin efectivo (JMAB: IndexOutOfBoundsException)`);
  if (batch.balance(cash) > 0) batch.pay(cash, deposit, batch.balance(cash), 'deposits');
  let wageBill = 0;
  for (const id of f.employees) wageBill += householdById(s, id).wage;
  const payable = (worker: AgentId) => {
    const d = firstAsset(L, worker, 'deposit');
    if (!d) throw new Error(`hogar ${worker} sin depósito (JMAB: NullPointerException)`);
    return d.id;
  };
  if (gt(`${site} masa salarial > depósito`, wageBill * MICRO_PER_UNIT, batch.balance(deposit), 'amount')) {
    rng.shuffleEmployees(site, f.id, f.employees, ownId);
    const liquidity = integerBalance(batch, deposit, `el depósito de la empresa ${f.id}`);
    // Camino (a) (decisión de Nico, 2026-11-14; reemplaza los restos mayores del 2026-11-13): a cada empleado, en el
    // orden de la mezcla, depósito / n en `double` como JMAB, y al último lo que queda; el lote reparte exactamente el
    // depósito en µ (`paySplit`, garantía en reglas-caiani.md, sec. 1). Error de entrada (sec. 1): cada cuota sale de
    // las cuentas líquidas de la empresa (los dos depósitos y el efectivo, que pasaron enteras al primero) con
    // coeficiente 1/n.
    if (liquidity > 0) {
      const n = f.employees.length;
      // Con un solo empleado la cuota es el depósito entero: su δ ya lo lleva el `InputCarry` como traspaso entero (no
      // se anota dos veces).
      const liquid: InputTerm[] = inputsActive() && n > 1 ? [...deposits, cash].map((contract) => ({ contract, coef: 1 / n })) : [];
      batch.paySplit(deposit, liquidity, f.employees.map(() => 1), (i, amount) => {
        const to = payable(f.employees[i]!);
        batch.pay(deposit, to, amount, 'wages');
        derivedPayment(deposit, to, liquid);
      });
    }
    firmBankruptcy(s, f, batch, after);
  } else {
    rng.shuffleEmployees(site, f.id, f.employees, ownId);
    for (const worker of f.employees) {
      const wage = householdById(s, worker).wage * MICRO_PER_UNIT;
      if (lt(`${site} salario < depósito`, wage, batch.balance(deposit), 'amount')) batch.pay(deposit, payable(worker), wage, 'wages');
    }
  }
}

/**
 * Gobierno (`GovernmentAntiCyclical.onTicArrived`, TIC_WAGEPAYMENT, 89–92):
 * - `payWages` (169–174 → `Government.payWages` 283–296), si tiene empleados: mezcla los empleados y le paga a cada uno
 *   su salario desde su cuenta en el BC, **sin mirar el saldo** (la cuenta puede quedar negativa: es como el gobierno
 *   registra el déficit); `wageBill` = Σ salarios;
 * - `payUnemploymentBenefits` (112–140): salario medio de los ocupados (en el orden de la población) × 0,4 a cada
 *   desocupado, en el orden de la población; `doleExpenditure` = Σ.
 * Los dos totales se guardan en µ (`toMicro` de la suma en `double`, como los de las empresas en el evento 9).
 */
function payGovernmentWagesAndDole(s: CaianiState, batch: PaymentBatch, rng: CaianiRng): void {
  const L = s.ledger;
  const g = s.government;
  const account = contractIds(L, g.id, 'assets', 'reserves')[0];
  if (account === undefined) throw new Error('gobierno sin cuenta en el BC');
  const payable = (worker: AgentId) => {
    const d = firstAsset(L, worker, 'deposit');
    if (!d) throw new Error(`hogar ${worker} sin depósito (JMAB: NullPointerException)`);
    return d.id;
  };
  if (g.employees.length > 0) {
    rng.shuffleEmployees(SITE_PAY_WAGES_GOVERNMENT, g.id, g.employees, ownId);
    let wages = 0;
    for (const worker of g.employees) {
      const wage = householdById(s, worker).wage;
      batch.pay(account, payable(worker), wage * MICRO_PER_UNIT, 'wages');
      wages += wage;
    }
    g.wageBill = toMicro(wages);
  }
  const benefit = averageEmployedWage(s) * s.rules.unemploymentBenefit;
  let dole = 0;
  for (const id of s.populations.households) {
    const h = householdById(s, id);
    if (h.employer !== null) continue;
    batch.pay(account, payable(h.id), benefit * MICRO_PER_UNIT, 'unemploymentBenefits');
    dole += benefit;
  }
  g.doleExpenditure = toMicro(dole);
}

/**
 * Evento 21, `payWageTic` (TIC_WAGEPAYMENT): en orden de creación, las empresas de consumo, las de capital y el
 * gobierno. Los pagos van a un lote (`PaymentBatch`) que se cierra al final con redondeo controlado; después, lo que
 * las quiebras dejan en 0 (como en el evento 20).
 */
export function wagePaymentEvent(s: CaianiState, rng: CaianiRng): SettleReport {
  const batch = new PaymentBatch(s.ledger);
  const after: AfterSettle = [];
  for (const f of s.consumptionFirms) payFirmWages(s, f, SITE_PAY_WAGES_CONSUMPTION, batch, after, rng);
  for (const f of s.capitalFirms) payFirmWages(s, f, SITE_PAY_WAGES_CAPITAL, batch, after, rng);
  payGovernmentWagesAndDole(s, batch, rng);
  const report = batch.settle();
  for (const fn of after) fn();
  return report;
}

// ---------------------------------------------------------------------------------------------
// Evento 22: intereses y rescate de los bonos
// ---------------------------------------------------------------------------------------------

/**
 * Evento 22, `bondInterestTic` (TIC_BONDINTERESTS): solo el gobierno (`GovernmentAntiCyclical.onTicArrived` 81–83
 * → `Government.payInterests`, 204–236). Sin sorteos. Por cada bono de la lista de pasivos del gobierno, en orden:
 * - si el gobierno se lo tiene a sí mismo (emisión sin vender): `setQuantity(0)`. En el port la emisión sin vender
 *   no es un contrato (ledger-contratos.md, sec. 2.2): no hay nada que hacer;
 * - si no, el tenedor (banco o BC) cobra interés = `getValue()` × tasa, con `getValue()` = cantidad × precio
 *   (`Bond`), y `setBondInterestsReceived` lo **asigna** (con más de un bono, queda el del último);
 * - si edad = vencimiento, cobra además el valor y el bono queda en cantidad 0 (`setQuantity(0)`; JMAB lo saca en
 *   `cleanSM`, eventos 74–75);
 * - todo sale de la cuenta del gobierno en el BC: a un banco, sube sus reservas; al BC, baja su pasivo (la cuenta
 *   del gobierno) y nada más;
 * - `totInterestsBonds` = Σ intereses (`double`, en el orden de la lista).
 * Pagos: interés y rescate al lote (`interest` y `repay` con un bono: categorías `bondInterest` y `bonds`), con
 * redondeo controlado. El rescate paga el saldo entero del bono (cantidad × precio en µ), así que lo deja en 0.
 */
export function bondInterestEvent(s: CaianiState): SettleReport {
  const L = s.ledger;
  const g = s.government;
  const account = contractIds(L, g.id, 'assets', 'reserves')[0];
  if (account === undefined) throw new Error('gobierno sin cuenta en el BC');
  const batch = new PaymentBatch(L);
  const redeemed: number[] = [];
  let total = 0;
  for (const id of contractIds(L, g.id, 'liabilities', 'bond')) {
    const b = contractOf(L, id);
    if (b.holder === g.id) throw new Error(`bono ${id} del gobierno consigo mismo: la emisión sin vender no es un contrato`);
    const value = (b.quantity as number) * (b.price as number); // Bond.getValue()
    const interest = value * b.rate;
    if (b.holder === s.centralBank.id) s.centralBank.bondInterestsReceived = toMicro(interest);
    else bankById(s, b.holder).bondInterestReceived = toMicro(interest);
    total += interest;
    batch.payLoan('interest', account, id, interest * MICRO_PER_UNIT);
    if (b.age === b.maturity) {
      batch.payLoan('repay', account, id, b.amount);
      redeemed.push(id);
    }
  }
  g.totInterestsBonds = toMicro(total);
  const report = batch.settle();
  for (const id of redeemed) contractOf(L, id).quantity = 0;
  return report;
}

// ---------------------------------------------------------------------------------------------
// Evento 23: servicio de los adelantos del BC
// ---------------------------------------------------------------------------------------------

/**
 * Evento 23, `advInterestTic` (TIC_ADVINTERESTS): los bancos, en orden de creación (`Bank.onTicArrived` 206–208 →
 * `Bank.payInterests`, 299–330). Sin sorteos. `advancesInterests` = 0 y, por cada adelanto de la lista de pasivos
 * del banco con edad > 0, en orden:
 * - interés = tasa × saldo; capital según la amortización: `ONLY_INTERESTS` (la de los adelantos, XML), el monto
 *   inicial cuando edad = plazo; `FIXED_CAPITAL`, monto inicial / plazo; `FIXED_AMOUNT` usa `Math.pow` y no está
 *   portado (no se usa en el base: `stateFromDump` y la inicialización no lo admiten);
 * - `advancesInterests` += interés; las reservas del banco bajan interés + capital (el BC cobra bajando su pasivo)
 *   y el adelanto baja el capital. JMAB no mira el saldo de las reservas (pueden quedar negativas, como en JMAB).
 * Los montos son los de `rawInstallments` (las mismas reglas que el evento 20: con "solo intereses" el capital es
 * el saldo, que en un adelanto es el monto inicial; ledger-contratos.md, sec. 4) y van al lote (`interest` y
 * `repay` con un adelanto: categorías `advanceInterest` y `advances`), con redondeo controlado.
 */
export function advanceInterestEvent(s: CaianiState): SettleReport {
  const L = s.ledger;
  const batch = new PaymentBatch(L);
  for (const b of s.banks) {
    const reserves = contractIds(L, b.id, 'assets', 'reserves')[0];
    if (reserves === undefined) throw new Error(`banco ${b.id} sin reservas`);
    const advances = contractIds(L, b.id, 'liabilities', 'advance');
    const raw = rawInstallments(L, b.id, 'advance');
    let interests = 0;
    advances.forEach((id, i) => {
      const a = contractOf(L, id);
      if (a.age <= 0) return;
      const due = raw[i]!;
      interests += due.interest / MICRO_PER_UNIT; // JMAB: iRate × loan.getValue(), en double
      batch.payLoan('interest', reserves, id, due.interest);
      batch.payLoan('repay', reserves, id, Math.min(due.principal, a.amount));
    });
    b.advancesInterests = toMicro(interests);
  }
  return batch.settle();
}

// ---------------------------------------------------------------------------------------------
// Evento 24: impuestos
// ---------------------------------------------------------------------------------------------

export const SITE_FIRM_TAXES = 'ProfitsWealthTaxStrategy.computeTaxes';

/** Suma de los valores de una lista de bienes de capital de edad ≥ 0: Σ cantidad × precio / amortización. */
function capitalAmortization(f: FirmState): number {
  let a = 0;
  for (const g of f.capitalGoods) if (g.age >= 0) a += (g.quantity * g.price) / g.amortization;
  return a;
}

/**
 * `ConsumptionFirm.updatePreTaxProfits` (589–622) y `CapitalFirm.updatePreTaxProfits` (654–682): rezagos del período
 * (inventario real y nominal, ventas reales y nominales, amortización del capital solo en consumo, ganancia antes de
 * impuestos) y observaciones de las expectativas de ventas nominales, reales y del salario medio. La empresa de
 * capital pasa el inventario (actual y del período anterior) y la producción por `(int)`, como JMAB. Devuelve la
 * ganancia antes de impuestos.
 * - ventas reales = producción − inventario + inventario anterior; ventas nominales = ventas reales × precio del inventario;
 * - salario medio = masa salarial / empleados (en el orden de la lista), o la expectativa del salario sin empleados;
 * - ganancia = ventas − masa salarial − intereses de la deuda (evento 20) [− amortización] + intereses cobrados
 *   (evento 8) + inventario nominal − inventario nominal anterior.
 */
function firmPreTaxProfits(s: CaianiState, f: FirmState, isConsumption: boolean): number {
  const t = s.round;
  const lInvRaw = getLag(f.lags, LAG.INVENTORIES, t, 1);
  const lNomInv = getLag(f.lags, LAG.NOMINALINVENTORIES, t, 1);
  const stock = isConsumption ? f.consumptionGoods[0] : f.capitalGoods[0];
  if (!stock) throw new Error(`empresa ${f.id} sin inventario (JMAB: NullPointerException)`);
  const inv = isConsumption ? stock.quantity : javaInt(stock.quantity);
  const lInv = isConsumption ? lInvRaw : javaInt(lInvRaw);
  const nomInv = goodValue(stock, f.id);
  setLag(f.lags, LAG.INVENTORIES, t, inv);
  setLag(f.lags, LAG.NOMINALINVENTORIES, t, nomInv);
  const productionRaw = getLag(f.lags, LAG.PRODUCTION, t, 0);
  const production = isConsumption ? productionRaw : javaInt(productionRaw);
  const realSales = production - inv + lInv;
  const sales = realSales * stock.price; // getPrice(): el precio del inventario
  addObservation(f.expectations[EXPECTATION.NOMINALSALES]!, sales);
  addObservation(f.expectations[EXPECTATION.REALSALES]!, realSales);
  setLag(f.lags, LAG.REALSALES, t, realSales);
  setLag(f.lags, LAG.NOMINALSALES, t, sales);
  const wages = wageBill(s, f);
  const wagesExp = f.expectations[EXPECTATION.WAGES]!;
  addObservation(wagesExp, f.employees.length > 0 ? wages / f.employees.length : wagesExp.expectation);
  let profits: number;
  if (isConsumption) {
    const amortization = capitalAmortization(f);
    setLag(f.lags, LAG.CAPITALAMORTIZATION, t, amortization);
    profits = sales - wages - toUnits(f.debtInterests) - amortization + toUnits(f.interestReceived) + nomInv - lNomInv;
  } else {
    profits = sales - wages - toUnits(f.debtInterests) + toUnits(f.interestReceived) + nomInv - lNomInv;
  }
  setLag(f.lags, LAG.PROFITPRETAX, t, profits);
  derivedValue(f.id, `lag:${LAG.PROFITPRETAX}:${t}`, firmProfitTerms(f));
  return profits;
}

/** Entradas en µ de la ganancia antes de impuestos (`derived.ts`): − intereses de la deuda + intereses cobrados. */
function firmProfitTerms(f: FirmState): InputTerm[] {
  if (!inputsActive()) return [];
  return [
    { agent: f.id, field: 'debtInterests', coef: -1 },
    { agent: f.id, field: 'interestReceived', coef: 1 },
  ];
}

/**
 * `ConsumptionFirm.updateAfterTaxProfits` (563–583) y `CapitalFirm.updateAfterTaxProfits` (637–650): ganancia después
 * de impuestos = ganancia antes − impuestos; flujo de caja operativo = ganancia después [+ amortización del capital,
 * solo consumo] − variación del inventario nominal − capital de las cuotas del tick. El capital de las cuotas es el
 * de la matriz `debtPayments` de JMAB (la del evento 20); el port lo toma como `debtBurden − debtInterests`, que el
 * evento 20 calcula con las mismas cuotas (`installments`).
 */
function firmAfterTaxProfits(s: CaianiState, f: FirmState, taxes: number, taxTerms: readonly InputTerm[], isConsumption: boolean): void {
  const t = s.round;
  const profitsAfterTaxes = getLag(f.lags, LAG.PROFITPRETAX, t, 0) - taxes;
  setLag(f.lags, LAG.PROFITAFTERTAX, t, profitsAfterTaxes);
  const varInv = getLag(f.lags, LAG.NOMINALINVENTORIES, t, 0) - getLag(f.lags, LAG.NOMINALINVENTORIES, t, 1);
  const principal = toUnits(f.debtBurden - f.debtInterests);
  const ocf = isConsumption ? profitsAfterTaxes + capitalAmortization(f) - varInv - principal : profitsAfterTaxes - varInv - principal;
  setLag(f.lags, LAG.OPERATINGCASHFLOW, t, ocf);
  if (inputsActive()) {
    const pat = [...firmProfitTerms(f), ...scaleTerms(taxTerms, -1)];
    derivedValue(f.id, `lag:${LAG.PROFITAFTERTAX}:${t}`, pat);
    derivedValue(f.id, `lag:${LAG.OPERATINGCASHFLOW}:${t}`, [
      ...pat,
      { agent: f.id, field: 'debtBurden', coef: -1 },
      { agent: f.id, field: 'debtInterests', coef: 1 },
    ]);
  }
}

/**
 * `ConsumptionFirm.payTaxes` (523–556) y `CapitalFirm.payTaxes` (597–632), iguales salvo las ganancias:
 * 1. `updatePreTaxProfits`;
 * 2. impuestos (`ProfitsWealthTaxStrategy.computeTaxes`, XML 1872–1877 y 2170–2175): 0 si la empresa quebró en el
 *    tick (`defaulted`); si no, T = alícuota del patrimonio × patrimonio + 0,18 × ganancia; **0 si T > el primer
 *    depósito**; si no, max(T, 0). Con la alícuota del patrimonio en 0 (el XML), el patrimonio no entra;
 * 3. `updateAfterTaxProfits`;
 * 4. si impuestos > efectivo + depósito, quiebra: **no puede pasar** (los impuestos no superan el depósito y el
 *    efectivo no es negativo), así que el port lo verifica en vez de portarlo;
 * 5. `LAG_TAXES` = impuestos, y el depósito los paga a la cuenta del gobierno en el BC (las reservas de su banco
 *    bajan lo mismo). La rama "depósito < impuestos" (pasa el efectivo al depósito) tampoco puede pasar, por 2.
 * El pago va al lote (categoría `taxes`).
 */
function payFirmTaxes(s: CaianiState, f: FirmState, isConsumption: boolean, account: number, batch: PaymentBatch): void {
  const L = s.ledger;
  const profits = firmPreTaxProfits(s, f, isConsumption);
  const deposit = contractIds(L, f.id, 'assets', 'deposit')[0];
  if (deposit === undefined) throw new Error(`empresa ${f.id} sin depósito (JMAB: NullPointerException)`);
  let taxes = 0;
  let taxTerms: InputTerm[] = [];
  if (!f.defaulted) {
    if (s.rules.firmWealthTaxRate !== 0) throw new Error(`${SITE_FIRM_TAXES}: alícuota del patrimonio de las empresas ≠ 0: no portado`);
    const due = s.rules.profitTaxRate * profits;
    taxes = gt(`${SITE_FIRM_TAXES} impuestos > depósito`, due * MICRO_PER_UNIT, batch.balance(deposit), 'amount', undefined, f.id) ? 0 : Math.max(due, 0);
    if (taxes > 0) taxTerms = scaleTerms(firmProfitTerms(f), s.rules.profitTaxRate);
  }
  firmAfterTaxProfits(s, f, taxes, taxTerms, isConsumption);
  const cash = contractIds(L, f.id, 'assets', 'cash')[0];
  const liquidity = (cash === undefined ? 0 : batch.balance(cash)) + batch.balance(deposit);
  if (taxes * MICRO_PER_UNIT > liquidity || taxes * MICRO_PER_UNIT > batch.balance(deposit)) {
    throw new Error(`empresa ${f.id}: impuestos mayores que el depósito (inalcanzable en JMAB)`);
  }
  setLag(f.lags, LAG.TAXES, s.round, taxes);
  derivedValue(f.id, `lag:${LAG.TAXES}:${s.round}`, taxTerms);
  if (taxes > 0) {
    batch.pay(deposit, account, taxes * MICRO_PER_UNIT, 'taxes');
    derivedPayment(deposit, account, taxTerms);
  }
}

/**
 * `Bank.payTaxes` (112–128): ganancia antes de impuestos = patrimonio (`getNetWealth`, con los pagos ya hechos en el
 * evento) − `LAG_NETWEALTH` del período anterior → `LAG_PROFITPRETAX`; impuestos = 0 si quebró, si no
 * max(alícuota del patrimonio × patrimonio + 0,18 × ganancia, 0) (`ProfitsWealthTaxStrategy`, XML 2591–2596; sin el
 * tope del depósito de las empresas) → `LAG_TAXES`; las reservas pagan a la cuenta del gobierno (las dos en el BC),
 * sin mirar el saldo. El patrimonio sigue las listas del banco (un depósito fuera de la lista no cuenta, como en JMAB)
 * con los pagos pendientes del lote.
 */
function payBankTaxes(s: CaianiState, b: BankState, account: number, batch: PaymentBatch): void {
  const L = s.ledger;
  // Los pagos anteriores del evento que tocan al banco (impuestos de sus depositantes) bajan a la vez reservas y
  // depósitos y no cambian su patrimonio.
  const { nw, terms: nwTerms } = bankNetWealth(s, b, batch);
  const profits = nw - getLag(b.lags, LAG.NETWEALTH, s.round, 1);
  setLag(b.lags, LAG.PROFITPRETAX, s.round, profits);
  derivedValue(b.id, `lag:${LAG.PROFITPRETAX}:${s.round}`, nwTerms);
  const taxes = b.defaulted ? 0 : Math.max(s.rules.bankWealthTaxRate * nw + s.rules.profitTaxRate * profits, 0);
  const taxTerms = taxes > 0 ? scaleTerms(nwTerms, s.rules.bankWealthTaxRate + s.rules.profitTaxRate) : [];
  setLag(b.lags, LAG.TAXES, s.round, taxes);
  derivedValue(b.id, `lag:${LAG.TAXES}:${s.round}`, taxTerms);
  const reserves = contractIds(L, b.id, 'assets', 'reserves')[0];
  if (reserves === undefined) throw new Error(`banco ${b.id} sin reservas`);
  if (taxes > 0) {
    batch.pay(reserves, account, taxes * MICRO_PER_UNIT, 'taxes');
    derivedPayment(reserves, account, taxTerms);
  }
}

/**
 * `getNetWealth` del banco (`SimpleAbstractAgent.getNumericBalanceSheet`): activos − pasivos de sus listas (un depósito
 * fuera de la lista no cuenta, como en JMAB), con los pagos pendientes del lote; en unidades. `terms`: sus entradas
 * para el V3 (cada contrato, ± 1; `derived.ts`), vacías sin registrador.
 */
function bankNetWealth(s: CaianiState, b: BankState, batch: PaymentBatch): { nw: number; terms: InputTerm[] } {
  const a = agentOf(s.ledger, b.id);
  let nw = 0;
  const terms: InputTerm[] = [];
  for (const list of a.assets)
    for (const id of list) {
      nw += batch.balance(id);
      if (inputsActive()) terms.push({ contract: id, coef: 1 });
    }
  for (const list of a.liabilities)
    for (const id of list) {
      nw -= batch.balance(id);
      if (inputsActive()) terms.push({ contract: id, coef: -1 });
    }
  return { nw: nw / MICRO_PER_UNIT, terms };
}

/**
 * `Households.payTaxes` (309–331): impuestos = max(alícuota del patrimonio × patrimonio + 0,18 × ingreso bruto, 0)
 * (`IncomeWealthTaxStrategy`, el mismo cálculo del evento 17), con tope en efectivo + depósito; `LAG_TAXES`; el depósito
 * paga a la cuenta del gobierno (las reservas de su banco bajan lo mismo); `LAG_NETWEALTH` = patrimonio después del pago;
 * `dividendsReceived` = 0. El monto con tope se lleva en µ (el tope es el saldo, entero).
 * **Rama no portada:** si el depósito no alcanza (solo puede pasar con efectivo > 0), JMAB pasa efectivo al depósito y
 * lo deja negativo (`deposit.setValue(depValue − taxes)` con el valor viejo; ledger-contratos.md, sec. 4, "Para P3").
 * Nadie tiene efectivo en la corrida base: error explícito (propuesta pendiente de aprobación).
 */
function payHouseholdTaxes(s: CaianiState, h: HouseholdState, account: number, batch: PaymentBatch): void {
  const L = s.ledger;
  const taxes = householdTaxes(s, h);
  const deposit = contractIds(L, h.id, 'assets', 'deposit')[0];
  if (deposit === undefined) throw new Error(`hogar ${h.id} sin depósito (JMAB: NullPointerException)`);
  const cash = contractIds(L, h.id, 'assets', 'cash')[0];
  const depValue = batch.balance(deposit);
  const liquidity = (cash === undefined ? 0 : batch.balance(cash)) + depValue;
  const capped = taxes * MICRO_PER_UNIT > liquidity;
  const paid = capped ? liquidity : taxes * MICRO_PER_UNIT; // µ
  if (depValue < paid) throw new Error(`Households.payTaxes: hogar ${h.id} con efectivo y depósito insuficiente: rama no portada`);
  setLag(h.lags, LAG.TAXES, s.round, capped ? liquidity / MICRO_PER_UNIT : taxes);
  // Entradas en µ: con tope, el saldo (depósito y efectivo); si no, intereses y dividendos × alícuota del ingreso
  // (la del patrimonio no está anotada: es 0 en el XML; con otra, error).
  let terms: InputTerm[] = [];
  if (inputsActive() && paid > 0) {
    if (capped) {
      terms = [{ contract: deposit, coef: 1 }];
      if (cash !== undefined) terms.push({ contract: cash, coef: 1 });
    } else {
      if (s.rules.householdWealthTaxRate !== 0) throw new Error('Households.payTaxes: alícuota del patrimonio ≠ 0: entradas del V3 no anotadas');
      const r = s.rules.householdIncomeTaxRate;
      terms = [
        { agent: h.id, field: 'interestReceived', coef: r },
        { agent: h.id, field: 'dividendsReceived', coef: r },
      ];
    }
  }
  derivedValue(h.id, `lag:${LAG.TAXES}:${s.round}`, terms);
  if (paid > 0) {
    batch.pay(deposit, account, paid, 'taxes');
    derivedPayment(deposit, account, terms);
  }
  setLag(h.lags, LAG.NETWEALTH, s.round, householdNetWealth(s, h, (c) => batch.balance(c)));
  h.dividendsReceived = 0;
}

/**
 * Evento 24, `taxesTic` (TIC_TAXES): solo el gobierno (`GovernmentAntiCyclical.onTicArrived` 78–80 →
 * `Government.collectTaxes`, 242–254), que recorre las poblaciones `taxedPopulations` (XML 2874–2881: empresas de
 * capital, de consumo, bancos y hogares) **en el orden de la lista de cada población** (no en el de creación) y le
 * pide a cada agente vivo (`isDead`: siempre falso, población fija) que pague a su cuenta en el BC. Sin sorteos.
 * Los pagos van a un lote con redondeo controlado al cerrar el evento.
 */
export function taxesEvent(s: CaianiState): SettleReport {
  const L = s.ledger;
  const account = contractIds(L, s.government.id, 'assets', 'reserves')[0];
  if (account === undefined) throw new Error('gobierno sin cuenta en el BC');
  const batch = new PaymentBatch(L);
  for (const id of s.populations.capitalFirms) payFirmTaxes(s, capitalFirmById(s, id), false, account, batch);
  for (const id of s.populations.consumptionFirms) payFirmTaxes(s, consumptionFirmById(s, id), true, account, batch);
  for (const id of s.populations.banks) payBankTaxes(s, bankById(s, id), account, batch);
  for (const id of s.populations.households) payHouseholdTaxes(s, householdById(s, id), account, batch);
  return batch.settle();
}

// ---------------------------------------------------------------------------------------------
// Evento 25: dividendos
// ---------------------------------------------------------------------------------------------

export const SITE_DIVIDENDS = 'FixedShareOfProfitsToPopulationAsShareOfWealthDividends.payDividends';

/** Los que cobran los dividendos: los hogares, en el orden de la lista de su población (`receivers.getAgents()`). */
interface DividendReceivers {
  households: HouseholdState[];
  /** Primer depósito de cada uno (`getItemStockMatrix(true, SM_DEP)`). */
  deposits: number[];
  /** `dividendsReceived` en unidades (`double`, como JMAB): el inicial más lo cobrado en el evento. */
  received: number[];
  /** V3 (`derived.ts`): entradas del patrimonio de cada hogar (sus contratos, ± 1) y de todos juntos; null sin registrador. */
  own: InputTerm[][] | null;
  all: InputTerm[] | null;
}

function dividendReceivers(s: CaianiState): DividendReceivers {
  const L = s.ledger;
  const households = s.populations.households.map((id) => householdById(s, id));
  const deposits = households.map((h) => {
    const d = contractIds(L, h.id, 'assets', 'deposit')[0];
    if (d === undefined) throw new Error(`hogar ${h.id} sin depósito (JMAB: NullPointerException)`);
    return d;
  });
  let own: InputTerm[][] | null = null;
  let all: InputTerm[] | null = null;
  if (inputsActive()) {
    own = households.map((h) => {
      const a = agentOf(L, h.id);
      const t: InputTerm[] = [];
      for (const list of a.assets) for (const id of list) t.push({ contract: id, coef: 1 });
      for (const list of a.liabilities) for (const id of list) t.push({ contract: id, coef: -1 });
      return t;
    });
    all = own.flat();
  }
  return { households, deposits, received: households.map((h) => toUnits(h.dividendsReceived)), own, all };
}

/**
 * Reparto de `FixedShareOfProfitsToPopulationAsShareOfWealthDividends.payDividends` (50–97): patrimonio total de los
 * hogares (`getNetWealth`, con los pagos pendientes del lote: incluye lo que cobraron de los pagadores anteriores),
 * y a cada uno, en el orden de la población, D × patrimonio / total desde la cuenta `from` (el primer depósito de una
 * empresa, con `transfer`; las reservas de un banco, que bajan mientras suben el depósito del hogar y las reservas
 * de su banco: es el mismo `pay` del ledger con la liquidación entre bancos). Categoría `dividends`, al lote.
 * `dTerms`: entradas de D (V3). Cada pago anota además la dependencia del patrimonio del hogar (D / total) y del total
 * (−pago / total), con grupos para no copiar listas largas (`derived.ts`).
 */
function payDividendsTo(s: CaianiState, rc: DividendReceivers, batch: PaymentBatch, from: number, D: number, dTerms: readonly InputTerm[]): void {
  const n = rc.households.length;
  const nw = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    nw[i] = householdNetWealth(s, rc.households[i]!, (c) => batch.balance(c));
    total += nw[i]!;
  }
  for (let i = 0; i < n; i++) {
    const toPay = (D * nw[i]!) / total; // JMAB: profits * profitShare * nw / totalNW
    if (!(toPay >= 0)) throw new Error(`${SITE_DIVIDENDS}: pago ${toPay} al hogar ${rc.households[i]!.id} (patrimonio ${nw[i]}, total ${total}): no portado`);
    batch.pay(from, rc.deposits[i]!, toPay * MICRO_PER_UNIT, 'dividends');
    rc.received[i]! += toPay;
    if (rc.own && rc.all && toPay > 0) {
      const terms: InputTerm[] = [];
      if (dTerms.length > 0) terms.push({ group: dTerms, coef: nw[i]! / total });
      terms.push({ group: rc.own[i]!, coef: D / total }, { group: rc.all, coef: -toPay / total });
      derivedPayment(from, rc.deposits[i]!, terms);
    }
  }
}

/**
 * Empresa (`ConsumptionFirm.payDividends` 953–958, `CapitalFirm.payDividends` 779–784: nada si quebró en el tick) →
 * `FixedShareOfProfitsToPopulationAsShareOfWealthDividends.payDividends` (XML 1892–1898 y 2182–2188, `profitShare` 0,9):
 * ganancia = `LAG_PROFITAFTERTAX` del tick (evento 24); si es > 0 y el primer depósito es > ganancia × 0,9 (estricto),
 * la ganancia se recorta al depósito si lo supera, `dividends` = ganancia × 0,9 y se reparte entre los hogares.
 */
function payFirmDividends(s: CaianiState, f: FirmState, share: number, rc: DividendReceivers, batch: PaymentBatch): void {
  if (f.defaulted) return;
  let profits = getLag(f.lags, LAG.PROFITAFTERTAX, s.round, 0);
  if (!gt(`${SITE_DIVIDENDS} ganancia > 0`, profits * MICRO_PER_UNIT, 0, 'amount', undefined, f.id)) return;
  const deposit = contractIds(s.ledger, f.id, 'assets', 'deposit')[0];
  if (deposit === undefined) throw new Error(`empresa ${f.id} sin depósito (JMAB: NullPointerException)`);
  const dep = batch.balance(deposit);
  if (!gt(`${SITE_DIVIDENDS} depósito > dividendos`, dep, profits * share * MICRO_PER_UNIT, 'amount', undefined, f.id)) return;
  let dTerms: InputTerm[] = [];
  if (gt(`${SITE_DIVIDENDS} ganancia > depósito`, profits * MICRO_PER_UNIT, dep, 'amount', undefined, f.id)) {
    profits = dep / MICRO_PER_UNIT;
    if (inputsActive()) dTerms = [{ contract: deposit, coef: share }];
  }
  const D = profits * share;
  f.dividends = toMicro(D);
  derivedValue(f.id, 'dividends', dTerms);
  payDividendsTo(s, rc, batch, deposit, D, dTerms);
}

/**
 * Banco (`Bank.payDividends` 231–237): ganancia después de impuestos = patrimonio − `LAG_NETWEALTH` del período anterior
 * → `LAG_PROFITAFTERTAX`; la estrategia (XML 2583–2590, `profitShare` 0,6): si la ganancia es > 0, `dividends` =
 * ganancia × 0,6, repartida entre los hogares desde sus reservas, **sin mirar el saldo** (el tope está comentado en
 * JMAB, 61–63: las reservas pueden quedar negativas) y aunque el banco haya quebrado (no hay chequeo de `defaulted`).
 */
function payBankDividends(s: CaianiState, b: BankState, rc: DividendReceivers, batch: PaymentBatch): void {
  const { nw, terms } = bankNetWealth(s, b, batch);
  const profits = nw - getLag(b.lags, LAG.NETWEALTH, s.round, 1);
  setLag(b.lags, LAG.PROFITAFTERTAX, s.round, profits);
  derivedValue(b.id, `lag:${LAG.PROFITAFTERTAX}:${s.round}`, terms);
  if (!gt(`${SITE_DIVIDENDS} ganancia > 0 (banco)`, profits * MICRO_PER_UNIT, 0, 'amount', undefined, b.id)) return;
  const reserves = contractIds(s.ledger, b.id, 'assets', 'reserves')[0];
  if (reserves === undefined) throw new Error(`banco ${b.id} sin reservas`);
  const share = s.rules.bankProfitShare;
  const D = profits * share;
  b.dividends = toMicro(D);
  const dTerms = inputsActive() ? scaleTerms(terms, share) : [];
  derivedValue(b.id, 'dividends', dTerms);
  payDividendsTo(s, rc, batch, reserves, D, dTerms);
}

/**
 * Evento 25, `dividendsTic` (TIC_DIVIDENDS): empresas de consumo, de capital y bancos, en orden de creación
 * (`CopyOf…2WagesEnd.onTicArrived` 91–92 y 90–91, `Bank.onTicArrived` 215–216). Los hogares cobran en el orden de su
 * población; `dividendsReceived` (puesto en 0 en el evento 24) acumula lo cobrado, en µ (`toMicro` de la suma en
 * `double`, como las otras sumas de campos). Sin sorteos. Los pagos van a un lote con redondeo controlado.
 */
export function dividendsEvent(s: CaianiState): SettleReport {
  const batch = new PaymentBatch(s.ledger);
  const rc = dividendReceivers(s);
  for (const c of s.consumptionFirms) payFirmDividends(s, c, s.rules.firmProfitShareConsumption, rc, batch);
  for (const k of s.capitalFirms) payFirmDividends(s, k, s.rules.firmProfitShareCapital, rc, batch);
  for (const b of s.banks) payBankDividends(s, b, rc, batch);
  rc.households.forEach((h, i) => (h.dividendsReceived = toMicro(rc.received[i]!)));
  return batch.settle();
}

// ---------------------------------------------------------------------------------------------
// Evento 26: demanda de depósitos
// ---------------------------------------------------------------------------------------------

/**
 * Evento 26, `depDemandTic` (TIC_DEPOSITDEMAND): empresas de consumo, de capital y hogares, en orden de creación
 * (`CopyOfConsumptionFirm2WagesEnd.onTicArrived` 94–95, `CopyOfCapitalFirm2WagesEnd` 93–94, `Households` 192–193;
 * los bancos y el gobierno no lo escuchan), todos con `computeLiquidAssetsAmounts`. Sin sorteos ni interacción.
 * - Empresa (`ConsumptionFirm` 694–706, `CapitalFirm` 285–297, iguales): si el efectivo es > 0, lo pasa al primer
 *   depósito (el efectivo del banco sube en espejo); activa en el mercado de depósitos. En el base las empresas no
 *   tienen efectivo (inicializacion.md, sec. 5): el traspaso va al lote, como en los eventos 20 y 21.
 * - Hogar (`Households` 245–258): activos líquidos = Σ efectivo + Σ depósitos (todos los de sus listas; las variables
 *   de JMAB tienen los nombres cruzados, sin efecto); `depositAmount` = `shareDeposits` × líquidos (1, XML 2700) y
 *   `cashAmount` = líquidos − `depositAmount`; activo en el mercado de depósitos. En µ: la suma de los saldos es exacta,
 *   `depositAmount` se redondea una vez y `cashAmount` es el resto (la suma de los dos es exactamente los líquidos).
 */
export function depositDemandEvent(s: CaianiState): SettleReport {
  const L = s.ledger;
  const batch = new PaymentBatch(L);
  for (const f of [...s.consumptionFirms, ...s.capitalFirms]) {
    const cash = contractIds(L, f.id, 'assets', 'cash')[0];
    if (cash === undefined) throw new Error(`empresa ${f.id} sin efectivo (JMAB: NullPointerException)`);
    if (batch.balance(cash) > 0) {
      const deposit = contractIds(L, f.id, 'assets', 'deposit')[0];
      if (deposit === undefined) throw new Error(`empresa ${f.id} sin depósito (JMAB: NullPointerException)`);
      batch.pay(cash, deposit, batch.balance(cash), 'deposits');
    }
    f.active[MKT.DEPOSIT] = true;
  }
  const share = s.rules.householdShareDeposits;
  for (const h of s.households) {
    const liquid = sumContracts(L, h.id, 'assets', 'cash') + sumContracts(L, h.id, 'assets', 'deposit');
    h.depositAmount = Math.round(share * liquid);
    h.cashAmount = liquid - h.depositAmount;
    if (inputsActive()) {
      const liquidTerms: InputTerm[] = [...contractIds(L, h.id, 'assets', 'cash'), ...contractIds(L, h.id, 'assets', 'deposit')].map((contract) => ({ contract, coef: 1 }));
      derivedValue(h.id, 'depositAmount', scaleTerms(liquidTerms, share));
      if (share !== 1) derivedValue(h.id, 'cashAmount', scaleTerms(liquidTerms, 1 - share));
    }
    h.active[MKT.DEPOSIT] = true;
  }
  return batch.settle();
}

// ---------------------------------------------------------------------------------------------
// Evento 27: mercado de depósitos
// ---------------------------------------------------------------------------------------------

export const SITE_DEPOSIT_SUPPLIER = 'MostPayingDepositWithSwitching.selectDepositSupplier';
export const SITE_DEPOSIT_MECHANISM = 'DepositMechanism.execute';

/**
 * `MostPayingDepositWithSwitching.selectDepositSupplier` (XML 1810–1813, 2104–2107 y 2794–2797, todos con
 * `switchingStrategy2`): el banco de tasa de depósitos más alta entre los vistos (el primero si empatan; la tasa no
 * depende del monto, `Bank.getDepositInterestRate` 156–159); si la del banco previo es menor, cambia con la
 * probabilidad de `SwitchingStrategySimple` (cobro: `payOrReceive` = false). Devuelve el previo (actualizado), que
 * puede no estar entre los vistos. `isDead()` del previo: la población de bancos es fija y nadie muere en el base.
 */
function selectDepositSupplier(s: CaianiState, depositor: HouseholdState | FirmState, banks: readonly BankState[], rng: CaianiRng): BankState {
  let maxRate = -Infinity;
  let maxBank = banks[0]!;
  for (const b of banks) {
    if (gt(`${SITE_DEPOSIT_SUPPLIER} más alta`, b.depositInterestRate, maxRate, 'pure')) {
      maxRate = b.depositInterestRate;
      maxBank = b;
    }
  }
  const prev = bankById(s, depositor.previousBank);
  // Si el previo es el de tasa más alta, las dos tasas son el mismo valor: no se registra.
  const prevLower = prev === maxBank ? false : lt(`${SITE_DEPOSIT_SUPPLIER} previo < máximo`, prev.depositInterestRate, maxRate, 'pure', undefined, depositor.id);
  if (prevLower && switches(prev.depositInterestRate, maxRate, s.rules.depositSwitchingLambda, s.rules.depositSwitchingPayOrReceive, rng)) {
    depositor.previousBank = maxBank.id;
  }
  return bankById(s, depositor.previousBank);
}

/**
 * `DepositMechanism.execute` (XML 421–425): el depositante pasa todo a un depósito en el banco elegido.
 * - Busca el **primero** de sus depósitos cuyo emisor es ese banco (`getItemStockMatrix(true, SM_DEP, banco)`; incluye
 *   un depósito que una quiebra sacó de la lista del banco, `delisted`: en JMAB la empresa lo vuelve a usar, sec. 19).
 *   Si no tiene, abre uno en 0 con la tasa del banco (al final de las dos listas); si tiene, le pone la tasa del banco.
 * - Cada uno de los otros depósitos (los de antes, en su orden): transfiere el saldo entero al elegido (`transfer`,
 *   con reservas si el banco es otro) y lo saca de las listas del depositante y del banco (`closeContract`; si estaba
 *   fuera de la lista del banco, como en JMAB, sacarlo de ahí no hace nada). Es como la empresa suelta el segundo
 *   depósito de una quiebra.
 * - Efectivo: si el primero no es el deseado (`cashAmount`; 0 en las empresas, `getCashAmount`), la diferencia pasa
 *   del efectivo al depósito o al revés, con el efectivo del banco en espejo. En el base no pasa (todo en 0).
 * - El depositante queda inactivo en el mercado de depósitos.
 * Los traspasos son saldos enteros (exactos en µ): van directo al ledger, sin lote (no hay nada que redondear).
 */
function depositTransaction(s: CaianiState, depositor: HouseholdState | FirmState, bank: BankState, cashAmount: Micro): void {
  const L = s.ledger;
  const rate = bank.depositInterestRate;
  const previous = contractIds(L, depositor.id, 'assets', 'deposit').slice();
  let deposit = previous.find((id) => contractOf(L, id).issuer === bank.id);
  if (deposit === undefined) deposit = open(L, 'deposit', depositor.id, bank.id, 0, { rate }, 'deposits');
  else setContractRate(L, deposit, rate);
  for (const dep of previous) {
    if (dep === deposit) continue;
    pay(L, dep, deposit, contractOf(L, dep).amount, 'deposits');
    closeContract(L, dep);
  }
  const cash = contractIds(L, depositor.id, 'assets', 'cash')[0];
  if (cash === undefined) throw new Error(`agente ${depositor.id} sin efectivo (JMAB: NullPointerException)`);
  const held = contractOf(L, cash).amount;
  // Comparación entre montos en µ que en el base son 0 exactos también en JMAB (nadie tiene efectivo y el deseado es
  // líquidos − 1 × líquidos): no se registra, como el efectivo de las empresas en los eventos 20 y 21 (daba 8.120
  // "frágiles" con distancia 0 por tick).
  if (held !== cashAmount) {
    const bias = held - cashAmount;
    if (bias > 0) pay(L, cash, deposit, bias, 'deposits');
    else pay(L, deposit, cash, -bias, 'deposits');
  }
  depositor.active[MKT.DEPOSIT] = false;
}

/**
 * Evento 27, `depMarketTic` (TIC_DEPOSITMARKET): `SimpleMarketSimulation` de los depósitos (XML 386–425), con listas
 * propias (`s.markets.deposit`: compradores = hogares, empresas de capital y de consumo; vendedores = bancos) y
 * `nbRuns` = 1. Como el mercado de crédito (evento 10): si no hay ningún comprador activo con algún vendedor activo,
 * está cerrado; si no, `SelectionRandomRobinBuyerMixer` mezcla los compradores (en el lugar) y, para cada uno activo
 * en depósitos, mezcla los bancos (en el lugar) y toma los primeros 3 activos; si hay alguno, el depositante elige
 * banco (`selectDepositSupplier`; `Households.onAgentArrival` 168–171, `ConsumptionFirm` 234–237, `CapitalFirm`
 * 269–272) y se ejecuta `DepositMechanism` en el momento.
 */
export function depositMarketEvent(s: CaianiState, rng: CaianiRng): void {
  const m = s.markets.deposit;
  const firmOf = new Map<AgentId, FirmState>();
  for (const f of [...s.consumptionFirms, ...s.capitalFirms]) firmOf.set(f.id, f);
  const depositor = (id: AgentId): HouseholdState | FirmState => firmOf.get(id) ?? householdById(s, id);
  const sellerActive = (id: AgentId) => bankById(s, id).active[MKT.DEPOSIT]!;
  // AbstractMarketMixer.closed
  const open_ = m.buyers.some((id) => depositor(id).active[MKT.DEPOSIT]) && m.sellers.some(sellerActive);
  if (!open_) return;
  rng.shuffle(SITE_CREDIT_MIXER, 'buyers', m.buyers, ownId);
  for (const id of m.buyers) {
    const d = depositor(id);
    if (!d.active[MKT.DEPOSIT]) continue;
    const selected = selectSellers(m.sellers, s.rules.depositMarketSellers, sellerActive, rng, SITE_CREDIT_MIXER);
    if (selected.length === 0) continue;
    const bank = selectDepositSupplier(
      s,
      d,
      selected.map((b) => bankById(s, b)),
      rng,
    );
    depositTransaction(s, d, bank, firmOf.has(id) ? 0 : (d as HouseholdState).cashAmount);
  }
}

// ---------------------------------------------------------------------------------------------
// Evento 28: quiebra de los bancos
// ---------------------------------------------------------------------------------------------

export const SITE_BANK_BANKRUPTCY = 'BankBankruptcyBailoutCAR.bankrupt';

/**
 * `BankBankruptcyBailoutCAR.bankrupt` (XML 2600–2604; aprobado por Nico el 2026-11-14, reglas-caiani.md, sec. 27):
 * rescate a cargo de los depositantes.
 * - Ratio objetivo = promedio de `capitalRatio` (el del evento 0) de los otros bancos, en el orden de la lista de la
 *   población (`banks.getAgents()`), + U(0; 0,1) (`Math.random()` en el `.jar`; `uniform01` acá).
 * - Patrimonio objetivo = ratio × Σ préstamos. **Quita total H (µ) = round(objetivo) − patrimonio** (el patrimonio es
 *   exacto en µ): el banco queda exactamente con el objetivo redondeado a µ. `bailoutCost` = H (JMAB: objetivo −
 *   patrimonio, en `double`).
 * - H se reparte entre los depósitos de la **lista del banco**, en proporción a su saldo, por restos mayores con
 *   desempate por id (ledger-contratos.md, sec. 2.1: quitas), y cada parte es un `writeDown` (categoría `writeOff`:
 *   pérdida del depositante, ganancia del banco). Un depósito fuera de la lista del banco no paga (rareza de JMAB,
 *   caiani-referencia.md).
 * - Expectativa de depósitos del banco: todas las filas de observaciones = [depósitos después, depósitos después]
 *   (`setPassedValues`; el valor de la expectativa no cambia).
 * Errores explícitos (ramas que JMAB no cubre): ratio u objetivo no finitos (un banco sin préstamos tiene ratio
 * infinito), quita negativa, banco sin depósitos o quita mayor que los depósitos.
 */
function bankBankruptcy(s: CaianiState, b: BankState, nw: Micro, rng: CaianiRng): void {
  const L = s.ledger;
  let tot = 0;
  for (const id of s.populations.banks) if (id !== b.id) tot += bankById(s, id).capitalRatio;
  const car = tot / (s.populations.banks.length - 1) + rng.uniform01(SITE_BANK_BANKRUPTCY, 'bailoutCAR') * 0.1;
  const loanIds = contractIds(L, b.id, 'assets', 'loan');
  const loans = sumContracts(L, b.id, 'assets', 'loan');
  const targetNW = car * toUnits(loans);
  if (!Number.isFinite(car) || !Number.isFinite(targetNW)) {
    throw new Error(`${SITE_BANK_BANKRUPTCY}: banco ${b.id} con ratio objetivo ${car} y patrimonio objetivo ${targetNW}: no portado`);
  }
  const H = toMicro(targetNW) - nw;
  if (H < 0) throw new Error(`${SITE_BANK_BANKRUPTCY}: banco ${b.id} con quita negativa (${H} µ): no portado`);
  b.bailoutCost = H;
  if (inputsActive()) {
    // H = car × Σ préstamos − patrimonio: los préstamos con coeficiente car y cada contrato del banco con ∓1.
    const a = agentOf(L, b.id);
    const terms: InputTerm[] = loanIds.map((contract) => ({ contract, coef: car }));
    for (const list of a.assets) for (const contract of list) terms.push({ contract, coef: -1 });
    for (const list of a.liabilities) for (const contract of list) terms.push({ contract, coef: 1 });
    derivedValue(b.id, 'bailoutCost', terms);
  }
  const deposits = contractIds(L, b.id, 'liabilities', 'deposit').slice();
  const balances = deposits.map((id) => contractOf(L, id).amount);
  let D = 0;
  for (const x of balances) D += x;
  if (D === 0 || H > D) throw new Error(`${SITE_BANK_BANKRUPTCY}: banco ${b.id} con depósitos ${D} µ y quita ${H} µ: no portado`);
  const shares = allocateLargestRemainder(H, balances, deposits);
  deposits.forEach((id, i) => writeDown(L, id, shares[i]!));
  const after = toUnits(D - H);
  const exp = b.expectations[EXPECTATION.DEPOSITS];
  if (!exp) throw new Error(`banco ${b.id} sin expectativa de depósitos`);
  for (const row of exp.passed) {
    row[0] = after;
    row[1] = after;
  }
}

/**
 * Evento 28, `bankruptcyTic` (TIC_BANKRUPTCY): solo los bancos, en orden de creación (`Bank.onTicArrived` 209–211 →
 * `determineBankruptcy` 241–250): si el patrimonio (por las listas, `getNetWealth`; exacto en µ) es < 0, el rescate
 * (`bankBankruptcy`) y `defaulted` = true. El banco sigue en la población y conserva sus préstamos. La bandera solo
 * la lee el reporte de quiebras (y la pone en false el evento 0).
 */
export function bankBankruptcyEvent(s: CaianiState, rng: CaianiRng): void {
  for (const b of s.banks) {
    const nw = netFinancialWorth(s.ledger, b.id);
    if (lt(`${SITE_BANK_BANKRUPTCY} patrimonio < 0`, nw, 0, 'amount', undefined, b.id)) {
      bankBankruptcy(s, b, nw, rng);
      b.defaulted = true;
    }
  }
}
