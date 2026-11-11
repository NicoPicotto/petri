import { describe, expect, it } from 'vitest';
import { PHASE0_CONFIG, createInitialState, hashState, replay, type KnobLog } from '../src/index';

const log: KnobLog = [{ tick: 12, knob: 'structuralDeficitShare', from: 0, to: 0.5 }];

describe('hashState', () => {
  it('mismo estado = mismo hash; 16 caracteres hex', () => {
    const a = replay(3, createInitialState(3, PHASE0_CONFIG), log, 60);
    const b = replay(3, createInitialState(3, PHASE0_CONFIG), log, 60);
    expect(hashState(a)).toBe(hashState(b));
    expect(hashState(a)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('distinta semilla, distinto log o distinto tick = distinto hash', () => {
    const base = hashState(replay(3, createInitialState(3, PHASE0_CONFIG), log, 60));
    expect(hashState(replay(4, createInitialState(4, PHASE0_CONFIG), log, 60))).not.toBe(base);
    expect(hashState(replay(3, createInitialState(3, PHASE0_CONFIG), [], 60))).not.toBe(base);
    expect(hashState(replay(3, createInitialState(3, PHASE0_CONFIG), log, 61))).not.toBe(base);
  });

  it('detecta un cambio de un centavo', () => {
    const state = createInitialState(3, PHASE0_CONFIG);
    const before = hashState(state);
    state.households[0]!.positions.deposits += 1;
    expect(hashState(state)).not.toBe(before);
  });
});
