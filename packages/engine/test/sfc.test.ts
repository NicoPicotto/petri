import { describe, expect, it } from 'vitest';
import {
  INSTRUMENTS,
  PHASE0_CONFIG,
  allAgents,
  balanceSheetMatrix,
  checkSfc,
  createInitialState,
  issue,
  step,
  transfer,
} from '../src/index';
import { randomTransactionsStage } from './helpers/randomStage';

const stages = [randomTransactionsStage];

describe('invariante SFC', () => {
  it('el estado inicial cumple el invariante', () => {
    expect(checkSfc(createInitialState(1, PHASE0_CONFIG))).toEqual([]);
  });

  it('se mantiene durante 1000 ticks de transacciones al azar', () => {
    let state = createInitialState(42, PHASE0_CONFIG);
    state = { ...state, knobs: { publicSpending: 50_000, monetaryFinancingShare: 0.5 } };
    for (let t = 0; t < 1000; t++) {
      state = step(state, state.knobs, { stages, checkInvariants: false });
      expect(checkSfc(state)).toEqual([]);
    }
    // Que el test no pase en vacío: hubo actividad en todos los instrumentos.
    const matrix = balanceSheetMatrix(allAgents(state));
    for (const instr of INSTRUMENTS) {
      const touched = Object.values(matrix[instr]).some((v) => v !== 0);
      expect(touched, `instrumento ${instr} sin movimiento`).toBe(true);
    }
    // Patrimonio financiero neto total = 0.
    const netWorth = allAgents(state).reduce(
      (acc, a) => acc + INSTRUMENTS.reduce((s, i) => s + a.positions[i], 0),
      0,
    );
    expect(netWorth).toBe(0);
  });

  it('detecta una posición sin contrapartida', () => {
    const state = createInitialState(1, PHASE0_CONFIG);
    state.households[0]!.positions.deposits += 100; // plata que aparece de la nada
    expect(checkSfc(state)).toEqual([{ type: 'nonzero-row', instrument: 'deposits', sum: 100 }]);
  });

  it('detecta un sector con un instrumento que no le corresponde', () => {
    const state = createInitialState(1, PHASE0_CONFIG);
    state.households[0]!.positions.reserves = 100;
    state.centralBank.positions.reserves -= 100;
    expect(checkSfc(state)).toEqual([
      { type: 'forbidden-position', agentId: 0, sector: 'household', instrument: 'reserves', amount: 100 },
    ]);
  });

  it('detecta montos no enteros', () => {
    const state = createInitialState(1, PHASE0_CONFIG);
    state.households[0]!.positions.cash = 0.5;
    expect(checkSfc(state).some((v) => v.type === 'not-integer')).toBe(true);
  });

  it('step falla si una etapa rompe el invariante', () => {
    const state = createInitialState(1, PHASE0_CONFIG);
    const badStage = (s: typeof state) => {
      s.households[0]!.positions.cash += 1;
    };
    expect(() => step(state, state.knobs, { stages: [badStage] })).toThrow(/SFC/);
  });

  it('las primitivas rechazan operaciones inválidas', () => {
    const state = createInitialState(1, PHASE0_CONFIG);
    const [a, b] = state.households;
    expect(() => transfer('deposits', a!, b!, a!.positions.deposits + 1)).toThrow(); // sin saldo suficiente
    expect(() => issue('deposits', state.bank, a!, 1)).toThrow(); // el banco no tiene depósitos como activo
    expect(() => issue('loans', state.bank, a!, 0)).toThrow(); // monto no positivo
    expect(() => issue('loans', state.bank, a!, 1.5)).toThrow(); // no entero
  });
});
