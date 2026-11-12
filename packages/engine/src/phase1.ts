/**
 * Reglas de la Fase 1, tramo 1a: crédito (R9), banco (R13), quiebras y entrada
 * (R12) y capital (R11). Detalle y fuentes en docs/fase1-reglas.md.
 *
 * Las reglas de la Fase 0 (model.ts, PHASE0_STAGES) quedan intactas. Acá se
 * arman las etapas de la Fase 1 reusando las de la Fase 0 donde no cambian.
 *
 * Ninguna etapa usa la inflación ni la emisión para decidir: el crédito solo
 * mira la liquidez de cada empresa, sus ventas pasadas y el patrimonio del banco.
 */

import {
  lend,
  payBankToCentralBank,
  payBankToTreasury,
  payDeposits,
  payFromBank,
  payToBank,
  payToTreasury,
  repayCentralBankCredit,
  repayLoan,
  writeOffLoan,
} from './flows';
import { netFinancialWorth } from './ledger';
import {
  closeMonth,
  government,
  laborMarket,
  openMonth,
  type Stage,
} from './model';
import type { Cents } from './money';
import { CAPITAL, CREDIT, MARKET, PARAMS } from './params';
import { expNeg } from './detmath';
import { defaultProbability, emptyRiskMonth, estimateRisk, leverageBin, riskAdjustedRate } from './creditRisk';
import type { Rng } from './rng';
import { emptyCreditStats, firmIndex, type Firm, type Household, type SimState } from './state';

export type CreditParams = { readonly [K in keyof typeof CREDIT]: number };
export type MarketParams = { readonly [K in keyof typeof MARKET]: number };
export type CapitalParams = { readonly [K in keyof typeof CAPITAL]: number };

/**
 * Variantes EXPERIMENTALES, no aprobadas como reglas: solo para medir
 * (2026-11-11, pedido de Nico). Apagadas por defecto. Ver docs/fase1-reglas.md.
 */
export interface Phase1Experiments {
  /**
   * Traslado total de costos a precios (como CANVAS o K+S según Dawid et al.,
   * 2024): si la empresa sube el salario un x%, el precio sube lo mismo.
   */
  costPassThrough?: boolean;
  /**
   * Salario que baja (estilo Mark-0, Gualdi et al., 2015): una empresa con
   * pérdidas y stock sin vender el mes anterior baja el salario un
   * u · ξ, con u la tasa de desempleo y ξ ~ U(0, tope de R2).
   */
  wageCutWithUnemployment?: boolean;
  /**
   * (c) Precio por restricción de capacidad (2026-11-11, pedido de Nico, solo
   * para medir): una empresa de consumo que agotó stock con precio ≥ promedio y
   * está al tope de su capacidad sube el precio en vez de la cantidad.
   * NO es lo que hace Assenza et al. (2015), ec. 5.1–5.2.
   */
  priceUpAtCapacity?: boolean;
  /** (d) Sin tope de capacidad (solo para medir): Leontief apagado, la depreciación usa ω ≤ 1. */
  noCapacityLimit?: boolean;
}

/** Retención del impuesto (R8), igual que en la Fase 0. */
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

/** Unidades producidas por trabajador por mes, según el sector (R11). */
export function productivityOf(firm: Firm): number {
  return firm.sector === 'capital' ? CAPITAL.capitalGoodsLaborProductivity : PARAMS.laborProductivity;
}

function desiredWorkers(firm: Firm): number {
  return Math.ceil(firm.plannedOutput / productivityOf(firm) - 1e-9);
}

/** Capacidad de producción de una empresa de consumo: κ·K, en unidades enteras (R11, Leontief). */
export function capacityOf(firm: Firm, kappa: number = CAPITAL.capitalProductivity): number {
  return Math.floor(kappa * firm.capital + 1e-9);
}

/**
 * Valor del inventario de bienes de capital, al costo unitario corriente de
 * producción (Caiani et al., 2016: "in accordance with standard accounting rules").
 */
export function inventoryValue(firm: Firm): Cents {
  if (firm.inventory <= 0) return 0;
  return Math.round((firm.inventory * firm.wage) / CAPITAL.capitalGoodsLaborProductivity);
}

/**
 * Patrimonio neto de una empresa (opción A, aprobada el 2026-11-11): depósitos −
 * préstamos + valor libro del capital + inventario valuado. Lo usan R12 (quiebra),
 * R13 (apalancamiento) y R9 (orden de atención).
 */
export function firmNetWorth(firm: Firm): Cents {
  return netFinancialWorth(firm) + firm.capitalValue + inventoryValue(firm);
}

/**
 * Piso de precio de R1 con capital (aprobado el 2026-11-11): costo unitario con
 * la amortización, como en Caiani et al. (2016). Con depreciación según el uso,
 * la amortización por unidad es δ·(V/K)/κ y no depende de la utilización.
 */
export function unitCostFloor(firm: Firm, capital: CapitalParams = CAPITAL): number {
  const labor = firm.wage / productivityOf(firm);
  if (firm.sector === 'capital' || firm.capital <= 0) return labor;
  return labor + (capital.depreciationRate * (firm.capitalValue / firm.capital)) / capital.capitalProductivity;
}

/**
 * Búsqueda con fidelidad al proveedor (R6 de la Fase 1; también la compra de
 * capital, R11): conserva el proveedor anterior si sigue abierto, visita Z − 1
 * más y se cambia a la más barata con probabilidad 1 − e^(−β·brecha).
 * Devuelve el elegido y el orden de compra (el elegido y después el resto, de
 * más barato a más caro).
 */
function searchSuppliers(rng: Rng, open: Firm[], previous: Firm | null, beta: number): Firm[] {
  const loyal = previous !== null && previous.active ? previous : null;
  const others: Firm[] = [];
  const draws = loyal === null ? PARAMS.goodsSearchSize : PARAMS.goodsSearchSize - 1;
  for (let k = 0; k < draws; k++) {
    if (loyal === null || open.length === 1) {
      others.push(rng.pick(open));
    } else {
      // Una competidora distinta del proveedor actual.
      const idx = rng.nextInt(open.length - 1);
      const pos = open.indexOf(loyal);
      others.push(open[idx >= pos ? idx + 1 : idx]!);
    }
  }
  others.sort((a, b) => a.price - b.price || a.id - b.id);
  let chosen: Firm;
  if (loyal === null) {
    chosen = others[0]!;
  } else {
    chosen = loyal;
    const best = others[0]!;
    if (best.price < loyal.price) {
      const p = switchProbability(beta, loyal.price, best.price);
      if (rng.uniform(1) < p) chosen = best;
    }
  }
  const visited = loyal === null ? others : [loyal, ...others];
  const rest = visited.filter((f) => f !== chosen).sort((a, b) => a.price - b.price || a.id - b.id);
  return [chosen, ...rest];
}

/** Deuda total de una empresa (positivo). */
export function firmDebt(firm: Firm): Cents {
  return -firm.positions.loans;
}

/** Máximo que el banco puede tener prestado con su patrimonio actual (R13). */
export function bankLendingCapacity(state: SimState, credit: CreditParams): Cents {
  const equity = netFinancialWorth(state.bank);
  if (equity <= 0) return 0;
  return Math.max(0, Math.floor(equity / credit.capitalRatioMin) - state.bank.positions.loans);
}

/**
 * R9: pedido y otorgamiento de crédito para capital de trabajo.
 *
 * - Pedido: lo que falta para pagar la masa salarial deseada (pecking order:
 *   primero los depósitos). Acotado por el límite de deuda, deuda ≤ λ · ventas
 *   del mes anterior (Dosi et al., 2013, ec. 3).
 * - El banco atiende por patrimonio neto / ventas, de mayor a menor (Dosi et
 *   al., 2013), hasta su límite de capital (R13).
 */
/** Apalancamiento λ = deuda / (deuda + patrimonio), en [0, 1]; con patrimonio ≤ 0 es 1. */
export function leverageOf(debt: Cents, netWorth: Cents): number {
  if (debt <= 0) return 0;
  if (netWorth <= 0) return 1;
  return debt / (debt + netWorth);
}

/**
 * R9 (pedido y otorgamiento) y R13 revisada (tasa según el riesgo).
 *
 * - Pedido: lo que falta para pagar la masa salarial deseada, acotado por el
 *   límite de deuda (deuda ≤ λ_R9 · ventas del mes anterior; Dosi et al., 2013).
 * - Orden: patrimonio neto / ventas, de mayor a menor (Dosi et al., 2013).
 * - Riesgo: φ = probabilidad mensual de quiebra estimada para el apalancamiento
 *   que tendría la empresa con el préstamo (Assenza et al., 2015).
 *   Si φ > umbral, el banco rechaza (racionamiento, Stiglitz & Weiss, 1981).
 *   Si no, cobra r = (r0 + φ·LGD) / (1 − φ) (no arbitraje).
 * - El banco presta hasta su límite de capital (R13).
 */
function allocateCredit(state: SimState, credit: CreditParams, baseMonthlyRate: number): void {
  const c = state.credit;
  const risk = estimateRisk(
    state.bank.riskWindow.slice(0, -1), // el mes en curso todavía no tiene resultados
    credit.riskBins,
    credit.riskMinMonths,
    credit.logisticIterations,
    credit.riskCoarseBands,
  );
  c.riskEstimator = risk.estimator;
  type Request = { firm: Firm; amount: Cents; rank: number };
  const requests: Request[] = [];
  for (const firm of state.firms) {
    if (!firm.active) continue;
    // R11: la compra de capital (reposición) se financia igual que los salarios.
    const investment = firm.sector === 'consumption' ? Math.ceil(firm.capitalOrder * state.stats.capitalPriceIndex) : 0;
    const need = Math.max(0, firm.wage * desiredWorkers(firm) + investment - firm.positions.deposits);
    if (need <= 0) continue;
    const room = Math.max(0, Math.floor(credit.debtToSalesMax * firm.lastRevenue) - firmDebt(firm));
    const amount = Math.min(need, room);
    c.cappedByDebtLimit += need - amount;
    if (amount <= 0) continue;
    requests.push({ firm, amount, rank: firmNetWorth(firm) / firm.lastRevenue });
  }
  // Mayor patrimonio sobre ventas primero; desempate por ID (determinismo).
  requests.sort((a, b) => b.rank - a.rank || a.firm.id - b.firm.id);
  let capacity = bankLendingCapacity(state, credit);
  let rateWeighted = 0;
  for (const { firm, amount } of requests) {
    // Pedir un préstamo no cambia el patrimonio (depósitos y deuda suben juntos).
    const leverage = leverageOf(firmDebt(firm) + amount, firmNetWorth(firm));
    const phi = defaultProbability(risk, leverage);
    if (phi > credit.maxDefaultProbability) {
      c.rationedByRisk += 1;
      c.rationedByRiskAmount += amount;
      continue;
    }
    const granted = Math.min(amount, capacity);
    c.rationedByBank += amount - granted;
    if (granted <= 0) continue;
    const rate = riskAdjustedRate(baseMonthlyRate, phi, risk.lossGivenDefault);
    lend(state, firm, granted);
    firm.loanBook.push({ remaining: granted, installment: Math.ceil(granted / credit.loanTermMonths), rate });
    c.newLoans += granted;
    rateWeighted += rate * granted;
    capacity -= granted;
  }
  c.newLoanRate = c.newLoans > 0 ? rateWeighted / c.newLoans : 0;
  // Observación del mes para la historia del banco: apalancamiento de cada deudor.
  for (const firm of state.firms) {
    firm.monthLeverage = firm.active && firmDebt(firm) > 0 ? leverageOf(firmDebt(firm), firmNetWorth(firm)) : -1;
  }
}

/**
 * Política de dividendos (R7 revisada, aprobada el 2026-11-11). La aprobada es
 * `APPROVED_DIVIDENDS`; las otras combinaciones existen para medir cada parte
 * por separado.
 *
 * - `accumulated`: parte 1, resultados acumulados (Ley 19.550, arts. 68 y 71).
 *   'annual': al cierre de su ejercicio, la empresa reparte solo si su
 *   resultado acumulado es positivo (primero cubre pérdidas anteriores).
 *   'monthly': lo mismo, todos los meses (solo para comparar).
 *   'none': R7 anterior, ρ de la ganancia de cada mes con ganancia.
 * - `leverage`: parte 2, reparto según el endeudamiento (pecking order, Myers
 *   & Majluf, 1984): ρ = ρ_max · (1 − ℓ), con ℓ = deuda / (λ · ventas del mes
 *   anterior) acotado a [0, 1]. Forma lineal: supuesto.
 */
export interface DividendPolicy {
  accumulated: 'none' | 'annual' | 'monthly';
  leverage: boolean;
}

export const APPROVED_DIVIDENDS: DividendPolicy = { accumulated: 'annual', leverage: true };

/**
 * Mes del ejercicio en que cierra el balance la empresa en la posición `index`.
 * Escalonado (supuesto): si todas cerraran el mismo mes, los dividendos se
 * pagarían juntos una vez por año y meterían un ciclo anual artificial.
 */
export function closingMonth(index: number): number {
  return index % 12;
}

/**
 * R6: probabilidad de cambiarse del proveedor actual (precio `previousPrice`)
 * a uno más barato (precio `newPrice`): 1 − e^(−β·brecha), con brecha =
 * (P_ant − P_nuevo) / P_nuevo > 0. Si el nuevo no es más barato, 0. Crece con
 * β y con la brecha (más β = menos fidelidad).
 */
export function switchProbability(beta: number, previousPrice: number, newPrice: number): number {
  if (!(newPrice < previousPrice) || newPrice <= 0) return 0;
  const gap = (previousPrice - newPrice) / newPrice;
  return 1 - expNeg(beta * gap);
}

/** Fracción de la capacidad de deuda (R9) que usa la empresa, en [0, 1]. */
export function debtCapacityUsed(firm: Firm, credit: CreditParams): number {
  const debt = firmDebt(firm);
  if (debt <= 0) return 0;
  const capacity = credit.debtToSalesMax * firm.lastRevenue;
  return capacity <= 0 ? 1 : Math.min(1, debt / capacity);
}

/** Arma las etapas de la Fase 1 con los parámetros de crédito dados. */
export function makePhase1Stages(
  credit: CreditParams = CREDIT,
  experiments: Phase1Experiments = {},
  dividends: DividendPolicy = APPROVED_DIVIDENDS,
  market: MarketParams = MARKET,
  capital: CapitalParams = CAPITAL,
): readonly Stage[] {
  const kappa = capital.capitalProductivity;
  const delta = capital.depreciationRate;
  const alphaK = capital.capitalGoodsLaborProductivity;
  const monthlyLoanRate = ((1 + credit.loanMarkup) * credit.baseRateAnnual) / 12;
  const monthlyBaseRate = credit.baseRateAnnual / 12;

  /** Apertura del mes de la Fase 0, más el reinicio de los acumuladores del crédito. */
  const openMonthP1: Stage = (state, knobs, rng) => {
    if (state.elapsedTicks === 0 && !state.firms.some((f) => f.sector === 'capital')) {
      throw new Error('Las reglas de la Fase 1 necesitan empresas de bienes de capital (SimConfig.capitalFirms > 0)');
    }
    openMonth(state, knobs, rng);
    for (const firm of state.firms) {
      firm.inventoryValueAtOpen = inventoryValue(firm);
      firm.amortizationThisMonth = 0;
      firm.profitThisMonth = 0;
    }
    state.credit = emptyCreditStats();
    // Historia del banco (R13): un registro por mes, los últimos riskWindowMonths
    // (más el mes en curso, que se completa en la etapa de quiebras).
    state.bank.riskWindow.push(emptyRiskMonth(credit.riskBins));
    if (state.bank.riskWindow.length > credit.riskWindowMonths + 1) state.bank.riskWindow.shift();
    for (const firm of state.firms) firm.interestThisMonth = 0;
  };

  /**
   * R2, R1, R9 y R3. Mismo contenido que `firmsPlan` de la Fase 0, pero en tres
   * pasadas: el crédito necesita conocer los pedidos de todas las empresas
   * antes de que R3 decida cuántos trabajadores puede pagar cada una.
   */
  const firmsPlanP1: Stage = (state, _knobs, rng) => {
    const alpha = PARAMS.laborProductivity;
    const avgPrice = state.stats.priceIndex;
    const firstMonth = state.elapsedTicks === 0;

    // Pasada 1: R2 y R1 (iguales a la Fase 0).
    for (const firm of state.firms) {
      if (!firm.active) continue;
      const uWage = rng.uniform(PARAMS.wageStepMax);
      const uPrice = rng.uniform(PARAMS.priceStepMax);
      const uQty = rng.uniform(PARAMS.quantityStepMax);
      if (!firstMonth) {
        const oldWage = firm.wage;
        if (firm.unfilledVacancies) firm.wage = Math.round(firm.wage * (1 + uWage));
        // EXPERIMENTAL (b): baja del salario con pérdidas y desempleo.
        if (experiments.wageCutWithUnemployment && !firm.unfilledVacancies && !firm.soldOut) {
          const lastWageBill = oldWage * Math.round(firm.lastOutput / alpha);
          if (firm.lastRevenue < lastWageBill) {
            firm.wage = Math.max(1, Math.round(firm.wage * (1 - state.stats.unemployment * uWage)));
          }
        }
        // EXPERIMENTAL (a): traslado del costo salarial al precio.
        if (experiments.costPassThrough && firm.wage !== oldWage) {
          firm.price = Math.round((firm.price * firm.wage) / oldWage);
        }
        if (firm.sector === 'consumption') {
          firm.plannedOutput = firm.lastOutput;
          const atCapacity = experiments.priceUpAtCapacity === true && firm.lastOutput >= capacityOf(firm, kappa);
          if (firm.soldOut) {
            if (firm.price < avgPrice || atCapacity) firm.price = Math.round(firm.price * (1 + uPrice));
            else firm.plannedOutput = firm.lastOutput * (1 + uQty);
          } else {
            if (firm.price >= avgPrice) firm.price = Math.round(firm.price * (1 - uPrice));
            else firm.plannedOutput = firm.lastOutput * (1 - uQty);
          }
        } else {
          // R1 de las empresas de capital (Assenza et al., 2015, ec. 6.1–6.2): la
          // misma tabla de cuatro casos, con las ventas del mes anterior como
          // demanda esperada y producción deseada = demanda esperada − inventario.
          // "soldOut" = quedaron pedidos sin atender. Supuesto: nunca espera vender
          // menos de lo que produce un trabajador, para poder volver a crecer.
          const avgK = state.stats.capitalPriceIndex;
          let expected = Math.max(firm.lastUnitsSold, alphaK);
          if (firm.soldOut) {
            if (firm.price < avgK) firm.price = Math.round(firm.price * (1 + uPrice));
            else expected = expected * (1 + uQty);
          } else {
            if (firm.price >= avgK) firm.price = Math.round(firm.price * (1 - uPrice));
            else expected = expected * (1 - uQty);
          }
          firm.plannedOutput = Math.max(0, expected - firm.inventory);
        }
      }
      // Piso de precio: costo unitario, con la amortización (R11).
      firm.price = Math.max(firm.price, Math.ceil(unitCostFloor(firm, capital) - 1e-9), 1);
      if (firm.sector === 'consumption') {
        // Supuesto de la Fase 0: nunca desea menos de un trabajador. R11: nunca más que la capacidad.
        firm.plannedOutput = Math.max(firm.plannedOutput, alpha);
        if (!experiments.noCapacityLimit) firm.plannedOutput = Math.min(firm.plannedOutput, capacityOf(firm, kappa));
        // Reposición (Assenza et al., 2015, ec. 5.6): I = δ·K̄, con K̄ el promedio
        // móvil del capital usado. Es lo que se gastó en promedio. R10 sumará la
        // inversión neta.
        const nu = capital.replacementMemory;
        firm.utilizedCapitalAvg = nu * firm.utilizedCapitalAvg + (1 - nu) * (firm.lastOutput / kappa);
        firm.replacementDue += delta * firm.utilizedCapitalAvg;
        firm.capitalOrder = Math.floor(firm.replacementDue);
        firm.replacementDue -= firm.capitalOrder; // lo que no se consiga no se arrastra
      }
    }

    // Pasada 2: R9.
    allocateCredit(state, credit, monthlyLoanRate);

    // Pasada 3: R3, con los depósitos ya incluyendo el crédito.
    const workers = workersByFirm(state);
    state.firms.forEach((firm, i) => {
      if (!firm.active) return;
      const target = Math.min(desiredWorkers(firm), Math.floor(firm.positions.deposits / firm.wage));
      const current = workers[i]!;
      if (current.length > target) {
        for (const hh of rng.shuffle([...current]).slice(0, current.length - target)) hh.employerId = null;
      }
      firm.vacancies = Math.max(0, target - current.length);
    });
  };

  /**
   * Producción (R11) y salarios con retención (R8).
   * - Consumo: Leontief, y = min(α·N, κ·K) (Assenza et al., 2015, ec. 5.3–5.4).
   *   Se deprecia solo el capital usado: K −= δ·ω·K, con ω = y / (κ·K) (ec. 5.5).
   *   El valor libro baja en la misma proporción (aprobado el 2026-11-11).
   * - Capital: solo trabajo, y = α_K·N (ec. 6.3); va al inventario.
   */
  const productionP1: Stage = (state) => {
    const f = state.fiscal;
    const workers = workersByFirm(state);
    state.firms.forEach((firm, i) => {
      const list = workers[i]!;
      if (firm.sector === 'capital') {
        const out = alphaK * list.length;
        firm.inventory += out;
        firm.stock = 0;
        firm.lastOutput = out;
      } else {
        const potential = PARAMS.laborProductivity * list.length;
        const out = experiments.noCapacityLimit ? potential : Math.min(potential, capacityOf(firm, kappa));
        firm.stock = out;
        firm.lastOutput = out;
        if (out > 0 && firm.capital > 0) {
          // δ·ω (en la variante experimental sin tope, ω se acota a 1).
          const used = experiments.noCapacityLimit
            ? delta * Math.min(1, out / (kappa * firm.capital))
            : (delta * out) / (kappa * firm.capital);
          const amortization = Math.floor(firm.capitalValue * used);
          firm.capital -= firm.capital * used;
          firm.capitalValue -= amortization;
          firm.amortizationThisMonth = amortization;
        }
      }
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

  /**
   * Mercado de bienes de capital (R11), después de la producción (orden de
   * Caiani et al., 2016). Cada empresa de consumo con pedido busca proveedor
   * como en R6 (supuesto aprobado) y paga con sus depósitos. El capital comprado
   * se usa desde el mes siguiente (Caiani): la producción del mes ya ocurrió.
   */
  const capitalMarket: Stage = (state, _knobs, rng) => {
    const c = state.credit;
    const sellers = state.firms.filter((f) => f.active && f.sector === 'capital');
    for (const seller of sellers) seller.soldOut = false;
    const buyers = rng.shuffle(state.firms.filter((f) => f.active && f.sector === 'consumption' && f.capitalOrder > 0));
    for (const firm of buyers) {
      c.capitalOrdered += firm.capitalOrder;
      if (sellers.length === 0) continue;
      const previous = firm.capitalSupplierId === null ? null : state.firms[firmIndex(state, firm.capitalSupplierId)]!;
      const order = searchSuppliers(rng, sellers, previous, market.supplierSwitchIntensity);
      firm.capitalSupplierId = order[0]!.id;
      let remaining = firm.capitalOrder;
      for (const seller of order) {
        if (remaining <= 0) break;
        // Pedido sin atender por falta de inventario: señal de exceso de demanda (R1).
        if (seller.inventory < remaining) seller.soldOut = true;
        const units = Math.min(remaining, seller.inventory, Math.floor(firm.positions.deposits / seller.price));
        if (units <= 0) continue;
        const cost = units * seller.price;
        payDeposits(firm, seller, cost);
        seller.inventory -= units;
        seller.unitsSold += units;
        seller.revenue += cost;
        firm.capital += units;
        firm.capitalValue += cost; // costo histórico (opción A)
        remaining -= units;
        c.capitalBought += units;
      }
    }
  };

  /**
   * R9 (repago) y R13 (intereses). Después del mercado de bienes, con las ventas
   * del mes ya cobradas. Primero los intereses y después el capital.
   * PROVISORIO hasta R12: lo que no se puede pagar se suma al saldo.
   */
  const debtService: Stage = (state) => {
    const c = state.credit;
    for (const firm of state.firms) {
      if (firm.loanBook.length === 0) {
        firm.arrearsMonths = 0;
        continue;
      }
      // Cada préstamo paga su propia tasa, fijada al otorgarlo (R13 revisada).
      let interest = 0;
      for (const loan of firm.loanBook) interest += Math.floor(loan.remaining * loan.rate);
      const paid = Math.min(interest, firm.positions.deposits);
      payToBank(state, firm, paid);
      const unpaid = interest - paid;
      if (unpaid > 0) {
        // Capitalización: el banco presta el interés impago y lo cobra en el acto.
        lend(state, firm, unpaid);
        payToBank(state, firm, unpaid);
        firm.loanBook[firm.loanBook.length - 1]!.remaining += unpaid;
        c.interestCapitalized += unpaid;
      }
      firm.interestThisMonth = interest;
      // La ganancia del banco cuenta solo los intereses COBRADOS (R13); los
      // capitalizados aumentan el saldo pero no son ingreso hasta que se cobren.
      c.interestIncome += paid;

      let missed = false;
      for (const loan of firm.loanBook) {
        const due = Math.min(loan.installment, loan.remaining);
        const pay = Math.min(due, firm.positions.deposits);
        repayLoan(state, firm, pay);
        loan.remaining -= pay;
        if (pay < due) {
          missed = true;
          c.principalArrears += due - pay;
        }
      }
      firm.loanBook = firm.loanBook.filter((loan) => loan.remaining > 0);
      firm.arrearsMonths = missed ? firm.arrearsMonths + 1 : 0;
    }
  };

  /**
   * R7 revisada: ganancia = ventas − masa salarial − intereses. Se acumula en el
   * resultado no distribuido; se reparte según `dividends` (ver DividendPolicy).
   */
  const profitsP1: Stage = (state) => {
    const f = state.fiscal;
    const monthOfYear = state.elapsedTicks % 12;
    state.firms.forEach((firm, index) => {
      if (!firm.active) return;
      // R11: la amortización es un costo (Caiani et al., 2016; Assenza et al., 2015,
      // ec. 8.17) y la variación del inventario valuado entra en la ganancia (Caiani).
      const profit =
        firm.revenue -
        firm.wageBill -
        firm.interestThisMonth -
        firm.amortizationThisMonth +
        (inventoryValue(firm) - firm.inventoryValueAtOpen);
      firm.profitThisMonth = profit;
      let base: Cents;
      if (dividends.accumulated === 'none') {
        base = Math.max(0, profit);
      } else {
        firm.retainedEarnings += profit;
        const closes = dividends.accumulated === 'monthly' || closingMonth(index) === monthOfYear;
        base = closes ? Math.max(0, firm.retainedEarnings) : 0;
      }
      if (base <= 0) return;
      const payout = PARAMS.dividendPayout * (dividends.leverage ? 1 - debtCapacityUsed(firm, credit) : 1);
      const dividend = Math.min(Math.floor(payout * base), firm.positions.deposits);
      if (dividend <= 0) return;
      if (dividends.accumulated !== 'none') firm.retainedEarnings -= dividend;
      const owner = state.households[firm.ownerId]!;
      const tax = withholding(dividend, f.taxRate);
      payDeposits(firm, owner, dividend - tax);
      payToTreasury(state, firm, tax);
      owner.incomeThisMonth += dividend - tax;
      f.taxBaseThisMonth += dividend;
      f.dividendsThisMonth += dividend;
      f.taxesThisMonth += tax;
    });
  };

  /**
   * R13: el banco paga intereses al BCRA por su financiamiento, reparte
   * dividendos si su patrimonio supera el objetivo y devuelve el
   * financiamiento del BCRA con las reservas que le sobran.
   */
  const bankStage: Stage = (state) => {
    const c = state.credit;
    const f = state.fiscal;
    const cbInterest = Math.floor(-state.bank.positions.centralBankCredit * monthlyBaseRate);
    payBankToCentralBank(state, cbInterest);
    c.centralBankInterest = cbInterest;

    const profit = c.interestIncome - cbInterest - c.writeOffs;
    const room = netFinancialWorth(state.bank) - Math.ceil(credit.capitalRatioTarget * state.bank.positions.loans);
    const dividend = Math.min(Math.floor(credit.bankDividendPayout * profit), room);
    if (dividend > 0) {
      const owner = state.households[state.bank.ownerId]!;
      const tax = withholding(dividend, f.taxRate);
      payFromBank(state, owner, dividend - tax);
      payBankToTreasury(state, tax);
      owner.incomeThisMonth += dividend - tax;
      f.taxBaseThisMonth += dividend;
      f.dividendsThisMonth += dividend;
      f.taxesThisMonth += tax;
      c.bankDividends = dividend;
    }
    repayCentralBankCredit(state, state.bank.positions.reserves);
  };

  /** Cierre de la Fase 0, más las ventas del mes para el límite de deuda del mes siguiente. */
  const closeMonthP1: Stage = (state, knobs, rng) => {
    closeMonth(state, knobs, rng);
    let kRevenue = 0;
    let kUnits = 0;
    for (const firm of state.firms) {
      firm.lastRevenue = firm.revenue;
      if (!firm.active) firm.inactiveMonths += 1;
      if (firm.sector === 'capital') {
        firm.lastUnitsSold = firm.unitsSold;
        kRevenue += firm.revenue;
        kUnits += firm.unitsSold;
      }
    }
    if (kUnits > 0) state.stats.capitalPriceIndex = kRevenue / kUnits;
  };

  /**
   * R12 (quiebra): una empresa quiebra si su patrimonio neto es negativo o si
   * lleva `arrearsMonthsToBankruptcy` meses seguidos sin pagar completa la cuota
   * (para que no queden empresas zombis). Despide a todos; sus depósitos van al
   * banco a cuenta de la deuda y el resto se castiga. Responsabilidad limitada:
   * el dueño no pone más. Fuente: Delli Gatti et al. (2011); Assenza et al. (2015).
   */
  const bankruptcies: Stage = (state, _knobs, rng) => {
    const c = state.credit;
    const record = state.bank.riskWindow[state.bank.riskWindow.length - 1]!;
    for (const firm of state.firms) {
      if (!firm.active) continue;
      const insolvent = firmNetWorth(firm) < 0;
      const zombie = firm.arrearsMonths >= credit.arrearsMonthsToBankruptcy;
      // Observación para R13: cada deudor del mes, por tramo de apalancamiento.
      const bin = firm.monthLeverage >= 0 ? leverageBin(firm.monthLeverage, credit.riskBins) : -1;
      if (bin >= 0) record.borrowers[bin]! += 1;
      if (!insolvent && !zombie) continue;
      if (bin >= 0) record.defaults[bin]! += 1;
      for (const hh of state.households) if (hh.employerId === firm.id) hh.employerId = null;
      const oldOwner = state.households[firm.ownerId]!;
      firm.pendingOwnerId = null;
      if (firm.sector === 'consumption') sellPlant(state, firm, rng);
      // Empresa de capital: no tiene garantía; el inventario se pierde (Caiani et al., 2016).
      else firm.inventory = 0;
      const debt = firmDebt(firm);
      const recovered = Math.min(debt, firm.positions.deposits);
      repayLoan(state, firm, recovered);
      writeOffLoan(state, firm, debt - recovered);
      c.writeOffs += debt - recovered;
      record.defaultedDebt += debt;
      record.writtenOff += debt - recovered;
      // Si sobra algo (deuda chica con mora, o una planta que vale más que la deuda), vuelve al dueño.
      payDeposits(firm, oldOwner, firm.positions.deposits);
      if (firm.pendingOwnerId !== null) firm.ownerId = firm.pendingOwnerId;
      firm.loanBook = [];
      firm.active = false;
      firm.inactiveMonths = 0;
      firm.arrearsMonths = 0;
      firm.vacancies = 0;
      firm.lastOutput = 0;
      firm.plannedOutput = 0;
      firm.soldOut = false;
      firm.unfilledVacancies = false;
      firm.capitalOrder = 0;
      firm.replacementDue = 0;
      firm.capitalSupplierId = null;
      c.bankruptcies += 1;
    }
  };

  /**
   * Venta forzosa de la planta de una empresa de consumo que quiebra (aprobada
   * el 2026-11-11; Caiani et al., 2016, sección 3.3). Precio r_K·V (Ramey &
   * Shapiro, 2001). El pago entra a los depósitos de la empresa y de ahí va al
   * banco. La planta queda en el lugar, con el precio pagado como nuevo costo
   * histórico, para la empresa que entra.
   * - Comprador: un hogar al azar entre los que pueden pagarla; queda como dueño
   *   y capitaliza la entrada.
   * - Sin comprador: todos los hogares la pagan en proporción a sus depósitos
   *   (Caiani: "distributed proportionally to households' net wealth").
   */
  function sellPlant(state: SimState, firm: Firm, rng: Rng): void {
    const c = state.credit;
    if (firm.capitalValue <= 0 || firm.capital <= 0) {
      firm.capitalValue = 0;
      return;
    }
    const price = Math.floor(capital.fireSaleRecovery * firm.capitalValue);
    let paid = 0;
    if (price > 0) {
      const candidates = state.households.filter((hh) => hh.positions.deposits >= price);
      if (candidates.length > 0) {
        const buyer = rng.pick(candidates);
        payDeposits(buyer, firm, price);
        paid = price;
        firm.pendingOwnerId = buyer.id;
        c.fireSales += 1;
      } else {
        const total = state.households.reduce((acc, hh) => acc + hh.positions.deposits, 0);
        for (const hh of state.households) {
          const share = Math.floor((hh.positions.deposits / total) * price);
          if (share <= 0) continue;
          payDeposits(hh, firm, share);
          paid += share;
        }
        c.fireSalesPooled += 1;
      }
    }
    firm.capitalValue = paid;
    c.fireSaleProceeds += paid;
  }

  /**
   * R12 (entrada): pasados `entryDelayMonths`, entra una empresa nueva en el
   * lugar de la que quebró, con el tamaño mediano de las activas, el precio
   * promedio y el salario promedio. La capitaliza un hogar elegido al azar entre
   * los que tienen depósitos suficientes (una transferencia: no se crea dinero).
   * Si nadie puede, se reintenta el mes siguiente.
   */
  const entry: Stage = (state, _knobs, rng) => {
    const active = state.firms.filter((f) => f.active);
    if (active.length === 0) return;
    for (const firm of state.firms) {
      if (firm.active || firm.inactiveMonths < credit.entryDelayMonths) continue;
      // Tamaño mediano de las activas del mismo sector (R11: la entrada es en el mismo sector).
      const peers = active.filter((f) => f.sector === firm.sector);
      if (peers.length === 0) continue;
      const productivity = productivityOf(firm);
      const sizes = peers.map((f) => Math.max(1, Math.round(f.lastOutput / productivity))).sort((a, b) => a - b);
      const size = sizes[Math.floor(sizes.length / 2)]!;
      const wage = Math.round(active.reduce((acc, f) => acc + f.wage, 0) / active.length);
      const equity = Math.ceil(credit.entrantEquityMonths * wage * size);
      // Si alguien compró la planta en la venta forzosa, capitaliza él (si puede).
      const pending = firm.pendingOwnerId === null ? null : state.households[firm.pendingOwnerId]!;
      let owner: Household;
      if (pending !== null && pending.positions.deposits >= equity) {
        owner = pending;
      } else {
        const candidates = state.households.filter((hh) => hh.positions.deposits >= equity);
        if (candidates.length === 0) continue;
        owner = rng.pick(candidates);
      }
      payDeposits(owner, firm, equity);
      firm.ownerId = owner.id;
      firm.pendingOwnerId = null;
      firm.active = true;
      firm.inactiveMonths = 0;
      firm.wage = wage;
      firm.lastRevenue = 0; // sin ventas todavía: no puede pedir crédito hasta vender (R9)
      firm.retainedEarnings = 0; // el capital aportado no es resultado distribuible (R7)
      if (firm.sector === 'consumption') {
        firm.price = Math.max(Math.round(state.stats.priceIndex), Math.ceil(unitCostFloor(firm, capital) - 1e-9), 1);
        firm.plannedOutput = Math.min(productivity * size, capacityOf(firm, kappa));
        firm.utilizedCapitalAvg = firm.plannedOutput / kappa;
        firm.replacementDue = 0;
      } else {
        firm.price = Math.max(Math.round(state.stats.capitalPriceIndex), Math.ceil(wage / productivity), 1);
        firm.plannedOutput = productivity * size;
        firm.lastUnitsSold = firm.plannedOutput;
        firm.inventory = 0;
      }
      firm.lastOutput = firm.plannedOutput;
      state.credit.entries += 1;
    }
  };

  /**
   * R5 (igual que en la Fase 0) y R6 de la Fase 1: fidelidad al proveedor, como
   * en CATS (Delli Gatti, Terranova & Turco, 2023, sección 3.9; Delli Gatti et
   * al., 2010). Solo se visitan empresas activas.
   *
   * - El hogar conserva su proveedor del mes anterior y visita Z − 1 empresas más.
   * - Si la más barata de esas es más barata que su proveedor, se cambia con
   *   probabilidad 1 − e^(−β·(P_ant − P_z)/P_z), que crece con la brecha.
   * - Compra primero en el proveedor elegido; si no le alcanza, en las otras
   *   visitadas, de la más barata a la más cara.
   * - Sin proveedor (al principio, o si quebró): visita Z al azar y elige la más barata.
   */
  const goodsMarketP1: Stage = (state, _knobs, rng) => {
    const open = state.firms.filter((f) => f.active && f.sector === 'consumption');
    const buyers = rng.shuffle([...state.households]);
    for (const hh of buyers) {
      const desired = Math.floor(
        PARAMS.consumeOutOfIncome * hh.incomeLastMonth + PARAMS.consumeOutOfWealth * hh.depositsAtMonthStart,
      );
      let budget = Math.min(desired, hh.positions.deposits);
      if (budget <= 0 || open.length === 0) continue;

      const previous = hh.supplierId === null ? null : state.firms[firmIndex(state, hh.supplierId)]!;
      const order = searchSuppliers(rng, open, previous, market.supplierSwitchIntensity);
      hh.supplierId = order[0]!.id;
      for (const firm of order) {
        if (firm.stock <= 0) continue;
        const units = Math.min(firm.stock, Math.floor(budget / firm.price));
        if (units <= 0) continue;
        const cost = units * firm.price;
        payDeposits(hh, firm, cost);
        firm.stock -= units;
        firm.unitsSold += units;
        firm.revenue += cost;
        budget -= cost;
      }
    }
    for (const firm of state.firms) if (firm.sector === 'consumption') firm.soldOut = firm.active && firm.stock === 0;
  };

  return [
    openMonthP1,
    entry,
    firmsPlanP1,
    laborMarket,
    productionP1,
    capitalMarket,
    government,
    goodsMarketP1,
    debtService,
    bankruptcies,
    profitsP1,
    bankStage,
    closeMonthP1,
  ];
}

/** Etapas de la Fase 1 con los parámetros aprobados. */
export const PHASE1_STAGES: readonly Stage[] = makePhase1Stages();
