/**
 * P2 (V1): inicialización del port de Caiani contra JMAB. Diseño en docs/inicializacion.md.
 *
 * 1. Casos calculados a mano y propiedades (siempre).
 * 2. V1: comparación agente por agente con el estado que vuelca el oráculo después de la
 *    inicialización (`reference/p0/runs/oracle/p2-init/state/init.jsonl`, semilla 12345), usando
 *    el `Rng` en modo oráculo con los sorteos de la inicialización. Se saltea si falta reference/.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareState, idMaps, readDump } from './support/jmab-dump';
import { Rng } from '../src/rng';
import {
  LAG,
  OracleCaianiRng,
  PrngCaianiRng,
  checkLedger,
  contractIds,
  contractOf,
  initialize,
  installment,
  parseDraws,
  toMicro,
  type CaianiState,
  type Contract,
  type FirmState,
} from '../src/caiani';

function init(seed: number): CaianiState {
  return initialize(new PrngCaianiRng(Rng.fromSeed(seed)));
}

describe('inicialización del port de Caiani: casos a mano', () => {
  const s = init(1);
  const L = s.ledger;
  const c0 = s.consumptionFirms[0] as FirmState;

  it('el ledger queda bien formado y sin flujos registrados', () => {
    expect(checkLedger(L)).toEqual([]);
    expect(L.flowLog).toEqual([]);
  });

  it('hogares: depósito de 80.704,13311 / 8.000 en el banco i / 800, sin efectivo', () => {
    // 80704.13311 / 8000 = 10,08801663875 → 10.088.016,63875 µ → 10.088.017 µ.
    const h = s.households[1234]!;
    const dep = contractOf(L, contractIds(L, h.id, 'assets', 'deposit')[0]!);
    expect(dep.amount).toBe(10_088_017);
    expect(dep.issuer).toBe(s.banks[1]!.id); // 1234 / 800 = 1
    const cash = contractOf(L, contractIds(L, h.id, 'assets', 'cash')[0]!);
    expect(cash.amount).toBe(0);
    expect(h.previousSeller).toBe(s.consumptionFirms[15]!.id); // 1234 / 80 = 15
    expect(h.dividendsReceived).toBe(297_075); // 2376,600118 / 8000 = 0,29707501475
  });

  it('nadie arranca con efectivo (hhsCash y bsCash = 0; empresas en 0)', () => {
    for (const c of Object.values(L.contracts)) if (c.kind === 'cash') expect(c.amount).toBe(0);
  });

  it('préstamo inicial j = 1 de la primera empresa de consumo, calculado a mano', () => {
    // cLoan = 5208,435263 / 100 = 52,08435263; A = 52,08435263 / 1,0075 = 51,69662792… → 51.696.628 µ.
    // Saldo = A − redondeo(A·1/20) = 51.696.628 − 2.584.831 = 49.111.797 µ (JMAB: 49,111796524565754).
    const loans = contractIds(L, c0.id, 'liabilities', 'loan').map((id) => contractOf(L, id));
    expect(loans).toHaveLength(20);
    const l1 = loans[1] as Contract;
    expect(l1.age).toBe(2);
    expect(l1.initialAmount).toBe(51_696_628);
    expect(l1.amount).toBe(49_111_797);
    expect(l1.holder).toBe(s.banks[1]!.id); // banco del depósito (0) + 1
    expect(c0.previousLender).toBe(s.banks[0]!.id); // el del depósito, no el de j = 1
  });

  it('los préstamos iniciales cierran en cero exactamente a la edad 20 (no hay condonación)', () => {
    for (const f of [...s.consumptionFirms, ...s.capitalFirms]) {
      for (const id of contractIds(L, f.id, 'liabilities', 'loan')) {
        const l = { ...contractOf(L, id) };
        while (l.age <= (l.length as number)) {
          l.amount -= installment(l).principal;
          l.age += 1;
        }
        expect(l.amount).toBe(0);
      }
    }
  });

  it('bonos truncados a enteros: 3.827 por banco y 28.564 del BC', () => {
    const govBonds = contractIds(L, s.government.id, 'liabilities', 'bond').map((id) => contractOf(L, id));
    expect(govBonds).toHaveLength(11);
    expect(govBonds.slice(0, 10).every((b) => b.amount === 3_827_000_000 && b.quantity === 3827)).toBe(true);
    expect(govBonds[10]!.amount).toBe(28_564_000_000);
  });

  it('empleo: 50 por empresa, 6.000 ocupados, gobierno sin empleados', () => {
    expect(s.capitalFirms.every((f) => f.employees.length === 50)).toBe(true);
    expect(s.consumptionFirms.every((f) => f.employees.length === 50)).toBe(true);
    expect(s.government.employees).toEqual([]);
    const employed = s.households.filter((h) => h.employer !== null);
    expect(employed).toHaveLength(6000);
    for (const h of s.households) expect(h.lags[LAG.EMPLOYED]![0]).toBe(h.employer === null ? 0 : 1);
  });

  it('añadas de capital de la empresa de consumo: valor y precio descontados por (1 + g)^j', () => {
    const v = c0.capitalGoods;
    expect(v).toHaveLength(20);
    expect(v[0]!.value).toBe(2.6875 * 20); // 53,75
    // j = 1: 2,6875·20·(1 − 1/20) / 1,0075
    expect(v[1]!.value).toBe((2.6875 * 20 * (1 - 1 / 20)) / 1.0075);
    expect(v[1]!.age).toBe(1);
    expect(v[0]!.producer).toBe(s.capitalFirms[0]!.id); // 0 / 5
    expect(s.consumptionFirms[7]!.capitalGoods[0]!.producer).toBe(s.capitalFirms[1]!.id); // 7 / 5
  });

  it('determinismo: misma semilla, mismo estado; otra semilla, otro orden', () => {
    expect(JSON.stringify(init(1))).toBe(JSON.stringify(s));
    expect(init(2).populations.households).not.toEqual(s.populations.households);
  });
});

// ---------------------------------------------------------------------------------------------
// V1 contra el oráculo
// ---------------------------------------------------------------------------------------------

const RUN = fileURLToPath(new URL('../../../reference/p0/runs/oracle/p2-init/', import.meta.url));
const DUMP = RUN + 'state/init.jsonl';
const DRAWS = RUN + 'draws.tsv';

describe.skipIf(!existsSync(DUMP) || !existsSync(DRAWS))('V1: inicialización contra el oráculo (reference/, fuera de git)', () => {
  it('el estado inicial coincide con el de JMAB agente por agente', () => {
    const dump = readDump(DUMP);
    const { toJ } = idMaps(dump.meta);
    const records = parseDraws(readFileSync(DRAWS, 'utf8')).filter((r) => r.tick < 1);
    const rng = new OracleCaianiRng(records);
    const s = initialize(rng, { jmabId: toJ });
    expect(rng.remaining).toBe(0); // se consumieron todos los sorteos de la inicialización
    const r = compareState(s, dump);
    console.log('V1:', JSON.stringify(r.counts));
    expect(r.diffs).toEqual([]);
    expect(r.counts.contracts).toBe(37_364);
    expect(r.counts.maxAmountDiff).toBeLessThanOrEqual(1);
  }, 120_000);
});
