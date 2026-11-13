/**
 * Azar semántico del port de Caiani (docs/ledger-contratos.md, sec. 2.6).
 *
 * Las reglas no piden uniformes: piden "una normal plegada en este lugar", "una Bernoulli con esta p",
 * "mezclar esta lista", "elegir esta muestra". Cada pedido lleva el lugar de JMAB que lo origina
 * (`Clase.método`, como lo escribe el oráculo).
 *
 * - Modo PRNG (`PrngCaianiRng`): xoshiro128** de rng.ts como fuente de uniformes; la normal plegada
 *   por inversa (normal.ts), un uniforme por sorteo. Las mezclas de listas de agentes usan por defecto
 *   el algoritmo (sesgado) de JMAB; ver `ShuffleAlgorithm`.
 * - Modo oráculo (`OracleCaianiRng`, V3): devuelve, en orden, los valores que registró el `.jar`
 *   instrumentado (`reference/p0/oracle`, `oracle.Draws`), y verifica que el tipo y el lugar
 *   coincidan. No importa con qué método ni con cuántos uniformes los generó Colt: se consume el
 *   resultado (confirmado con Nico el 2026-11-12).
 *
 * Tipos del registro del oráculo (columna 3 de draws.tsv) y su detalle (columna 5):
 * - `fn`: normal plegada; el valor |N| (Double.toString de Java: parseFloat lo lee exacto).
 *   El σ no se registra: no se puede verificar.
 * - `bern`: Bernoulli; `p:resultado`. Solo se sortea si 0 < p < 1 (si no, no hay registro).
 * - `shuffle`: AgentList.shuffle; `qué:ids en el orden resultante`.
 * - `shuffleEmp`: Collections.shuffle de los empleados; `id del dueño:ids en el orden resultante`.
 * - `sample`: vendedores elegidos por un comprador; `id del comprador:ids elegidos, en orden`. Desde el
 *   2026-11-13 los mezcladores del oráculo registran la mezcla completa (`shuffle sellers`) en su lugar.
 * - `unif`: Math.random del rescate de bancos; `qué:valor`.
 * Los ids son los de JMAB: el arnés de V3 pasa la función que da el id de JMAB de cada agente.
 */

import { Rng } from '../rng';
import { foldedNormalFromUniform } from './normal';

export interface CaianiRng {
  /** |N(0, σ)|. */
  foldedNormal(site: string, sigma: number): number;
  /** true con probabilidad p. Con p ≤ 0 o p ≥ 1 no sortea (como JMAB, que no llama al generador). */
  bernoulli(site: string, p: number): boolean;
  /** Mezcla `items` en el lugar (AgentList.shuffle). `what` identifica la lista (p. ej. "buyers"). */
  shuffle<T>(site: string, what: string, items: T[], idOf: (t: T) => number): T[];
  /** Mezcla los empleados de `ownerId` en el lugar (Collections.shuffle). */
  shuffleEmployees<T>(site: string, ownerId: number, items: T[], idOf: (t: T) => number): T[];
  /** Elige `n` de `candidates` sin reposición, en orden de elección. */
  sample<T>(site: string, buyerId: number, candidates: readonly T[], n: number, idOf: (t: T) => number): T[];
  /** Uniforme en [0, 1). */
  uniform01(site: string, what: string): number;
}

/**
 * Algoritmo de `AgentList.shuffle` (modo PRNG):
 * - `'jmab'` (por defecto): el de JMAB (`net.sourceforge.jabm.agent.AgentList.shuffle`): para cada
 *   i < n − 1, intercambia la posición i con ⌊n·u⌋, una posición al azar de **toda** la lista. **No es
 *   uniforme** (hay n^(n−1) caminos para n! órdenes). Es un defecto de JMAB que se reproduce a
 *   propósito, para que la distribución de los órdenes sea la del `.jar` (decisión de Nico, 2026-11-13).
 * - `'uniform'`: Fisher–Yates, para medir cuánto influye el sesgo.
 * `Collections.shuffle` (empleados) es uniforme en Java y usa siempre Fisher–Yates.
 */
export type ShuffleAlgorithm = 'jmab' | 'uniform';

export interface PrngOptions {
  shuffle?: ShuffleAlgorithm;
}

/**
 * `AgentList.shuffle` de JMAB, en el lugar: `choice = (int)((long) n · prng.raw())`. `next` da
 * uniformes en [0, 1). n − 1 sorteos.
 */
export function jmabShuffle<T>(items: T[], next: () => number): T[] {
  const n = items.length;
  for (let i = 0; i < n - 1; i++) {
    const choice = Math.floor(n * next());
    const tmp = items[i] as T;
    items[i] = items[choice] as T;
    items[choice] = tmp;
  }
  return items;
}

export class PrngCaianiRng implements CaianiRng {
  readonly shuffleAlgorithm: ShuffleAlgorithm;

  constructor(
    readonly rng: Rng,
    options: PrngOptions = {},
  ) {
    this.shuffleAlgorithm = options.shuffle ?? 'jmab';
  }

  foldedNormal(_site: string, sigma: number): number {
    return foldedNormalFromUniform(this.rng.nextFloat(), sigma);
  }

  bernoulli(_site: string, p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.rng.nextFloat() < p;
  }

  shuffle<T>(_site: string, _what: string, items: T[], _idOf?: (t: T) => number): T[] {
    if (this.shuffleAlgorithm === 'uniform') return this.rng.shuffle(items);
    return jmabShuffle(items, () => this.rng.nextFloat());
  }

  shuffleEmployees<T>(_site: string, _ownerId: number, items: T[], _idOf?: (t: T) => number): T[] {
    return this.rng.shuffle(items);
  }

  /** Fisher–Yates parcial sobre una copia: n sorteos. */
  sample<T>(_site: string, _buyerId: number, candidates: readonly T[], n: number, _idOf?: (t: T) => number): T[] {
    if (!Number.isInteger(n) || n < 0) throw new Error(`sample: n inválido ${n}`);
    const pool = candidates.slice();
    const k = Math.min(n, pool.length);
    for (let i = 0; i < k; i++) {
      const j = i + this.rng.nextInt(pool.length - i);
      const tmp = pool[i] as T;
      pool[i] = pool[j] as T;
      pool[j] = tmp;
    }
    return pool.slice(0, k);
  }

  uniform01(_site: string, _what: string): number {
    return this.rng.nextFloat();
  }
}

// ---------------------------------------------------------------------------------------------
// Modo oráculo
// ---------------------------------------------------------------------------------------------

export type DrawType = 'fn' | 'bern' | 'shuffle' | 'shuffleEmp' | 'sample' | 'unif';
const DRAW_TYPES: readonly string[] = ['fn', 'bern', 'shuffle', 'shuffleEmp', 'sample', 'unif'];

export interface DrawRecord {
  seq: number;
  tick: number;
  type: DrawType;
  site: string;
  detail: string;
  /** Índice del evento del tick (orden de modelFile.xml); −1 fuera de los eventos. Falta en los registros de P0/P1. */
  event?: number;
}

/** Lee el draws.tsv del oráculo: `secuencia, tick, tipo, lugar, detalle[, evento]` separados por tabuladores. */
export function parseDraws(text: string): DrawRecord[] {
  const out: DrawRecord[] = [];
  const lines = text.split('\n');
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n] as string;
    if (line === '') continue;
    const f = line.split('\t');
    if ((f.length !== 5 && f.length !== 6) || !DRAW_TYPES.includes(f[2] as string)) {
      throw new Error(`draws.tsv, línea ${n + 1}: formato inesperado: ${line.slice(0, 120)}`);
    }
    const r: DrawRecord = { seq: Number(f[0]), tick: Number(f[1]), type: f[2] as DrawType, site: f[3] as string, detail: f[4] as string };
    if (f.length === 6) r.event = Number(f[5]);
    out.push(r);
  }
  return out;
}

function splitDetail(r: DrawRecord): [string, string] {
  const k = r.detail.indexOf(':');
  if (k < 0) throw new Error(`oráculo: detalle sin ":" en la secuencia ${r.seq}: ${r.detail}`);
  return [r.detail.slice(0, k), r.detail.slice(k + 1)];
}

function parseIds(s: string): number[] {
  return s === '' ? [] : s.split(',').map(Number);
}

/** Reordena `items` según la lista de ids registrada; verifica que sean los mismos elementos. */
function reorderByIds<T>(items: T[], ids: readonly number[], idOf: (t: T) => number, where: string): T[] {
  if (ids.length !== items.length) {
    throw new Error(`oráculo (${where}): el registro tiene ${ids.length} elementos y el port ${items.length}`);
  }
  const byId = new Map<number, T>();
  for (const it of items) byId.set(idOf(it), it);
  const sorted = ids.map((id) => {
    const it = byId.get(id);
    if (it === undefined) throw new Error(`oráculo (${where}): el id ${id} del registro no está en la lista del port`);
    byId.delete(id);
    return it;
  });
  for (let i = 0; i < items.length; i++) items[i] = sorted[i] as T;
  return items;
}

export interface OracleOptions {
  /** Tolerancia relativa para comparar la p de una Bernoulli con la registrada (por defecto 1e-6, sec. 2.6). */
  pTolerance?: number;
  /**
   * Id de JMAB de un agente del port. Se aplica a lo que devuelve `idOf` (y a los ids de dueño y de
   * comprador) antes de compararlo con el registro. Por defecto, la identidad: así lo usa
   * `initialize`, que ya pasa un `idOf` con ids de JMAB. Los eventos pasan los ids del port y el arnés
   * de V3 fija acá la traducción.
   */
  agentId?: (id: number) => number;
}

export class OracleCaianiRng implements CaianiRng {
  private cursor = 0;
  /** Tick esperado; si se fija, se verifica contra el del registro. */
  tick: number | undefined;
  /** Bernoullis cuya p difirió de la registrada (dentro de la tolerancia, si no es error). */
  readonly pDiffs: { seq: number; site: string; logged: number; port: number }[] = [];
  private readonly pTolerance: number;
  private readonly agentId: (id: number) => number;

  constructor(
    private readonly records: readonly DrawRecord[],
    options: OracleOptions = {},
  ) {
    this.pTolerance = options.pTolerance ?? 1e-6;
    this.agentId = options.agentId ?? ((id) => id);
  }

  /** Cantidad de registros consumidos. */
  get consumed(): number {
    return this.cursor;
  }

  get remaining(): number {
    return this.records.length - this.cursor;
  }

  private next(type: DrawType, site: string): DrawRecord {
    const r = this.records[this.cursor];
    if (!r) throw new Error(`oráculo: se pidió ${type} en ${site} y el registro se terminó (${this.cursor} consumidos)`);
    if (r.type !== type || r.site !== site) {
      throw new Error(
        `oráculo: el port pidió ${type} en ${site}, el registro tiene ${r.type} en ${r.site} ` +
          `(secuencia ${r.seq}, tick ${r.tick})`,
      );
    }
    if (this.tick !== undefined && r.tick !== this.tick) {
      throw new Error(`oráculo: el port está en el tick ${this.tick} y el registro en el ${r.tick} (secuencia ${r.seq})`);
    }
    this.cursor++;
    return r;
  }

  foldedNormal(site: string, sigma: number): number {
    if (!(sigma >= 0)) throw new Error(`foldedNormal: σ tiene que ser ≥ 0, llegó ${sigma}`);
    const r = this.next('fn', site);
    const v = Number.parseFloat(r.detail);
    if (!(v >= 0)) throw new Error(`oráculo: valor de fn inválido en la secuencia ${r.seq}: ${r.detail}`);
    return v;
  }

  bernoulli(site: string, p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    const r = this.next('bern', site);
    const [ps, res] = splitDetail(r);
    const logged = Number.parseFloat(ps);
    if (logged !== p) {
      const rel = Math.abs(logged - p) / Math.max(Math.abs(logged), Math.abs(p));
      if (rel > this.pTolerance) {
        throw new Error(`oráculo: Bernoulli en ${site} con p = ${p}, el registro tiene p = ${logged} (secuencia ${r.seq})`);
      }
      this.pDiffs.push({ seq: r.seq, site, logged, port: p });
    }
    return res === '1';
  }

  shuffle<T>(site: string, what: string, items: T[], idOf: (t: T) => number): T[] {
    const r = this.next('shuffle', site);
    const [w, ids] = splitDetail(r);
    if (w !== what) throw new Error(`oráculo: shuffle de "${what}" en ${site}, el registro mezcla "${w}" (secuencia ${r.seq})`);
    return reorderByIds(items, parseIds(ids), (t) => this.agentId(idOf(t)), `shuffle ${site}, secuencia ${r.seq}`);
  }

  shuffleEmployees<T>(site: string, ownerId: number, items: T[], idOf: (t: T) => number): T[] {
    const r = this.next('shuffleEmp', site);
    const [owner, ids] = splitDetail(r);
    if (Number(owner) !== this.agentId(ownerId)) {
      throw new Error(`oráculo: empleados de ${this.agentId(ownerId)} en ${site}, el registro es de ${owner} (secuencia ${r.seq})`);
    }
    return reorderByIds(items, parseIds(ids), (t) => this.agentId(idOf(t)), `shuffleEmp ${site}, secuencia ${r.seq}`);
  }

  sample<T>(site: string, buyerId: number, candidates: readonly T[], n: number, idOf: (t: T) => number): T[] {
    const r = this.next('sample', site);
    const [buyer, ids] = splitDetail(r);
    if (Number(buyer) !== this.agentId(buyerId)) {
      throw new Error(`oráculo: muestra del comprador ${this.agentId(buyerId)} en ${site}, el registro es de ${buyer} (secuencia ${r.seq})`);
    }
    const chosen = parseIds(ids);
    if (chosen.length > n) throw new Error(`oráculo: muestra de ${chosen.length} con n = ${n} (secuencia ${r.seq})`);
    return chosen.map((id) => {
      const c = candidates.find((x) => this.agentId(idOf(x)) === id);
      if (c === undefined) throw new Error(`oráculo: el vendedor ${id} de la muestra no es candidato en el port (secuencia ${r.seq})`);
      return c;
    });
  }

  uniform01(site: string, what: string): number {
    const r = this.next('unif', site);
    const [w, v] = splitDetail(r);
    if (w !== what) throw new Error(`oráculo: uniforme "${what}" en ${site}, el registro es "${w}" (secuencia ${r.seq})`);
    return Number.parseFloat(v);
  }
}
