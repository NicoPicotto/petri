/**
 * Paso 1a.1 de la Fase 1: volatilidad según el tamaño de la cápsula.
 *
 * Hipótesis de la Fase 0 ("Limitaciones conocidas" en docs/fase0-reglas.md):
 * la volatilidad mensual alta del desempleo y la inflación viene del tamaño
 * chico (500 hogares, 30 empresas). Si el ruido es idiosincrático de cada
 * empresa, el desvío tendría que caer más o menos como 1/√N.
 *
 * Todo escala en proporción a la Fase 0: empresas = 6% de los hogares y gasto
 * público = 100 pesos por hogar por mes (calentamiento y corrida).
 */

import { PARAMS, PHASE0_CONFIG, createWarmState, step, type Knobs, type SimConfig } from '../../src/index';

export const SIZES = [500, 1000, 2000, 4000] as const;
/** Meses visibles medidos después del calentamiento: 20 años. */
export const SCALE_MONTHS = 240;

/** Gasto por hogar de la Fase 0: 5.000.000 centavos / 500 hogares. */
const SPENDING_PER_HOUSEHOLD = 10_000;

export function scaledConfig(households: number): SimConfig {
  const knobs: Knobs = { publicSpending: SPENDING_PER_HOUSEHOLD * households, structuralDeficitShare: 0 };
  return {
    ...PHASE0_CONFIG,
    households,
    firms: Math.round((households * PHASE0_CONFIG.firms) / PHASE0_CONFIG.households),
    knobs,
    burnInKnobs: knobs,
  };
}

export interface VolatilityRun {
  households: number;
  seed: number;
  meanUnemployment: number;
  /** Desvío del desempleo mensual alrededor de su media (en fracción). */
  sdUnemployment: number;
  /** Desvío del cambio mensual del desempleo. */
  sdUnemploymentChange: number;
  /** Media y desvío de la inflación mensual. */
  meanInflation: number;
  sdInflation: number;
  /** Desvío de la inflación anualizada en ventanas móviles de 5 años. */
  sdFiveYearInflation: number;
  /** Rango (mín, máx) de esas ventanas. */
  fiveYearRange: [number, number];
  meanMarkup: number;
  /** Milisegundos por mes, sin el calentamiento. */
  msPerTick: number;
  /** Milisegundos del calentamiento completo. */
  burnInMs: number;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: readonly number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

export function runVolatility(households: number, seed: number, months = SCALE_MONTHS): VolatilityRun {
  const config = scaledConfig(households);
  const knobs = config.knobs!;
  const t0 = performance.now();
  let state = createWarmState(seed, config);
  const t1 = performance.now();
  const unemployment: number[] = [];
  const inflation: number[] = [];
  const prices: number[] = [state.stats.priceIndex];
  const markup: number[] = [];
  for (let t = 0; t < months; t++) {
    state = step(state, knobs);
    unemployment.push(state.stats.unemployment);
    inflation.push(state.stats.inflation);
    prices.push(state.stats.priceIndex);
    const avgWage = state.firms.reduce((a, f) => a + f.wage, 0) / state.firms.length;
    markup.push(state.stats.priceIndex / (avgWage / PARAMS.laborProductivity));
  }
  const t2 = performance.now();
  const windows: number[] = [];
  for (let t = 60; t < prices.length; t++) windows.push((prices[t]! / prices[t - 60]!) ** (1 / 5) - 1);
  return {
    households,
    seed,
    meanUnemployment: mean(unemployment),
    sdUnemployment: sd(unemployment),
    sdUnemploymentChange: sd(unemployment.slice(1).map((u, i) => u - unemployment[i]!)),
    meanInflation: mean(inflation),
    sdInflation: sd(inflation),
    sdFiveYearInflation: sd(windows),
    fiveYearRange: [Math.min(...windows), Math.max(...windows)],
    meanMarkup: mean(markup),
    msPerTick: (t2 - t1) / months,
    burnInMs: t1 - t0,
  };
}
