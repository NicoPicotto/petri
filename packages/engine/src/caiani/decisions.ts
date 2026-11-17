/*
 * Petri — Copyright (C) 2026 Nicolas Picotto
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Registro de decisiones discretas (P3, V3; plan-port-caiani.md, sec. 4; reglas-caiani.md, sec. 1).
 *
 * Cada comparación que define una rama en los eventos pasa por un helper de este módulo (`gt`, `ge`,
 * `lt`, `rounding`, `record`). El helper devuelve exactamente lo mismo que la comparación sola: el
 * registro **solo observa** y no cambia ningún resultado (sin registrador activo no hace nada más).
 *
 * Con un registrador activo (`withDecisions`), anota por evento y por lugar:
 * - la distancia al umbral, en la escala de la tolerancia de V3 del valor comparado: montos en µ
 *   (absoluta), double calculados de montos y double puros (relativa, a la escala de los operandos);
 * - si esa distancia es ≤ la tolerancia (**decisión frágil**: una diferencia admitida por V3 alcanza
 *   para darla vuelta);
 * - el resultado (para contar las que se dan vuelta entre dos corridas: `compareOutcomes`).
 *
 * El registrador es un estado del módulo (los eventos son sincrónicos y `withDecisions` lo restaura
 * siempre). No forma parte del estado de la simulación ni afecta el determinismo.
 *
 * **Modo oráculo (opción (d) con d1, aprobado por Nico el 2026-11-16; reglas-caiani.md, sec. 40):** con las decisiones de
 * JMAB cargadas en el registrador, los helpers devuelven la rama de JMAB cuando la decisión es frágil de los dos lados.
 * Solo existe con un registrador del arnés: sin registrador (modo PRNG, V4, la app) devuelven la comparación de siempre.
 */
import type { InputTerm } from './derived';

/** Clase de tolerancia de V3 del valor comparado (plan, sec. 4). */
export type Tolerance = 'amount' | 'fromAmounts' | 'pure';

/** Tolerancias de V3: montos 2 µ; double de montos 10⁻⁶ relativo; double puros 10⁻⁹ relativo. */
export const DECISION_TOLERANCE: Readonly<Record<Tolerance, number>> = { amount: 2, fromAmounts: 1e-6, pure: 1e-9 };

export interface FragileDecision {
  /** Posición de la comparación dentro de la secuencia del lugar en el evento. */
  index: number;
  a: number;
  b: number;
  distance: number;
}

export interface SiteDecisions {
  tolerance: Tolerance;
  comparisons: number;
  fragile: number;
  /** Distancia más chica registrada (en la escala de la tolerancia). */
  minDistance: number;
  /** Las primeras frágiles (hasta `MAX_EXAMPLES`). */
  examples: FragileDecision[];
  /** Resultado de cada comparación, en orden (1/0 para las booleanas, el valor para los redondeos). */
  outcomes: number[];
}

/** Evento → lugar → decisiones. */
export type DecisionLog = Record<number, Record<string, SiteDecisions>>;

const MAX_EXAMPLES = 5;

/** Una decisión de JMAB del registro del oráculo (`decisions.tsv`; docs/inventario-decisiones.md, sec. I). */
export interface OracleDecision {
  site: string;
  /** Id de JMAB del agente (−1 si el oráculo no lo conoce). */
  agent: number;
  outcome: number;
  /** Operandos de JMAB en sus unidades (los de clase `amount` en unidades de Caiani; el arnés los pasa a µ). */
  a: number;
  b: number;
}

/** Cómo se tomó la rama de JMAB en una decisión distinta de la del port (modo oráculo). */
export type ForcedKind = 'frágil' | 'residuo' | 'indeterminada';

export interface ForcedDecision {
  event: number;
  /** Posición de la decisión en la secuencia del evento. */
  index: number;
  site: string;
  agent: number | undefined;
  kind: ForcedKind;
  port: number;
  jmab: number;
  /**
   * Distancias del port y de JMAB, en la escala de la clase (µ en montos). La del port se mide sobre los operandos
   * corregidos por su error de entrada anotado (operandos agregados); `distancePortRaw`, sobre los crudos (pedido de Nico,
   * 2026-11-16: para ver cuánto aporta la corrección en cada forzada). Sin términos de entrada, las dos son iguales.
   */
  distancePort: number;
  distancePortRaw: number;
  distanceJmab: number;
  /**
   * Alarma (pedido de Nico, 2026-11-16): forzada a más de 2 µ en montos o fuera de la tolerancia del suelto en double,
   * medida sobre el operando corregido.
   */
  alarm: boolean;
}

/** Opciones de una decisión (todas solo cuentan con un registrador activo). */
export interface DecisionOptions {
  /**
   * Error de entrada de los operandos agregados (punto 3 de Nico, 2026-11-16): los términos de los que depende cada
   * operando en µ (saldos de contratos o campos en µ, como `derivedValue`). Con un registrador que sabe evaluarlos
   * (`inputError`, lo pone el arnés del V3 con el `InputCarry`), la distancia se mide con los operandos corregidos por su
   * error de entrada: la misma tolerancia que el V3 aplica a ese operando.
   */
  inputs?: { a?: readonly InputTerm[]; b?: readonly InputTerm[] };
  /**
   * El operando puede ser NaN en este lugar (0/0 que JMAB también calcula; lista explícita en reglas-caiani.md, sec. 1).
   * Sin esto, una distancia NaN es error (pedido de Nico, 2026-11-16).
   */
  nanOk?: boolean;
}

/** Distancia NaN en un lugar que no lo declara: error (que un 0/0 nunca decida en silencio). */
export class NanDecisionError extends Error {}

export class DecisionRecorder {
  readonly log: DecisionLog = {};
  event = -1;
  /**
   * Evento → agentes con al menos una decisión frágil en ese evento (las que pasan el agente). El V3 informa una
   * diferencia de estado sobre esos agentes como decisión frágil dada vuelta, no como falla (decisión de Nico,
   * 2026-11-13, la de P1 aplicada al estado; reglas-caiani.md, sec. 1, "Decisiones discretas"). Con d1 en verde se saca.
   */
  readonly fragileAgents = new Map<number, Set<number>>();

  // ---- Modo oráculo (opción (d) con d1; reglas-caiani.md, sec. 40; docs/inventario-decisiones.md) ----

  /**
   * Decisiones de JMAB del tick, por evento (el registro del oráculo). Si está, el registrador está en modo oráculo:
   * cada decisión del port se empareja con la siguiente de JMAB del evento (mismo lugar, mismo agente) y, si las dos
   * son frágiles y dan distinto, se toma la de JMAB. Nada de esto existe en modo PRNG ni en V4.
   */
  oracle: Map<number, OracleDecision[]> | null = null;
  /** Id del port → id de JMAB (para comparar agentes). */
  toJmab: (id: number) => number = (id) => id;
  /** Posición siguiente en las decisiones de JMAB de cada evento. */
  readonly cursor = new Map<number, number>();
  /** Tolerancia de fragilidad de los montos (µ): 2 en el suelto, 2k en el encadenado (k = eventos desde el principio). */
  amountTolerance = DECISION_TOLERANCE.amount;
  /** Error de entrada (µ) de una lista de términos (lo pone el arnés; sin él, los operandos no se corrigen). */
  inputError: ((terms: readonly InputTerm[]) => number) | null = null;
  readonly forced: ForcedDecision[] = [];
  /** Líneas de JMAB consumidas sin evaluar (R2, búsqueda de oferta sobre un residuo), por evento. */
  readonly consumed = new Map<number, number>();
  /** Mayor |ε| (µ) de los operandos agregados, por lugar (punto 3 de Nico). */
  readonly aggregateError = new Map<string, number>();
  /** Si la última decisión fue forzada (lo leen los caminos de la rama forzada). */
  lastForced = false;

  record(site: string, outcome: number, a: number, b: number, distance: number, tolerance: Tolerance, agent?: number): void {
    const ev = this.log[this.event] ?? (this.log[this.event] = {});
    const s =
      ev[site] ??
      (ev[site] = { tolerance, comparisons: 0, fragile: 0, minDistance: Infinity, examples: [], outcomes: [] });
    const index = s.comparisons++;
    s.outcomes.push(outcome);
    if (distance < s.minDistance) s.minDistance = distance;
    // NaN (operandos NaN declarados con `nanOk`) no cuenta como frágil: la rama es la misma en JMAB y en el port.
    if (distance <= this.fragility(tolerance)) {
      s.fragile++;
      if (agent !== undefined) {
        let set = this.fragileAgents.get(this.event);
        if (!set) this.fragileAgents.set(this.event, (set = new Set()));
        set.add(agent);
      }
      if (s.examples.length < MAX_EXAMPLES) s.examples.push({ index, a, b, distance });
    }
  }

  private fragility(tolerance: Tolerance): number {
    return tolerance === 'amount' ? this.amountTolerance : DECISION_TOLERANCE[tolerance];
  }

  /**
   * Evento del registro de JMAB: los bloques del evento 75 que el V3 corre por separado (75.1…75.6) comparten la secuencia
   * del 75, que JMAB no separa.
   */
  private key(): number {
    return Math.floor(this.event);
  }

  private nextOracle(site: string): OracleDecision {
    const k = this.key();
    const lines = this.oracle!.get(k) ?? [];
    const i = this.cursor.get(k) ?? 0;
    const line = lines[i];
    if (!line) throw new Error(`d1: el port decide en "${site}" (evento ${this.event}, posición ${i}) y JMAB no tiene más decisiones en el evento`);
    this.cursor.set(k, i + 1);
    return line;
  }

  /** Posición en curso del evento (para los mensajes). */
  position(): number {
    return this.cursor.get(this.key()) ?? 0;
  }

  /**
   * Núcleo de los helpers. Registra la decisión y devuelve el resultado: el del port o, en modo oráculo, el de JMAB si
   * la decisión es frágil de los dos lados (o sobre un residuo, R2). Tira error si la del port no tiene par en JMAB, si
   * el lugar o el agente no coinciden, o si los resultados difieren sin que se pueda forzar.
   */
  decide(
    site: string,
    outcome: number,
    a: number,
    b: number,
    tolerance: Tolerance,
    scale: number | undefined,
    agent: number | undefined,
    integer: boolean,
    opts: DecisionOptions | undefined,
  ): number {
    this.lastForced = false;
    let ca = a;
    let cb = b;
    if (opts?.inputs && this.inputError && tolerance === 'amount') {
      const ea = opts.inputs.a ? this.inputError(opts.inputs.a) : 0;
      const eb = opts.inputs.b ? this.inputError(opts.inputs.b) : 0;
      ca = a - ea;
      cb = b - eb;
      const e = Math.max(Math.abs(ea), Math.abs(eb));
      if (e > (this.aggregateError.get(site) ?? 0)) this.aggregateError.set(site, e);
    }
    const distance = decisionDistance(ca, cb, tolerance, scale, opts?.nanOk, site);
    this.record(site, outcome, a, b, distance, tolerance, agent);
    if (!this.oracle) return outcome;

    const index = this.position();
    const line = this.nextOracle(site);
    if (line.site !== site) {
      throw new Error(`d1: decisión desalineada en el evento ${this.event}, posición ${index}: port "${site}", JMAB "${line.site}"`);
    }
    if (agent !== undefined && line.agent >= 0 && this.toJmab(agent) !== line.agent) {
      throw new Error(`d1: agente distinto en "${site}" (evento ${this.event}, posición ${index}): port ${this.toJmab(agent)}, JMAB ${line.agent}`);
    }
    const u = tolerance === 'amount' ? 1_000_000 : 1;
    if (Number.isNaN(distance)) {
      // NaN declarado (`nanOk`): JMAB tiene que tener el mismo NaN, y entonces la comparación da lo mismo.
      const nanJ = Number.isNaN(line.a) || Number.isNaN(line.b);
      if (!nanJ) throw new Error(`d1: operando NaN en el port y no en JMAB en "${site}" (evento ${this.event}, posición ${index})`);
    }
    if (line.outcome === outcome) return outcome;

    const distanceJ = decisionDistance(line.a * u, line.b * u, tolerance, scale, true, site);
    const tol = this.fragility(tolerance);
    const step = integer ? Math.abs(line.outcome - outcome) === 1 : true;
    let kind: ForcedKind | null = null;
    // R2 (aprobada con límites, 2026-11-16): solo montos o double de montos, con los operandos del port en 0 exacto y los
    // de JMAB ≤ 2 µ (un residuo de punto flotante). Va primero: con escala 0, la medida relativa daría "frágil" a un ruido
    // contra ruido, y se cuenta aparte.
    if (
      tolerance !== 'pure' &&
      a === 0 &&
      b === 0 &&
      Math.abs(line.a) * 1_000_000 <= DECISION_TOLERANCE.amount &&
      Math.abs(line.b) * 1_000_000 <= DECISION_TOLERANCE.amount
    )
      kind = 'residuo';
    else if (distance <= tol && distanceJ <= tol && step) kind = 'frágil';
    if (!kind) {
      throw new Error(
        `d1: decisión distinta de JMAB y no frágil en "${site}" (evento ${this.event}, posición ${index}): port ${outcome} ` +
          `(a ${a}, b ${b}, distancia ${distance}), JMAB ${line.outcome} (a ${line.a * u}, b ${line.b * u}, distancia ${distanceJ})`,
      );
    }
    const suelto = tolerance === 'amount' ? DECISION_TOLERANCE.amount : DECISION_TOLERANCE[tolerance];
    this.forced.push({
      event: this.event,
      index,
      site,
      agent,
      kind,
      port: outcome,
      jmab: line.outcome,
      distancePort: distance,
      distancePortRaw: ca === a && cb === b ? distance : decisionDistance(a, b, tolerance, scale, opts?.nanOk, site),
      distanceJmab: distanceJ,
      alarm: kind === 'frágil' && Math.max(distance, distanceJ) > suelto,
    });
    this.lastForced = true;
    return line.outcome;
  }

  /**
   * R2 en la búsqueda de oferta de crédito (inventario, H): con el pedido del port en 0 µ exacto, JMAB recorre la
   * búsqueda con un residuo y registra hasta 101 decisiones de `site` para ese par. Se consumen sin evaluar, hasta la
   * primera verdadera o hasta que cambie el lugar, verificando que los operandos de JMAB sean ≤ 2 µ. Devuelve cuántas.
   */
  consumeResidue(site: string): number {
    if (!this.oracle) return 0;
    const k = this.key();
    const lines = this.oracle.get(k) ?? [];
    let i = this.cursor.get(k) ?? 0;
    let n = 0;
    while (i < lines.length && lines[i]!.site === site && n < 101) {
      const l = lines[i]!;
      if (Math.abs(l.a) * 1_000_000 > DECISION_TOLERANCE.amount && Number.isFinite(l.a)) {
        throw new Error(`d1 (R2): la búsqueda de JMAB en "${site}" no es sobre un residuo (operando ${l.a}, evento ${this.event}, posición ${i})`);
      }
      i++;
      n++;
      if (l.outcome === 1) break;
    }
    this.cursor.set(k, i);
    this.consumed.set(this.event, (this.consumed.get(this.event) ?? 0) + n);
    return n;
  }

  /** Al terminar el evento: una decisión de JMAB sin par en el port es falla. */
  finishEvent(event: number): void {
    if (!this.oracle) return;
    const lines = this.oracle.get(event) ?? [];
    const i = this.cursor.get(event) ?? 0;
    if (i < lines.length) {
      throw new Error(`d1: JMAB tiene ${lines.length - i} decisiones más en el evento ${event} (la siguiente: "${lines[i]!.site}", agente ${lines[i]!.agent})`);
    }
  }
}

let active: DecisionRecorder | null = null;

/** Corre `fn` (un evento) registrando sus decisiones en `rec` bajo el índice `event`. */
export function withDecisions<T>(rec: DecisionRecorder, event: number, fn: () => T): T {
  const prev = active;
  const prevEvent = rec.event;
  active = rec;
  rec.event = event;
  try {
    return fn();
  } finally {
    active = prev;
    rec.event = prevEvent;
  }
}

/** Si hay un registrador activo (para armar anotaciones que solo usa el registro). */
export function decisionsActive(): boolean {
  return active !== null;
}

/** Si el registrador activo está en modo oráculo (d1). Los caminos de la rama forzada solo existen así. */
export function oracleDecisions(): boolean {
  return active !== null && active.oracle !== null;
}

/** Si la última decisión registrada fue forzada a la rama de JMAB (solo en modo oráculo). */
export function lastDecisionForced(): boolean {
  return active !== null && active.lastForced;
}

/** R2 de la búsqueda de oferta sobre un residuo (ver `DecisionRecorder.consumeResidue`). */
export function consumeResidueDecisions(site: string): number {
  return active ? active.consumeResidue(site) : 0;
}

/**
 * Distancia de a a b en la escala de la tolerancia: |a − b| en µ para montos; si no, |a − b| / escala,
 * con escala = max(|a|, |b|) salvo que se indique otra (p. ej., cuando el valor comparado sale de una
 * resta de términos más grandes: la escala es la de esos términos). Con operandos infinitos, +∞ salvo
 * que sean iguales. **Con NaN, error** (pedido de Nico, 2026-11-16: un 0/0 nunca decide en silencio), salvo que el lugar
 * declare que el operando puede ser NaN (`nanOk`, lista en reglas-caiani.md, sec. 1): entonces NaN.
 */
export function decisionDistance(a: number, b: number, tolerance: Tolerance, scale?: number, nanOk = false, site = ''): number {
  if (a === b) return 0;
  const d = Math.abs(a - b);
  if (Number.isNaN(d)) {
    if (Number.isNaN(a) || Number.isNaN(b)) {
      if (!nanOk) throw new NanDecisionError(`decisión con un operando NaN${site ? ` en "${site}"` : ''} (a ${a}, b ${b}); no está en la lista de NaN declarados`);
      return NaN;
    }
    return Infinity;
  }
  if (tolerance === 'amount') return d;
  if (d === Infinity) return Infinity;
  const s = scale ?? Math.max(Math.abs(a), Math.abs(b));
  if (Number.isNaN(s)) throw new NanDecisionError(`decisión con escala NaN${site ? ` en "${site}"` : ''}`);
  return s === 0 ? 0 : d / s;
}

/** Registro directo, para decisiones que no son una comparación simple (ver el lugar que la usa). */
export function record(
  site: string,
  outcome: boolean,
  a: number,
  b: number,
  tolerance: Tolerance,
  scale?: number,
  agent?: number,
  opts?: DecisionOptions,
): boolean {
  if (!active) return outcome;
  return active.decide(site, outcome ? 1 : 0, a, b, tolerance, scale, agent, false, opts) === 1;
}

/** a > b. */
export function gt(site: string, a: number, b: number, tolerance: Tolerance, scale?: number, agent?: number, opts?: DecisionOptions): boolean {
  return record(site, a > b, a, b, tolerance, scale, agent, opts);
}

/** a ≥ b. */
export function ge(site: string, a: number, b: number, tolerance: Tolerance, scale?: number, agent?: number, opts?: DecisionOptions): boolean {
  return record(site, a >= b, a, b, tolerance, scale, agent, opts);
}

/** a < b. */
export function lt(site: string, a: number, b: number, tolerance: Tolerance, scale?: number, agent?: number, opts?: DecisionOptions): boolean {
  return record(site, a < b, a, b, tolerance, scale, agent, opts);
}

/**
 * Redondeo al entero más cercano: la decisión es de qué lado de la mitad k + 0,5 cae x. Quien llama
 * redondea como corresponda a su lugar (`rounded`) y este helper lo registra y lo devuelve (en modo oráculo, el de JMAB
 * si la decisión es frágil de los dos lados y difieren en 1).
 * Distancia relativa a max(|x|, |k + 0,5|) (la escala por defecto): con x = 0 exacto (p. ej., I+D nula)
 * la distancia a 0,5 es 1, no 0 (antes se medía contra |x| y un cero exacto contaba como frágil).
 */
export function rounding(site: string, x: number, rounded: number, tolerance: Tolerance, agent?: number): number {
  if (!active) return rounded;
  const half = Math.floor(x) + 0.5;
  return active.decide(site, rounded, x, half, tolerance, undefined, agent, true, undefined);
}

/**
 * Piso (`Math.floor`): la decisión es entre qué enteros cae x; el umbral es el entero más cercano (un x
 * apenas por debajo de un entero k da k − 1, apenas por encima da k). Devuelve `Math.floor(x)` (en modo oráculo, el de
 * JMAB si es frágil de los dos lados). Distancia relativa a max(|x|, |k|).
 */
export function flooring(site: string, x: number, tolerance: Tolerance, agent?: number): number {
  const r = Math.floor(x);
  if (!active) return r;
  return active.decide(site, r, x, Math.round(x), tolerance, undefined, agent, true, undefined);
}

/**
 * Decisión de un techo (`Math.ceil`): el umbral es el entero más cercano (como `flooring`). Con `unit` la distancia se mide
 * en esa escala (el evento 29 pasa µ por unidad: el techo de un monto en unidades se da vuelta solo si el monto está a
 * pocos µ de un entero, y se compara con la tolerancia de los montos).
 */
export function ceiling(site: string, x: number, tolerance: Tolerance, unit = 1, agent?: number): number {
  const r = Math.ceil(x);
  if (!active) return r;
  return active.decide(site, r, x * unit, Math.round(x) * unit, tolerance, undefined, agent, true, undefined);
}

export interface DecisionFlip {
  event: number;
  site: string;
  index: number;
  a: number;
  b: number;
}

/**
 * Decisiones que se dan vuelta entre dos corridas del mismo evento (p. ej., encadenada contra suelta
 * desde el volcado de JMAB): mismo lugar, misma posición, otro resultado. Si un lugar tiene otra
 * cantidad de comparaciones en las dos corridas, la secuencia ya divergió: se informa como `lengthMismatch`.
 */
export function compareOutcomes(a: DecisionLog, b: DecisionLog): { flips: DecisionFlip[]; lengthMismatch: string[] } {
  const flips: DecisionFlip[] = [];
  const lengthMismatch: string[] = [];
  for (const ev of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const sa = a[Number(ev)] ?? {};
    const sb = b[Number(ev)] ?? {};
    for (const site of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
      const oa = sa[site]?.outcomes ?? [];
      const ob = sb[site]?.outcomes ?? [];
      if (oa.length !== ob.length) lengthMismatch.push(`evento ${ev}, ${site}: ${oa.length} contra ${ob.length}`);
      const n = Math.min(oa.length, ob.length);
      for (let i = 0; i < n; i++) if (oa[i] !== ob[i]) flips.push({ event: Number(ev), site, index: i, a: oa[i]!, b: ob[i]! });
    }
  }
  return { flips, lengthMismatch };
}

/** Resumen por evento: comparaciones, frágiles y, por lugar, frágiles y distancia mínima. */
export function summarizeDecisions(log: DecisionLog): string[] {
  const out: string[] = [];
  for (const ev of Object.keys(log).map(Number).sort((x, y) => x - y)) {
    const sites = log[ev]!;
    let n = 0;
    let f = 0;
    const parts: string[] = [];
    for (const [site, s] of Object.entries(sites)) {
      n += s.comparisons;
      f += s.fragile;
      parts.push(`${site} [${s.tolerance}]: ${s.fragile}/${s.comparisons}, mín ${s.minDistance.toExponential(2)}`);
    }
    out.push(`evento ${ev}: ${f} frágiles de ${n} comparaciones\n    ${parts.join('\n    ')}`);
  }
  return out;
}
