/**
 * Reporte del criterio de salida de la Fase 0: distribución de la inflación de
 * A (s = 0) y B (s = 0,5) en 20 semillas, y emisión acumulada.
 *
 * Uso: pnpm --filter @petri/engine report:fase0
 */

import { PHASE0_CONFIG } from '../src/index';
import { KNOBS_A, KNOBS_B, MONTHS, SEEDS, burnInTail, runCapsule, slope, type RunSummary } from '../test/helpers/phase0Criteria';

const pct = (x: number, d = 2) => `${(x * 100).toFixed(d)}%`;

function quantiles(xs: number[]): string {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))] as number;
  return `mín ${pct(q(0))} · p25 ${pct(q(0.25))} · mediana ${pct(q(0.5))} · p75 ${pct(q(0.75))} · máx ${pct(q(1))}`;
}

function correlation(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

const runsA: RunSummary[] = SEEDS.map((seed) => runCapsule(seed, KNOBS_A));
const runsB: RunSummary[] = SEEDS.map((seed) => runCapsule(seed, KNOBS_B));

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const burnIn = PHASE0_CONFIG.burnInTicks ?? 0;
console.log(`Calentamiento: ${burnIn} meses. Últimos 24 meses por semilla:\n`);
console.log('semilla | desempleo: media  pend. (pp/año) | margen precio/costo: media  pend. (/año)');
const tails = SEEDS.map((seed) => burnInTail(seed));
for (const t of tails) {
  console.log(
    `${String(t.seed).padStart(7)} | ${pct(mean(t.unemployment), 1).padStart(15)}  ${(slope(t.unemployment) * 1200).toFixed(2).padStart(14)} | ${mean(t.markup).toFixed(3).padStart(26)}  ${(slope(t.markup) * 12).toFixed(4).padStart(11)}`,
  );
}
const uS = tails.map((t) => slope(t.unemployment) * 12);
const mS = tails.map((t) => slope(t.markup) * 12);
console.log(
  `  pendiente media: desempleo ${(mean(uS) * 100).toFixed(2)} pp/año (${uS.filter((x) => x < 0).length}/20 negativas) · margen ${mean(mS).toFixed(4)}/año (${mS.filter((x) => x < 0).length}/20 negativas)\n`,
);

console.log(`Fase 0 — ${SEEDS.length} semillas, ${MONTHS / 12} años visibles, tendencia medida desde el mes 0\n`);
console.log('semilla | A: tend. anual  emis.acum/gasto  dinero×  precios×  desempleo | B: tend. anual  emis.acum/gasto  desempleo');
SEEDS.forEach((seed, i) => {
  const a = runsA[i]!;
  const b = runsB[i]!;
  console.log(
    `${String(seed).padStart(7)} | ${pct(a.annualTrend).padStart(13)}  ${pct(a.cumulativeEmissionShare, 1).padStart(15)}  ${a.moneyGrowth.toFixed(2).padStart(6)}  ${a.priceGrowth.toFixed(2).padStart(8)}  ${pct(a.lateUnemployment, 1).padStart(9)} | ${pct(b.annualTrend).padStart(13)}  ${pct(b.cumulativeEmissionShare, 1).padStart(15)}  ${pct(b.lateUnemployment, 1).padStart(9)}`,
  );
});
console.log('\nInflación (tendencia anual):');
console.log(`  A (s = 0):   ${quantiles(runsA.map((r) => r.annualTrend))}`);
console.log(`  B (s = 0,5): ${quantiles(runsB.map((r) => r.annualTrend))}`);
console.log('\nEmisión efectiva acumulada (emisión / gasto, desde el mes 0):');
console.log(`  A: ${quantiles(runsA.map((r) => r.cumulativeEmissionShare))}`);
console.log(`  B: ${quantiles(runsB.map((r) => r.cumulativeEmissionShare))}`);
console.log(
  `\nCorrelación entre semillas, en A: emisión acumulada vs. tendencia de precios = ${correlation(
    runsA.map((r) => r.cumulativeEmissionShare),
    runsA.map((r) => r.annualTrend),
  ).toFixed(2)}`,
);
console.log(
  `Correlación entre semillas, en A: crecimiento del dinero vs. de los precios = ${correlation(
    runsA.map((r) => r.moneyGrowth),
    runsA.map((r) => r.priceGrowth),
  ).toFixed(2)}`,
);
