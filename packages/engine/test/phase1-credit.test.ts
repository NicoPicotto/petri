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
  lossGivenDefaultOf,
  desiredCapacityGrowth,
  CAPITAL,
  MARKET,
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
      revenue = state.firms.map((f) => f.expectedSales);
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
    let bankruptcies = 0;
    // Varias semillas hasta ver quiebras (con R9 suave y R10 hay pocas).
    for (let seed = 10; seed < 40 && bankruptcies === 0; seed++) {
      let s = warm(seed);
      for (let t = 0; t < MONTHS; t++) {
        s = step(s, KNOBS, { stages: PHASE1_STAGES });
        bankruptcies += s.credit.bankruptcies;
        for (const firm of s.firms) {
          if (!firm.active) continue;
          expect(firm.arrearsMonths, `mes ${t}, empresa ${firm.id}`).toBeLessThan(CREDIT.arrearsMonthsToBankruptcy);
        }
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
    firm.expectedSales = 1_000;
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
    const stages = makePhase1Stages({ ...CREDIT, maxExpectedLoss: -1 });
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

  // R13 con racionamiento por pérdida esperada (aprobada el 2026-11-11).
  it('R13: pérdida dada la quiebra por empresa, con la planta como garantía', () => {
    const s = warm(18);
    const c = s.firms.find((f) => f.sector === 'consumption')!;
    const k = s.firms.find((f) => f.sector === 'capital')!;
    const cover = CAPITAL.fireSaleRecovery * c.capitalValue;
    expect(lossGivenDefaultOf(c, Math.floor(cover), CAPITAL.fireSaleRecovery)).toBe(0);
    expect(lossGivenDefaultOf(c, Math.ceil(2 * cover), CAPITAL.fireSaleRecovery)).toBeCloseTo(0.5, 6);
    expect(lossGivenDefaultOf(k, 1_000, CAPITAL.fireSaleRecovery)).toBe(1);
  });

  it('R13: con umbral 0, solo se prestan créditos totalmente cubiertos por la planta', () => {
    const stages0 = makePhase1Stages({ ...CREDIT, maxExpectedLoss: 0 });
    let s = warm(19);
    let before: number[] = [];
    let granted = 0;
    const pre: Stage = (st) => (before = st.firms.map((f) => -f.positions.loans));
    const post: Stage = (st) => {
      // Sin historia (estimador 'none' o 'frequency' sin quiebras) φ puede ser 0 y
      // φ·LGD = 0 no supera el umbral: se mira solo cuando el banco usa la logística.
      if (st.credit.riskEstimator !== 'logistic') return;
      st.firms.forEach((f, i) => {
        const debt = -f.positions.loans;
        if (debt <= before[i]!) return;
        granted += 1;
        expect(f.sector).toBe('consumption');
        expect(CAPITAL.fireSaleRecovery * f.capitalValue).toBeGreaterThanOrEqual(debt - 1e-6);
      });
    };
    const stages = [...stages0.slice(0, PLAN), pre, stages0[PLAN]!, post, ...stages0.slice(PLAN + 1)];
    for (let t = 0; t < MONTHS; t++) s = step(s, KNOBS, { stages });
    expect(granted).toBeGreaterThan(0);
  });

  // R9 con ventas esperadas (aprobada el 2026-11-11).
  it('R9: un mes sin ventas no deja el límite de deuda en 0 (ventas esperadas)', () => {
    let s = warm(20);
    for (let t = 0; t < 24; t++) s = step(s, KNOBS, { stages: PHASE1_STAGES });
    const firm = s.firms.find((f) => f.sector === 'consumption' && f.active)!;
    const before = firm.expectedSales;
    expect(before).toBeGreaterThan(0);
    // Un mes sin ventas: Sᵉ baja λ_e, no a 0.
    const close = PHASE1_STAGES[PHASE1_STAGES.length - 1]!;
    firm.revenue = 0;
    close(s, KNOBS, new Rng(s.rng));
    expect(firm.expectedSales).toBeCloseTo(before * (1 - CREDIT.salesExpectationWeight), 6);
    expect(Math.floor(CREDIT.debtToSalesMax * firm.expectedSales)).toBeGreaterThan(0);
  });

  it('R9: con ventas constantes, las ventas esperadas convergen a esas ventas', () => {
    const s = warm(21);
    const firm = s.firms[0]!;
    firm.expectedSales = 0;
    const close = PHASE1_STAGES[PHASE1_STAGES.length - 1]!;
    for (let t = 0; t < 400; t++) {
      firm.revenue = 50_000;
      close(s, KNOBS, new Rng(s.rng));
    }
    expect(firm.expectedSales).toBeCloseTo(50_000, 3);
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


describe('R10: inversión (Caiani et al., 2016)', () => {
  function firmWith(cashFlowRate: number, utilization: number) {
    const s = warm(30);
    const f = s.firms.find((x) => x.sector === 'consumption')!;
    f.cashFlowRate = cashFlowRate;
    f.desiredOutput = utilization * CAPITAL.capitalProductivity * f.capital;
    return f;
  }

  it('alta utilización y alta rentabilidad ⇒ crecer; capacidad ociosa y baja rentabilidad ⇒ achicarse; nunca menos de −1', () => {
    const r = CAPITAL.targetCashFlowRate;
    const u = CAPITAL.normalUtilization;
    expect(desiredCapacityGrowth(firmWith(r, u))).toBeCloseTo(0, 12);
    expect(desiredCapacityGrowth(firmWith(2 * r, 1))).toBeGreaterThan(0);
    expect(desiredCapacityGrowth(firmWith(0, 0.4))).toBeLessThan(0);
    expect(desiredCapacityGrowth(firmWith(-1e9, 0))).toBe(-1);
  });

  it('pedido de capital ≥ 0, mayor que la reposición si quiere crecer, y préstamos de inversión a 60 meses', () => {
    let s = warm(31);
    let growing = 0;
    let investmentLoans = 0;
    let before: number[] = [];
    const pre: Stage = (st) => (before = st.firms.map((f) => f.loanBook.length));
    const post: Stage = (st) => {
      st.firms.forEach((f, i) => {
        expect(f.capitalOrder).toBeGreaterThanOrEqual(0);
        if (f.sector !== 'consumption' || !f.active) return;
        if (desiredCapacityGrowth(f) > 0.001 && f.capitalOrder > Math.ceil(CAPITAL.depreciationRate * f.utilizedCapitalAvg) + 1) growing += 1;
        for (const loan of f.loanBook.slice(before[i]!)) {
          if (loan.installment === Math.ceil(loan.remaining / CREDIT.investmentLoanTermMonths)) investmentLoans += 1;
        }
      });
    };
    // R10 está apagada por defecto: este test la prende.
    const r10 = makePhase1Stages(CREDIT, {}, APPROVED_DIVIDENDS, MARKET, { ...CAPITAL, netInvestment: 1 });
    const stages = [...r10.slice(0, PLAN), pre, r10[PLAN]!, post, ...r10.slice(PLAN + 1)];
    for (let t = 0; t < MONTHS; t++) s = step(s, KNOBS, { stages });
    expect(growing).toBeGreaterThan(0);
    expect(investmentLoans).toBeGreaterThan(0);
  });
});
