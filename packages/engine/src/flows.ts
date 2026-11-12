/**
 * Flujos contables compuestos, armados solo con las primitivas del ledger.
 *
 * Cuando la plata entra o sale del sector privado (pagos del Tesoro,
 * impuestos) se mueven a la vez depósitos, reservas y la cuenta del Tesoro en
 * el BCRA.
 *
 * Crédito (paso 1a.2 de la Fase 1): el banco presta creando depósitos, sin
 * necesitar reservas antes (McLeay, Radia & Thomas, 2014, "Money creation in
 * the modern economy", BoE Quarterly Bulletin). Si después le faltan reservas
 * para un pago al Tesoro, el BCRA se las presta (`centralBankCredit`).
 */

import { issue, redeem, transfer, type Agent } from './ledger';
import type { Cents } from './money';
import type { SimState } from './state';

/** Pago entre privados con depósitos. Falla si el pagador no tiene saldo. */
export function payDeposits(from: Agent, to: Agent, amount: Cents): void {
  if (amount > 0) transfer('deposits', from, to, amount);
}

/**
 * Si al banco no le alcanzan las reservas para `amount`, el BCRA le presta la
 * diferencia (pases o redescuentos). Devuelve el monto prestado.
 */
export function ensureBankReserves(state: SimState, amount: Cents): Cents {
  const shortfall = amount - state.bank.positions.reserves;
  if (shortfall <= 0) return 0;
  issue('centralBankCredit', state.centralBank, state.bank, shortfall);
  issue('reserves', state.bank, state.centralBank, shortfall);
  return shortfall;
}

/** El banco le devuelve al BCRA hasta `amount` del financiamiento, con reservas. Devuelve lo devuelto. */
export function repayCentralBankCredit(state: SimState, amount: Cents): Cents {
  const owed = -state.bank.positions.centralBankCredit;
  const paid = Math.min(amount, owed, state.bank.positions.reserves);
  if (paid <= 0) return 0;
  redeem('reserves', state.bank, state.centralBank, paid);
  redeem('centralBankCredit', state.centralBank, state.bank, paid);
  return paid;
}

/** Un privado le paga al Tesoro (ej.: una retención de impuestos). */
export function payToTreasury(state: SimState, payer: Agent, amount: Cents): void {
  if (amount <= 0) return;
  ensureBankReserves(state, amount);
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

/** El banco le presta a un privado: nacen juntos el préstamo y el depósito. */
export function lend(state: SimState, borrower: Agent, amount: Cents): void {
  if (amount <= 0) return;
  issue('loans', state.bank, borrower, amount);
  issue('deposits', borrower, state.bank, amount);
}

/** El deudor cancela capital con sus depósitos: se destruyen el préstamo y el depósito. */
export function repayLoan(state: SimState, borrower: Agent, amount: Cents): void {
  if (amount <= 0) return;
  redeem('deposits', borrower, state.bank, amount);
  redeem('loans', state.bank, borrower, amount);
}

/**
 * Un privado le paga al banco (ej.: intereses). El depósito se destruye y el
 * patrimonio del banco sube en el mismo monto.
 */
export function payToBank(state: SimState, payer: Agent, amount: Cents): void {
  if (amount <= 0) return;
  redeem('deposits', payer, state.bank, amount);
}

/**
 * El banco le paga a un privado (ej.: dividendos o intereses de depósitos):
 * crea el depósito y su patrimonio baja en el mismo monto.
 */
export function payFromBank(state: SimState, payee: Agent, amount: Cents): void {
  if (amount <= 0) return;
  issue('deposits', payee, state.bank, amount);
}

/**
 * El banco da por perdido un préstamo: se cancela sin pago. El patrimonio del
 * banco baja y el del deudor sube, los dos en `amount`.
 */
export function writeOffLoan(state: SimState, borrower: Agent, amount: Cents): void {
  if (amount <= 0) return;
  redeem('loans', state.bank, borrower, amount);
}

/**
 * El Tesoro le transfiere reservas al banco sin depósito del otro lado: el
 * patrimonio del banco sube en `amount`. Se usa solo para el patrimonio
 * inicial del banco (R13).
 */
export function payTreasuryToBank(state: SimState, amount: Cents): void {
  if (amount <= 0) return;
  redeem('treasuryAccount', state.treasury, state.centralBank, amount);
  issue('reserves', state.bank, state.centralBank, amount);
}

/**
 * El banco le paga al BCRA con reservas (ej.: intereses del financiamiento) y
 * el BCRA le transfiere esa ganancia al Tesoro en el acto. Si al banco no le
 * alcanzan las reservas, se las presta el BCRA.
 */
export function payBankToCentralBank(state: SimState, amount: Cents): void {
  if (amount <= 0) return;
  ensureBankReserves(state, amount);
  redeem('reserves', state.bank, state.centralBank, amount);
  issue('treasuryAccount', state.treasury, state.centralBank, amount);
}

/** El banco le paga al Tesoro (ej.: la retención sobre sus dividendos), con reservas. */
export function payBankToTreasury(state: SimState, amount: Cents): void {
  payBankToCentralBank(state, amount);
}
