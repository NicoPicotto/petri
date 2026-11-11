import { describe, expect, it } from 'vitest';
import { Rng, createRngState } from '../src/index';

function take(rng: Rng, n: number): number[] {
  return Array.from({ length: n }, () => rng.nextUint32());
}

describe('PRNG', () => {
  it('misma semilla = misma secuencia', () => {
    expect(take(Rng.fromSeed(123), 1000)).toEqual(take(Rng.fromSeed(123), 1000));
  });

  it('semillas distintas = secuencias distintas', () => {
    expect(take(Rng.fromSeed(1), 10)).not.toEqual(take(Rng.fromSeed(2), 10));
  });

  it('el estado se puede guardar, serializar y reanudar', () => {
    const rng = Rng.fromSeed(99);
    take(rng, 50);
    const saved = JSON.parse(JSON.stringify(rng.toState()));
    const expected = take(rng, 100);
    expect(take(new Rng(saved), 100)).toEqual(expected);
  });

  it('nextFloat está en [0, 1) y nextInt en [0, n)', () => {
    const rng = Rng.fromSeed(5);
    for (let i = 0; i < 10_000; i++) {
      const x = rng.nextFloat();
      expect(x >= 0 && x < 1).toBe(true);
      const k = rng.nextInt(7);
      expect(Number.isInteger(k) && k >= 0 && k < 7).toBe(true);
    }
  });

  it('distribución aproximadamente uniforme', () => {
    const rng = Rng.fromSeed(2024);
    const buckets = new Array<number>(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) buckets[rng.nextInt(10)]!++;
    for (const count of buckets) expect(Math.abs(count - n / 10)).toBeLessThan(n / 100);
  });

  it('el estado son 4 enteros de 32 bits sin signo', () => {
    for (const w of createRngState(0)) expect(Number.isInteger(w) && w >= 0 && w < 2 ** 32).toBe(true);
  });
});
