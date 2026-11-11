/**
 * Estado de la simulación.
 *
 * Todo lo que hace falta para avanzar un tick vive acá, incluido el estado del
 * PRNG. Así `step(state, knobs)` es una función pura y el estado se puede
 * clonar, serializar y comparar.
 */

import { payFromTreasury, coverWithAdvances } from './flows';
import { emptyPositions, type Agent, type AgentId } from './ledger';
import { DEFAULT_KNOBS, type Knobs } from './knobs';
import type { Cents } from './money';
import { INITIAL, PARAMS } from './params';
import { Rng, createRngState, type RngState } from './rng';

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
}

export interface Bank extends Agent {
  kind: 'bank';
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
  const w0 = INITIAL.wage;
  const alpha = PARAMS.laborProductivity;
  const p0 = Math.round((w0 / alpha) * INITIAL.markup);

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
    });
  }

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
    });
  }

  // Empleo inicial repartido en partes iguales entre las empresas.
  const employedCount = Math.round(h * INITIAL.employmentRate);
  const shuffled = popRng.shuffle([...households]);
  shuffled.slice(0, employedCount).forEach((hh, i) => {
    const firm = firms[i % f] as Firm;
    hh.employerId = firm.id;
    firm.plannedOutput += alpha;
    firm.lastOutput += alpha;
  });

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
    bank: { id: id++, kind: 'bank', positions: emptyPositions() },
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
      output: alpha * employedCount,
      emission: 0,
      effectiveEmissionShare: 0,
    },
  };

  // Riqueza inicial: deuda pasada del Tesoro con el BCRA, girada a los privados.
  const hhDeposits = w0 * INITIAL.householdDepositMonths;
  const firmDeposits = firms.map((firm) => (firm.plannedOutput / alpha) * w0 * INITIAL.firmDepositMonths);
  const total = hhDeposits * h + firmDeposits.reduce((a, b) => a + b, 0);
  coverWithAdvances(state, total);
  for (const hh of households) {
    payFromTreasury(state, hh, hhDeposits);
    hh.depositsAtMonthStart = hhDeposits;
    const gross = hh.employerId === null ? 0 : w0;
    hh.incomeLastMonth = gross - Math.floor(gross * taxRate) + transferEach;
  }
  firms.forEach((firm, i) => payFromTreasury(state, firm, firmDeposits[i] as Cents));
  return state;
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
    firms: state.firms.map((firm) => ({ ...firm, positions: { ...firm.positions } })),
    bank: { ...state.bank, positions: { ...state.bank.positions } },
    treasury: { ...state.treasury, positions: { ...state.treasury.positions } },
    centralBank: { ...state.centralBank, positions: { ...state.centralBank.positions } },
    fiscal: { ...state.fiscal },
    stats: { ...state.stats },
  };
}
