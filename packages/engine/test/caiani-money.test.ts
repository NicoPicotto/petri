import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import { MICRO_PER_UNIT, allocateLargestRemainder, toMicro } from '../src/caiani/money';

describe('caiani/money: µ', () => {
  it('1 unidad de Caiani = 10⁶ µ; toMicro redondea una sola vez', () => {
    expect(MICRO_PER_UNIT).toBe(1_000_000);
    expect(toMicro(5)).toBe(5_000_000); // salario inicial de Caiani
    expect(toMicro(1.03)).toBe(1_030_000);
    expect(toMicro(0.0000004)).toBe(0);
    expect(toMicro(0.0000005)).toBe(1); // mitad hacia arriba
    expect(Object.is(toMicro(-0.0000003), 0)).toBe(true); // sin −0
    expect(() => toMicro(Number.NaN)).toThrow();
  });
});

describe('caiani/money: restos mayores', () => {
  it('caso a mano: 10 µ en tres partes iguales; el resto va al id más chico', () => {
    // Cuotas 3,33 cada una: pisos 3, 3, 3; sobra 1; restos empatados → id 3.
    expect(allocateLargestRemainder(10, [1, 1, 1], [5, 3, 9])).toEqual([3, 4, 3]);
  });

  it('caso a mano: gana el resto más grande', () => {
    // 100 µ con pesos 1, 2, 4 (suma 7): cuotas 14,29, 28,57, 57,14 → pisos 14, 28, 57 (99); el resto
    // más grande es 0,57 (peso 2).
    expect(allocateLargestRemainder(100, [1, 2, 4], [0, 1, 2])).toEqual([14, 29, 57]);
  });

  it('los pesos cero no reciben nada', () => {
    expect(allocateLargestRemainder(7, [0, 1, 0, 1], [0, 1, 2, 3])).toEqual([0, 4, 0, 3]);
  });

  it('la suma es exacta con 8.000 pesos al azar y montos grandes', () => {
    const rng = Rng.fromSeed(7);
    for (let rep = 0; rep < 20; rep++) {
      const n = 8000;
      const w = Array.from({ length: n }, () => rng.nextFloat() * rng.nextFloat() * 1000);
      const ids = Array.from({ length: n }, (_, i) => i);
      const total = rng.nextInt(2_000_000_000) * 1000 + rng.nextInt(1000);
      const parts = allocateLargestRemainder(total, w, ids);
      expect(parts.reduce((s, x) => s + x, 0)).toBe(total);
      expect(parts.every((x) => Number.isSafeInteger(x) && x >= 0)).toBe(true);
    }
  });
});
