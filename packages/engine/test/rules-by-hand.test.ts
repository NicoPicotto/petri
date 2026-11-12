/**
 * Un test por regla con un caso calculado a mano (pedido de Nico, 2026-11-11).
 * Cada test pone números concretos en la ecuación de la fuente y compara con lo
 * que hace el código. La comparación término por término está en
 * docs/fase1-reglas.md, "Revisión de las reglas contra sus fuentes".
 *
 * El azar se reemplaza por un generador fijo: uniform(h) = 0,5·h, shuffle no
 * mezcla y pick recorre la lista en orden.
 */

import { describe, expect, it } from 'vitest';
import {
  CAPITAL,
  CREDIT,
  PARAMS,
  PHASE1_STAGES,
  Rng,
  allocateCredit,
  createInitialState,
  createRngState,
  desiredCapacityGrowth,
  firmNetWorth,
  firmsPlan,
  goodsMarket,
  laborMarket,
  lend,
  lossGivenDefaultOf,
  makePhase1Stages,
  netFinancialWorth,
  payDeposits,
  riskAdjustedRate,
  structuralTaxRate,
  switchProbability,
  logistic,
  unitCostFloor,
  type Firm,
  type SimState,
} from '../src/index';

/** Generador fijo: uniform(h) = f·h; shuffle no mezcla; pick recorre en orden; nextInt da 0. */
class FixedRng extends Rng {
  private k = 0;
  constructor(private readonly f: number) {
    super(createRngState(1));
  }
  override nextFloat(): number {
    return this.f;
  }
  override nextInt(): number {
    return 0;
  }
  override shuffle<T>(items: T[]): T[] {
    return items;
  }
  override pick<T>(items: readonly T[]): T {
    return items[this.k++ % items.length]!;
  }
}

const KNOBS = { publicSpending: 0, structuralDeficitShare: 0 };

/** Estado chico: 10 hogares, 3 empresas (2 de consumo y 1 de capital si `capital`). */
function small(capital = false): SimState {
  const s = createInitialState(1, { households: 10, firms: 3, knobs: KNOBS, capitalFirms: capital ? 1 : 0 });
  s.elapsedTicks = 5; // no es el primer mes
  for (const hh of s.households) hh.employerId = null;
  return s;
}

function resetFirm(f: Firm, over: Partial<Firm>): void {
  Object.assign(f, { price: 12_000, wage: 100_000, lastOutput: 100, plannedOutput: 100, soldOut: false, unfilledVacancies: false, inventory: 0 }, over);
}

describe('R1 (Fase 0): tabla de cuatro casos de CATS, u = 0,5·h = 0,025', () => {
  // Fuente (Gaffeo et al., 2008; Dawid et al., 2024, ec. 14): sube el precio si
  // vendió todo y P < P̄; sube la cantidad Y* = (1+u)·Y_{t−1} si vendió todo y P ≥ P̄;
  // baja el precio si le sobró y P ≥ P̄; baja la cantidad si le sobró y P < P̄.
  function run(over: Partial<Firm>): Firm {
    const s = small();
    s.stats.priceIndex = 12_000;
    const f = s.firms[0]!;
    resetFirm(f, over);
    f.positions.deposits = 10_000_000; // sin restricción de liquidez
    firmsPlan(s, KNOBS, new FixedRng(0.5));
    return s.firms[0]!;
  }
  it('vendió todo y P < P̄: P = round(11.000·1,025) = 11.275; cantidad = Y_{t−1} = 100', () => {
    const f = run({ price: 11_000, soldOut: true });
    expect(f.price).toBe(11_275);
    expect(f.plannedOutput).toBe(100);
  });
  it('vendió todo y P ≥ P̄: cantidad = 100·1,025 = 102,5; precio igual', () => {
    const f = run({ price: 13_000, soldOut: true });
    expect(f.plannedOutput).toBeCloseTo(102.5, 12);
    expect(f.price).toBe(13_000);
  });
  it('le sobró y P ≥ P̄: P = 13.000·0,975 = 12.675', () => {
    expect(run({ price: 13_000 }).price).toBe(12_675);
  });
  it('le sobró y P < P̄: cantidad = 100·0,975 = 97,5', () => {
    expect(run({ price: 11_000 }).plannedOutput).toBeCloseTo(97.5, 12);
  });
  it('piso: el precio no baja del costo unitario w/α = 100.000/10 = 10.000', () => {
    expect(run({ price: 9_000, soldOut: true }).price).toBe(Math.max(Math.round(9_000 * 1.025), 10_000));
  });
});

describe('R2: salario sube u si quedaron vacantes, nunca baja', () => {
  it('w = 100.000·1,025 = 102.500 con vacantes; 100.000 sin', () => {
    const s = small();
    s.stats.priceIndex = 12_000;
    resetFirm(s.firms[0]!, { unfilledVacancies: true });
    resetFirm(s.firms[1]!, { unfilledVacancies: false });
    for (const f of s.firms) f.positions.deposits = 10_000_000;
    firmsPlan(s, KNOBS, new FixedRng(0.5));
    expect(s.firms[0]!.wage).toBe(102_500);
    expect(s.firms[1]!.wage).toBe(100_000);
  });
});

describe('R3: trabajadores deseados = ⌈Y*/α⌉, acotados por los depósitos', () => {
  it('Y* = 102,5 ⇒ 11 deseados; con depósitos para 7 salarios, 7 vacantes', () => {
    const s = small();
    s.stats.priceIndex = 12_000;
    const f = s.firms[0]!;
    resetFirm(f, { price: 13_000, soldOut: true });
    f.positions.deposits = 7 * 100_000 + 50_000;
    firmsPlan(s, KNOBS, new FixedRng(0.5));
    expect(Math.ceil(102.5 / 10)).toBe(11);
    expect(s.firms[0]!.vacancies).toBe(7);
  });
});

describe('R4: cada desocupado mira M = 4 empresas con vacantes y va a la de mayor salario', () => {
  it('A paga 100, B paga 120, una vacante cada una, 3 desocupados: B, A y uno queda desocupado', () => {
    const s = small();
    const [a, b] = s.firms;
    a!.vacancies = 1;
    a!.wage = 100;
    b!.vacancies = 1;
    b!.wage = 120;
    s.firms[2]!.vacancies = 0;
    for (const hh of s.households.slice(3)) hh.employerId = s.firms[2]!.id; // empleados
    laborMarket(s, KNOBS, new FixedRng(0.5));
    const [h0, h1, h2] = s.households;
    expect(h0!.employerId).toBe(b!.id);
    expect(h1!.employerId).toBe(a!.id);
    expect(h2!.employerId).toBeNull();
  });
});

describe('R5 y R6 (Fase 0): gasto = ⌊α1·YD_{t−1} + α2·W⌋; compra primero en la más barata', () => {
  it('YD = 1.000, W = 2.000 ⇒ gasto 1.000; precios 7 y 5: compra 100 a 5 (todo el stock) y 71 a 7', () => {
    const s = small();
    const hh = s.households[0]!;
    for (const other of s.households.slice(1)) {
      other.incomeLastMonth = 0;
      other.depositsAtMonthStart = 0;
    }
    hh.incomeLastMonth = 1_000;
    hh.depositsAtMonthStart = 2_000;
    hh.positions.deposits = 10_000;
    expect(Math.floor(PARAMS.consumeOutOfIncome * 1_000 + PARAMS.consumeOutOfWealth * 2_000)).toBe(1_000);
    const [f7, f5, f9] = s.firms;
    Object.assign(f7!, { price: 7, stock: 1_000 });
    Object.assign(f5!, { price: 5, stock: 100 });
    Object.assign(f9!, { price: 9, stock: 1_000 });
    goodsMarket(s, KNOBS, new FixedRng(0.5));
    expect(f5!.unitsSold).toBe(100); // 500 pesos
    expect(f7!.unitsSold).toBe(71); // ⌊500/7⌋ = 71, 497 pesos
    expect(f9!.unitsSold).toBe(0);
    expect(hh.positions.deposits).toBe(10_000 - 500 - 497);
  });
});

describe('R6 (Fase 1): probabilidad de cambio 1 − e^(−β·(P_ant − P_nuevo)/P_nuevo)', () => {
  it('β = 1, 110 → 100: 1 − e^(−0,1) = 0,0951626', () => {
    expect(switchProbability(1, 110, 100)).toBeCloseTo(0.09516258, 7);
    expect(switchProbability(1, 100, 110)).toBe(0);
  });
});

describe('R7 (Fase 1): dividendo = ρ·(1 − ℓ)·resultado acumulado, en el mes de cierre', () => {
  it('ganancia 50.000 − 30.000 − 1.000 − 2.000 = 17.000; acumulado 3.000 + 17.000 = 20.000; ℓ = 30.000/(3·20.000) = 0,5 ⇒ dividendo ⌊0,9·0,5·20.000⌋ = 9.000', () => {
    const s = small(true);
    const index = 0;
    const f = s.firms[index]!;
    s.elapsedTicks = 12 + index; // mes de cierre de la empresa 0 (index % 12)
    lend(s, f, 30_000);
    Object.assign(f, { revenue: 50_000, wageBill: 30_000, interestThisMonth: 1_000, amortizationThisMonth: 2_000, retainedEarnings: 3_000, expectedSales: 20_000, inventory: 0, inventoryValueAtOpen: 0 });
    s.fiscal.taxRate = 0.1;
    const owner = s.households[f.ownerId]!;
    const before = owner.positions.deposits;
    const R7 = 10;
    PHASE1_STAGES[R7]!(s, KNOBS, new FixedRng(0.5));
    expect(f.profitThisMonth).toBe(17_000);
    expect(owner.positions.deposits - before).toBe(9_000 - 900);
    expect(f.retainedEarnings).toBe(11_000);
  });
});

describe('R8: τ = (1 − s)·G / (w̄·H + dividendos del mes anterior)', () => {
  it('G = 200.000, s = 0,5, H = 10, w̄ = 100.000 ⇒ τ = 100.000 / 1.000.000 = 0,1', () => {
    const s = small();
    for (const f of s.firms) f.wage = 100_000;
    s.fiscal.lastDividends = 0;
    expect(structuralTaxRate(s, { publicSpending: 200_000, structuralDeficitShare: 0.5 })).toBeCloseTo(0.1, 12);
  });
});

describe('R9: límite de deuda = ⌊λ·Sᵉ⌋ − deuda; préstamo de inversión a 60 meses, el resto a 12', () => {
  it('Sᵉ = 20.000, deuda 10.000 ⇒ margen 50.000; pide 70.000 ⇒ 50.000 = 10.000 (inversión, 60 m) + 40.000 (12 m)', () => {
    const s = small(true);
    const f = s.firms[0]!;
    for (const other of s.firms) if (other !== f) other.active = false;
    lend(s, f, 10_000);
    f.loanBook = [{ remaining: 10_000, installment: 1_000, rate: 0 }];
    payDeposits(f, s.households[0]!, f.positions.deposits); // sin depósitos
    Object.assign(f, { expectedSales: 20_000, wage: 30_000, plannedOutput: 20, capitalOrder: 2, capital: 1_000_000, capitalValue: 1_000_000_000 });
    s.stats.capitalPriceIndex = 5_000;
    // Necesita 2 trabajadores · 30.000 + 2 · 5.000 de capital = 70.000.
    const r0 = ((1 + CREDIT.loanMarkup) * CREDIT.baseRateAnnual) / 12;
    allocateCredit(s, CREDIT, r0, CAPITAL.fireSaleRecovery);
    expect(s.credit.newLoans).toBe(50_000);
    expect(s.credit.cappedByDebtLimit).toBe(20_000);
    const fresh = f.loanBook.slice(1);
    expect(fresh).toEqual([
      { remaining: 10_000, installment: Math.ceil(10_000 / 60), rate: r0 },
      { remaining: 40_000, installment: Math.ceil(40_000 / 12), rate: r0 },
    ]);
  });
  it('Sᵉ ← Sᵉ + λ_e·(S − Sᵉ): 20.000 + 0,0914·(30.000 − 20.000) = 20.914', () => {
    const s = small(true);
    const f = s.firms[0]!;
    Object.assign(f, { expectedSales: 20_000, revenue: 30_000 });
    const CLOSE = 12;
    PHASE1_STAGES[CLOSE]!(s, KNOBS, new FixedRng(0.5));
    expect(f.expectedSales).toBeCloseTo(20_914, 9);
  });
});

describe('R10: g = γ1·(r − r̄)/r̄ + γ2·(u − ū)/ū', () => {
  it('r = 2r̄, u = 1 ⇒ g = 0,01/3 + (0,02/3)·(0,15/0,85) = 0,0045098', () => {
    const s = small(true);
    const f = s.firms[0]!;
    f.capital = 1_000;
    f.cashFlowRate = 2 * CAPITAL.targetCashFlowRate;
    f.desiredOutput = CAPITAL.capitalProductivity * 1_000;
    expect(desiredCapacityGrowth(f)).toBeCloseTo(0.00450980392, 10);
  });
});

describe('R11: Leontief, depreciación según el uso, piso con amortización, regla de cantidad del sector de capital', () => {
  it('K = 1.000, N = 10: capacidad ⌊65,36⌋ = 65 < α·N = 100 ⇒ y = 65; δ·ω = 0,00585; V: 1.000.000 → 994.151; K → 994,15', () => {
    const s = small(true);
    const f = s.firms[0]!;
    Object.assign(f, { capital: 1_000, capitalValue: 1_000_000, wage: 100 });
    f.positions.deposits = 10_000;
    for (const hh of s.households) hh.employerId = f.id;
    const PRODUCTION = 4;
    PHASE1_STAGES[PRODUCTION]!(s, KNOBS, new FixedRng(0.5));
    expect(f.stock).toBe(65);
    expect(f.amortizationThisMonth).toBe(5_849);
    expect(f.capitalValue).toBe(1_000_000 - 5_849);
    expect(f.capital).toBeCloseTo(994.15, 9);
  });
  it('piso = w/α + δ·(V/K)/κ = 10.000 + 0,09·1.000 = 10.090', () => {
    const s = small(true);
    const f = s.firms[0]!;
    Object.assign(f, { wage: 100_000, capital: 1_000, capitalValue: 1_000_000 });
    expect(unitCostFloor(f)).toBeCloseTo(10_090, 9);
  });
  it('regla de Assenza (ec. 6.2, interruptor = 1): Y = 100, demanda 150, inventario 20, P ≥ P̄ ⇒ Y* = 100 + 0,9·50 − 20 = 125', () => {
    const stages = makePhase1Stages(CREDIT, {}, undefined, undefined, { ...CAPITAL, capitalQuantityRule: 1 });
    const s = small(true);
    const k = s.firms[2]!;
    expect(k.sector).toBe('capital');
    s.stats.capitalPriceIndex = 10_000;
    Object.assign(k, { price: 11_000, wage: 1, lastOutput: 100, lastDemand: 150, inventory: 20 });
    k.positions.deposits = 1e9;
    const PLAN = 2;
    stages[PLAN]!(s, KNOBS, new FixedRng(0.5));
    expect(k.plannedOutput).toBeCloseTo(125, 12);
    expect(k.price).toBe(11_000);
  });
  it('regla de Assenza, P < P̄: sube el precio 2,5% y Y* = Y − inventario = 80', () => {
    const stages = makePhase1Stages(CREDIT, {}, undefined, undefined, { ...CAPITAL, capitalQuantityRule: 1 });
    const s = small(true);
    const k = s.firms[2]!;
    s.stats.capitalPriceIndex = 10_000;
    Object.assign(k, { price: 9_000, wage: 1, lastOutput: 100, lastDemand: 150, inventory: 20 });
    k.positions.deposits = 1e9;
    stages[2]!(s, KNOBS, new FixedRng(0.5));
    expect(k.price).toBe(9_225);
    expect(k.plannedOutput).toBe(80);
  });
});

describe('R12: quiebra con venta forzosa a r_K·V', () => {
  it('V = 1.000.000, deuda 1.200.000, sin depósitos ⇒ el banco cobra 300.000 y castiga 900.000', () => {
    const s = small(true);
    s.bank.riskWindow.push({ borrowers: new Array(20).fill(0), defaults: new Array(20).fill(0), defaultedDebt: 0, writtenOff: 0 });
    const f = s.firms[0]!;
    Object.assign(f, { capital: 1_000, capitalValue: 1_000_000, monthLeverage: -1 });
    lend(s, f, 1_200_000);
    payDeposits(f, s.firms[1]!, f.positions.deposits);
    s.households[3]!.positions.deposits = 1_000_000; // un comprador posible
    expect(firmNetWorth(f)).toBeLessThan(0);
    const bank0 = netFinancialWorth(s.bank);
    const BANKRUPTCIES = 9;
    PHASE1_STAGES[BANKRUPTCIES]!(s, KNOBS, new FixedRng(0.5));
    expect(f.active).toBe(false);
    expect(f.capitalValue).toBe(300_000);
    expect(s.credit.writeOffs).toBe(900_000);
    expect(netFinancialWorth(s.bank)).toBe(bank0 - 900_000);
  });
});

describe('R13: tasa de no arbitraje, LGD por empresa y logística', () => {
  it('r = (r0 + φ·LGD)/(1 − φ): (0,00375 + 0,02·0,5)/0,98 = 0,0140306', () => {
    expect(riskAdjustedRate(0.00375, 0.02, 0.5)).toBeCloseTo(0.01403061, 8);
  });
  it('LGD = 1 − r_K·V/exposición: 1 − 0,3·100.000/60.000 = 0,5; capital: 1', () => {
    const s = small(true);
    const c = s.firms[0]!;
    c.capitalValue = 100_000;
    expect(lossGivenDefaultOf(c, 60_000, 0.3)).toBeCloseTo(0.5, 12);
    expect(lossGivenDefaultOf(s.firms[2]!, 60_000, 0.3)).toBe(1);
  });
  it('σ(0) = 0,5; σ(ln 3) = 0,75', () => {
    expect(logistic(0)).toBe(0.5);
    expect(logistic(Math.log(3))).toBeCloseTo(0.75, 12);
  });
});
