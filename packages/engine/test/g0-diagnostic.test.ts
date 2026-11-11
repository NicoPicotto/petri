/**
 * Paso 1a.0 de la Fase 1: diagnóstico de la economía con G = 0, con las reglas
 * de la Fase 0. Estos tests DEJAN ASENTADO el comportamiento actual para verlo
 * cambiar: cuando entren el crédito y la inversión, varios tienen que dar vuelta
 * (y se actualizan a conciencia, no en silencio). Detalle en docs/fase1-reglas.md.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { PHASE0_CONFIG, PHASE0_STAGES, PARAMS, createWarmState, firmsPlan, hashState, openMonth, step, type Stage } from '../src/index';
import { G0_KNOBS, instrumentedStages, runG0Diagnostic, summarize, type DiagRun, type MonthDiag } from './helpers/diagnostics';

const SEEDS = [1, 2, 3, 4, 5];
const MONTHS = 600;

describe('instrumentación', () => {
  it('las sondas no cambian la corrida (mismo hash que sin sondas)', () => {
    const config = { ...PHASE0_CONFIG, burnInTicks: 60 };
    let plain = createWarmState(11, config);
    let probed = plain;
    const records: MonthDiag[] = [];
    const stages = instrumentedStages(records);
    for (let t = 0; t < 36; t++) {
      plain = step(plain, G0_KNOBS);
      probed = step(probed, G0_KNOBS, { stages });
    }
    expect(records).toHaveLength(36);
    expect(hashState(probed)).toBe(hashState(plain));
  });
});

describe('G = 0 con las reglas de la Fase 0 (5 semillas, 50 años)', () => {
  let fromCreation: DiagRun[] = [];
  let switched: DiagRun[] = [];

  beforeAll(() => {
    fromCreation = SEEDS.map((seed) => runG0Diagnostic(seed, 'fromCreation', MONTHS));
    switched = SEEDS.map((seed) => runG0Diagnostic(seed, 'switchAfterBurnIn', MONTHS));
  }, 120_000);

  it('con G = 0 desde la creación, el desempleo de los últimos 10 años supera el 50%', () => {
    for (const run of fromCreation) {
      expect(summarize(run, MONTHS - 120, MONTHS).unemployment, `semilla ${run.seed}`).toBeGreaterThan(0.5);
    }
  });

  it('sin emisión el dinero privado queda constante', () => {
    for (const run of [...fromCreation, ...switched]) {
      expect(run.months.every((m) => m.money === run.months[0]!.money), `semilla ${run.seed}`).toBe(true);
    }
  });

  it('desde la creación, las empresas se quedan sin depósitos para pagar un solo salario y la economía se detiene', () => {
    for (const run of fromCreation) {
      const late = summarize(run, MONTHS - 120, MONTHS);
      // Casi total: alguna empresa consigue pagar un salario algún mes suelto.
      expect(late.liquidityConstrainedFirmShare, `semilla ${run.seed}`).toBeGreaterThan(0.99);
      expect(late.unemployment, `semilla ${run.seed}`).toBeGreaterThan(0.99);
    }
  });

  // Mismo umbral que el chequeo de cordura de la Fase 0. Medido el 2026-11-11
  // (20 semillas, sin el colchón de R7): entre 5,6% y 22,6%, media 12,5%.
  it('si se pasa a G = 0 después del calentamiento, la economía no colapsa (desempleo < 50%)', () => {
    for (const run of switched) {
      expect(summarize(run, MONTHS - 120, MONTHS).unemployment, `semilla ${run.seed}`).toBeLessThan(0.5);
    }
  });

  // Corrección de R1 (paso 1a.0): la producción deseada se ajusta sobre la
  // producción efectiva del mes anterior, así que no se despega de lo que la
  // empresa puede hacer. Antes de la corrección llegaba a miles de millones de puestos.
  it('R1 anclada: ninguna empresa desea más de 5% por encima de lo que produjo el mes anterior', () => {
    let state = switched[0]!.end;
    let previous: number[] = [];
    let checked = 0;
    const before: Stage = (s) => {
      previous = s.firms.map((f) => f.lastOutput);
    };
    const after: Stage = (s) => {
      s.firms.forEach((f, i) => {
        const cap = Math.max(PARAMS.laborProductivity, previous[i]! * (1 + PARAMS.quantityStepMax));
        expect(f.plannedOutput, `empresa ${f.id}`).toBeLessThanOrEqual(cap + 1e-9);
        checked += 1;
      });
    };
    const stages = [openMonth, before, firmsPlan, after, ...PHASE0_STAGES.slice(2)];
    for (let t = 0; t < 120; t++) state = step(state, G0_KNOBS, { stages });
    expect(checked).toBe(120 * state.firms.length);
  });

  it('las empresas reparten dividendos (antes de corregir R1, el colchón de R7, hoy eliminado, los bloqueaba)', () => {
    for (const run of switched) {
      const late = run.months.slice(MONTHS - 120);
      expect(late.filter((m) => m.dividends > 0).length, `semilla ${run.seed}`).toBeGreaterThan(100);
    }
  });
});
