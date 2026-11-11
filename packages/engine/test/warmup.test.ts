import { describe, expect, it } from 'vitest';
import { PHASE0_CONFIG, checkSfc, createInitialState, createWarmState, hashState, replay, type KnobLog } from '../src/index';

describe('calentamiento', () => {
  const config = { ...PHASE0_CONFIG, burnInTicks: 60 };

  it('deja el reloj visible en 0 y cuenta los meses transcurridos aparte', () => {
    const s = createWarmState(5, config);
    expect(s.tick).toBe(0);
    expect(s.elapsedTicks).toBe(60);
    expect(checkSfc(s)).toEqual([]);
  });

  it('es determinista e igual para A y B (misma semilla)', () => {
    expect(hashState(createWarmState(5, config))).toBe(hashState(createWarmState(5, config)));
    expect(hashState(createWarmState(5, config))).not.toBe(hashState(createWarmState(6, config)));
  });

  it('las perillas visibles iniciales no afectan el calentamiento', () => {
    const a = createWarmState(5, { ...config, knobs: { publicSpending: 5_000_000, structuralDeficitShare: 0 } });
    const b = createWarmState(5, { ...config, knobs: { publicSpending: 5_000_000, structuralDeficitShare: 0.5 } });
    expect({ ...a, knobs: null }).toStrictEqual({ ...b, knobs: null });
    expect(b.knobs.structuralDeficitShare).toBe(0.5);
  });

  it('sin calentamiento equivale al estado inicial', () => {
    expect(createWarmState(5, { ...config, burnInTicks: 0 })).toStrictEqual(
      createInitialState(5, { ...config, knobs: config.burnInKnobs }),
    );
  });

  it('replay desde el estado calentado: determinista y el log cuenta desde el mes 0 visible', () => {
    const log: KnobLog = [{ tick: 0, knob: 'structuralDeficitShare', from: 0, to: 0.5 }];
    const a = replay(5, createWarmState(5, config), log, 36);
    const b = replay(5, createWarmState(5, config), log, 36);
    expect(a.tick).toBe(36);
    expect(a.elapsedTicks).toBe(96);
    expect(hashState(a)).toBe(hashState(b));
  });

  it('replay rechaza una semilla que no coincide con la del estado', () => {
    expect(() => replay(6, createWarmState(5, config), [], 1)).toThrow(/no coincide/);
  });
});
