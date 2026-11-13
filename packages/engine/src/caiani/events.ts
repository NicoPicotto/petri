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
import {
  EXPECTATION,
  LAG,
  MKT,
  getLag,
  updateExpectation,
  type CaianiState,
  type Expectations,
  type FirmState,
} from './state';

/** Índices de los eventos de comportamiento (orden de modelFile.xml, líneas 43–80). */
export const EVENT = {
  COMPUTE_EXPECTATIONS: 0,
} as const;

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
