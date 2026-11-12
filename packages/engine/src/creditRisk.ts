/**
 * Estimación del riesgo de crédito (R13 revisada, aprobada el 2026-11-11).
 *
 * Fuente: Assenza, Delli Gatti & Grazzini (2015), JEDC 50 (CESifo WP 4765,
 * sección 8): el banco estima la probabilidad de quiebra de cada deudor con
 * una regresión logística sobre su apalancamiento, usando su propia historia
 * de deudores (apalancamiento, sobrevivió o quebró).
 *
 * Adaptación: las observaciones se guardan agregadas por tramo de
 * apalancamiento (conteos por mes), y la logística se ajusta sobre los
 * centros de los tramos (regresión logística agrupada). Todo con las cuatro
 * operaciones y `expNeg`, con cantidad fija de iteraciones (determinismo).
 */

import { expNeg } from './detmath';

/** Observaciones de un mes: deudores y quiebras por tramo, y pérdidas. */
export interface RiskMonth {
  /** Deudores observados por tramo de apalancamiento. */
  borrowers: number[];
  /** Quiebras por tramo. */
  defaults: number[];
  /** Deuda de los que quebraron y monto castigado (para la pérdida dada la quiebra). */
  defaultedDebt: number;
  writtenOff: number;
}

export type RiskEstimator = 'none' | 'frequency' | 'logistic' | 'bands';

export interface RiskModel {
  /** Con qué se estimó φ este mes. */
  estimator: RiskEstimator;
  /** Parámetros de la logística φ(λ) = 1 / (1 + e^−(a + b·λ)), si se usó. */
  a: number;
  b: number;
  /** Probabilidad por tramo grueso (fallback) o frecuencia global, según el estimador. */
  bandProbabilities: number[];
  overallFrequency: number;
  /** Pérdida dada la quiebra, observada en la ventana. */
  lossGivenDefault: number;
}

export function emptyRiskMonth(bins: number): RiskMonth {
  return { borrowers: new Array<number>(bins).fill(0), defaults: new Array<number>(bins).fill(0), defaultedDebt: 0, writtenOff: 0 };
}

/** Tramo de apalancamiento de λ ∈ [0, 1]. */
export function leverageBin(leverage: number, bins: number): number {
  const clamped = Math.min(1, Math.max(0, leverage));
  return Math.min(bins - 1, Math.floor(clamped * bins));
}

/** σ(z) = 1 / (1 + e^−z), estable para z negativos, con expNeg. */
export function logistic(z: number): number {
  if (z >= 0) return 1 / (1 + expNeg(z));
  const e = expNeg(-z);
  return e / (1 + e);
}

export interface LogisticFit {
  a: number;
  b: number;
  /** true si el ajuste es usable: hubo quiebras y sobrevivientes, el último paso de Newton fue chico, parámetros finitos y b > 0. */
  ok: boolean;
}

/**
 * Regresión logística agrupada por Newton-Raphson con `iterations` pasos fijos.
 * x = centro del tramo, n = deudores, d = quiebras.
 * Degenerado si: no hay quiebras o no hay sobrevivientes; la matriz es
 * singular; el último paso no es chico (no convergió); parámetros no finitos;
 * o b ≤ 0 (riesgo que baja con el apalancamiento: contradice la fuente).
 */
export function fitGroupedLogistic(n: readonly number[], d: readonly number[], iterations: number): LogisticFit {
  const bins = n.length;
  let total = 0;
  let defaults = 0;
  for (let i = 0; i < bins; i++) {
    total += n[i]!;
    defaults += d[i]!;
  }
  if (defaults <= 0 || defaults >= total) return { a: 0, b: 0, ok: false };
  // Arranque: constante igual a la frecuencia global (log-odds) aproximada por Newton desde 0.
  let a = 0;
  let b = 0;
  let lastStep = Infinity;
  for (let it = 0; it < iterations; it++) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (let i = 0; i < bins; i++) {
      if (n[i]! <= 0) continue;
      const x = (i + 0.5) / bins;
      const p = logistic(a + b * x);
      const resid = d[i]! - n[i]! * p;
      const w = n[i]! * p * (1 - p);
      g0 += resid;
      g1 += resid * x;
      h00 += w;
      h01 += w * x;
      h11 += w * x * x;
    }
    const det = h00 * h11 - h01 * h01;
    if (!(Math.abs(det) > 1e-12)) return { a, b, ok: false };
    const da = (h11 * g0 - h01 * g1) / det;
    const db = (h00 * g1 - h01 * g0) / det;
    a += da;
    b += db;
    lastStep = Math.max(Math.abs(da), Math.abs(db));
  }
  const ok = Number.isFinite(a) && Number.isFinite(b) && lastStep < 1e-6 && b > 0;
  return { a, b, ok };
}

/**
 * Arma el modelo de riesgo del mes a partir de la ventana de observaciones.
 * - Menos de `minMonths` meses de datos: frecuencia global ('frequency'), o
 *   'none' (φ = 0) si todavía no hubo deudores.
 * - Si no: logística; si es degenerada, frecuencias por `coarseBands` tramos ('bands').
 */
export function estimateRisk(window: readonly RiskMonth[], bins: number, minMonths: number, iterations: number, coarseBands: number): RiskModel {
  const n = new Array<number>(bins).fill(0);
  const d = new Array<number>(bins).fill(0);
  let defaultedDebt = 0;
  let writtenOff = 0;
  for (const m of window) {
    for (let i = 0; i < bins; i++) {
      n[i]! += m.borrowers[i]!;
      d[i]! += m.defaults[i]!;
    }
    defaultedDebt += m.defaultedDebt;
    writtenOff += m.writtenOff;
  }
  const total = n.reduce((acc, x) => acc + x, 0);
  const totalDefaults = d.reduce((acc, x) => acc + x, 0);
  const overallFrequency = total > 0 ? totalDefaults / total : 0;
  // Sin quiebras observadas todavía, se supone pérdida total (conservador).
  const lossGivenDefault = defaultedDebt > 0 ? writtenOff / defaultedDebt : 1;
  const base: RiskModel = { estimator: 'none', a: 0, b: 0, bandProbabilities: [], overallFrequency, lossGivenDefault };
  if (total === 0) return base;
  if (window.length < minMonths) return { ...base, estimator: 'frequency' };
  const fit = fitGroupedLogistic(n, d, iterations);
  if (fit.ok) return { ...base, estimator: 'logistic', a: fit.a, b: fit.b };
  // Fallback: frecuencias por tramos gruesos; un tramo sin datos usa la frecuencia global.
  const per = bins / coarseBands;
  const bandProbabilities: number[] = [];
  for (let k = 0; k < coarseBands; k++) {
    let bn = 0;
    let bd = 0;
    for (let i = Math.floor(k * per); i < Math.floor((k + 1) * per); i++) {
      bn += n[i]!;
      bd += d[i]!;
    }
    bandProbabilities.push(bn > 0 ? bd / bn : overallFrequency);
  }
  return { ...base, estimator: 'bands', bandProbabilities };
}

/** Probabilidad mensual de quiebra que el modelo asigna a un apalancamiento λ. */
export function defaultProbability(model: RiskModel, leverage: number): number {
  switch (model.estimator) {
    case 'none':
      return 0;
    case 'frequency':
      return model.overallFrequency;
    case 'logistic':
      return logistic(model.a + model.b * Math.min(1, Math.max(0, leverage)));
    case 'bands': {
      const k = leverageBin(leverage, model.bandProbabilities.length);
      return model.bandProbabilities[k]!;
    }
  }
}

/**
 * Tasa mensual de no arbitraje para un deudor con probabilidad de quiebra φ y
 * pérdida dada la quiebra LGD: (1 − φ)(1 + r) + φ(1 − LGD) = 1 + r0
 * ⇒ r = (r0 + φ·LGD) / (1 − φ). Con φ = 0 da r0.
 */
export function riskAdjustedRate(baseMonthlyRate: number, phi: number, lossGivenDefault: number): number {
  return (baseMonthlyRate + phi * lossGivenDefault) / (1 - phi);
}
