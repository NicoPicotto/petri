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

import { contractIds, contractOf, firstAsset, netFinancialWorth, type AgentId, type ContractKind, type Ledger } from './ledger';
import { toUnits, type Micro } from './money';
import { expNeg } from '../detmath';
import type { CaianiRng } from './rng';
import {
  EXPECTATION,
  LAG,
  MKT,
  getLag,
  setLag,
  updateExpectation,
  type CaianiState,
  type CapitalGoodStock,
  type Expectations,
  type FirmState,
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
export function targetOutput(expectedRealSales: number, inventoryQuantity: number, share: number): number {
  const expInv = expectedRealSales * share;
  return Math.max(0, expectedRealSales + (expInv - inventoryQuantity));
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
    k.active[MKT.CAPGOOD] = inv.quantity + Math.floor(k.desiredOutput) > 0;
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
    b.liquidityRatio = deposits === 0 ? 0 : reserves / deposits;
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
  if (reference > r.markUpThreshold) f.markUp -= r.markUpAdaptive * f.markUp * x;
  else f.markUp += r.markUpAdaptive * f.markUp * x;
  const lb = lowerBound();
  const p = lb !== 0 ? lb * (1 + f.markUp) : previousLowerBound * (1 + f.markUp);
  return p > lb ? p : lb;
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
      if (residual > g.productivity * g.quantity) {
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
    return (w * Math.round(requiredWorkers(c.capitalGoods, c.desiredOutput))) / c.desiredOutput;
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
    if (!(potential < previous)) return 0;
    x = (lambda * (previous - potential)) / potential;
  } else {
    if (!(previous < potential)) return 0;
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
    if (((lpOld - lpNew) / w) * (old.duration - old.age) - newCapital.price > 0) {
      old.obsolete = true;
    } else if (old.duration - old.age > 1) {
      residualCapacity += old.productivity * old.quantity;
    }
  }
  const desiredCapacity = (1 + c.desiredCapacityGrowth) * currentCapacity;
  if (desiredCapacity >= residualCapacity) return javaRoundToInt((desiredCapacity - residualCapacity) / newCapital.productivity);
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
      if (a > maxAttr) {
        best = k;
        maxAttr = a;
      }
    }
    const prev = c.previousCapitalSupplier;
    if (prev === null) throw new Error(`empresa de consumo ${c.id} sin proveedor de capital previo (JMAB: NullPointerException)`);
    const prevAttr = capitalFirm(prev).active[MKT.CAPGOOD] ? capitalAttractiveness(w, offered(prev)) : -Infinity;
    if (prevAttr < maxAttr) {
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

/**
 * `CopyOfAdaptiveInterestRateAverageThreshold.computeInterestRate` con `mktId` = MKT_CREDIT (64–102):
 * - promedios sobre los bancos con préstamos (saldo ≠ 0) y patrimonio > 0, en el orden de la lista de la
 *   población (`banks.getAgents()`; importa para la suma en double): umbral = ratio de capital medio,
 *   tasa media = `LAG_LOANINTEREST` del período anterior (`getPassedValue(…, 1)`). Sin ninguno, 0/0 = NaN;
 * - referencia = ratio de capital del banco (evento 0);
 * - con `increase` = false: si la referencia supera el umbral, tasa = media − a·media·|N|; si no,
 *   media + a·media·|N|. Un sorteo por banco en cualquier rama;
 * - acotada a [0, +∞) (`Bank.getInterestRateLowerBound` / `UpperBound` del crédito). `Math.max`/`min`
 *   de Java y de JS propagan NaN igual.
 * `eligible` son los bancos que entran en los promedios, ya en el orden de la población.
 */
export function adaptiveLoanRate(
  referenceVariable: number,
  eligible: readonly { capitalRatio: number; pastLoanRate: number }[],
  rng: CaianiRng,
  r: { loanRateAdaptive: number; loanRateIncrease: boolean; loanRateSigma: number },
): number {
  let tot = 0;
  let inter = 0;
  for (const b of eligible) {
    tot += b.capitalRatio;
    inter += b.pastLoanRate;
  }
  const n = eligible.length;
  const threshold = tot / n;
  const avInterest = inter / n;
  // `adaptiveParameter*avInterest*distribution.nextDouble()`: se evalúa de izquierda a derecha.
  const step = () => r.loanRateAdaptive * avInterest * rng.foldedNormal(SITE_INTEREST_RATE, r.loanRateSigma);
  let iR: number;
  if (referenceVariable > threshold) iR = r.loanRateIncrease ? avInterest + step() : avInterest - step();
  else iR = r.loanRateIncrease ? avInterest - step() : avInterest + step();
  return Math.min(Math.max(iR, 0), Infinity);
}

/**
 * Evento 6, `creditSupplyTic` (TIC_CREDITSUPPLY): solo los bancos, en orden de creación
 * (`Bank.onTicArrived` 199–202):
 * 1. `determineBankGenericInterestRate` (273–277): `bankInterestRate` con `adaptiveLoanRate`. Los
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
    .filter((b) => sumContracts(L, b.id, 'assets', 'loan') !== 0 && netFinancialWorth(L, b.id) > 0)
    .map((b) => ({ capitalRatio: b.capitalRatio, pastLoanRate: getLag(b.lags, LAG.LOANINTEREST, s.round, 1) }));
  for (const b of s.banks) {
    b.bankInterestRate = adaptiveLoanRate(b.capitalRatio, eligible, rng, s.rules);
    const loanSupply = Infinity; // InfiniteSupplyCreditStrategy.computeCreditSupply
    b.totalLoanSupply = loanSupply;
    setLag(b.lags, LAG.BANKTOTLOANSUPPLY, s.round, loanSupply);
    if (b.totalLoanSupply > 0) b.active[MKT.CREDIT] = true;
  }
}
