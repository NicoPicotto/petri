/**
 * Diagnóstico de la economía con G = 0 (paso 1a.0 del plan de la Fase 1).
 *
 * Intercala etapas de MEDICIÓN entre las etapas del modelo. Las sondas solo
 * leen el estado: no lo modifican ni usan el generador de azar, así que la
 * corrida medida es idéntica a la normal (lo verifica un test con el hash).
 *
 * Preguntas que responde:
 * - ¿Las empresas no contratan por falta de liquidez (no pueden pagar la masa
 *   salarial deseada) o por falta de demanda (les sobra stock)?
 * - ¿Cuánto es ahorro forzoso de los hogares (quisieron gastar y no pudieron) y
 *   cuánto retienen las empresas?
 * - ¿Cuánto dinero hay en relación con la masa salarial de pleno empleo?
 */

import {
  DEFAULT_KNOBS,
  PARAMS,
  PHASE0_CONFIG,
  PHASE0_STAGES,
  closeMonth,
  createWarmState,
  firmsPlan,
  goodsMarket,
  government,
  laborMarket,
  openMonth,
  production,
  profits,
  step,
  type Knobs,
  type SimConfig,
  type SimState,
  type Stage,
} from '../../src/index';

export const G0_KNOBS: Knobs = { publicSpending: 0, structuralDeficitShare: 0 };

export interface MonthDiag {
  unemployment: number;
  output: number;
  priceIndex: number;
  avgWage: number;
  /** Empresas que quieren más trabajadores de los que pueden pagar. */
  liquidityConstrainedFirms: number;
  /** Puestos deseados que no se pueden pagar (suma sobre empresas). */
  jobsLostToLiquidity: number;
  /** Puestos deseados por todas las empresas (después de R1, antes del límite de liquidez). */
  desiredJobs: number;
  /** Empresas a las que les sobró stock (señal de falta de demanda). */
  firmsWithUnsoldStock: number;
  /** Unidades sin vender / producidas. */
  unsoldShare: number;
  /** Gasto que los hogares quisieron hacer (y podían pagar) pero no consiguieron. */
  forcedSaving: number;
  householdSpending: number;
  /** Variación de los depósitos de hogares y empresas en el mes. */
  householdSaving: number;
  firmSaving: number;
  /** Ganancia bruta positiva que las empresas no repartieron. */
  retainedProfits: number;
  dividends: number;
  wageBill: number;
  /** Depósitos privados al cierre del mes. */
  money: number;
}

const ALPHA = PARAMS.laborProductivity;

function sumDeposits<T extends { positions: { deposits: number } }>(xs: readonly T[]): number {
  let total = 0;
  for (const x of xs) total += x.positions.deposits;
  return total;
}

/** Arma las etapas de la Fase 0 con sondas intercaladas. `out` recibe un registro por mes. */
export function instrumentedStages(out: MonthDiag[]): Stage[] {
  let rec: MonthDiag;
  let hhDepositsStart = 0;
  let firmDepositsStart = 0;
  let budgets: number[] = [];
  let depositsBeforeGoods: number[] = [];
  let produced = 0;

  const afterOpen: Stage = (state) => {
    rec = {
      unemployment: 0,
      output: 0,
      priceIndex: 0,
      avgWage: 0,
      liquidityConstrainedFirms: 0,
      jobsLostToLiquidity: 0,
      desiredJobs: 0,
      firmsWithUnsoldStock: 0,
      unsoldShare: 0,
      forcedSaving: 0,
      householdSpending: 0,
      householdSaving: 0,
      firmSaving: 0,
      retainedProfits: 0,
      dividends: 0,
      wageBill: 0,
      money: 0,
    };
    hhDepositsStart = sumDeposits(state.households);
    firmDepositsStart = sumDeposits(state.firms);
  };

  // Misma cuenta que R3 en firmsPlan: deseados contra los que puede pagar.
  const afterPlan: Stage = (state) => {
    for (const firm of state.firms) {
      const desired = Math.ceil(firm.plannedOutput / ALPHA - 1e-9);
      const affordable = Math.floor(firm.positions.deposits / firm.wage);
      rec.desiredJobs += desired;
      if (affordable < desired) {
        rec.liquidityConstrainedFirms += 1;
        rec.jobsLostToLiquidity += desired - affordable;
      }
    }
  };

  // Misma cuenta que R5 en goodsMarket: gasto deseado, acotado por los depósitos.
  const beforeGoods: Stage = (state) => {
    produced = state.firms.reduce((acc, firm) => acc + firm.stock, 0);
    budgets = state.households.map((hh) =>
      Math.min(
        Math.floor(PARAMS.consumeOutOfIncome * hh.incomeLastMonth + PARAMS.consumeOutOfWealth * hh.depositsAtMonthStart),
        hh.positions.deposits,
      ),
    );
    depositsBeforeGoods = state.households.map((hh) => hh.positions.deposits);
  };

  const afterGoods: Stage = (state) => {
    state.households.forEach((hh, i) => {
      const spent = depositsBeforeGoods[i]! - hh.positions.deposits;
      rec.householdSpending += spent;
      rec.forcedSaving += Math.max(0, budgets[i]! - spent);
    });
    let unsold = 0;
    for (const firm of state.firms) {
      unsold += firm.stock;
      if (firm.stock > 0) rec.firmsWithUnsoldStock += 1;
    }
    rec.unsoldShare = produced > 0 ? unsold / produced : 0;
  };

  const afterProfits: Stage = (state) => {
    for (const firm of state.firms) {
      rec.wageBill += firm.wageBill;
      const profit = firm.revenue - firm.wageBill;
      if (profit > 0) rec.retainedProfits += profit;
    }
    rec.dividends = state.fiscal.dividendsThisMonth;
    rec.retainedProfits -= rec.dividends;
  };

  const afterClose: Stage = (state) => {
    const hh = sumDeposits(state.households);
    const firms = sumDeposits(state.firms);
    rec.householdSaving = hh - hhDepositsStart;
    rec.firmSaving = firms - firmDepositsStart;
    rec.money = hh + firms;
    rec.unemployment = state.stats.unemployment;
    rec.output = state.stats.output;
    rec.priceIndex = state.stats.priceIndex;
    rec.avgWage = state.firms.reduce((acc, firm) => acc + firm.wage, 0) / state.firms.length;
    out.push(rec);
  };

  const stages: Stage[] = [
    openMonth,
    afterOpen,
    firmsPlan,
    afterPlan,
    laborMarket,
    production,
    government,
    beforeGoods,
    goodsMarket,
    afterGoods,
    profits,
    afterProfits,
    closeMonth,
    afterClose,
  ];
  // Si cambian las etapas del modelo, este diagnóstico tiene que actualizarse.
  const modelStages = stages.filter((s) => PHASE0_STAGES.includes(s));
  if (modelStages.length !== PHASE0_STAGES.length || modelStages.some((s, i) => s !== PHASE0_STAGES[i])) {
    throw new Error('El diagnóstico no coincide con PHASE0_STAGES');
  }
  return stages;
}

export type G0Scenario =
  /** Referencia: la economía de la Fase 0 tal como está (G = 50.000, s = 0). */
  | 'baseline'
  /** G = 0 desde la creación, calentamiento incluido. */
  | 'fromCreation'
  /** Calentamiento normal (G = 50.000) y G = 0 desde el mes 0 visible. */
  | 'switchAfterBurnIn';

export interface DiagRun {
  seed: number;
  scenario: G0Scenario;
  /** Mes 0 visible (antes del primer paso medido). */
  start: SimState;
  months: MonthDiag[];
  end: SimState;
}

export function runG0Diagnostic(seed: number, scenario: G0Scenario, months: number): DiagRun {
  const knobs = scenario === 'baseline' ? DEFAULT_KNOBS : G0_KNOBS;
  const config: SimConfig =
    scenario === 'fromCreation'
      ? { ...PHASE0_CONFIG, burnInKnobs: G0_KNOBS, knobs: G0_KNOBS }
      : { ...PHASE0_CONFIG, knobs };
  const start = createWarmState(seed, config);
  const records: MonthDiag[] = [];
  const stages = instrumentedStages(records);
  let state = start;
  for (let t = 0; t < months; t++) state = step(state, knobs, { stages });
  return { seed, scenario, start, months: records, end: state };
}

export interface DiagSummary {
  seed: number;
  /** Promedios de la ventana [from, to) de meses visibles. */
  unemployment: number;
  liquidityConstrainedFirmShare: number;
  /** Puestos perdidos por liquidez / hogares. */
  jobsLostToLiquidityShare: number;
  /** Puestos deseados / hogares. */
  desiredJobsShare: number;
  firmsWithUnsoldStockShare: number;
  unsoldShare: number;
  /** Ahorro forzoso / gasto de los hogares. */
  forcedSavingShare: number;
  /** Ganancias retenidas / masa salarial. */
  retainedShare: number;
  /** Dinero privado / masa salarial de pleno empleo (salario promedio × hogares). */
  moneyToFullEmploymentWageBill: number;
  /** Margen precio / costo unitario. */
  markup: number;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function summarize(run: DiagRun, from: number, to: number): DiagSummary {
  const w = run.months.slice(from, to);
  const nFirms = run.end.firms.length;
  const nHh = run.end.households.length;
  const ratio = (num: (m: MonthDiag) => number, den: (m: MonthDiag) => number) => {
    const d = w.reduce((a, m) => a + den(m), 0);
    return d > 0 ? w.reduce((a, m) => a + num(m), 0) / d : 0;
  };
  return {
    seed: run.seed,
    unemployment: mean(w.map((m) => m.unemployment)),
    liquidityConstrainedFirmShare: mean(w.map((m) => m.liquidityConstrainedFirms / nFirms)),
    jobsLostToLiquidityShare: mean(w.map((m) => m.jobsLostToLiquidity / nHh)),
    desiredJobsShare: mean(w.map((m) => m.desiredJobs / nHh)),
    firmsWithUnsoldStockShare: mean(w.map((m) => m.firmsWithUnsoldStock / nFirms)),
    unsoldShare: mean(w.map((m) => m.unsoldShare)),
    forcedSavingShare: ratio((m) => m.forcedSaving, (m) => m.householdSpending),
    retainedShare: ratio((m) => m.retainedProfits, (m) => m.wageBill),
    moneyToFullEmploymentWageBill: mean(w.map((m) => m.money / (m.avgWage * nHh))),
    markup: mean(w.map((m) => m.priceIndex / (m.avgWage / ALPHA))),
  };
}
