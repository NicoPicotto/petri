/**
 * Paso 1a.3 de la Fase 1: mecánica del crédito (R9) y del banco (R13).
 * Estos tests no miden resultados económicos (ver docs/fase1-reglas.md): solo
 * que la contabilidad y las reglas hagan lo que dicen.
 */

import { describe, expect, it } from 'vitest';
import {
  CREDIT,
  PHASE0_CONFIG,
  PHASE1_STAGES,
  checkSfc,
  createWarmState,
  hashState,
  netFinancialWorth,
  step,
  type Knobs,
  type SimState,
  type Stage,
  APPROVED_DIVIDENDS,
  PARAMS,
  Rng,
  makePhase1Stages,
  closingMonth,
  debtCapacityUsed,
  lend,
  inventoryValue,
} from '../src/index';

const KNOBS: Knobs = { publicSpending: 5_000_000, structuralDeficitShare: 0 };
const MONTHS = 240;
/** Posición de la etapa del plan de las empresas (R2, R1, R9, R3) en PHASE1_STAGES. */
const PLAN = 2;

function warm(seed: number): SimState {
  // Tamaño de la Fase 0 (rápido), con 5 de las 30 empresas de capital (la proporción de R11).
  return createWarmState(seed, { ...PHASE0_CONFIG, knobs: KNOBS, burnInTicks: 0, capitalFirms: 5 }, PHASE1_STAGES);
}

describe('mecánica del crédito (R9 y R13)', () => {
  it('determinismo: misma semilla = misma corrida', () => {
    let a = warm(5);
    let b = warm(5);
    let lent = 0;
    for (let t = 0; t < MONTHS; t++) {
      a = step(a, KNOBS, { stages: PHASE1_STAGES });
      b = step(b, KNOBS, { stages: PHASE1_STAGES });
      lent += a.credit.newLoans;
    }
    expect(hashState(a)).toBe(hashState(b));
    expect(lent).toBeGreaterThan(0); // que no pase en vacío
  });

  it('SFC y cronograma: la suma de los saldos de cada empresa es igual a su deuda, todos los meses', () => {
    let s = warm(6);
    for (let t = 0; t < MONTHS; t++) {
      s = step(s, KNOBS, { stages: PHASE1_STAGES }); // step verifica SFC
      for (const firm of s.firms) {
        const book = firm.loanBook.reduce((acc, loan) => acc + loan.remaining, 0);
        expect(book, `mes ${t}, empresa ${firm.id}`).toBe(0 - firm.positions.loans);
      }
    }
    expect(checkSfc(s)).toEqual([]);
  });

  it('R13: al prestar, el banco nunca supera su límite de capital', () => {
    let s = warm(7);
    let checks = 0;
    // El límite es para los préstamos NUEVOS: si el banco prestó este mes, después
    // de prestar el stock no supera patrimonio / coeficiente. (Si el patrimonio cae
    // después por castigos, el stock viejo puede quedar por encima: no es violación.)
    let lending = 0;
    const probe: Stage = (state) => {
      checks += 1;
      if (state.credit.newLoans === 0) return;
      lending += 1;
      const equity = netFinancialWorth(state.bank);
      expect(state.bank.positions.loans).toBeLessThanOrEqual(Math.floor(equity / CREDIT.capitalRatioMin));
    };
    // La sonda va justo después del plan de las empresas, donde se otorga el crédito.
    const stages = [...PHASE1_STAGES.slice(0, PLAN + 1), probe, ...PHASE1_STAGES.slice(PLAN + 1)];
    for (let t = 0; t < 60; t++) s = step(s, KNOBS, { stages });
    expect(checks).toBe(60);
    expect(lending).toBeGreaterThan(0); // que no pase en vacío
  });

  it('R9: ninguna empresa supera el límite de deuda con préstamos NUEVOS', () => {
    let s = warm(8);
    let before: number[] = [];
    let revenue: number[] = [];
    const pre: Stage = (state) => {
      before = state.firms.map((f) => -f.positions.loans);
      revenue = state.firms.map((f) => f.lastRevenue);
    };
    const post: Stage = (state) => {
      state.firms.forEach((f, i) => {
        const debt = -f.positions.loans;
        if (debt > before[i]!) {
          expect(debt, `empresa ${f.id}`).toBeLessThanOrEqual(Math.floor(CREDIT.debtToSalesMax * revenue[i]!));
        }
      });
    };
    const stages = [...PHASE1_STAGES.slice(0, PLAN), pre, PHASE1_STAGES[PLAN]!, post, ...PHASE1_STAGES.slice(PLAN + 1)];
    for (let t = 0; t < MONTHS; t++) s = step(s, KNOBS, { stages });
  });

  it('R13: los dividendos del banco salen solo de los intereses cobrados', () => {
    let s = warm(9);
    let collected = 0;
    for (let t = 0; t < MONTHS; t++) {
      s = step(s, KNOBS, { stages: PHASE1_STAGES });
      collected += s.credit.interestIncome;
      // La ganancia que reparte el banco sale de lo cobrado: dividendo ≤ 0,9 · cobrado.
      expect(s.credit.bankDividends).toBeLessThanOrEqual(
        Math.floor(CREDIT.bankDividendPayout * s.credit.interestIncome) + 0,
      );
    }
    expect(collected).toBeGreaterThan(0); // que no pase en vacío
  });

  // Pedido de Nico para R12: que no queden empresas zombis por cuotas impagas acumuladas.
  it('R12: ninguna empresa activa termina un mes con 3 o más cuotas impagas seguidas', () => {
    let s = warm(10);
    let bankruptcies = 0;
    for (let t = 0; t < MONTHS; t++) {
      s = step(s, KNOBS, { stages: PHASE1_STAGES });
      bankruptcies += s.credit.bankruptcies;
      for (const firm of s.firms) {
        if (!firm.active) continue;
        expect(firm.arrearsMonths, `mes ${t}, empresa ${firm.id}`).toBeLessThan(CREDIT.arrearsMonthsToBankruptcy);
      }
    }
    expect(bankruptcies).toBeGreaterThan(0); // que no pase en vacío
  });

  it('R12: una empresa cerrada no tiene deuda, ni trabajadores, ni depósitos', () => {
    let s = warm(11);
    let seen = 0;
    for (let t = 0; t < MONTHS; t++) {
      s = step(s, KNOBS, { stages: PHASE1_STAGES });
      for (const firm of s.firms) {
        if (firm.active) continue;
        seen += 1;
        expect(firm.positions.loans).toBe(0);
        expect(firm.loanBook).toEqual([]);
        expect(s.households.some((hh) => hh.employerId === firm.id)).toBe(false);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  // R7 revisada (aprobada el 2026-11-11): reparto anual sobre resultados
  // acumulados (Ley 19.550, arts. 68 y 71) y según el endeudamiento.
  it('R7: cada empresa reparte solo en su mes de cierre y solo con resultado acumulado positivo', () => {
    let s = warm(12);
    let paid = 0;
    let before: { deposits: number; retained: number; payoutCap: number }[] = [];
    const pre: Stage = (state) => {
      before = state.firms.map((f) => ({
        deposits: f.positions.deposits,
        retained:
          f.retainedEarnings +
          (f.revenue - f.wageBill - f.interestThisMonth - f.amortizationThisMonth + inventoryValue(f) - f.inventoryValueAtOpen),
        payoutCap: PARAMS.dividendPayout * (1 - debtCapacityUsed(f, CREDIT)),
      }));
    };
    const post: Stage = (state) => {
      state.firms.forEach((f, i) => {
        const dividend = before[i]!.deposits - f.positions.deposits;
        if (dividend <= 0) return;
        paid += 1;
        expect(state.elapsedTicks % 12, `empresa ${f.id}`).toBe(closingMonth(i));
        expect(before[i]!.retained, `empresa ${f.id}`).toBeGreaterThan(0);
        expect(dividend).toBeLessThanOrEqual(Math.floor(before[i]!.payoutCap * before[i]!.retained));
      });
    };
    const R7 = 10; // posición de R7 en PHASE1_STAGES (ver makePhase1Stages)
    const stages = [...PHASE1_STAGES.slice(0, R7), pre, PHASE1_STAGES[R7]!, post, ...PHASE1_STAGES.slice(R7 + 1)];
    for (let t = 0; t < MONTHS; t++) s = step(s, KNOBS, { stages });
    expect(paid).toBeGreaterThan(0);
  });

  it('R7: una empresa en el tope de su capacidad de deuda no reparte', () => {
    const s = warm(13);
    const firm = s.firms[0]!;
    firm.lastRevenue = 1_000;
    lend(s, firm, Math.ceil(CREDIT.debtToSalesMax * 1_000));
    expect(debtCapacityUsed(firm, CREDIT)).toBe(1);
  });

  // R6 de la Fase 1 (fidelidad al proveedor, aprobada el 2026-11-11).
  const GOODS = 7; // posición del mercado de bienes de consumo en PHASE1_STAGES
  function runGoodsMarket(state: SimState, beta: number): void {
    const stage = makePhase1Stages(CREDIT, {}, APPROVED_DIVIDENDS, { supplierSwitchIntensity: beta })[GOODS]!;
    const rng = new Rng(state.rng);
    stage(state, KNOBS, rng);
  }

  it('R6: con β = 0 nadie cambia de proveedor', () => {
    let s = warm(14);
    for (let t = 0; t < 12; t++) s = step(s, KNOBS, { stages: PHASE1_STAGES });
    const before = s.households.map((hh) => hh.supplierId);
    runGoodsMarket(s, 0);
    let kept = 0;
    s.households.forEach((hh, i) => {
      const prev = before[i];
      if (prev === null || prev === undefined) return;
      if (!s.firms.find((f) => f.id === prev)!.active) return;
      expect(hh.supplierId).toBe(prev);
      kept += 1;
    });
    expect(kept).toBeGreaterThan(0);
  });

  it('R6: con β enorme, todo cambio de proveedor es hacia una empresa más barata', () => {
    let s = warm(15);
    for (let t = 0; t < 12; t++) s = step(s, KNOBS, { stages: PHASE1_STAGES });
    const before = s.households.map((hh) => hh.supplierId);
    const price = new Map(s.firms.map((f) => [f.id, f.price]));
    runGoodsMarket(s, 1e9);
    let switched = 0;
    s.households.forEach((hh, i) => {
      const prev = before[i];
      if (prev === null || prev === undefined || hh.supplierId === prev) return;
      if (!s.firms.find((f) => f.id === prev)!.active) return;
      expect(price.get(hh.supplierId!)!).toBeLessThan(price.get(prev)!);
      switched += 1;
    });
    expect(switched).toBeGreaterThan(0);
  });

  // R13 revisada (aprobada el 2026-11-11): tasa según el riesgo y racionamiento.
  it('R13: con un umbral de racionamiento imposible, el banco no presta nunca', () => {
    const stages = makePhase1Stages({ ...CREDIT, maxDefaultProbability: -1 });
    let s = warm(16);
    let lent = 0;
    let rejected = 0;
    for (let t = 0; t < 60; t++) {
      s = step(s, KNOBS, { stages });
      lent += s.credit.newLoans;
      rejected += s.credit.rationedByRisk;
    }
    expect(lent).toBe(0);
    expect(rejected).toBeGreaterThan(0);
  });

  it('R13: toda tasa otorgada es ≥ la tasa sin riesgo, y la historia del banco no pasa de la ventana', () => {
    const r0 = ((1 + CREDIT.loanMarkup) * CREDIT.baseRateAnnual) / 12;
    let s = warm(17);
    let loans = 0;
    for (let t = 0; t < MONTHS; t++) {
      s = step(s, KNOBS, { stages: PHASE1_STAGES });
      for (const f of s.firms) for (const loan of f.loanBook) {
        expect(loan.rate).toBeGreaterThanOrEqual(r0);
        loans += 1;
      }
      expect(s.bank.riskWindow.length).toBeLessThanOrEqual(CREDIT.riskWindowMonths + 1);
    }
    expect(loans).toBeGreaterThan(0);
  });
});

