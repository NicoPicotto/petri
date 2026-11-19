/**
 * P4: el tick del port en el motor (`caiani/tick.ts`, aprobado por Nico el 2026-11-17). Mismo orden de eventos que el arnés
 * del V3 (test/support/v3-steps.ts, que es el que se verifica contra el oráculo) y el mismo estado después de un tick en modo
 * PRNG (hash del estado entero, test/support/state-hash.ts). El hash del estado en PRNG antes y después del cambio (reference/tools/prng-hash.test.ts) está en docs/bitacora-port.md.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import { CAIANI_TICK_EVENTS, PrngCaianiRng, beginPeriod, caianiTick, initialize } from '../src/caiani';
import { EVENTS } from './support/v3-steps';
import { hashState } from './support/state-hash';

/** Cede una macrotarea (evita el "Timeout calling onTaskUpdate" de vitest con la máquina cargada; reglas-caiani.md, sec. 1). */
const yieldTask = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('caianiTick', () => {
  it('los eventos del tick, en el orden de JMAB: 0–37, 74 y los seis bloques del 75 (los mismos que el arnés del V3)', () => {
    const ids = CAIANI_TICK_EVENTS.map((e) => e.id);
    expect(ids).toEqual([...Array.from({ length: 38 }, (_, i) => i), 74, 75.1, 75.2, 75.3, 75.4, 75.5, 75.6]);
    expect(ids).toEqual(EVENTS.map((e) => e.e));
  });

  it('un tick con caianiTick da el mismo estado que la lista del arnés del V3 (semilla 1, PRNG); avanza la ronda y llama al gancho', async () => {
    const rngA = new PrngCaianiRng(Rng.fromSeed(1));
    const a = initialize(rngA);
    const seen: number[] = [];
    caianiTick(a, rngA, { afterEvent: (id, s) => seen.push(id + 1000 * s.round) });
    expect(a.round).toBe(1);
    expect(seen).toEqual(CAIANI_TICK_EVENTS.map((e) => e.id + 1000));
    const hashA = hashState(a);
    await yieldTask();

    const rngB = new PrngCaianiRng(Rng.fromSeed(1));
    const b = initialize(rngB);
    b.round = 1;
    beginPeriod(b.ledger);
    for (const ev of EVENTS) {
      ev.run(b, rngB);
      await yieldTask();
    }
    // Hash del estado entero en vez de toEqual (mismo contenido, mucho más rápido).
    expect(hashState(b)).toBe(hashA);
  }, 120_000);
});
