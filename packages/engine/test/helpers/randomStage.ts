/**
 * Etapa de PRUEBA: transacciones financieras al azar pero válidas.
 *
 * No es lógica económica y nunca se usa fuera de los tests. Sirve para
 * ejercitar el ledger (y verificar el invariante SFC) y para consumir el PRNG
 * (y verificar el determinismo). Usa `publicSpending` para que los cambios de
 * perilla del log afecten el resultado.
 */

import { issue, redeem, transfer, type Agent, type Stage, type Rng, type SimState } from '../../src/index';

const MAX_AMOUNT = 100_000; // centavos

function pick<T>(items: readonly T[], rng: Rng): T {
  const item = items[rng.nextInt(items.length)];
  if (item === undefined) throw new Error('pick sobre lista vacía');
  return item;
}

function privateAgents(state: SimState): Agent[] {
  return [...state.households, ...state.firms];
}

function amount(rng: Rng, max = MAX_AMOUNT): number {
  return 1 + rng.nextInt(max);
}

export const randomTransactionsStage: Stage = (state, knobs, rng) => {
  const { bank, treasury, centralBank } = state;
  const privates = privateAgents(state);
  const operations = 20;

  for (let n = 0; n < operations; n++) {
    switch (rng.nextInt(7)) {
      case 0: {
        // Préstamo bancario: crea préstamo y depósito a la vez.
        const borrower = pick(privates, rng);
        const a = amount(rng);
        issue('loans', bank, borrower, a);
        issue('deposits', borrower, bank, a);
        break;
      }
      case 1: {
        // Pago entre privados con depósitos.
        const from = pick(privates, rng);
        const to = pick(privates, rng);
        if (from !== to && from.positions.deposits > 0) {
          transfer('deposits', from, to, amount(rng, from.positions.deposits));
        }
        break;
      }
      case 2: {
        // Cancelación de préstamo con depósitos.
        const borrower = pick(privates, rng);
        const max = Math.min(borrower.positions.deposits, -borrower.positions.loans);
        if (max > 0) {
          const a = amount(rng, max);
          redeem('deposits', borrower, bank, a);
          redeem('loans', bank, borrower, a);
        }
        break;
      }
      case 3: {
        // Adelanto del BCRA al Tesoro: emisión.
        const a = amount(rng);
        issue('advances', centralBank, treasury, a);
        issue('treasuryAccount', treasury, centralBank, a);
        break;
      }
      case 4: {
        // El Tesoro paga a un privado: baja su cuenta en el BCRA, suben reservas y depósitos.
        const payee = pick(privates, rng);
        const max = Math.min(treasury.positions.treasuryAccount, knobs.publicSpending + MAX_AMOUNT);
        if (max > 0) {
          const a = amount(rng, max);
          redeem('treasuryAccount', treasury, centralBank, a);
          issue('reserves', bank, centralBank, a);
          issue('deposits', payee, bank, a);
        }
        break;
      }
      case 5: {
        // Retiro de efectivo: baja depósito, baja reservas, sube efectivo.
        const holder = pick(privates, rng);
        const max = Math.min(holder.positions.deposits, bank.positions.reserves);
        if (max > 0) {
          const a = amount(rng, max);
          redeem('deposits', holder, bank, a);
          redeem('reserves', bank, centralBank, a);
          issue('cash', holder, centralBank, a);
        }
        break;
      }
      case 6: {
        // El banco compra bonos al BCRA pagando con reservas.
        const max = Math.min(bank.positions.reserves, centralBank.positions.bonds);
        if (max > 0) {
          const a = amount(rng, max);
          redeem('reserves', bank, centralBank, a);
          transfer('bonds', centralBank, bank, a);
        } else {
          // El BCRA compra bonos al Tesoro.
          const a = amount(rng);
          issue('bonds', centralBank, treasury, a);
          issue('treasuryAccount', treasury, centralBank, a);
        }
        break;
      }
    }
  }
};
