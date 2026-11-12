/**
 * Paso 1a.2 de la Fase 1: balance del banco y flujos del crédito.
 * Solo contabilidad: todavía ninguna regla de comportamiento presta.
 */

import { describe, expect, it } from 'vitest';
import {
  PHASE0_CONFIG,
  checkSfc,
  createInitialState,
  createWarmState,
  ensureBankReserves,
  lend,
  netFinancialWorth,
  payFromBank,
  payToBank,
  payToTreasury,
  repayCentralBankCredit,
  repayLoan,
  step,
  writeOffLoan,
  type SimState,
} from '../src/index';

function fresh(): SimState {
  return createInitialState(1, PHASE0_CONFIG);
}

describe('flujos del crédito', () => {
  it('prestar crea un préstamo y un depósito por el mismo monto; nadie cambia su patrimonio', () => {
    const s = fresh();
    const firm = s.firms[0]!;
    const bankWorth = netFinancialWorth(s.bank);
    const firmWorth = netFinancialWorth(firm);
    const deposits = firm.positions.deposits;
    lend(s, firm, 50_000);
    expect(firm.positions.loans).toBe(-50_000);
    expect(s.bank.positions.loans).toBe(50_000);
    expect(firm.positions.deposits).toBe(deposits + 50_000);
    expect(netFinancialWorth(s.bank)).toBe(bankWorth);
    expect(netFinancialWorth(firm)).toBe(firmWorth);
    expect(checkSfc(s)).toEqual([]);
  });

  it('prestar no necesita reservas antes (los préstamos crean depósitos)', () => {
    const s = fresh();
    const reserves = s.bank.positions.reserves;
    lend(s, s.firms[0]!, 10_000_000);
    expect(s.bank.positions.reserves).toBe(reserves);
    expect(checkSfc(s)).toEqual([]);
  });

  it('cancelar capital destruye el préstamo y el depósito', () => {
    const s = fresh();
    const firm = s.firms[0]!;
    const deposits = firm.positions.deposits;
    lend(s, firm, 50_000);
    repayLoan(s, firm, 20_000);
    expect(firm.positions.loans).toBe(-30_000);
    expect(firm.positions.deposits).toBe(deposits + 30_000);
    expect(checkSfc(s)).toEqual([]);
  });

  it('pagar intereses sube el patrimonio del banco y baja el del deudor en el mismo monto', () => {
    const s = fresh();
    const firm = s.firms[0]!;
    lend(s, firm, 50_000);
    const bankWorth = netFinancialWorth(s.bank);
    const firmWorth = netFinancialWorth(firm);
    payToBank(s, firm, 1_234);
    expect(netFinancialWorth(s.bank)).toBe(bankWorth + 1_234);
    expect(netFinancialWorth(firm)).toBe(firmWorth - 1_234);
    expect(checkSfc(s)).toEqual([]);
  });

  it('el banco paga (dividendos) creando depósitos: su patrimonio baja en ese monto', () => {
    const s = fresh();
    const owner = s.households[0]!;
    const bankWorth = netFinancialWorth(s.bank);
    payFromBank(s, owner, 777);
    expect(netFinancialWorth(s.bank)).toBe(bankWorth - 777);
    expect(owner.positions.deposits).toBe(s.households[1]!.positions.deposits + 777);
    expect(checkSfc(s)).toEqual([]);
  });

  it('castigar un préstamo baja el patrimonio del banco exactamente en el monto castigado', () => {
    const s = fresh();
    const firm = s.firms[0]!;
    lend(s, firm, 50_000);
    const bankWorth = netFinancialWorth(s.bank);
    const firmWorth = netFinancialWorth(firm);
    writeOffLoan(s, firm, 50_000);
    expect(netFinancialWorth(s.bank)).toBe(bankWorth - 50_000);
    expect(netFinancialWorth(firm)).toBe(firmWorth + 50_000);
    expect(firm.positions.loans).toBe(0);
    expect(checkSfc(s)).toEqual([]);
  });

  it('no se puede castigar más de lo que se debe', () => {
    const s = fresh();
    lend(s, s.firms[0]!, 1_000);
    expect(() => writeOffLoan(s, s.firms[0]!, 1_001)).toThrow();
  });
});

describe('reservas y financiamiento del BCRA al banco', () => {
  it('un pago al Tesoro funciona con un banco sin reservas: el BCRA le presta la diferencia', () => {
    const s = fresh();
    const firm = s.firms[0]!;
    // Un préstamo grande crea depósitos sin reservas detrás; después el deudor
    // le paga al Tesoro más que todas las reservas del banco.
    const reserves = s.bank.positions.reserves;
    lend(s, firm, reserves + 2_000_000);
    const amount = reserves + 1_000_000; // más que todas las reservas
    payToTreasury(s, firm, amount);
    expect(s.bank.positions.reserves).toBe(0);
    expect(s.bank.positions.centralBankCredit).toBe(-1_000_000);
    expect(s.centralBank.positions.centralBankCredit).toBe(1_000_000);
    expect(checkSfc(s)).toEqual([]);
  });

  it('si alcanzan las reservas, no hay financiamiento del BCRA', () => {
    const s = fresh();
    expect(ensureBankReserves(s, s.bank.positions.reserves)).toBe(0);
    expect(s.bank.positions.centralBankCredit).toBe(0);
  });

  it('el banco puede devolver el financiamiento con reservas, hasta lo que debe', () => {
    const s = fresh();
    ensureBankReserves(s, s.bank.positions.reserves + 5_000);
    expect(repayCentralBankCredit(s, 1_000_000)).toBe(5_000);
    expect(s.bank.positions.centralBankCredit).toBe(0);
    expect(checkSfc(s)).toEqual([]);
  });

  it('el patrimonio financiero neto de toda la economía sigue siendo cero', () => {
    const s = fresh();
    lend(s, s.firms[0]!, s.bank.positions.reserves + 1_000_000);
    payToTreasury(s, s.firms[0]!, s.bank.positions.reserves + 10);
    payToBank(s, s.firms[0]!, 500);
    writeOffLoan(s, s.firms[0]!, 1_000);
    const all = [...s.households, ...s.firms, s.bank, s.treasury, s.centralBank];
    expect(all.reduce((acc, a) => acc + netFinancialWorth(a), 0)).toBe(0);
  });
});

describe('las reglas de la Fase 0 no usan el crédito', () => {
  it('después de 240 meses no hay préstamos ni financiamiento del BCRA al banco', () => {
    let s = createWarmState(3, { ...PHASE0_CONFIG, burnInTicks: 0 });
    const initialEquity = netFinancialWorth(s.bank);
    expect(initialEquity).toBeGreaterThan(0); // patrimonio inicial del banco (R13)
    for (let t = 0; t < 240; t++) s = step(s, s.knobs);
    expect(s.bank.positions.loans).toBe(0);
    expect(s.bank.positions.centralBankCredit).toBe(0);
    // Sin crédito, el patrimonio del banco no se mueve.
    expect(netFinancialWorth(s.bank)).toBe(initialEquity);
  });
});
