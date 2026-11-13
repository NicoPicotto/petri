/**
 * Invariantes de flujos del ledger del port de Caiani (docs/ledger-contratos.md, sec. 2.5).
 * Es el equivalente de `TFMComputer` de JMAB, pero como chequeo.
 *
 * Uso: `const cp = beginPeriod(ledger)` al principio del tick (borra el registro de flujos) y
 * `checkFlows(ledger, cp)` al final. Se corre en cada tick en los tests y en modo debug.
 *
 * 1. Filas: cada categoría de la matriz de transacciones suma cero entre sectores. Cada registro
 *    tiene pagador y cobrador por el mismo monto, así que en el ledger se cumple por construcción;
 *    el chequeo importa cuando entran los flujos de bienes reales (P3), que se registran aparte.
 * 2. Stocks contra flujos: para cada tipo de contrato y cada par de sectores (tenedor, emisor),
 *    saldo al final − saldo al principio = variación registrada por las operaciones. Atrapa
 *    cualquier cambio de saldo que no haya pasado por una operación.
 * 3. Columnas: para cada agente, variación del patrimonio financiero = flujos corrientes cobrados −
 *    flujos corrientes pagados. Atrapa operaciones mal clasificadas o con patas que no cierran. Es el patrimonio
 *    económico (`netFinancialWorths`: un contrato fuera de la lista de su emisor sigue siendo su pasivo).
 */

import {
  FLOW_CATEGORIES,
  MOVEMENT_CELLS,
  SECTORS,
  agentOf,
  movementIndex,
  netFinancialWorths,
  type FlowCategory,
  type FlowRecord,
  type Ledger,
} from './ledger';
import type { Micro } from './money';

export interface Checkpoint {
  /** Patrimonio financiero de cada agente al principio del período. */
  netWorth: Micro[];
  /** Saldos agregados por celda (tipo, sector tenedor, sector emisor). */
  stocks: Micro[];
}

export function stockCells(ledger: Ledger): Micro[] {
  const cells = new Array<number>(MOVEMENT_CELLS).fill(0);
  for (const key in ledger.contracts) {
    const c = ledger.contracts[key]!;
    const cell = movementIndex(c.kind, agentOf(ledger, c.holder).sector, agentOf(ledger, c.issuer).sector);
    cells[cell] = (cells[cell] as number) + c.amount;
  }
  return cells;
}

/** Abre un período de chequeo: guarda los saldos y borra el registro de flujos y movimientos. */
export function beginPeriod(ledger: Ledger): Checkpoint {
  ledger.flowLog = [];
  ledger.movements = new Array<number>(MOVEMENT_CELLS).fill(0);
  return {
    netWorth: netFinancialWorths(ledger),
    stocks: stockCells(ledger),
  };
}

export function isCurrent(category: FlowCategory): boolean {
  return FLOW_CATEGORIES[category] === 'current';
}

/**
 * Matriz de transacciones del período por sector: para cada categoría, lo cobrado menos lo pagado
 * por cada sector (en el orden de SECTORS). Incluye los flujos entre agentes del mismo sector, que
 * se cancelan dentro de la celda.
 */
export function transactionsMatrix(log: readonly FlowRecord[], ledger: Ledger): Record<FlowCategory, Micro[]> {
  const m = {} as Record<FlowCategory, Micro[]>;
  for (const cat of Object.keys(FLOW_CATEGORIES) as FlowCategory[]) m[cat] = SECTORS.map(() => 0);
  for (const r of log) {
    const row = m[r.category];
    const p = SECTORS.indexOf(agentOf(ledger, r.payer).sector);
    const q = SECTORS.indexOf(agentOf(ledger, r.payee).sector);
    row[p] = (row[p] as number) - r.amount;
    row[q] = (row[q] as number) + r.amount;
  }
  return m;
}

/** Corre las tres invariantes. Devuelve la lista de problemas (vacía si está bien). */
export function checkFlows(ledger: Ledger, cp: Checkpoint): string[] {
  const errors: string[] = [];

  // 1. Filas.
  const tm = transactionsMatrix(ledger.flowLog, ledger);
  for (const cat of Object.keys(tm) as FlowCategory[]) {
    const sum = tm[cat].reduce((s, x) => s + x, 0);
    if (sum !== 0) errors.push(`fila ${cat}: suma ${sum} µ`);
  }

  // 2. Stocks contra flujos.
  const now = stockCells(ledger);
  for (let k = 0; k < MOVEMENT_CELLS; k++) {
    const delta = (now[k] as number) - (cp.stocks[k] as number);
    if (delta !== ledger.movements[k]) {
      const kind = Math.floor(k / (SECTORS.length * SECTORS.length));
      errors.push(`stock (celda ${k}, tipo ${kind}): variación ${delta} µ, flujos registrados ${ledger.movements[k]} µ`);
    }
  }

  // 3. Columnas.
  const expected = ledger.agents.map(() => 0);
  for (const r of ledger.flowLog) {
    if (!isCurrent(r.category)) continue;
    expected[r.payer] = (expected[r.payer] as number) - r.amount;
    expected[r.payee] = (expected[r.payee] as number) + r.amount;
  }
  const nw = netFinancialWorths(ledger);
  for (const a of ledger.agents) {
    const before = cp.netWorth[a.id] ?? 0; // agentes creados durante el período arrancan en 0
    const delta = (nw[a.id] as number) - before;
    if (delta !== expected[a.id]) {
      errors.push(`agente ${a.id} (${a.sector}): Δ patrimonio ${delta} µ, flujos corrientes netos ${expected[a.id]} µ`);
    }
  }
  return errors;
}

export function assertFlows(ledger: Ledger, cp: Checkpoint): void {
  const errors = checkFlows(ledger, cp);
  if (errors.length > 0) throw new Error(`invariantes de flujos:\n${errors.slice(0, 20).join('\n')}`);
}
