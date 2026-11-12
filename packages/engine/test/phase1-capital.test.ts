/**
 * Paso 1a.5 de la Fase 1: capital, depreciación y sector de bienes de capital
 * (R11), con la valuación aprobada (costo histórico depreciado) y la venta
 * forzosa en la quiebra. Solo mecánica y contabilidad (ver docs/fase1-reglas.md).
 */

import { describe, expect, it } from 'vitest';
import {
  CAPITAL,
  PHASE0_CONFIG,
  PHASE1_STAGES,
  Rng,
  capacityOf,
  checkSfc,
  createWarmState,
  firmNetWorth,
  inventoryValue,
  lend,
  netFinancialWorth,
  payDeposits,
  step,
  unitCostFloor,
  type Knobs,
  type SimState,
  type Stage,
} from '../src/index';

const KNOBS: Knobs = { publicSpending: 5_000_000, structuralDeficitShare: 0 };
const MONTHS = 240;
/** Posiciones en PHASE1_STAGES (ver makePhase1Stages). */
const PLAN = 2;
const PRODUCTION = 4;
const CAPITAL_MARKET = 5;
const BANKRUPTCIES = 9;

function warm(seed: number): SimState {
  return createWarmState(seed, { ...PHASE0_CONFIG, knobs: KNOBS, burnInTicks: 0, capitalFirms: 5 }, PHASE1_STAGES);
}

/** Inserta una sonda antes y otra después de la etapa `at`. */
function around(at: number, pre: Stage, post: Stage): Stage[] {
  return [...PHASE1_STAGES.slice(0, at), pre, PHASE1_STAGES[at]!, post, ...PHASE1_STAGES.slice(at + 1)];
}

const consumption = (s: SimState) => s.firms.filter((f) => f.sector === 'consumption');

describe('R11: producción con capital', () => {
  it('las reglas de la Fase 1 piden empresas de capital', () => {
    const s = createWarmState(1, { ...PHASE0_CONFIG, knobs: KNOBS, burnInTicks: 0 }, PHASE1_STAGES);
    expect(() => step(s, KNOBS, { stages: PHASE1_STAGES })).toThrow(/capitalFirms/);
  });

  it('condiciones iniciales: 25 de consumo con capital a la utilización normal, 5 de capital sin capital', () => {
    const s = warm(1);
    expect(consumption(s)).toHaveLength(25);
    for (const f of s.firms) {
      if (f.sector === 'capital') {
        expect(f.capital).toBe(0);
        expect(f.capitalValue).toBe(0);
      } else {
        expect(f.lastOutput / (CAPITAL.capitalProductivity * f.capital)).toBeCloseTo(CAPITAL.normalUtilization, 9);
        expect(f.capitalValue).toBeGreaterThan(0);
      }
    }
  });

  it('la producción de bienes de consumo nunca supera κ·K', () => {
    let s = warm(2);
    let capitalBefore: number[] = [];
    let binding = 0;
    const pre: Stage = (st) => (capitalBefore = st.firms.map((f) => f.capital));
    const post: Stage = (st) => {
      st.firms.forEach((f, i) => {
        if (f.sector !== 'consumption') return;
        const cap = Math.floor(CAPITAL.capitalProductivity * capitalBefore[i]! + 1e-9);
        expect(f.stock).toBeLessThanOrEqual(cap);
        if (f.stock === cap && f.stock > 0) binding += 1;
      });
    };
    const stages = around(PRODUCTION, pre, post);
    for (let t = 0; t < MONTHS; t++) s = step(s, KNOBS, { stages });
    expect(binding).toBeGreaterThan(0); // la restricción se usa
  });

  it('depreciación según el uso: K y V bajan exactamente δ·ω', () => {
    let s = warm(3);
    let before: { k: number; v: number }[] = [];
    let checked = 0;
    const pre: Stage = (st) => (before = st.firms.map((f) => ({ k: f.capital, v: f.capitalValue })));
    const post: Stage = (st) => {
      st.firms.forEach((f, i) => {
        const { k, v } = before[i]!;
        if (f.sector !== 'consumption' || k <= 0) return;
        const used = (CAPITAL.depreciationRate * f.stock) / (CAPITAL.capitalProductivity * k);
        expect(f.capital).toBeCloseTo(k - k * used, 9);
        expect(f.capitalValue).toBe(v - Math.floor(v * used));
        expect(f.amortizationThisMonth).toBe(v - f.capitalValue);
        if (f.stock > 0) checked += 1;
      });
    };
    const stages = around(PRODUCTION, pre, post);
    for (let t = 0; t < 60; t++) s = step(s, KNOBS, { stages });
    expect(checked).toBeGreaterThan(0);
  });

  it('comprar capital es una transferencia de depósitos: el patrimonio del comprador no cambia y la producción del mes tampoco', () => {
    let s = warm(4);
    let before: { nw: number; stock: number; k: number }[] = [];
    let bought = 0;
    const pre: Stage = (st) => (before = st.firms.map((f) => ({ nw: firmNetWorth(f), stock: f.stock, k: f.capital })));
    const post: Stage = (st) => {
      expect(checkSfc(st)).toEqual([]);
      st.firms.forEach((f, i) => {
        if (f.sector !== 'consumption') return;
        expect(firmNetWorth(f)).toBe(before[i]!.nw);
        expect(f.stock).toBe(before[i]!.stock); // el capital nuevo se usa desde el mes siguiente
        if (f.capital > before[i]!.k) bought += 1;
      });
    };
    const stages = around(CAPITAL_MARKET, pre, post);
    for (let t = 0; t < 60; t++) s = step(s, KNOBS, { stages });
    expect(bought).toBeGreaterThan(0);
  });

  it('piso de precio de R1: el precio cubre el costo unitario con la amortización', () => {
    let s = warm(5);
    let checked = 0;
    const post: Stage = (st) => {
      for (const f of st.firms) {
        if (!f.active) continue;
        expect(f.price).toBeGreaterThanOrEqual(unitCostFloor(f) - 1e-9);
        if (f.sector === 'consumption' && f.capital > 0) {
          expect(unitCostFloor(f)).toBeGreaterThan(f.wage / 10); // incluye la amortización
          checked += 1;
        }
        if (f.sector === 'consumption') expect(f.plannedOutput).toBeLessThanOrEqual(capacityOf(f) + 1e-9);
      }
    };
    const stages = around(PLAN, () => {}, post);
    for (let t = 0; t < 60; t++) s = step(s, KNOBS, { stages });
    expect(checked).toBeGreaterThan(0);
  });

  it('empresas de capital: inventario final = inicial + producido − vendido', () => {
    let s = warm(6);
    let start: number[] = [];
    let sold = 0;
    const open: Stage = (st) => (start = st.firms.map((f) => f.inventory));
    const close: Stage = (st) => {
      st.firms.forEach((f, i) => {
        if (f.sector !== 'capital' || !f.active) return;
        expect(f.inventory).toBe(start[i]! + f.lastOutput - f.unitsSold);
        sold += f.unitsSold;
      });
    };
    // Sondas al principio del mes (después de abrir) y antes de la quiebra.
    const stages = [PHASE1_STAGES[0]!, open, ...PHASE1_STAGES.slice(1, BANKRUPTCIES), close, ...PHASE1_STAGES.slice(BANKRUPTCIES)];
    for (let t = 0; t < MONTHS; t++) s = step(s, KNOBS, { stages });
    expect(sold).toBeGreaterThan(0);
  });

  it('contabilidad: patrimonio neto − resultado acumulado es constante en la vida de cada empresa (la ganancia incluye amortización e inventario)', () => {
    let s = warm(7);
    let prev = s.firms.map((f) => firmNetWorth(f) - f.retainedEarnings);
    let checked = 0;
    for (let t = 0; t < MONTHS; t++) {
      s = step(s, KNOBS, { stages: PHASE1_STAGES });
      const now = s.firms.map((f) => firmNetWorth(f) - f.retainedEarnings);
      s.firms.forEach((f, i) => {
        // Solo las que estuvieron activas todo el mes (sin quiebra ni entrada).
        if (!f.active || s.credit.bankruptcies + s.credit.entries > 0) return;
        expect(now[i], `mes ${t}, empresa ${f.id}`).toBe(prev[i]);
        checked += 1;
      });
      prev = now;
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe('R12 con capital: venta forzosa de la planta', () => {
  function insolventConsumptionFirm(s: SimState) {
    const firm = s.firms.find((f) => f.sector === 'consumption' && f.active)!;
    // Deuda mayor que todo su patrimonio: presta y se lleva los depósitos.
    lend(s, firm, firm.capitalValue + 10_000_000);
    payDeposits(firm, s.households[0]!, firm.positions.deposits);
    expect(firmNetWorth(firm)).toBeLessThan(0);
    return firm;
  }

  function runBankruptcies(s: SimState): void {
    PHASE1_STAGES[BANKRUPTCIES]!(s, KNOBS, new Rng(s.rng));
  }

  it('con comprador: el banco cobra r_K·V, la planta queda con ese valor y el comprador es el dueño', () => {
    let s = warm(8);
    for (let t = 0; t < 3; t++) s = step(s, KNOBS, { stages: PHASE1_STAGES });
    const firm = insolventConsumptionFirm(s);
    const v = firm.capitalValue;
    const k = firm.capital;
    const debt = -firm.positions.loans;
    const bankWorth = netFinancialWorth(s.bank);
    runBankruptcies(s);
    const price = Math.floor(CAPITAL.fireSaleRecovery * v);
    expect(firm.active).toBe(false);
    expect(firm.capital).toBe(k);
    expect(firm.capitalValue).toBe(price);
    expect(s.credit.fireSales).toBe(1);
    expect(s.credit.writeOffs).toBe(debt - price);
    expect(netFinancialWorth(s.bank)).toBe(bankWorth - (debt - price));
    expect(firm.ownerId).toBe(firm.pendingOwnerId);
    expect(checkSfc(s)).toEqual([]);
  });

  it('sin comprador: la pagan todos los hogares en proporción a sus depósitos (Caiani et al., 2016)', () => {
    let s = warm(9);
    for (let t = 0; t < 3; t++) s = step(s, KNOBS, { stages: PHASE1_STAGES });
    const firm = insolventConsumptionFirm(s);
    // Una planta que ningún hogar puede pagar solo.
    const richest = Math.max(...s.households.map((hh) => hh.positions.deposits));
    firm.capitalValue = Math.ceil((2 * richest) / CAPITAL.fireSaleRecovery);
    // Que siga insolvente con la planta más cara: más deuda, sin depósitos.
    // (Los depósitos van a otra empresa: si fueran a un hogar, ese hogar podría comprarla.)
    lend(s, firm, firm.capitalValue);
    payDeposits(firm, s.firms.find((f) => f !== firm)!, firm.positions.deposits);
    expect(firmNetWorth(firm)).toBeLessThan(0);
    const deposits = s.households.map((hh) => hh.positions.deposits);
    const total = deposits.reduce((a, b) => a + b, 0);
    runBankruptcies(s);
    expect(s.credit.fireSalesPooled).toBe(1);
    expect(firm.pendingOwnerId).toBeNull();
    const price = Math.floor(CAPITAL.fireSaleRecovery * Math.ceil((2 * richest) / CAPITAL.fireSaleRecovery));
    expect(firm.capitalValue).toBeLessThanOrEqual(price);
    expect(firm.capitalValue).toBeGreaterThan(price - s.households.length);
    // Cada hogar pagó su parte (el hogar 0 además cobró los depósitos de la empresa antes).
    s.households.forEach((hh, i) => {
      if (i === 0) return;
      expect(deposits[i]! - hh.positions.deposits).toBe(Math.floor((deposits[i]! / total) * price));
    });
    expect(checkSfc(s)).toEqual([]);
  });

  it('empresa de capital: no hay garantía y el inventario se pierde', () => {
    let s = warm(10);
    for (let t = 0; t < 3; t++) s = step(s, KNOBS, { stages: PHASE1_STAGES });
    const firm = s.firms.find((f) => f.sector === 'capital' && f.active)!;
    firm.inventory = 50;
    lend(s, firm, 10_000_000 + inventoryValue(firm));
    payDeposits(firm, s.households[0]!, firm.positions.deposits);
    const debt = -firm.positions.loans;
    runBankruptcies(s);
    expect(firm.active).toBe(false);
    expect(firm.inventory).toBe(0);
    expect(s.credit.writeOffs).toBe(debt);
    expect(checkSfc(s)).toEqual([]);
  });

  it('la empresa que entra usa la planta y la capitaliza quien la compró (si puede)', () => {
    let s = warm(11);
    let seen = 0;
    let entered = 0;
    let pending: ({ owner: number | null; k: number } | null)[] = [];
    const pre: Stage = (st) => (pending = st.firms.map((f) => (f.active ? null : { owner: f.pendingOwnerId, k: f.capital })));
    const post: Stage = (st) => {
      st.firms.forEach((f, i) => {
        const p = pending[i];
        if (p === null || p === undefined || !f.active || f.sector !== 'consumption') return;
        entered += 1;
        expect(f.capital).toBe(p.k); // la planta no se depreció mientras estuvo cerrada
        if (p.owner !== null && f.ownerId === p.owner) seen += 1;
      });
    };
    const ENTRY = 1;
    const stages = around(ENTRY, pre, post);
    for (let t = 0; t < MONTHS; t++) s = step(s, KNOBS, { stages });
    expect(entered).toBeGreaterThan(0);
    expect(seen).toBeGreaterThan(0);
  });
});
