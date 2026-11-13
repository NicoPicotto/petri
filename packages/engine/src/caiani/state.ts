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
import type { InitialiserParams, RuleParams, StructureParams } from './params';

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

/** Ids de los mercados (`modellone.StaticValues.MKT_*`): índices de `active`. */
export const MKT = {
  CAPGOOD: 0,
  CONSGOOD: 1,
  CREDIT: 2,
  DEPOSIT: 3,
  LABOR: 4,
  BONDS: 5,
  ADVANCES: 6,
} as const;
export const MARKET_COUNT = 7;

/** Observaciones que guarda cada rezago (`TreeMapPassedValues.nbLags`; 4 en todo el XML). */
export const LAG_DEPTH = 4;

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

/** Lo que comparten todos los agentes (`SimpleAbstractAgent`). */
export interface AgentFlags {
  /** `activeAgent[MKT_*]`: si participa del mercado en este tick. */
  active: boolean[];
  /** `SimpleAbstractAgent.defaulted`. */
  defaulted: boolean;
}

export interface HouseholdState extends AgentFlags {
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
  /** `Households.interestsReceived`: interés del depósito del tick (evento 8; se asigna, no se suma). */
  interestReceived: Micro;
  /**
   * `Households.demand`: demanda real de consumo del tick (evento 17); el mercado de consumo (evento 18) le
   * resta lo que compra.
   */
  demand: number;
  /**
   * SM_CONSGOOD del hogar: los bienes de consumo que compró en el tick (evento 18, uno por compra), en el orden
   * de JMAB. Su valor es lo que pagó, en unidades de Caiani (`double`, como JMAB; ledger-contratos.md, sec. 2.2).
   */
  consumptionGoods: ConsumptionGoodStock[];
  lags: Lags;
  expectations: Expectations;
}

export interface FirmState extends AgentFlags {
  id: AgentId;
  /** `AbstractFirm.desiredOutput` (unidades reales). */
  desiredOutput: number;
  /** `AbstractFirm.bailoutCost`: costo del rescate en el tick (lo pagan los hogares a los bancos). */
  bailoutCost: Micro;
  /** Margen de `AdaptiveMarkUpOnAC` (estado de la estrategia de precios). */
  markUp: number;
  /** `expectedVariableCosts`: costo variable unitario esperado (el piso del precio). */
  expectedVariableCosts: number;
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
  /**
   * Solo empresas de consumo: `ConsumptionFirm.selectedCapitalGoodSuppliers`, los vendedores que le
   * tocó ver en la primera etapa del mercado de capital (evento 3), en el orden de JMAB. `null` hasta
   * la primera vez. Si en un tick no le toca ninguno, conserva la lista anterior (como JMAB).
   */
  selectedCapitalSuppliers: AgentId[] | null;
  /**
   * Solo empresas de capital: `CapitalFirm.amountResearch`, gasto en I+D del tick (evento 4). Con
   * `researchShare` = 0 es siempre 0, pero JMAB lo usa en la demanda de trabajo y en el pedido de crédito.
   */
  amountResearch: number;
  /**
   * Solo empresas de capital: `CapitalFirm.capitalProductivity`, productividad de las máquinas que produce.
   * El evento 16 (resultado de la I+D) le suma la ganancia y la copia al inventario; sin I+D no cambia (1).
   */
  capitalProductivity: number;
  /**
   * Solo empresas de consumo: `ConsumptionFirm.desiredCapacityGrowth`. Lo calcula la segunda etapa del
   * mercado de capital (evento 19); el evento 5 usa el valor del tick anterior.
   */
  desiredCapacityGrowth: number;
  /** Solo empresas de consumo: `ConsumptionFirm.desiredRealCapitalDemand` (unidades de capital, entero). */
  desiredRealCapitalDemand: number;
  /** `ConsumptionFirm.interestReceived` / `CapitalFirm.interestReceived`: interés del depósito del tick (evento 8). */
  interestReceived: Micro;
  /**
   * `debtBurden` / `debtInterests` (`computeDebtPayments`, evento 9): cuotas (interés + capital) e
   * intereses de los préstamos de la empresa en el tick, con `installment` del ledger. JMAB los vuelve a
   * calcular en el evento 20 antes de pagar; la matriz `debtPayments` es de trabajo y no se porta.
   */
  debtBurden: Micro;
  debtInterests: Micro;
  /** `creditDemanded` (evento 9, `PeckingOrderTheory`): crédito pedido en el tick; lo baja el mercado de crédito. */
  creditDemanded: Micro;
  /** `AbstractFirm.laborDemand` (evento 12): puestos que faltan cubrir; cada contratación del evento 14 le resta 1. */
  laborDemand: number;
  lags: Lags;
  expectations: Expectations;
}

export interface BankState extends AgentFlags {
  id: AgentId;
  lags: Lags;
  expectations: Expectations;
  /** `Bank.liquidityRatio` = reservas / depósitos. */
  liquidityRatio: number;
  /** `Bank.capitalRatio` = patrimonio del tick anterior / préstamos. */
  capitalRatio: number;
  bailoutCost: Micro;
  /** `AbstractBank.currentNonPerformingLoans` del tick. */
  currentNonPerformingLoans: Micro;
  /** `Bank.bankInterestRate`: tasa genérica de los préstamos (evento 6). */
  bankInterestRate: number;
  /**
   * `Bank.totalLoanSupply`: crédito que el banco está dispuesto a dar en el tick (evento 6). En unidades
   * de Caiani y en double, no en µ: con `InfiniteSupplyCreditStrategy` (el base) vale +∞.
   */
  totalLoanSupply: number;
  /** `Bank.depositInterestRate`: tasa que ofrece a los depósitos nuevos (evento 7). */
  depositInterestRate: number;
  /** `Bank.totInterestsDeposits`: intereses pagados a los depósitos en el tick (evento 8). */
  totInterestsDeposits: Micro;
  /**
   * `Bank.bondInterestRate`: tasa de los bonos que vio en el mercado de bonos (primera etapa, eventos 29–37).
   * Es el piso de la tasa de los préstamos (`Bank.getInterestRate`, evento 10).
   */
  bondInterestRate: number;
}

export interface GovernmentState extends AgentFlags {
  id: AgentId;
  /** Orden de JMAB (`Government.employees`); se mezcla al despedir y al pagar salarios. */
  employees: AgentId[];
  /** `Government.laborDemand` (evento 13): puestos públicos que faltan cubrir (evento 14). */
  laborDemand: number;
}

export interface CentralBankState extends AgentFlags {
  id: AgentId;
  /** `CentralBank.interestsOnAdvances` / `interestsOnBonds`: ganancias del BC del tick (van al gobierno). */
  interestsOnAdvances: Micro;
  interestsOnBonds: Micro;
}

export function newFlags(): AgentFlags {
  return { active: new Array<boolean>(MARKET_COUNT).fill(false), defaulted: false };
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
  rules: RuleParams;
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
  centralBank: CentralBankState;
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

/**
 * `TreeMapPassedValues.addObservation`: guarda el valor del período; si ya había `LAG_DEPTH`
 * observaciones, antes saca la más vieja (aunque el período nuevo ya estuviera: así lo hace JMAB).
 */
export function setLag(lags: Lags, id: number, period: number, value: number): void {
  const m = lags[id] ?? (lags[id] = {});
  const periods = Object.keys(m);
  if (periods.length === LAG_DEPTH) {
    let first = Infinity;
    for (const k of periods) first = Math.min(first, Number(k));
    delete m[first];
  }
  m[period] = value;
}

/**
 * `SimpleAbstractAgent.getPassedValue(id, lag)`: la observación del período max(0, ronda − rezago).
 * Si no está, JMAB tira una excepción (desboxeo de null); acá también.
 */
export function getLag(lags: Lags, id: number, round: number, lag: number): number {
  const period = Math.max(0, round - lag);
  const v = lags[id]?.[period];
  if (v === undefined) throw new Error(`rezago ${id}: no hay observación del período ${period} (ronda ${round}, rezago ${lag})`);
  return v;
}

/** `SimpleAdaptiveExpectation.updateExpectation`. */
export function updateExpectation(e: AdaptiveExpectation): void {
  const row = e.passed[0];
  if (!row) throw new Error('expectativa sin observaciones');
  e.expectation = e.lambda * row[0] + (1 - e.lambda) * row[1];
}
