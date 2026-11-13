/**
 * Registro de agregados derivados (regla aprobada por Nico, 2026-11-13; docs/reglas-caiani.md, sec. 1,
 * "Agregados derivados").
 *
 * Un monto que no es un contrato y que un evento calcula sumando montos redondeados (la morosidad de un banco,
 * por ejemplo) se verifica en el V3 suelto con tolerancia max(2 µ, k µ + e): k es la cantidad de redondeos que
 * entraron en la suma (cada uno verificado a < 1 µ en su componente) y e, el error de entrada de los contratos
 * de los que sale (`InputCarry` del arnés). El motor anota cada término donde suma al agregado; el arnés lee las
 * anotaciones. **Solo observa:** sin un registrador activo, las funciones no hacen nada, y nunca cambian el estado
 * ni el resultado (como `decisions.ts`). No forma parte del estado de la simulación ni afecta el determinismo.
 */

import type { AgentId, ContractId } from './ledger';

/** Términos anotados de un agregado: redondeos y contratos cuyo saldo de entrada entra en la suma. */
export interface DerivedTerms {
  rounded: number;
  contracts: ContractId[];
}

export class DerivedRecorder {
  /** Clave `agente:campo` → términos. */
  readonly terms = new Map<string, DerivedTerms>();

  of(agent: AgentId, field: string): DerivedTerms | undefined {
    return this.terms.get(`${agent}:${field}`);
  }

  entry(agent: AgentId, field: string): DerivedTerms {
    const key = `${agent}:${field}`;
    let t = this.terms.get(key);
    if (!t) {
      t = { rounded: 0, contracts: [] };
      this.terms.set(key, t);
    }
    return t;
  }
}

let active: DerivedRecorder | null = null;

/** Corre `fn` (un evento) anotando los agregados derivados en `rec`. */
export function withDerived<T>(rec: DerivedRecorder, fn: () => T): T {
  const prev = active;
  active = rec;
  try {
    return fn();
  } finally {
    active = prev;
  }
}

/** Anota `n` redondeos (cada uno a < 1 µ) que entran en el agregado `field` del agente. */
export function derivedRounded(agent: AgentId, field: string, n = 1): void {
  if (active && n > 0) active.entry(agent, field).rounded += n;
}

/** Anota que el saldo de entrada del contrato entra en el agregado (su error de entrada, |δ|). */
export function derivedInput(agent: AgentId, field: string, contract: ContractId): void {
  if (active) active.entry(agent, field).contracts.push(contract);
}
