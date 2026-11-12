/** R13 revisada: estimación del riesgo de crédito (ver src/creditRisk.ts). */

import { describe, expect, it } from 'vitest';
import {
  defaultProbability,
  emptyRiskMonth,
  estimateRisk,
  fitGroupedLogistic,
  leverageBin,
  logistic,
  riskAdjustedRate,
  type RiskMonth,
} from '../src/index';

const BINS = 20;

describe('logística determinista', () => {
  it('σ(z) coincide con 1 / (1 + Math.exp(−z))', () => {
    for (let z = -30; z <= 30; z += 0.37) {
      expect(logistic(z)).toBeCloseTo(1 / (1 + Math.exp(-z)), 12);
    }
  });

  it('recupera los parámetros de datos generados con una logística conocida', () => {
    const a = -4;
    const b = 3;
    const n = Array.from({ length: BINS }, () => 100_000);
    const d = n.map((count, i) => count * logistic(a + b * ((i + 0.5) / BINS)));
    const fit = fitGroupedLogistic(n, d, 25);
    expect(fit.ok).toBe(true);
    expect(fit.a).toBeCloseTo(a, 6);
    expect(fit.b).toBeCloseTo(b, 6);
  });

  it('degenerado si no hay quiebras, si todos quiebran o si el riesgo baja con el apalancamiento', () => {
    const n = Array.from({ length: BINS }, () => 10);
    expect(fitGroupedLogistic(n, n.map(() => 0), 25).ok).toBe(false);
    expect(fitGroupedLogistic(n, n, 25).ok).toBe(false);
    const decreasing = n.map((count, i) => count * logistic(-1 - 3 * ((i + 0.5) / BINS)));
    expect(fitGroupedLogistic(n, decreasing, 25).ok).toBe(false);
  });
});

describe('estimador con fallbacks', () => {
  function month(borrowersByBin: number[], defaultsByBin: number[]): RiskMonth {
    return { ...emptyRiskMonth(BINS), borrowers: borrowersByBin, defaults: defaultsByBin, defaultedDebt: 100, writtenOff: 80 };
  }

  it('sin datos: φ = 0', () => {
    const model = estimateRisk([], BINS, 24, 25, 5);
    expect(model.estimator).toBe('none');
    expect(defaultProbability(model, 0.9)).toBe(0);
  });

  it('con menos de 24 meses: frecuencia global', () => {
    const w = Array.from({ length: 10 }, () => month(new Array(BINS).fill(5), new Array(BINS).fill(0).map((_, i) => (i === 19 ? 1 : 0))));
    const model = estimateRisk(w, BINS, 24, 25, 5);
    expect(model.estimator).toBe('frequency');
    expect(defaultProbability(model, 0.1)).toBeCloseTo(10 / (10 * 5 * BINS), 12);
    expect(model.lossGivenDefault).toBeCloseTo(0.8, 12);
  });

  it('con 24 meses o más y datos sin quiebras: fallback por tramos (todas en 0)', () => {
    const w = Array.from({ length: 30 }, () => month(new Array(BINS).fill(5), new Array(BINS).fill(0)));
    const model = estimateRisk(w, BINS, 24, 25, 5);
    expect(model.estimator).toBe('bands');
    expect(defaultProbability(model, 0.95)).toBe(0);
  });

  it('con datos bien comportados: logística, creciente en el apalancamiento', () => {
    const borrowers = new Array(BINS).fill(1_000);
    const defaults = borrowers.map((c, i) => Math.round(c * logistic(-5 + 4 * ((i + 0.5) / BINS))));
    const w = Array.from({ length: 30 }, () => month(borrowers, defaults));
    const model = estimateRisk(w, BINS, 24, 25, 5);
    expect(model.estimator).toBe('logistic');
    expect(defaultProbability(model, 0.9)).toBeGreaterThan(defaultProbability(model, 0.1));
  });

  it('tramos: λ = 1 cae en el último tramo', () => {
    expect(leverageBin(1, BINS)).toBe(BINS - 1);
    expect(leverageBin(0, BINS)).toBe(0);
    expect(leverageBin(1.7, BINS)).toBe(BINS - 1);
  });
});

describe('tasa de no arbitraje', () => {
  it('con φ = 0 da la tasa sin riesgo; crece con φ y con la pérdida', () => {
    expect(riskAdjustedRate(0.00375, 0, 0.8)).toBe(0.00375);
    expect(riskAdjustedRate(0.00375, 0.02, 0.8)).toBeGreaterThan(riskAdjustedRate(0.00375, 0.01, 0.8));
    expect(riskAdjustedRate(0.00375, 0.02, 0.9)).toBeGreaterThan(riskAdjustedRate(0.00375, 0.02, 0.5));
  });

  it('el banco cobra en promedio lo mismo que con un deudor sin riesgo', () => {
    const r0 = 0.00375;
    const phi = 0.03;
    const lgd = 0.8;
    const r = riskAdjustedRate(r0, phi, lgd);
    expect((1 - phi) * (1 + r) + phi * (1 - lgd)).toBeCloseTo(1 + r0, 12);
  });
});
