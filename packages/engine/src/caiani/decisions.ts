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
 */

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

export class DecisionRecorder {
  readonly log: DecisionLog = {};
  event = -1;

  record(site: string, outcome: number, a: number, b: number, distance: number, tolerance: Tolerance): void {
    const ev = this.log[this.event] ?? (this.log[this.event] = {});
    const s =
      ev[site] ??
      (ev[site] = { tolerance, comparisons: 0, fragile: 0, minDistance: Infinity, examples: [], outcomes: [] });
    const index = s.comparisons++;
    s.outcomes.push(outcome);
    if (distance < s.minDistance) s.minDistance = distance;
    // NaN (operandos NaN) no cuenta como frágil: la rama es la misma en JMAB y en el port.
    if (distance <= DECISION_TOLERANCE[tolerance]) {
      s.fragile++;
      if (s.examples.length < MAX_EXAMPLES) s.examples.push({ index, a, b, distance });
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

/**
 * Distancia de a a b en la escala de la tolerancia: |a − b| en µ para montos; si no, |a − b| / escala,
 * con escala = max(|a|, |b|) salvo que se indique otra (p. ej., cuando el valor comparado sale de una
 * resta de términos más grandes: la escala es la de esos términos). Con operandos infinitos, +∞ salvo
 * que sean iguales; con NaN, NaN.
 */
export function decisionDistance(a: number, b: number, tolerance: Tolerance, scale?: number): number {
  if (a === b) return 0;
  const d = Math.abs(a - b);
  if (Number.isNaN(d)) return Number.isNaN(a) || Number.isNaN(b) ? NaN : Infinity;
  if (tolerance === 'amount') return d;
  if (d === Infinity) return Infinity;
  const s = scale ?? Math.max(Math.abs(a), Math.abs(b));
  return s === 0 ? 0 : d / s;
}

/** Registro directo, para decisiones que no son una comparación simple (ver el lugar que la usa). */
export function record(site: string, outcome: boolean, a: number, b: number, tolerance: Tolerance, scale?: number): boolean {
  if (active) active.record(site, outcome ? 1 : 0, a, b, decisionDistance(a, b, tolerance, scale), tolerance);
  return outcome;
}

/** a > b. */
export function gt(site: string, a: number, b: number, tolerance: Tolerance, scale?: number): boolean {
  return record(site, a > b, a, b, tolerance, scale);
}

/** a ≥ b. */
export function ge(site: string, a: number, b: number, tolerance: Tolerance, scale?: number): boolean {
  return record(site, a >= b, a, b, tolerance, scale);
}

/** a < b. */
export function lt(site: string, a: number, b: number, tolerance: Tolerance, scale?: number): boolean {
  return record(site, a < b, a, b, tolerance, scale);
}

/**
 * Redondeo al entero más cercano: la decisión es de qué lado de la mitad k + 0,5 cae x. Quien llama
 * redondea como corresponda a su lugar (`rounded`) y este helper solo lo registra y lo devuelve.
 * Distancia relativa a max(|x|, |k + 0,5|) (la escala por defecto): con x = 0 exacto (p. ej., I+D nula)
 * la distancia a 0,5 es 1, no 0 (antes se medía contra |x| y un cero exacto contaba como frágil).
 */
export function rounding(site: string, x: number, rounded: number, tolerance: Tolerance): number {
  if (active) {
    const half = Math.floor(x) + 0.5;
    active.record(site, rounded, x, half, decisionDistance(x, half, tolerance), tolerance);
  }
  return rounded;
}

/**
 * Piso (`Math.floor`): la decisión es entre qué enteros cae x; el umbral es el entero más cercano (un x
 * apenas por debajo de un entero k da k − 1, apenas por encima da k). Devuelve `Math.floor(x)`.
 * Distancia relativa a max(|x|, |k|).
 */
export function flooring(site: string, x: number, tolerance: Tolerance): number {
  const r = Math.floor(x);
  if (active) {
    const k = Math.round(x);
    active.record(site, r, x, k, decisionDistance(x, k, tolerance), tolerance);
  }
  return r;
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
