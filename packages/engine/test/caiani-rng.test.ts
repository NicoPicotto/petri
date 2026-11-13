/**
 * Azar semántico del port (caiani/rng.ts): modo PRNG y modo oráculo (docs/ledger-contratos.md, sec. 2.6).
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import { OracleCaianiRng, PrngCaianiRng, jmabShuffle, parseDraws, type DrawRecord } from '../src/caiani/rng';

const id = (x: number) => x;

describe('Rng semántico, modo PRNG', () => {
  it('misma semilla, misma secuencia', () => {
    const run = () => {
      const r = new PrngCaianiRng(Rng.fromSeed(42));
      return [
        r.foldedNormal('A.x', 0.01),
        r.bernoulli('B.y', 0.3),
        r.shuffle('C.z', 'buyers', [1, 2, 3, 4, 5], id),
        r.sample('D.w', 7, [10, 11, 12, 13, 14, 15], 3, id),
        r.uniform01('E.v', 'bailout'),
      ];
    };
    expect(run()).toEqual(run());
  });

  it('Bernoulli con p ≤ 0 o p ≥ 1 no consume azar (JMAB no llama al generador)', () => {
    const r = new PrngCaianiRng(Rng.fromSeed(1));
    const s0 = r.rng.toState();
    expect(r.bernoulli('X', 0)).toBe(false);
    expect(r.bernoulli('X', 1)).toBe(true);
    expect(r.rng.toState()).toEqual(s0);
  });

  it('la muestra no repite y tiene el largo pedido', () => {
    const r = new PrngCaianiRng(Rng.fromSeed(5));
    for (let k = 0; k < 200; k++) {
      const s = r.sample('X', 1, [1, 2, 3, 4, 5, 6, 7, 8], 5, id);
      expect(new Set(s).size).toBe(5);
    }
    expect(r.sample('X', 1, [1, 2], 5, id)).toHaveLength(2);
  });
});

// Registro con el formato de oracle.Draws (secuencia, tick, tipo, lugar, detalle); valores tomados
// del draws.tsv de la corrida "a" del oráculo, con listas acortadas.
const FIXTURE = [
  '16500\t1\tfn\tAdaptiveMarkUpOnAC.computePrice\t4.693976719939783E-4',
  '16501\t1\tshuffle\tBrochureSelectionRandomRobinBuyerMixer.invokeFirstInteractions\tbuyers:8174,8168,8142',
  '16502\t1\tsample\tBrochureSelectionRandomRobinBuyerMixer.invokeFirstInteractions\t8174:8240,8237',
  '16503\t1\tbern\tAbstractSwitchingStrategy.switches\t0.041861474238848784:0',
  '16504\t1\tbern\tAbstractSwitchingStrategy.switches\t0.5:1',
  '16505\t1\tshuffleEmp\tCopyOfConsumptionFirm2WagesEnd.computeLaborDemand\t8133:11046,15628,11765',
  '16506\t1\tunif\tBank.bailout\tbailout:0.25',
].join('\n');

describe('Rng semántico, modo oráculo', () => {
  it('devuelve los valores registrados, en orden', () => {
    const r = new OracleCaianiRng(parseDraws(FIXTURE));
    expect(r.foldedNormal('AdaptiveMarkUpOnAC.computePrice', 0.0094)).toBe(0.0004693976719939783);
    const buyers = [8142, 8168, 8174];
    expect(r.shuffle('BrochureSelectionRandomRobinBuyerMixer.invokeFirstInteractions', 'buyers', buyers, id)).toBe(buyers);
    expect(buyers).toEqual([8174, 8168, 8142]);
    expect(r.sample('BrochureSelectionRandomRobinBuyerMixer.invokeFirstInteractions', 8174, [8237, 8240, 8250], 5, id)).toEqual([
      8240, 8237,
    ]);
    expect(r.bernoulli('AbstractSwitchingStrategy.switches', 0.041861474238848784)).toBe(false);
    expect(r.bernoulli('AbstractSwitchingStrategy.switches', 0)).toBe(false); // no consume
    expect(r.bernoulli('AbstractSwitchingStrategy.switches', 0.5)).toBe(true);
    const emp = [11765, 11046, 15628];
    r.shuffleEmployees('CopyOfConsumptionFirm2WagesEnd.computeLaborDemand', 8133, emp, id);
    expect(emp).toEqual([11046, 15628, 11765]);
    expect(r.uniform01('Bank.bailout', 'bailout')).toBe(0.25);
    expect(r.remaining).toBe(0);
  });

  it('falla con un mensaje claro si el tipo o el lugar no coinciden', () => {
    const r = new OracleCaianiRng(parseDraws(FIXTURE));
    expect(() => r.bernoulli('AdaptiveMarkUpOnAC.computePrice', 0.3)).toThrow(
      /pidió bern en AdaptiveMarkUpOnAC.computePrice, el registro tiene fn en AdaptiveMarkUpOnAC.computePrice \(secuencia 16500, tick 1\)/,
    );
    const r2 = new OracleCaianiRng(parseDraws(FIXTURE));
    expect(() => r2.foldedNormal('AdaptiveWageStrategy.computeWage', 0.01)).toThrow(/el registro tiene fn en AdaptiveMarkUpOnAC/);
  });

  it('falla si la lista del port no tiene los mismos agentes, o si el tick no coincide', () => {
    const recs = parseDraws(FIXTURE);
    const r = new OracleCaianiRng(recs.slice(1));
    expect(() => r.shuffle('BrochureSelectionRandomRobinBuyerMixer.invokeFirstInteractions', 'buyers', [8142, 8168, 9999], id)).toThrow(
      /8174 del registro no está/,
    );
    const r2 = new OracleCaianiRng(recs);
    r2.tick = 2;
    expect(() => r2.foldedNormal('AdaptiveMarkUpOnAC.computePrice', 1)).toThrow(/tick 2 y el registro en el 1/);
  });

  it('p de la Bernoulli: diferencias dentro de la tolerancia se anotan; fuera, error', () => {
    const site = 'AbstractSwitchingStrategy.switches';
    const recs = parseDraws(FIXTURE).filter((x) => x.type === 'bern');
    const r = new OracleCaianiRng(recs);
    expect(r.bernoulli(site, 0.041861474238848784 * (1 + 1e-9))).toBe(false);
    expect(r.pDiffs).toHaveLength(1);
    expect(() => r.bernoulli(site, 0.51)).toThrow(/p = 0.51, el registro tiene p = 0.5/);
  });

  it('formato inesperado', () => {
    expect(() => parseDraws('1\t1\tfoo\tX.y\t1')).toThrow(/línea 1/);
  });
});

const REAL = fileURLToPath(new URL('../../../reference/p0/runs/oracle/a/draws.tsv', import.meta.url));

describe.skipIf(!existsSync(REAL))('Rng semántico con el registro real del oráculo (reference/, fuera de git)', () => {
  it('lee los 212.680 sorteos de la corrida "a" y los devuelve en orden a un port que pide lo mismo', () => {
    const recs = parseDraws(readFileSync(REAL, 'utf8'));
    expect(recs.length).toBe(212_680);
    const r = new OracleCaianiRng(recs);
    const sorted = (s: string) =>
      s
        .split(',')
        .map(Number)
        .sort((a, b) => a - b);
    let prevSeq = 0;
    for (const x of recs as DrawRecord[]) {
      expect(x.seq).toBe(prevSeq === 0 ? x.seq : prevSeq + 1);
      prevSeq = x.seq;
      r.tick = x.tick;
      const [head, rest] = [x.detail.slice(0, x.detail.indexOf(':')), x.detail.slice(x.detail.indexOf(':') + 1)];
      switch (x.type) {
        case 'fn': {
          const v = r.foldedNormal(x.site, 1);
          // Double.toString de Java y la representación más corta de JS dan los mismos dígitos.
          expect(Number(x.detail)).toBe(v);
          break;
        }
        case 'bern':
          expect(r.bernoulli(x.site, Number(head))).toBe(rest === '1');
          break;
        case 'shuffle': {
          const items = sorted(rest);
          r.shuffle(x.site, head, items, id);
          expect(items.join(',')).toBe(rest);
          break;
        }
        case 'shuffleEmp': {
          const items = rest === '' ? [] : sorted(rest);
          r.shuffleEmployees(x.site, Number(head), items, id);
          expect(items.join(',')).toBe(rest);
          break;
        }
        case 'sample': {
          const chosen = rest.split(',').map(Number);
          expect(r.sample(x.site, Number(head), [...chosen].reverse(), chosen.length, id)).toEqual(chosen);
          break;
        }
        case 'unif':
          r.uniform01(x.site, head);
          break;
      }
    }
    expect(r.remaining).toBe(0);
    expect(r.pDiffs).toEqual([]);
  }, 60_000);
});

describe('mezcla de AgentList (algoritmo de JMAB, sesgado a propósito)', () => {
  it('caso a mano: [a, b, c, d] con u = 0,9; 0,1; 0,6', () => {
    // i = 0: ⌊4·0,9⌋ = 3 → [d, b, c, a]; i = 1: ⌊4·0,1⌋ = 0 → [b, d, c, a]; i = 2: ⌊4·0,6⌋ = 2 → igual.
    const u = [0.9, 0.1, 0.6];
    let k = 0;
    expect(jmabShuffle(['a', 'b', 'c', 'd'], () => u[k++]!)).toEqual(['b', 'd', 'c', 'a']);
    expect(k).toBe(3); // n − 1 sorteos
  });

  it('n = 3: reproduce la distribución exacta de JMAB, que no es uniforme', () => {
    // Exacta: los 3² = 9 caminos equiprobables (u en el centro de cada tercio).
    const exact = new Map<string, number>();
    for (const a of [0, 1, 2]) {
      for (const b of [0, 1, 2]) {
        const u = [(a + 0.5) / 3, (b + 0.5) / 3];
        let k = 0;
        const key = jmabShuffle([0, 1, 2], () => u[k++]!).join('');
        exact.set(key, (exact.get(key) ?? 0) + 1 / 9);
      }
    }
    expect([...exact.values()].some((p) => Math.abs(p - 1 / 6) > 0.02)).toBe(true); // sesgada
    const r = new PrngCaianiRng(Rng.fromSeed(3));
    expect(r.shuffleAlgorithm).toBe('jmab');
    const N = 90_000;
    const freq = new Map<string, number>();
    for (let n = 0; n < N; n++) {
      const key = r.shuffle('X.y', 'buyers', [0, 1, 2], id).join('');
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
    for (const [key, p] of exact) {
      const f = (freq.get(key) ?? 0) / N;
      expect(Math.abs(f - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / N));
    }
  });

  it('alternativa uniforme (Fisher–Yates), para medir el efecto del sesgo', () => {
    const r = new PrngCaianiRng(Rng.fromSeed(3), { shuffle: 'uniform' });
    const N = 60_000;
    const freq = new Map<string, number>();
    for (let n = 0; n < N; n++) {
      const key = r.shuffle('X.y', 'buyers', [0, 1, 2], id).join('');
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
    expect(freq.size).toBe(6);
    for (const c of freq.values()) expect(Math.abs(c / N - 1 / 6)).toBeLessThan(4 * Math.sqrt((1 / 6) * (5 / 6) / N));
  });
});
