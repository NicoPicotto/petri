/**
 * Reporte de la Fase 1. Por ahora, el diagnóstico con G = 0 (paso 1a.0):
 * ¿por qué la economía privada no se sostiene sola con las reglas de la Fase 0?
 *
 * Uso: pnpm --filter @petri/engine report:fase1 [g0|escala|variantes]
 *   g0:        diagnóstico con G = 0 (paso 1a.0).
 *   escala:    volatilidad según el tamaño de la cápsula (paso 1a.1).
 *   capacidad: ¿cuánto del achicamiento del efecto de la emisión explica que R1 no suba el precio al tope de capacidad? (~4 min).
 *   r11: R11 (capital, sector de bienes de capital, venta forzosa), r_K = 0,3 · 0,15 · 0,5 (~6 min).
 *   r13: R13 revisada (tasa según el riesgo y racionamiento), umbral φ = 0,03 · 0,015 · 0,06 (~6 min).
 *   emision: a dónde va la emisión extra de B, reglas de la Fase 0 contra las de la Fase 1 (~4 min).
 *   r6: R6 con fidelidad al proveedor, con β = 0,3 · 1 · 3 (~6 min).
 *   calibracion: condiciones iniciales calibradas contra las de la Fase 0 (~4 min).
 *   regimen: proporciones del régimen estable para calibrar las condiciones iniciales (~30 s).
 *   dividendos: R7 revisada, cada parte por separado y juntas (~10 min).
 *   variantes [frio|g0|caliente]: reglas aprobadas contra variantes experimentales de precios y salarios (~1–2 min por escenario).
 *     'caliente' (calentamiento con las reglas de la Fase 0) quedó obsoleto con R11: esas reglas no conocen los sectores.
 *   Sin argumento corre todo.
 */

import { runG0Diagnostic, summarize, type DiagSummary, type G0Scenario } from '../test/helpers/diagnostics';
import { SCALE_MONTHS, SIZES, runVolatility, type VolatilityRun } from '../test/helpers/scale';
import { runVariant, type VariantRun } from '../test/helpers/variants';
import { CAPITAL, CREDIT, PARAMS, PHASE0_STAGES, PHASE1_CONFIG, PHASE1_STAGES, createWarmState, netFinancialWorth, step, type DividendPolicy, type Knobs, type Phase1Experiments, type SimState, type Stage } from '../src/index';

const section = process.argv[2];
const run_ = (name: string) => section === undefined || section === name;

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const MONTHS = 600;
const LATE_FROM = MONTHS - 120;

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function table(scenario: G0Scenario, title: string): DiagSummary[] {
  console.log(`\n${title} — últimos 10 de ${MONTHS / 12} años, ${SEEDS.length} semillas\n`);
  console.log(
    'semilla | desempleo | puestos deseados | emp. sin liquidez | puestos perdidos x liquidez | emp. con stock | sin vender | ahorro forzoso/gasto | retenido/masa sal. | dinero/masa sal. PE | margen',
  );
  const rows = SEEDS.map((seed) => summarize(runG0Diagnostic(seed, scenario, MONTHS), LATE_FROM, MONTHS));
  for (const r of rows) {
    console.log(
      [
        String(r.seed).padStart(7),
        pct(r.unemployment).padStart(9),
        pct(r.desiredJobsShare).padStart(16),
        pct(r.liquidityConstrainedFirmShare).padStart(17),
        pct(r.jobsLostToLiquidityShare).padStart(27),
        pct(r.firmsWithUnsoldStockShare).padStart(14),
        pct(r.unsoldShare).padStart(10),
        pct(r.forcedSavingShare).padStart(20),
        pct(r.retainedShare).padStart(18),
        r.moneyToFullEmploymentWageBill.toFixed(2).padStart(19),
        r.markup.toFixed(3).padStart(6),
      ].join(' | '),
    );
  }
  const m = (f: (r: DiagSummary) => number) => mean(rows.map(f));
  console.log(
    `  media | ${pct(m((r) => r.unemployment)).padStart(9)} | ${pct(m((r) => r.desiredJobsShare)).padStart(16)} | ${pct(m((r) => r.liquidityConstrainedFirmShare)).padStart(17)} | ${pct(m((r) => r.jobsLostToLiquidityShare)).padStart(27)} | ${pct(m((r) => r.firmsWithUnsoldStockShare)).padStart(14)} | ${pct(m((r) => r.unsoldShare)).padStart(10)} | ${pct(m((r) => r.forcedSavingShare)).padStart(20)} | ${pct(m((r) => r.retainedShare)).padStart(18)} | ${m((r) => r.moneyToFullEmploymentWageBill).toFixed(2).padStart(19)} | ${m((r) => r.markup).toFixed(3).padStart(6)}`,
  );
  return rows;
}

if (run_('g0')) g0Section();
if (run_('escala')) scaleSection();
if (run_('variantes')) variantsSection();
if (run_('dividendos')) dividendsSection();
if (run_('regimen')) regimeSection();
if (run_('calibracion')) calibrationSection();
if (run_('r6')) r6Section();
if (run_('emision')) emissionSection();
if (run_('r13')) r13Section();
if (run_('r11')) r11Section();
if (run_('capacidad')) capacitySection();

function g0Section(): void {
table('baseline', 'Referencia: Fase 0 tal como está (G = 50.000, s = 0)');
table('fromCreation', 'G = 0 desde la creación (calentamiento incluido)');
table('switchAfterBurnIn', 'Calentamiento con G = 50.000 y G = 0 desde el mes 0');

// Trayectoria de una semilla al pasar a G = 0: promedios anuales de los primeros 15 años.
const run = runG0Diagnostic(1, 'switchAfterBurnIn', 180);
console.log('\nSemilla 1, paso a G = 0 en el mes 0 — promedios anuales\n');
console.log('año | desempleo | puestos deseados | puestos perdidos x liquidez | sin vender | ahorro forzoso/gasto | dinero/masa sal. PE | salario prom. | índice precios');
for (let y = 0; y < 15; y++) {
  const s = summarize(run, y * 12, y * 12 + 12);
  const w = run.months.slice(y * 12, y * 12 + 12);
  console.log(
    `${String(y + 1).padStart(3)} | ${pct(s.unemployment).padStart(9)} | ${pct(s.desiredJobsShare).padStart(16)} | ${pct(s.jobsLostToLiquidityShare).padStart(27)} | ${pct(s.unsoldShare).padStart(10)} | ${pct(s.forcedSavingShare).padStart(20)} | ${s.moneyToFullEmploymentWageBill.toFixed(2).padStart(19)} | ${(mean(w.map((m) => m.avgWage)) / 100).toFixed(0).padStart(13)} | ${(mean(w.map((m) => m.priceIndex)) / 100).toFixed(2).padStart(14)}`,
  );
}
}

function scaleSection(): void {
  const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
  console.log(`\nVolatilidad según el tamaño — 10 semillas, ${SCALE_MONTHS / 12} años después del calentamiento, s = 0, G = 100 pesos por hogar\n`);
  console.log(
    'hogares | empresas | desempleo medio | desvío desempleo (pp) | desvío cambio mensual (pp) | inflación mensual: media · desvío | ventanas 5 años: desvío · rango (anual) | margen | ms/mes | calent. (s)',
  );
  const rows: { h: number; runs: VolatilityRun[] }[] = [];
  for (const h of SIZES) {
    const runs = seeds.map((seed) => runVolatility(h, seed));
    rows.push({ h, runs });
    const m = (f: (r: VolatilityRun) => number) => mean(runs.map(f));
    console.log(
      [
        String(h).padStart(7),
        String(Math.round((h * 30) / 500)).padStart(8),
        pct(m((r) => r.meanUnemployment)).padStart(15),
        (m((r) => r.sdUnemployment) * 100).toFixed(2).padStart(21),
        (m((r) => r.sdUnemploymentChange) * 100).toFixed(2).padStart(26),
        `${pct(m((r) => r.meanInflation), 3)} · ${pct(m((r) => r.sdInflation), 3)}`.padStart(33),
        `${pct(m((r) => r.sdFiveYearInflation), 2)} · ${pct(Math.min(...runs.map((r) => r.fiveYearRange[0])), 1)} a ${pct(Math.max(...runs.map((r) => r.fiveYearRange[1])), 1)}`.padStart(39),
        m((r) => r.meanMarkup).toFixed(3).padStart(6),
        m((r) => r.msPerTick).toFixed(2).padStart(6),
        (m((r) => r.burnInMs) / 1000).toFixed(1).padStart(11),
      ].join(' | '),
    );
  }
  const base = rows[0]!;
  console.log('\nRelación con 500 hogares (1/√N esperaría 1,00 · 0,71 · 0,50 · 0,35):');
  for (const { h, runs } of rows) {
    const r = (f: (x: VolatilityRun) => number) => (mean(runs.map(f)) / mean(base.runs.map(f))).toFixed(2);
    console.log(`  ${String(h).padStart(5)}: desvío desempleo ${r((x) => x.sdUnemployment)} · cambio mensual ${r((x) => x.sdUnemploymentChange)} · inflación mensual ${r((x) => x.sdInflation)} · ventanas 5 años ${r((x) => x.sdFiveYearInflation)}`);
  }
}

function variantsSection(): void {
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const variants: [string, Phase1Experiments][] = [
    ['aprobadas (R9 + R12 + R13)', {}],
    ['(a) traslado de costos', { costPassThrough: true }],
    ['(b) salario que baja', { wageCutWithUnemployment: true }],
  ];
  const q = (xs: number[], f: (x: number) => string) => {
    const s = [...xs].sort((a, b) => a - b);
    return `${f(s[0]!)} · ${f(s[Math.floor(s.length / 2)]!)} · ${f(s[s.length - 1]!)}`;
  };
  const p1 = (x: number) => `${(x * 100).toFixed(1)}%`;
  const p2 = (x: number) => `${(x * 100).toFixed(2)}%`;
  const nominal = (1 + CREDIT.loanMarkup) * CREDIT.baseRateAnnual;
  const scenarioArg = process.argv[3];
  for (const [key, scenario, knobs, start] of [
    ['frio', 'G = 200.000 (100 pesos por hogar), calentamiento con las mismas reglas', PHASE1_CONFIG.knobs!, 'cold'],
    ['g0', 'G = 0 desde la creación, calentamiento con las mismas reglas', { publicSpending: 0, structuralDeficitShare: 0 }, 'cold'],
    ['caliente', 'G = 200.000, calentamiento con la Fase 0 y crédito desde el mes 0', PHASE1_CONFIG.knobs!, 'phase0'],
  ] as const) {
    if (scenarioArg !== undefined && scenarioArg !== key) continue;
    console.log(`\nVariantes — ${scenario}. 20 semillas, 2.000 hogares, calentamiento de 420 meses, 50 años visibles. mín · mediana · máx\n`);
    for (const [name, exp] of variants) {
      const runs: VariantRun[] = seeds.map((seed) => runVariant(seed, knobs, exp, start));
      const insolvent = runs.filter((r) => r.bankInsolventAt !== null);
      const collapses = runs.filter((r) => r.minOutput <= 0 || r.lateUnemployment >= 0.5).length;
      console.log(`${name}`);
      console.log(`  desempleo (últ. 10 años): ${q(runs.map((r) => r.lateUnemployment), p1)} · colapsos (desempleo ≥ 50% o producción 0): ${collapses}/20`);
      console.log(`  inflación anual: ${q(runs.map((r) => r.priceTrend), p2)} · salario nominal anual: ${q(runs.map((r) => r.wageTrend), p2)} · tasa real (${p2(nominal)} − inflación): ${q(runs.map((r) => nominal - r.priceTrend), p2)}`);
      console.log(`  margen (últ. 10 años): ${q(runs.map((r) => r.lateMarkup), (x) => x.toFixed(2))} · quiebras por año: ${q(runs.map((r) => r.bankruptciesPerYear), (x) => x.toFixed(1))}`);
      console.log(`  banco insolvente: ${insolvent.length}/20${insolvent.length ? ` (año en que se funde, desde la creación: ${q(insolvent.map((r) => r.bankInsolventAt! / 12), (x) => x.toFixed(0))}; el mes 0 visible es el año 35)` : ''}`);
      console.log(`  deuda / masa salarial (últ. 10 años): ${q(runs.map((r) => r.lateDebtToWageBill), (x) => x.toFixed(2))} · empresas endeudadas: ${q(runs.map((r) => r.lateIndebtedShare), p1)}`);
    }
  }
}

function dividendsSection(): void {
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const policies: [string, DividendPolicy][] = [
    ['R7 anterior (90% de cada mes con ganancia)', { accumulated: 'none', leverage: false }],
    ['parte 1 anual (resultados acumulados)', { accumulated: 'annual', leverage: false }],
    ['parte 1 mensual (comparación)', { accumulated: 'monthly', leverage: false }],
    ['parte 2 (según endeudamiento)', { accumulated: 'none', leverage: true }],
    ['partes 1 anual + 2 (APROBADA)', { accumulated: 'annual', leverage: true }],
    ['partes 1 mensual + 2 (comparación)', { accumulated: 'monthly', leverage: true }],
  ];
  const A = PHASE1_CONFIG.knobs!;
  const B = { ...A, structuralDeficitShare: 0.5 };
  const q = (xs: number[], f: (x: number) => string) => {
    const s = [...xs].sort((a, b) => a - b);
    return `${f(s[0]!)} · ${f(s[Math.floor(s.length / 2)]!)} · ${f(s[s.length - 1]!)}`;
  };
  const p1 = (x: number) => `${(x * 100).toFixed(1)}%`;
  const p2 = (x: number) => `${(x * 100).toFixed(2)}%`;
  console.log('\nR7 revisada — 20 semillas, 2.000 hogares, calentamiento de 420 meses con las mismas reglas (desde la creación), 50 años visibles. G = 200.000. mín · mediana · máx\n');
  for (const [name, policy] of policies) {
    const a = seeds.map((seed) => runVariant(seed, A, {}, 'cold', policy));
    const b = seeds.map((seed) => runVariant(seed, B, {}, 'cold', policy));
    const insolvent = a.filter((r) => r.bankInsolventAt !== null);
    const bGtA = a.filter((r, i) => b[i]!.priceTrend > r.priceTrend).length;
    console.log(name);
    console.log(`  quiebras: primeros 5 años desde la creación ${q(a.map((r) => r.earlyBankruptcies), (x) => x.toFixed(0))} · por año en los 50 visibles ${q(a.map((r) => r.bankruptciesPerYear), (x) => x.toFixed(1))}`);
    console.log(`  castigos / intereses cobrados (toda la corrida): ${q(a.map((r) => r.totalWriteOffs / Math.max(1, r.totalInterest)), (x) => x.toFixed(2))} · castigos (miles $) ${q(a.map((r) => r.totalWriteOffs / 1000), (x) => x.toFixed(0))}`);
    console.log(`  patrimonio del banco final / inicial: ${q(a.map((r) => r.bankEquityRatio), (x) => x.toFixed(2))} · insolvente ${insolvent.length}/20${insolvent.length ? ` (año ${q(insolvent.map((r) => r.bankInsolventAt! / 12), (x) => x.toFixed(0))})` : ''}`);
    console.log(`  desempleo (últ. 10 años): ${q(a.map((r) => r.lateUnemployment), p1)} · deuda/masa salarial ${q(a.map((r) => r.lateDebtToWageBill), (x) => x.toFixed(2))} · endeudadas ${q(a.map((r) => r.lateIndebtedShare), p1)}`);
    console.log(`  criterio Fase 0: inflación A (s = 0) ${q(a.map((r) => r.priceTrend), p2)} · B (s = 0,5) ${q(b.map((r) => r.priceTrend), p2)} · A < 1% en ${a.filter((r) => Math.abs(r.priceTrend) < 0.01).length}/20 · B > A en ${bGtA}/20`);
  }
}

/**
 * Proporciones del régimen estable (años 40 a 50 desde la creación), con las
 * reglas aprobadas y el tamaño de la Fase 1. Sirven para calibrar las
 * condiciones iniciales (pedido de Nico, 2026-11-11).
 */
function regimeSection(): void {
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const knobs = PHASE1_CONFIG.knobs!;
  type Row = { markup: number; hhDepToIncome: number; firmDepToWageBill: number; firmNwToWageBill: number; employment: number; creditDemandToWageBill: number; wageToW0: number };
  const rows: Row[] = [];
  for (const seed of seeds) {
    let st = createWarmState(seed, { ...PHASE1_CONFIG, burnInTicks: 0 }, PHASE1_STAGES);
    const acc: Row = { markup: 0, hhDepToIncome: 0, firmDepToWageBill: 0, firmNwToWageBill: 0, employment: 0, creditDemandToWageBill: 0, wageToW0: 0 };
    const w0 = st.firms[0]!.wage;
    for (let t = 1; t <= 600; t++) {
      st = step(st, knobs, { stages: PHASE1_STAGES });
      if (t <= 480) continue;
      const active = st.firms.filter((f) => f.active);
      const avgWage = active.reduce((a, f) => a + f.wage, 0) / active.length;
      const wageBill = st.firms.reduce((a, f) => a + f.wageBill, 0);
      const hhDep = st.households.reduce((a, h) => a + h.positions.deposits, 0);
      const hhInc = st.households.reduce((a, h) => a + h.incomeLastMonth, 0);
      acc.markup += st.stats.priceIndex / (avgWage / PARAMS.laborProductivity) / 120;
      acc.hhDepToIncome += hhDep / hhInc / 120;
      acc.firmDepToWageBill += active.reduce((a, f) => a + f.positions.deposits, 0) / wageBill / 120;
      acc.firmNwToWageBill += active.reduce((a, f) => a + netFinancialWorth(f), 0) / wageBill / 120;
      acc.employment += (1 - st.stats.unemployment) / 120;
      acc.creditDemandToWageBill += (st.credit.newLoans + st.credit.rationedByBank) / wageBill / 120;
      acc.wageToW0 += avgWage / w0 / 120;
    }
    rows.push(acc);
  }
  const q = (f: (r: Row) => number, d = 3) => {
    const xs = rows.map(f).sort((a, b) => a - b);
    return `${xs[0]!.toFixed(d)} · ${xs[10]!.toFixed(d)} · ${xs[19]!.toFixed(d)}`;
  };
  console.log('\nRégimen estable (años 40 a 50 desde la creación), reglas aprobadas, 2.000 hogares, G = 200.000, 20 semillas. mín · mediana · máx\n');
  console.log(`  margen precio / costo unitario: ${q((r) => r.markup)}`);
  console.log(`  depósitos de los hogares / ingreso disponible mensual: ${q((r) => r.hhDepToIncome, 2)} meses`);
  console.log(`  depósitos de las empresas / masa salarial: ${q((r) => r.firmDepToWageBill, 2)} meses`);
  console.log(`  patrimonio neto de las empresas / masa salarial: ${q((r) => r.firmNwToWageBill, 2)} meses`);
  console.log(`  tasa de empleo: ${q((r) => r.employment)}`);
  console.log(`  demanda de crédito por mes (otorgado + racionado por el banco) / masa salarial: ${q((r) => r.creditDemandToWageBill, 4)}`);
  console.log(`  salario promedio / salario inicial: ${q((r) => r.wageToW0)}`);
}

/** Condiciones iniciales calibradas (PHASE1_INITIAL) contra las de la Fase 0, con las reglas aprobadas. */
function calibrationSection(): void {
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const A = PHASE1_CONFIG.knobs!;
  const B = { ...A, structuralDeficitShare: 0.5 };
  const q = (xs: number[], f: (x: number) => string) => {
    const s = [...xs].sort((a, b) => a - b);
    return `${f(s[0]!)} · ${f(s[Math.floor(s.length / 2)]!)} · ${f(s[s.length - 1]!)}`;
  };
  const p1 = (x: number) => `${(x * 100).toFixed(1)}%`;
  const p2 = (x: number) => `${(x * 100).toFixed(2)}%`;
  console.log('\nCondiciones iniciales — reglas aprobadas, 20 semillas, 2.000 hogares, calentamiento de 420 meses desde la creación, 50 años visibles. mín · mediana · máx\n');
  for (const [name, config] of [
    ['iniciales de la Fase 0 (margen 1,1; empleo 92%; depósitos 2 meses)', { ...PHASE1_CONFIG, initial: undefined }],
    ['calibradas con el régimen (PHASE1_INITIAL)', PHASE1_CONFIG],
  ] as const) {
    const a = seeds.map((seed) => runVariant(seed, A, {}, 'cold', undefined, config));
    const b = seeds.map((seed) => runVariant(seed, B, {}, 'cold', undefined, config));
    const insolvent = a.filter((r) => r.bankInsolventAt !== null);
    console.log(name);
    console.log(`  primeros 5 años desde la creación: desempleo ${q(a.map((r) => r.earlyUnemployment), p1)} · quiebras ${q(a.map((r) => r.earlyBankruptcies), (x) => x.toFixed(0))}`);
    console.log(`  quiebras por año (50 visibles): ${q(a.map((r) => r.bankruptciesPerYear), (x) => x.toFixed(1))} · castigos / intereses (toda la corrida): ${q(a.map((r) => r.totalWriteOffs / Math.max(1, r.totalInterest)), (x) => x.toFixed(2))}`);
    console.log(`  banco: insolvente ${insolvent.length}/20${insolvent.length ? ` (año ${q(insolvent.map((r) => r.bankInsolventAt! / 12), (x) => x.toFixed(0))})` : ''} · patrimonio final / inicial ${q(a.map((r) => r.bankEquityRatio), (x) => x.toFixed(2))}`);
    console.log(`  desempleo (últ. 10 años): ${q(a.map((r) => r.lateUnemployment), p1)} · deuda/masa salarial ${q(a.map((r) => r.lateDebtToWageBill), (x) => x.toFixed(2))} · endeudadas ${q(a.map((r) => r.lateIndebtedShare), p1)}`);
    console.log(`  criterio Fase 0: inflación A ${q(a.map((r) => r.priceTrend), p2)} · B ${q(b.map((r) => r.priceTrend), p2)} · A < 1% en ${a.filter((r) => Math.abs(r.priceTrend) < 0.01).length}/20 · B > A en ${a.filter((r, i) => b[i]!.priceTrend > r.priceTrend).length}/20`);
  }
}

/** R6 con fidelidad al proveedor (aprobada el 2026-11-11): β del paper y sensibilidad. */
function r6Section(): void {
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const A = PHASE1_CONFIG.knobs!;
  const B = { ...A, structuralDeficitShare: 0.5 };
  const q = (xs: number[], f: (x: number) => string) => {
    const s = [...xs].sort((a, b) => a - b);
    return `${f(s[0]!)} · ${f(s[Math.floor(s.length / 2)]!)} · ${f(s[s.length - 1]!)}`;
  };
  const p1 = (x: number) => `${(x * 100).toFixed(1)}%`;
  const p2 = (x: number) => `${(x * 100).toFixed(2)}%`;
  const firms = PHASE1_CONFIG.firms;
  console.log('\nR6 con fidelidad al proveedor — reglas aprobadas, iniciales calibradas, 20 semillas, 2.000 hogares, calentamiento de 420 meses desde la creación, 50 años visibles. mín · mediana · máx\n');
  for (const beta of [1, 0.3, 3]) {
    const market = { supplierSwitchIntensity: beta };
    const a = seeds.map((seed) => runVariant(seed, A, {}, 'cold', undefined, PHASE1_CONFIG, market));
    const b = seeds.map((seed) => runVariant(seed, B, {}, 'cold', undefined, PHASE1_CONFIG, market));
    const insolvent = a.filter((r) => r.bankInsolventAt !== null);
    console.log(`β = ${beta}${beta === 1 ? ' (Delli Gatti, Terranova & Turco, 2023)' : ' (sensibilidad)'}`);
    console.log(`  volatilidad (años 2 a 5): coef. de variación de ventas ${q(a.map((r) => r.earlySalesCv), (x) => x.toFixed(2))} · meses malos ${q(a.map((r) => r.earlyBadMonthShare), p1)}`);
    console.log(`  quiebras: primeros 5 años ${q(a.map((r) => r.earlyBankruptcies), (x) => x.toFixed(0))} (= ${q(a.map((r) => r.earlyBankruptcies / 5 / firms), p1)} anual) · 50 años visibles ${q(a.map((r) => r.bankruptciesPerYear / firms), p1)} anual (empírico: 5–10%)`);
    console.log(`  banco: insolvente ${insolvent.length}/20${insolvent.length ? ` (año ${q(insolvent.map((r) => r.bankInsolventAt! / 12), (x) => x.toFixed(0))})` : ''} · castigos / intereses ${q(a.map((r) => r.totalWriteOffs / Math.max(1, r.totalInterest)), (x) => x.toFixed(2))} · patrimonio final / inicial ${q(a.map((r) => r.bankEquityRatio), (x) => x.toFixed(2))}`);
    console.log(`  desempleo: primeros 5 años ${q(a.map((r) => r.earlyUnemployment), p1)} · últimos 10 ${q(a.map((r) => r.lateUnemployment), p1)} · endeudadas (últ. 10) ${q(a.map((r) => r.lateIndebtedShare), p1)} · deuda/masa sal. ${q(a.map((r) => r.lateDebtToWageBill), (x) => x.toFixed(2))}`);
    console.log(`  criterio Fase 0: inflación A ${q(a.map((r) => r.priceTrend), p2)} · B ${q(b.map((r) => r.priceTrend), p2)} · A < 1% en ${a.filter((r) => Math.abs(r.priceTrend) < 0.01).length}/20 · B > A en ${a.filter((r, i) => b[i]!.priceTrend > r.priceTrend).length}/20`);
  }
}

/**
 * Descomposición de la emisión (pedido de Nico, 2026-11-11): a dónde va la
 * emisión extra de B. Identidad cuantitativa sobre los 50 años visibles:
 * M · V = P · Y, con M = depósitos privados, P = índice de precios, Y =
 * unidades vendidas por mes y V = ventas nominales / M. Tasas anuales
 * logarítmicas entre el promedio del primer año y el del último.
 */
function emissionSection(): void {
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const A: Knobs = PHASE1_CONFIG.knobs!;
  const B: Knobs = { ...A, structuralDeficitShare: 0.5 };
  type Run = Record<string, number>;
  function run(seed: number, knobs: Knobs, stages: readonly Stage[]): Run {
    // A y B se calientan igual (s = 0); B cambia en el mes 0 visible.
    // Las reglas de la Fase 0 no conocen los sectores de R11: sin empresas de capital.
    const capitalFirms = stages === PHASE0_STAGES ? 0 : PHASE1_CONFIG.capitalFirms;
    let s = createWarmState(seed, { ...PHASE1_CONFIG, capitalFirms, knobs, burnInKnobs: { ...knobs, structuralDeficitShare: 0 } }, stages);
    const series: Record<string, number[]> = { M: [], Mh: [], Mf: [], P: [], Y: [], V: [], W: [], N: [], L: [], realM: [] };
    let emission = 0;
    const m0 = privateMoney(s);
    for (let t = 1; t <= 600; t++) {
      s = step(s, knobs, { stages });
      emission += s.fiscal.advancesThisMonth;
      const M = privateMoney(s);
      const Mh = s.households.reduce((a, h) => a + h.positions.deposits, 0);
      const sales = s.firms.reduce((a, f) => a + f.revenue, 0);
      const units = s.firms.reduce((a, f) => a + f.unitsSold, 0);
      const act = s.firms.filter((f) => f.active);
      series.M!.push(M); series.Mh!.push(Mh); series.Mf!.push(M - Mh);
      series.P!.push(s.stats.priceIndex); series.Y!.push(Math.max(1, units)); series.V!.push(sales / M);
      series.W!.push(act.reduce((a, f) => a + f.wage, 0) / act.length); series.N!.push(1 - s.stats.unemployment);
      series.L!.push(Math.max(1, s.bank.positions.loans)); series.realM!.push(M / s.stats.priceIndex);
    }
    const g = (xs: number[]) => {
      const first = xs.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
      const last = xs.slice(-12).reduce((a, b) => a + b, 0) / 12;
      return Math.log(last / first) / 49; // tasa anual logarítmica
    };
    const out: Run = { emissionShareOfM0: emission / m0 };
    for (const k of Object.keys(series)) out[k] = g(series[k]!);
    out.MhShareEnd = series.Mh!.at(-1)! / series.M!.at(-1)!;
    return out;
  }
  function privateMoney(s: SimState): number {
    return s.households.reduce((a, h) => a + h.positions.deposits, 0) + s.firms.reduce((a, f) => a + f.positions.deposits, 0);
  }
  const med = (xs: number[]) => { const t = [...xs].sort((a, b) => a - b); return t[Math.floor(t.length / 2)]!; };
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  console.log('\nA dónde va la emisión — 20 semillas, 2.000 hogares, iniciales calibradas, 50 años visibles. Tasas anuales logarítmicas (medianas). M·V = P·Y\n');
  for (const [name, stages] of [
    ['Reglas de la Fase 0 (R1 corregida, sin crédito)', PHASE0_STAGES],
    ['Reglas de la Fase 1 (R6 con fidelidad, R7 revisada, crédito, quiebras)', PHASE1_STAGES],
  ] as const) {
    const a = seeds.map((seed) => run(seed, A, stages));
    const b = seeds.map((seed) => run(seed, B, stages));
    console.log(name);
    console.log('  variable                         |       A |       B |   B − A');
    const row = (label: string, k: string, f = pct) => {
      const ma = med(a.map((r) => r[k]!)); const mb = med(b.map((r) => r[k]!)); const md = med(a.map((r, i) => b[i]![k]! - r[k]!));
      console.log(`  ${label.padEnd(32)} | ${f(ma).padStart(7)} | ${f(mb).padStart(7)} | ${f(md).padStart(7)}`);
    };
    row('emisión acumulada / M inicial', 'emissionShareOfM0', (x) => x.toFixed(2));
    row('M (depósitos privados)', 'M');
    row('  de hogares', 'Mh');
    row('  de empresas', 'Mf');
    row('V (ventas / M)', 'V');
    row('P (precios)', 'P');
    row('Y (unidades vendidas)', 'Y');
    row('M/P (saldos reales)', 'realM');
    row('W (salario nominal)', 'W');
    row('empleo', 'N');
    row('préstamos del banco', 'L');
    row('hogares / M al final', 'MhShareEnd', (x) => x.toFixed(2));
  }
}

/** R13 revisada (aprobada el 2026-11-11): umbral de racionamiento base y sensibilidad. */
function r13Section(): void {
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const A = PHASE1_CONFIG.knobs!;
  const B = { ...A, structuralDeficitShare: 0.5 };
  const q = (xs: number[], f: (x: number) => string) => {
    const s = [...xs].sort((a, b) => a - b);
    return `${f(s[0]!)} · ${f(s[Math.floor(s.length / 2)]!)} · ${f(s[s.length - 1]!)}`;
  };
  const p1 = (x: number) => `${(x * 100).toFixed(1)}%`;
  const p2 = (x: number) => `${(x * 100).toFixed(2)}%`;
  const firms = PHASE1_CONFIG.firms;
  console.log('\nR13 revisada — reglas aprobadas, iniciales calibradas, 20 semillas, 2.000 hogares, calentamiento de 420 meses desde la creación (A y B igual), 50 años visibles. mín · mediana · máx\n');
  for (const threshold of [0.03, 0.015, 0.06]) {
    const credit = { ...CREDIT, maxDefaultProbability: threshold };
    const a = seeds.map((seed) => runVariant(seed, A, {}, 'cold', undefined, PHASE1_CONFIG, undefined, credit));
    const b = seeds.map((seed) => runVariant(seed, B, {}, 'cold', undefined, PHASE1_CONFIG, undefined, credit));
    const insolvent = a.filter((r) => r.bankInsolventAt !== null);
    const months = a.reduce((acc, r) => {
      for (const k of Object.keys(r.estimatorMonths)) acc[k] = (acc[k] ?? 0) + r.estimatorMonths[k]!;
      return acc;
    }, {} as Record<string, number>);
    const totalMonths = Object.values(months).reduce((x, y) => x + y, 0);
    console.log(`umbral de φ mensual = ${threshold}${threshold === 0.03 ? ' (base)' : ' (sensibilidad)'}`);
    console.log(`  quiebras: primeros 5 años ${q(a.map((r) => r.earlyBankruptcies), (x) => x.toFixed(0))} (= ${q(a.map((r) => r.earlyBankruptcies / 5 / firms), p1)} anual) · 50 años visibles ${q(a.map((r) => r.bankruptciesPerYear / firms), p1)} anual (empírico: 5–10%)`);
    console.log(`  banco: insolvente ${insolvent.length}/20${insolvent.length ? ` (año ${q(insolvent.map((r) => r.bankInsolventAt! / 12), (x) => x.toFixed(0))})` : ''} · castigos / intereses ${q(a.map((r) => r.totalWriteOffs / Math.max(1, r.totalInterest)), (x) => x.toFixed(2))} · patrimonio final / inicial ${q(a.map((r) => r.bankEquityRatio), (x) => x.toFixed(2))}`);
    console.log(`  crédito: préstamos otorgados (millones $, toda la corrida) ${q(a.map((r) => r.totalNewLoans / 1e6), (x) => x.toFixed(1))} · rechazados por racionamiento ${q(a.map((r) => r.rationedByRisk), (x) => x.toFixed(0))} · tasa anual promedio ${q(a.map((r) => r.avgNewLoanRateAnnual), p1)}`);
    console.log(`  tasa real (tasa promedio − inflación de A): ${q(a.map((r) => r.avgNewLoanRateAnnual - r.priceTrend), p1)} · endeudadas (últ. 10 años) ${q(a.map((r) => r.lateIndebtedShare), p1)} · deuda/masa salarial ${q(a.map((r) => r.lateDebtToWageBill), (x) => x.toFixed(2))}`);
    console.log(`  estimador del riesgo (meses, 20 semillas): logística ${months.logistic ?? 0} (${p1((months.logistic ?? 0) / totalMonths)}) · fallback por tramos ${months.bands ?? 0} (${p1((months.bands ?? 0) / totalMonths)}) · frecuencia global ${months.frequency ?? 0} · sin datos ${months.none ?? 0}`);
    console.log(`  desempleo: últimos 10 años ${q(a.map((r) => r.lateUnemployment), p1)} · criterio Fase 0: inflación A ${q(a.map((r) => r.priceTrend), p2)} · B ${q(b.map((r) => r.priceTrend), p2)} · A < 1% en ${a.filter((r) => Math.abs(r.priceTrend) < 0.01).length}/20 · B > A en ${a.filter((r, i) => b[i]!.priceTrend > r.priceTrend).length}/20`);
  }
}

/** R11 (aprobada el 2026-11-11): capital, sector de bienes de capital y venta forzosa; r_K base y sensibilidad. */
function r11Section(): void {
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const A = PHASE1_CONFIG.knobs!;
  const B = { ...A, structuralDeficitShare: 0.5 };
  const q = (xs: number[], f: (x: number) => string) => {
    const s = [...xs].sort((a, b) => a - b);
    return `${f(s[0]!)} · ${f(s[Math.floor(s.length / 2)]!)} · ${f(s[s.length - 1]!)}`;
  };
  const p1 = (x: number) => `${(x * 100).toFixed(1)}%`;
  const p2 = (x: number) => `${(x * 100).toFixed(2)}%`;
  const nC = PHASE1_CONFIG.firms - (PHASE1_CONFIG.capitalFirms ?? 0);
  const nK = PHASE1_CONFIG.capitalFirms ?? 0;
  console.log(`\nR11 — reglas aprobadas, iniciales calibradas, 20 semillas, 2.000 hogares, ${nC} empresas de consumo y ${nK} de capital, calentamiento de 420 meses desde la creación (A y B igual), 50 años visibles. mín · mediana · máx\n`);
  for (const recovery of [0.3, 0.15, 0.5]) {
    const capital = { ...CAPITAL, fireSaleRecovery: recovery };
    const run = (knobs: typeof A) => seeds.map((seed) => runVariant(seed, knobs, {}, 'cold', undefined, PHASE1_CONFIG, undefined, CREDIT, capital));
    const a = run(A);
    const b = run(B);
    const insolvent = a.filter((r) => r.bankInsolventAt !== null);
    console.log(`r_K = ${recovery}${recovery === 0.3 ? ' (base, Ramey & Shapiro, 2001)' : ' (sensibilidad)'}`);
    console.log(`  quiebras por año: consumo ${q(a.map((r) => r.bankruptciesConsumptionPerYear / nC), p1)} · capital ${q(a.map((r) => r.bankruptciesCapitalPerYear / nK), p1)} · total ${q(a.map((r) => r.bankruptciesPerYear / (nC + nK)), p1)} (empírico: 5–10%) · primeros 5 años desde la creación ${q(a.map((r) => r.earlyBankruptcies), (x) => x.toFixed(0))}`);
    console.log(`  ventas forzosas (50 años): con comprador ${q(a.map((r) => r.fireSales), (x) => x.toFixed(0))} · pagadas entre todos ${q(a.map((r) => r.fireSalesPooled), (x) => x.toFixed(0))}`);
    console.log(`  banco: insolvente ${insolvent.length}/20${insolvent.length ? ` (año ${q(insolvent.map((r) => r.bankInsolventAt! / 12), (x) => x.toFixed(0))})` : ''} · castigos / intereses ${q(a.map((r) => r.totalWriteOffs / Math.max(1, r.totalInterest)), (x) => x.toFixed(2))} · patrimonio final / inicial ${q(a.map((r) => r.bankEquityRatio), (x) => x.toFixed(2))}`);
    console.log(`  crédito: tasa anual promedio ${q(a.map((r) => r.avgNewLoanRateAnnual), p1)} · rechazados por racionamiento ${q(a.map((r) => r.rationedByRisk), (x) => x.toFixed(0))} · endeudadas (últ. 10 años) ${q(a.map((r) => r.lateIndebtedShare), p1)} · deuda/masa salarial ${q(a.map((r) => r.lateDebtToWageBill), (x) => x.toFixed(2))}`);
    console.log(`  desempleo: primeros 5 años ${q(a.map((r) => r.earlyUnemployment), p1)} · últimos 10 ${q(a.map((r) => r.lateUnemployment), p1)}`);
    console.log(`  empleo en el sector de capital / ocupados (últ. 10 años): ${q(a.map((r) => r.lateCapitalEmploymentShare), p1)} (objetivo de calibración ~8,3%)`);
    console.log(`  capital: utilización media ${q(a.map((r) => r.lateUtilization), p1)} (normal 85%) · empresas al tope de capacidad ${q(a.map((r) => r.lateAtCapacityShare), p1)} · tendencia anual del capital ${q(a.map((r) => r.capitalTrend), p2)} · pedidos cumplidos ${q(a.map((r) => r.capitalFillRate), p1)} · precio capital / consumo ${q(a.map((r) => r.lateCapitalPriceRatio), (x) => x.toFixed(2))}`);
    console.log(`  criterio Fase 0: inflación A ${q(a.map((r) => r.priceTrend), p2)} · B ${q(b.map((r) => r.priceTrend), p2)} · A < 1% en ${a.filter((r) => Math.abs(r.priceTrend) < 0.01).length}/20 · B > A en ${a.filter((r, i) => b[i]!.priceTrend > r.priceTrend).length}/20 · margen A ${q(a.map((r) => r.lateMarkup), (x) => x.toFixed(2))}`);
  }
}

/**
 * Pedido de Nico (2026-11-11): con R11, una empresa al tope de capacidad con
 * exceso de demanda y precio ≥ promedio no sube el precio (Assenza et al., 2015,
 * ec. 5.1–5.2). ¿Cuánto del achicamiento del efecto de la emisión explica eso?
 * Variantes EXPERIMENTALES: (c) sube el precio al tope; (d) sin tope de capacidad.
 */
function capacitySection(): void {
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const A = PHASE1_CONFIG.knobs!;
  const B = { ...A, structuralDeficitShare: 0.5 };
  const q = (xs: number[], f: (x: number) => string) => {
    const s = [...xs].sort((a, b) => a - b);
    return `${f(s[0]!)} · ${f(s[Math.floor(s.length / 2)]!)} · ${f(s[s.length - 1]!)}`;
  };
  const p1 = (x: number) => `${(x * 100).toFixed(1)}%`;
  const p2 = (x: number) => `${(x * 100).toFixed(2)}%`;
  const nC = PHASE1_CONFIG.firms - (PHASE1_CONFIG.capitalFirms ?? 0);
  console.log('\nRestricción de capacidad y efecto de la emisión — R11 aprobada contra variantes experimentales. 20 semillas, 50 años visibles, A y B calentadas igual. mín · mediana · máx\n');
  for (const [name, exp] of [
    ['R11 aprobada (Assenza: al tope, sin suba de precio)', {}],
    ['(c) al tope de capacidad con exceso de demanda, sube el precio', { priceUpAtCapacity: true }],
    ['(d) sin tope de capacidad (Leontief apagado)', { noCapacityLimit: true }],
  ] as const) {
    const a = seeds.map((seed) => runVariant(seed, A, exp));
    const b = seeds.map((seed) => runVariant(seed, B, exp));
    console.log(name);
    console.log(`  inflación A ${q(a.map((r) => r.priceTrend), p2)} · B ${q(b.map((r) => r.priceTrend), p2)} · B − A ${q(a.map((r, i) => b[i]!.priceTrend - r.priceTrend), p2)} · B > A en ${a.filter((r, i) => b[i]!.priceTrend > r.priceTrend).length}/20 · A < 1% en ${a.filter((r) => Math.abs(r.priceTrend) < 0.01).length}/20`);
    console.log(`  ahorro forzoso / gasto deseado (últ. 10 años): A ${q(a.map((r) => r.lateForcedSavingShare), p1)} · B ${q(b.map((r) => r.lateForcedSavingShare), p1)} · empresas que agotan stock: A ${q(a.map((r) => r.lateSoldOutShare), p1)} · B ${q(b.map((r) => r.lateSoldOutShare), p1)}`);
    console.log(`  al tope de capacidad: A ${q(a.map((r) => r.lateAtCapacityShare), p1)} · B ${q(b.map((r) => r.lateAtCapacityShare), p1)} · utilización A ${q(a.map((r) => r.lateUtilization), p1)}`);
    console.log(`  desempleo (últ. 10 años): A ${q(a.map((r) => r.lateUnemployment), p1)} · B ${q(b.map((r) => r.lateUnemployment), p1)} · margen A ${q(a.map((r) => r.lateMarkup), (x) => x.toFixed(2))} · B ${q(b.map((r) => r.lateMarkup), (x) => x.toFixed(2))}`);
    console.log(`  quiebras por año (consumo): A ${q(a.map((r) => r.bankruptciesConsumptionPerYear / nC), p1)} · salario nominal anual A ${q(a.map((r) => r.wageTrend), p2)} · B ${q(b.map((r) => r.wageTrend), p2)}`);
  }
}
