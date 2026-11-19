/*
 * Petri — Copyright (C) 2026 Nicolas Picotto
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Traducción a TypeScript, MODIFICADA, de código de:
 *   JMAB / modelo Benchmark — Copyright (C) 2013 Alessandro Caiani and Antoine Godin
 *   (GNU GPL v3 o posterior). https://github.com/S120/jmab, https://github.com/S120/benchmark
 * Clases de origen: jmab.report.UnemploymentRateComputer, jmab.report.AveragePriceComputer,
 *   modellone.report.AverageNetIncomeComputer, modellone.report.MicroRealSalesComputer,
 *   jmab.report.MicroRealInvestmentComputer, jmab.report.AggregateSectorBalanceSheetComputer (referencia:
 *   benchmarkModel.jar del paper; Model/reportsFile.xml del lanzador; fuente en reference/jmab-2015).
 * Modificaciones: ver docs/reglas-caiani.md, sec. 41.
 */

/**
 * Los 8 reportes de JMAB que lee V4 (`reference/tools/analyze_baseline.py`; aprobados por Nico el 2026-11-17,
 * reglas-caiani.md, sec. 41). Solo leen el estado. Se calculan en el lugar de los reportes de JMAB (eventos 38–73): después
 * del evento 37 y antes del 74 (con `caianiTick`, en el gancho `afterEvent` del 37).
 */
import { contractIds, contractOf, type AgentId, type ContractKind } from './ledger';
import { averageEmployedWage, householdNetIncome } from './events';
import { LAG, getLag, goodValue, type CaianiState, type FirmState, type HouseholdState } from './state';

/** Columnas de los balances agregados, en el orden de `stocksNames` de JMAB (StaticValues.SM_*). */
export const BALANCE_SHEET_STOCKS = ['CASH', 'DEPOSITS', 'CONSGOODS', 'CAPGOODS', 'LOANS', 'BONDS', 'RESERVES', 'ADVANCES'] as const;

export interface CaianiReports {
  /** `unemployment1.csv`. */
  unemployment: number;
  /** `cAvPrice1.csv`, `kAvPrice1.csv`. */
  cAvPrice: number;
  kAvPrice: number;
  /** `hhAvNetIncome1.csv`. */
  hhAvNetIncome: number;
  /** `cFirmsRealSales1.csv`, `cFirmsRealInvestment1.csv`: una columna por empresa de consumo, en orden de id (TreeMap). */
  consumptionFirmIds: AgentId[];
  cFirmsRealSales: number[];
  cFirmsRealInvestment: number[];
  /** `aggCFBS1.csv`, `aggBBS1.csv`: Σ (activos − pasivos) por tipo de stock (`BALANCE_SHEET_STOCKS`), en unidades. */
  aggCFBS: number[];
  aggBBS: number[];
}

/** `UnemploymentRateComputer.computeVariable`: 1 − ocupados / hogares (ocupado = con empleador; `isEmployed`). */
export function unemploymentReport(s: CaianiState): number {
  let employed = 0;
  for (const h of s.households) if (h.employer !== null) employed += 1;
  return 1 - employed / s.households.length;
}

/**
 * `AveragePriceComputer.computeVariable`: Σ precio × ventas reales del tick / Σ ventas reales, en el orden de la población.
 * El precio es el del primer bien del tipo que la empresa produce (su inventario: `getItemStockMatrix(true, goodId)`); las
 * ventas, `getPassedValue(LAG_REALSALES, 0)` (las del tick, que escribe el evento 24). Con ventas totales 0 da NaN, como Java.
 */
export function averagePriceReport(s: CaianiState, firms: readonly FirmState[], good: 'consumption' | 'capital'): number {
  let totalSales = 0;
  for (const f of firms) totalSales += getLag(f.lags, LAG.REALSALES, s.round, 0);
  let averagePrice = 0;
  for (const f of firms) {
    const g = good === 'consumption' ? f.consumptionGoods[0] : f.capitalGoods[0];
    if (!g) throw new Error(`empresa ${f.id} sin inventario (JMAB: NullPointerException)`);
    averagePrice += g.price * (getLag(f.lags, LAG.REALSALES, s.round, 0) / totalSales);
  }
  return averagePrice;
}

/**
 * `AverageNetIncomeComputer.computeVariable`: Σ `Households.getNetIncome()` / hogares. `getNetIncome` recalcula los impuestos
 * en el momento del reporte (`householdNetIncome`, la misma función del evento 17) y, para el desocupado, usa el salario
 * medio de los ocupados de ese momento (JMAB lo recalcula por hogar; nada cambia entre hogares).
 */
export function averageNetIncomeReport(s: CaianiState, households: readonly HouseholdState[]): number {
  let avg: number | undefined;
  const averageWage = (): number => (avg ??= averageEmployedWage(s));
  let netIncome = 0;
  for (const h of households) netIncome += householdNetIncome(s, h, averageWage);
  return netIncome / households.length;
}

/** `MicroRealInvestmentComputer`: Σ cantidad de las añadas de capital con edad < 0 (las compradas en el tick). */
export function realInvestmentReport(f: FirmState): number {
  let investment = 0;
  for (const g of f.capitalGoods) if (g.age < 0) investment += g.quantity;
  return investment;
}

const KIND_OF_STOCK: Partial<Record<(typeof BALANCE_SHEET_STOCKS)[number], ContractKind>> = {
  CASH: 'cash',
  DEPOSITS: 'deposit',
  LOANS: 'loan',
  BONDS: 'bond',
  RESERVES: 'reserves',
  ADVANCES: 'advance',
};

/**
 * `AggregateSectorBalanceSheetComputer`: por tipo de stock, Σ de los agentes de (Σ `getValue` de los activos − Σ de los
 * pasivos) (`getNumericBalanceSheet`), en unidades. Contratos: saldo en µ / 10⁶ (todos los de la matriz del agente, también
 * un segundo depósito fuera de la lista del banco). Bienes: `goodValue` (el `getValue` de JMAB: a costo el inventario propio,
 * el valor contable si no). Los agentes no tienen bienes como pasivos.
 */
export function aggregateBalanceSheetReport(s: CaianiState, agents: readonly { id: AgentId; consumptionGoods?: FirmState['consumptionGoods']; capitalGoods?: FirmState['capitalGoods'] }[]): number[] {
  const agg = BALANCE_SHEET_STOCKS.map(() => [0, 0]);
  for (const a of agents) {
    BALANCE_SHEET_STOCKS.forEach((stock, i) => {
      let aVal = 0;
      let lVal = 0;
      const kind = KIND_OF_STOCK[stock];
      if (kind) {
        for (const id of contractIds(s.ledger, a.id, 'assets', kind)) aVal += contractOf(s.ledger, id).amount / 1_000_000;
        for (const id of contractIds(s.ledger, a.id, 'liabilities', kind)) lVal += contractOf(s.ledger, id).amount / 1_000_000;
      } else {
        const goods = stock === 'CONSGOODS' ? a.consumptionGoods : a.capitalGoods;
        for (const g of goods ?? []) aVal += goodValue(g, a.id);
      }
      agg[i]![0]! += aVal;
      agg[i]![1]! += lVal;
    });
  }
  return agg.map(([aV, lV]) => aV! - lV!);
}

/** Los 8 reportes, en el estado de después del evento 37. */
export function caianiReports(s: CaianiState): CaianiReports {
  const byId = <T extends { id: AgentId }>(xs: readonly T[], ids: readonly AgentId[]): T[] => {
    const m = new Map(xs.map((x) => [x.id, x]));
    return ids.map((id) => {
      const x = m.get(id);
      if (!x) throw new Error(`reportes: agente ${id} de la población sin estado`);
      return x;
    });
  };
  // Orden de la población (`pop.getAgents()`), que es el de las sumas de JMAB.
  const cFirms = byId(s.consumptionFirms, s.populations.consumptionFirms);
  const kFirms = byId(s.capitalFirms, s.populations.capitalFirms);
  const households = byId(s.households, s.populations.households);
  const banks = byId(s.banks, s.populations.banks);
  const sortedC = [...s.consumptionFirms].sort((a, b) => a.id - b.id);
  return {
    unemployment: unemploymentReport(s),
    cAvPrice: averagePriceReport(s, cFirms, 'consumption'),
    kAvPrice: averagePriceReport(s, kFirms, 'capital'),
    hhAvNetIncome: averageNetIncomeReport(s, households),
    consumptionFirmIds: sortedC.map((f) => f.id),
    cFirmsRealSales: sortedC.map((f) => getLag(f.lags, LAG.REALSALES, s.round, 0)),
    cFirmsRealInvestment: sortedC.map(realInvestmentReport),
    aggCFBS: aggregateBalanceSheetReport(s, cFirms),
    aggBBS: aggregateBalanceSheetReport(s, banks),
  };
}
