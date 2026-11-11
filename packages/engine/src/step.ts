/**
 * Avance de un tick.
 *
 * `step` es puro: no modifica el estado que recibe, devuelve uno nuevo.
 * Internamente corre una lista ordenada de etapas sobre una copia. Las reglas
 * de comportamiento de la Fase 0 están en model.ts (PHASE0_STAGES).
 * Se llaman "etapas" (Stage) para no confundirlas con las fases del roadmap.
 */

import { checkAgentsSfc } from './ledger';
import type { Knobs } from './knobs';
import { PHASE0_STAGES, type Stage } from './model';
import { Rng } from './rng';
import { allAgents, cloneState, type SimState } from './state';

export interface StepOptions {
  /** Etapas a correr. Por defecto, las reglas de la Fase 0. Los tests pueden inyectar otras. */
  stages?: readonly Stage[];
  /** Verifica el invariante SFC al final del tick. Por defecto true (es barato con este tamaño). */
  checkInvariants?: boolean;
}

export function step(state: SimState, knobs: Knobs, options: StepOptions = {}): SimState {
  const { stages = PHASE0_STAGES, checkInvariants = true } = options;
  const next = cloneState(state);
  next.knobs = { ...knobs };
  const rng = new Rng(next.rng);
  for (const stage of stages) stage(next, next.knobs, rng);
  next.rng = rng.toState();
  next.tick += 1;
  if (checkInvariants) assertSfc(next);
  return next;
}

export function checkSfc(state: SimState) {
  return checkAgentsSfc(allAgents(state));
}

export function assertSfc(state: SimState): void {
  const violations = checkSfc(state);
  if (violations.length > 0) {
    throw new Error(`Invariante SFC roto en tick ${state.tick}: ${JSON.stringify(violations)}`);
  }
}
