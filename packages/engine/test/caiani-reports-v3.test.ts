/**
 * P4: V3 de los 8 reportes de V4 contra el .jar (aprobado por Nico el 2026-11-17; docs/reglas-caiani.md, sec. 41). Para
 * cada corrida de referencia: el estado después del evento 37 (`stateFromDump` del volcado de JMAB; los reportes 38–73 corren
 * ahí), `caianiReports`, y la fila de ese tick de los CSV del .jar de la misma corrida (`data/<serie>1.csv`).
 * Tolerancias (sec. 1): el desempleo, exacto (cuenta de enteros); lo demás sale de montos: 10⁻⁶ relativo con un piso de 2 µ
 * (2·10⁻⁶ unidades); NaN solo contra NaN. Suites como el V3: `pnpm test`, ticks 50 y 108; `PETRI_V3=full`, las 12 corridas;
 * `V3_TICKS=…`, esas. Sin `reference/` (fuera de git), se saltea.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { caianiReports } from '../src/caiani';
import { dumpExists, idMaps, readDump, stateFromDump } from './support/jmab-dump';
import { ALL_RUNS } from './support/v3-runs';

const ORACLE = fileURLToPath(new URL('../../../reference/p0/runs/oracle/', import.meta.url));
const FULL = process.env.PETRI_V3 === 'full';
const ONLY = process.env.V3_TICKS?.split(',').map(Number);
const RUNS = ALL_RUNS.filter((r) => (ONLY ? ONLY.includes(r.tick) : FULL || [50, 108].includes(r.tick)));

/** Fila del tick en un CSV del .jar (sin la primera columna, que es el tick). */
function csvRow(run: string, series: string, tick: number): number[] {
  const line = readFileSync(`${ORACLE}${run}/data/${series}1.csv`, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${tick},`));
  if (!line) throw new Error(`${run}: ${series}1.csv sin la fila del tick ${tick}`);
  return line.split(',').slice(1).map(Number);
}

const close = (port: number, jar: number) =>
  Number.isNaN(jar) ? Number.isNaN(port) : Math.abs(port - jar) <= Math.max(1e-6 * Math.abs(jar), 2e-6);
const rel = (port: number, jar: number) => (port === jar ? 0 : Math.abs(port - jar) / Math.max(Math.abs(jar), 2));

describe.each(RUNS)('V3 de los reportes, $run (tick $tick)', ({ run, tick }) => {
  const dump = `${ORACLE}${run}/state/tick-${tick}-ev-37.jsonl`;
  it.skipIf(!dumpExists(dump))('los 8 reportes después del evento 37 coinciden con los CSV del .jar', () => {
    const d = readDump(dump);
    const s = stateFromDump(d);
    const r = caianiReports(s);
    const worst: string[] = [];
    const check = (series: string, port: number[], jar: number[]) => {
      expect(port.length, `${series}: columnas`).toBe(jar.length);
      let w = 0;
      port.forEach((p, i) => {
        expect(close(p, jar[i]!), `${series}[${i}]: port ${p}, .jar ${jar[i]}`).toBe(true);
        if (Number.isFinite(jar[i]!)) w = Math.max(w, rel(p, jar[i]!));
      });
      worst.push(`${series} ${w.toExponential(1)}`);
    };
    expect(r.unemployment).toBe(csvRow(run, 'unemployment', tick)[0]);
    check('cAvPrice', [r.cAvPrice], csvRow(run, 'cAvPrice', tick));
    check('kAvPrice', [r.kAvPrice], csvRow(run, 'kAvPrice', tick));
    check('hhAvNetIncome', [r.hhAvNetIncome], csvRow(run, 'hhAvNetIncome', tick));
    // Columnas por empresa: orden de id de JMAB (el mapeo de ids es monótono dentro de cada población).
    const { toJ } = idMaps(d.meta);
    const jIds = r.consumptionFirmIds.map(toJ);
    expect(jIds).toEqual([...jIds].sort((x, y) => x - y));
    check('cFirmsRealSales', r.cFirmsRealSales, csvRow(run, 'cFirmsRealSales', tick));
    check('cFirmsRealInvestment', r.cFirmsRealInvestment, csvRow(run, 'cFirmsRealInvestment', tick));
    check('aggCFBS', r.aggCFBS, csvRow(run, 'aggCFBS', tick));
    check('aggBBS', r.aggBBS, csvRow(run, 'aggBBS', tick));
    console.log(`${run}: peor diferencia relativa: ${worst.join(', ')}`);
  }, 300_000);
});
