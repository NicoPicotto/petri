/**
 * P3: registro de decisiones discretas (src/caiani/decisions.ts). Registro en docs/reglas-caiani.md, sec. 1.
 */
import { describe, expect, it } from 'vitest';
import {
  DecisionRecorder,
  adaptiveInterestRate,
  ceiling,
  compareOutcomes,
  decisionDistance,
  flooring,
  gt,
  record,
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
    // NaN: error salvo que el lugar lo declare (pedido de Nico, 2026-11-16).
    expect(() => decisionDistance(NaN, 1, 'pure')).toThrow(/NaN/);
    expect(decisionDistance(NaN, 1, 'pure', undefined, true)).toBeNaN();
  });

  it('modo oráculo (d1): fuerza solo si las dos son frágiles; R2 sobre un residuo; desalineada y no frágil fallan', () => {
    const rec = new DecisionRecorder();
    rec.oracle = new Map([
      [
        5,
        [
          { site: 'm', agent: -1, outcome: 1, a: 1.0000005, b: 1, }, // JMAB: a > b por 0,5 µ (frágil)
          { site: 'm', agent: -1, outcome: 0, a: 1, b: 1 }, // igual que el port: no se fuerza
          { site: 'r', agent: -1, outcome: 1, a: -9.2e-14, b: 0 }, // residuo de JMAB (R2)
          { site: 'm', agent: -1, outcome: 1, a: 2, b: 1 }, // JMAB claro
        ],
      ],
    ]);
    withDecisions(rec, 5, () => {
      // Port: 1 µ contra 1 µ (empate, frágil); JMAB: 1,0000005 > 1 (0,5 µ). Se toma la rama de JMAB.
      expect(gt('m', 1_000_000, 1_000_000, 'amount')).toBe(true);
      expect(gt('m', 1_000_000, 1_000_000, 'amount')).toBe(false);
      // R2: operandos del port 0 exacto, de JMAB un residuo: se toma la de JMAB y se cuenta como residuo.
      expect(record('r', false, 0, 0, 'fromAmounts', 0)).toBe(true);
      // JMAB 2 > 1 (1.000.000 µ de distancia): no es frágil; el port da falso → error.
      expect(() => gt('m', 1_000_000, 1_000_000, 'amount')).toThrow(/no frágil/);
    });
    expect(rec.forced.map((f) => [f.site, f.kind, f.port, f.jmab])).toEqual([
      ['m', 'frágil', 0, 1],
      ['r', 'residuo', 0, 1],
    ]);
    // Desalineada: otro lugar en la misma posición.
    const r2 = new DecisionRecorder();
    r2.oracle = new Map([[1, [{ site: 'x', agent: -1, outcome: 1, a: 1, b: 0 }]]]);
    expect(() => withDecisions(r2, 1, () => gt('y', 1, 0, 'pure'))).toThrow(/desalineada/);
    // JMAB con una decisión de más al terminar el evento.
    const r3 = new DecisionRecorder();
    r3.oracle = new Map([[2, [{ site: 'x', agent: -1, outcome: 1, a: 1, b: 0 }]]]);
    expect(() => r3.finishEvent(2)).toThrow(/1 decisiones más/);
    // NaN declarado: el de JMAB también tiene que ser NaN.
    const r4 = new DecisionRecorder();
    r4.oracle = new Map([[3, [{ site: 'n', agent: -1, outcome: 0, a: 0.5, b: 0.1 }]]]);
    expect(() => withDecisions(r4, 3, () => gt('n', NaN, 0.1, 'pure', undefined, undefined, { nanOk: true }))).toThrow(/NaN en el port y no en JMAB/);
  });

  it('cociente indeterminado (sec. 40): rama de JMAB si lo es en los dos lados; de un solo lado o sin columna 9, error', () => {
    const site = 'q';
    // Banco 8258 en el tick 298: port 0 / 0 µ = NaN (rama 0); JMAB num 1,455·10⁻¹¹, den 0 (+∞, rama 1).
    const line = (outcome: number, a: number, extra?: string) => ({ site, agent: -1, outcome, a, b: 0.108, ...(extra === undefined ? {} : { extra }) });
    const rec = new DecisionRecorder();
    rec.oracle = new Map([
      [
        6,
        [
          line(1, Infinity, '1.4551915228366852E-11;0.0'), // 298: +∞, rama distinta del NaN del port
          line(0, -Infinity, '-7.275957614183426E-12;0.0'), // 299: −∞, misma rama
          line(1, Infinity, '0.5;0.0'), // numerador 500.000 µ: no es indeterminado (infinito con signo)
        ],
      ],
    ]);
    withDecisions(rec, 6, () => {
      expect(gt(site, NaN, 0.108, 'fromAmounts', undefined, undefined, { quotient: { num: 0, den: 0 } })).toBe(true);
      // ±∞ del port con numerador de 1 µ: indeterminado igual (|num| ≤ 2 µ); misma rama, se anota igual.
      expect(gt(site, -Infinity, 0.108, 'fromAmounts', undefined, undefined, { quotient: { num: -1, den: 0 } })).toBe(false);
      // Infinito con signo en los dos lados (numerador > 2 µ): camino normal, mismo resultado.
      expect(gt(site, Infinity, 0.108, 'fromAmounts', undefined, undefined, { quotient: { num: 500_000, den: 0 } })).toBe(true);
    });
    expect(rec.forced.map((f) => [f.kind, f.port, f.jmab, f.distancePort, f.alarm])).toEqual([
      ['indeterminada', 0, 1, 0, false],
      ['indeterminada', 0, 0, 1, false],
    ]);
    expect(rec.forced[0]!.distanceJmab).toBeCloseTo(1.455e-5, 8);
    // De un solo lado: el port indeterminado y JMAB no, o al revés.
    const one = (extra: string, num: number, den: number, a: number) => {
      const r = new DecisionRecorder();
      r.oracle = new Map([[6, [line(1, 0.2, extra)]]]);
      return () => withDecisions(r, 6, () => gt(site, a, 0.108, 'fromAmounts', undefined, undefined, { quotient: { num, den } }));
    };
    expect(one('1.6;8.1', 0, 0, NaN)).toThrow(/solo en el port/);
    expect(one('1.4551915228366852E-11;0.0', 1_600_000, 8_100_000, 0.2)).toThrow(/solo en JMAB/);
    // Port indeterminado y el registro sin la columna 9 (corrida sin el oráculo A1).
    const r5 = new DecisionRecorder();
    r5.oracle = new Map([[6, [line(1, Infinity)]]]);
    expect(() => withDecisions(r5, 6, () => gt(site, NaN, 0.108, 'fromAmounts', undefined, undefined, { quotient: { num: 0, den: 0 } }))).toThrow(/columna 9/);
    // Sin oráculo: la comparación de siempre (NaN > x es falso), sin error; con registrador sin oráculo, se anota sin distancia.
    expect(gt(site, NaN, 0.108, 'fromAmounts', undefined, undefined, { quotient: { num: 0, den: 0 } })).toBe(false);
    const r6 = new DecisionRecorder();
    expect(withDecisions(r6, 6, () => gt(site, NaN, 0.108, 'fromAmounts', undefined, undefined, { quotient: { num: 0, den: 0 } }))).toBe(false);
    expect(r6.log[6]![site]!.fragile).toBe(0);
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
      expect(rounding('round0', 0, 0, 'pure')).toBe(0); // 0 exacto: a 0,5 de la mitad (distancia 1), no frágil
    });
    expect(rec.log[3]!['round0']!.fragile).toBe(0);
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

  it('flooring y ceiling sin registrador: Math.floor y Math.ceil, sin nada más', () => {
    expect([flooring('f', 2.9999999, 'pure'), flooring('f', 3, 'pure'), flooring('f', -0.5, 'pure')]).toEqual([2, 3, -1]);
    expect([ceiling('c', 3.0000001, 'amount', 1_000_000), ceiling('c', 3, 'amount'), ceiling('c', 0, 'amount')]).toEqual([4, 3, 0]);
  });

  it('flooring: el umbral es el entero más cercano; frágil si x está a ≤ la tolerancia de él (relativa a max(|x|, |k|))', () => {
    const rec = new DecisionRecorder();
    withDecisions(rec, 18, () => {
      // pure (10⁻⁹ relativo)
      expect(flooring('p', 3 - 3e-12, 'pure')).toBe(2); // a 10⁻¹² relativo de 3, por debajo: frágil
      expect(flooring('p', 3 + 3e-12, 'pure')).toBe(3); // por encima: frágil
      expect(flooring('p', 2.5, 'pure')).toBe(2); // a 0,5 / 2,5 = 0,2 del 3 (y del 2): no frágil
      expect(flooring('p', 3, 'pure')).toBe(3); // en el entero exacto: distancia 0, frágil
      // fromAmounts (10⁻⁶ relativo): unidades que compra un hogar con su depósito (eventos 18 y 19)
      expect(flooring('m', 7 + 3.5e-6, 'fromAmounts')).toBe(7); // 3,5·10⁻⁶ / 7 = 5·10⁻⁷: frágil
      expect(flooring('m', 7 + 1.4e-5, 'fromAmounts')).toBe(7); // 2·10⁻⁶: no frágil
      expect(flooring('m', 0.4, 'fromAmounts')).toBe(0); // el más cercano es 0: |0,4 − 0| / 0,4 = 1, no frágil
    });
    const p = rec.log[18]!['p']!;
    expect([p.comparisons, p.fragile, p.outcomes]).toEqual([4, 3, [2, 3, 2, 3]]);
    expect(p.examples.map((e) => e.index)).toEqual([0, 1, 3]);
    expect(p.examples[0]!.b).toBe(3); // el umbral registrado es el entero más cercano, no el piso
    expect(p.examples[0]!.distance).toBeCloseTo(1e-12, 15); // 3·10⁻¹² / 3 (salvo la representación de 3 − 3·10⁻¹²)
    const m = rec.log[18]!['m']!;
    expect([m.comparisons, m.fragile, m.outcomes]).toEqual([3, 1, [7, 7, 0]]);
  });

  it('ceiling: con unit la distancia se mide en µ (evento 29: bonos = ⌈déficit en unidades⌉); sin unit sería en unidades', () => {
    const rec = new DecisionRecorder();
    withDecisions(rec, 29, () => {
      expect(ceiling('u', 3 + 1e-6, 'amount', 1_000_000)).toBe(4); // 1 µ por encima de 3: frágil (≤ 2 µ)
      expect(ceiling('u', 3 - 1.5e-6, 'amount', 1_000_000)).toBe(3); // 1,5 µ por debajo: frágil
      expect(ceiling('u', 3 + 3e-6, 'amount', 1_000_000)).toBe(4); // 3 µ: no frágil
      expect(ceiling('u', 2.5, 'amount', 1_000_000)).toBe(3); // 500.000 µ: no frágil
      // Sin unit, la distancia de 3 + 3·10⁻⁶ (unidades) al 3 sería 3·10⁻⁶ "µ": frágil por error de escala.
      expect(ceiling('sin unit', 3 + 3e-6, 'amount')).toBe(4);
    });
    const u = rec.log[29]!['u']!;
    expect([u.comparisons, u.fragile, u.outcomes]).toEqual([4, 2, [4, 3, 4, 3]]);
    expect(u.examples.map((e) => [e.index, e.b])).toEqual([
      [0, 3_000_000],
      [1, 3_000_000],
    ]);
    expect(u.examples[0]!.distance).toBeCloseTo(1, 6); // en µ
    expect(u.examples[1]!.distance).toBeCloseTo(1.5, 6);
    expect(rec.log[29]!['sin unit']!.fragile).toBe(1);
  });

  it('flooring y ceiling en modo oráculo: rama de JMAB (k ± 1) si es frágil de los dos lados; k ± 2 o no frágil, error', () => {
    const rec = new DecisionRecorder();
    rec.oracle = new Map([
      [
        18,
        [
          // Piso: port 3 − 3·10⁻¹² → 2; JMAB 3 + 3·10⁻¹² → 3 (los operandos de JMAB: x y el entero más cercano).
          { site: 'f', agent: -1, outcome: 3, a: 3 + 3e-12, b: 3 },
          // Piso igual en los dos: no se fuerza.
          { site: 'f', agent: -1, outcome: 2, a: 2.5, b: 3 },
        ],
      ],
      [
        29,
        [
          // Techo en µ: port 3 + 1 µ → 4; JMAB 3 − 0,5 µ → 3 (operandos de JMAB en unidades; el arnés los pasa a µ).
          { site: 'c', agent: -1, outcome: 3, a: 3 - 5e-7, b: 3 },
        ],
      ],
    ]);
    withDecisions(rec, 18, () => {
      expect(flooring('f', 3 - 3e-12, 'pure')).toBe(3); // k + 1: la de JMAB
      expect(flooring('f', 2.5, 'pure')).toBe(2);
    });
    withDecisions(rec, 29, () => expect(ceiling('c', 3 + 1e-6, 'amount', 1_000_000)).toBe(3)); // k − 1: la de JMAB
    expect(rec.forced.map((f) => [f.event, f.site, f.kind, f.port, f.jmab, f.alarm])).toEqual([
      [18, 'f', 'frágil', 2, 3, false],
      [29, 'c', 'frágil', 4, 3, false],
    ]);
    expect(rec.forced[1]!.distancePort).toBeCloseTo(1, 6);
    expect(rec.forced[1]!.distanceJmab).toBeCloseTo(0.5, 6);

    // k ± 2: aunque las dos sean frágiles, no se fuerza (solo un paso de 1): error.
    const r2 = new DecisionRecorder();
    r2.oracle = new Map([[18, [{ site: 'f', agent: -1, outcome: 4, a: 3 + 3e-12, b: 3 }]]]);
    expect(() => withDecisions(r2, 18, () => flooring('f', 3 - 3e-12, 'pure'))).toThrow(/no frágil/);
    // JMAB lejos del umbral (no frágil): error.
    const r3 = new DecisionRecorder();
    r3.oracle = new Map([[18, [{ site: 'f', agent: -1, outcome: 3, a: 3.4, b: 3 }]]]);
    expect(() => withDecisions(r3, 18, () => flooring('f', 3 - 3e-12, 'pure'))).toThrow(/no frágil/);
    // Port lejos del umbral (no frágil): error, aunque JMAB lo sea.
    const r4 = new DecisionRecorder();
    r4.oracle = new Map([[29, [{ site: 'c', agent: -1, outcome: 3, a: 3 - 5e-7, b: 3 }]]]);
    expect(() => withDecisions(r4, 29, () => ceiling('c', 3 + 3e-6, 'amount', 1_000_000))).toThrow(/no frágil/);
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
