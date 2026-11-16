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

import type { AgentId, ContractId, PaymentKind } from './ledger';

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

/**
 * Error de entrada de los montos calculados (decisión de Nico, 2026-11-13; docs/reglas-caiani.md, sec. 1). Un pago o
 * un `double` de montos que el evento **calcula** a partir de entradas en µ (saldos de contratos o campos en µ de un
 * agente) hereda, en el V3 suelto, el error de redondeo de esas entradas. El motor anota de qué entradas depende
 * linealmente y con qué coeficiente (adimensional: valor = Σ coeficiente × entrada + lo que no sale de montos); el
 * arnés calcula ε = Σ coeficiente × δ, lo lleva con signo a cada pata del pago (o lo descuenta del `double`) y
 * compara el resto con la regla estricta de 2 µ. Solo observa, como lo de arriba.
 */
export type InputTerm =
  /** Un contrato: el error de entrada de su saldo, o con `field` el de ese campo (el monto inicial de un préstamo). */
  | { contract: ContractId; coef: number; field?: 'initialAmount' }
  | { agent: AgentId; field: string; coef: number }
  /**
   * Grupo: coeficiente × (Σ coeficiente × entrada del grupo). Es la misma dependencia lineal que expandir el grupo
   * con los coeficientes multiplicados; sirve para no copiar una lista larga en cada pago que la usa (los dividendos
   * de un banco dependen de los ~1.000 contratos de su patrimonio, y los paga a 8.000 hogares; evento 25). El arnés
   * calcula el ε de cada grupo una vez (por identidad del arreglo).
   */
  | { group: readonly InputTerm[]; coef: number };

export interface DerivedPayment {
  from: ContractId;
  to: ContractId;
  terms: InputTerm[];
  /** Tipo de pago del lote (`PaymentKind`; por defecto, de cuenta a cuenta): define sus patas. */
  kind?: PaymentKind;
}

/**
 * Operación de un contrato fuera de un lote (`open`, `credit`, `debit` del ledger) cuyo monto se calcula a partir de
 * entradas en µ (decisión de Nico, 2026-11-16: la regla de los montos calculados vale también fuera de los lotes; el
 * primer caso es el adelanto del evento 37, copia del campo en µ `advancesDemand`). Los términos dan la variación del
 * **contrato** en esa operación (con el signo de la variación: un `debit` lleva los coeficientes cambiados de signo);
 * con `field`, la del monto inicial del contrato que se acaba de abrir.
 */
export interface DerivedContractFlow {
  contract: ContractId;
  terms: InputTerm[];
  field?: 'initialAmount';
  /**
   * La variación (o el monto inicial) en µ como `double`, **antes** del redondeo que hace el evento (la cuota de un
   * reparto por restos mayores, el interés antes del arrastre). Solo para el control de las anotaciones: compara el error
   * de entrada verdadero sin el redondeo de salida. Sin `exact`, el control compara la variación registrada.
   */
  exact?: number;
}

/** Registro de los montos calculados (lo crea el arnés; `withInputs`). */
export class InputRecorder {
  readonly payments: DerivedPayment[] = [];
  /** Operaciones fuera de un lote (`derivedContract`), en el orden en que se registraron. */
  readonly contracts: DerivedContractFlow[] = [];
  /** Valor de un `derivedValue` antes del redondeo del evento (µ, `double`), si el motor lo da: solo para el control. */
  readonly exactValues = new Map<string, number>();
  /** Clave `agente:clave` (p. ej. `lag:18:50`) → términos. */
  readonly values = new Map<string, InputTerm[]>();
}

let inputs: InputRecorder | null = null;

/** Corre `fn` (un evento) anotando las dependencias de los montos calculados en `rec`. */
export function withInputs<T>(rec: InputRecorder, fn: () => T): T {
  const prev = inputs;
  inputs = rec;
  try {
    return fn();
  } finally {
    inputs = prev;
  }
}

/** ¿Hay un registrador activo? Para no armar listas de términos cuando nadie las lee. */
export function inputsActive(): boolean {
  return inputs !== null;
}

/** Términos multiplicados por un coeficiente. */
export function scaleTerms(terms: readonly InputTerm[], k: number): InputTerm[] {
  return terms.map((t) => ({ ...t, coef: t.coef * k }));
}

/** Anota que el pago `from` → `to` (de cuenta a cuenta, o del tipo `kind` del lote) depende de esas entradas. */
export function derivedPayment(from: ContractId, to: ContractId, terms: readonly InputTerm[], kind?: PaymentKind): void {
  if (inputs && terms.length > 0) inputs.payments.push(kind ? { from, to, terms: [...terms], kind } : { from, to, terms: [...terms] });
}

/**
 * Anota que la variación del contrato en la operación que se acaba de registrar fuera de un lote (o, con `field`, su
 * monto inicial) depende de esas entradas (`DerivedContractFlow`).
 */
export function derivedContract(contract: ContractId, terms: readonly InputTerm[], field?: 'initialAmount', exact?: number): void {
  if (!inputs || terms.length === 0) return;
  const f: DerivedContractFlow = { contract, terms: [...terms] };
  if (field) f.field = field;
  if (exact !== undefined) f.exact = exact;
  inputs.contracts.push(f);
}

/** Anota que el valor `key` del agente (un `double` de montos, en unidades) depende de esas entradas. */
export function derivedValue(agent: AgentId, key: string, terms: readonly InputTerm[], exact?: number): void {
  if (inputs && terms.length > 0) {
    inputs.values.set(`${agent}:${key}`, [...terms]);
    if (exact !== undefined) inputs.exactValues.set(`${agent}:${key}`, exact);
  }
}
