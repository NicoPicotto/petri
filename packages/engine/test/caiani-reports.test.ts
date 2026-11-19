/**
 * P4: casos a mano (V2) de los 8 reportes que lee V4 (src/caiani/reports.ts; aprobados por Nico el 2026-11-17,
 * docs/reglas-caiani.md, sec. 41). El V3 contra los CSV del .jar está en caiani-reports-v3.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import {
  BALANCE_SHEET_STOCKS,
  LAG,
  PrngCaianiRng,
  addAgent,
  aggregateBalanceSheetReport,
  averageNetIncomeReport,
  averagePriceReport,
  caianiReports,
  createLedger,
  firstAsset,
  initialize,
  open,
  realInvestmentReport,
  setLag,
  unemploymentReport,
  type CaianiState,
  type CapitalGoodStock,
  type ConsumptionGoodStock,
  type FirmState,
} from '../src/caiani';

const fresh = () => initialize(new PrngCaianiRng(Rng.fromSeed(1)));

describe('reportes de V4: casos a mano', () => {
  it('desempleo: 1 − ocupados / hogares (ocupado = con empleador; el empleo público cuenta)', () => {
    const s = fresh();
    const firm = s.consumptionFirms[0]!.id;
    s.households.forEach((h, i) => (h.employer = i < 7_400 ? firm : null));
    s.households[0]!.employer = s.government.id; // empleado público: ocupado
    expect(unemploymentReport(s)).toBe(1 - 7_400 / 8_000); // 0,075 (en double, como JMAB: 1 − (double) 7400 / 8000)
  });

  it('precio medio: ponderado por las ventas reales del tick; con ventas totales 0, NaN', () => {
    const s = fresh();
    s.round = 3;
    const [a, b] = [s.consumptionFirms[0]!, s.consumptionFirms[1]!];
    for (const f of s.consumptionFirms) setLag(f.lags, LAG.REALSALES, 3, 0);
    setLag(a.lags, LAG.REALSALES, 3, 10);
    setLag(b.lags, LAG.REALSALES, 3, 30);
    a.consumptionGoods[0]!.price = 1;
    b.consumptionGoods[0]!.price = 2;
    // 1 × 10/40 + 2 × 30/40 = 1,75 (las ventas del período anterior no cuentan).
    setLag(a.lags, LAG.REALSALES, 2, 1_000);
    expect(averagePriceReport(s, s.consumptionFirms, 'consumption')).toBe(1.75);
    setLag(a.lags, LAG.REALSALES, 3, 0);
    setLag(b.lags, LAG.REALSALES, 3, 0);
    expect(averagePriceReport(s, s.consumptionFirms, 'consumption')).toBeNaN();
  });

  it('ingreso neto medio: impuestos recalculados con el patrimonio del momento; el desocupado cobra el seguro', () => {
    const s = fresh();
    const r = s.rules;
    const [e, u] = [s.households[0]!, s.households[1]!];
    const nw = (h: (typeof s.households)[number]) => firstAsset(s.ledger, h.id, 'deposit')!.amount / 1e6; // un depósito, sin bienes ni deudas
    for (const h of [e, u]) {
      h.interestReceived = 0;
      h.dividendsReceived = 0;
      h.consumptionGoods = [];
    }
    e.employer = s.consumptionFirms[0]!.id;
    e.wage = 5;
    u.employer = null;
    u.dividendsReceived = 1_000_000; // 1 unidad de dividendos
    // Salario medio de los ocupados: el de toda la población, como JMAB.
    let w = 0;
    let n = 0;
    for (const h of s.households) if (h.employer !== null) (w += h.wage), (n += 1);
    const taxes = (gross: number, wealth: number) => Math.max(r.householdWealthTaxRate * wealth + r.householdIncomeTaxRate * gross, 0);
    const yE = 5 - taxes(5, nw(e));
    const yU = r.unemploymentBenefit * (w / n) + 1 - taxes(1, nw(u));
    expect(averageNetIncomeReport(s, [e, u])).toBeCloseTo((yE + yU) / 2, 12);
    expect(r.unemploymentBenefit).toBe(0.4); // el seguro: 40% del salario medio de los ocupados (XML 2872)
  });

  it('inversión real: Σ cantidad de las añadas con edad < 0 (las compradas en el tick)', () => {
    const good = (quantity: number, age: number) => ({ quantity, age }) as CapitalGoodStock;
    expect(realInvestmentReport({ capitalGoods: [good(5, -1), good(7, 0), good(9, 3), good(2, -1)] } as FirmState)).toBe(7);
    expect(realInvestmentReport({ capitalGoods: [good(5, 0)] } as FirmState)).toBe(0);
  });

  it('balances agregados: activos − pasivos por tipo, en unidades; el inventario propio a costo, el capital comprado a valor contable', () => {
    const L = createLedger();
    const cb = addAgent(L, 'centralBank');
    const bank = addAgent(L, 'bank');
    const f = addAgent(L, 'consumptionFirm');
    const k = addAgent(L, 'capitalFirm');
    open(L, 'reserves', bank, cb, 3_000_000, {}, 'deposits');
    open(L, 'deposit', f, bank, 2_500_000, {}, 'deposits');
    open(L, 'loan', bank, f, 1_000_000, { rate: 0.01, length: 20, amortization: 'fixedCapital' }, 'loans');
    open(L, 'advance', cb, bank, 200_000, { rate: 0.005, length: 1, amortization: 'onlyInterest' }, 'advances');
    const s = { ledger: L } as unknown as CaianiState;
    const inventory = { quantity: 4, unitCost: 0.5, value: 99, producer: f } as ConsumptionGoodStock; // a costo: 2
    const machine = { quantity: 1, unitCost: 3, value: 10, producer: k } as CapitalGoodStock; // comprado: valor contable 10
    expect(BALANCE_SHEET_STOCKS).toEqual(['CASH', 'DEPOSITS', 'CONSGOODS', 'CAPGOODS', 'LOANS', 'BONDS', 'RESERVES', 'ADVANCES']);
    expect(aggregateBalanceSheetReport(s, [{ id: f, consumptionGoods: [inventory], capitalGoods: [machine] }])).toEqual([0, 2.5, 2, 10, -1, 0, 0, 0]);
    expect(aggregateBalanceSheetReport(s, [{ id: bank }])).toEqual([0, -2.5, 0, 0, 1, 0, 3, -0.2]);
  });

  it('caianiReports sobre el estado inicial: columnas por empresa en orden de id, 8 columnas por balance', () => {
    const s = fresh();
    const r = caianiReports(s);
    expect(r.consumptionFirmIds).toEqual([...r.consumptionFirmIds].sort((x, y) => x - y));
    expect(r.cFirmsRealSales).toHaveLength(100);
    expect(r.cFirmsRealInvestment.every((x) => x === 0)).toBe(true); // ninguna añada con edad < 0 al inicio
    expect(r.aggCFBS).toHaveLength(8);
    expect(r.aggBBS).toHaveLength(8);
    expect(r.aggBBS[1]).toBeLessThan(0); // los depósitos son pasivos de los bancos
    expect(r.aggCFBS[4]).toBeLessThan(0); // los préstamos, de las empresas
  });
});
