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

import { contractIds, contractOf, credit, firstAsset, installment, netFinancialWorth, open, type AgentId, type ContractKind, type Ledger } from './ledger';
import { toMicro, toUnits, type Micro } from './money';
import { expNeg } from '../detmath';
import { logistic } from '../creditRisk';
import type { CaianiRng } from './rng';
import { ge, gt, lt, record, rounding } from './decisions';
import {
  EXPECTATION,
  LAG,
  MKT,
  getLag,
  setLag,
  updateExpectation,
  goodValue,
  type BankState,
  type CaianiState,
  type CapitalGoodStock,
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
  const firstK = s.capitalFirms[0]!.id;
  const capitalFirm = (id: AgentId): FirmState => {
    const k = s.capitalFirms[id - firstK];
    if (!k || k.id !== id) throw new Error(`el agente ${id} no es una empresa de capital`);
    return k;
  };
  const offered = (id: AgentId): CapitalGoodStock => {
    const g = capitalFirm(id).capitalGoods[0];
    if (!g) throw new Error(`empresa de capital ${id} sin inventario (JMAB: NullPointerException)`);
    return g;
  };
  for (const c of s.consumptionFirms) {
    const sellers = c.selectedCapitalSuppliers;
    if (sellers === null || sellers.length === 0) {
      throw new Error(`empresa de consumo ${c.id} sin vendedores de capital (JMAB: excepción en sellers.get(0))`);
    }
    const w = wageExpectation(c);
    let best = sellers[0]!;
    let maxAttr = -Infinity;
    for (const k of sellers) {
      const a = capitalAttractiveness(w, offered(k));
      if (gt('BestQualityPriceCapitalSupplierWithSwitching mejor atractivo', a, maxAttr, 'pure')) {
        best = k;
        maxAttr = a;
      }
    }
    const prev = c.previousCapitalSupplier;
    if (prev === null) throw new Error(`empresa de consumo ${c.id} sin proveedor de capital previo (JMAB: NullPointerException)`);
    const prevAttr = capitalFirm(prev).active[MKT.CAPGOOD] ? capitalAttractiveness(w, offered(prev)) : -Infinity;
    // Si el previo es el mejor, los dos atractivos son el mismo cálculo: no es una decisión que pueda
    // darse vuelta y no se registra. Un empate con otra empresa sí se registra.
    const prevWorse = prev === best ? prevAttr < maxAttr : lt('BestQualityPriceCapitalSupplierWithSwitching previo < mejor', prevAttr, maxAttr, 'pure');
    if (prevWorse) {
      if (prevAttr === -Infinity || switches(prevAttr, maxAttr, s.rules.capitalSwitchingLambda, s.rules.capitalSwitchingPayOrReceive, rng)) {
        c.previousCapitalSupplier = best;
      }
    }
    c.desiredRealCapitalDemand = realCapitalDemand(c, offered(c.previousCapitalSupplier!));
    if (c.desiredRealCapitalDemand > 0) c.active[MKT.CAPGOOD] = true;
  }
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
 * En µ: interés = `Math.round(saldo × tasa)` (como las ganancias del BC); el saldo nuevo es saldo +
 * interés, y `interestReceived` y `totInterestsDeposits` son lo acreditado. Diferencia con JMAB:
 * valor·(1 + tasa) contra valor + redondeo(valor·tasa), menos de 1 µ por depósito.
 */
export function depositInterestEvent(s: CaianiState): void {
  const L = s.ledger;
  const holderOf = new Map<AgentId, { interestReceived: Micro }>();
  for (const h of s.households) holderOf.set(h.id, h);
  for (const f of s.consumptionFirms) holderOf.set(f.id, f);
  for (const f of s.capitalFirms) holderOf.set(f.id, f);
  for (const b of s.banks) {
    let tot = 0;
    for (const id of contractIds(L, b.id, 'liabilities', 'deposit')) {
      const c = contractOf(L, id);
      const interest = Math.round(c.amount * c.rate);
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
 * En µ, con `installment` del ledger (la misma cuota que se paga en el evento 20): difiere de la de JMAB
 * en menos de ~1,5 µ por préstamo (ledger-contratos.md; reglas-caiani.md, sec. 10).
 */
export function debtPayments(L: Ledger, firm: AgentId): { burden: Micro; interests: Micro } {
  let burden = 0;
  let interests = 0;
  for (const id of contractIds(L, firm, 'liabilities', 'loan')) {
    const due = installment(contractOf(L, id));
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
  return gt(`${SITE_PECKING_ORDER} requerimiento > liquidez`, req, liquidity, 'amount') ? req - liquidity : 0;
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
  if (amount === required) firm.active[MKT.CREDIT] = false;
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
