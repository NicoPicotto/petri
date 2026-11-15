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
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  OracleCaianiRng,
  computeExpectationsEvent,
  capitalPriceEvent,
  consumptionPriceEvent,
  capitalMarketFirstStepEvent,
  rdDecisionEvent,
  investmentDemandEvent,
  creditSupplyEvent,
  depositSupplyEvent,
  depositInterestEvent,
  creditDemandEvent,
  creditMarketEvent,
  laborSupplyEvent,
  laborDemandEvent,
  governmentLaborEvent,
  laborMarketEvent,
  productionEvent,
  rdOutcomeEvent,
  consumptionDemandEvent,
  consumptionMarketEvent,
  capitalMarketSecondStepEvent,
  creditInterestsEvent,
  wagePaymentEvent,
  bondInterestEvent,
  advanceInterestEvent,
  taxesEvent,
  dividendsEvent,
  depositDemandEvent,
  depositMarketEvent,
  bankBankruptcyEvent,
  bondSupplyEvent,
  bondMarketFirstStepEvent,
  bondDemandEvent,
  parseDraws,
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
import { V3_CHAIN_RHO, chainedAmountTol, compareState, idMaps, readDump, stateFromDump, type CompareResult, type Dump, type ScaleSource } from './support/jmab-dump';

/**
 * Tiempo máximo de cada test del V3: 5 minutos. Con la máquina cargada (otras corridas, el oráculo) un evento que
 * tarda segundos puede pasar de los 2 minutos y dar un falso vencimiento (pedido de Nico, 2026-11-13).
 */
const V3_TIMEOUT = 300_000;

const ORACLE = fileURLToPath(new URL('../../../reference/p0/runs/oracle/', import.meta.url));

/** Corridas de referencia: volcados al principio del tick y después de los eventos 0–37 (semilla 12345 salvo la 293). */
const ALL_RUNS = [
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
];

/**
 * Ramas que el V3 alcanza y que esperan una decisión de Nico: el evento tira un error explícito y el test verifica
 * que sea ese (y no otro). Se sacan de acá cuando la rama se porta. Hoy, ninguna.
 */
const PENDING: { tick: number; event: number; error: RegExp; why: string }[] = [];
const pendingOf = (tick: number, event: number) => PENDING.find((p) => p.tick === tick && p.event === event);

/** Eventos portados, en orden; `rng` = el evento sortea (si no, se verifica que el registro no tenga sorteos). */
/**
 * Cierre de un lote de pagos en el V3: se informa y se exige que cierre sin cotas relajadas, con cada pago y cada
 * grupo a < 1 µ de su suma en double (decisión de Nico, 2026-11-13: lo estricto de los agregados derivados queda en
 * los componentes; reglas-caiani.md, sec. 1).
 */
/** Bordes redondeados por contrato del último lote cerrado (cota del lote por mecanismo; la lee el suelto). */
let lastEdges: ReadonlyMap<number, number> | undefined;
function settled(event: number, r: { relaxed: boolean; maxPaymentDiff: number; maxGroupDiff: number; edges: ReadonlyMap<number, number> }): void {
  lastEdges = r.edges;
  const maxEdges = Math.max(0, ...r.edges.values());
  console.log(`evento ${event}, cierre del lote: ${JSON.stringify({ payments: (r as { payments?: number }).payments, relaxed: r.relaxed, maxPaymentDiff: r.maxPaymentDiff, maxGroupDiff: r.maxGroupDiff, maxEdges })}`);
  expect(r.relaxed).toBe(false);
  expect(r.maxPaymentDiff).toBeLessThan(1);
  expect(r.maxGroupDiff).toBeLessThan(1);
}

const EVENTS: { e: number; run: (s: CaianiState, rng: CaianiRng) => void }[] = [
  { e: 0, run: (s) => computeExpectationsEvent(s) },
  { e: 1, run: capitalPriceEvent },
  { e: 2, run: consumptionPriceEvent },
  { e: 3, run: capitalMarketFirstStepEvent },
  { e: 4, run: (s) => rdDecisionEvent(s) },
  { e: 5, run: investmentDemandEvent },
  { e: 6, run: creditSupplyEvent },
  { e: 7, run: depositSupplyEvent },
  { e: 8, run: (s) => depositInterestEvent(s) },
  { e: 9, run: (s) => creditDemandEvent(s) },
  { e: 10, run: creditMarketEvent },
  { e: 11, run: laborSupplyEvent },
  { e: 12, run: laborDemandEvent },
  { e: 13, run: governmentLaborEvent },
  { e: 14, run: laborMarketEvent },
  { e: 15, run: (s) => productionEvent(s) },
  { e: 16, run: (s) => rdOutcomeEvent(s) },
  { e: 17, run: (s) => consumptionDemandEvent(s) },
  {
    e: 18,
    run: (s, rng) => {
      const r = consumptionMarketEvent(s, rng);
      settled(18, r);
    },
  },
  {
    e: 19,
    run: (s, rng) => {
      const r = capitalMarketSecondStepEvent(s, rng);
      settled(19, r);
    },
  },
  {
    e: 20,
    run: (s) => {
      const r = creditInterestsEvent(s);
      settled(20, r);
    },
  },
  {
    e: 21,
    run: (s, rng) => {
      const r = wagePaymentEvent(s, rng);
      settled(21, r);
    },
  },
  {
    e: 22,
    run: (s) => {
      const r = bondInterestEvent(s);
      settled(22, r);
    },
  },
  {
    e: 23,
    run: (s) => {
      const r = advanceInterestEvent(s);
      settled(23, r);
    },
  },
  {
    e: 24,
    run: (s) => {
      const r = taxesEvent(s);
      settled(24, r);
    },
  },
  {
    e: 25,
    run: (s) => {
      const r = dividendsEvent(s);
      settled(25, r);
    },
  },
  {
    e: 26,
    run: (s) => {
      const r = depositDemandEvent(s);
      settled(26, r);
    },
  },
  { e: 27, run: depositMarketEvent },
  { e: 28, run: bankBankruptcyEvent },
  { e: 29, run: (s) => bondSupplyEvent(s) },
  { e: 30, run: bondMarketFirstStepEvent },
  { e: 31, run: (s) => bondDemandEvent(s) },
];
const LAST = EVENTS[EVENTS.length - 1]!.e;

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

/**
 * Campos que no cumplen la regla general de tolerancia y quedan **reportados** (no se agranda la tolerancia):
 * se informan en cada corrida y esperan una decisión de Nico. Ver reglas-caiani.md, sec. 1, "Tolerancias".
 * Cada entrada es el tipo de campo (la etiqueta sin ids ni índices, como la imprime `compareState`) y en qué
 * modalidad se reporta.
 * - Montos: ninguno desde el redondeo con arrastre (2026-11-13).
 * - Bienes de consumo después del evento 18, encadenado (2026-11-13): cantidades y valores que son **residuos**
 *   (lo que queda del inventario de una empresa después de decenas de ventas, o el resto de la demanda de un
 *   hogar en su segunda compra). El error absoluto es el de las demandas del encadenado (~10⁻⁶), pero relativo
 *   a un residuo chico pasa el 10⁻⁶. En el evento suelto son bit a bit. Ver reglas-caiani.md, sec. 17.
 * - Morosidad de un banco en el evento 20, suelto: **resuelta** con la regla de agregados derivados (2026-11-13;
 *   ya no se reporta). Registro: en el tick 108 la
 *   morosidad del banco 8255 queda a 3,67 µ de JMAB. Suma lo que queda de los 5 préstamos de la empresa 8182
 *   (todos de ese banco): cada préstamo está a < 1 µ de lo que recibe en double (redondeo controlado), pero la suma
 *   de los 5 no tiene cota propia (~3,1 µ), más el error de entrada de los saldos (~0,5 µ). reglas-caiani.md, sec. 19.
 */
const REPORTED_FIELDS: { field: string; chainedOnly: boolean; events?: number[] }[] = [];

describe.each(RUNS)('V3 por evento contra el oráculo, tick $tick (reference/, fuera de git)', ({ run, tick }) => {
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
  });
  const before = `tick-${tick}.jsonl`;
  const after = (e: number) => `tick-${tick}-ev-${e}.jsonl`;
  const available = existsSync(dir + after(LAST));
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
   * Diferencias de estado sobre agentes con una decisión frágil (dentro de la tolerancia) en el evento: decisiones
   * frágiles dadas vuelta respecto de JMAB. Se informan y no hacen fallar el test (decisión de Nico, 2026-11-13: el
   * caso de P1 aplicado al estado; reglas-caiani.md, sec. 1, "Decisiones discretas").
   */
  const flippedVsJmab: string[] = [];
  const jmabIdOf = (diff: string) => {
    const m = /(\d{4,5})/.exec(diff.slice(0, diff.indexOf(':')));
    return m ? Number(m[1]) : undefined;
  };
  const fragileJ = (agents: Iterable<number>) => {
    toJ ??= idMaps(dumpOf(before).meta).toJ;
    const out = new Set<number>();
    for (const a of agents) out.add(toJ(a));
    return out;
  };
  const check = (s: CaianiState, name: string, label: string, event: number, amountTol?: number, scale?: ScaleSource, carry?: InputCarry, derived?: DerivedRecorder, fragile?: Set<number>): number => {
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
    const edges = !chained && lastEdges ? (c: number) => lastEdges!.get(c) : undefined;
    const r = compareState(s, dumpOf(name), { amountTol, scale, carry: carry?.carry, derived: derivedTol, derivedValue: carry?.valueCarry, edges });
    console.log(`V3 tick ${tick}, ${label}:`, JSON.stringify(r.counts));
    report(label, r);
    const scaledRows = Object.entries(r.scaled)
      .filter(([, v]) => v.maxErrOverS > 0)
      .sort((a, b) => b[1].maxErrOverS - a[1].maxErrOverS)
      // Los 8 con el peor cociente y, siempre, los que necesitaron la escala para pasar.
      .filter(([, v], i) => i < 8 || v.byScale > 0)
      .map(([k, v]) => `${k}: diferencia/S máx ${v.maxErrOverS.toExponential(2)}, ρ·S máx ${v.maxRhoS.toPrecision(3)}${v.byScale > 0 ? `, ${v.byScale} pasan solo por ρ·S` : ''}`);
    if (scaledRows.length > 0) console.log(`Escala de los flujos, tick ${tick}, ${label} (ρ = ${V3_CHAIN_RHO}):\n  ${scaledRows.join('\n  ')}`);
    const reported = REPORTED_FIELDS.filter((f) => (chained || !f.chainedOnly) && (!f.events || f.events.includes(event))).map((f) => f.field);
    const isReported = (kind: string) => reported.includes(kind);
    const reportedRows = [...Object.entries(r.amountFields), ...Object.entries(r.doubleFieldsOver)].filter(([k, v]) => isReported(k) && v.over > 0);
    if (reportedRows.length > 0) {
      console.log(`Campos reportados, tick ${tick}, ${label}:\n  ${reportedRows.map(([k, v]) => `${k}: ${v.over} sobre la tolerancia, máx ${v.max}`).join('\n  ')}`);
    }
    const notReported = r.diffs.filter((d) => !isReported(d.slice(0, d.indexOf(':')).replace(/\d+/g, '#')));
    const explained = notReported.filter((d) => fragile !== undefined && fragile.has(jmabIdOf(d) ?? -1));
    for (const d of explained) flippedVsJmab.push(`${label}: ${d}`);
    if (explained.length > 0) console.log(`Decisiones frágiles dadas vuelta respecto de JMAB, tick ${tick}, ${label}:\n  ${explained.join('\n  ')}`);
    const unexpected = notReported.filter((d) => !explained.includes(d));
    expect(unexpected).toEqual([]);
    // `diffs` guarda solo las primeras 40: si se llenó con reportados, el total tiene que cuadrar con ellos.
    const reportedOver = reportedRows.reduce((a, [, v]) => a + v.over, 0);
    expect(r.total - reportedOver - explained.length).toBe(unexpected.length);
    return explained.length;
  };
  /** Montos con diferencia > 0, por tipo de campo: máximo, cuántos superan la tolerancia y de cuántos. */
  const report = (label: string, r: CompareResult) => {
    const rows = Object.entries(r.amountFields)
      .filter(([, v]) => v.max > 0)
      .map(([k, v]) => `${k}: máx ${v.max} µ${v.over > 0 ? `, ${v.over} de ${v.n} sobre la tolerancia` : ''}`);
    if (rows.length > 0) console.log(`Montos, tick ${tick}, ${label}:\n  ${rows.join('\n  ')}`);
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
  /** Evento donde se cortó el encadenado por una decisión frágil dada vuelta respecto de JMAB. */
  let chainCut: number | undefined;
  /** Suelto (`single`) del evento e. */
  const runSingle = (e: number, ev: Step['run']) => {
    const s = stateFromDump(dumpOf(e === 0 ? before : after(e - 1)));
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
    lastEdges = undefined;
    withDecisions(single, e, () => withDerived(derived, () => withInputs(inputs, () => ev(s, rng))));
    expect(rng.remaining).toBe(0);
    carry.fromLog(s.ledger.flowLog).fromInputs(inputs);
    const cs = carry.summary();
    if (cs.contracts > 0) console.log(`V3 tick ${tick}, evento ${e}: error de entrada descontado en ${cs.contracts} contratos, máx ${cs.max.toFixed(3)} µ`);
    check(s, after(e), `evento ${e}`, e, undefined, undefined, carry, derived, fragileJ(single.fragileAgents.get(e) ?? []));
  };
  /** Encadenado hasta el evento e (el k-ésimo de la tabla). */
  const runChained = (k: number, e: number, ev: Step['run']) => {
    if (k === 0) {
      const d = dumpOf(before);
      chainedState = stateFromDump(d);
      scales = new ChainScales(chainedState, V3_CHAIN_RHO, idMaps(d.meta).toJ);
      // Valores al empezar la cadena: S = |v₀|.
      compareState(chainedState, d, { scale: scales });
      scales.commit();
    }
    if (chainCut !== undefined) {
      console.log(`V3 tick ${tick}, encadenado: cortado en el evento ${chainCut} (decisión frágil dada vuelta respecto de JMAB)`);
      return;
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
    withDecisions(chained, e, () => withInputs(inputs, () => ev(s, rng)));
    expect(rng.remaining).toBe(0);
    const created = sc.propagate(snap);
    sc.propagateInputs(inputs);
    if (created > 0) console.log(`Escala propagada, tick ${tick}, evento ${e}: ${created} bienes de consumo nuevos`);
    // Después de cada evento, con la tolerancia de la cadena (k + 1 eventos corridos) y la escala de los flujos.
    try {
      const agents: number[] = [];
      for (const [ev2, set] of chained.fragileAgents) if (ev2 <= e) agents.push(...set);
      // Desde una decisión dada vuelta, el estado del port diverge del de JMAB a propósito: la cadena se corta.
      if (check(s, after(e), `encadenado 0–${e}`, e, chainedAmountTol(k + 1), sc, undefined, undefined, fragileJ(agents)) > 0) chainCut = e;
    } finally {
      sc.commit();
    }
  };
  // Un test por paso, en orden (vitest los corre en orden dentro del describe): suelto y encadenado intercalados.
  it.skipIf(!available).each(STEPS.map((x) => [x.name, x] as const))('%s', (_name, { kind, k, e, run: ev }) => (kind === 'single' ? runSingle(e, ev) : runChained(k, e, ev)), V3_TIMEOUT);

  it.skipIf(!available)('decisiones: frágiles por evento y dadas vuelta entre el suelto y el encadenado', () => {
    console.log(`Decisiones, tick ${tick}, cada evento suelto:\n  ${summarizeDecisions(single.log).join('\n  ')}`);
    console.log(`Decisiones, tick ${tick}, encadenados:\n  ${summarizeDecisions(chained.log).join('\n  ')}`);
    // Decisiones que se dan vuelta entre el encadenado y el evento suelto (que arranca del estado de JMAB).
    const { flips, lengthMismatch } = compareOutcomes(single.log, chained.log);
    console.log(`Decisiones dadas vuelta, tick ${tick}: ${flips.length}`, JSON.stringify(flips.slice(0, 10)), lengthMismatch);
    console.log(`Decisiones frágiles dadas vuelta respecto de JMAB, tick ${tick}: ${flippedVsJmab.length}`, JSON.stringify(flippedVsJmab.slice(0, 10)));
    // Con la cadena cortada, el encadenado no tiene los eventos siguientes: no se comparan.
    if (FULL && !ONLY_EVENTS && chainCut === undefined) expect(lengthMismatch).toEqual([]);
  });
});

describe('arnés del V3: términos de grupo del error de entrada (derived.ts)', () => {
  const dump = `${ORACLE}p3-t50/state/tick-50.jsonl`;
  it.skipIf(!existsSync(dump))('un grupo da el mismo ε que expandirlo con los coeficientes multiplicados (también anidado)', () => {
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
