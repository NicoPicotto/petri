/**
 * Perillas de política y log de perillas.
 *
 * Una corrida = semilla + estado inicial + log. Cada movimiento de perilla queda
 * registrado con el tick en el que se aplica, el valor anterior y el nuevo.
 * Semántica: un cambio con `tick = t` se aplica antes de calcular el paso t → t+1.
 */

import { assertCents, type Cents } from './money';

export interface Knobs {
  /** Gasto público por mes, en centavos: transferencias iguales a todos los hogares (R8). */
  publicSpending: Cents;
  /**
   * "Déficit estructural financiado con emisión", en [0, 1] (R8): la parte del
   * gasto que los impuestos NO cubren a pleno empleo. El déficit cíclico (por
   * debajo del pleno empleo) también se emite, automáticamente, porque en la
   * Fase 0 no hay bonos.
   */
  structuralDeficitShare: number;
}

export type KnobName = keyof Knobs;

export const KNOB_NAMES: readonly KnobName[] = ['publicSpending', 'structuralDeficitShare'];

/**
 * Escenario por defecto: gasto de 50.000 pesos por mes (100 pesos por hogar,
 * ~10% de la masa salarial inicial) financiado todo con impuestos. Supuesto.
 */
export const DEFAULT_KNOBS: Knobs = {
  publicSpending: 5_000_000,
  structuralDeficitShare: 0,
};

export interface KnobChange {
  tick: number;
  knob: KnobName;
  from: number;
  to: number;
}

export type KnobLog = readonly KnobChange[];

export function validateKnobValue(knob: KnobName, value: number): void {
  switch (knob) {
    case 'publicSpending':
      assertCents(value, 'publicSpending');
      if (value < 0) throw new Error(`publicSpending no puede ser negativo, llegó ${value}`);
      return;
    case 'structuralDeficitShare':
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`structuralDeficitShare tiene que estar en [0, 1], llegó ${value}`);
      }
      return;
  }
}

/**
 * Aplica un cambio del log. Falla si `from` no coincide con el valor vigente:
 * eso indica un log que no corresponde a esta corrida.
 */
export function applyKnobChange(knobs: Knobs, change: KnobChange): Knobs {
  if (knobs[change.knob] !== change.from) {
    throw new Error(
      `Log inconsistente en tick ${change.tick}: '${change.knob}' vale ${knobs[change.knob]}, el log dice ${change.from}`,
    );
  }
  validateKnobValue(change.knob, change.to);
  return { ...knobs, [change.knob]: change.to };
}

/** Arma la entrada de log para mover una perilla en el tick actual. */
export function makeKnobChange(tick: number, knobs: Knobs, knob: KnobName, value: number): KnobChange {
  validateKnobValue(knob, value);
  return { tick, knob, from: knobs[knob], to: value };
}

/** Verifica que el log esté ordenado por tick y que los ticks sean enteros no negativos. */
export function validateKnobLog(log: KnobLog): void {
  let prev = -Infinity;
  for (const entry of log) {
    if (!Number.isInteger(entry.tick) || entry.tick < 0) {
      throw new Error(`Tick inválido en el log: ${entry.tick}`);
    }
    if (entry.tick < prev) throw new Error('El log de perillas tiene que estar ordenado por tick');
    prev = entry.tick;
  }
}
