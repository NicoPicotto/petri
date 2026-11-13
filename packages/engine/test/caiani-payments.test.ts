/**
 * Pagos en dos fases con redondeo controlado (decisión de Nico, 2026-11-13; docs/reglas-caiani.md, sec. 1,
 * "Reservas"). Casos calculados a mano y propiedades con semilla. Los montos están en µ.
 */

import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import { addAgent, applyPayments, assertLedger, contractOf, createLedger, open, type Ledger } from '../src/caiani/ledger';
import { assertFlows, beginPeriod } from '../src/caiani/flows';
import { PaymentBatch, controlledRound, type PaymentGroups } from '../src/caiani/payments';

/** Grupos de una lista de pagos dados como [banco que paga, cuenta que paga, cuenta que cobra, banco que cobra]. */
function groups(rows: [number, number, number, number][]): PaymentGroups {
  return {
    fromBank: rows.map((r) => r[0]),
    fromAcc: rows.map((r) => r[1]),
    toAcc: rows.map((r) => r[2]),
    toBank: rows.map((r) => r[3]),
  };
}

/** Suma por clave, en el orden de los pagos. */
function sumBy(keys: readonly number[], v: readonly number[]): Map<number, number> {
  const s = new Map<number, number>();
  keys.forEach((k, i) => s.set(k, (s.get(k) ?? 0) + (v[i] as number)));
  return s;
}

describe('controlledRound: casos a mano', () => {
  it('los montos enteros quedan exactos', () => {
    const r = controlledRound([3, 0, 7], groups([[1, 10, 20, 2], [1, 11, 20, 2], [1, 10, 21, 3]]));
    expect(r.m).toEqual([3, 0, 7]);
    expect(r.maxGroupDiff).toBe(0);
  });

  it('tres pagos de 0,5 µ a una misma cuenta: redondeando cada uno daría 3 (error 1,5); el controlado da 1 o 2', () => {
    // Pagadores 10, 11, 12 en el banco 1; cobrador 20 en el banco 2.
    const x = [0.5, 0.5, 0.5];
    expect(x.map(Math.round).reduce((a, b) => a + b)).toBe(3); // el redondeo por separado se pasa en 1,5 µ
    const r = controlledRound(x, groups([[1, 10, 20, 2], [1, 11, 20, 2], [1, 12, 20, 2]]));
    const total = r.m.reduce((a, b) => a + b);
    expect([1, 2]).toContain(total); // cuenta que cobra, banco que cobra y banco que paga: a < 1 µ de 1,5
    r.m.forEach((m) => expect([0, 1]).toContain(m));
    expect(r.maxGroupDiff).toBeLessThan(1);
    expect(r.relaxed).toBe(false);
  });

  it('tabla de doble entrada 2×2 de 0,6 µ: filas y columnas a < 1 µ (los bancos son las cuentas)', () => {
    // Pagadores a, b (bancos 1 y 2); cobradores c, d (bancos 3 y 4). Filas y columnas suman 1,2 → 1 o 2.
    const r = controlledRound(
      [0.6, 0.6, 0.6, 0.6],
      groups([
        [1, 1, 3, 3],
        [1, 1, 4, 4],
        [2, 2, 3, 3],
        [2, 2, 4, 4],
      ]),
    );
    const [ac, ad, bc, bd] = r.m as [number, number, number, number];
    for (const s of [ac + ad, bc + bd, ac + bc, ad + bd]) expect([1, 2]).toContain(s);
    expect(r.maxGroupDiff).toBeLessThan(1);
  });

  it('una cuenta que paga todo su saldo en partes fraccionarias paga exactamente el saldo', () => {
    // Saldo 10 µ: 3,3 + 3,3 + 3,4 = 10 (en double, 10 exacto). Cobradores en tres bancos distintos.
    const x = [3.3, 3.3, 3.4];
    expect(x[0]! + x[1]! + x[2]!).toBe(10);
    const r = controlledRound(x, groups([[1, 10, 20, 2], [1, 10, 21, 3], [1, 10, 22, 4]]), (acc) => (acc === 10 ? 10 : undefined));
    expect(r.m.reduce((a, b) => a + b)).toBe(10);
    r.m.forEach((m, i) => expect(Math.abs(m - x[i]!)).toBeLessThan(1));
  });

  it('el techo de una cuenta que paga se respeta aunque la suma en double lo supere por ruido', () => {
    // Suma en double apenas por encima de 10 (0,3 + 7,9 + 1,8 = 10,000000000000002): sin techo podría dar 11.
    const x = [0.3, 7.9, 1.8];
    const s = x[0]! + x[1]! + x[2]!;
    expect(s).toBeGreaterThan(10);
    const r = controlledRound(x, groups([[1, 10, 20, 2], [1, 10, 21, 2], [1, 10, 22, 2]]), () => 10);
    expect(r.m.reduce((a, b) => a + b)).toBe(10);
  });

  it('una cuenta en dos bancos (familias no laminares) es un error', () => {
    expect(() => controlledRound([1.5, 1.5], groups([[1, 10, 20, 2], [3, 10, 21, 2]]))).toThrow(/dos bancos/);
  });
});

describe('controlledRound: propiedades con semilla', () => {
  it('600 lotes al azar: cada monto y cada suma de las cuatro familias a < 1 µ, sin relajar', () => {
    const rng = Rng.fromSeed(2026);
    for (let t = 0; t < 600; t++) {
      const banks = 1 + Math.floor(rng.nextFloat() * 6);
      const accounts = 1 + Math.floor(rng.nextFloat() * 40);
      const bankOf = Array.from({ length: accounts }, () => Math.floor(rng.nextFloat() * banks));
      const n = 1 + Math.floor(rng.nextFloat() * 200);
      const rows: [number, number, number, number][] = [];
      const x: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = Math.floor(rng.nextFloat() * accounts);
        const b = Math.floor(rng.nextFloat() * accounts);
        rows.push([bankOf[a]!, a, b, bankOf[b]!]);
        // Mezcla de montos chicos, grandes, enteros y con medios exactos.
        const kind = rng.nextFloat();
        x.push(kind < 0.1 ? Math.floor(rng.nextFloat() * 50) : kind < 0.2 ? Math.floor(rng.nextFloat() * 50) + 0.5 : rng.nextFloat() * (kind < 0.6 ? 10 : 1e9));
      }
      const g = groups(rows);
      const r = controlledRound(x, g);
      expect(r.relaxed).toBe(false);
      r.m.forEach((m, i) => {
        expect(Number.isInteger(m)).toBe(true);
        expect(Math.abs(m - x[i]!)).toBeLessThan(1);
      });
      for (const keys of [g.fromBank, g.fromAcc, g.toAcc, g.toBank]) {
        const sx = sumBy(keys, x);
        const sm = sumBy(keys, r.m);
        for (const [k, v] of sx) expect(Math.abs(sm.get(k)! - v)).toBeLessThan(1);
      }
    }
  });

  it('un lote del tamaño del mercado de consumo (8.000 pagos, 100 cobradores, 10 bancos) es rápido', () => {
    const rng = Rng.fromSeed(7);
    const rows: [number, number, number, number][] = [];
    const x: number[] = [];
    for (let i = 0; i < 8000; i++) {
      const firm = Math.floor(rng.nextFloat() * 100);
      rows.push([i % 10, 1000 + i, firm, firm % 10]);
      x.push(rng.nextFloat() * 1e7);
    }
    const t0 = performance.now();
    const r = controlledRound(x, groups(rows));
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r.maxGroupDiff).toBeLessThan(1);
  });
});

/** BC, dos bancos con reservas, tres hogares (dos en el banco 1, uno en el 2) y una empresa en el banco 1. */
function world() {
  const L = createLedger();
  const cb = addAgent(L, 'centralBank');
  const b1 = addAgent(L, 'bank');
  const b2 = addAgent(L, 'bank');
  const h1 = addAgent(L, 'household');
  const h2 = addAgent(L, 'household');
  const h3 = addAgent(L, 'household');
  const f = addAgent(L, 'consumptionFirm');
  const res1 = open(L, 'reserves', b1, cb, 1000, {}, 'deposits');
  const res2 = open(L, 'reserves', b2, cb, 1000, {}, 'deposits');
  const d1 = open(L, 'deposit', h1, b1, 300, {}, 'deposits');
  const d2 = open(L, 'deposit', h2, b1, 300, {}, 'deposits');
  const d3 = open(L, 'deposit', h3, b2, 300, {}, 'deposits');
  const fd = open(L, 'deposit', f, b1, 0, {}, 'deposits');
  const cp = beginPeriod(L);
  return { L, res1, res2, d1, d2, d3, fd, cp };
}

const amt = (L: Ledger, id: number) => contractOf(L, id).amount;

describe('PaymentBatch: pagos pendientes en double y cierre del evento', () => {
  it('saldo con pendientes, cierre con montos enteros y reservas movidas solo por los pagos entre bancos', () => {
    const w = world();
    const batch = new PaymentBatch(w.L);
    // Tres hogares le compran a la empresa: 100,4 y 100,4 µ desde el banco 1, 50,4 µ desde el banco 2.
    batch.pay(w.d1, w.fd, 100.4, 'consumption');
    batch.pay(w.d2, w.fd, 100.4, 'consumption');
    batch.pay(w.d3, w.fd, 50.4, 'consumption');
    expect(batch.balance(w.d1)).toBeCloseTo(199.6, 12);
    expect(batch.balance(w.fd)).toBeCloseTo(251.2, 12);
    expect(batch.balance(w.res2)).toBeCloseTo(949.6, 12); // liquidación pendiente al banco 1
    expect(batch.balance(w.res1)).toBeCloseTo(1050.4, 12);
    expect(amt(w.L, w.d1)).toBe(300); // el ledger no se tocó
    const r = batch.settle();
    expect(r.payments).toBe(3);
    // Cada cuenta a < 1 µ de su double: la empresa cobra 251 (251,2), el hogar 3 paga 50 (50,4).
    expect(amt(w.L, w.fd)).toBe(251);
    expect(amt(w.L, w.d3)).toBe(250);
    expect(amt(w.L, w.d1) + amt(w.L, w.d2)).toBe(399);
    // Reservas: solo el pago del banco 2 al 1 (50 µ).
    expect(amt(w.L, w.res1)).toBe(1050);
    expect(amt(w.L, w.res2)).toBe(950);
    assertLedger(w.L);
    assertFlows(w.L, w.cp);
    expect(() => batch.settle()).toThrow(/ya se cerró/);
    expect(() => batch.pay(w.d1, w.fd, 1, 'consumption')).toThrow(/ya se cerró/);
  });

  it('muchos pagadores de 0,5 µ a una cuenta de otro banco: reservas y cobrador a < 1 µ (por separado, error de 50 µ)', () => {
    const L = createLedger();
    const cb = addAgent(L, 'centralBank');
    const b1 = addAgent(L, 'bank');
    const b2 = addAgent(L, 'bank');
    const r1 = open(L, 'reserves', b1, cb, 1_000_000, {}, 'deposits');
    const r2 = open(L, 'reserves', b2, cb, 1_000_000, {}, 'deposits');
    const f = addAgent(L, 'consumptionFirm');
    const fd = open(L, 'deposit', f, b2, 0, {}, 'deposits');
    const payers = Array.from({ length: 100 }, () => open(L, 'deposit', addAgent(L, 'household'), b1, 10, {}, 'deposits'));
    const cp = beginPeriod(L);
    const batch = new PaymentBatch(L);
    for (const d of payers) batch.pay(d, fd, 0.5, 'consumption');
    batch.settle();
    // Suma en double: 50 µ. Redondeando cada pago (Math.round(0,5) = 1) serían 100.
    expect(amt(L, fd)).toBe(50);
    expect(amt(L, r2)).toBe(1_000_050);
    expect(amt(L, r1)).toBe(999_950);
    assertLedger(L);
    assertFlows(L, cp);
  });

  it('un hogar que gasta todo su saldo en partes fraccionarias queda en 0, nunca negativo', () => {
    const w = world();
    const batch = new PaymentBatch(w.L);
    batch.pay(w.d1, w.fd, 100.5, 'consumption');
    batch.pay(w.d1, w.fd, 100.25, 'consumption');
    batch.pay(w.d1, w.fd, 99.25, 'consumption');
    expect(batch.balance(w.d1)).toBe(0);
    batch.settle();
    expect(amt(w.L, w.d1)).toBe(0);
    expect(amt(w.L, w.fd)).toBe(300);
    assertFlows(w.L, w.cp);
  });

  it('applyPayments es atómico: si un saldo final quedaría negativo, no modifica nada', () => {
    const w = world();
    const before = JSON.stringify(w.L.contracts);
    expect(() =>
      applyPayments(w.L, [
        { from: w.d1, to: w.fd, amount: 200, category: 'consumption' },
        { from: w.d1, to: w.fd, amount: 200, category: 'consumption' },
      ]),
    ).toThrow(/quedaría en -100/);
    expect(JSON.stringify(w.L.contracts)).toBe(before);
    expect(w.L.flowLog).toEqual([]);
  });

  it('una cuenta que cobra y después paga puede pasar por un saldo intermedio negativo dentro del lote', () => {
    // La empresa arranca en 0, cobra 2 y paga 2: si el redondeo diera paga 2 antes de cobrar, el ledger
    // paso a paso fallaría; el lote valida solo el saldo final.
    const w = world();
    applyPayments(w.L, [
      { from: w.fd, to: w.d1, amount: 2, category: 'wages' },
      { from: w.d2, to: w.fd, amount: 2, category: 'consumption' },
    ]);
    expect(amt(w.L, w.fd)).toBe(0);
    assertFlows(w.L, w.cp);
  });
});
