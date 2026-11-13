/**
 * Parámetros del escenario base de Caiani et al. (2016) que usa la inicialización (P2).
 *
 * Fuente: `reference/paper-launcher/Model/modelFile.xml` (el del `.jar` del paper, referencia
 * canónica; plan-port-caiani.md, sec. 0). Se cita la línea de cada valor. Los nombres son los de las
 * propiedades del XML. Los parámetros de comportamiento de cada regla entran en P3, con su regla.
 */

/** Bean `macroAgentInitialiser` (`modellone.init.SFCSSMacroAgentInitialiser`), líneas 1381–1420. */
export interface InitialiserParams {
  /** Amplitud de la perturbación U(−u, u) de rezagos y expectativas. 0 en el base: no perturba. */
  uniformDistr: number;
  // Stocks (agregados por sector).
  hhsDep: number;
  /** No está en el XML: queda en 0,0, el valor por defecto de Java. Nadie arranca con efectivo. */
  hhsCash: number;
  ksDep: number;
  /** Entero en Java (`int`): se reparte con división entera. */
  ksInv: number;
  ksLoans: number;
  ksLoans0: number;
  csDep: number;
  csInv: number;
  csLoans: number;
  csLoans0: number;
  /** Entero en Java. */
  csKap: number;
  bsBonds: number;
  bsRes: number;
  bsAdv: number;
  bsCash: number;
  cbBonds: number;
  // Flujos.
  dividendsReceived: number;
  hhWage: number;
  ksEmpl: number;
  ksSales: number;
  ksProfits: number;
  kPrice: number;
  kUnitCost: number;
  ksOCF: number;
  csEmpl: number;
  csSales: number;
  csProfits: number;
  cPrice: number;
  cUnitCost: number;
  csOCF: number;
  iLoans: number;
  iDep: number;
  bsProfits: number;
  /** No está en el XML: 0, el valor por defecto de Java. El gobierno arranca sin empleados. */
  gEmpl: number;
  iBonds: number;
  iAdv: number;
  /** Crecimiento con que se "envejecen" hacia atrás los préstamos y las añadas de capital. */
  gr: number;
}

export const INITIALISER: Readonly<InitialiserParams> = {
  uniformDistr: 0.0, // 1382
  hhsDep: 80704.13311, // 1385
  hhsCash: 0,
  dividendsReceived: 2376.600118, // 1386
  ksDep: 5000, // 1387
  ksInv: 200, // 1388
  ksLoans: 1298.02106, // 1389
  ksLoans0: 129.5283557, // 1390
  csDep: 25000, // 1391
  csInv: 3200, // 1392
  csLoans: 52194.42973, // 1393
  csLoans0: 5208.435263, // 1394
  csKap: 40000, // 1395
  bsBonds: 38273.5462, // 1396
  bsRes: 28564.58248, // 1397
  bsAdv: 0, // 1398
  bsCash: 0, // 1399
  cbBonds: 28564.58248, // 1400
  hhWage: 5, // 1401
  ksEmpl: 1000, // 1402
  ksSales: 5375, // 1403
  ksProfits: 312.8024025, // 1404
  kPrice: 2.6875, // 1405
  kUnitCost: 2.5, // 1406
  csEmpl: 5000, // 1407
  csSales: 32971.43332, // 1408
  csProfits: 2208.429577, // 1409
  cPrice: 1.030357291, // 1410
  cUnitCost: 0.936688447, // 1411
  iLoans: 0.0075, // 1412
  iDep: 0.0025, // 1413
  bsProfits: 179.1522275, // 1414
  gEmpl: 0,
  iBonds: 0.0025, // 1415
  iAdv: 0.0025, // 1416
  ksOCF: 189.2146501, // 1417
  csOCF: 2340.255574, // 1418
  gr: 0.0075, // 1419
};

/** Parámetros estructurales de los agentes que usa la inicialización. */
export interface StructureParams {
  households: number; // 2631
  consumptionFirms: number; // 1909
  capitalFirms: number; // 1446
  banks: number; // 2201
  /** Préstamos de las empresas: plazo (20 trimestres) y amortización 0 = FIXED_CAPITAL. */
  loanLength: number; // 1541 (capital), 2010 (consumo)
  // Bienes de capital (los define la empresa de capital que los produce).
  capitalDuration: number; // 1544
  capitalAmortization: number; // 1543
  capitalProductivity: number; // 1545
  capitalLaborRatio: number; // 1547
  /** Adelantos del BC: plazo 1, amortización 2 = ONLY_INTERESTS. */
  advancesLength: number; // 2294
  bondMaturity: number; // 2867
  bondPrice: number; // 2869
  /** Expectativas adaptativas (`SimpleAdaptiveExpectation`): observaciones y λ. */
  expectationPeriods: number; // 1555, 1578, 1601, 2304, 2706
  expectationLambda: number; // 1557, 1580, 1603, 2306, 2708
}

export const STRUCTURE: Readonly<StructureParams> = {
  households: 8000,
  consumptionFirms: 100,
  capitalFirms: 20,
  banks: 10,
  loanLength: 20,
  capitalDuration: 20,
  capitalAmortization: 20,
  capitalProductivity: 1,
  capitalLaborRatio: 6.4,
  advancesLength: 1,
  bondMaturity: 1,
  bondPrice: 1.0,
  expectationPeriods: 4,
  expectationLambda: 0.25,
};

/**
 * Parámetros de comportamiento (P3), agregados regla por regla en el orden del tick. Cada uno con su
 * línea de modelFile.xml.
 */
export interface RuleParams {
  /** `TargetExpectedInventoriesOutputStrategy.inventoryShare`: inventario objetivo / ventas esperadas. */
  inventoryShareCapital: number; // 1800
  inventoryShareConsumption: number; // 2094
  /** `CentralBank.advancesInterestRate`: tasa con que el BC calcula su ganancia por adelantos. */
  centralBankAdvancesRate: number; // 2966
  /** `AdaptiveMarkUpOnAC` (precios, eventos 1 y 2): umbral de inventario / ventas, paso y margen inicial. */
  markUpThreshold: number; // 1868 (capital), 2165 (consumo)
  markUpAdaptive: number; // 1866, 2163
  /** Desvío de la normal plegada `foldedNormal1` (media 0). */
  markUpSigma: number; // 2982
  initialMarkUpCapital: number; // 1869
  initialMarkUpConsumption: number; // 2166
  /** `CapitalFirm.laborProductivity`: bienes de capital por trabajador. */
  capitalLaborProductivity: number; // 1546
  /** `BrochureSelectionRandomRobinBuyerMixer.nbSellers`: vendedores de capital que ve cada comprador (evento 3). */
  capitalMarketSellers: number; // 255
  /** `RandDInvestmentSharePastSales.researchShare`: I+D / ventas nominales pasadas (apagada en el base). */
  researchShare: number; // 1821
  /**
   * `SwitchingStrategySimple` del proveedor de capital (`switchingStrategy4`): λ = −ln(0,5) / thresholdMean,
   * con thresholdMean = 0,20 (XML 1791) y `payOrReceive` = true (1794).
   */
  capitalSwitchingLambda: number;
  capitalSwitchingPayOrReceive: boolean; // 1794
  /** `Bank.bankInterestRate` inicial (propiedad del prototipo del banco). */
  initialBankInterestRate: number; // 2288
  /**
   * `CopyOfAdaptiveInterestRateAverageThreshold` de la tasa de préstamos (`banksBankSpecificLoanInterestStrategy`,
   * evento 6): paso adaptivo, sentido (`increase` = false: con ratio de capital por encima del promedio la
   * tasa baja) y desvío de la normal plegada (`foldedNormal1`, 2982). El `threshold` del XML (2447) no se
   * usa: la estrategia lo pisa con el promedio de los bancos antes de leerlo.
   */
  loanRateAdaptive: number; // 2446
  loanRateIncrease: boolean; // 2444
  loanRateSigma: number; // 2982
  /** `Bank.depositInterestRate` inicial (propiedad del prototipo del banco). */
  initialDepositInterestRate: number; // 2299
  /** `Bank.advancesInterestRate`: techo de la tasa de depósitos (`getInterestRateUpperBound(MKT_DEPOSIT)`). */
  bankAdvancesInterestRate: number; // 2297
  /**
   * `CopyOfAdaptiveInterestRateAverageThreshold` de la tasa de depósitos (`banksDepInterestStrategy`, evento
   * 7): paso, sentido y desvío de `foldedNormal2` (2986–2990). El `threshold` del XML (2519) no se usa.
   */
  depositRateAdaptive: number; // 2518
  depositRateIncrease: boolean; // 2516
  depositRateSigma: number; // 2988
  /** `ProfitsWealthTaxStrategy.profitTaxRate` de las empresas (`profitTaxVal`, XML 1880): la usa el evento 9 para los impuestos esperados. */
  profitTaxRate: number; // 1880
  /**
   * `FixedShareOfProfitsToPopulationAsShareOfWealthDividends.profitShare` de las empresas de capital (1895) y de
   * consumo (2185): dividendos / ganancia después de impuestos. Lo usa el evento 9 para los dividendos esperados.
   */
  firmProfitShareCapital: number; // 1895
  firmProfitShareConsumption: number; // 2185
  /**
   * `shareOfExpIncomeAsDeposit` de las empresas de capital (1548) y de consumo (2013): colchón de liquidez
   * deseado, en masas salariales esperadas (evento 9).
   */
  shareOfExpIncomeAsDepositCapital: number; // 1548
  shareOfExpIncomeAsDepositConsumption: number; // 2013
  /** `AbstractFirm.loanLength` / `loanAmortizationType` (capital 1541–1542, consumo 2010–2011): 20 trimestres, capital fijo (0). */
  firmLoanLength: number; // 1541, 2010
  /** `SelectionRandomRobinBuyerMixer.nbSellers` del mercado de crédito: bancos que ve cada empresa (evento 10). */
  creditMarketSellers: number; // 333
  /**
   * `SwitchingStrategySimple` del prestamista (`switchingStrategy1`): λ = −ln(0,5) / thresholdMean, con
   * thresholdMean = 0,15 (1767) y `payOrReceive` = true (1769).
   */
  lenderSwitchingLambda: number;
  lenderSwitchingPayOrReceive: boolean; // 1769
  /** `Bank.riskAversionC` / `riskAversionK`: aversión al riesgo con empresas de consumo y de capital (`DeterministicLogisticCashFlowComputer`). */
  riskAversionC: number; // 2286
  riskAversionK: number; // 2287
  /** `ExpectedReturnCreditSupply.haircut` (`haircutVal`): parte del valor del capital que se recupera en una quiebra. */
  creditSupplyHaircut: number; // 1889
  /** `Bank.bondInterestRate` inicial (propiedad del prototipo del banco); lo actualiza el mercado de bonos. */
  initialBankBondInterestRate: number; // 2298
  /**
   * `AdaptiveWageStrategy` de los hogares (`householdsWageStrategy`, evento 11): umbrales micro (ocupación
   * pasada del desocupado) y macro (desempleo agregado del período anterior), pasos y desvío de
   * `foldedNormal1` (2982).
   */
  wageMicroThreshold: number; // 2802
  wageMacroThreshold: number; // 2803
  wageMicroAdaptive: number; // 2805
  wageMacroAdaptive: number; // 2804
  wageSigma: number; // 2982
  /** `Households.employmentWageLag`: trimestres que mira la referencia micro del salario. */
  employmentWageLag: number; // 2701
  /** `turnoverLabor` (`turnoverVal`, 2018–2020) de las empresas (1550, 2012) y del gobierno (2871): rotación por tick. */
  laborTurnover: number;
  /** `GovernmentAntiCyclical.fixedLaborDemand`: empleo público objetivo. */
  governmentLaborDemand: number; // 2870
  /** `SelectionRandomRobinBuyerMixer.nbSellers` del mercado de trabajo: hogares que ve cada empleador (evento 14). */
  laborMarketSellers: number; // 377
  /** `SimpleMarketSimulation.nbRuns` del mercado de trabajo: rondas del mezclador, mientras no se cierre. */
  laborMarketRuns: number; // 364
  /** `UpdateInventoriesProductivityWithCost.inventoriesLostShare`: inventario que se pierde al innovar (evento 16). */
  inventoriesLostShare: number; // 1841
  /** `GovernmentAntiCyclical.unemploymentBenefit`: seguro de desempleo, como fracción del salario medio de los ocupados. */
  unemploymentBenefit: number; // 2872
  /** `IncomeWealthTaxStrategy` de los hogares: alícuotas sobre el ingreso bruto y sobre el patrimonio (eventos 17 y 24). */
  householdIncomeTaxRate: number; // 2810
  householdWealthTaxRate: number; // 2811
  /**
   * `ConsumptionFixedPropensitiesOOIWWithPersistency` (evento 17): persistencia del consumo pasado y propensiones
   * a consumir del ingreso neto y del patrimonio.
   */
  consumptionPersistency: number; // 2780
  propensityOutOfIncome: number; // 2781
  propensityOutOfWealth: number; // 2782
  /** `SelectionRandomRobinBuyerMixer.nbSellers` del mercado de consumo: empresas que ve cada hogar (evento 18). */
  consumptionMarketSellers: number; // 294
  /** `SimpleMarketSimulation.nbRuns` del mercado de consumo: rondas del mezclador, mientras no se cierre. */
  consumptionMarketRuns: number; // 282
  /**
   * `SwitchingStrategySimple` del proveedor de consumo (`switchingStrategy3`): λ = −ln(0,5) / thresholdMean, con
   * thresholdMean = 0,2 (1783) y `payOrReceive` = true (1785).
   */
  consumerSwitchingLambda: number;
  consumerSwitchingPayOrReceive: boolean; // 1785
}

/**
 * −Math.log(0.5) de Java (el double más cercano a ln 2). Constante para no usar `Math.log` en el motor
 * (principio 4).
 */
export const LN2 = 0.6931471805599453;

export const RULES: Readonly<RuleParams> = {
  inventoryShareCapital: 0.1,
  inventoryShareConsumption: 0.1,
  centralBankAdvancesRate: 0.005,
  markUpThreshold: 0.1,
  markUpAdaptive: 1,
  markUpSigma: 0.0094,
  initialMarkUpCapital: 0.075,
  initialMarkUpConsumption: 0.318857,
  capitalLaborProductivity: 2,
  capitalMarketSellers: 5,
  researchShare: 0,
  capitalSwitchingLambda: LN2 / 0.2,
  capitalSwitchingPayOrReceive: true,
  initialBankInterestRate: 0.0075,
  loanRateAdaptive: 1,
  loanRateIncrease: false,
  loanRateSigma: 0.0094,
  initialDepositInterestRate: 0.0025,
  bankAdvancesInterestRate: 0.005,
  depositRateAdaptive: 1,
  depositRateIncrease: false,
  depositRateSigma: 0.0094,
  profitTaxRate: 0.18,
  firmProfitShareCapital: 0.9,
  firmProfitShareConsumption: 0.9,
  shareOfExpIncomeAsDepositCapital: 1,
  shareOfExpIncomeAsDepositConsumption: 1,
  firmLoanLength: 20,
  creditMarketSellers: 3,
  lenderSwitchingLambda: LN2 / 0.15,
  lenderSwitchingPayOrReceive: true,
  riskAversionC: 3.922445,
  riskAversionK: 21.513347,
  creditSupplyHaircut: 0.5,
  initialBankBondInterestRate: 0.0025,
  wageMicroThreshold: 0.49,
  wageMacroThreshold: 0.08,
  wageMicroAdaptive: 1,
  wageMacroAdaptive: 1,
  wageSigma: 0.0094,
  employmentWageLag: 4,
  laborTurnover: 0.05,
  governmentLaborDemand: 1360,
  laborMarketSellers: 10,
  laborMarketRuns: 8000,
  inventoriesLostShare: 0,
  unemploymentBenefit: 0.4,
  householdIncomeTaxRate: 0.18,
  householdWealthTaxRate: 0,
  consumptionPersistency: 0,
  propensityOutOfIncome: 0.385808,
  propensityOutOfWealth: 0.25,
  consumptionMarketSellers: 5,
  consumptionMarketRuns: 100,
  consumerSwitchingLambda: LN2 / 0.2,
  consumerSwitchingPayOrReceive: true,
};
