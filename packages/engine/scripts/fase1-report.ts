/**
 * Reporte de la Fase 1. Por ahora, el diagnóstico con G = 0 (paso 1a.0):
 * ¿por qué la economía privada no se sostiene sola con las reglas de la Fase 0?
 *
 * Uso: pnpm --filter @petri/engine report:fase1 [g0|escala]
 *   g0:     diagnóstico con G = 0 (paso 1a.0).
 *   escala: volatilidad según el tamaño de la cápsula (paso 1a.1).
 *   Sin argumento corre todo.
 */

import { runG0Diagnostic, summarize, type DiagSummary, type G0Scenario } from '../test/helpers/diagnostics';
import { SCALE_MONTHS, SIZES, runVolatility, type VolatilityRun } from '../test/helpers/scale';

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
