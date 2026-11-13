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

import { contractIds, contractOf, firstAsset, type AgentId, type ContractKind, type Ledger } from './ledger';
import { toUnits, type Micro } from './money';
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
