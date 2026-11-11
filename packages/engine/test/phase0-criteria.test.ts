/**
 * Criterio de salida de la Fase 0 (CLAUDE.md): con más emisión en la cápsula B,
 * la inflación emerge sola. Detalle en docs/fase0-reglas.md.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { PHASE0_CONFIG } from '../src/index';
import { KNOBS_A, KNOBS_B, SEEDS, burnInGap, burnInSeries, runCapsule, type RunSummary } from './helpers/phase0Criteria';

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
  // Los últimos 5 años del calentamiento tienen que parecerse al régimen de
  // largo plazo (años 40 a 50 desde la creación). Se comparan promedios de 5
  // años, no pendientes de 24 meses: esas pendientes son puro ruido (ver
  // docs/fase0-reglas.md, "Calentamiento"). Con 240 meses fallaba: brecha media
  // de desempleo de 4,9 pp y de margen de 0,055. Con 360: 1,5 pp y 0,019. Con 420: 0,1 pp y 0,021.
  it('los últimos 5 años del calentamiento se parecen al régimen de largo plazo', () => {
    const burnIn = PHASE0_CONFIG.burnInTicks ?? 0;
    const gaps = SEEDS.map((seed) => burnInGap(burnInSeries(seed), burnIn));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(mean(gaps.map((g) => g.unemployment)))).toBeLessThan(0.02); // < 2 pp
    expect(Math.abs(mean(gaps.map((g) => g.markup)))).toBeLessThan(0.03);
  }, 120_000);
});
