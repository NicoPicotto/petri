/**
 * Reproducción de corridas: semilla + estado inicial + log de perillas.
 *
 * El mismo log se puede reaplicar sobre otro estado inicial (otra cápsula, otro
 * contexto mundial) para separar las decisiones de la suerte.
 */

import { applyKnobChange, validateKnobLog, type KnobLog } from './knobs';
import { cloneState, type SimState } from './state';
import { step, type StepOptions } from './step';

export interface ReplayOptions extends StepOptions {
  /** Se llama después de cada tick (ej.: para armar series de indicadores). No puede modificar el estado. */
  onTick?: (state: Readonly<SimState>) => void;
}

/**
 * Corre `ticks` pasos desde `initialState`. `seed` tiene que ser la semilla del estado inicial.
 * En cada tick t aplica primero los cambios del log con `tick === t` y después avanza.
 * Los cambios con tick ≥ tick final quedan sin aplicar.
 */
export function replay(
  seed: number,
  initialState: SimState,
  log: KnobLog,
  ticks: number,
  options: ReplayOptions = {},
): SimState {
  if (!Number.isInteger(ticks) || ticks < 0) throw new Error(`ticks inválido: ${ticks}`);
  validateKnobLog(log);
  const first = log[0];
  if (first !== undefined && first.tick < initialState.tick) {
    throw new Error(`El log tiene cambios en el tick ${first.tick}, anterior al estado inicial (${initialState.tick})`);
  }

  if (initialState.seed !== seed) {
    throw new Error(`La semilla ${seed} no coincide con la del estado inicial (${initialState.seed})`);
  }
  // El generador sigue desde donde quedó (por ejemplo, al final del calentamiento):
  // resembrarlo repetiría la misma secuencia de números.
  let state: SimState = cloneState(initialState);
  let knobs = state.knobs;
  let i = 0;
  const endTick = initialState.tick + ticks;
  while (state.tick < endTick) {
    for (let entry = log[i]; entry !== undefined && entry.tick === state.tick; entry = log[++i]) {
      knobs = applyKnobChange(knobs, entry);
    }
    state = step(state, knobs, options);
    options.onTick?.(state);
  }
  return state;
}
