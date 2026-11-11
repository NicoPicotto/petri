/**
 * Paso 1a.1 de la Fase 1: volatilidad según el tamaño de la cápsula
 * (10 semillas, 500 a 4.000 hogares). Detalle en docs/fase1-reglas.md.
 * Suite lenta: pnpm test:slow (~45 s).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { SIZES, runVolatility, type VolatilityRun } from './helpers/scale';

const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

let bySize: VolatilityRun[][] = [];

beforeAll(() => {
  bySize = SIZES.map((h) => SEEDS.map((seed) => runVolatility(h, seed)));
}, 300_000);

const avg = (i: number, f: (r: VolatilityRun) => number) => mean(bySize[i]!.map(f));

describe('volatilidad según el tamaño (10 semillas)', () => {
  it('el ruido mes a mes baja con cada duplicación del tamaño', () => {
    for (let i = 1; i < SIZES.length; i++) {
      expect(avg(i, (r) => r.sdUnemploymentChange), `${SIZES[i]} hogares`).toBeLessThan(avg(i - 1, (r) => r.sdUnemploymentChange));
      expect(avg(i, (r) => r.sdInflation), `${SIZES[i]} hogares`).toBeLessThan(avg(i - 1, (r) => r.sdInflation));
    }
  });

  it('con 8 veces más hogares, el ruido mes a mes cae a menos de la mitad (1/√N daría 0,35)', () => {
    const last = SIZES.length - 1;
    expect(avg(last, (r) => r.sdUnemploymentChange) / avg(0, (r) => r.sdUnemploymentChange)).toBeLessThan(0.5);
    expect(avg(last, (r) => r.sdInflation) / avg(0, (r) => r.sdInflation)).toBeLessThan(0.5);
  });

  // Hallazgo: el desvío del NIVEL de desempleo baja poco con el tamaño (hay
  // ciclos agregados que no son ruido de tamaño chico). Se deja asentado.
  it('el desvío del nivel de desempleo baja menos que el ruido mes a mes', () => {
    const last = SIZES.length - 1;
    const level = avg(last, (r) => r.sdUnemployment) / avg(0, (r) => r.sdUnemployment);
    const monthly = avg(last, (r) => r.sdUnemploymentChange) / avg(0, (r) => r.sdUnemploymentChange);
    expect(level).toBeGreaterThan(monthly);
  });
});

describe('rendimiento', () => {
  // La app corre hasta 120 meses por segundo por cápsula (un worker por cápsula):
  // el presupuesto es ~8 ms por mes. Medido en Node; el navegador puede ser más lento.
  it('cada tamaño medido entra en el presupuesto de 8 ms por mes', () => {
    SIZES.forEach((h, i) => {
      expect(avg(i, (r) => r.msPerTick), `${h} hogares`).toBeLessThan(8);
    });
  });
});
