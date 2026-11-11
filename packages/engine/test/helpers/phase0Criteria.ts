/**
 * Corridas del criterio de salida de la Fase 0 (CLAUDE.md, roadmap).
 * Las usan los tests (phase0-criteria.test.ts) y el reporte (scripts/fase0-report.ts).
 */

import { DEFAULT_KNOBS, PARAMS, PHASE0_CONFIG, createWarmState, step, type Knobs, type SimConfig, type SimState } from '../../src/index';

export const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
/** 50 años visibles, después del calentamiento de PHASE0_CONFIG. */
export const MONTHS = 600;

export const KNOBS_A: Knobs = { ...DEFAULT_KNOBS, structuralDeficitShare: 0 };
export const KNOBS_B: Knobs = { ...DEFAULT_KNOBS, structuralDeficitShare: 0.5 };

export interface RunSummary {
  seed: number;
  /** Tendencia del nivel de precios desde el mes 0 visible, anualizada (0,01 = 1% anual). */
  annualTrend: number;
  /** Desempleo promedio de los últimos 10 años. */
  lateUnemployment: number;
  /** Desempleo máximo de los últimos 10 años. */
  maxLateUnemployment: number;
  /** Producción mínima en un mes (para detectar colapso). */
  minOutput: number;
  /** Emisión acumulada / gasto acumulado, desde el mes 0 visible. */
  cumulativeEmissionShare: number;
  /** Emisión acumulada desde el mes 0 visible, en millones de pesos. */
  cumulativeEmissionMillions: number;
  /** Depósitos privados al final / al mes 0 visible. */
  moneyGrowth: number;
  /** Nivel de precios al final / al mes 0 visible. */
  priceGrowth: number;
}

function privateDeposits(state: SimState): number {
  let total = 0;
  for (const hh of state.households) total += hh.positions.deposits;
  for (const firm of state.firms) total += firm.positions.deposits;
  return total;
}

/** Pendiente por mínimos cuadrados de ln(P) contra el mes, anualizada. */
export function annualizedTrend(prices: readonly number[]): number {
  const n = prices.length;
  const ys = prices.map((p) => Math.log(p));
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => {
    num += (x - xMean) * (y - yMean);
    den += (x - xMean) ** 2;
  });
  return Math.exp((num / den) * 12) - 1;
}

export function runCapsule(seed: number, knobs: Knobs): RunSummary {
  let state = createWarmState(seed, { ...PHASE0_CONFIG, knobs });
  const moneyAtStart = privateDeposits(state);
  const prices: number[] = [state.stats.priceIndex];
  const lateUnemployment: number[] = [];
  let minOutput = Infinity;
  let emission = 0;
  let spending = 0;
  for (let t = 1; t <= MONTHS; t++) {
    state = step(state, knobs);
    minOutput = Math.min(minOutput, state.stats.output);
    prices.push(state.stats.priceIndex);
    emission += state.fiscal.advancesThisMonth;
    spending += state.fiscal.spendingThisMonth;
    if (t > MONTHS - 120) lateUnemployment.push(state.stats.unemployment);
  }
  return {
    seed,
    annualTrend: annualizedTrend(prices),
    lateUnemployment: lateUnemployment.reduce((a, b) => a + b, 0) / lateUnemployment.length,
    maxLateUnemployment: Math.max(...lateUnemployment),
    minOutput,
    cumulativeEmissionShare: spending > 0 ? emission / spending : 0,
    cumulativeEmissionMillions: emission / 100 / 1e6,
    moneyGrowth: privateDeposits(state) / moneyAtStart,
    priceGrowth: (prices[prices.length - 1] as number) / (prices[0] as number),
  };
}

/** Pendiente por mínimos cuadrados (por mes). */
export function slope(ys: readonly number[]): number {
  const n = ys.length;
  const xm = (n - 1) / 2;
  const ym = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => {
    num += (x - xm) * (y - ym);
    den += (x - xm) ** 2;
  });
  return num / den;
}

/** Meses desde la creación con los que se define el "régimen de largo plazo": años 40 a 50. */
export const REGIME_FROM = 480;
export const REGIME_TO = 600;

export interface BurnInSeries {
  seed: number;
  /** Desempleo y margen precio/costo de cada mes desde la creación (índice 0 = mes 1). */
  unemployment: number[];
  markup: number[];
}

/** Corre `months` meses desde la creación con las perillas del calentamiento de `config`. */
export function burnInSeries(seed: number, months = REGIME_TO, config: SimConfig = PHASE0_CONFIG): BurnInSeries {
  const knobs = config.burnInKnobs ?? DEFAULT_KNOBS;
  // Mismo camino que createWarmState: estado inicial + pasos con perillas fijas.
  let state = createWarmState(seed, { ...config, burnInTicks: 0, knobs });
  const unemployment: number[] = [];
  const markup: number[] = [];
  for (let t = 1; t <= months; t++) {
    state = step(state, knobs);
    const avgWage = state.firms.reduce((a, f) => a + f.wage, 0) / state.firms.length;
    unemployment.push(state.stats.unemployment);
    markup.push(state.stats.priceIndex / (avgWage / PARAMS.laborProductivity));
  }
  return { seed, unemployment, markup };
}

const meanOf = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Diferencia entre el promedio de los últimos 5 años de un calentamiento de
 * `burnIn` meses y el promedio del régimen de largo plazo (años 40 a 50).
 */
export function burnInGap(series: BurnInSeries, burnIn: number): { unemployment: number; markup: number } {
  const last5 = (xs: number[]) => meanOf(xs.slice(burnIn - 60, burnIn));
  const regime = (xs: number[]) => meanOf(xs.slice(REGIME_FROM, REGIME_TO));
  return {
    unemployment: last5(series.unemployment) - regime(series.unemployment),
    markup: last5(series.markup) - regime(series.markup),
  };
}
