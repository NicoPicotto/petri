/**
 * P3: V3 que cruza ticks contra el oráculo (reglas-caiani.md, sec. 40; diseño aprobado por Nico el 2026-11-17).
 *
 * Cada tramo corre el port encadenado durante varios ticks seguidos (eventos 0–37, 74 y los bloques del 75 de cada tick)
 * **sin recargar el estado de JMAB**, y compara después de cada paso contra el volcado del oráculo:
 * - **Estado:** uno solo para todo el tramo, armado con `stateFromDump` del principio del primer tick. Entre ticks solo
 *   avanza la ronda (`s.round += 1`; en JMAB, `round++` de `AbstractMacroSimulation`). El volcado del principio del tick
 *   siguiente se lee solo para comparar. Esa comparación tiene que ser **idéntica a la de después del 75 del tick
 *   anterior**: el port arrastra la deriva del tramo y el paso entre ticks no agrega nada.
 * - **Escala y tolerancia:** una sola `ChainScales` para todo el tramo, que no se reinicia. k es global (pasos corridos
 *   desde el principio del tramo, 45 por tick) y la tolerancia de los montos y de la fragilidad de las decisiones es
 *   2k µ (`chainedAmountTol`); la del principio del tick siguiente es la del último paso.
 * - **Sorteos y decisiones, por tick:** `draws.tsv` se lee una vez y se reparte por (tick, evento); cada paso usa un
 *   `OracleCaianiRng` de su tick. Cada tick tiene su registrador en modo oráculo con las decisiones de JMAB de ese tick.
 * - **SFC:** `checkFlows` al final de cada tick sobre la ventana desde el principio del tramo (sin `beginPeriod` entre
 *   ticks: el motor no lee el registro de flujos y la escala necesita el mismo registro toda la cadena).
 * - **Sin corte:** cualquier diferencia es falla, y los pasos siguientes fallan con "falta el estado de la cadena".
 *
 * Suite propia, fuera de `pnpm test` y de `pnpm test:v3`: `pnpm test:v3-chain` (`PETRI_V3_CHAIN=1`). `V3_CHAIN=p3-c50`:
 * solo esos tramos.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { OracleCaianiRng, parseDraws, DecisionRecorder, withDecisions, InputRecorder, withInputs, type CaianiRng, type CaianiState } from '../src/caiani';
import { beginPeriod, checkFlows, type Checkpoint } from '../src/caiani/flows';
import { ChainScales } from './support/chain-scale';
import { decisionsFile, nanFields, readOracleDecisions } from './support/jmab-decisions';
import { V3_CHAIN_RHO, chainedAmountTol, compareState, dumpExists, idMaps, readDump, stateFromDump, type CompareResult, type Dump } from './support/jmab-dump';
import { EVENTS, LAST, afterDump, checkCompare, d1Report, newD1Totals, type D1Totals } from './support/v3-steps';

const V3_TIMEOUT = 300_000;
const ORACLE = fileURLToPath(new URL('../../../reference/p0/runs/oracle/', import.meta.url));

/** Tramos aprobados por Nico (2026-11-16): tres ticks cada uno (corridas de `reference/tools/run-chain-oracle.sh`). */
const CHAINS: { run: string; from: number; to: number; why: string }[] = [
  { run: 'p3-c50', from: 50, to: 52, why: 'referencia sin eventos raros' },
  { run: 'p3-c81', from: 81, to: 83, why: 'quiebras de empresas' },
  { run: 'p3-c146', from: 146, to: 148, why: 'quiebra de un banco' },
  { run: 'p3-s102-c297', from: 297, to: 299, why: 'semilla 102: banco zombi 8258, ratio de capital indeterminado en el 298 y el 299' },
];
const ENABLED = process.env.PETRI_V3_CHAIN === '1';
const ONLY = process.env.V3_CHAIN?.split(',').filter((x) => x.trim() !== '');
const SELECTED = ENABLED ? CHAINS.filter((c) => !ONLY || ONLY.includes(c.run)) : [];
/** Volcados leídos que se guardan (~70 MB cada uno). */
const DUMP_CACHE = 2;

type ChainStep =
  | { name: string; kind: 'start'; tick: number; k: number }
  | { name: string; kind: 'event'; tick: number; k: number; e: number; run: (s: CaianiState, rng: CaianiRng) => void };

/** Lo que se informa de cada tick al final del tramo. */
interface TickStats {
  tick: number;
  steps: number;
  /** k al terminar el tick y la tolerancia de montos correspondiente (µ). */
  kEnd: number;
  /** Mayor diferencia de montos (µ) y mayor cociente diferencia / tolerancia del paso. */
  maxAmountDiff: number;
  maxAmountShare: number;
  maxRelPure: number;
  maxRelFromAmounts: number;
  maxRelFromAmountsWhere: string;
  /** Comparaciones de campos con cociente indeterminado en los dos lados (no se comparan) y cuáles. */
  indeterminateFields: number;
  indeterminateWhich: Set<string>;
  /** Valores que pasaron solo por ρ·S. */
  byScale: number;
  totals: D1Totals;
  maxForcedDistance: number;
  /** Bernoulli con p distinta de la registrada: cuántas, la peor relativa y absoluta, y cuántas pasaron la mitad de la guarda. */
  pN: number;
  pWorstRel: number;
  pWorstAbs: number;
  pWorstWhere: string;
  pOverHalf: number;
  /** Principio del tick: comparación idéntica a la de después del 75 del tick anterior (no hay en el primero). */
  startSame?: boolean;
  flows?: string[];
}

/** Lo que tiene que coincidir entre la comparación de después del 75 y la del principio del tick siguiente. */
const comparable = (r: CompareResult) => ({ total: r.total, diffs: r.diffs, counts: r.counts, amountFields: r.amountFields, doubleFieldsOver: r.doubleFieldsOver, scaled: r.scaled, indeterminate: r.indeterminate });

if (!ENABLED) {
  describe('V3 que cruza ticks', () => {
    it.skip('solo con pnpm test:v3-chain (PETRI_V3_CHAIN=1)', () => {});
  });
}

describe.each(SELECTED)('V3 que cruza ticks, $run (ticks $from–$to: $why; reference/, fuera de git)', ({ run, from, to }) => {
  const dir = `${ORACLE}${run}/state/`;
  const decFile = decisionsFile(`${ORACLE}${run}`);
  const available = dumpExists(dir + afterDump(to, LAST)) && decFile !== undefined;

  const cache = new Map<string, Dump>();
  const dumpOf = (name: string): Dump => {
    let d = cache.get(name);
    if (d) cache.delete(name);
    else d = readDump(dir + name);
    cache.set(name, d);
    while (cache.size > DUMP_CACHE) cache.delete(cache.keys().next().value!);
    return d;
  };

  // Pasos: el principio del tramo (test aparte), después, por tick, el principio del tick (salvo el primero) y sus eventos.
  const steps: ChainStep[] = [];
  let k = 0;
  for (let t = from; t <= to; t++) {
    if (t > from) steps.push({ name: `principio del tick ${t} (k = ${k})`, kind: 'start', tick: t, k });
    for (const x of EVENTS) {
      k++;
      steps.push({ name: `tick ${t}, evento ${x.e} (paso ${k})`, kind: 'event', tick: t, k, e: x.e, run: x.run });
    }
  }
  const totalSteps = steps.length;

  /** Estado de la cadena; `undefined` después de una falla (los pasos siguientes fallan con "falta el estado"). */
  let s: CaianiState | undefined;
  let scales: ChainScales | undefined;
  let cp: Checkpoint | undefined;
  let toJ: ((id: number) => number) | undefined;
  let done = 0;
  let lastEnd: CompareResult | undefined;
  const stats = new Map<number, TickStats>();
  const statsOf = (tick: number): TickStats => {
    let x = stats.get(tick);
    if (!x)
      stats.set(
        tick,
        (x = {
          tick,
          steps: 0,
          kEnd: 0,
          maxAmountDiff: 0,
          maxAmountShare: 0,
          maxRelPure: 0,
          maxRelFromAmounts: 0,
          maxRelFromAmountsWhere: '',
          indeterminateFields: 0,
          indeterminateWhich: new Set(),
          byScale: 0,
          totals: newD1Totals(),
          maxForcedDistance: 0,
          pN: 0,
          pWorstRel: 0,
          pWorstAbs: 0,
          pWorstWhere: '',
          pOverHalf: 0,
        }),
      );
    return x;
  };

  // Sorteos: se leen una vez y se reparten por (tick, evento).
  let draws: Map<string, ReturnType<typeof parseDraws>> | null = null;
  const drawsOf = (tick: number, e: number) => {
    if (!draws) {
      draws = new Map();
      for (const r of parseDraws(readFileSync(`${ORACLE}${run}/draws.tsv`, 'utf8'))) {
        const key = `${r.tick}:${r.event}`;
        const list = draws.get(key);
        if (list) list.push(r);
        else draws.set(key, [r]);
      }
    }
    return draws.get(`${tick}:${e}`) ?? [];
  };
  // Un registrador por tick, en modo oráculo con las decisiones de JMAB de ese tick.
  const recorders = new Map<number, DecisionRecorder>();
  const recorderOf = (tick: number): DecisionRecorder => {
    let rec = recorders.get(tick);
    if (!rec) {
      rec = new DecisionRecorder();
      rec.oracle = readOracleDecisions(decFile!, tick);
      rec.toJmab = toJ!;
      // En el encadenado la fragilidad de los montos es 2k µ, sin corrección de entrada (como el V3 de un tick).
      rec.inputError = null;
      recorders.set(tick, rec);
    }
    return rec;
  };

  afterAll(() => {
    cache.clear();
    draws = null;
    recorders.clear();
    s = undefined;
    scales = undefined;
    cp = undefined;
  });
  afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));

  it.skipIf(!available)(`principio del tramo: el estado reconstruido del volcado del tick ${from} coincide con el volcado`, () => {
    const d = dumpOf(`tick-${from}.jsonl`);
    const st = stateFromDump(d);
    // Ventana del SFC acumulado: desde el principio del tramo (antes de armar la escala, que toma el registro de flujos).
    cp = beginPeriod(st.ledger);
    toJ = idMaps(d.meta).toJ;
    scales = new ChainScales(st, V3_CHAIN_RHO, toJ);
    // Valores al empezar la cadena: S = |v₀|.
    const r = compareState(st, d, { scale: scales });
    scales.commit();
    expect(r.diffs).toEqual([]);
    expect(r.counts.maxAmountDiff).toBe(0);
    s = st;
  }, V3_TIMEOUT);

  const runStart = (step: Extract<ChainStep, { kind: 'start' }>) => {
    const st = s;
    const sc = scales;
    if (!st || !sc || !lastEnd) throw new Error('falta el estado de la cadena (falló un paso anterior)');
    let ok = false;
    try {
      // Corredor de ticks: lo único que cambia entre el final del 75 y el principio del tick siguiente es la ronda.
      st.round += 1;
      expect(st.round).toBe(step.tick);
      const d = dumpOf(`tick-${step.tick}.jsonl`);
      // El mapa de ids no cambia en el tramo (la población es fija; el evento 74 está vacío).
      const toJt = idMaps(d.meta).toJ;
      for (const a of [...st.households, ...st.consumptionFirms, ...st.capitalFirms, ...st.banks, st.government, st.centralBank]) {
        expect(toJt(a.id)).toBe(toJ!(a.id));
      }
      const r = compareState(st, d, { amountTol: chainedAmountTol(step.k), scale: sc });
      try {
        checkCompare(r, step.tick, `cadena ${run}, principio del tick ${step.tick}`, -1, true);
        // Idéntica a la de después del 75 del tick anterior: el paso entre ticks no agrega nada.
        const same = JSON.stringify(comparable(r)) === JSON.stringify(comparable(lastEnd));
        statsOf(step.tick).startSame = same;
        expect(comparable(r)).toEqual(comparable(lastEnd));
      } finally {
        sc.commit();
      }
      done++;
      ok = true;
    } finally {
      if (!ok) s = undefined;
    }
  };

  const runEvent = (step: Extract<ChainStep, { kind: 'event' }>) => {
    const st = s;
    const sc = scales;
    if (!st || !sc || !toJ || !cp) throw new Error('falta el estado de la cadena (falló un paso anterior)');
    const { tick, e } = step;
    const ts = statsOf(tick);
    let ok = false;
    try {
      const rng = new OracleCaianiRng(drawsOf(tick, e), { agentId: toJ });
      rng.tick = tick;
      const rec = recorderOf(tick);
      rec.amountTolerance = chainedAmountTol(step.k);
      const forcedFrom = rec.forced.length;
      const snap = sc.snapshot();
      const inputs = new InputRecorder();
      withDecisions(rec, e, () => withInputs(inputs, () => step.run(st, rng)));
      expect(rng.remaining).toBe(0);
      // Los bloques del 75 comparten la secuencia de JMAB: se cierra con el último.
      if (Number.isInteger(e) || e === LAST) rec.finishEvent(Math.floor(e));
      const label = `cadena ${run}, tick ${tick}, evento ${e} (paso ${step.k})`;
      ts.maxForcedDistance = Math.max(ts.maxForcedDistance, d1Report(ts.totals, tick, label, e, rec, forcedFrom, toJ));
      expect(nanFields(st, toJ)).toEqual([]);
      const created = sc.propagate(snap);
      sc.propagateInputs(inputs);
      if (created > 0) console.log(`Escala propagada, ${label}: ${created} bienes de consumo nuevos`);
      for (const d of rng.pDiffs) {
        const abs = Math.abs(d.logged - d.port);
        const rel = abs / Math.max(Math.abs(d.logged), Math.abs(d.port));
        ts.pN++;
        if (rel > ts.pWorstRel) {
          ts.pWorstRel = rel;
          ts.pWorstWhere = `evento ${e}, ${d.site}, p = ${d.logged}`;
        }
        ts.pWorstAbs = Math.max(ts.pWorstAbs, abs);
        if (abs > d.guard / 2) ts.pOverHalf++;
      }
      const tol = chainedAmountTol(step.k);
      const r = compareState(st, dumpOf(afterDump(tick, e)), { amountTol: tol, scale: sc });
      try {
        checkCompare(r, tick, label, e, true);
      } finally {
        sc.commit();
      }
      ts.steps++;
      ts.kEnd = step.k;
      ts.maxAmountDiff = Math.max(ts.maxAmountDiff, r.counts.maxAmountDiff);
      ts.maxAmountShare = Math.max(ts.maxAmountShare, r.counts.maxAmountDiff / tol);
      ts.maxRelPure = Math.max(ts.maxRelPure, r.counts.maxRelPure);
      if (r.counts.maxRelFromAmounts > ts.maxRelFromAmounts) {
        ts.maxRelFromAmounts = r.counts.maxRelFromAmounts;
        ts.maxRelFromAmountsWhere = `evento ${e}, ${r.maxRelFromAmountsWhere}`;
      }
      ts.byScale += Object.values(r.scaled).reduce((a, v) => a + v.byScale, 0);
      ts.indeterminateFields += r.indeterminate.length;
      for (const x of r.indeterminate) ts.indeterminateWhich.add(x);
      if (e === LAST) {
        lastEnd = r;
        // SFC acumulado desde el principio del tramo.
        const flows = checkFlows(st.ledger, cp);
        ts.flows = flows;
        expect(flows).toEqual([]);
      }
      done++;
      ok = true;
    } finally {
      if (!ok) s = undefined;
    }
  };

  it.skipIf(!available).each(steps.map((x) => [x.name, x] as const))('%s', (_name, step) => (step.kind === 'start' ? runStart(step) : runEvent(step)), V3_TIMEOUT);

  it.skipIf(!available)('informe del tramo', () => {
    const rows: string[] = [];
    const sum = newD1Totals();
    for (const x of stats.values()) {
      for (const key of Object.keys(sum) as (keyof D1Totals)[]) sum[key] += x.totals[key];
      rows.push(
        `tick ${x.tick}: ${x.steps} pasos (k al final ${x.kEnd}, tolerancia ${chainedAmountTol(x.kEnd)} µ)` +
          (x.startSame === undefined ? '' : `; principio del tick idéntico al final del anterior: ${x.startSame ? 'sí' : 'NO'}`) +
          `\n    montos: diferencia máx ${x.maxAmountDiff} µ (${(100 * x.maxAmountShare).toFixed(1)}% de la tolerancia del paso); double: máx relativo puro ${x.maxRelPure.toExponential(2)}, de montos ${x.maxRelFromAmounts.toExponential(2)}${x.maxRelFromAmountsWhere ? ` (${x.maxRelFromAmountsWhere})` : ''}; ${x.byScale} valores pasan solo por ρ·S` +
          `\n    d1: frágiles ${x.totals.forced}, R2 ${x.totals.residue}, indeterminadas ${x.totals.indeterminate}, alarmas ${x.totals.alarms}, líneas consumidas sin evaluar ${x.totals.consumed}, distancia máx del port ${x.maxForcedDistance.toPrecision(3)}` +
          `\n    Bernoulli con p distinta: ${x.pN}, peor relativa ${x.pWorstRel.toExponential(2)} (${x.pWorstWhere || '—'}), peor absoluta ${x.pWorstAbs.toExponential(2)}, ${x.pOverHalf} sobre la mitad de la guarda` +
          (x.indeterminateFields > 0 ? `\n    cociente indeterminado en los dos lados (no se compara): ${x.indeterminateFields} comparaciones de ${[...x.indeterminateWhich].join(', ')}` : '') +
          `\n    SFC acumulado desde el tick ${from}: ${x.flows === undefined ? 'sin correr' : x.flows.length === 0 ? 'cierra' : `${x.flows.length} problemas`}`,
      );
    }
    const complete = done === totalSteps;
    console.log(
      `=== V3 que cruza ticks, ${run} (ticks ${from}–${to})\n  ${rows.join('\n  ')}\n  ` +
        (complete
          ? `tramo completo: ${totalSteps} pasos, k = ${k}; ${sum.forced + sum.residue + sum.indeterminate} forzadas (frágiles ${sum.forced}, R2 ${sum.residue}, indeterminadas ${sum.indeterminate}), ${sum.alarms} alarmas`
          : `tramo INCOMPLETO: ${done} de ${totalSteps} pasos`),
    );
    expect(done).toBe(totalSteps);
  });
});
