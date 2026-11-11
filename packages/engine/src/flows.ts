/**
 * Flujos contables compuestos, armados solo con las primitivas del ledger.
 *
 * En la Fase 0 el banco no presta: su activo son reservas y su pasivo, depósitos,
 * siempre por el mismo monto. Cuando la plata entra o sale del sector privado
 * (pagos del Tesoro, impuestos) se mueven a la vez depósitos, reservas y la
 * cuenta del Tesoro en el BCRA.
 */

import { issue, redeem, transfer, type Agent } from './ledger';
import type { Cents } from './money';
import type { SimState } from './state';

/** Pago entre privados con depósitos. Falla si el pagador no tiene saldo. */
export function payDeposits(from: Agent, to: Agent, amount: Cents): void {
  if (amount > 0) transfer('deposits', from, to, amount);
}

/** Un privado le paga al Tesoro (ej.: una retención de impuestos). */
export function payToTreasury(state: SimState, payer: Agent, amount: Cents): void {
  if (amount <= 0) return;
  redeem('deposits', payer, state.bank, amount);
  redeem('reserves', state.bank, state.centralBank, amount);
  issue('treasuryAccount', state.treasury, state.centralBank, amount);
}

/** El Tesoro le paga a un privado desde su cuenta en el BCRA. Falla si no hay fondos. */
export function payFromTreasury(state: SimState, payee: Agent, amount: Cents): void {
  if (amount <= 0) return;
  redeem('treasuryAccount', state.treasury, state.centralBank, amount);
  issue('reserves', state.bank, state.centralBank, amount);
  issue('deposits', payee, state.bank, amount);
}

/**
 * Si a la cuenta del Tesoro no le alcanza para pagar `amount`, pide un adelanto
 * transitorio al BCRA por la diferencia. Devuelve el monto emitido.
 */
export function coverWithAdvances(state: SimState, amount: Cents): Cents {
  const shortfall = amount - state.treasury.positions.treasuryAccount;
  if (shortfall <= 0) return 0;
  issue('advances', state.centralBank, state.treasury, shortfall);
  issue('treasuryAccount', state.treasury, state.centralBank, shortfall);
  return shortfall;
}
