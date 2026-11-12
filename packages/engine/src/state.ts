/**
 * Estado de la simulación.
 *
 * Todo lo que hace falta para avanzar un tick vive acá, incluido el estado del
 * PRNG. Así `step(state, knobs)` es una función pura y el estado se puede
 * clonar, serializar y comparar.
 */

import { payFromTreasury, payTreasuryToBank, coverWithAdvances } from './flows';
import { emptyPositions, type Agent, type AgentId } from './ledger';
import { DEFAULT_KNOBS, type Knobs } from './knobs';
import type { Cents } from './money';
import { CAPITAL, INITIAL, PARAMS } from './params';
import { Rng, createRngState, type RngState } from './rng';
import type { RiskEstimator, RiskMonth } from './creditRisk';

export interface Household extends Agent {
  kind: 'household';
  /** Empresa donde trabaja, o null si está desocupado. */
  employerId: AgentId | null;
  /** Ingreso disponible del mes anterior (salario neto + transferencias + dividendos netos). */
  incomeLastMonth: Cents;
  /** Ingreso disponible acumulado en el mes en curso. */
  incomeThisMonth: Cents;
  /** Depósitos al inicio del mes (la "riqueza del período anterior" de R5). */
  depositsAtMonthStart: Cents;
  /** Proveedor del mes anterior (R6 de la Fase 1, fidelidad al proveedor), o null. */
  supplierId: AgentId | null;
}

export interface Firm extends Agent {
  kind: 'firm';
  /** Hogar dueño: cobra los dividendos. */
  ownerId: AgentId;
  /** Precio por unidad, en centavos. */
  price: Cents;
  /** Salario mensual que paga, en centavos. */
  wage: Cents;
  /** Producción deseada, en unidades (puede no ser entera). */
  plannedOutput: number;
  /**
   * Producción efectiva del último mes, en unidades. R1 ajusta la cantidad a
   * partir de este valor, no de `plannedOutput` (ver docs/fase1-reglas.md).
   */
  lastOutput: number;
  /** Vacantes abiertas en el mes en curso. */
  vacancies: number;
  /** Stock disponible en el mes en curso (el bien es perecedero). */
  stock: number;
  unitsSold: number;
  revenue: Cents;
  wageBill: Cents;
  /** Señales del mes anterior que usan las reglas R1 y R2. */
  soldOut: boolean;
  unfilledVacancies: boolean;
  /** Ventas (en pesos) del mes anterior. */
  lastRevenue: Cents;
  /**
   * Ventas esperadas Sᵉ (expectativas adaptativas, Caiani et al., 2016; aprobado
   * el 2026-11-11). Las usan el límite de deuda de R9, el orden de atención del
   * banco y la capacidad de deuda usada de R7. En centavos, no necesariamente entero.
   */
  expectedSales: number;
  /**
   * Préstamos vigentes (R9), cada uno con su saldo y su cuota de capital.
   * La suma de los saldos es siempre igual a −positions.loans.
   */
  loanBook: Loan[];
  /** Intereses devengados este mes (pagados o capitalizados). Entran en la ganancia de R7. */
  interestThisMonth: Cents;
  /** Meses seguidos sin poder pagar completa la cuota de capital (para R12 y el chequeo de zombis). */
  arrearsMonths: number;
  /** false entre la quiebra y la entrada de la empresa que la reemplaza (R12). */
  active: boolean;
  /** Meses que lleva cerrada (R12). */
  inactiveMonths: number;
  /**
   * Resultado acumulado no distribuido (R7 revisada): suma de las ganancias y
   * pérdidas de cada mes menos los dividendos pagados. Puede ser negativo.
   */
  retainedEarnings: Cents;
  /**
   * Apalancamiento λ = deuda / (deuda + patrimonio) después del crédito del mes,
   * o −1 si no tiene deuda. Lo registra el banco para estimar el riesgo (R13).
   */
  monthLeverage: number;

  // --- Capital (R11, Fase 1). En la Fase 0 todas las empresas son de consumo y sin capital. ---
  /** Sector: 'consumption' produce el bien de consumo; 'capital', el bien de capital (solo con trabajo). */
  sector: FirmSector;
  /** Capital instalado, en unidades reales (empresas de consumo). */
  capital: number;
  /** Valor libro del capital, en centavos: costo histórico menos amortización (opción A). */
  capitalValue: Cents;
  /** Amortización del mes (entra en la ganancia de R7). */
  amortizationThisMonth: Cents;
  /** K̄: promedio móvil del capital usado, Y/κ (reposición de Assenza et al., 2015, ec. 5.6). */
  utilizedCapitalAvg: number;
  /** Reposición pendiente (fracción de unidad que quedó del mes anterior). */
  replacementDue: number;
  /** Unidades de bien de capital que quiere comprar este mes. */
  capitalOrder: number;
  /** Proveedor de bienes de capital del mes anterior (búsqueda con fidelidad, como R6), o null. */
  capitalSupplierId: AgentId | null;
  /** Inventario de bienes de capital, en unidades (empresas de capital). */
  inventory: number;
  /** Valor del inventario al abrir el mes (para la variación que entra en la ganancia). */
  inventoryValueAtOpen: Cents;
  /** Unidades vendidas el mes anterior (empresas de capital). */
  lastUnitsSold: number;
  /**
   * Demanda de bienes de capital recibida en el mes y en el mes anterior (empresas
   * de capital): lo que pidió cada comprador que la visitó, lo haya podido vender o
   * no (Assenza et al., 2015, ec. 6.2: Δ = producción − demanda).
   */
  demandUnits: number;
  lastDemand: number;
  /** Hogar que compró la planta en la venta forzosa y capitaliza la entrada (R12), o null. */
  pendingOwnerId: AgentId | null;
  /** Ganancia contable del mes (R7), para los tests de consistencia. */
  profitThisMonth: Cents;
  /** Cuotas de capital pagadas en el mes (para el flujo de caja operativo de R10). */
  principalPaidThisMonth: Cents;
  /**
   * Tasa de flujo de caja operativo del mes: (ganancia + amortización − cuotas de
   * capital pagadas) / valor libro del capital (Caiani et al., 2016, sección 3.1.3).
   */
  cashFlowRate: number;
  /** Producción deseada por R1 ANTES del tope de capacidad: la señal de utilización de R10. */
  desiredOutput: number;
}

export type FirmSector = 'consumption' | 'capital';

/** Un préstamo con amortización de capital en cuotas iguales (R9). */
export interface Loan {
  /** Saldo de capital. */
  remaining: Cents;
  /** Cuota de capital mensual. */
  installment: Cents;
  /** Tasa mensual fijada al otorgarlo (R13 revisada: depende del riesgo del deudor). */
  rate: number;
}

export interface Bank extends Agent {
  kind: 'bank';
  /** Hogar dueño: cobra los dividendos del banco (R13). */
  ownerId: AgentId;
  /** Historia de deudores por mes (R13 revisada), los últimos `riskWindowMonths`. */
  riskWindow: RiskMonth[];
}

/** Flujos del banco en el mes y estado del crédito (R9 y R13). */
export interface CreditStats {
  /** Préstamos nuevos otorgados este mes. */
  newLoans: Cents;
  /** Pedidos de crédito no atendidos por el límite del banco (R13). */
  rationedByBank: Cents;
  /** Crédito que las empresas necesitaban pero no pudieron pedir por el límite de deuda (R9). */
  cappedByDebtLimit: Cents;
  /** Intereses cobrados por el banco en efectivo (R13). No incluye los capitalizados. */
  interestIncome: Cents;
  /** Intereses capitalizados (no pagados en efectivo). */
  interestCapitalized: Cents;
  /** Cuotas de capital vencidas que no se pagaron. */
  principalArrears: Cents;
  /** Intereses que el banco le pagó al BCRA. */
  centralBankInterest: Cents;
  /** Préstamos castigados (R12; en el paso 1a.3 siempre 0). */
  writeOffs: Cents;
  /** Dividendos brutos del banco. */
  bankDividends: Cents;
  /** Pedidos rechazados por racionamiento (φ por encima del umbral, R13) y su monto. */
  rationedByRisk: number;
  rationedByRiskAmount: Cents;
  /** Con qué se estimó el riesgo este mes (R13). */
  riskEstimator: RiskEstimator;
  /** Tasa mensual promedio de los préstamos nuevos del mes, ponderada por monto (0 si no hubo). */
  newLoanRate: number;
  /** Quiebras del mes (R12). */
  bankruptcies: number;
  /** Empresas que entraron este mes (R12). */
  entries: number;
  /** Ventas forzosas de plantas (R11/R12): a un comprador, o pagadas entre todos los hogares (Caiani). */
  fireSales: number;
  fireSalesPooled: number;
  /** Recupero del banco por ventas forzosas, en centavos. */
  fireSaleProceeds: Cents;
  /** Unidades de bien de capital pedidas y compradas en el mes. */
  capitalOrdered: number;
  capitalBought: number;
  /** Suma de la demanda registrada por las empresas de capital (con el doble conteo de las colas). */
  capitalDemandRegistered: number;
}

export interface Treasury extends Agent {
  kind: 'treasury';
}

export interface CentralBank extends Agent {
  kind: 'centralBank';
}

export interface Fiscal {
  /** Alícuota vigente este mes (R8). */
  taxRate: number;
  /** Base imponible (salarios + dividendos brutos) del mes anterior. */
  lastTaxBase: Cents;
  /** Dividendos brutos del mes anterior (entran en la base de pleno empleo de R8). */
  lastDividends: Cents;
  dividendsThisMonth: Cents;
  taxBaseThisMonth: Cents;
  taxesThisMonth: Cents;
  spendingThisMonth: Cents;
  /** Adelantos del BCRA tomados este mes (emisión). */
  advancesThisMonth: Cents;
}

/** Indicadores del último mes cerrado. */
export interface Stats {
  /** Precio promedio de las ventas del mes, en centavos por unidad. */
  priceIndex: number;
  /** Variación mensual del índice de precios. */
  inflation: number;
  unemployment: number;
  /** Salario promedio de los ocupados en unidades del bien. */
  realWage: number;
  /** Fracción de hogares con ingreso menor a la canasta. */
  poverty: number;
  /** Unidades producidas en el mes. */
  output: number;
  /** Adelantos del BCRA al Tesoro en el mes, en centavos (emisión). */
  emission: Cents;
  /**
   * "Emisión efectiva": fracción del gasto del mes cubierta con adelantos del BCRA.
   * Incluye el déficit estructural (perilla) y el cíclico (automático).
   */
  effectiveEmissionShare: number;
  /** Precio promedio de las ventas de bienes de capital del mes (Fase 1; en la Fase 0 queda fijo). */
  capitalPriceIndex: number;
}

export interface SimState {
  /** Semilla con la que se creó la cápsula. */
  seed: number;
  /** Mes visible: arranca en 0 al terminar el calentamiento. Es el tick del log de perillas. */
  tick: number;
  /** Meses transcurridos desde la creación, calentamiento incluido. No se reinicia. */
  elapsedTicks: number;
  rng: RngState;
  knobs: Knobs;
  households: Household[];
  firms: Firm[];
  bank: Bank;
  treasury: Treasury;
  centralBank: CentralBank;
  fiscal: Fiscal;
  stats: Stats;
  credit: CreditStats;
}

export interface SimConfig {
  households: number;
  firms: number;
  /** Perillas iniciales (las que rigen desde el mes 0 visible). */
  knobs?: Knobs;
  /** Meses de calentamiento antes del mes 0 visible (ver docs/fase0-reglas.md, "Calentamiento"). */
  burnInTicks?: number;
  /** Perillas fijas durante el calentamiento. Si falta, se usan `knobs`. */
  burnInKnobs?: Knobs;
  /** Condiciones iniciales que reemplazan a las de `INITIAL` (ver InitialOverrides). */
  initial?: InitialOverrides;
  /**
   * Cuántas de las `firms` son de bienes de capital (R11, Fase 1). Van al final
   * de la lista. Por defecto 0 (Fase 0: todas de consumo, sin capital).
   */
  capitalFirms?: number;
}

/**
 * Condiciones iniciales calibradas con el régimen estable (Fase 1, 2026-11-11).
 * Lo que falte se toma de `INITIAL` (las de la Fase 0).
 */
export interface InitialOverrides {
  /** Precio inicial = costo unitario × este factor. */
  markup?: number;
  /** Fracción de hogares empleados al inicio. */
  employmentRate?: number;
  /** Depósitos iniciales de las empresas, en meses de su masa salarial. */
  firmDepositMonths?: number;
  /**
   * Depósitos iniciales de cada hogar, en meses de SU ingreso disponible inicial.
   * Si falta, se usa `INITIAL.householdDepositMonths` meses del salario inicial (Fase 0).
   */
  householdDepositIncomeMonths?: number;
}

/**
 * Tamaño de la Fase 0 según el roadmap. Calentamiento de 420 meses: después de
 * corregir R1 y sacar el colchón de R7 (2026-11-11), el desempleo sigue bajando
 * hasta el año ~30 desde la creación (ver docs/fase0-reglas.md, "Calentamiento").
 */
export const PHASE0_CONFIG: SimConfig = {
  households: 500,
  firms: 30,
  burnInTicks: 420,
  burnInKnobs: { publicSpending: 5_000_000, structuralDeficitShare: 0 },
};

/**
 * Condiciones iniciales de la Fase 1, calibradas con el régimen estable de las
 * reglas aprobadas (R1–R13, con R7 revisada): mediana de 20 semillas, años 40 a
 * 50 desde la creación, 2.000 hogares (2026-11-11; `report:fase1 regimen`).
 * El patrimonio inicial del banco queda en `INITIAL.bankEquityShare`: no hay un
 * régimen estable del banco que medir (ver docs/fase1-reglas.md).
 */
export const PHASE1_INITIAL: InitialOverrides = {
  markup: 1.196,
  employmentRate: 0.977,
  firmDepositMonths: 1.58,
  householdDepositIncomeMonths: 4.69,
};

/**
 * Tamaño de la Fase 1 (decisión de Nico, 2026-11-11): 2.000 hogares y 120
 * empresas, con el gasto escalado en proporción (100 pesos por hogar por mes).
 * Con este tamaño el ruido mes a mes cae a la mitad que con 500 hogares (paso
 * 1a.1). Calentamiento de 420 meses: ver docs/fase1-reglas.md, paso 1a.1.
 * PHASE0_CONFIG queda como referencia de la Fase 0 (sus tests y la app hasta el paso 1c.6).
 */
export const PHASE1_CONFIG: SimConfig = {
  households: 2000,
  firms: 120,
  burnInTicks: 420,
  burnInKnobs: { publicSpending: 20_000_000, structuralDeficitShare: 0 },
  knobs: { publicSpending: 20_000_000, structuralDeficitShare: 0 },
  initial: PHASE1_INITIAL,
  // R11 (2026-11-11): 100 de consumo y 20 de capital, la proporción de Caiani et al. (2016), cuadro 3.
  capitalFirms: 20,
};

/** Constante para separar el flujo de azar de la población del flujo de la simulación. */
const POPULATION_STREAM = 0x5bd1e995;

/**
 * Estado inicial de la "cápsula limpia" (ver docs/fase0-reglas.md).
 *
 * IDs: hogares 0..H-1, empresas H..H+F-1, después banco, Tesoro y BCRA.
 * La riqueza financiera inicial se crea como deuda pasada del Tesoro con el BCRA.
 */
export function createInitialState(seed: number, config: SimConfig): SimState {
  const { households: h, firms: f } = config;
  if (!Number.isInteger(h) || h <= 0 || !Number.isInteger(f) || f <= 0) {
    throw new Error('La cantidad de hogares y empresas tiene que ser un entero positivo');
  }
  const knobs = { ...(config.knobs ?? DEFAULT_KNOBS) };
  const popRng = new Rng(createRngState((seed ^ POPULATION_STREAM) >>> 0));
  const init = { ...INITIAL, ...config.initial };
  const w0 = INITIAL.wage;
  const alpha = PARAMS.laborProductivity;
  const p0 = Math.round((w0 / alpha) * init.markup);

  let id = 0;
  const households: Household[] = [];
  for (let i = 0; i < h; i++) {
    households.push({
      id: id++,
      kind: 'household',
      positions: emptyPositions(),
      employerId: null,
      incomeLastMonth: 0,
      incomeThisMonth: 0,
      depositsAtMonthStart: 0,
      supplierId: null,
    });
  }

  const capitalFirms = config.capitalFirms ?? 0;
  if (!Number.isInteger(capitalFirms) || capitalFirms < 0 || capitalFirms >= f) {
    throw new Error('capitalFirms tiene que ser un entero entre 0 y firms − 1');
  }
  const consumptionFirms = f - capitalFirms;
  const owners = popRng.shuffle(households.map((hh) => hh.id)).slice(0, f);
  const firms: Firm[] = [];
  for (let i = 0; i < f; i++) {
    firms.push({
      id: id++,
      kind: 'firm',
      positions: emptyPositions(),
      ownerId: owners[i % owners.length] as AgentId,
      price: p0,
      wage: w0,
      plannedOutput: 0,
      lastOutput: 0,
      vacancies: 0,
      stock: 0,
      unitsSold: 0,
      revenue: 0,
      wageBill: 0,
      soldOut: false,
      unfilledVacancies: false,
      lastRevenue: 0,
      expectedSales: 0,
      loanBook: [],
      interestThisMonth: 0,
      arrearsMonths: 0,
      active: true,
      inactiveMonths: 0,
      retainedEarnings: 0,
      monthLeverage: -1,
      sector: i < consumptionFirms ? 'consumption' : 'capital',
      capital: 0,
      capitalValue: 0,
      amortizationThisMonth: 0,
      utilizedCapitalAvg: 0,
      replacementDue: 0,
      capitalOrder: 0,
      capitalSupplierId: null,
      inventory: 0,
      inventoryValueAtOpen: 0,
      lastUnitsSold: 0,
      demandUnits: 0,
      lastDemand: 0,
      pendingOwnerId: null,
      profitThisMonth: 0,
      principalPaidThisMonth: 0,
      // Sin historia, R10 arranca con la rentabilidad objetivo (supuesto: neutral).
      cashFlowRate: CAPITAL.targetCashFlowRate,
      desiredOutput: 0,
    });
  }

  // Empleo inicial repartido en partes iguales entre las empresas de cada sector.
  // Con capital (R11), el sector de capital arranca con el empleo que necesita
  // la reposición a la utilización normal: N_K / N_C = δ·α / (κ·α_K).
  const employedCount = Math.round(h * init.employmentRate);
  const { normalUtilization: wBar, capitalProductivity: kappa, depreciationRate: delta } = CAPITAL;
  const alphaK = CAPITAL.capitalGoodsLaborProductivity;
  const ratio = (delta * alpha) / (kappa * alphaK);
  const capitalWorkers = capitalFirms === 0 ? 0 : Math.round((employedCount * ratio) / (1 + ratio));
  const shuffled = popRng.shuffle([...households]);
  shuffled.slice(0, employedCount).forEach((hh, i) => {
    const firm = (i < capitalWorkers ? firms[consumptionFirms + (i % capitalFirms)] : firms[(i - capitalWorkers) % consumptionFirms]) as Firm;
    const productivity = firm.sector === 'capital' ? alphaK : alpha;
    hh.employerId = firm.id;
    firm.plannedOutput += productivity;
    firm.lastOutput += productivity;
  });
  // Bien de capital: mismo margen sobre su costo unitario que el de consumo.
  const pK0 = Math.round((w0 / alphaK) * init.markup);
  if (capitalFirms > 0) {
    for (const firm of firms) {
      if (firm.sector === 'capital') {
        firm.price = pK0;
        firm.lastUnitsSold = firm.lastOutput;
        firm.lastDemand = firm.lastOutput;
      } else {
        // Capital inicial a la utilización normal, valuado al precio inicial del capital.
        firm.capital = firm.lastOutput / (wBar * kappa);
        firm.capitalValue = Math.round(firm.capital * pK0);
        firm.utilizedCapitalAvg = firm.lastOutput / kappa;
      }
    }
  }

  const wageBill = w0 * employedCount;
  const transferEach = Math.floor(knobs.publicSpending / h);
  // R8 con la base de pleno empleo (sin dividendos todavía: no hubo un mes anterior).
  const fullEmploymentBase = w0 * h;
  const taxRate = clamp01(((1 - knobs.structuralDeficitShare) * knobs.publicSpending) / fullEmploymentBase);

  const state: SimState = {
    seed,
    tick: 0,
    elapsedTicks: 0,
    rng: createRngState(seed),
    knobs,
    households,
    firms,
    bank: { id: id++, kind: 'bank', positions: emptyPositions(), ownerId: 0, riskWindow: [] },
    treasury: { id: id++, kind: 'treasury', positions: emptyPositions() },
    centralBank: { id: id++, kind: 'centralBank', positions: emptyPositions() },
    fiscal: {
      taxRate,
      lastTaxBase: wageBill,
      lastDividends: 0,
      dividendsThisMonth: 0,
      taxBaseThisMonth: 0,
      taxesThisMonth: 0,
      spendingThisMonth: 0,
      advancesThisMonth: 0,
    },
    stats: {
      priceIndex: p0,
      inflation: 0,
      unemployment: 1 - employedCount / h,
      realWage: w0 / p0,
      poverty: 0,
      output: firms.reduce((acc, firm) => acc + (firm.sector === 'consumption' ? firm.lastOutput : 0), 0),
      emission: 0,
      effectiveEmissionShare: 0,
      capitalPriceIndex: pK0,
    },
    credit: emptyCreditStats(),
  };

  // Riqueza inicial: deuda pasada del Tesoro con el BCRA, girada a los privados.
  for (const hh of households) {
    const gross = hh.employerId === null ? 0 : w0;
    hh.incomeLastMonth = gross - Math.floor(gross * taxRate) + transferEach;
  }
  const incomeMonths = config.initial?.householdDepositIncomeMonths;
  const hhDeposits = households.map((hh) =>
    incomeMonths === undefined ? w0 * INITIAL.householdDepositMonths : Math.round(incomeMonths * hh.incomeLastMonth),
  );
  const firmDeposits = firms.map((firm) => Math.round((firm.plannedOutput / alpha) * w0 * init.firmDepositMonths));
  const total = hhDeposits.reduce((a, b) => a + b, 0) + firmDeposits.reduce((a, b) => a + b, 0);
  coverWithAdvances(state, total);
  households.forEach((hh, i) => {
    payFromTreasury(state, hh, hhDeposits[i]!);
    hh.depositsAtMonthStart = hhDeposits[i]!;
  });
  firms.forEach((firm, i) => payFromTreasury(state, firm, firmDeposits[i] as Cents));
  // Ventas del "mes anterior" para el límite de deuda de R9: lo que se habría
  // vendido al precio inicial (con las reglas de la Fase 0 no se usa).
  firms.forEach((firm) => {
    firm.lastRevenue = Math.round(firm.lastOutput * firm.price);
    firm.expectedSales = firm.lastRevenue;
  });

  // Patrimonio inicial del banco (R13): misma historia que el resto de la
  // riqueza inicial, deuda pasada del Tesoro con el BCRA. El Tesoro le da
  // reservas al banco sin un depósito del otro lado. Dueño: un hogar al azar.
  const bankEquity = Math.round(INITIAL.bankEquityShare * total);
  coverWithAdvances(state, bankEquity);
  payTreasuryToBank(state, bankEquity);
  state.bank.ownerId = popRng.nextInt(h);
  return state;
}

export function emptyCreditStats(): CreditStats {
  return {
    newLoans: 0,
    rationedByBank: 0,
    cappedByDebtLimit: 0,
    interestIncome: 0,
    interestCapitalized: 0,
    principalArrears: 0,
    centralBankInterest: 0,
    writeOffs: 0,
    bankDividends: 0,
    rationedByRisk: 0,
    rationedByRiskAmount: 0,
    riskEstimator: 'none',
    newLoanRate: 0,
    bankruptcies: 0,
    entries: 0,
    fireSales: 0,
    fireSalesPooled: 0,
    fireSaleProceeds: 0,
    capitalOrdered: 0,
    capitalBought: 0,
    capitalDemandRegistered: 0,
  };
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Todos los agentes, en orden de ID. */
export function allAgents(state: SimState): Agent[] {
  return [...state.households, ...state.firms, state.bank, state.treasury, state.centralBank];
}

/** Índice de una empresa en `state.firms` a partir de su ID. */
export function firmIndex(state: SimState, id: AgentId): number {
  return id - state.households.length;
}

/**
 * Copia profunda del estado. Escrita a mano (en vez de structuredClone) para no
 * depender de APIs del navegador o de Node y para que sea fácil portarla.
 */
export function cloneState(state: SimState): SimState {
  return {
    seed: state.seed,
    tick: state.tick,
    elapsedTicks: state.elapsedTicks,
    rng: [...state.rng],
    knobs: { ...state.knobs },
    households: state.households.map((hh) => ({ ...hh, positions: { ...hh.positions } })),
    firms: state.firms.map((firm) => ({
      ...firm,
      positions: { ...firm.positions },
      loanBook: firm.loanBook.map((loan) => ({ ...loan })),
    })),
    bank: {
      ...state.bank,
      positions: { ...state.bank.positions },
      riskWindow: state.bank.riskWindow.map((m) => ({ ...m, borrowers: [...m.borrowers], defaults: [...m.defaults] })),
    },
    treasury: { ...state.treasury, positions: { ...state.treasury.positions } },
    centralBank: { ...state.centralBank, positions: { ...state.centralBank.positions } },
    fiscal: { ...state.fiscal },
    stats: { ...state.stats },
    credit: { ...state.credit },
  };
}
