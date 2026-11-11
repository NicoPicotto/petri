/**
 * Criterio de salida de la Fase 0 (CLAUDE.md): con más emisión en la cápsula B,
 * la inflación emerge sola. Detalle en docs/fase0-reglas.md.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { KNOBS_A, KNOBS_B, SEEDS, burnInTail, runCapsule, slope, type RunSummary } from './helpers/phase0Criteria';

let runsA: RunSummary[] = [];
let runsB: RunSummary[] = [];

beforeAll(() => {
  runsA = SEEDS.map((seed) => runCapsule(seed, KNOBS_A));
  runsB = SEEDS.map((seed) => runCapsule(seed, KNOBS_B));
}, 300_000);

describe('criterio de salida de la Fase 0 (20 semillas)', () => {
  it('línea de base (s = 0): el nivel de precios no tiene tendencia sostenida (< 1% anual)', () => {
    for (const run of runsA) {
      expect(Math.abs(run.annualTrend), `semilla ${run.seed}`).toBeLessThan(0.01);
    }
  });

  it('A/B: la inflación de B (s = 0,5) supera a la de A en todas las semillas', () => {
    for (let i = 0; i < SEEDS.length; i++) {
      expect(runsB[i]!.annualTrend, `semilla ${SEEDS[i]}`).toBeGreaterThan(runsA[i]!.annualTrend);
    }
  });

  // Chequeo de cordura, no un objetivo: la economía no colapsa.
  it('cordura: ninguna cápsula colapsa (produce todos los meses y el desempleo no se dispara)', () => {
    for (const run of [...runsA, ...runsB]) {
      expect(run.minOutput, `semilla ${run.seed}`).toBeGreaterThan(0);
      expect(run.lateUnemployment, `semilla ${run.seed}`).toBeLessThan(0.5);
    }
  });
});

describe('calentamiento (20 semillas)', () => {
  // Al final del calentamiento no tiene que quedar una tendencia sistemática.
  // Con 120 meses fallaba: pendiente media del desempleo −1,36 pp/año y del margen −0,010/año.
  it('desempleo y margen precio/costo sin tendencia sistemática en los últimos 24 meses', () => {
    const tails = SEEDS.map((seed) => burnInTail(seed));
    const uSlopes = tails.map((t) => slope(t.unemployment) * 12);
    const mSlopes = tails.map((t) => slope(t.markup) * 12);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(mean(uSlopes))).toBeLessThan(0.01); // < 1 pp/año
    expect(Math.abs(mean(mSlopes))).toBeLessThan(0.005);
    // Signos repartidos: no más de 15 de 20 pendientes del mismo signo.
    for (const slopes of [uSlopes, mSlopes]) {
      const negatives = slopes.filter((x) => x < 0).length;
      expect(negatives).toBeGreaterThanOrEqual(5);
      expect(negatives).toBeLessThanOrEqual(15);
    }
  }, 120_000);
});
