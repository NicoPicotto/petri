/**
 * Pagos en dos fases con redondeo controlado (decisión de Nico, 2026-11-13; docs/reglas-caiani.md, sec. 1,
 * "Reservas"). Casos calculados a mano y propiedades con semilla. Los montos están en µ.
 */

import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import { addAgent, applyPayments, assertLedger, contractOf, createLedger, open, pay, type Ledger } from '../src/caiani/ledger';
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
  it('600 lotes al azar: cada monto, cada cuenta y cada banco dentro de su garantía, sin relajar', () => {
    const rng = Rng.fromSeed(2026);
    let mixedSeen = 0;
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
      expect(r.maxGroupDiff).toBeLessThan(1);
      r.m.forEach((m, i) => {
        expect(Number.isInteger(m)).toBe(true);
        expect(Math.abs(m - x[i]!)).toBeLessThan(1);
      });
      const px = sumBy(g.fromAcc, x);
      const pm = sumBy(g.fromAcc, r.m);
      const rx = sumBy(g.toAcc, x);
      const rm = sumBy(g.toAcc, r.m);
      // Lo cobrado por cada cuenta, a < 1 µ.
      for (const [k, v] of rx) expect(Math.abs(rm.get(k)! - v)).toBeLessThan(1);
      for (const [k, v] of px) {
        const rec = rx.get(k);
        if (rec === undefined) {
          expect(Math.abs(pm.get(k)! - v)).toBeLessThan(1); // solo paga: lo pagado a < 1 µ
        } else {
          mixedSeen++;
          // Cobra y paga: el neto a < 1 µ (lo pagado solo, a < 2 µ).
          expect(Math.abs(pm.get(k)! - rm.get(k)! - (v - rec))).toBeLessThan(1);
          expect(Math.abs(pm.get(k)! - v)).toBeLessThan(2);
        }
      }
      // Reservas: la variación de cada banco (lo que cobran sus cuentas − lo que pagan), a < 2 µ.
      for (let b = 0; b < banks; b++) {
        let dx = 0;
        let dm = 0;
        rows.forEach((row, i) => {
          if (row[3] === b) (dx += x[i]!), (dm += r.m[i]!);
          if (row[0] === b) (dx -= x[i]!), (dm -= r.m[i]!);
        });
        expect(Math.abs(dm - dx)).toBeLessThan(2);
      }
    }
    expect(mixedSeen).toBeGreaterThan(1000);
  });

  it('cuentas que cobran y pagan en el mismo lote: saldo ≥ 0 si en double lo es, y 0 exacto si en double es 0 exacto', () => {
    const rng = Rng.fromSeed(1113);
    let zeros = 0;
    let fractional = 0;
    for (let t = 0; t < 600; t++) {
      const banks = 1 + Math.floor(rng.nextFloat() * 4);
      const accounts = 2 + Math.floor(rng.nextFloat() * 20);
      const bankOf = Array.from({ length: accounts }, () => Math.floor(rng.nextFloat() * banks));
      const balance = Array.from({ length: accounts }, () => Math.floor(rng.nextFloat() * (rng.nextFloat() < 0.5 ? 20 : 1e8)));
      // Con montos diádicos (múltiplos de 1/1024) las sumas en double son exactas y un 0 en double es 0 de verdad;
      // con montos cualesquiera se prueba solo el ≥ 0.
      const dyadic = t % 2 === 0;
      const amount = (max: number) => (dyadic ? Math.floor(rng.nextFloat() * max * 1024) / 1024 : rng.nextFloat() * max);
      const rows: [number, number, number, number][] = [];
      const x: number[] = [];
      const add = (a: number, b: number, v: number) => {
        if (!(v > 0)) return;
        rows.push([bankOf[a]!, a, b, bankOf[b]!]);
        x.push(v);
      };
      // Saldo en double de cada cuenta con los pagos anotados (como `PaymentBatch.balance`).
      const live = balance.map((b) => b);
      const n = 1 + Math.floor(rng.nextFloat() * 120);
      for (let i = 0; i < n; i++) {
        const a = Math.floor(rng.nextFloat() * accounts);
        const b = Math.floor(rng.nextFloat() * accounts);
        if (a === b) continue;
        // Paga una parte de lo que tiene, o todo (como `reallocateLiquidity` y la compra de todo lo que alcanza).
        const all = rng.nextFloat() < 0.3;
        const v = all ? live[a]! : Math.min(live[a]!, amount(Math.max(1, live[a]! / 3)));
        if (!(v > 0)) continue;
        add(a, b, v);
        live[a] = live[a]! - v;
        live[b] = live[b]! + v;
      }
      if (x.length === 0) continue;
      const g = groups(rows);
      const r = controlledRound(x, g, (acc) => balance[acc]);
      const px = sumBy(g.fromAcc, x);
      const rx = sumBy(g.toAcc, x);
      const pm = sumBy(g.fromAcc, r.m);
      const rm = sumBy(g.toAcc, r.m);
      for (const [k, p] of px) {
        const rec = rx.get(k);
        if (rec === undefined) continue; // las que solo pagan ya tenían el techo
        const finalDouble = balance[k]! + rec - p;
        const finalInt = balance[k]! + rm.get(k)! - pm.get(k)!;
        if (finalDouble >= 0) expect(finalInt).toBeGreaterThanOrEqual(0);
        // El 0 exacto vale para el neto que suma el algoritmo (p − r en el orden de los pagos). Con montos
        // diádicos la cuenta en double es exacta y coincide con la de acá; con montos cualesquiera, un 0 que
        // sale de redondear puede ser p − r = saldo − ε en las sumas del algoritmo (queda en 0 o en +1 µ).
        if (dyadic && finalDouble === 0) {
          zeros++;
          expect(finalInt).toBe(0);
        } else if (finalDouble > 0 && finalDouble < 1) fractional++;
      }
    }
    // Que el test ejercite los dos casos.
    expect(zeros).toBeGreaterThan(50);
    expect(fractional).toBeGreaterThan(50);
  });

  it('el caso del tick 108 (evento 19): cobra el faltante desde su segundo depósito y paga todo; queda en 0, no en −1', () => {
    // Depósito 126 (empresa JMAB 8179): saldo 56.404.056 µ; cobra 37.961.232,534… µ y paga 94.365.288,534… µ
    // (misma parte fraccionaria). Antes, el redondeo podía bajar lo cobrado y subir lo pagado: −1 µ.
    const r1 = 37961232.53404787;
    const p1 = 94365288.53404787;
    const r = controlledRound(
      [r1, p1],
      groups([
        [7, 127, 126, 3],
        [3, 126, 900, 5],
      ]),
      (acc) => (acc === 126 ? 56404056 : acc === 127 ? 107354869 : undefined),
    );
    expect(56404056 + r.m[0]! - r.m[1]!).toBe(0);
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

  it('pagos a un préstamo (evento 20 y quiebra): interés, capital y aporte de los dueños; el préstamo no queda negativo', () => {
    const w = world();
    const L = w.L;
    const [h1, f, b2] = [contractOf(L, w.d1).holder, contractOf(L, w.fd).holder, contractOf(L, w.res2).holder];
    pay(L, w.d1, w.fd, 200, 'consumption');
    const loan = open(L, 'loan', b2, f, 100, { rate: 0, length: 20, amortization: 'fixedCapital' }, 'loans');
    const cp = beginPeriod(L); // condiciones iniciales del caso (el préstamo se abre sin acreditarse en un depósito)
    const batch = new PaymentBatch(L);
    batch.payLoan('interest', w.fd, loan, 2.5); // al banco 2, desde un depósito en el 1: mueve reservas
    batch.payLoan('repay', w.fd, loan, 10.5);
    // Aporte de los dueños: 30,4 desde el banco 1 y 59,4 desde el 2 (el prestamista). En double, el préstamo
    // recibe 100,3 > 100: el techo del préstamo deja la suma redondeada en exactamente 100.
    batch.payLoan('bailout', w.d1, loan, 30.4);
    batch.payLoan('bailout', w.d3, loan, 59.4);
    expect(batch.balance(loan)).toBeCloseTo(-0.3, 12);
    const fd0 = amt(L, w.fd);
    const [r1, r2] = [amt(L, w.res1), amt(L, w.res2)];
    batch.settle();
    expect(amt(L, loan)).toBe(0);
    const paidByFirm = fd0 - amt(L, w.fd);
    expect(Math.abs(paidByFirm - 13)).toBeLessThan(1); // 2,5 + 10,5
    // Reservas: el banco 1 le paga al 2 lo de la empresa y lo del hogar 1; el pago del hogar 3 queda en el banco 2.
    const fromBank1 = r1 - amt(L, w.res1);
    expect(amt(L, w.res2) - r2).toBe(fromBank1);
    expect(Math.abs(fromBank1 - (13 + 30.4))).toBeLessThan(2);
    // Registros: el aporte es una transferencia corriente hogar → empresa (ownersBailout) más la baja del préstamo.
    const owners = L.flowLog.filter((r) => r.category === 'ownersBailout');
    expect(owners.map((r) => [r.payer, r.payee])).toEqual([
      [h1, f],
      [contractOf(L, w.d3).holder, f],
    ]);
    assertLedger(L);
    assertFlows(L, cp);
  });

  it('aporte negativo (bailoutRefund): el préstamo sube, el hogar cobra y las reservas van del prestamista a su banco', () => {
    const w = world();
    const L = w.L;
    const [h1, h3, f, b2] = [contractOf(L, w.d1).holder, contractOf(L, w.d3).holder, contractOf(L, w.fd).holder, contractOf(L, w.res2).holder];
    const loan = open(L, 'loan', b2, f, 100, { rate: 0, length: 20, amortization: 'fixedCapital' }, 'loans');
    const cp = beginPeriod(L);
    const batch = new PaymentBatch(L);
    // El hogar 1 (banco 1) aporta 69,6 y el 3 (banco 2, el prestamista) 30,7: el préstamo recibiría 100,3 > 100.
    // Después el hogar 1 cobra 2,5 (aporte negativo): el préstamo baja en neto 97,8 y queda en 2,2.
    batch.payLoan('bailout', w.d1, loan, 69.6);
    batch.payLoan('bailout', w.d3, loan, 30.7);
    batch.refundBailout(loan, w.d1, 2.5);
    expect(batch.balance(loan)).toBeCloseTo(2.2, 12);
    expect(batch.balance(w.d1)).toBeCloseTo(232.9, 12);
    const [r1, r2] = [amt(L, w.res1), amt(L, w.res2)];
    batch.settle();
    // Préstamo (cuenta que cobra y "paga"): baja en neto 97,8 → {97, 98}; queda en 2 o 3.
    expect([2, 3]).toContain(amt(L, loan));
    // Hogar 1 (cobra y paga): neto −67,1 → 300 − {67, 68}.
    expect([232, 233]).toContain(amt(L, w.d1));
    // Reservas: entre el banco 1 y el 2 se mueve el neto del hogar 1; el pago del hogar 3 queda en el banco 2.
    expect(amt(L, w.res2) - r2).toBe(r1 - amt(L, w.res1));
    expect(r1 - amt(L, w.res1)).toBe(300 - amt(L, w.d1));
    // Registros del aporte negativo: el prestamista le presta a la empresa (loans) y la empresa le paga al hogar.
    const owners = L.flowLog.filter((r) => r.category === 'ownersBailout');
    expect(owners.map((r) => [r.payer, r.payee])).toEqual([
      [h1, f],
      [h3, f],
      [f, h1],
    ]);
    assertLedger(L);
    assertFlows(L, cp);
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

describe('PaymentBatch: cota del lote por mecanismo (bordes redondeados por contrato) y reparto exacto (paySplit)', () => {
  it('k del lote: cuenta común = 1; reservas que solo liquidan = 2; reservas que además pagan como cuenta = 3', () => {
    const w = world();
    const batch = new PaymentBatch(w.L);
    // Pagos entre bancos en los dos sentidos: los dos bancos están del lado que paga y del que cobra.
    batch.pay(w.d1, w.d3, 10.4, 'consumption'); // banco 1 → banco 2
    batch.pay(w.d3, w.d2, 5.3, 'consumption'); // banco 2 → banco 1
    const r1 = batch.settle();
    expect(r1.edges.get(w.d1)).toBe(1); // solo paga
    expect(r1.edges.get(w.d2)).toBe(1); // solo cobra
    expect(r1.edges.get(w.d3)).toBe(1); // cobra y paga: su variación es menos el borde del neto
    expect(r1.edges.get(w.res1)).toBe(2);
    expect(r1.edges.get(w.res2)).toBe(2);
    // Las reservas del banco 1 además pagan como cuenta (como los dividendos de un banco): 3.
    const w2 = world();
    const b2 = new PaymentBatch(w2.L);
    b2.pay(w2.d1, w2.d3, 10.4, 'consumption');
    b2.pay(w2.d3, w2.d2, 5.3, 'consumption');
    b2.pay(w2.res1, w2.d3, 7.7, 'dividends');
    const r2 = b2.settle();
    expect(r2.edges.get(w2.res1)).toBe(3);
    expect(r2.edges.get(w2.res2)).toBe(2);
    // Y cada contrato cumple su cota: |variación entera − variación en double| < k µ.
    expect(Math.abs(amt(w2.L, w2.res1) - (1000 - 10.4 + 5.3 - 7.7))).toBeLessThan(3);
    assertLedger(w2.L);
    assertFlows(w2.L, w2.cp);
  });

  it('paySplit: 300 µ entre 7 partes iguales y entre pesos desparejos; el lote reparte exactamente el total y la cuenta queda en 0', () => {
    for (const weights of [[1, 1, 1, 1, 1, 1, 1], [3, 0.5, 1e-3, 2.25, 7]]) {
      const w = world();
      const batch = new PaymentBatch(w.L);
      const to = [w.d2, w.d3, w.fd];
      const x = batch.paySplit(w.d1, 300, weights, (i, amount) => batch.pay(w.d1, to[i % 3]!, amount, 'wages'));
      let W = 0;
      for (const v of weights) W += v;
      x.slice(0, -1).forEach((xi, i) => expect(xi).toBe((300 * weights[i]!) / W));
      batch.settle();
      expect(amt(w.L, w.d1)).toBe(0);
      expect(amt(w.L, w.d2) + amt(w.L, w.d3) + amt(w.L, w.fd)).toBe(900);
      assertLedger(w.L);
      assertFlows(w.L, w.cp);
    }
  });

  it('paySplit: error si la cuenta ya pagó en el lote o si el total no es un entero seguro', () => {
    const w = world();
    const batch = new PaymentBatch(w.L);
    batch.pay(w.d1, w.d2, 1.5, 'wages');
    expect(() => batch.paySplit(w.d1, 100, [1, 1], (_, a) => batch.pay(w.d1, w.d3, a, 'wages'))).toThrow(/ya pagó/);
    expect(() => batch.paySplit(w.d2, 10.5, [1, 1], (_, a) => batch.pay(w.d2, w.d3, a, 'wages'))).toThrow(/total inválido/);
  });
});
