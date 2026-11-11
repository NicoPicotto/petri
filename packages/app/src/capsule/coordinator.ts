/**
 * Coordinador de las dos cápsulas.
 *
 * Las cápsulas avanzan en lockstep: en cada cuadro de pantalla se les pide a
 * las dos `advance(k)` y no se pide el lote siguiente hasta que respondieron
 * ambas. Así A y B siempre están en el mismo mes.
 *
 * La vista nunca decide el tick de un cambio de perilla: lo registra el worker.
 */

import { DEFAULT_KNOBS, PHASE0_CONFIG, type KnobChange, type KnobName, type Knobs, type Stats } from '@petri/engine';
import type { BatchMessage } from '../worker/protocol';
import { RUN_FORMAT, RUN_PHASE, RUN_VERSION, type CapsuleId, type RunConfig, type RunFile } from '../run/runFile';
import { CapsuleClient } from './CapsuleClient';

export const CAPSULE_IDS: readonly CapsuleId[] = ['A', 'B'];
/** Configuración de las cápsulas nuevas: Fase 0 con su calentamiento explícito. */
const RUN_CONFIG: RunConfig = {
  households: PHASE0_CONFIG.households,
  firms: PHASE0_CONFIG.firms,
  burnInTicks: PHASE0_CONFIG.burnInTicks ?? 0,
  burnInKnobs: { ...(PHASE0_CONFIG.burnInKnobs ?? DEFAULT_KNOBS) },
};
export const SPEEDS = [1, 6, 24, 120] as const; // meses por segundo
/** Tope de meses por lote, para que la UI no se trabe si un cuadro tarda. */
const MAX_TICKS_PER_BATCH = 120;

export interface Series {
  tick: number[];
  priceIndex: number[];
  /** Inflación interanual: P_t / P_{t-12} − 1 (null los primeros 12 meses). */
  inflationYoY: (number | null)[];
  unemployment: number[];
  realWage: number[];
  poverty: number[];
  effectiveEmission: number[];
}

export interface CapsuleView {
  id: CapsuleId;
  tick: number;
  status: Uint8Array;
  income: Float64Array;
  knobs: Knobs;
  log: KnobChange[];
  series: Series;
}

export type Verification =
  | { kind: 'verified'; hashes: Record<CapsuleId, string> }
  | { kind: 'mismatch'; detail: string }
  | null;

function emptySeries(): Series {
  return { tick: [], priceIndex: [], inflationYoY: [], unemployment: [], realWage: [], poverty: [], effectiveEmission: [] };
}

function emptyView(id: CapsuleId): CapsuleView {
  return {
    id,
    tick: 0,
    status: new Uint8Array(0),
    income: new Float64Array(0),
    knobs: { ...DEFAULT_KNOBS },
    log: [],
    series: emptySeries(),
  };
}

function appendStats(series: Series, lastTick: number, stats: Stats[]): void {
  const first = lastTick - stats.length + 1;
  stats.forEach((s, i) => {
    series.tick.push(first + i);
    series.priceIndex.push(s.priceIndex);
    const n = series.priceIndex.length;
    const yearAgo = n > 12 ? series.priceIndex[n - 13] : undefined;
    series.inflationYoY.push(yearAgo !== undefined ? s.priceIndex / yearAgo - 1 : null);
    series.unemployment.push(s.unemployment);
    series.realWage.push(s.realWage);
    series.poverty.push(s.poverty);
    series.effectiveEmission.push(s.effectiveEmissionShare);
  });
}

export class Coordinator {
  seed: number;
  running = false;
  speed: number = SPEEDS[1];
  error: string | null = null;
  verification: Verification = null;
  readonly views: Record<CapsuleId, CapsuleView> = { A: emptyView('A'), B: emptyView('B') };

  private readonly clients: Record<CapsuleId, CapsuleClient> = { A: new CapsuleClient(), B: new CapsuleClient() };
  private readonly listeners = new Set<() => void>();
  private version = 0;
  /** Se incrementa en cada reset/import: las respuestas de épocas anteriores se descartan. */
  private epoch = 0;
  private busy = false;
  private accumulated = 0;
  private lastFrame = 0;
  private rafId = 0;

  constructor(seed: number) {
    this.seed = seed;
    this.rafId = requestAnimationFrame(this.frame);
  }

  // --- Suscripción para React (useSyncExternalStore) ---
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = (): number => this.version;
  private notify(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  private apply(id: CapsuleId, b: BatchMessage): void {
    const v = this.views[id];
    v.tick = b.tick;
    v.status = b.status;
    v.income = b.income;
    v.knobs = b.knobs;
    v.log = b.log;
    appendStats(v.series, b.tick, b.stats);
  }

  private fail(err: unknown): void {
    this.running = false;
    this.error = err instanceof Error ? err.message : String(err);
    this.notify();
  }

  // --- Controles ---
  async reset(seed: number = this.seed): Promise<void> {
    this.running = false;
    this.seed = seed;
    const epoch = ++this.epoch;
    this.busy = false;
    this.error = null;
    this.verification = null;
    try {
      const batches = await Promise.all(
        CAPSULE_IDS.map((id) =>
          this.clients[id].batch({ type: 'init', seed, config: RUN_CONFIG, knobs: DEFAULT_KNOBS }),
        ),
      );
      if (epoch !== this.epoch) return;
      CAPSULE_IDS.forEach((id, i) => {
        Object.assign(this.views[id], emptyView(id));
        this.apply(id, batches[i]!);
      });
      this.notify();
    } catch (err) {
      this.fail(err);
    }
  }

  setRunning(running: boolean): void {
    this.running = running;
    this.accumulated = 0;
    this.notify();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.notify();
  }

  async setKnob(id: CapsuleId, knob: KnobName, value: number): Promise<void> {
    const epoch = this.epoch;
    try {
      const b = await this.clients[id].batch({ type: 'setKnob', knob, value });
      if (epoch !== this.epoch) return;
      // Solo actualiza perillas y log: los indicadores llegan con los lotes.
      const v = this.views[id];
      v.knobs = b.knobs;
      v.log = b.log;
      this.notify();
    } catch (err) {
      this.fail(err);
    }
  }

  private frame = (now: number): void => {
    const dt = this.lastFrame === 0 ? 0 : (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (this.running && !this.busy) {
      this.accumulated = Math.min(this.accumulated + dt * this.speed, this.speed);
      const ticks = Math.min(Math.floor(this.accumulated), MAX_TICKS_PER_BATCH);
      if (ticks >= 1) {
        this.accumulated -= ticks;
        this.busy = true;
        const epoch = this.epoch;
        Promise.all(CAPSULE_IDS.map((id) => this.clients[id].batch({ type: 'advance', ticks })))
          .then((batches) => {
            if (epoch !== this.epoch) return;
            CAPSULE_IDS.forEach((id, i) => this.apply(id, batches[i]!));
            this.notify();
          })
          .catch((err) => this.fail(err))
          .finally(() => {
            if (epoch === this.epoch) this.busy = false;
          });
      }
    }
    this.rafId = requestAnimationFrame(this.frame);
  };

  // --- Corridas ---
  async exportRun(): Promise<RunFile> {
    this.setRunning(false);
    const runs = await Promise.all(CAPSULE_IDS.map((id) => this.clients[id].getRun()));
    const [a, b] = runs as [(typeof runs)[0], (typeof runs)[0]];
    if (a.ticks !== b.ticks) throw new Error('Las cápsulas no están en el mismo tick');
    return {
      format: RUN_FORMAT,
      version: RUN_VERSION,
      phase: RUN_PHASE,
      seed: a.seed,
      config: { ...RUN_CONFIG, ...a.config } as RunConfig,
      capsules: runs.map((r, i) => ({
        id: CAPSULE_IDS[i]!,
        initialKnobs: r.initialKnobs,
        log: r.log,
        ticks: r.ticks,
        finalStateHash: r.hash,
      })),
    };
  }

  async importRun(run: RunFile): Promise<void> {
    this.running = false;
    const epoch = ++this.epoch;
    this.busy = false;
    this.error = null;
    this.verification = null;
    this.seed = run.seed;
    this.notify();
    try {
      const batches = await Promise.all(
        run.capsules.map((c) =>
          this.clients[c.id].batch({
            type: 'replay',
            seed: run.seed,
            config: run.config,
            initialKnobs: c.initialKnobs,
            log: c.log,
            ticks: c.ticks,
          }),
        ),
      );
      if (epoch !== this.epoch) return;
      const hashes = {} as Record<CapsuleId, string>;
      const mismatches: string[] = [];
      run.capsules.forEach((c, i) => {
        const b = batches[i]!;
        Object.assign(this.views[c.id], emptyView(c.id));
        this.apply(c.id, b);
        hashes[c.id] = b.hash ?? '';
        if (b.hash !== c.finalStateHash) {
          mismatches.push(`cápsula ${c.id}: esperado ${c.finalStateHash}, obtenido ${b.hash ?? '—'}`);
        }
      });
      this.verification =
        mismatches.length === 0 ? { kind: 'verified', hashes } : { kind: 'mismatch', detail: mismatches.join('; ') };
      this.notify();
    } catch (err) {
      this.fail(err);
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.epoch++;
    for (const id of CAPSULE_IDS) this.clients[id].terminate();
  }
}
