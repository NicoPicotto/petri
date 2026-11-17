/**
 * P3: V3 por evento contra el oráculo (los casos a mano de cada evento están en caiani-events.test.ts). Registro en
 * docs/reglas-caiani.md (sec. 1: método, tolerancias y suites).
 *
 * Método: el oráculo vuelca el estado antes y después del evento e del tick t (`DUMP_TICKS`, `DUMP_EVENTS`); el port
 * arranca del estado "antes" (reconstruido con `stateFromDump`), corre el evento con el `Rng` en modo oráculo y se
 * compara con el estado "después" (evento suelto); además corre los eventos encadenados desde el principio del tick.
 *
 * Suites (decisión de Nico, 2026-11-14):
 * - `pnpm test` (día a día): `PETRI_V3` sin definir = modo rápido: solo el evento suelto, en los ticks 50 y 108.
 * - `pnpm test:v3` (para cerrar cada tanda de eventos): `PETRI_V3=full`: todas las corridas, suelto y encadenado, de a
 *   un archivo por vez. Ninguna tanda se cierra sin esta suite en verde.
 * - `V3_EVENTS=26,27`: solo el suelto de esos eventos (en modo completo, el encadenado corre hasta el último de ellos).
 *   `V3_TICKS=128`: solo esas corridas (en cualquier modo).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  OracleCaianiRng,
  creditMarketEvent,
  reservesMarketBaselEvent,
  parseDraws,
  contractIds,
  MKT,
  LAG,
  DecisionRecorder,
  compareOutcomes,
  summarizeDecisions,
  withDecisions,
  DerivedRecorder,
  withDerived,
  InputRecorder,
  withInputs,
  scaleTerms,
  type InputTerm,
  type CaianiRng,
  type CaianiState,
} from '../src/caiani';
import { ChainScales } from './support/chain-scale';
import { InputCarry } from './support/input-carry';
import { decisionsFile, nanFields, readOracleDecisions } from './support/jmab-decisions';
import { EVENTS, LAST, afterDump, checkCompare, d1Report as d1EventReport, lastEdges, newD1Totals, prevEvent, resetLastEdges } from './support/v3-steps';
import type { OracleDecision } from '../src/caiani';
import { INPUT_FIELDS, INPUT_VALUES, V3_CHAIN_RHO, chainedAmountTol, compareState, dumpExists, idMaps, readDump, stateFromDump, type Dump, type ScaleSource } from './support/jmab-dump';

/**
 * Tiempo máximo de cada test del V3: 5 minutos. Con la máquina cargada (otras corridas, el oráculo) un evento que
 * tarda segundos puede pasar de los 2 minutos y dar un falso vencimiento (pedido de Nico, 2026-11-13).
 */
const V3_TIMEOUT = 300_000;

const ORACLE = fileURLToPath(new URL('../../../reference/p0/runs/oracle/', import.meta.url));

/** Corridas de referencia: volcados al principio del tick y después de los eventos 0–37 (semilla 12345 salvo la 293). */
const ALL_RUNS: { run: string; tick: number; only?: readonly number[] }[] = [
  { run: 'p3-t1', tick: 1 },
  { run: 'p3-t50', tick: 50 },
  // Una quiebra por deuda en el evento 20 (empresa 8168) y cuatro por salarios en el 21.
  { run: 'p3-t81', tick: 81 },
  // Quiebras con dos depósitos: 8164 y 8182 en el evento 20; 8159 en el 21 (aporte de los dueños = toda la pérdida).
  // Ejercita el techo sobre el neto (evento 19: depósito que cobra y paga todo) y el aporte negativo (evento 20:
  // la pérdida total de 8164 cruza 0 en el último hogar). reglas-caiani.md, sec. 18 y 19.
  { run: 'p3-t108', tick: 108 },
  // Semilla 102: el único adelanto del BC con saldo en el tick 292 (banco 8256, 994,90) se paga en el evento 23.
  // Evento 10: la empresa 8204 pide 6,6·10⁻¹⁴ de crédito (residuo de JMAB); en µ es 0 y el port la desactiva: decisión
  // frágil dada vuelta, informada y no falla; el encadenado se corta ahí (reglas-caiani.md, sec. 22).
  { run: 'p3-s102-t293', tick: 293 },
  // Primer episodio del depósito de una quiebra que la empresa sigue usando: 8164 quiebra con dos depósitos en el
  // evento 21 y en el 27 elige el banco del segundo, que quedó fuera de la lista del banco (reglas-caiani.md, sec. 19).
  { run: 'p3-t128', tick: 128 },
  // Quiebra de un banco (evento 28): 8259, con préstamos (reglas-caiani.md, sec. 27).
  { run: 'p3-t133', tick: 133 },
  // Semilla 102, en la racha de 8258 (ticks 297–314): quiebra todos los trimestres sin préstamos y el rescate la deja en
  // patrimonio 0 (reglas-caiani.md, sec. 27).
  { run: 'p3-s102-t300', tick: 300 },
  // Quiebra de un banco con el encadenado completo hasta el evento 28 (candidatas, 2026-11-14): 8255 en el 146 y 8253
  // en el 161 (semilla 12345).
  { run: 'p3-t146', tick: 146 },
  { run: 'p3-t161', tick: 161 },
  // Semilla 102, tick 292: el único tick conocido con un pedido de adelantos de Basilea positivo (banco 8256, 994,90,
  // evento 36) y el mercado del evento 37 abierto (reglas-caiani.md, sec. 29 y 35). Volcados 0–37, 74 y 75 y el
  // principio del tick 293 (para la V3 que cruza ticks). El encadenado se corta en el evento 10 (8204 pide un crédito
  // residual, como en los ticks 293 y 300): el 36 y el 37 con el mercado abierto quedan verificados solo en el suelto.
  { run: 'p3-s102-t292', tick: 292 },
  // Semilla 104, tick 103 (2026-11-16): hogares con cantidad entera 0 en el evento 75 (uno con bienes truncados a 0 y tres
  // sin bienes; vigilancia `p3-hh0-s*`, reglas-caiani.md, sec. 39).
  // En el evento 19 hay una decisión frágil dada vuelta respecto de JMAB (8202: "depósito < monto" a distancia 0, como en
  // el tick 133) que arrastraba a otros agentes del mismo evento; hasta d1 corría solo los bloques del 75. Con d1 (el
  // registro de decisiones del oráculo) se toma la rama de JMAB y el tick corre entero (paso 6, 2026-11-17).
  { run: 'p3-s104-t103', tick: 103 },
];

/**
 * Ramas que el V3 alcanza y que esperan una decisión de Nico: el evento tira un error explícito y el test verifica
 * que sea ese (y no otro). Se sacan de acá cuando la rama se porta. Hoy, ninguna.
 */
const PENDING: { tick: number; event: number; error: RegExp; why: string }[] = [];
const pendingOf = (tick: number, event: number) => PENDING.find((p) => p.tick === tick && p.event === event);

/** Modo de la suite (encabezado del archivo): rápido (por defecto) o completo (`PETRI_V3=full`). */
const FULL = process.env.PETRI_V3 === 'full';
/** Ticks del modo rápido (Nico, 2026-11-14): 50 (el que ejercita las ramas) y 108 (quiebras con dos depósitos). */
const QUICK_TICKS = [50, 108];
const listEnv = (name: string) => process.env[name]?.split(',').filter((x) => x.trim() !== '').map(Number);
const ONLY_TICKS = listEnv('V3_TICKS');
const ONLY_EVENTS = listEnv('V3_EVENTS');
const RUNS = ALL_RUNS.filter((r) => (ONLY_TICKS ? ONLY_TICKS.includes(r.tick) : FULL || QUICK_TICKS.includes(r.tick)));
/** Eventos del suelto y del encadenado (el encadenado necesita todos los anteriores: corre hasta el último pedido). */
const SINGLE = new Set(EVENTS.filter((x) => !ONLY_EVENTS || ONLY_EVENTS.includes(x.e)).map((x) => x.e));
const CHAIN_LAST = !FULL ? -1 : ONLY_EVENTS ? Math.max(...ONLY_EVENTS) : LAST;
/**
 * Pasos de cada corrida, intercalados: el suelto del evento e y después el encadenado hasta e. Así el volcado
 * "después de e" lo usan seguidos el suelto de e, el encadenado de e y el suelto de e + 1, y con la caché de dos
 * volcados se lee una sola vez (leer un volcado tarda ~0,8 s; reglas-caiani.md, sec. 1, "Suites").
 */
type Step = { name: string; kind: 'single' | 'chained'; k: number; e: number; run: (s: CaianiState, rng: CaianiRng) => void };
const STEPS: Step[] = [];
EVENTS.forEach((x, k) => {
  if (SINGLE.has(x.e)) STEPS.push({ name: `evento ${x.e} desde el volcado anterior`, kind: 'single', k, e: x.e, run: x.run });
  if (x.e <= CHAIN_LAST) STEPS.push({ name: `encadenado desde el principio del tick, hasta el evento ${x.e}`, kind: 'chained', k, e: x.e, run: x.run });
});
/** Volcados leídos que se guardan por corrida (~70 MB cada uno). */
const DUMP_CACHE = 2;

describe.each(RUNS)('V3 por evento contra el oráculo, tick $tick (reference/, fuera de git)', ({ run, tick, only }) => {
  // Una corrida con `only`: solo el suelto de esos eventos.
  const steps = only ? STEPS.filter((x) => x.kind === 'single' && only.includes(x.e)) : STEPS;
  const dir = `${ORACLE}${run}/state/`;
  // Caché de los últimos volcados leídos (`stateFromDump` y `compareState` no los modifican: copian lo que toman).
  const cache = new Map<string, Dump>();
  const dumpOf = (name: string): Dump => {
    let d = cache.get(name);
    if (d) cache.delete(name);
    else d = readDump(dir + name);
    cache.set(name, d);
    while (cache.size > DUMP_CACHE) cache.delete(cache.keys().next().value!);
    return d;
  };
  afterAll(() => {
    // Memoria: lo que la corrida ya no usa (volcados, sorteos, estado del encadenado, registros de decisiones).
    cache.clear();
    drawsCache = null;
    chainedState = undefined;
    scales = undefined;
    single = new DecisionRecorder();
    chained = new DecisionRecorder();
    oracleCache = null;
  });
  /**
   * Registro de decisiones del oráculo (d1, paso 4; inventario-decisiones, sec. I–J): si la corrida lo tiene, los dos
   * registradores van en modo oráculo (se toma la rama de JMAB solo en las frágiles de los dos lados, R2 sobre residuos;
   * una decisión sin par es falla) y cada evento informa las forzadas, las líneas consumidas sin evaluar y los NaN (R4).
   */
  const decFile = decisionsFile(`${ORACLE}${run}`);
  let oracleCache: Map<number, OracleDecision[]> | null = null;
  const oracleLines = () => (oracleCache ??= readOracleDecisions(decFile!, tick));
  /** Totales del modo oráculo, para el resumen de la corrida. */
  const d1Totals = { single: newD1Totals(), chained: newD1Totals() };
  const d1Report = (mode: 'single' | 'chained', label: string, e: number, rec: DecisionRecorder, from: number) => {
    if (!decFile) return;
    d1EventReport(d1Totals[mode], tick, label, e, rec, from, toJ!);
  };
  const before = `tick-${tick}.jsonl`;
  const after = (e: number) => afterDump(tick, e);
  const available = dumpExists(dir + after(LAST));
  // Registro de sorteos: se lee al primer uso y se suelta al terminar la corrida (con 10 corridas, leerlos todos al
  // recolectar los tests llenaba el heap de 4 GB; 2026-11-14).
  let drawsCache: ReturnType<typeof parseDraws> | null = null;
  const draws = () => (drawsCache ??= available ? parseDraws(readFileSync(`${ORACLE}${run}/draws.tsv`, 'utf8')) : []);
  let toJ: ((id: number) => number) | undefined;
  const drawsOf = (event: number) => {
    toJ ??= idMaps(dumpOf(before).meta).toJ;
    const rng = new OracleCaianiRng(
      draws().filter((r) => r.tick === tick && r.event === event),
      { agentId: toJ },
    );
    rng.tick = tick;
    return rng;
  };
  /**
   * Compara contra el volcado y falla con las diferencias que superan la tolerancia. Los campos de
   * `REPORTED_FIELDS` (en su modalidad) que la superan se informan aparte y no hacen fallar el test
   * (reglas-caiani.md, sec. 1, "Tolerancias": campos reportados). Sin `amountTol`, es el evento suelto.
   */
  /**
   * Toda diferencia de estado que no sea un campo reportado es falla. La excusa de las decisiones frágiles dadas vuelta
   * (decisión de Nico, 2026-11-13) se sacó en el paso 6 de d1 (2026-11-17): con el registro de decisiones del oráculo, una
   * frágil distinta se resuelve tomando la rama de JMAB (reglas-caiani.md, sec. 1 y 40; docs/inventario-decisiones.md).
   */
  const check = (s: CaianiState, name: string, label: string, event: number, amountTol?: number, scale?: ScaleSource, carry?: InputCarry, derived?: DerivedRecorder): void => {
    const chained = amountTol !== undefined;
    // Agregados derivados (evento suelto): k µ + el error de entrada de los contratos anotados por el motor.
    const derivedTol =
      derived && carry
        ? (agent: number, field: string) => {
            const t = derived.of(agent, field);
            if (!t) return undefined;
            let e = 0;
            for (const c of t.contracts) e += Math.abs(carry.carry(c));
            return t.rounded + e;
          }
        : undefined;
    const edges = !chained && lastEdges() ? (c: number) => lastEdges()!.get(c) : undefined;
    const r = compareState(s, dumpOf(name), { amountTol, scale, carry: carry?.carry, initialCarry: carry?.initialCarry, derived: derivedTol, derivedValue: carry?.valueCarry, edges });
    checkCompare(r, tick, label, event, chained);
  };
  /** Registro de decisiones de cada modalidad (lo llenan los dos tests de abajo; vitest los corre en orden). */
  let single = new DecisionRecorder();
  let chained = new DecisionRecorder();

  it.skipIf(!available)('el estado reconstruido desde un volcado coincide con el volcado', () => {
    const d = dumpOf(before);
    const r = compareState(stateFromDump(d), d);
    expect(r.diffs).toEqual([]);
    expect(r.counts.maxAmountDiff).toBe(0);
  }, V3_TIMEOUT);

  // Entre test y test vitest solo espera microtareas: sin ceder una macrotarea, el worker no atiende los
  // mensajes de su RPC durante todo el archivo y, pasado el minuto (con los eventos 11–14), vence el
  // temporizador de una llamada ("Timeout calling onTaskUpdate") aunque los tests pasen.
  afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));

  /** Estado del encadenado: arranca del volcado del principio del tick y lo avanza cada test de abajo. */
  let chainedState: CaianiState | undefined;
  /** Escalas de los flujos del encadenado (reglas-caiani.md, sec. 1). */
  let scales: ChainScales | undefined;
  /**
   * El registro de decisiones del oráculo es obligatorio (paso 6 de d1, 2026-11-17): una corrida de referencia sin
   * `decisions.tsv` es error, no un V3 sin modo oráculo. Se genera con `run-oracle.sh` (o `reference/tools/rerun-decisions.sh`
   * para una corrida que ya existe).
   */
  const requireDecisions = () => {
    if (!decFile) throw new Error(`${run}: falta decisions.tsv(.gz); el V3 corre siempre en modo oráculo (inventario-decisiones, sec. L–M)`);
  };
  /** Suelto (`single`) del evento e. */
  const runSingle = (e: number, ev: Step['run']) => {
    requireDecisions();
    const s = stateFromDump(dumpOf(e === 0 ? before : after(prevEvent(e))));
    const rng = drawsOf(e);
    const pending = pendingOf(tick, e);
    if (pending) {
      expect(() => ev(s, rng)).toThrow(pending.error);
      console.log(`V3 tick ${tick}, evento ${e}: pendiente de decisión (${pending.why})`);
      return;
    }
    const carry = new InputCarry(s);
    const derived = new DerivedRecorder();
    const inputs = new InputRecorder();
    resetLastEdges();
    const forcedFrom = single.forced.length;
    single.oracle = oracleLines();
    single.toJmab = toJ!;
    // Operandos agregados: la fragilidad se mide con el operando corregido por su error de entrada (punto 3 de Nico).
    single.inputError = (t) => carry.inputError(t);
    withDecisions(single, e, () => withDerived(derived, () => withInputs(inputs, () => ev(s, rng))));
    expect(rng.remaining).toBe(0);
    // Los bloques del 75 comparten la secuencia de JMAB: se cierra con el último.
    if (Number.isInteger(e) || e === LAST) single.finishEvent(Math.floor(e));
    d1Report('single', `evento ${e}`, e, single, forcedFrom);
    expect(nanFields(s, toJ!)).toEqual([]);
    carry.fromLog(s.ledger.flowLog).fromInputs(inputs);
    const cs = carry.summary();
    if (cs.contracts > 0) console.log(`V3 tick ${tick}, evento ${e}: error de entrada descontado en ${cs.contracts} contratos, máx ${cs.max.toFixed(3)} µ`);
    check(s, after(e), `evento ${e}`, e, undefined, undefined, carry, derived);
  };
  /** Encadenado hasta el evento e (el k-ésimo de la tabla). */
  const runChained = (k: number, e: number, ev: Step['run']) => {
    requireDecisions();
    if (k === 0) {
      const d = dumpOf(before);
      chainedState = stateFromDump(d);
      scales = new ChainScales(chainedState, V3_CHAIN_RHO, idMaps(d.meta).toJ);
      // Valores al empezar la cadena: S = |v₀|.
      compareState(chainedState, d, { scale: scales });
      scales.commit();
    }
    const s = chainedState;
    const sc = scales;
    if (!s || !sc) throw new Error('falta el estado del encadenado (falló un evento anterior)');
    const rng = drawsOf(e);
    const pending = pendingOf(tick, e);
    if (pending) {
      expect(() => ev(s, rng)).toThrow(pending.error);
      chainedState = undefined; // la cadena se corta acá
      return;
    }
    const snap = sc.snapshot();
    const inputs = new InputRecorder();
    const forcedFrom = chained.forced.length;
    chained.oracle = oracleLines();
    chained.toJmab = toJ!;
    // En el encadenado la fragilidad de los montos es 2k µ (aprobado por Nico, 2026-11-16), sin corrección de entrada.
    chained.inputError = null;
    chained.amountTolerance = chainedAmountTol(k + 1);
    withDecisions(chained, e, () => withInputs(inputs, () => ev(s, rng)));
    expect(rng.remaining).toBe(0);
    if (Number.isInteger(e) || e === LAST) chained.finishEvent(Math.floor(e));
    d1Report('chained', `encadenado 0–${e}`, e, chained, forcedFrom);
    expect(nanFields(s, toJ!)).toEqual([]);
    const created = sc.propagate(snap);
    sc.propagateInputs(inputs);
    if (created > 0) console.log(`Escala propagada, tick ${tick}, evento ${e}: ${created} bienes de consumo nuevos`);
    // Después de cada evento, con la tolerancia de la cadena (k + 1 eventos corridos) y la escala de los flujos. Sin corte
    // (paso 6 de d1): una diferencia es falla.
    try {
      check(s, after(e), `encadenado 0–${e}`, e, chainedAmountTol(k + 1), sc);
    } finally {
      sc.commit();
    }
  };
  // Un test por paso, en orden (vitest los corre en orden dentro del describe): suelto y encadenado intercalados.
  it.skipIf(!available).each(steps.map((x) => [x.name, x] as const))('%s', (_name, { kind, k, e, run: ev }) => (kind === 'single' ? runSingle(e, ev) : runChained(k, e, ev)), V3_TIMEOUT);

  it.skipIf(!available)('decisiones: frágiles por evento y dadas vuelta entre el suelto y el encadenado', () => {
    console.log(`Decisiones, tick ${tick}, cada evento suelto:\n  ${summarizeDecisions(single.log).join('\n  ')}`);
    console.log(`Decisiones, tick ${tick}, encadenados:\n  ${summarizeDecisions(chained.log).join('\n  ')}`);
    // Decisiones que se dan vuelta entre el encadenado y el evento suelto (que arranca del estado de JMAB).
    const { flips, lengthMismatch } = compareOutcomes(single.log, chained.log);
    console.log(`Decisiones dadas vuelta, tick ${tick}: ${flips.length}`, JSON.stringify(flips.slice(0, 10)), lengthMismatch);
    console.log(`d1, tick ${tick}: suelto ${JSON.stringify(d1Totals.single)}, encadenado ${JSON.stringify(d1Totals.chained)}`);
    if (FULL && !ONLY_EVENTS && !only) expect(lengthMismatch).toEqual([]);
  });
});

describe('arnés del V3: términos de grupo del error de entrada (derived.ts)', () => {
  const dump = `${ORACLE}p3-t50/state/tick-50.jsonl`;
  it.skipIf(!dumpExists(dump))('un grupo da el mismo ε que expandirlo con los coeficientes multiplicados (también anidado)', () => {
    const s = stateFromDump(readDump(dump));
    const flat: InputTerm[] = Object.values(s.ledger.contracts)
      .slice(0, 2000)
      .map((c, k) => ({ contract: c.id, coef: (k % 7) - 3 }));
    const rec = new InputRecorder();
    rec.values.set('1:a', [
      { group: flat, coef: 0.37 },
      { group: flat, coef: -1.2 },
      { group: [{ group: flat, coef: 2 }], coef: 0.5 },
    ]);
    rec.values.set('1:b', scaleTerms(flat, 0.37 - 1.2 + 1));
    const carry = new InputCarry(s).fromInputs(rec);
    const a = carry.valueCarry(1, 'a')!;
    const b = carry.valueCarry(1, 'b')!;
    expect(b).not.toBe(0);
    expect(Math.abs(a - b)).toBeLessThan(1e-12 * Math.max(1, Math.abs(b)));
  });
});

describe('arnés del V3: error de entrada de una operación fuera de un lote (derivedContract, evento 37)', () => {
  const run = `${ORACLE}p3-s102-t292/`;
  const dump = `${run}state/tick-292-ev-36.jsonl`;
  it.skipIf(!dumpExists(dump))('el adelanto del banco 8256 (tick 292, semilla 102) lleva el δ de advancesDemand a su saldo, su monto inicial y las reservas', () => {
    const d = readDump(dump);
    const { toJ } = idMaps(d.meta);
    const s = stateFromDump(d);
    const bank = s.banks.find((b) => toJ(b.id) === 8256)!;
    // δ = advancesDemand en µ (port) − el de JMAB en µ: 994,90… unidades, redondeado a µ en el volcado.
    const delta = INPUT_FIELDS.get(s)!.get(`${bank.id}:advancesDemand`)!;
    expect(Math.abs(delta)).toBeGreaterThan(0);
    expect(Math.abs(delta)).toBeLessThanOrEqual(0.5);
    const reserves = contractIds(s.ledger, bank.id, 'assets', 'reserves')[0]!;
    const ownReserves = s.ledger.contracts[reserves]!.amount - INPUT_VALUES.get(s)!.get(reserves)!;
    const draws = parseDraws(readFileSync(`${run}draws.tsv`, 'utf8')).filter((x) => x.tick === 292 && x.event === 37);
    const rng = new OracleCaianiRng(draws, { agentId: toJ });
    rng.tick = 292;
    const carry = new InputCarry(s);
    const rec = new InputRecorder();
    withInputs(rec, () => reservesMarketBaselEvent(s, rng));
    carry.fromLog(s.ledger.flowLog).fromInputs(rec);
    const advances = contractIds(s.ledger, bank.id, 'liabilities', 'advance');
    const advance = advances[advances.length - 1]!;
    expect(s.ledger.contracts[advance]!.amount).toBe(bank.advancesDemand);
    expect(rec.contracts.map((f) => [f.contract, f.field ?? 'saldo'])).toEqual([
      [advance, 'saldo'],
      [advance, 'initialAmount'],
      [reserves, 'saldo'],
    ]);
    // Adelanto nuevo: sin saldo de entrada, su error es solo el del pedido.
    expect(carry.carry(advance)).toBe(delta);
    expect(carry.initialCarry(advance)).toBe(delta);
    // Reservas: el redondeo de su saldo inicial más el del pedido.
    expect(carry.carry(reserves)).toBeCloseTo(ownReserves + delta, 12);
  });
});

describe('pedido residual de crédito redondeado a 1 µ: qué préstamo recibe la zombi (reglas-caiani.md, sec. 37)', () => {
  const run = `${ORACLE}p3-s102-t300/`;
  const dump = `${run}state/tick-300-ev-9.jsonl`;
  it.skipIf(!dumpExists(dump))('tick 300, semilla 102: 8204 y 8227 activadas con 1 µ reciben un préstamo de 0 y el evento 10 coincide con JMAB', () => {
    const d = readDump(dump);
    const { toJ } = idMaps(d.meta);
    const s = stateFromDump(d);
    // En JMAB las dos piden un residuo (~10⁻¹⁴ y ~10⁻¹³) y quedan activas; el port las tiene en 0 e inactivas. Con un pedido
    // de JMAB entre 0,5 y 1 µ (14 casos en 7 semillas), el port tendría 1 µ y las activaría: se fuerza eso.
    const zombies = s.consumptionFirms.filter((f) => [8204, 8227].includes(toJ(f.id)));
    expect(zombies).toHaveLength(2);
    for (const f of zombies) {
      expect(f.creditDemanded).toBe(0);
      // Sin préstamos ni capital: recupero esperado = 0 / 0 = NaN, rendimiento NaN para todo monto, oferta 0.
      expect(contractIds(s.ledger, f.id, 'liabilities', 'loan')).toHaveLength(0);
      expect(f.capitalGoods).toHaveLength(0);
      f.creditDemanded = 1;
      f.active[MKT.CREDIT] = true;
    }
    const draws = parseDraws(readFileSync(`${run}draws.tsv`, 'utf8')).filter((x) => x.tick === 300 && x.event === 10);
    const rng = new OracleCaianiRng(draws, { agentId: toJ });
    rng.tick = 300;
    creditMarketEvent(s, rng);
    // Con las dos activas, el port consume exactamente los sorteos de JMAB.
    expect(rng.remaining).toBe(0);
    for (const f of zombies) {
      const loans = contractIds(s.ledger, f.id, 'liabilities', 'loan');
      expect(loans.map((c) => s.ledger.contracts[c]!.amount)).toEqual([0]); // préstamo de 0, como JMAB
      expect(f.creditDemanded).toBe(1); // le queda el pedido: sigue activa, como JMAB
      expect(f.active[MKT.CREDIT]).toBe(true);
    }
    // El resto del estado, igual que JMAB después del evento 10; las únicas diferencias son el pedido de las dos (1 µ contra
    // ~10⁻¹⁴, dentro de la tolerancia de 2 µ).
    const r = compareState(s, readDump(`${run}state/tick-300-ev-10.jsonl`));
    expect(r.diffs).toEqual([]);
  });
});

describe('arnés del V3: ratio de capital indeterminado en la comparación del estado (reglas-caiani.md, sec. 40)', () => {
  const dump = `${ORACLE}p3-s102-t300/state/tick-300.jsonl`;
  it.skipIf(!dumpExists(dump))('tick 300, semilla 102: el banco 8258 (−∞ en JMAB, rezago del patrimonio −2,9·10⁻¹¹) no se compara; con numerador > 2 µ sí', () => {
    const d = readDump(dump);
    const { toJ } = idMaps(d.meta);
    const s = stateFromDump(d);
    const b = s.banks.find((x) => toJ(x.id) === 8258)!;
    // Del volcado: −2,9·10⁻¹¹ / 0 = −∞, como JMAB. Indeterminado en los dos lados: no se compara y no es diferencia.
    expect(b.capitalRatio).toBe(-Infinity);
    let r = compareState(s, d);
    expect(r.diffs).toEqual([]);
    expect(r.indeterminate).toEqual(['banco 8258 ratio de capital']);
    // El port con 0/0 = NaN (patrimonio 0 µ, el caso del encadenado): sigue indeterminado.
    b.capitalRatio = NaN;
    b.lags[LAG.NETWEALTH]![299] = 0;
    r = compareState(s, d);
    expect(r.diffs).toEqual([]);
    expect(r.indeterminate).toHaveLength(1);
    // Numerador del port de 3 µ (> 2 µ): ya no es indeterminado, y +∞ contra −∞ de JMAB es diferencia.
    b.capitalRatio = Infinity;
    b.lags[LAG.NETWEALTH]![299] = 3e-6;
    r = compareState(s, d);
    expect(r.indeterminate).toEqual([]);
    expect(r.diffs.some((x) => x.includes('banco 8258 ratio de capital (no finito)'))).toBe(true);
  });
});
