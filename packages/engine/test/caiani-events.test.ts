/**
 * P3: eventos del tick contra el oráculo (V3) y casos a mano (V2). Registro en docs/reglas-caiani.md.
 *
 * Método de V3 por evento: el oráculo vuelca el estado antes y después del evento e del tick t
 * (`DUMP_TICKS`, `DUMP_EVENTS`); el port arranca del estado "antes" (reconstruido con `stateFromDump`),
 * corre el evento con el `Rng` en modo oráculo y se compara con el estado "después".
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import { MKT, PrngCaianiRng, computeExpectationsEvent, initialize, targetOutput } from '../src/caiani';
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

const RUN = fileURLToPath(new URL('../../../reference/p0/runs/oracle/p3-t1/state/', import.meta.url));

describe.skipIf(!existsSync(RUN + 'tick-1-ev-0.jsonl'))('V3 por evento contra el oráculo (reference/, fuera de git)', () => {
  it('el estado reconstruido desde un volcado coincide con el volcado', () => {
    const d = readDump(RUN + 'tick-1.jsonl');
    const r = compareState(stateFromDump(d), d);
    expect(r.diffs).toEqual([]);
    expect(r.counts.maxAmountDiff).toBe(0);
  }, 120_000);

  it('evento 0 del tick 1', () => {
    const s = stateFromDump(readDump(RUN + 'tick-1.jsonl'));
    computeExpectationsEvent(s);
    const r = compareState(s, readDump(RUN + 'tick-1-ev-0.jsonl'));
    console.log('V3 evento 0:', JSON.stringify(r.counts));
    expect(r.diffs).toEqual([]);
  }, 120_000);
});
