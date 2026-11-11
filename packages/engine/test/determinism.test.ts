import { describe, expect, it } from 'vitest';
import { PHASE0_CONFIG, createInitialState, replay, step, type KnobLog } from '../src/index';
import { randomTransactionsStage } from './helpers/randomStage';

const stages = [randomTransactionsStage];
const TICKS = 500;

const log: KnobLog = [
  { tick: 0, knob: 'publicSpending', from: 5_000_000, to: 20_000 },
  { tick: 100, knob: 'monetaryFinancingShare', from: 0, to: 0.3 },
  { tick: 250, knob: 'publicSpending', from: 20_000, to: 500_000 },
  { tick: 250, knob: 'monetaryFinancingShare', from: 0.3, to: 0.8 },
  { tick: 400, knob: 'publicSpending', from: 500_000, to: 0 },
];

describe('determinismo', () => {
  it('misma semilla + mismo log = estado final idéntico', () => {
    const a = replay(7, createInitialState(7, PHASE0_CONFIG), log, TICKS, { stages });
    const b = replay(7, createInitialState(7, PHASE0_CONFIG), log, TICKS, { stages });
    expect(a.tick).toBe(TICKS);
    expect(a).toStrictEqual(b);
  });

  it('otra semilla da otro resultado (el test anterior no pasa en vacío)', () => {
    const a = replay(7, createInitialState(7, PHASE0_CONFIG), log, TICKS, { stages });
    const b = replay(8, createInitialState(8, PHASE0_CONFIG), log, TICKS, { stages });
    expect(a).not.toStrictEqual(b);
  });

  it('otro log da otro resultado', () => {
    const a = replay(7, createInitialState(7, PHASE0_CONFIG), log, TICKS, { stages });
    const b = replay(7, createInitialState(7, PHASE0_CONFIG), [], TICKS, { stages });
    expect(a).not.toStrictEqual(b);
  });

  it('replay equivale a avanzar a mano aplicando los cambios en su tick', () => {
    let state = createInitialState(7, PHASE0_CONFIG);
    let knobs = state.knobs;
    for (let t = 0; t < TICKS; t++) {
      for (const c of log) if (c.tick === t) knobs = { ...knobs, [c.knob]: c.to };
      state = step(state, knobs, { stages });
    }
    expect(replay(7, createInitialState(7, PHASE0_CONFIG), log, TICKS, { stages })).toStrictEqual(state);
  });

  it('replay no modifica el estado inicial', () => {
    const initial = createInitialState(7, PHASE0_CONFIG);
    const before = JSON.stringify(initial);
    replay(7, initial, log, 50, { stages });
    expect(JSON.stringify(initial)).toBe(before);
  });

  it('rechaza un log que no corresponde a la corrida', () => {
    const bad: KnobLog = [{ tick: 3, knob: 'publicSpending', from: 999, to: 1 }];
    expect(() => replay(7, createInitialState(7, PHASE0_CONFIG), bad, 10, { stages })).toThrow(/inconsistente/);
  });

  it('rechaza un log desordenado', () => {
    const bad: KnobLog = [
      { tick: 5, knob: 'publicSpending', from: 5_000_000, to: 1 },
      { tick: 2, knob: 'publicSpending', from: 1, to: 2 },
    ];
    expect(() => replay(7, createInitialState(7, PHASE0_CONFIG), bad, 10)).toThrow(/ordenado/);
  });
});
