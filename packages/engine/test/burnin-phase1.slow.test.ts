/**
 * Calentamiento con el tamaño de la Fase 1 (2.000 hogares, 120 empresas), 20
 * semillas. Los últimos 5 años del calentamiento se comparan con el régimen de
 * largo plazo (años 40 a 50 desde la creación). Medido el 2026-11-11:
 * con 360 meses, brecha media de desempleo 1,23 pp (error estándar 0,36) y de
 * margen 0,013; con 420, 0,23 pp (0,39) y −0,002. Ver docs/fase1-reglas.md.
 */

import { describe, expect, it } from 'vitest';
import { PHASE1_CONFIG } from '../src/index';
import { SEEDS, burnInGap, burnInSeries } from './helpers/phase0Criteria';

describe('calentamiento de la Fase 1 (2.000 hogares, 20 semillas)', () => {
  it('los últimos 5 años del calentamiento se parecen al régimen de largo plazo', () => {
    const burnIn = PHASE1_CONFIG.burnInTicks ?? 0;
    // Con las reglas de la Fase 0 (las que usa burnInSeries), que no conocen los
    // sectores de R11: tamaño de la Fase 1 sin empresas de capital.
    const config = { ...PHASE1_CONFIG, capitalFirms: 0 };
    const gaps = SEEDS.map((seed) => burnInGap(burnInSeries(seed, undefined, config), burnIn));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(mean(gaps.map((g) => g.unemployment)))).toBeLessThan(0.01); // < 1 pp
    expect(Math.abs(mean(gaps.map((g) => g.markup)))).toBeLessThan(0.01);
  }, 300_000);
});
