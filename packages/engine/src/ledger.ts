/**
 * Contabilidad stock-flujo consistente (SFC).
 *
 * Referencia: Godley & Lavoie (2007), *Monetary Economics*, cap. 2: matriz de
 * balances donde las filas son instrumentos financieros, las columnas son
 * sectores y cada fila suma cero (todo activo financiero es pasivo de otro).
 *
 * Convención de signos: en `positions`, + = activo, − = pasivo.
 * Los activos reales (capital, inventarios) no entran acá: no tienen contraparte
 * y no forman parte del invariante.
 *
 * El estado financiero solo se modifica con `transfer`, `issue` y `redeem`,
 * que respetan el invariante por construcción. `checkSfc` lo verifica de forma
 * independiente sumando todo desde cero.
 */

import { addCents, assertPositiveCents, isCents, subCents, type Cents } from './money';

export const INSTRUMENTS = [
  'cash', // billetes y monedas: activo de hogares/empresas, pasivo del BCRA
  'deposits', // depósitos: activo de hogares/empresas, pasivo del banco
  'loans', // préstamos: activo del banco, pasivo de hogares/empresas
  'reserves', // reservas bancarias (encajes): activo del banco, pasivo del BCRA
  'treasuryAccount', // cuenta del Tesoro en el BCRA
  'bonds', // títulos del Tesoro en pesos: activo de banco/BCRA
  'advances', // adelantos transitorios del BCRA al Tesoro (financiamiento monetario)
] as const;

export type Instrument = (typeof INSTRUMENTS)[number];

export type SectorKind = 'household' | 'firm' | 'bank' | 'treasury' | 'centralBank';

export type Positions = Record<Instrument, Cents>;

export type AgentId = number;

export interface Agent {
  id: AgentId;
  kind: SectorKind;
  positions: Positions;
}

/** Qué sectores pueden tener cada instrumento como activo (holders) o pasivo (issuers). */
export const INSTRUMENT_RULES: Record<
  Instrument,
  { holders: readonly SectorKind[]; issuers: readonly SectorKind[] }
> = {
  cash: { holders: ['household', 'firm'], issuers: ['centralBank'] },
  deposits: { holders: ['household', 'firm'], issuers: ['bank'] },
  loans: { holders: ['bank'], issuers: ['household', 'firm'] },
  reserves: { holders: ['bank'], issuers: ['centralBank'] },
  treasuryAccount: { holders: ['treasury'], issuers: ['centralBank'] },
  bonds: { holders: ['bank', 'centralBank'], issuers: ['treasury'] },
  advances: { holders: ['centralBank'], issuers: ['treasury'] },
};

export function emptyPositions(): Positions {
  return {
    cash: 0,
    deposits: 0,
    loans: 0,
    reserves: 0,
    treasuryAccount: 0,
    bonds: 0,
    advances: 0,
  };
}

function assertCanHold(instr: Instrument, agent: Agent): void {
  if (!INSTRUMENT_RULES[instr].holders.includes(agent.kind)) {
    throw new Error(`Un agente '${agent.kind}' no puede tener '${instr}' como activo`);
  }
}

function assertCanIssue(instr: Instrument, agent: Agent): void {
  if (!INSTRUMENT_RULES[instr].issuers.includes(agent.kind)) {
    throw new Error(`Un agente '${agent.kind}' no puede emitir '${instr}'`);
  }
}

/**
 * Mueve un activo existente de un tenedor a otro (ej.: pagar con depósitos).
 * El emisor no cambia: el pasivo total del banco es el mismo.
 */
export function transfer(instr: Instrument, from: Agent, to: Agent, amount: Cents): void {
  assertPositiveCents(amount);
  assertCanHold(instr, from);
  assertCanHold(instr, to);
  if (from.positions[instr] < amount) {
    throw new Error(
      `Agente ${from.id} no tiene ${amount} de '${instr}' (tiene ${from.positions[instr]})`,
    );
  }
  from.positions[instr] = subCents(from.positions[instr], amount);
  to.positions[instr] = addCents(to.positions[instr], amount);
}

/** Crea un instrumento: activo para `holder` y pasivo para `issuer`, en el mismo acto. */
export function issue(instr: Instrument, holder: Agent, issuer: Agent, amount: Cents): void {
  assertPositiveCents(amount);
  assertCanHold(instr, holder);
  assertCanIssue(instr, issuer);
  holder.positions[instr] = addCents(holder.positions[instr], amount);
  issuer.positions[instr] = subCents(issuer.positions[instr], amount);
}

/** Cancela un instrumento: el tenedor lo devuelve y el emisor reduce su pasivo. */
export function redeem(instr: Instrument, holder: Agent, issuer: Agent, amount: Cents): void {
  assertPositiveCents(amount);
  assertCanHold(instr, holder);
  assertCanIssue(instr, issuer);
  if (holder.positions[instr] < amount) {
    throw new Error(
      `Agente ${holder.id} no tiene ${amount} de '${instr}' para cancelar (tiene ${holder.positions[instr]})`,
    );
  }
  if (-issuer.positions[instr] < amount) {
    throw new Error(
      `Agente ${issuer.id} no debe ${amount} de '${instr}' (debe ${-issuer.positions[instr]})`,
    );
  }
  holder.positions[instr] = subCents(holder.positions[instr], amount);
  issuer.positions[instr] = addCents(issuer.positions[instr], amount);
}

export type SfcViolation =
  | { type: 'nonzero-row'; instrument: Instrument; sum: Cents }
  | { type: 'forbidden-position'; agentId: AgentId; sector: SectorKind; instrument: Instrument; amount: Cents }
  | { type: 'not-integer'; agentId: AgentId; instrument: Instrument; amount: number };

/**
 * Verifica el invariante SFC sobre un conjunto de agentes. Devuelve todas las
 * violaciones encontradas (lista vacía = todo bien).
 *
 * 1. Cada posición es un entero seguro de centavos.
 * 2. Cada posición tiene un signo permitido para el sector (tabla INSTRUMENT_RULES).
 * 3. Cada instrumento suma exactamente cero entre todos los agentes.
 * De 3 se sigue que el patrimonio financiero neto de toda la economía es cero.
 */
export function checkAgentsSfc(agents: Iterable<Agent>): SfcViolation[] {
  const violations: SfcViolation[] = [];
  const sums = emptyPositions();
  for (const agent of agents) {
    for (const instr of INSTRUMENTS) {
      const amount = agent.positions[instr];
      if (!isCents(amount)) {
        violations.push({ type: 'not-integer', agentId: agent.id, instrument: instr, amount });
        continue;
      }
      const rules = INSTRUMENT_RULES[instr];
      if (
        (amount > 0 && !rules.holders.includes(agent.kind)) ||
        (amount < 0 && !rules.issuers.includes(agent.kind))
      ) {
        violations.push({
          type: 'forbidden-position',
          agentId: agent.id,
          sector: agent.kind,
          instrument: instr,
          amount,
        });
      }
      sums[instr] += amount;
    }
  }
  for (const instr of INSTRUMENTS) {
    if (sums[instr] !== 0) violations.push({ type: 'nonzero-row', instrument: instr, sum: sums[instr] });
  }
  return violations;
}

/** Matriz de balances agregada por sector (filas = instrumentos). Útil para debug y docs. */
export function balanceSheetMatrix(agents: Iterable<Agent>): Record<Instrument, Record<SectorKind, Cents>> {
  const zeroRow = (): Record<SectorKind, Cents> => ({
    household: 0,
    firm: 0,
    bank: 0,
    treasury: 0,
    centralBank: 0,
  });
  const matrix = Object.fromEntries(INSTRUMENTS.map((i) => [i, zeroRow()])) as Record<
    Instrument,
    Record<SectorKind, Cents>
  >;
  for (const agent of agents) {
    for (const instr of INSTRUMENTS) {
      matrix[instr][agent.kind] = addCents(matrix[instr][agent.kind], agent.positions[instr]);
    }
  }
  return matrix;
}
