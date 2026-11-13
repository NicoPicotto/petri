/**
 * Propiedades del ledger (docs/ledger-contratos.md, sec. 2.8): secuencias de operaciones al azar,
 * con semilla, mantienen el chequeo estructural y las tres invariantes de flujos en cada tick; una
 * operación que falla no deja el estado a medio modificar.
 */

import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import {
  addAgent,
  checkLedger,
  cleanup,
  contractIds,
  contractOf,
  createLedger,
  credit,
  debit,
  firstAsset,
  installment,
  open,
  pay,
  payTo,
  serviceLoan,
  writeDown,
  type AgentId,
  type ContractId,
  type Ledger,
} from '../src/caiani/ledger';
import { beginPeriod, checkFlows } from '../src/caiani/flows';

function build(rng: Rng) {
  const L = createLedger();
  const cb = addAgent(L, 'centralBank');
  const gov = addAgent(L, 'government');
  const banks = [0, 1, 2].map(() => addAgent(L, 'bank'));
  const households = [0, 1, 2, 3, 4].map(() => addAgent(L, 'household'));
  const firms = [addAgent(L, 'consumptionFirm'), addAgent(L, 'consumptionFirm'), addAgent(L, 'capitalFirm')];
  for (const b of banks) {
    open(L, 'reserves', b, cb, 1_000_000, {}, 'deposits');
    open(L, 'cash', b, cb, 0, {}, 'deposits');
  }
  open(L, 'reserves', gov, cb, 2_000_000, {}, 'deposits');
  for (const a of [...households, ...firms]) {
    open(L, 'deposit', a, rng.pick(banks), rng.nextInt(500_000), { rate: 0.0025 }, 'deposits');
  }
  return { L, cb, gov, banks, households, firms };
}

const moneyOf = (L: Ledger, a: AgentId): ContractId[] => [
  ...contractIds(L, a, 'assets', 'deposit'),
  ...contractIds(L, a, 'assets', 'reserves'),
  ...contractIds(L, a, 'assets', 'cash'),
];

describe('ledger: propiedades con operaciones al azar', () => {
  it('las invariantes se cumplen en cada tick y las operaciones fallidas no modifican nada', () => {
    let failures = 0;
    let ops = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const rng = Rng.fromSeed(seed);
      const w = build(rng);
      const { L } = w;
      const payers = [...w.households, ...w.firms, ...w.banks, w.gov];
      for (let tick = 0; tick < 40; tick++) {
        const cp = beginPeriod(L);
        for (let k = 0; k < 30; k++) {
          const before = JSON.stringify(L);
          ops++;
          try {
            const op = rng.nextInt(9);
            const a = rng.pick(payers);
            const accounts = moneyOf(L, a);
            const from = accounts.length > 0 ? rng.pick(accounts) : undefined;
            const big = rng.nextInt(400_000);
            if (op === 0 && from !== undefined) {
              // Pago corriente a otra cuenta (puede fallar por saldo: se verifica la atomicidad).
              const b = rng.pick([...w.households, ...w.firms, w.gov]);
              const to = rng.pick(moneyOf(L, b));
              if (to !== from) pay(L, from, to, big, rng.pick(['consumption', 'wages', 'taxes', 'dividends'] as const));
            } else if (op === 1 && from !== undefined) {
              payTo(L, from, rng.pick([...w.banks, w.cb]), big, 'loanInterest');
            } else if (op === 2) {
              // Préstamo nuevo, acreditado en una cuenta de la empresa en el banco prestamista.
              const f = rng.pick(w.firms);
              const b = rng.pick(w.banks);
              const length = 1 + rng.nextInt(20);
              const loan = open(L, 'loan', b, f, big, { rate: 0.01, length, amortization: 'fixedCapital' }, 'loans');
              let dep = contractIds(L, f, 'assets', 'deposit').find((id) => contractOf(L, id).issuer === b);
              dep ??= open(L, 'deposit', f, b, 0, {}, 'deposits');
              credit(L, dep, contractOf(L, loan).amount, 'loans');
            } else if (op === 3) {
              // Servicio de un préstamo desde la primera cuenta (puede faltar liquidez).
              const f = rng.pick(w.firms);
              const loans = contractIds(L, f, 'liabilities', 'loan');
              const dep = firstAsset(L, f, 'deposit');
              if (loans.length > 0 && dep) serviceLoan(L, rng.pick(loans), dep.id);
            } else if (op === 4) {
              // Interés de depósitos capitalizado.
              const dep = firstAsset(L, rng.pick([...w.households, ...w.firms]), 'deposit');
              if (dep) credit(L, dep.id, Math.round(dep.rate * dep.amount), 'depositInterest');
            } else if (op === 5 && from !== undefined) {
              const c = contractOf(L, from);
              if (c.kind !== 'reserves') writeDown(L, from, rng.nextInt(c.amount + 2)); // a veces de más
            } else if (op === 6) {
              // Adelanto del BC a un banco.
              const b = rng.pick(w.banks);
              open(L, 'advance', w.cb, b, big, { rate: 0.005, length: 1, amortization: 'onlyInterest' }, 'advances');
              credit(L, firstAsset(L, b, 'reserves')!.id, big, 'advances');
            } else if (op === 7) {
              const b = rng.pick(w.banks);
              const advs = contractIds(L, b, 'liabilities', 'advance');
              const adv = advs.length > 0 ? contractOf(L, rng.pick(advs)) : undefined;
              if (adv && installment(adv).principal > 0) serviceLoan(L, adv.id, firstAsset(L, b, 'reserves')!.id);
            } else if (op === 8) {
              // Compra de bonos por un banco.
              const b = rng.pick(w.banks);
              const q = 1 + rng.nextInt(5);
              pay(L, firstAsset(L, b, 'reserves')!.id, firstAsset(L, w.gov, 'reserves')!.id, q * 1000, 'bonds');
              open(L, 'bond', b, w.gov, q * 1000, { quantity: q, price: 1000, maturity: 1, rate: 0.0025 }, 'bonds');
            }
          } catch (e) {
            failures++;
            expect((e as Error).message).toMatch(/ledger|serviceLoan/);
            expect(JSON.stringify(L)).toBe(before);
          }
        }
        // Rescate de los bonos que vencen este tick (Government.payInterests) y limpieza de todos.
        const govAcc = firstAsset(L, w.gov, 'reserves')!.id;
        for (const b of w.banks) {
          for (const id of [...contractIds(L, b, 'assets', 'bond')]) {
            const bond = contractOf(L, id);
            if (bond.age !== bond.maturity) continue;
            const principal = bond.amount;
            pay(L, govAcc, firstAsset(L, b, 'reserves')!.id, principal, 'bonds');
            debit(L, id, principal, 'bonds');
          }
        }
        for (const a of L.agents) cleanup(L, a.id);
        expect(checkLedger(L)).toEqual([]);
        expect(checkFlows(L, cp)).toEqual([]);
      }
    }
    // Que el test ejercite de verdad los dos caminos.
    expect(ops).toBe(5 * 40 * 30);
    expect(failures).toBeGreaterThan(50);
    expect(failures).toBeLessThan(ops / 2);
  });
});

