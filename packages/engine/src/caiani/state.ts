/**
 * Estado del port de Caiani (P2). Lo que no es un contrato del ledger: bienes reales, empleo,
 * rezagos, expectativas, proveedores previos, órdenes de las listas.
 *
 * Reglas de forma (ledger-contratos.md, sec. 2.2): objetos planos y serializables; ningún Map;
 * los objetos usados como diccionario tienen solo claves enteras. El orden de toda lista es el de
 * JMAB, porque las reglas lo usan.
 */

import type { AgentId, Ledger } from './ledger';
import type { Micro } from './money';
import type { InitialiserParams, StructureParams } from './params';

/** Ids de los valores rezagados (`modellone.StaticValues.LAG_*`). */
export const LAG = {
  INVENTORIES: 0,
  REALSALES: 1,
  PRODUCTION: 2,
  PROFITPRETAX: 3,
  PROFITAFTERTAX: 4,
  OPERATINGCASHFLOW: 5,
  NETWEALTH: 6,
  INCOME: 7,
  REMAININGCREDIT: 8,
  NONPERFORMINGLOANS: 9,
  EMPLOYED: 10,
  AGGUNEMPLOYMENT: 11,
  NOMINALSALES: 12,
  CONSUMPTION: 13,
  CAPACITY: 14,
  CAPITALFINANCIALVALUE: 15,
  NOMINALINVENTORIES: 16,
  BANKTOTLOANSUPPLY: 17,
  TAXES: 18,
  CAPITALAMORTIZATION: 19,
  DEPOSITINTEREST: 20,
  LOANINTEREST: 21,
  PRICE: 22,
} as const;

/** Ids de las expectativas (`modellone.StaticValues.EXPECTATIONS_*`). */
export const EXPECTATION = {
  NOMINALSALES: 0,
  WAGES: 1,
  CONSPRICE: 2,
  DEPOSITS: 3,
  REALSALES: 4,
} as const;

/**
 * Valores rezagados (`TreeMapPassedValues`): id del rezago → (período → valor). Son double: es la
 * memoria que leen las reglas, aunque el valor sea un monto.
 */
export type Lags = Record<number, Record<number, number>>;

/**
 * `SimpleAdaptiveExpectation`. `passed[j] = [observación, expectativa]`, con la fila 0 la más reciente.
 * expectativa = λ·passed[0][0] + (1 − λ)·passed[0][1] (`updateExpectation`).
 */
export interface AdaptiveExpectation {
  passed: [number, number][];
  expectation: number;
  lambda: number;
}

export type Expectations = Record<number, AdaptiveExpectation>;

/**
 * Bienes reales (`ConsumptionGood`, `CapitalGood`). No van en el ledger (no son pasivo de nadie);
 * su valor contable es un double, como en JMAB, hasta que P3 decida cómo se registran sus flujos
 * (ledger-contratos.md, sec. 2.2).
 */
export interface ConsumptionGoodStock {
  quantity: number;
  value: number;
  price: number;
  unitCost: number;
  age: number;
  producer: AgentId;
  duration: number;
}

export interface CapitalGoodStock {
  quantity: number;
  value: number;
  price: number;
  unitCost: number;
  age: number;
  producer: AgentId;
  productivity: number;
  duration: number;
  amortization: number;
  capitalLaborRatio: number;
  obsolete: boolean;
}

export interface HouseholdState {
  id: AgentId;
  /** Salario de reserva (`AbstractHousehold.wage`). */
  wage: number;
  employer: AgentId | null;
  /** Dividendos cobrados en el período (`Households.dividendsReceived`). */
  dividendsReceived: Micro;
  /** `CheapestGoodSupplierWithSwitching.previousGoodSupplier`. */
  previousSeller: AgentId;
  /** `MostPayingDepositWithSwitching.previousDepositSupplier`. */
  previousBank: AgentId;
  lags: Lags;
  expectations: Expectations;
}

export interface FirmState {
  id: AgentId;
  /** Orden de JMAB (`AbstractFirm.employees`); se mezcla al despedir y al pagar salarios. */
  employees: AgentId[];
  /** SM_CONSGOOD: inventario de la empresa de consumo. */
  consumptionGoods: ConsumptionGoodStock[];
  /** SM_CAPGOOD: inventario de la empresa de capital, o añadas de la empresa de consumo. */
  capitalGoods: CapitalGoodStock[];
  /** `MostPayingDepositWithSwitching.previousDepositSupplier`. */
  previousBank: AgentId;
  /** `CheapestLenderWithSwitching.previousLender`. */
  previousLender: AgentId | null;
  /** Solo empresas de consumo: `BestQualityPriceCapitalSupplierWithSwitching.previousSupplier`. */
  previousCapitalSupplier: AgentId | null;
  lags: Lags;
  expectations: Expectations;
}

export interface BankState {
  id: AgentId;
  lags: Lags;
  expectations: Expectations;
}

export interface GovernmentState {
  id: AgentId;
  employees: AgentId[];
}

/**
 * Listas propias de los mercados `SimpleMarketSimulation` (copias de las poblaciones hechas antes de
 * la inicialización y mezcladas por `RandomMarketInitialiser`). Los dos `BrochureMarket` (capital y
 * bonos) usan directamente las listas de las poblaciones: no tienen lista propia.
 */
export interface MarketLists {
  buyers: AgentId[];
  sellers: AgentId[];
}

export const SIMPLE_MARKETS = ['consumption', 'credit', 'labor', 'deposit', 'reservesBonds', 'reservesBasel'] as const;
export type SimpleMarket = (typeof SIMPLE_MARKETS)[number];

export interface CaianiState {
  init: InitialiserParams;
  structure: StructureParams;
  /** Ronda de JMAB (0 después de la inicialización). */
  round: number;
  ledger: Ledger;
  /**
   * Listas de las poblaciones en el orden de JMAB (lo cambian las mezclas de la inicialización).
   * Los índices de `households`, `consumptionFirms`, etc. son de creación, no de este orden.
   */
  populations: {
    capitalFirms: AgentId[];
    consumptionFirms: AgentId[];
    banks: AgentId[];
    households: AgentId[];
    centralBank: AgentId;
    government: AgentId;
  };
  markets: Record<SimpleMarket, MarketLists>;
  /** Por orden de creación. Los ids de cada población son consecutivos (`firstId`). */
  households: HouseholdState[];
  consumptionFirms: FirmState[];
  capitalFirms: FirmState[];
  banks: BankState[];
  government: GovernmentState;
  /** Rezagos agregados de la simulación (`MacroSimulation.passedValues`). */
  aggregateLags: Lags;
}

/**
 * `getValue()` de `ConsumptionGood` y `CapitalGood`: si el tenedor es el productor (inventario), el
 * bien vale a costo (costo unitario × cantidad); si no, su valor contable (`value`).
 */
export function goodValue(g: ConsumptionGoodStock | CapitalGoodStock, holder: AgentId): number {
  return holder === g.producer ? g.unitCost * g.quantity : g.value;
}

export function setLag(lags: Lags, id: number, period: number, value: number): void {
  const m = lags[id] ?? (lags[id] = {});
  m[period] = value;
}

/** `SimpleAdaptiveExpectation.updateExpectation`. */
export function updateExpectation(e: AdaptiveExpectation): void {
  const row = e.passed[0];
  if (!row) throw new Error('expectativa sin observaciones');
  e.expectation = e.lambda * row[0] + (1 - e.lambda) * row[1];
}
