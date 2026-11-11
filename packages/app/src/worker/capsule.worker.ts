/**
 * Una cápsula = un Web Worker. Tiene su propio estado, sus perillas y su log.
 * El hilo principal solo recibe snapshots.
 */

import {
  createInitialState,
  makeKnobChange,
  applyKnobChange,
  step,
  toSnapshot,
  type KnobChange,
  type Knobs,
  type SimState,
} from '@petri/engine';
import type { MainToWorker, WorkerToMain } from './protocol';

const TICKS_PER_BATCH = 10;
const BATCH_INTERVAL_MS = 50;

interface WorkerScope {
  postMessage(message: WorkerToMain, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<MainToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;

let state: SimState | null = null;
let knobs: Knobs | null = null;
let seed = 0;
const log: KnobChange[] = [];
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function post(): void {
  if (!state) return;
  const snapshot = toSnapshot(state);
  scope.postMessage({ type: 'snapshot', snapshot, running, logLength: log.length }, [snapshot.households.buffer]);
}

function loop(): void {
  timer = null;
  if (!running || !state || !knobs) return;
  for (let i = 0; i < TICKS_PER_BATCH; i++) state = step(state, knobs);
  post();
  timer = setTimeout(loop, BATCH_INTERVAL_MS);
}

function handle(msg: MainToWorker): void {
  switch (msg.type) {
    case 'init':
      seed = msg.seed;
      state = createInitialState(seed, msg.config);
      knobs = state.knobs;
      log.length = 0;
      running = false;
      post();
      return;
    case 'play':
      running = true;
      if (timer === null) loop();
      return;
    case 'pause':
      running = false;
      post();
      return;
    case 'setKnob': {
      if (!state || !knobs) return;
      const change = makeKnobChange(state.tick, knobs, msg.knob, msg.value);
      knobs = applyKnobChange(knobs, change);
      log.push(change);
      post();
      return;
    }
  }
}

scope.onmessage = (event) => {
  try {
    handle(event.data);
  } catch (err) {
    running = false;
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
