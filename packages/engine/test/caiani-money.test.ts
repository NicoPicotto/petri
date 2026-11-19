import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import { CarryRounder, MICRO_PER_UNIT, allocateLargestRemainder, toMicro } from '../src/caiani/money';

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

/**
 * Redondeo con arrastre (`CarryRounder`; decisión de Nico, 2026-11-13; reglas-caiani.md, sec. 1): mᵢ = round(Sᵢ) − round(Sᵢ₋₁),
 * con Sᵢ la suma acumulada en `double` (la misma que acumula JMAB). Lo usan el evento 8 (intereses de los depósitos de
 * cada banco) y las cuotas (`installments`, eventos 9 y 20). Garantías: cada monto a < 1 µ de su `double` y la suma de
 * cualquier tramo seguido a < 1 µ de la suma de sus `double` (cuando las sumas en `double` son exactas); la suma de un
 * prefijo (lo que usan los eventos: la lista entera de un banco o de un deudor) es round(S), a ≤ 0,5 µ de la de JMAB.
 */
describe('caiani/money: redondeo con arrastre (CarryRounder)', () => {
  const carry = (x: readonly number[]): number[] => {
    const r = new CarryRounder();
    return x.map((v) => r.add(v));
  };

  it('caso a mano: tres intereses de 0,4 µ; por separado darían 0 (error 1,2 µ), con arrastre 0, 1, 0 (total 1)', () => {
    // S = 0,4; 0,8; 1,2000000000000002 → round 0, 1, 1 → montos 0, 1, 0.
    expect([0.4, 0.4, 0.4].map(Math.round).reduce((a, b) => a + b)).toBe(0);
    expect(carry([0.4, 0.4, 0.4])).toEqual([0, 1, 0]);
  });

  it('caso a mano: cuatro de 0,5 µ (mitad hacia arriba, como Math.round de Java): 1, 0, 1, 0', () => {
    // S = 0,5; 1; 1,5; 2 → round 1, 1, 2, 2.
    expect(carry([0.5, 0.5, 0.5, 0.5])).toEqual([1, 0, 1, 0]);
  });

  it('caso a mano: montos enteros quedan exactos; sin −0; un monto no finito es error', () => {
    expect(carry([3, 0, 7_000_000])).toEqual([3, 0, 7_000_000]);
    expect(Object.is(carry([-0.4])[0], 0)).toBe(true); // round(−0,4) = −0 en JS: devuelve 0
    expect(() => new CarryRounder().add(Number.NaN)).toThrow(/no finito/);
    expect(() => new CarryRounder().add(Infinity)).toThrow(/no finito/);
  });

  it('propiedad, sumas exactas (montos diádicos): cada monto y cada tramo seguido a < 1 µ de su suma', () => {
    // xᵢ = k/1024 con k < 2⁴²: xᵢ < 2³² µ y las sumas de hasta 60 términos < 2³⁸ µ; con 10 bits de fracción caben en
    // 53 bits, así que toda suma en `double` es exacta y las garantías se pueden verificar sin margen.
    const rng = Rng.fromSeed(11);
    const bad: string[] = [];
    for (let rep = 0; rep < 200; rep++) {
      const n = 1 + rng.nextInt(60);
      const x = Array.from({ length: n }, () => (rng.nextInt(4_194_304) * 1_048_576 + rng.nextInt(1_048_576)) / 1024);
      const m = carry(x);
      m.forEach((mi, i) => {
        if (!Number.isSafeInteger(mi) || !(Math.abs(mi - x[i]!) < 1)) bad.push(`monto ${mi} contra ${x[i]}`);
      });
      for (let a = 0; a < n; a++) {
        let sm = 0;
        let sx = 0; // suma de JMAB del tramo, desde 0 (exacta)
        for (let b = a; b < n; b++) {
          sm += m[b]!;
          sx += x[b]!;
          if (!(Math.abs(sm - sx) < 1)) bad.push(`tramo ${a}..${b}: ${sm} contra ${sx}`);
        }
      }
    }
    expect(bad).toEqual([]);
  }, 60_000);

  it('propiedad, montos de JMAB (saldo × tasa, como el evento 8): la lista entera suma round(S), a ≤ 0,5 µ de la suma de JMAB', () => {
    // Saldos hasta 10¹² µ (el agregado más grande del .jar es 1,25·10¹²) por tasas de depósito: las sumas en double no son
    // exactas. El total de la lista es exactamente round(S), con S la misma suma que hace JMAB (mismo orden, desde 0).
    // Cada monto: mᵢ − xᵢ = (round(Sᵢ) − Sᵢ) − (round(Sᵢ₋₁) − Sᵢ₋₁) + eᵢ, con eᵢ el error de redondeo de la suma
    // Sᵢ = fl(Sᵢ₋₁ + xᵢ); así que |mᵢ − xᵢ| < 1 + |eᵢ|, con |eᵢ| ≤ 2⁻⁵³·|Sᵢ| (medio ulp). eᵢ se calcula exacto (TwoSum).
    const HALF_ULP = 1.1102230246251565e-16; // 2⁻⁵³
    const rng = Rng.fromSeed(12);
    let worst = 0;
    const bad: string[] = [];
    for (let rep = 0; rep < 200; rep++) {
      const n = 1 + rng.nextInt(800);
      const rate = 0.0001 + rng.nextFloat() * 0.01;
      const x = Array.from({ length: n }, () => (rng.nextInt(1_000_000) * 1_000_000 + rng.nextInt(1_000_000)) * rate);
      const m = carry(x);
      let S = 0;
      let total = 0;
      m.forEach((mi, i) => {
        const prev = S;
        const xi = x[i]!;
        S += xi;
        total += mi;
        if (total !== Math.round(S)) bad.push(`total ${total} ≠ round(S) ${Math.round(S)}`);
        const bv = S - prev; // TwoSum (Knuth): error exacto de fl(prev + xi)
        const e = prev - (S - bv) + (xi - bv);
        if (!(Math.abs(e) <= HALF_ULP * S)) bad.push(`error de la suma ${e} > ½ ulp`);
        if (!(Math.abs(mi - xi) < 1 + Math.abs(e))) bad.push(`monto ${mi} contra ${xi}`);
        worst = Math.max(worst, Math.abs(mi - xi));
      });
      if (!(Math.abs(total - S) <= 0.5)) bad.push(`lista: ${total} contra ${S}`);
    }
    // Las verificaciones se juntan y se afirman al final (un expect por monto hacía el test lento con la máquina cargada).
    expect(bad).toEqual([]);
    expect(worst).toBeLessThan(1);
  }, 60_000);
});
