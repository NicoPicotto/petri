/*
 * Petri — Copyright (C) 2026 Nicolas Picotto
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Traducción a TypeScript, MODIFICADA, de código de:
 *   JMAB / modelo Benchmark — Copyright (C) 2013 Alessandro Caiani and Antoine Godin
 *   (GNU GPL v3 o posterior). https://github.com/S120/jmab, https://github.com/S120/benchmark
 * Clases de origen: modellone.init.SFCSSMacroAgentInitialiser, jmab.init.RandomMarketInitialiser,
 *   jmab.simulations.AbstractMacroSimulation.begin / SimpleMarketSimulation.getPopulation
 *   (referencia: benchmarkModel.jar del paper; fuente equivalente en reference/jmab-2015).
 * Modificaciones: ver docs/inicializacion.md (cada diferencia con el original está documentada).
 */

/**
 * Inicialización del port de Caiani (P2, V1). Diseño y verificación en docs/inicializacion.md.
 *
 * Reproduce, en el mismo orden, lo que hace JMAB antes del primer tick:
 * 1. `AbstractMacroSimulation.setListeners`: cada `SimpleMarketSimulation` copia las listas de sus
 *    poblaciones (en orden de creación).
 * 2. `SFCSSMacroAgentInitialiser.initialise`: balances, empleo, rezagos y expectativas; en el medio,
 *    mezcla la lista de hogares.
 * 3. `RandomMarketInitialiser.initialise` de cada mercado, en el orden de modelFile.xml: mezcla los
 *    compradores y, por cada comprador, los vendedores. Solo cambia el orden de las listas.
 *
 * Los ids del port siguen el orden de creación de JMAB (empresas de consumo, de capital, bancos,
 * gobierno, hogares, BC): id de JMAB = id del port + una constante.
 */

import {
  addAgent,
  contractIds,
  contractOf,
  createLedger,
  netFinancialWorth,
  open,
  type AgentId,
  type Ledger,
} from './ledger';
import { beginPeriod } from './flows';
import { toMicro, toUnits } from './money';
import { INITIALISER, RULES, STRUCTURE, type InitialiserParams, type RuleParams, type StructureParams } from './params';
import type { CaianiRng } from './rng';
import {
  EXPECTATION,
  LAG,
  goodValue,
  newFlags,
  setLag,
  updateExpectation,
  type BankState,
  type CaianiState,
  type CapitalGoodStock,
  type ConsumptionGoodStock,
  type Expectations,
  type FirmState,
  type HouseholdState,
  type Lags,
  type MarketLists,
  type SimpleMarket,
} from './state';

export const SITE_INIT = 'SFCSSMacroAgentInitialiser.initialise';
export const SITE_MARKET_INIT = 'RandomMarketInitialiser.initialise';

export interface InitOptions {
  init?: InitialiserParams;
  structure?: StructureParams;
  rules?: RuleParams;
  /** Id de JMAB de un agente del port, para el `Rng` en modo oráculo. Por defecto, el mismo id. */
  jmabId?: (id: AgentId) => number;
}

/** División entera de Java entre enteros no negativos. */
function idiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/**
 * x^j con j entero ≥ 0, por multiplicaciones (principio 4: sin `Math.pow`). Puede diferir de
 * `Math.pow` de Java en unos ulp; los montos se redondean a µ igual (docs/inicializacion.md).
 */
export function powInt(x: number, j: number): number {
  let r = 1;
  for (let k = 0; k < j; k++) r *= x;
  return r;
}

/** Expectativa con `n` observaciones iguales a [obs, exp] y su valor recalculado (`computeExpectations`). */
function expectationFilled(n: number, lambda: number, obs: number, exp: number): Expectations[number] {
  const passed: [number, number][] = [];
  for (let j = 0; j < n; j++) passed.push([obs, exp]);
  const e = { passed, expectation: 0, lambda };
  updateExpectation(e);
  return e;
}

/** Valor de los bienes reales de una empresa, con `getValue()` de JMAB (suma en el orden de JMAB). */
function goodsValue(f: FirmState): number {
  let v = 0;
  for (const g of f.consumptionGoods) v += goodValue(g, f.id);
  for (const g of f.capitalGoods) v += goodValue(g, f.id);
  return v;
}

/** Suma de los depósitos que el banco debe (`getNumericBalanceSheet()[1][SM_DEP]`), en unidades. */
function depositLiabilities(ledger: Ledger, bank: AgentId): number {
  let s = 0;
  for (const id of contractIds(ledger, bank, 'liabilities', 'deposit')) s += contractOf(ledger, id).amount;
  return toUnits(s);
}

export function initialize(rng: CaianiRng, options: InitOptions = {}): CaianiState {
  const P = options.init ?? INITIALISER;
  const S = options.structure ?? STRUCTURE;
  const R = options.rules ?? RULES;
  const idOf = options.jmabId ?? ((id: AgentId) => id);
  if (P.uniformDistr !== 0) {
    // Con uniformDistr = 0, (1 + U(−0, 0)) vale exactamente 1 y no hace falta sortear.
    throw new Error('initialize: uniformDistr ≠ 0 no está portado (el escenario base usa 0)');
  }
  const L = S.loanLength;
  if (!Number.isInteger(L) || L <= 0) throw new Error(`initialize: loanLength inválido ${L}`);

  // --- Agentes, en el orden de creación de JMAB.
  const ledger = createLedger();
  const make = (n: number, sector: Parameters<typeof addAgent>[1]): AgentId[] => {
    const ids: AgentId[] = [];
    for (let i = 0; i < n; i++) ids.push(addAgent(ledger, sector));
    return ids;
  };
  const cIds = make(S.consumptionFirms, 'consumptionFirm');
  const kIds = make(S.capitalFirms, 'capitalFirm');
  const bIds = make(S.banks, 'bank');
  const gov = addAgent(ledger, 'government');
  const hIds = make(S.households, 'household');
  const cb = addAgent(ledger, 'centralBank');

  // --- 1. Copias de las listas de los mercados simples (antes de la inicialización: orden de creación).
  const markets: Record<SimpleMarket, MarketLists> = {
    consumption: { buyers: hIds.slice(), sellers: cIds.slice() },
    credit: { buyers: [...kIds, ...cIds], sellers: bIds.slice() },
    labor: { buyers: [...kIds, ...cIds, gov], sellers: hIds.slice() },
    deposit: { buyers: [...hIds, ...kIds, ...cIds], sellers: bIds.slice() },
    reservesBonds: { buyers: bIds.slice(), sellers: [cb] },
    reservesBasel: { buyers: bIds.slice(), sellers: [cb] },
  };

  // --- 2. SFCSSMacroAgentInitialiser.initialise
  const hhSize = S.households;
  const bSize = S.banks;
  const kSize = S.capitalFirms;
  const cSize = S.consumptionFirms;
  const hhPerBank = idiv(hhSize, bSize);
  const cFirmPerBank = idiv(cSize, bSize);
  const kFirmPerBank = idiv(kSize, bSize);
  const cFirmPerkFirm = idiv(cSize, kSize);
  const hhPercFirm = idiv(hhSize, cSize);
  const nObs = S.expectationPeriods;
  const lambda = S.expectationLambda;

  // Hogares
  const hhDep = P.hhsDep / hhSize;
  const hhCash = P.hhsCash / hhSize;
  const hhCons = P.csSales / (hhSize * P.cPrice);
  const households: HouseholdState[] = [];
  for (let i = 0; i < hhSize; i++) {
    const id = hIds[i] as AgentId;
    const bankIdx = idiv(i, hhPerBank);
    const bank = bIds[bankIdx] as AgentId;
    open(ledger, 'cash', id, cb, toMicro(hhCash), {}, 'deposits');
    open(ledger, 'deposit', id, bank, toMicro(hhDep), { rate: P.iDep }, 'deposits');
    const hh: HouseholdState = {
      ...newFlags(),
      id,
      wage: P.hhWage,
      employer: null,
      dividendsReceived: toMicro(P.dividendsReceived / hhSize),
      previousSeller: cIds[idiv(i, hhPercFirm)] as AgentId,
      previousBank: bank,
      interestReceived: 0,
      demand: 0,
      consumptionGoods: [],
      lags: {},
      expectations: {},
    };
    setLag(hh.lags, LAG.NETWEALTH, 0, toUnits(netFinancialWorth(ledger, id)));
    hh.expectations[EXPECTATION.CONSPRICE] = expectationFilled(nObs, lambda, P.cPrice, P.cPrice);
    setLag(hh.lags, LAG.EMPLOYED, 0, 0);
    setLag(hh.lags, LAG.CONSUMPTION, 0, hhCons * 1);
    households.push(hh);
  }
  const hhOf = (id: AgentId): HouseholdState => households[id - (hIds[0] as AgentId)] as HouseholdState;

  // households.getAgentList().shuffle(prng): reordena la lista de la población para toda la corrida.
  const hPop = rng.shuffle(SITE_INIT, 'initHouseholds', hIds.slice(), idOf);

  let hWorkerCounter = 0;
  /**
   * `hh.setEmployer(e)` + `e.addEmployee(hh)` (`SFCSSMacroAgentInitialiser` 214–216, 340–342, 496–498):
   * `addEmployee` también resta 1 a `laborDemand`, así que los empleadores arrancan con −(empleados). No
   * tiene efecto: el evento 12 (13 para el gobierno) lo pisa antes de leerlo.
   */
  const hire = (employer: { id: AgentId; employees: AgentId[]; laborDemand: number }): void => {
    const hh = hhOf(hPop[hWorkerCounter] as AgentId);
    hh.employer = employer.id;
    setLag(hh.lags, LAG.EMPLOYED, 0, 1);
    employer.laborDemand -= 1;
    employer.employees.push(hh.id);
    hWorkerCounter++;
  };

  /** Préstamos iniciales: uno por edad j + 1, rotando los bancos desde el del depósito. */
  const initialLoans = (firm: FirmState, bankIdx: number, perFirm: number): void => {
    let it = bankIdx;
    for (let j = 0; j <= L - 1; j++) {
      const loanBank = bIds[it] as AgentId;
      it++;
      if (it >= bSize) it = 0;
      // JMAB: value = loan·(1/(1+g)^j)·((L−j)/L), initialAmount = loan/(1+g)^j. En µ, el saldo se fija
      // como A − redondeo(A·j/L) para que las cuotas de ledger.installment lo cierren en cero.
      const A = toMicro(perFirm / powInt(1 + P.gr, j));
      const balance = A - Math.round((A * j) / L);
      open(
        ledger,
        'loan',
        loanBank,
        firm.id,
        balance,
        { rate: P.iLoans, age: j + 1, length: L, amortization: 'fixedCapital', initialAmount: A },
        'loans',
      );
      // Como JMAB: el prestamista previo es el banco del depósito (`bank`), no `loanBank`.
      if (j === 1) firm.previousLender = bIds[bankIdx] as AgentId;
    }
  };

  const newFirm = (id: AgentId): FirmState => ({
    ...newFlags(),
    id,
    desiredOutput: 0,
    bailoutCost: 0,
    markUp: 0,
    expectedVariableCosts: 0,
    employees: [],
    consumptionGoods: [],
    capitalGoods: [],
    previousBank: -1,
    previousLender: null,
    previousCapitalSupplier: null,
    selectedCapitalSuppliers: null,
    amountResearch: 0,
    capitalProductivity: 0,
    desiredCapacityGrowth: 0,
    desiredRealCapitalDemand: 0,
    interestReceived: 0,
    debtBurden: 0,
    debtInterests: 0,
    creditDemanded: 0,
    laborDemand: 0,
    lags: {},
    expectations: {},
  });

  // Empresas de capital
  const kInv = idiv(P.ksInv, kSize);
  const kDep = P.ksDep / kSize;
  const kLoan = P.ksLoans0 / kSize;
  const kEmpl = idiv(P.ksEmpl, kSize);
  const kProfit = P.ksProfits / kSize;
  const kSales = P.ksSales / kSize;
  const kOutput = kSales / P.kPrice;
  const kOCF = P.ksOCF / kSize;
  const capitalFirms: FirmState[] = [];
  for (let i = 0; i < kSize; i++) {
    const k = newFirm(kIds[i] as AgentId);
    k.markUp = R.initialMarkUpCapital;
    k.capitalProductivity = S.capitalProductivity; // propiedad del prototipo de la empresa de capital
    const inv: CapitalGoodStock = {
      quantity: kInv,
      value: kInv * P.kPrice,
      price: P.kPrice,
      unitCost: P.kUnitCost,
      age: -1, // el constructor de CapitalGood pone −1 y el inicializador no la cambia
      producer: k.id,
      productivity: S.capitalProductivity,
      duration: S.capitalDuration,
      amortization: S.capitalAmortization,
      capitalLaborRatio: S.capitalLaborRatio,
      obsolete: false,
    };
    k.capitalGoods.push(inv);
    for (let j = 0; j < kEmpl; j++) hire(k);
    const bankIdx = idiv(i, kFirmPerBank);
    open(ledger, 'deposit', k.id, bIds[bankIdx] as AgentId, toMicro(kDep), { rate: P.iDep }, 'deposits');
    k.previousBank = bIds[bankIdx] as AgentId;
    open(ledger, 'cash', k.id, cb, 0, {}, 'deposits');
    initialLoans(k, bankIdx, kLoan);
    const lagKInv = kInv;
    setLag(k.lags, LAG.PROFITPRETAX, 0, kProfit * 1);
    setLag(k.lags, LAG.PROFITAFTERTAX, 0, kProfit * 1);
    setLag(k.lags, LAG.INVENTORIES, 0, lagKInv);
    setLag(k.lags, LAG.PRODUCTION, 0, kOutput * 1);
    setLag(k.lags, LAG.REALSALES, 0, kOutput * 1);
    setLag(k.lags, LAG.PRICE, 0, P.kPrice);
    setLag(k.lags, LAG.NOMINALSALES, 0, kSales * 1);
    setLag(k.lags, LAG.NETWEALTH, 0, (toUnits(netFinancialWorth(ledger, k.id)) + goodsValue(k)) * 1);
    setLag(k.lags, LAG.NOMINALINVENTORIES, 0, lagKInv * P.kUnitCost);
    setLag(k.lags, LAG.OPERATINGCASHFLOW, 0, kOCF);
    k.expectations[EXPECTATION.WAGES] = expectationFilled(nObs, lambda, P.hhWage * 1, P.hhWage * 1);
    k.expectations[EXPECTATION.NOMINALSALES] = expectationFilled(nObs, lambda, kSales * 1, kSales * 1);
    k.expectations[EXPECTATION.REALSALES] = expectationFilled(nObs, lambda, kOutput * 1, kOutput * 1);
    capitalFirms.push(k);
  }

  // Empresas de consumo
  const cInv = idiv(P.csInv, cSize);
  const cDep = P.csDep / cSize;
  const cLoan = P.csLoans0 / cSize;
  const cEmpl = idiv(P.csEmpl, cSize);
  const cProfit = P.csProfits / cSize;
  const cSales = P.csSales / cSize;
  const cOutput = cSales / P.cPrice;
  const cOCF = P.csOCF / cSize;
  const consumptionFirms: FirmState[] = [];
  for (let i = 0; i < cSize; i++) {
    const c = newFirm(cIds[i] as AgentId);
    c.markUp = R.initialMarkUpConsumption;
    const inv: ConsumptionGoodStock = {
      quantity: cInv,
      value: cInv * P.cPrice,
      price: P.cPrice,
      unitCost: P.cUnitCost,
      age: -1,
      producer: c.id,
      duration: 0,
    };
    c.consumptionGoods.push(inv);
    // Añadas de capital: una por edad j, del proveedor de capital i / (empresas de consumo por empresa de capital).
    const kFirm = kIds[idiv(i, cFirmPerkFirm)] as AgentId;
    const kMat = S.capitalDuration;
    const kAm = S.capitalAmortization;
    const cCap = idiv(P.csKap, cSize); // int / int en Java
    const cCapPerPeriod = cCap / kMat;
    let capitalValue = 0;
    for (let j = 0; j < kMat; j++) {
      const pw = powInt(1 + P.gr, j);
      const g: CapitalGoodStock = {
        quantity: cCapPerPeriod,
        value: (P.kPrice * cCapPerPeriod * (1 - j / kAm)) / pw,
        price: P.kPrice / pw,
        unitCost: P.kUnitCost,
        age: j,
        producer: kFirm,
        productivity: S.capitalProductivity,
        duration: kMat,
        amortization: Math.trunc(kAm),
        capitalLaborRatio: S.capitalLaborRatio,
        obsolete: false,
      };
      capitalValue += g.value;
      c.capitalGoods.push(g);
    }
    c.previousCapitalSupplier = kFirm;
    for (let j = 0; j < cEmpl; j++) hire(c);
    const bankIdx = idiv(i, cFirmPerBank);
    open(ledger, 'deposit', c.id, bIds[bankIdx] as AgentId, toMicro(cDep), { rate: P.iDep }, 'deposits');
    c.previousBank = bIds[bankIdx] as AgentId;
    open(ledger, 'cash', c.id, cb, 0, {}, 'deposits');
    initialLoans(c, bankIdx, cLoan);
    const lagCInv = cInv;
    setLag(c.lags, LAG.PROFITPRETAX, 0, cProfit * 1);
    setLag(c.lags, LAG.PROFITAFTERTAX, 0, cProfit * 1);
    setLag(c.lags, LAG.INVENTORIES, 0, lagCInv);
    setLag(c.lags, LAG.PRODUCTION, 0, cOutput * 1);
    setLag(c.lags, LAG.REALSALES, 0, cOutput * 1);
    setLag(c.lags, LAG.PRICE, 0, P.cPrice);
    setLag(c.lags, LAG.CAPACITY, 0, cCap * S.capitalProductivity * 1);
    setLag(c.lags, LAG.CAPITALFINANCIALVALUE, 0, capitalValue);
    setLag(c.lags, LAG.NOMINALSALES, 0, cOutput * P.cPrice * 1);
    setLag(c.lags, LAG.NETWEALTH, 0, (toUnits(netFinancialWorth(ledger, c.id)) + goodsValue(c)) * 1);
    setLag(c.lags, LAG.NOMINALINVENTORIES, 0, lagCInv * P.cUnitCost);
    setLag(c.lags, LAG.OPERATINGCASHFLOW, 0, cOCF);
    c.expectations[EXPECTATION.WAGES] = expectationFilled(nObs, lambda, P.hhWage * 1, P.hhWage * 1);
    c.expectations[EXPECTATION.NOMINALSALES] = expectationFilled(nObs, lambda, cSales * 1, cSales * 1);
    c.expectations[EXPECTATION.REALSALES] = expectationFilled(nObs, lambda, cOutput * 1, cOutput * 1);
    consumptionFirms.push(c);
  }
  // `lMat` queda con el plazo de la última empresa de consumo (lo usa el rezago de oferta de crédito).
  const lMat = L;

  // Bancos
  const bCash = P.bsCash / bSize;
  const bRes = P.bsRes / bSize;
  const bondMat = S.bondMaturity;
  const bBond = P.bsBonds / bSize;
  const bondPrice = Math.trunc(S.bondPrice); // (int) govt.getBondPrice()
  // (int) bBond / (bondMat·bondPrice): se trunca el monto antes de dividir. Los bonos son enteros.
  const nbBondsPerPeriod = idiv(Math.trunc(bBond), bondMat * bondPrice);
  const bProfit = P.bsProfits / bSize;
  const bAdv = P.bsAdv / bSize;
  const banks: BankState[] = [];
  for (let i = 0; i < bSize; i++) {
    const b: BankState = {
      ...newFlags(),
      id: bIds[i] as AgentId,
      lags: {},
      expectations: {},
      liquidityRatio: 0,
      capitalRatio: 0,
      bailoutCost: 0,
      currentNonPerformingLoans: 0,
      bankInterestRate: R.initialBankInterestRate, // propiedad del prototipo (XML 2288)
      totalLoanSupply: 0, // valor por defecto del campo en Java
      depositInterestRate: R.initialDepositInterestRate, // propiedad del prototipo (XML 2299)
      totInterestsDeposits: 0,
      bondInterestRate: R.initialBankBondInterestRate, // propiedad del prototipo (XML 2298)
    };
    open(ledger, 'cash', b.id, cb, toMicro(bCash), {}, 'deposits');
    open(ledger, 'reserves', b.id, cb, toMicro(bRes), { rate: 0 }, 'deposits');
    for (let j = 1; j <= bondMat; j++) {
      open(
        ledger,
        'bond',
        b.id,
        gov,
        toMicro(nbBondsPerPeriod * bondPrice),
        { quantity: nbBondsPerPeriod, price: bondPrice, maturity: S.bondMaturity, rate: P.iBonds, age: j },
        'bonds',
      );
    }
    const aMat = S.advancesLength;
    const aValue = bAdv / aMat;
    for (let j = 1; j <= aMat; j++) {
      open(
        ledger,
        'advance',
        cb,
        b.id,
        toMicro(aValue),
        { rate: P.iAdv, age: j, length: aMat, amortization: 'onlyInterest', initialAmount: toMicro(aValue) },
        'advances',
      );
    }
    setLag(b.lags, LAG.PROFITPRETAX, 0, bProfit * 1);
    setLag(b.lags, LAG.PROFITAFTERTAX, 0, bProfit * 1);
    setLag(b.lags, LAG.NONPERFORMINGLOANS, 0, 0);
    setLag(b.lags, LAG.REMAININGCREDIT, 0, 0);
    setLag(b.lags, LAG.NETWEALTH, 0, toUnits(netFinancialWorth(ledger, b.id)) * 1);
    setLag(b.lags, LAG.BANKTOTLOANSUPPLY, 0, ((((P.csLoans + P.ksLoans) / bSize) * 2) / (lMat + 1)) * 1);
    setLag(b.lags, LAG.DEPOSITINTEREST, 0, P.iDep);
    setLag(b.lags, LAG.LOANINTEREST, 0, P.iLoans);
    const dep = depositLiabilities(ledger, b.id) * (1 + 0.05 * 0);
    b.expectations[EXPECTATION.DEPOSITS] = expectationFilled(nObs, lambda, dep, dep);
    banks.push(b);
  }

  // Gobierno
  const government = { ...newFlags(), id: gov, employees: [] as AgentId[], laborDemand: 0, wageBill: 0, doleExpenditure: 0 };
  for (let i = 0; i < P.gEmpl; i++) hire(government);
  open(ledger, 'reserves', gov, cb, 0, { rate: 0 }, 'deposits');

  // Banco central
  const nbBondsPerPeriod1 = idiv(Math.trunc(P.cbBonds), bondMat * bondPrice);
  for (let j = 1; j <= bondMat; j++) {
    open(
      ledger,
      'bond',
      cb,
      gov,
      toMicro(nbBondsPerPeriod1 * bondPrice),
      { quantity: nbBondsPerPeriod1, price: bondPrice, maturity: S.bondMaturity, rate: P.iBonds, age: j },
      'bonds',
    );
  }
  const aggregateLags: Lags = {};
  setLag(aggregateLags, LAG.AGGUNEMPLOYMENT, 0, 0.08 * 1);

  // --- 3. RandomMarketInitialiser de cada mercado, en el orden de modelFile.xml. Los mercados de
  // capital y de bonos (BrochureMarket) mezclan las listas de las poblaciones.
  const populations = {
    capitalFirms: kIds.slice(),
    consumptionFirms: cIds.slice(),
    banks: bIds.slice(),
    households: hPop,
    centralBank: cb,
    government: gov,
  };
  const govList = [gov];
  const marketOrder: MarketLists[] = [
    { buyers: populations.consumptionFirms, sellers: populations.capitalFirms },
    markets.consumption,
    markets.credit,
    markets.labor,
    markets.deposit,
    { buyers: populations.banks, sellers: govList },
    markets.reservesBonds,
    markets.reservesBasel,
  ];
  for (const m of marketOrder) {
    rng.shuffle(SITE_MARKET_INIT, 'buyers', m.buyers, idOf);
    for (let n = 0; n < m.buyers.length; n++) rng.shuffle(SITE_MARKET_INIT, 'sellers', m.sellers, idOf);
  }

  // La inicialización no es un flujo: se abre el primer período con los saldos iniciales.
  beginPeriod(ledger);

  return {
    init: P,
    structure: S,
    rules: R,
    round: 0,
    ledger,
    populations,
    markets,
    households,
    consumptionFirms,
    capitalFirms,
    banks,
    government,
    centralBank: { ...newFlags(), id: cb, interestsOnAdvances: 0, interestsOnBonds: 0 },
    aggregateLags,
  };
}
