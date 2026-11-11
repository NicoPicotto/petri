/**
 * Formato del archivo de corrida: semilla + condiciones iniciales + log, por cápsula.
 * Los montos van en centavos, igual que en el motor.
 */

import {
  KNOB_NAMES,
  applyKnobChange,
  validateKnobLog,
  validateKnobValue,
  type KnobChange,
  type Knobs,
  type SimConfig,
} from '@petri/engine';

export const RUN_FORMAT = 'petri-run';
/**
 * Versión 2: agrega el calentamiento (`config.burnInTicks` y `config.burnInKnobs`).
 * La versión 1 no se puede verificar: desde la 2 el estado incluye la semilla y
 * los meses transcurridos, así que el hash cambió.
 */
export const RUN_VERSION = 2;
export const RUN_PHASE = 0;

export type CapsuleId = 'A' | 'B';

export interface CapsuleRun {
  id: CapsuleId;
  initialKnobs: Knobs;
  log: KnobChange[];
  ticks: number;
  finalStateHash: string;
}

export interface RunConfig extends SimConfig {
  burnInTicks: number;
  burnInKnobs: Knobs;
}

export interface RunFile {
  format: typeof RUN_FORMAT;
  version: typeof RUN_VERSION;
  phase: typeof RUN_PHASE;
  seed: number;
  config: RunConfig;
  capsules: CapsuleRun[];
}

function fail(message: string): never {
  throw new Error(`Archivo de corrida inválido: ${message}`);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function parseKnobs(x: unknown, where: string): Knobs {
  if (!isRecord(x)) fail(`${where}: faltan las perillas`);
  const knobs = {} as Knobs;
  for (const name of KNOB_NAMES) {
    const value = x[name];
    if (typeof value !== 'number') fail(`${where}: falta la perilla ${name}`);
    validateKnobValue(name, value);
    knobs[name] = value;
  }
  return knobs;
}

function parseLog(x: unknown, where: string): KnobChange[] {
  if (!Array.isArray(x)) fail(`${where}: el log tiene que ser una lista`);
  return x.map((e, i) => {
    if (!isRecord(e)) fail(`${where}: entrada ${i} del log inválida`);
    const { tick, knob, from, to } = e;
    if (typeof tick !== 'number' || typeof from !== 'number' || typeof to !== 'number') {
      fail(`${where}: entrada ${i} del log con valores no numéricos`);
    }
    if (typeof knob !== 'string' || !(KNOB_NAMES as readonly string[]).includes(knob)) {
      fail(`${where}: perilla desconocida en la entrada ${i}: ${String(knob)}`);
    }
    return { tick, knob: knob as KnobChange['knob'], from, to };
  });
}

export function parseRunFile(text: string): RunFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail('no es JSON');
  }
  if (!isRecord(raw)) fail('no es un objeto');
  if (raw.format !== RUN_FORMAT) fail(`format tiene que ser "${RUN_FORMAT}"`);
  if (raw.version === 1) {
    fail(
      'es de la versión 1 (sin calentamiento). Desde la versión 2 el estado guarda la semilla y los meses transcurridos, así que el hash de la versión 1 ya no se puede verificar. Volvé a exportar la corrida.',
    );
  }
  if (raw.version !== RUN_VERSION) fail(`versión ${String(raw.version)} no soportada (esta app lee la ${RUN_VERSION})`);
  if (raw.phase !== RUN_PHASE) fail(`la corrida es de la fase ${String(raw.phase)}; esta app es de la fase ${RUN_PHASE}`);
  if (typeof raw.seed !== 'number' || !Number.isInteger(raw.seed)) fail('la semilla tiene que ser un entero');
  const config = raw.config;
  if (!isRecord(config) || typeof config.households !== 'number' || typeof config.firms !== 'number') {
    fail('config inválida');
  }
  const burnInTicks = config.burnInTicks;
  if (typeof burnInTicks !== 'number' || !Number.isInteger(burnInTicks) || burnInTicks < 0) {
    fail('config.burnInTicks tiene que ser un entero no negativo');
  }
  const burnInKnobs = parseKnobs(config.burnInKnobs, 'config.burnInKnobs');
  if (!Array.isArray(raw.capsules) || raw.capsules.length !== 2) fail('tiene que haber dos cápsulas');

  const capsules = raw.capsules.map((c: unknown, i: number): CapsuleRun => {
    const id = (['A', 'B'] as const)[i]!;
    if (!isRecord(c) || c.id !== id) fail(`la cápsula ${i + 1} tiene que tener id "${id}"`);
    const initialKnobs = parseKnobs(c.initialKnobs, `cápsula ${id}`);
    const log = parseLog(c.log, `cápsula ${id}`);
    validateKnobLog(log);
    log.reduce(applyKnobChange, initialKnobs); // valida que cada "from" coincida
    if (typeof c.ticks !== 'number' || !Number.isInteger(c.ticks) || c.ticks < 0) fail(`cápsula ${id}: ticks inválido`);
    if (log.some((e) => e.tick > (c.ticks as number))) fail(`cápsula ${id}: hay cambios posteriores al último tick`);
    if (typeof c.finalStateHash !== 'string') fail(`cápsula ${id}: falta finalStateHash`);
    return { id, initialKnobs, log, ticks: c.ticks, finalStateHash: c.finalStateHash };
  });
  if (capsules[0]!.ticks !== capsules[1]!.ticks) fail('las dos cápsulas tienen que estar en el mismo tick');

  return {
    format: RUN_FORMAT,
    version: RUN_VERSION,
    phase: RUN_PHASE,
    seed: raw.seed,
    config: { households: config.households, firms: config.firms, burnInTicks, burnInKnobs },
    capsules,
  };
}

export function downloadRunFile(run: RunFile): void {
  const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `petri-semilla${run.seed}-mes${run.capsules[0]?.ticks ?? 0}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
