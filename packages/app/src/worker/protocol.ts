/** Mensajes entre el hilo principal y el worker de una cápsula. */

import type { KnobName, SimConfig, Snapshot } from '@petri/engine';

export type MainToWorker =
  | { type: 'init'; seed: number; config: SimConfig }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'setKnob'; knob: KnobName; value: number };

export type WorkerToMain =
  | { type: 'snapshot'; snapshot: Snapshot; running: boolean; logLength: number }
  | { type: 'error'; message: string };
