/**
 * Snapshot: lo único que la visual recibe del motor.
 *
 * Es plano y usa arrays tipados para poder transferirlo por postMessage desde
 * el Web Worker sin copias caras. La visual nunca toca el SimState.
 */

import type { SimState, Stats } from './state';

export const HouseholdStatus = {
  Unemployed: 0,
  Employed: 1,
} as const;

export interface Snapshot {
  tick: number;
  /** Un byte por hogar, en orden de ID. Valores: HouseholdStatus. */
  households: Uint8Array;
  indicators: Stats;
}

export function toSnapshot(state: SimState): Snapshot {
  const households = new Uint8Array(state.households.length);
  state.households.forEach((hh, i) => {
    households[i] = hh.employerId !== null ? HouseholdStatus.Employed : HouseholdStatus.Unemployed;
  });
  return { tick: state.tick, households, indicators: { ...state.stats } };
}
