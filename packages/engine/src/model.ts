/**
 * Reglas de comportamiento de la Fase 0, como etapas de un tick (1 tick = 1 mes).
 *
 * Cada etapa cita su regla en docs/fase0-reglas.md. Ninguna etapa usa la
 * emisión para decidir precios o salarios: la inflación, si aparece, emerge.
 */

import { coverWithAdvances, payDeposits, payFromTreasury, payToTreasury } from './flows';
import type { Knobs } from './knobs';
import type { Cents } from './money';
import { PARAMS } from './params';
import type { Rng } from './rng';
import { clamp01, firmIndex, type Firm, type Household, type SimState } from './state';

/** Una etapa muta la copia del estado que recibe. Solo puede usar `rng` como fuente de azar. */
export type Stage = (state: SimState, knobs: Readonly<Knobs>, rng: Rng) => void;

/** Retención proporcional del impuesto sobre un ingreso bruto (R8). Nunca supera el bruto. */
function withholding(gross: Cents, taxRate: number): Cents {
  return Math.floor(gross * taxRate);
}

function workersByFirm(state: SimState): Household[][] {
  const lists: Household[][] = state.firms.map(() => []);
  for (const hh of state.households) {
    if (hh.employerId !== null) lists[firmIndex(state, hh.employerId)]!.push(hh);
  }
  return lists;
}

/**
 * Base imponible de pleno empleo (R8): todos los hogares cobrando el salario
 * promedio de las empresas, más los dividendos del mes anterior.
 */
export function fullEmploymentTaxBase(state: SimState): Cents {
  const avgWage = state.firms.reduce((acc, firm) => acc + firm.wage, 0) / state.firms.length;
  return avgWage * state.households.length + state.fiscal.lastDividends;
}

/**
 * R8: alícuota tal que, a pleno empleo, los impuestos cubran (1 − s) del gasto.
 * s = déficit estructural financiado con emisión.
 */
export function structuralTaxRate(state: SimState, knobs: Readonly<Knobs>): number {
  const base = fullEmploymentTaxBase(state);
  return base > 0 ? clamp01(((1 - knobs.structuralDeficitShare) * knobs.publicSpending) / base) : 0;
}

/** Apertura del mes: R8 (alícuota) y reinicio de acumuladores. */
export const openMonth: Stage = (state, knobs) => {
  const f = state.fiscal;
  f.taxRate = structuralTaxRate(state, knobs);
  f.dividendsThisMonth = 0;
  f.taxBaseThisMonth = 0;
  f.taxesThisMonth = 0;
  f.spendingThisMonth = 0;
  f.advancesThisMonth = 0;
  for (const hh of state.households) {
    hh.incomeThisMonth = 0;
    hh.depositsAtMonthStart = hh.positions.deposits;
  }
  for (const firm of state.firms) {
    firm.stock = 0;
    firm.unitsSold = 0;
    firm.revenue = 0;
    firm.wageBill = 0;
    firm.vacancies = 0;
  }
};

/** R2 (salario), R1 (precio y cantidad) y R3 (demanda de trabajo y despidos). */
export const firmsPlan: Stage = (state, _knobs, rng) => {
  const alpha = PARAMS.laborProductivity;
  const avgPrice = state.stats.priceIndex;
  const workers = workersByFirm(state);
  // Primer mes de vida de la cápsula: todavía no hay señales del mes anterior.
  const firstMonth = state.elapsedTicks === 0;

  state.firms.forEach((firm, i) => {
    // Un sorteo por cosa ajustable, siempre en el mismo orden (determinismo).
    const uWage = rng.uniform(PARAMS.wageStepMax);
    const uPrice = rng.uniform(PARAMS.priceStepMax);
    const uQty = rng.uniform(PARAMS.quantityStepMax);

    if (!firstMonth) {
      // R2: suba si quedaron vacantes sin cubrir; nunca baja.
      if (firm.unfilledVacancies) firm.wage = Math.round(firm.wage * (1 + uWage));

      // R1: tabla de cuatro casos (Gaffeo et al., 2008). La cantidad se ajusta
      // sobre la producción EFECTIVA del mes anterior, no sobre la deseada: si
      // la empresa no pudo producir lo que quería (por liquidez o por vacantes
      // sin cubrir), la meta no se despega de lo que realmente hace. Fuente:
      // Dawid, Delli Gatti, Fierro & Poledna (2024), CESifo WP 11411, ec. 14 y
      // cuadro 1 (CATS: Y*_t = (1 + γ)·Y_{t−1}, y Y*_t = Y_{t−1} si ajusta precio).
      firm.plannedOutput = firm.lastOutput;
      if (firm.soldOut) {
        if (firm.price < avgPrice) firm.price = Math.round(firm.price * (1 + uPrice));
        else firm.plannedOutput = firm.lastOutput * (1 + uQty);
      } else {
        if (firm.price >= avgPrice) firm.price = Math.round(firm.price * (1 - uPrice));
        else firm.plannedOutput = firm.lastOutput * (1 - uQty);
      }
    }
    // Piso de precio: costo unitario.
    firm.price = Math.max(firm.price, Math.ceil(firm.wage / alpha), 1);
    // Supuesto: nunca desea menos de un trabajador, para poder volver a crecer.
    firm.plannedOutput = Math.max(firm.plannedOutput, alpha);

    // R3: trabajadores deseados, limitados por lo que puede pagar.
    const desired = Math.ceil(firm.plannedOutput / alpha - 1e-9);
    const affordable = Math.floor(firm.positions.deposits / firm.wage);
    const target = Math.min(desired, affordable);
    const current = workers[i]!;
    if (current.length > target) {
      for (const hh of rng.shuffle([...current]).slice(0, current.length - target)) hh.employerId = null;
    }
    firm.vacancies = Math.max(0, target - current.length);
  });
};

/** R4: los desocupados buscan entre empresas con vacantes y eligen el mejor salario. */
export const laborMarket: Stage = (state, _knobs, rng) => {
  const open = state.firms.filter((firm) => firm.vacancies > 0);
  const unemployed = rng.shuffle(state.households.filter((hh) => hh.employerId === null));
  for (const hh of unemployed) {
    if (open.length === 0) break;
    let best: Firm | null = null;
    for (let k = 0; k < PARAMS.laborSearchSize; k++) {
      const candidate = rng.pick(open);
      if (best === null || candidate.wage > best.wage || (candidate.wage === best.wage && candidate.id < best.id)) {
        best = candidate;
      }
    }
    if (best === null) break;
    hh.employerId = best.id;
    best.vacancies -= 1;
    if (best.vacancies === 0) open.splice(open.indexOf(best), 1);
  }
  for (const firm of state.firms) firm.unfilledVacancies = firm.vacancies > 0;
};

/** Producción (y = α·N) y pago de salarios con retención en la fuente (R8). */
export const production: Stage = (state) => {
  const f = state.fiscal;
  const workers = workersByFirm(state);
  state.firms.forEach((firm, i) => {
    const list = workers[i]!;
    firm.stock = PARAMS.laborProductivity * list.length;
    firm.lastOutput = firm.stock;
    let taxes = 0;
    for (const hh of list) {
      const tax = withholding(firm.wage, f.taxRate);
      payDeposits(firm, hh, firm.wage - tax);
      hh.incomeThisMonth += firm.wage - tax;
      taxes += tax;
    }
    payToTreasury(state, firm, taxes);
    firm.wageBill = firm.wage * list.length;
    f.taxBaseThisMonth += firm.wageBill;
    f.taxesThisMonth += taxes;
  });
};

/** R8: transferencias universales; lo que no cubre la recaudación, con adelantos del BCRA. */
export const government: Stage = (state, knobs) => {
  const f = state.fiscal;
  const each = Math.floor(knobs.publicSpending / state.households.length);
  if (each <= 0) return;
  const total = each * state.households.length;
  f.advancesThisMonth += coverWithAdvances(state, total);
  for (const hh of state.households) {
    payFromTreasury(state, hh, each);
    hh.incomeThisMonth += each;
  }
  f.spendingThisMonth += total;
};

/** R5 (consumo) y R6 (búsqueda en el mercado de bienes). */
export const goodsMarket: Stage = (state, _knobs, rng) => {
  const buyers = rng.shuffle([...state.households]);
  for (const hh of buyers) {
    const desired = Math.floor(
      PARAMS.consumeOutOfIncome * hh.incomeLastMonth + PARAMS.consumeOutOfWealth * hh.depositsAtMonthStart,
    );
    let budget = Math.min(desired, hh.positions.deposits);
    if (budget <= 0) continue;

    const visited: Firm[] = [];
    for (let k = 0; k < PARAMS.goodsSearchSize; k++) visited.push(rng.pick(state.firms));
    visited.sort((a, b) => a.price - b.price || a.id - b.id);

    for (const firm of visited) {
      if (firm.stock <= 0) continue;
      const units = Math.min(firm.stock, Math.floor(budget / firm.price));
      if (units <= 0) break; // ni la más barata con stock le alcanza
      const cost = units * firm.price;
      payDeposits(hh, firm, cost);
      firm.stock -= units;
      firm.unitsSold += units;
      firm.revenue += cost;
      budget -= cost;
    }
  }
  for (const firm of state.firms) firm.soldOut = firm.stock === 0;
};

/**
 * R7: dividendos al dueño, con retención (R8): ρ · ganancia, acotado por los
 * depósitos de la empresa. El colchón de liquidez provisorio se eliminó el
 * 2026-11-11: existía por el defecto de R1 (ver docs/fase0-reglas.md, R7).
 */
export const profits: Stage = (state) => {
  const f = state.fiscal;
  for (const firm of state.firms) {
    const profit = firm.revenue - firm.wageBill;
    if (profit <= 0) continue;
    const dividend = Math.min(Math.floor(PARAMS.dividendPayout * profit), firm.positions.deposits);
    if (dividend <= 0) continue;
    const owner = state.households[firm.ownerId]!;
    const tax = withholding(dividend, f.taxRate);
    payDeposits(firm, owner, dividend - tax);
    payToTreasury(state, firm, tax);
    owner.incomeThisMonth += dividend - tax;
    f.taxBaseThisMonth += dividend;
    f.dividendsThisMonth += dividend;
    f.taxesThisMonth += tax;
  }
};

/** Indicadores del mes y cierre (el ingreso del mes pasa a ser el "del mes anterior"). */
export const closeMonth: Stage = (state) => {
  const s = state.stats;
  const f = state.fiscal;
  let revenue = 0;
  let units = 0;
  for (const firm of state.firms) {
    revenue += firm.revenue;
    units += firm.unitsSold;
  }
  const prevIndex = s.priceIndex;
  const priceIndex = units > 0 ? revenue / units : prevIndex;

  let employed = 0;
  let wageSum = 0;
  let poor = 0;
  const basketCost = PARAMS.basketUnits * priceIndex;
  for (const hh of state.households) {
    if (hh.employerId !== null) {
      employed += 1;
      wageSum += state.firms[firmIndex(state, hh.employerId)]!.wage;
    }
    if (hh.incomeThisMonth < basketCost) poor += 1;
    hh.incomeLastMonth = hh.incomeThisMonth;
  }
  const n = state.households.length;

  s.priceIndex = priceIndex;
  s.inflation = prevIndex > 0 ? priceIndex / prevIndex - 1 : 0;
  s.unemployment = 1 - employed / n;
  s.realWage = employed > 0 ? wageSum / employed / priceIndex : 0;
  s.poverty = poor / n;
  s.output = state.firms.reduce((acc, firm) => acc + PARAMS.laborProductivity * (firm.wageBill / firm.wage), 0);
  s.emission = f.advancesThisMonth;
  s.effectiveEmissionShare = f.spendingThisMonth > 0 ? f.advancesThisMonth / f.spendingThisMonth : 0;
  f.lastTaxBase = f.taxBaseThisMonth;
  f.lastDividends = f.dividendsThisMonth;
};

/** Orden de las etapas en cada tick (docs/fase0-reglas.md, "Orden de cada tick"). */
export const PHASE0_STAGES: readonly Stage[] = [
  openMonth,
  firmsPlan,
  laborMarket,
  production,
  government,
  goodsMarket,
  profits,
  closeMonth,
];
