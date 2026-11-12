/**
 * Comparación de variantes experimentales de la Fase 1 (2026-11-11): reglas
 * aprobadas (R9, R12, R13) contra (a) traslado de costos y (b) salario que baja.
 * Ver docs/fase1-reglas.md.
 */

import {
  CREDIT,
  PHASE1_CONFIG,
  createWarmState,
  makePhase1Stages,
  netFinancialWorth,
  step,
  type Knobs,
  type DividendPolicy,
  type Phase1Experiments,
  type CreditParams,
  type MarketParams,
  type CapitalParams,
  type Stage,
  CAPITAL,
  PARAMS,
  type SimConfig,
  MARKET,
  type SimState,
  APPROVED_DIVIDENDS,
} from '../../src/index';

export interface VariantRun {
  seed: number;
  lateUnemployment: number;
  /** Tendencia anual del nivel de precios y del salario promedio, en los 50 años visibles. */
  priceTrend: number;
  wageTrend: number;
  lateMarkup: number;
  /** Quiebras por año (50 años visibles). */
  bankruptciesPerYear: number;
  /** Mes (desde la creación, calentamiento incluido) en que el patrimonio del banco quedó negativo, o null. */
  bankInsolventAt: number | null;
  /** Deuda / masa salarial y fracción de empresas endeudadas, últimos 10 años. */
  lateDebtToWageBill: number;
  lateIndebtedShare: number;
  minOutput: number;
  /** Quiebras en los primeros 5 años desde la creación (transitorio inicial). */
  earlyBankruptcies: number;
  /** Castigos e intereses cobrados, totales de toda la corrida (calentamiento incluido), en pesos. */
  totalWriteOffs: number;
  totalInterest: number;
  /** Patrimonio del banco al final / al inicio. */
  bankEquityRatio: number;
  /** Desempleo promedio de los primeros 5 años desde la creación. */
  earlyUnemployment: number;
  /** R13: préstamos rechazados por racionamiento (toda la corrida) y meses por estimador del riesgo. */
  rationedByRisk: number;
  estimatorMonths: Record<string, number>;
  /** Tasa anual promedio de los préstamos nuevos (ponderada), en toda la corrida. */
  avgNewLoanRateAnnual: number;
  /** Préstamos otorgados en toda la corrida, en pesos. */
  totalNewLoans: number;
  /**
   * Volatilidad de ventas en los años 2 a 5 desde la creación: mediana del
   * coeficiente de variación mensual por empresa, y fracción de meses-empresa con
   * ventas < 70% de la masa salarial.
   */
  earlySalesCv: number;
  earlyBadMonthShare: number;
  // --- R11 (capital), 50 años visibles ---
  /** Ocupados en empresas de capital / ocupados, últimos 10 años. */
  lateCapitalEmploymentShare: number;
  /** Utilización media de la capacidad de las empresas de consumo activas, últimos 10 años. */
  lateUtilization: number;
  /** Fracción de empresas de consumo activas al tope de su capacidad, últimos 10 años. */
  lateAtCapacityShare: number;
  /** Quiebras por año en cada sector (50 años visibles). */
  bankruptciesConsumptionPerYear: number;
  bankruptciesCapitalPerYear: number;
  /** Ventas forzosas con un comprador y pagadas entre todos (50 años visibles). */
  fireSales: number;
  fireSalesPooled: number;
  /** Tendencia anual del capital total de las empresas de consumo (unidades). */
  capitalTrend: number;
  /** Unidades de capital compradas / pedidas (50 años visibles). */
  capitalFillRate: number;
  /** Precio del capital / precio del consumo, últimos 10 años. */
  lateCapitalPriceRatio: number;
  /** Ahorro forzoso / gasto deseado de los hogares (presupuesto que no encontró bienes), últimos 10 años. */
  lateForcedSavingShare: number;
  /** Fracción de empresas de consumo activas que agotaron stock, últimos 10 años. */
  lateSoldOutShare: number;
  /**
   * Trampa sin caja: empresas de consumo activas que llevan ≥ 12 meses seguidos
   * sin producir (promedio por mes, últimos 10 años) y máximo de meses seguidos.
   */
  lateIdleFirms: number;
  maxIdleMonths: number;
  /**
   * Empresas nuevas (50 años visibles, los dos sectores): cuántas entraron, cuántas
   * tuvieron algún mes sin producir en sus primeros 12 meses, cuántas quedaron
   * paradas ≥ 6 meses seguidos dentro de ese primer año (trampa) y cuántas
   * quebraron en su primer año.
   */
  entrants: number;
  entrantsWithIdleMonth: number;
  entrantsTrapped: number;
  entrantsBankruptFirstYear: number;
  /**
   * Zombis: empresas de consumo activas con deuda los últimos 24 meses seguidos y
   * ventas esperadas menores que hace 24 meses (no quebraron). Promedio por mes y
   * máximo, últimos 10 años.
   */
  lateZombies: number;
  maxZombies: number;
  /** Inversión (ventas de bienes de capital) / ventas de bienes de consumo, últimos 10 años. */
  lateInvestmentShare: number;
  /** Demanda registrada por las empresas de capital / unidades pedidas (doble conteo de las colas), 50 años visibles. */
  capitalDemandOvercount: number;
}

const VISIBLE = 600;

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function logTrend(ys: readonly number[]): number {
  // Pendiente por mínimos cuadrados de ln(y), anualizada (solo en tests y reportes).
  const n = ys.length;
  const ls = ys.map((y) => Math.log(y));
  const xm = (n - 1) / 2;
  const ym = mean(ls);
  let num = 0;
  let den = 0;
  ls.forEach((y, x) => {
    num += (x - xm) * (y - ym);
    den += (x - xm) ** 2;
  });
  return Math.exp((num / den) * 12) - 1;
}

function medianCv(series: Map<number, number[]>): number {
  const cvs: number[] = [];
  for (const xs of series.values()) {
    if (xs.length < 24) continue;
    const m = mean(xs);
    if (m <= 0) continue;
    cvs.push(Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) / m);
  }
  cvs.sort((a, b) => a - b);
  return cvs.length > 0 ? cvs[Math.floor(cvs.length / 2)]! : 0;
}

const avgWage = (s: SimState) => {
  const active = s.firms.filter((f) => f.active);
  return active.length > 0 ? mean(active.map((f) => f.wage)) : 0;
};

/**
 * `start`: 'cold' calienta con las mismas reglas desde la creación; 'phase0'
 * calienta con las reglas de la Fase 0 (sin crédito) y prende el crédito en el
 * mes 0 visible, para medir la dinámica sin el transitorio inicial.
 */
export function runVariant(
  seed: number,
  knobs: Knobs,
  experiments: Phase1Experiments,
  start: 'cold' | 'phase0' = 'cold',
  dividends: DividendPolicy = APPROVED_DIVIDENDS,
  baseConfig: SimConfig = PHASE1_CONFIG,
  market: MarketParams = MARKET,
  credit: CreditParams = CREDIT,
  capital: CapitalParams = CAPITAL,
): VariantRun {
  const modelStages = makePhase1Stages(credit, experiments, dividends, market, capital);
  // Sondas alrededor del mercado de bienes de consumo: ahorro forzoso (presupuesto
  // de R5 que no encontró bienes). No tocan el estado ni el azar.
  const GOODS = 7;
  let budgets: number[] = [];
  let before: number[] = [];
  let forced = 0;
  let wanted = 0;
  const beforeGoods: Stage = (st) => {
    budgets = st.households.map((hh) =>
      Math.max(0, Math.min(Math.floor(PARAMS.consumeOutOfIncome * hh.incomeLastMonth + PARAMS.consumeOutOfWealth * hh.depositsAtMonthStart), hh.positions.deposits)),
    );
    before = st.households.map((hh) => hh.positions.deposits);
  };
  const afterGoods: Stage = (st) => {
    forced = 0;
    wanted = 0;
    st.households.forEach((hh, i) => {
      const spent = before[i]! - hh.positions.deposits;
      forced += Math.max(0, budgets[i]! - spent);
      wanted += budgets[i]!;
    });
  };
  const stages = [...modelStages.slice(0, GOODS), beforeGoods, modelStages[GOODS]!, afterGoods, ...modelStages.slice(GOODS + 1)];
  // Protocolo del criterio de la Fase 0: A y B se calientan igual (s = 0, mismo
  // gasto) y B cambia recién en el mes 0 visible. (Hasta el 2026-11-11 se
  // calentaba B con s = 0,5: ver docs/fase1-reglas.md, "Error de protocolo".)
  const config = { ...baseConfig, knobs, burnInKnobs: { ...knobs, structuralDeficitShare: 0 } };
  // Calentamiento a mano para poder registrar cuándo se funde el banco.
  let s = createWarmState(seed, { ...config, burnInTicks: 0 }, stages);
  let insolventAt: number | null = null;
  const burnIn = config.burnInTicks ?? 0;
  const equity0 = netFinancialWorth(s.bank);
  let earlyBankruptcies = 0;
  let earlyUnemployment = 0;
  let rationedByRisk = 0;
  const estimatorMonths: Record<string, number> = { none: 0, frequency: 0, logistic: 0, bands: 0 };
  let rateWeighted = 0;
  let lentTotal = 0;
  const track = (st: SimState) => {
    rationedByRisk += st.credit.rationedByRisk;
    estimatorMonths[st.credit.riskEstimator] = (estimatorMonths[st.credit.riskEstimator] ?? 0) + 1;
    rateWeighted += st.credit.newLoanRate * st.credit.newLoans;
    lentTotal += st.credit.newLoans;
  };
  let firmMonths = 0;
  let badMonths = 0;
  const salesById = new Map<number, number[]>();
  let totalWriteOffs = 0;
  let totalInterest = 0;
  const burnInKnobs = config.burnInKnobs;
  for (let t = 1; t <= burnIn; t++) {
    s = start === 'cold' ? step(s, burnInKnobs, { stages }) : step(s, burnInKnobs);
    if (start === 'cold') track(s);
    if (insolventAt === null && netFinancialWorth(s.bank) < 0) insolventAt = t;
    if (t <= 60) {
      earlyBankruptcies += s.credit.bankruptcies;
      earlyUnemployment += s.stats.unemployment / 60;
      if (t > 12) {
        for (const f of s.firms) {
          if (!f.active || f.wageBill <= 0) continue;
          firmMonths += 1;
          if (f.revenue < 0.7 * f.wageBill) badMonths += 1;
          const arr = salesById.get(f.id) ?? [];
          arr.push(f.revenue);
          salesById.set(f.id, arr);
        }
      }
    }
    totalWriteOffs += s.credit.writeOffs;
    totalInterest += s.credit.interestIncome;
  }
  const prices = [s.stats.priceIndex];
  const wages = [avgWage(s)];
  const late: number[] = [];
  const markup: number[] = [];
  const debt: number[] = [];
  const indebted: number[] = [];
  let bankruptcies = 0;
  let minOutput = Infinity;
  let bankruptC = 0;
  let bankruptK = 0;
  let fireSales = 0;
  let fireSalesPooled = 0;
  let ordered = 0;
  let bought = 0;
  let registered = 0;
  const capitalSeries: number[] = [];
  const kShare: number[] = [];
  const util: number[] = [];
  const atCap: number[] = [];
  const pkRatio: number[] = [];
  const forcedShare: number[] = [];
  const idleFirms: number[] = [];
  // Seguimiento de empresas nuevas: mes de entrada, meses sin producir, racha.
  type Young = { age: number; idleMonths: number; run: number; trapped: boolean };
  const young = new Map<number, Young>();
  let entrants = 0;
  let entrantsWithIdle = 0;
  let entrantsTrapped = 0;
  let entrantsBankrupt = 0;
  // Zombis: historia de 25 meses de (deuda > 0, ventas esperadas) por empresa.
  const zHist = new Map<number, { debt: boolean; se: number }[]>();
  const zombieCounts: number[] = [];
  const investShare: number[] = [];
  const idleRun = new Map<number, number>();
  let maxIdle = 0;
  const soldOut: number[] = [];
  for (let t = 1; t <= VISIBLE; t++) {
    const wasActive = s.firms.map((f) => f.active);
    s = step(s, knobs, { stages });
    for (const f of s.firms) {
      if (!f.active || f.sector !== 'consumption') {
        idleRun.delete(f.id);
        continue;
      }
      const n = f.wageBill === 0 ? (idleRun.get(f.id) ?? 0) + 1 : 0;
      idleRun.set(f.id, n);
      maxIdle = Math.max(maxIdle, n);
    }
    if (t > VISIBLE - 120) idleFirms.push([...idleRun.values()].filter((n) => n >= 12).length);
    // Empresas nuevas.
    s.firms.forEach((f, i) => {
      if (!wasActive[i] && f.active) {
        entrants += 1;
        young.set(f.id, { age: 0, idleMonths: 0, run: 0, trapped: false });
      }
    });
    for (const f of s.firms) {
      const y = young.get(f.id);
      if (y === undefined) continue;
      if (!f.active) {
        entrantsBankrupt += 1;
        if (y.idleMonths > 0) entrantsWithIdle += 1;
        if (y.trapped) entrantsTrapped += 1;
        young.delete(f.id);
        continue;
      }
      y.age += 1;
      if (f.wageBill === 0) {
        y.idleMonths += 1;
        y.run += 1;
        if (y.run >= 6) y.trapped = true;
      } else {
        y.run = 0;
      }
      if (y.age >= 12) {
        if (y.idleMonths > 0) entrantsWithIdle += 1;
        if (y.trapped) entrantsTrapped += 1;
        young.delete(f.id);
      }
    }
    // Zombis.
    let zombies = 0;
    for (const f of s.firms) {
      if (!f.active || f.sector !== 'consumption') {
        zHist.delete(f.id);
        continue;
      }
      const h = zHist.get(f.id) ?? [];
      h.push({ debt: f.positions.loans < 0, se: f.expectedSales });
      if (h.length > 25) h.shift();
      zHist.set(f.id, h);
      if (h.length === 25 && h.slice(1).every((x) => x.debt) && h[24]!.se < h[0]!.se) zombies += 1;
    }
    if (t > VISIBLE - 120) zombieCounts.push(zombies);
    s.firms.forEach((f, i) => {
      if (wasActive[i] && !f.active) {
        if (f.sector === 'capital') bankruptK += 1;
        else bankruptC += 1;
      }
    });
    fireSales += s.credit.fireSales;
    fireSalesPooled += s.credit.fireSalesPooled;
    ordered += s.credit.capitalOrdered;
    bought += s.credit.capitalBought;
    registered += s.credit.capitalDemandRegistered;
    capitalSeries.push(Math.max(1, s.firms.reduce((a, f) => a + (f.sector === 'consumption' ? f.capital : 0), 0)));
    if (insolventAt === null && netFinancialWorth(s.bank) < 0) insolventAt = burnIn + t;
    prices.push(s.stats.priceIndex);
    wages.push(Math.max(1, avgWage(s)));
    bankruptcies += s.credit.bankruptcies;
    track(s);
    totalWriteOffs += s.credit.writeOffs;
    totalInterest += s.credit.interestIncome;
    minOutput = Math.min(minOutput, s.stats.output);
    if (t > VISIBLE - 120) {
      late.push(s.stats.unemployment);
      const w = avgWage(s);
      markup.push(w > 0 ? s.stats.priceIndex / (w / 10) : 0);
      const wageBill = s.firms.reduce((a, f) => a + f.wageBill, 0);
      debt.push(wageBill > 0 ? s.bank.positions.loans / wageBill : 0);
      indebted.push(s.firms.filter((f) => f.positions.loans < 0).length / s.firms.length);
      const capitalIds = new Set(s.firms.filter((f) => f.sector === 'capital').map((f) => f.id));
      const employed = s.households.filter((h) => h.employerId !== null);
      kShare.push(employed.length > 0 ? employed.filter((h) => capitalIds.has(h.employerId!)).length / employed.length : 0);
      const cons = s.firms.filter((f) => f.active && f.sector === 'consumption' && f.capital > 0);
      util.push(cons.length > 0 ? mean(cons.map((f) => f.lastOutput / (capital.capitalProductivity * f.capital))) : 0);
      atCap.push(cons.length > 0 ? cons.filter((f) => f.lastOutput >= Math.floor(capital.capitalProductivity * f.capital + 1e-9) - 1e-9 && f.lastOutput > 0).length / cons.length : 0);
      pkRatio.push(s.stats.capitalPriceIndex / s.stats.priceIndex);
      const kSales = s.firms.reduce((x, f) => x + (f.sector === 'capital' ? f.revenue : 0), 0);
      const cSales = s.firms.reduce((x, f) => x + (f.sector === 'consumption' ? f.revenue : 0), 0);
      investShare.push(cSales > 0 ? kSales / cSales : 0);
      forcedShare.push(wanted > 0 ? forced / wanted : 0);
      const activeC = s.firms.filter((f) => f.active && f.sector === 'consumption');
      soldOut.push(activeC.length > 0 ? activeC.filter((f) => f.soldOut).length / activeC.length : 0);
    }
  }
  return {
    seed,
    lateUnemployment: mean(late),
    priceTrend: logTrend(prices),
    wageTrend: logTrend(wages),
    lateMarkup: mean(markup),
    bankruptciesPerYear: bankruptcies / (VISIBLE / 12),
    bankInsolventAt: insolventAt,
    lateDebtToWageBill: mean(debt),
    lateIndebtedShare: mean(indebted),
    minOutput,
    earlyBankruptcies,
    totalWriteOffs: totalWriteOffs / 100,
    totalInterest: totalInterest / 100,
    bankEquityRatio: netFinancialWorth(s.bank) / equity0,
    earlyUnemployment,
    earlySalesCv: medianCv(salesById),
    rationedByRisk,
    estimatorMonths,
    avgNewLoanRateAnnual: lentTotal > 0 ? (rateWeighted / lentTotal) * 12 : 0,
    totalNewLoans: lentTotal / 100,
    earlyBadMonthShare: firmMonths > 0 ? badMonths / firmMonths : 0,
    lateCapitalEmploymentShare: mean(kShare),
    lateUtilization: mean(util),
    lateAtCapacityShare: mean(atCap),
    bankruptciesConsumptionPerYear: bankruptC / (VISIBLE / 12),
    bankruptciesCapitalPerYear: bankruptK / (VISIBLE / 12),
    fireSales,
    fireSalesPooled,
    capitalTrend: logTrend(capitalSeries),
    capitalFillRate: ordered > 0 ? bought / ordered : 0,
    lateCapitalPriceRatio: mean(pkRatio),
    lateForcedSavingShare: mean(forcedShare),
    lateSoldOutShare: mean(soldOut),
    lateIdleFirms: mean(idleFirms),
    maxIdleMonths: maxIdle,
    entrants,
    entrantsWithIdleMonth: entrantsWithIdle,
    entrantsTrapped,
    entrantsBankruptFirstYear: entrantsBankrupt,
    lateZombies: mean(zombieCounts),
    maxZombies: Math.max(0, ...zombieCounts),
    lateInvestmentShare: mean(investShare),
    capitalDemandOvercount: ordered > 0 ? registered / ordered : 0,
  };
}
