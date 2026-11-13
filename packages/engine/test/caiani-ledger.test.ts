/**
 * Ledger de contratos del port de Caiani (P1): cada operación con un caso calculado a mano
 * (docs/ledger-contratos.md, sec. 2.8). Los montos están en µ.
 */

import { describe, expect, it } from 'vitest';
import {
  addAgent,
  assertLedger,
  cleanup,
  contractIds,
  contractOf,
  createLedger,
  credit,
  debit,
  installment,
  netFinancialWorth,
  open,
  pay,
  payTo,
  serviceLoan,
  writeDown,
  type Ledger,
} from '../src/caiani/ledger';
import { assertFlows, beginPeriod, checkFlows, type Checkpoint } from '../src/caiani/flows';

/** BC, gobierno, dos bancos, un hogar y una empresa de consumo, con cuentas iniciales. */
function world() {
  const L = createLedger();
  const cb = addAgent(L, 'centralBank');
  const gov = addAgent(L, 'government');
  const b1 = addAgent(L, 'bank');
  const b2 = addAgent(L, 'bank');
  const h = addAgent(L, 'household');
  const f = addAgent(L, 'consumptionFirm');
  // Condiciones iniciales (antes del primer período de chequeo).
  const res1 = open(L, 'reserves', b1, cb, 1000, {}, 'deposits');
  const res2 = open(L, 'reserves', b2, cb, 1000, {}, 'deposits');
  const govAcc = open(L, 'reserves', gov, cb, 5000, {}, 'deposits');
  const hDep = open(L, 'deposit', h, b1, 300, { rate: 0.01 }, 'deposits');
  const fDep1 = open(L, 'deposit', f, b1, 0, {}, 'deposits');
  const cp = beginPeriod(L);
  return { L, cb, gov, b1, b2, h, f, res1, res2, govAcc, hDep, fDep1, cp };
}

const amt = (L: Ledger, id: number) => contractOf(L, id).amount;

function expectConsistent(L: Ledger, cp: Checkpoint) {
  assertLedger(L);
  assertFlows(L, cp);
}

describe('pagos (AbstractBank.transfer, CentralBank.transfer)', () => {
  it('mismo banco: solo se mueven los dos depósitos', () => {
    const w = world();
    pay(w.L, w.hDep, w.fDep1, 120, 'consumption');
    expect(amt(w.L, w.hDep)).toBe(180);
    expect(amt(w.L, w.fDep1)).toBe(120);
    expect(amt(w.L, w.res1)).toBe(1000);
    expectConsistent(w.L, w.cp);
  });

  it('bancos distintos: las reservas pasan del banco del pagador al del cobrador', () => {
    const w = world();
    const fDep2 = open(w.L, 'deposit', w.f, w.b2, 0, {}, 'deposits');
    pay(w.L, w.hDep, fDep2, 120, 'consumption');
    expect([amt(w.L, w.hDep), amt(w.L, fDep2)]).toEqual([180, 120]);
    expect([amt(w.L, w.res1), amt(w.L, w.res2)]).toEqual([880, 1120]);
    // Patrimonio: el hogar −120, la empresa +120, los bancos sin cambio.
    expect(netFinancialWorth(w.L, w.h)).toBe(180);
    expect(netFinancialWorth(w.L, w.b1)).toBe(1000 - 300);
    expectConsistent(w.L, w.cp);
  });

  it('desde la cuenta del gobierno: suben el depósito y las reservas del banco del cobrador', () => {
    const w = world();
    pay(w.L, w.govAcc, w.hDep, 50, 'wages');
    expect([amt(w.L, w.govAcc), amt(w.L, w.hDep), amt(w.L, w.res1)]).toEqual([4950, 350, 1050]);
    expectConsistent(w.L, w.cp);
  });

  it('impuestos hacia la cuenta del gobierno: bajan el depósito y las reservas (Households.payTaxes)', () => {
    const w = world();
    pay(w.L, w.hDep, w.govAcc, 20, 'taxes');
    expect([amt(w.L, w.hDep), amt(w.L, w.res1), amt(w.L, w.govAcc)]).toEqual([280, 980, 5020]);
    expectConsistent(w.L, w.cp);
  });

  it('efectivo → depósito: el efectivo del banco cambia en espejo', () => {
    const L = createLedger();
    const cb = addAgent(L, 'centralBank');
    const b = addAgent(L, 'bank');
    const h = addAgent(L, 'household');
    const bCash = open(L, 'cash', b, cb, 0, {}, 'deposits');
    open(L, 'reserves', b, cb, 0, {}, 'deposits');
    const hCash = open(L, 'cash', h, cb, 40, {}, 'deposits');
    const hDep = open(L, 'deposit', h, b, 0, {}, 'deposits');
    const cp = beginPeriod(L);
    pay(L, hCash, hDep, 40, 'deposits');
    expect([amt(L, hCash), amt(L, hDep), amt(L, bCash)]).toEqual([0, 40, 40]);
    expectConsistent(L, cp);
  });
});

describe('reservas negativas (decisión de Nico, 2026-11-13: como en JMAB, con contador)', () => {
  it('un banco puede quedar con reservas negativas; se cuenta el paso de ≥ 0 a < 0', () => {
    const w = world();
    const fDep2 = open(w.L, 'deposit', w.f, w.b2, 0, {}, 'deposits');
    credit(w.L, w.hDep, 1000, 'depositInterest'); // el hogar tiene 1.300
    pay(w.L, w.hDep, fDep2, 1200, 'consumption');
    expect(amt(w.L, w.res1)).toBe(-200);
    expect(w.L.stats.negativeReservesBank).toBe(1);
    pay(w.L, w.hDep, fDep2, 50, 'consumption'); // sigue negativa: no se vuelve a contar
    expect(w.L.stats.negativeReservesBank).toBe(1);
    expectConsistent(w.L, w.cp);
  });

  it('la cuenta del gobierno con déficit se cuenta aparte', () => {
    const w = world();
    pay(w.L, w.govAcc, w.hDep, 6000, 'wages');
    expect(amt(w.L, w.govAcc)).toBe(-1000);
    expect(w.L.stats.negativeReservesGovernment).toBe(1);
    expect(w.L.stats.negativeReservesBank).toBe(0);
    expectConsistent(w.L, w.cp);
  });
});

describe('préstamos (ConstrainedCreditMechanism, computeDebtPayments, payInterests)', () => {
  it('préstamo nuevo en un banco donde el deudor no tenía cuenta: se abre una segunda cuenta', () => {
    const w = world();
    const loan = open(w.L, 'loan', w.b2, w.f, 2000, { rate: 0.01, length: 20, amortization: 'fixedCapital' }, 'loans');
    const fDep2 = open(w.L, 'deposit', w.f, w.b2, 0, {}, 'deposits');
    credit(w.L, fDep2, 2000, 'loans');
    expect(contractIds(w.L, w.f, 'assets', 'deposit')).toEqual([w.fDep1, fDep2]);
    expect(contractIds(w.L, w.f, 'liabilities', 'loan')).toEqual([loan]);
    expect(contractOf(w.L, loan).initialAmount).toBe(2000);
    // Crédito: los dos balances se amplían, nadie gana ni pierde.
    expect(netFinancialWorth(w.L, w.f)).toBe(0);
    // La empresa junta las cuentas en la primera antes de pagar (CapitalFirm.payInterests).
    pay(w.L, fDep2, w.fDep1, 2000, 'deposits');
    expect([amt(w.L, w.res1), amt(w.L, w.res2)]).toEqual([3000, -1000]);
    expectConsistent(w.L, w.cp);
  });

  it('cuotas de capital: redondeo(A·a/L) − redondeo(A·(a−1)/L); la última cierra en cero', () => {
    // A = 10 µ, L = 3: JMAB pagaría 3,33 por cuota. Acá: 3, 4 (7 − 3) y 3 (10 − 7).
    const L = createLedger();
    const b = addAgent(L, 'bank');
    const f = addAgent(L, 'capitalFirm');
    const id = open(L, 'loan', b, f, 10, { rate: 0, length: 3, amortization: 'fixedCapital' }, 'loans');
    const c = contractOf(L, id);
    expect(installment(c)).toEqual({ interest: 0, principal: 0 }); // edad 0: no se paga
    const paid: number[] = [];
    for (let age = 1; age <= 3; age++) {
      c.age = age;
      const { principal } = installment(c);
      paid.push(principal);
      c.amount -= principal;
    }
    expect(paid).toEqual([3, 4, 3]);
    expect(c.amount).toBe(0);
  });

  it('la suma de las cuotas es exactamente A y cada una difiere de A/L en menos de 1 µ', () => {
    const L = createLedger();
    const b = addAgent(L, 'bank');
    const f = addAgent(L, 'capitalFirm');
    const A = 123_456_789;
    const c = contractOf(L, open(L, 'loan', b, f, A, { rate: 0, length: 20, amortization: 'fixedCapital' }, 'loans'));
    let sum = 0;
    for (let age = 1; age <= 20; age++) {
      c.age = age;
      const p = installment(c).principal;
      expect(Math.abs(p - A / 20)).toBeLessThan(1);
      sum += p;
      c.amount -= p;
    }
    expect(sum).toBe(A);
  });

  it('servicio desde un depósito en otro banco: interés y capital al prestamista, con reservas', () => {
    const w = world();
    // Préstamo de b2 por 2.000 µ al 1%, 20 cuotas; la empresa tiene 500 µ en b1.
    const loan = open(w.L, 'loan', w.b2, w.f, 2000, { rate: 0.01, length: 20, amortization: 'fixedCapital' }, 'loans');
    const fDep2 = open(w.L, 'deposit', w.f, w.b2, 0, {}, 'deposits');
    credit(w.L, fDep2, 2000, 'loans');
    pay(w.L, fDep2, w.fDep1, 2000, 'deposits'); // reservas: b1 3.000, b2 −1.000
    pay(w.L, w.fDep1, w.hDep, 1500, 'wages');
    expectConsistent(w.L, w.cp);
    const cp = beginPeriod(w.L);
    contractOf(w.L, loan).age = 1;
    // Interés = 1% · 2.000 = 20; capital = 2.000/20 = 100; total 120.
    expect(serviceLoan(w.L, loan, w.fDep1)).toEqual({ interest: 20, principal: 100 });
    expect(amt(w.L, w.fDep1)).toBe(380);
    expect(amt(w.L, loan)).toBe(1900);
    expect([amt(w.L, w.res1), amt(w.L, w.res2)]).toEqual([3000 - 120, -1000 + 120]);
    // Patrimonio: la empresa pierde el interés, el prestamista lo gana, b1 no cambia.
    expectConsistent(w.L, cp);
  });

  it('servicio sin liquidez: error y nada modificado', () => {
    const w = world();
    const loan = open(w.L, 'loan', w.b1, w.f, 2000, { rate: 0.01, length: 20, amortization: 'fixedCapital', age: 1 }, 'loans');
    const before = JSON.stringify(w.L);
    expect(() => serviceLoan(w.L, loan, w.fDep1)).toThrow(/cuota/);
    expect(JSON.stringify(w.L)).toBe(before);
  });

  it('préstamos iniciales (sec. 1): pagan saldo/20 y vencen con saldo, que se condona explícitamente', () => {
    // Préstamo inicial con edad 19 (j = 18) y saldo 1.000 µ: JMAB le pone initialAmount = 1.000,
    // paga 50 por cuota en las edades 19 y 20 y lo borra en la limpieza con 900 µ pendientes.
    const w = world();
    const loan = open(w.L, 'loan', w.b1, w.f, 1000, { rate: 0, length: 20, amortization: 'fixedCapital', age: 19 }, 'loans');
    credit(w.L, w.fDep1, 1000, 'loans');
    const cp = beginPeriod(w.L);
    expect(serviceLoan(w.L, loan, w.fDep1).principal).toBe(50);
    cleanup(w.L, w.b1); // edad 20
    expect(serviceLoan(w.L, loan, w.fDep1).principal).toBe(50);
    expect(amt(w.L, loan)).toBe(900);
    const fBefore = netFinancialWorth(w.L, w.f);
    cleanup(w.L, w.b1); // edad 21 > 20: se cierra
    expect(w.L.contracts[loan]).toBeUndefined();
    expect(contractIds(w.L, w.f, 'liabilities', 'loan')).toEqual([]);
    expect(w.L.stats.writtenOffAtExpiry).toBe(1);
    expect(netFinancialWorth(w.L, w.f) - fBefore).toBe(900); // la condonación es ganancia del deudor
    const last = w.L.flowLog.at(-1)!;
    expect(last).toMatchObject({ category: 'writeOff', payer: w.b1, payee: w.f, amount: 900 });
    expectConsistent(w.L, cp);
  });

  it('adelanto del BC: solo interés, se paga entero al vencer desde las reservas', () => {
    const w = world();
    // Tasa 1% (en Caiani es 0,5%) para que el interés sea exacto: 0,01 · 100 = 1 µ.
    const adv = open(w.L, 'advance', w.cb, w.b1, 100, { rate: 0.01, length: 1, amortization: 'onlyInterest' }, 'advances');
    credit(w.L, w.res1, 100, 'advances');
    cleanup(w.L, w.cb); // edad 1
    expect(serviceLoan(w.L, adv, w.res1)).toEqual({ interest: 1, principal: 100 });
    expect(amt(w.L, w.res1)).toBe(999);
    cleanup(w.L, w.cb); // saldo 0: se cierra
    expect(contractIds(w.L, w.b1, 'liabilities', 'advance')).toEqual([]);
    expectConsistent(w.L, w.cp);
  });
});

describe('bonos (BondMechanism, Government.payInterests)', () => {
  it('compra, interés y rescate con un banco; interés al BC', () => {
    const w = world();
    // El banco compra 5 bonos a precio 100 µ (en el modelo, precio 1 unidad).
    pay(w.L, w.res1, w.govAcc, 500, 'bonds');
    const bond = open(w.L, 'bond', w.b1, w.gov, 500, { quantity: 5, price: 100, maturity: 1, rate: 0.0025 }, 'bonds');
    // El BC compra con creación de dinero: sube la cuenta del gobierno.
    const cbBond = open(w.L, 'bond', w.cb, w.gov, 300, { quantity: 3, price: 100, maturity: 1, rate: 0.0025 }, 'bonds');
    credit(w.L, w.govAcc, 300, 'bonds');
    expect(amt(w.L, w.govAcc)).toBe(5800);
    cleanup(w.L, w.b1);
    cleanup(w.L, w.cb); // edad 1 = maturity: se paga este tick
    // Interés (1 µ a cada tenedor) y rescate.
    pay(w.L, w.govAcc, w.res1, 1, 'bondInterest');
    pay(w.L, w.govAcc, w.res1, 500, 'bonds');
    debit(w.L, bond, 500, 'bonds');
    payTo(w.L, w.govAcc, w.cb, 1, 'bondInterest');
    payTo(w.L, w.govAcc, w.cb, 300, 'bonds');
    debit(w.L, cbBond, 300, 'bonds');
    expect(amt(w.L, w.res1)).toBe(1001);
    expect(amt(w.L, w.govAcc)).toBe(5800 - 1 - 500 - 1 - 300);
    cleanup(w.L, w.b1);
    cleanup(w.L, w.cb); // edad 2 > maturity: se cierran
    expect(contractIds(w.L, w.gov, 'liabilities', 'bond')).toEqual([]);
    expectConsistent(w.L, w.cp);
  });

  it('un bono que vence sin rescatar es un error del port', () => {
    const w = world();
    open(w.L, 'bond', w.b1, w.gov, 500, { quantity: 5, price: 100, maturity: 1, age: 1 }, 'bonds');
    expect(() => cleanup(w.L, w.b1)).toThrow(/sin rescatar/);
  });
});

describe('intereses de depósitos, quitas y limpieza', () => {
  it('interés de depósitos capitalizado (Bank.payDepositInterests): gasto del banco, ingreso del hogar', () => {
    const w = world();
    credit(w.L, w.hDep, Math.round(0.01 * amt(w.L, w.hDep)), 'depositInterest');
    expect(amt(w.L, w.hDep)).toBe(303);
    expect(netFinancialWorth(w.L, w.b1)).toBe(1000 - 303);
    expectConsistent(w.L, w.cp);
  });

  it('quita: pérdida del tenedor, ganancia del emisor', () => {
    const w = world();
    writeDown(w.L, w.hDep, 30);
    expect(amt(w.L, w.hDep)).toBe(270);
    expect(w.L.flowLog.at(-1)).toMatchObject({ category: 'writeOff', payer: w.h, payee: w.b1 });
    expectConsistent(w.L, w.cp);
  });

  it('la limpieza recorre de atrás para adelante, suma edad y conserva el orden del resto', () => {
    const w = world();
    const terms = { rate: 0, length: 20, amortization: 'fixedCapital' as const };
    const l1 = open(w.L, 'loan', w.b1, w.f, 10, terms, 'loans');
    const l2 = open(w.L, 'loan', w.b1, w.f, 20, terms, 'loans');
    const l3 = open(w.L, 'loan', w.b1, w.f, 30, terms, 'loans');
    credit(w.L, w.fDep1, 60, 'loans');
    payTo(w.L, w.fDep1, w.b1, 20, 'loans');
    debit(w.L, l2, 20, 'loans');
    cleanup(w.L, w.b1);
    expect(contractIds(w.L, w.b1, 'assets', 'loan')).toEqual([l1, l3]);
    expect(contractIds(w.L, w.f, 'liabilities', 'loan')).toEqual([l1, l3]);
    expect([contractOf(w.L, l1).age, contractOf(w.L, l3).age]).toEqual([1, 1]);
    expectConsistent(w.L, w.cp);
  });
});

describe('signos y atomicidad', () => {
  it('un pago que dejaría un depósito negativo tira error y no modifica nada', () => {
    const w = world();
    const before = JSON.stringify(w.L);
    expect(() => pay(w.L, w.hDep, w.fDep1, 301, 'consumption')).toThrow(/solo las reservas/);
    expect(JSON.stringify(w.L)).toBe(before);
  });

  it('tenedor o emisor no permitido', () => {
    const w = world();
    expect(() => open(w.L, 'deposit', w.b1, w.b2, 0, {}, 'deposits')).toThrow(/no puede tener/);
    expect(() => open(w.L, 'loan', w.b1, w.h, 10, { length: 20, amortization: 'fixedCapital' }, 'loans')).toThrow();
  });

  it('las invariantes de flujos detectan un saldo cambiado por fuera de las operaciones', () => {
    const w = world();
    contractOf(w.L, w.hDep).amount += 5;
    const errors = checkFlows(w.L, w.cp);
    expect(errors.some((e) => e.startsWith('stock'))).toBe(true);
    expect(errors.some((e) => e.startsWith(`agente ${w.h}`))).toBe(true);
  });

  it('las invariantes de flujos detectan un pago corriente mal clasificado como financiero', () => {
    const w = world();
    pay(w.L, w.hDep, w.fDep1, 10, 'deposits'); // es consumo, no un movimiento entre cuentas propias
    expect(checkFlows(w.L, w.cp).some((e) => e.includes('Δ patrimonio'))).toBe(true);
  });
});
