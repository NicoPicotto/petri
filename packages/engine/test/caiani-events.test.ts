/**
 * P3: eventos del tick contra el oráculo (V3) y casos a mano (V2). Registro en docs/reglas-caiani.md.
 *
 * Método de V3 por evento: el oráculo vuelca el estado antes y después del evento e del tick t
 * (`DUMP_TICKS`, `DUMP_EVENTS`); el port arranca del estado "antes" (reconstruido con `stateFromDump`),
 * corre el evento con el `Rng` en modo oráculo y se compara con el estado "después".
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import {
  MKT,
  OracleCaianiRng,
  PrngCaianiRng,
  adaptiveMarkUpPrice,
  capitalPriceEvent,
  computeExpectationsEvent,
  consumptionLowerBound,
  consumptionPriceEvent,
  initialize,
  parseDraws,
  requiredWorkers,
  targetOutput,
  type CaianiRng,
  type CaianiState,
  type FirmState,
} from '../src/caiani';
import { compareState, readDump, stateFromDump } from './support/jmab-dump';

describe('evento 0 (computeExpectations): casos a mano', () => {
  it('producción deseada: Y* = max(0, Sᵉ + 0,1·Sᵉ − inventario)', () => {
    // Empresa de consumo al inicio: Sᵉ = 320,0000000776429, inventario 32 → 320,0000000854072 (JMAB).
    expect(targetOutput(320.0000000776429, 32, 0.1)).toBe(320.0000000854072);
    expect(targetOutput(100, 10, 0.1)).toBe(100); // empresa de capital: 100 + 10 − 10
    expect(targetOutput(10, 50, 0.1)).toBe(0); // inventario de sobra: no produce
  });

  it('sobre el estado inicial del port: ratios del banco y ganancias del BC', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    computeExpectationsEvent(s);
    // Reservas 2.856,458248 / depósitos 11.070,413… del banco 0.
    expect(s.banks[0]!.liquidityRatio).toBeCloseTo(2856.458248 / 11070.41331, 6);
    expect(s.centralBank.interestsOnBonds).toBe(71_410_000); // 28.564 × 0,0025
    expect(s.centralBank.interestsOnAdvances).toBe(0); // adelantos de saldo 0
    expect(s.centralBank.active[MKT.ADVANCES]).toBe(true);
    expect(s.consumptionFirms.every((c) => c.active[MKT.CAPGOOD])).toBe(true);
  });
});

/** Rng que devuelve una secuencia fija de normales plegadas (para casos a mano). */
function fixedNormals(xs: number[]): CaianiRng {
  let k = 0;
  const no = () => {
    throw new Error('no se esperaba este sorteo');
  };
  return {
    foldedNormal: () => xs[k++]!,
    bernoulli: no,
    shuffle: no,
    shuffleEmployees: no,
    sample: no,
    uniform01: no,
  };
}

describe('eventos 1 y 2 (precios): casos a mano', () => {
  const r = { markUpThreshold: 0.1, markUpAdaptive: 1, markUpSigma: 0.0094 };

  it('margen: baja si inventario/ventas > 0,1 y sube si no; precio = piso·(1 + margen)', () => {
    const f = { markUp: 0.1 } as FirmState;
    // Inventario 20 / ventas 100 = 0,2 > 0,1: margen 0,1 − 1·0,1·0,05 = 0,095; piso 2 → 2·1,095 = 2,19.
    expect(adaptiveMarkUpPrice(f, 20, 2.2, 100, () => 2, fixedNormals([0.05]), r)).toBe(2 * (1 + 0.095));
    expect(f.markUp).toBe(0.1 - 0.1 * 0.05);
    // 5 / 100 = 0,05 ≤ 0,1: sube.
    const g = { markUp: 0.1 } as FirmState;
    adaptiveMarkUpPrice(g, 5, 2.2, 100, () => 2, fixedNormals([0.05]), r);
    expect(g.markUp).toBe(0.1 + 0.1 * 0.05);
  });

  it('con piso 0 usa el piso anterior, precio / (1 + margen anterior)', () => {
    const f = { markUp: 0.25 } as FirmState;
    // Piso anterior 2,5 / 1,25 = 2; margen sube a 0,25·1,1 = 0,275 → 2·1,275.
    expect(adaptiveMarkUpPrice(f, 0, 2.5, 100, () => 0, fixedNormals([0.1]), r)).toBe((2.5 / 1.25) * (1 + 0.25 * 1.1));
  });

  it('trabajadores requeridos: añadas más productivas primero, cantidad / (capital/trabajo)', () => {
    const g = (productivity: number, quantity: number) =>
      ({ productivity, quantity, capitalLaborRatio: 6.4 }) as Parameters<typeof requiredWorkers>[0][number];
    // Producir 30: la añada de productividad 2 (capacidad 20) entera → 10/6,4; faltan 10 → 10 de la de 1 → 10/6,4.
    expect(requiredWorkers([g(1, 50), g(2, 10)], 30)).toBe(10 / 6.4 + 10 / 6.4);
    // Empresa de consumo inicial: 20 añadas de 20, producir 320 → 50 trabajadores.
    expect(Math.round(requiredWorkers(Array.from({ length: 20 }, () => g(1, 20)), 320.0000000854072))).toBe(50);
  });

  it('piso de la empresa de consumo al inicio: 5 × 50 / 320,0000000854072 (JMAB: 0,7812499997914863)', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    computeExpectationsEvent(s);
    expect(consumptionLowerBound(s.consumptionFirms[0]!)).toBe(0.7812499997914863);
  });

  it('piso sin producción deseada: salario × trabajadores para el inventario (sin redondear) / inventario', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    const c = s.consumptionFirms[0]!;
    c.desiredOutput = 0;
    c.consumptionGoods[0]!.quantity = 10;
    // 10 unidades con añadas de productividad 1 y capital/trabajo 6,4: 10/6,4 trabajadores; salario esperado 5.
    expect(consumptionLowerBound(c)).toBe((5 * (10 / 6.4)) / 10);
    c.consumptionGoods[0]!.quantity = 0;
    expect(consumptionLowerBound(c)).toBeNaN(); // 0/0, como JMAB 2015
  });
});

const ORACLE = fileURLToPath(new URL('../../../reference/p0/runs/oracle/', import.meta.url));

/** Corridas de referencia: semilla 12345, volcados al principio del tick y después de los eventos 0–2. */
const RUNS = [
  { run: 'p3-t1', tick: 1 },
  { run: 'p3-t50', tick: 50 },
];

describe.each(RUNS)('V3 por evento contra el oráculo, tick $tick (reference/, fuera de git)', ({ run, tick }) => {
  const dir = `${ORACLE}${run}/state/`;
  const dumpOf = (name: string) => readDump(dir + name);
  const before = `tick-${tick}.jsonl`;
  const after = (e: number) => `tick-${tick}-ev-${e}.jsonl`;
  const available = existsSync(dir + after(2));
  const draws = available ? parseDraws(readFileSync(`${ORACLE}${run}/draws.tsv`, 'utf8')) : [];
  const drawsOf = (event: number) => {
    const rng = new OracleCaianiRng(draws.filter((r) => r.tick === tick && r.event === event));
    rng.tick = tick;
    return rng;
  };
  const check = (s: CaianiState, name: string, label: string) => {
    const r = compareState(s, dumpOf(name));
    console.log(`V3 tick ${tick}, ${label}:`, JSON.stringify(r.counts));
    expect(r.diffs).toEqual([]);
  };

  it.skipIf(!available)('el estado reconstruido desde un volcado coincide con el volcado', () => {
    const d = dumpOf(before);
    const r = compareState(stateFromDump(d), d);
    expect(r.diffs).toEqual([]);
    expect(r.counts.maxAmountDiff).toBe(0);
  }, 120_000);

  it.skipIf(!available)('cada evento desde el volcado anterior (0, 1, 2)', () => {
    const s0 = stateFromDump(dumpOf(before));
    computeExpectationsEvent(s0);
    check(s0, after(0), 'evento 0');
    const s1 = stateFromDump(dumpOf(after(0)));
    const rng1 = drawsOf(1);
    capitalPriceEvent(s1, rng1);
    expect(rng1.remaining).toBe(0);
    check(s1, after(1), 'evento 1');
    const s2 = stateFromDump(dumpOf(after(1)));
    const rng2 = drawsOf(2);
    consumptionPriceEvent(s2, rng2);
    expect(rng2.remaining).toBe(0);
    check(s2, after(2), 'evento 2');
  }, 120_000);

  it.skipIf(!available)('eventos 0, 1 y 2 encadenados desde el principio del tick', () => {
    const s = stateFromDump(dumpOf(before));
    computeExpectationsEvent(s);
    capitalPriceEvent(s, drawsOf(1));
    consumptionPriceEvent(s, drawsOf(2));
    check(s, after(2), 'eventos 0–2');
  }, 120_000);
});
