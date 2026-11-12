import { describe, expect, it } from 'vitest';
import { expNeg, switchProbability } from '../src/index';

describe('expNeg (exponencial determinista)', () => {
  it('coincide con Math.exp con error relativo < 1e−12 en [0, 40]', () => {
    let worst = 0;
    for (let i = 0; i <= 40_000; i++) {
      const x = i / 1000;
      const exact = Math.exp(-x); // Math.exp solo en el test, como referencia
      const rel = Math.abs(expNeg(x) - exact) / exact;
      worst = Math.max(worst, rel);
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('casos borde: e^0 = 1, decreciente, 0 para x muy grande, error con x negativo', () => {
    expect(expNeg(0)).toBe(1);
    expect(expNeg(0.1)).toBeLessThan(expNeg(0.05));
    expect(expNeg(1000)).toBe(0);
    expect(() => expNeg(-1)).toThrow();
    expect(() => expNeg(Number.NaN)).toThrow();
  });
});

describe('R6: probabilidad de cambiar de proveedor', () => {
  it('misma brecha, más β ⇒ más probabilidad de cambiar', () => {
    const p03 = switchProbability(0.3, 110, 100);
    const p1 = switchProbability(1, 110, 100);
    const p3 = switchProbability(3, 110, 100);
    expect(p03).toBeLessThan(p1);
    expect(p1).toBeLessThan(p3);
    expect(p1).toBeCloseTo(1 - Math.exp(-0.1), 12); // brecha = (110 − 100) / 100 = 0,1
  });

  it('mismo β, más brecha ⇒ más probabilidad; la brecha es positiva cuando el nuevo es más barato', () => {
    expect(switchProbability(1, 105, 100)).toBeLessThan(switchProbability(1, 120, 100));
    expect(switchProbability(1, 120, 100)).toBeGreaterThan(0);
  });

  it('si el nuevo no es más barato, nunca se cambia', () => {
    expect(switchProbability(3, 100, 100)).toBe(0);
    expect(switchProbability(3, 100, 120)).toBe(0);
  });
});

