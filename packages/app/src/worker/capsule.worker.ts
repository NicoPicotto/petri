/**
 * Una cápsula = un Web Worker. Tiene su propio estado, sus perillas y su log.
 *
 * El worker es la fuente de verdad del log: el tick de cada cambio de perilla
 * es el tick del estado del worker en el momento en que procesa el mensaje.
 * Como el worker procesa un mensaje a la vez, un `setKnob` que llega mientras
 * corre un lote se procesa al terminar ese lote, y el cambio se aplica al
 * inicio del lote siguiente, con su tick real.
 */

import {
  applyKnobChange,
  createWarmState,
  hashState,
  makeKnobChange,
  replay,
  step,
  type KnobChange,
  type Knobs,
  type SimConfig,
  type SimState,
  type Stats,
} from '@petri/engine';
import type { BatchMessage, MainToWorker, WorkerToMain } from './protocol';

interface WorkerScope {
  postMessage(message: WorkerToMain, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<MainToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;

interface Capsule {
  seed: number;
  config: SimConfig;
  initialKnobs: Knobs;
  state: SimState;
  knobs: Knobs;
  log: KnobChange[];
}

let capsule: Capsule | null = null;

function current(): Capsule {
  if (!capsule) throw new Error('La cápsula no está inicializada');
  return capsule;
}

function postBatch(requestId: number, stats: Stats[], hash?: string): void {
  const c = current();
  const n = c.state.households.length;
  const status = new Uint8Array(n);
  const income = new Float64Array(n);
  c.state.households.forEach((hh, i) => {
    status[i] = hh.employerId !== null ? 1 : 0;
    income[i] = hh.incomeLastMonth;
  });
  const message: BatchMessage = {
    type: 'batch',
    requestId,
    tick: c.state.tick,
    status,
    income,
    stats,
    knobs: { ...c.knobs },
    log: [...c.log],
    ...(hash !== undefined ? { hash } : {}),
  };
  scope.postMessage(message, [status.buffer, income.buffer]);
}

function handle(msg: MainToWorker): void {
  switch (msg.type) {
    case 'init': {
      // Calentamiento incluido: el mes 0 visible es el estado calentado.
      const state = createWarmState(msg.seed, { ...msg.config, knobs: msg.knobs });
      capsule = { seed: msg.seed, config: msg.config, initialKnobs: { ...state.knobs }, state, knobs: state.knobs, log: [] };
      // El mes 0 visible también es un punto de la serie (indicadores del último mes de calentamiento).
      postBatch(msg.requestId, [{ ...state.stats }]);
      return;
    }
    case 'advance': {
      const c = current();
      const stats: Stats[] = [];
      for (let i = 0; i < msg.ticks; i++) {
        c.state = step(c.state, c.knobs);
        stats.push({ ...c.state.stats });
      }
      postBatch(msg.requestId, stats);
      return;
    }
    case 'setKnob': {
      const c = current();
      if (c.knobs[msg.knob] !== msg.value) {
        const change = makeKnobChange(c.state.tick, c.knobs, msg.knob, msg.value);
        c.knobs = applyKnobChange(c.knobs, change);
        c.log.push(change);
      }
      postBatch(msg.requestId, []);
      return;
    }
    case 'replay': {
      // El replay rehace el calentamiento, así el hash cubre toda la corrida.
      const initial = createWarmState(msg.seed, { ...msg.config, knobs: msg.initialKnobs });
      const stats: Stats[] = [{ ...initial.stats }];
      const state = replay(msg.seed, initial, msg.log, msg.ticks, {
        onTick: (s) => stats.push({ ...s.stats }),
      });
      // Las perillas vigentes incluyen los cambios registrados en el último tick (aún sin avanzar).
      const knobs = msg.log.reduce(applyKnobChange, { ...msg.initialKnobs });
      capsule = {
        seed: msg.seed,
        config: msg.config,
        initialKnobs: { ...msg.initialKnobs },
        state,
        knobs,
        log: [...msg.log],
      };
      postBatch(msg.requestId, stats, hashState(state));
      return;
    }
    case 'getRun': {
      const c = current();
      scope.postMessage({
        type: 'run',
        requestId: msg.requestId,
        seed: c.seed,
        config: c.config,
        initialKnobs: c.initialKnobs,
        log: [...c.log],
        ticks: c.state.tick,
        hash: hashState(c.state),
      });
      return;
    }
  }
}

scope.onmessage = (event) => {
  try {
    handle(event.data);
  } catch (err) {
    scope.postMessage({
      type: 'error',
      requestId: event.data.requestId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
