/**
 * Mensajes entre el hilo principal y el worker de una cápsula.
 *
 * Todo pedido lleva un `requestId` y recibe exactamente una respuesta con el
 * mismo id (`batch`, `run` o `error`).
 */

import type { KnobChange, KnobName, Knobs, SimConfig, Stats } from '@petri/engine';

export type MainToWorker =
  | { type: 'init'; requestId: number; seed: number; config: SimConfig; knobs: Knobs }
  | { type: 'advance'; requestId: number; ticks: number }
  | { type: 'setKnob'; requestId: number; knob: KnobName; value: number }
  | {
      type: 'replay';
      requestId: number;
      seed: number;
      config: SimConfig;
      initialKnobs: Knobs;
      log: KnobChange[];
      ticks: number;
    }
  | { type: 'getRun'; requestId: number };

/** Estado visible de la cápsula después de un pedido. */
export interface BatchMessage {
  type: 'batch';
  requestId: number;
  tick: number;
  /** 1 byte por hogar (HouseholdStatus). Transferible. */
  status: Uint8Array;
  /** Ingreso disponible del último mes por hogar, en centavos. Transferible. */
  income: Float64Array;
  /** Indicadores de CADA mes avanzado en este pedido, en orden. */
  stats: Stats[];
  knobs: Knobs;
  /** Log completo de la cápsula. El tick de cada entrada lo pone el worker. */
  log: KnobChange[];
  /** Solo en la respuesta a `replay`: hash del estado final. */
  hash?: string;
}

export interface RunMessage {
  type: 'run';
  requestId: number;
  seed: number;
  config: SimConfig;
  initialKnobs: Knobs;
  log: KnobChange[];
  ticks: number;
  hash: string;
}

export interface ErrorMessage {
  type: 'error';
  requestId: number;
  message: string;
}

export type WorkerToMain = BatchMessage | RunMessage | ErrorMessage;
