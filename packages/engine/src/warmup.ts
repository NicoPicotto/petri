/**
 * Calentamiento: la cápsula corre `burnInTicks` meses con perillas fijas antes
 * del mes 0 visible, para que el transitorio inicial (condiciones iniciales
 * inconsistentes entre sí) no se vea. Ver docs/fase0-reglas.md, "Calentamiento".
 *
 * Es igual para A y B (misma semilla, mismas perillas) y el usuario no puede
 * intervenir. Al terminar, el reloj visible vuelve a 0; `elapsedTicks` no.
 */

import { DEFAULT_KNOBS } from './knobs';
import { createInitialState, type SimConfig, type SimState } from './state';
import type { Stage } from './model';
import { step } from './step';

/** `stages`: reglas con las que se calienta (por defecto, las de la Fase 0, como `step`). */
export function createWarmState(seed: number, config: SimConfig, stages?: readonly Stage[]): SimState {
  const burnInTicks = config.burnInTicks ?? 0;
  if (!Number.isInteger(burnInTicks) || burnInTicks < 0) throw new Error(`burnInTicks inválido: ${burnInTicks}`);
  const burnInKnobs = { ...(config.burnInKnobs ?? config.knobs ?? DEFAULT_KNOBS) };
  let state = createInitialState(seed, { ...config, knobs: burnInKnobs });
  for (let t = 0; t < burnInTicks; t++) state = step(state, burnInKnobs, stages ? { stages } : {});
  return { ...state, tick: 0, knobs: { ...(config.knobs ?? burnInKnobs) } };
}
