/**
 * P3: registro de decisiones discretas (src/caiani/decisions.ts). Registro en docs/reglas-caiani.md, sec. 1.
 */
import { describe, expect, it } from 'vitest';
import {
  DecisionRecorder,
  adaptiveInterestRate,
  compareOutcomes,
  decisionDistance,
  gt,
  rounding,
  targetOutput,
  withDecisions,
  type CaianiRng,
} from '../src/caiani';

describe('decisiones discretas: casos a mano', () => {
  it('distancia en la escala de cada tolerancia', () => {
    expect(decisionDistance(10, 7, 'amount')).toBe(3); // µ, absoluta
    expect(decisionDistance(1, 1 + 1e-10, 'pure')).toBeCloseTo(1e-10, 15);
    expect(decisionDistance(1e-12, 0, 'pure', 100)).toBe(1e-14); // escala explícita
    expect(decisionDistance(Infinity, 0.2, 'fromAmounts')).toBe(Infinity);
    expect(decisionDistance(Infinity, Infinity, 'pure')).toBe(0);
    expect(decisionDistance(NaN, 1, 'pure')).toBeNaN();
  });

  it('sin registrador los helpers solo comparan; con registrador anotan y marcan las frágiles', () => {
    expect(gt('x', 2, 1, 'pure')).toBe(true);
    const rec = new DecisionRecorder();
    withDecisions(rec, 3, () => {
      expect(gt('x', 1 + 1e-12, 1, 'pure')).toBe(true); // frágil: 1e-12 ≤ 1e-9
      expect(gt('x', 1.1, 1, 'pure')).toBe(true); // no frágil
      expect(gt('m', 5, 4, 'amount')).toBe(true); // 1 µ ≤ 2: frágil
      expect(gt('r', 0.2, 0.19, 'fromAmounts')).toBe(true);
      expect(rounding('round', 2.5000000000001, 3, 'pure')).toBe(3); // a 4e-14 de la mitad: frágil
    });
    const x = rec.log[3]!['x']!;
    expect([x.comparisons, x.fragile, x.outcomes]).toEqual([2, 1, [1, 1]]);
    expect(x.examples[0]!.index).toBe(0);
    expect(rec.log[3]!['m']!.fragile).toBe(1);
    expect(rec.log[3]!['r']!.fragile).toBe(0);
    expect(rec.log[3]!['round']!.fragile).toBe(1);
    expect(rec.log[3]!['round']!.outcomes).toEqual([3]);
    // Fuera de withDecisions no se registra nada más.
    gt('x', 3, 1, 'pure');
    expect(rec.log[3]!['x']!.comparisons).toBe(2);
  });

  it('el piso de la producción deseada se mide contra la escala de los términos', () => {
    const rec = new DecisionRecorder();
    // 100 + 10 − 110 = 0 exacto: empate (distancia 0, frágil); 100 + 10 − 50: lejos.
    withDecisions(rec, 0, () => {
      expect(targetOutput(100, 110, 0.1)).toBe(0);
      expect(targetOutput(100, 50, 0.1)).toBe(60);
    });
    const s = rec.log[0]!['TargetExpectedInventoriesOutputStrategy.computeOutput']!;
    expect([s.comparisons, s.fragile, s.minDistance]).toEqual([2, 1, 0]);
  });

  it('el empate del evento 6: ratio de capital igual al promedio es frágil', () => {
    const rec = new DecisionRecorder();
    const rng = { foldedNormal: () => 0.01 } as unknown as CaianiRng;
    const r = { adaptive: 1, increase: false, sigma: 0.0094, upperBound: Infinity, reference: 'ratio de capital' };
    const banks = [
      { ratio: 0.18, pastRate: 0.0075 },
      { ratio: 0.18 * (1 + 1e-14), pastRate: 0.0075 },
    ];
    withDecisions(rec, 6, () => adaptiveInterestRate(0.18, banks, rng, r));
    const s = Object.entries(rec.log[6]!).find(([k]) => k.includes('promedio'))![1];
    expect(s.fragile).toBe(1);
  });

  it('decisiones dadas vuelta entre dos corridas', () => {
    const a = new DecisionRecorder();
    const b = new DecisionRecorder();
    withDecisions(a, 1, () => [gt('s', 1, 0, 'pure'), gt('s', 0, 1, 'pure')]);
    withDecisions(b, 1, () => [gt('s', 1, 0, 'pure'), gt('s', 2, 1, 'pure')]);
    const { flips, lengthMismatch } = compareOutcomes(a.log, b.log);
    expect(flips).toEqual([{ event: 1, site: 's', index: 1, a: 0, b: 1 }]);
    expect(lengthMismatch).toEqual([]);
    withDecisions(b, 1, () => gt('s', 2, 1, 'pure'));
    expect(compareOutcomes(a.log, b.log).lengthMismatch.length).toBe(1);
  });
});
