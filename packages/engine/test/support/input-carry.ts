/**
 * Error de entrada que llevan los traspasos de saldos enteros en el V3 del evento suelto (decisión de Nico,
 * 2026-11-13; docs/reglas-caiani.md, sec. 1, "Tolerancias").
 *
 * El evento suelto arranca de un estado reconstruido desde el volcado de JMAB, con cada saldo redondeado a µ
 * (error de entrada δ = saldo del port − saldo de JMAB, |δ| ≤ 0,5 µ). Cuando el port mueve el **saldo entero** de
 * un contrato (el segundo depósito que pasa al primero, la última cuota que paga el saldo del préstamo), mueve un
 * entero y JMAB mueve su `double`: la diferencia δ viaja por todas las patas del pago. Una cuenta que recibe
 * muchos de esos traspasos (las reservas de un banco) acumula los δ y puede pasar los 2 µ sin que el port tenga
 * ningún error. Este módulo calcula, por contrato, la suma de los δ que le llegaron más el δ de su propio saldo
 * inicial, y `compareState` la descuenta y compara contra el valor de JMAB en `double` (sin pasarlo a µ; opción
 * `carry`; decisión de Nico, 2026-11-13): queda solo el error propio del evento, con la regla de 2 µ.
 *
 * Qué cuenta como traspaso de saldo entero (genérico, sobre el registro de flujos del evento): un registro que
 * deja en 0 un contrato que movió exactamente su saldo al empezar el evento (variación = −monto = −saldo inicial).
 * El δ de ese contrato se suma, con el signo de cada pata, a todos los contratos del registro y, si el registro es
 * la baja de un préstamo (un solo contrato), también a los del registro anterior con el mismo monto (el pago al
 * prestamista de la misma cuota, `paymentRecords`, tipo `repay`).
 */

import { paymentLegs, type CaianiState, type FlowRecord, type InputRecorder, type InputTerm } from '../../src/caiani';
import { INPUT_FIELDS, INPUT_VALUES } from './jmab-dump';

export class InputCarry {
  private readonly carried = new Map<number, number>();
  private readonly start = new Map<number, number>();

  /** Toma los saldos al empezar el evento (llamar antes de correrlo, sobre un estado de `stateFromDump`). */
  constructor(private readonly s: CaianiState) {
    if (!INPUT_VALUES.has(s)) throw new Error('InputCarry: el estado no viene de stateFromDump');
    for (const key in s.ledger.contracts) {
      const c = s.ledger.contracts[key]!;
      this.start.set(c.id, c.amount);
    }
  }

  /** Recorre el registro de flujos del evento (llamar después de correrlo). */
  fromLog(log: readonly FlowRecord[]): this {
    const input = INPUT_VALUES.get(this.s)!;
    const apply = (r: FlowRecord, delta: number) => {
      r.contracts.forEach((id, j) => {
        const sign = Math.sign(r.deltas[j]!);
        this.carried.set(id, (this.carried.get(id) ?? 0) + sign * delta);
      });
    };
    log.forEach((r, k) => {
      r.contracts.forEach((id, j) => {
        if (r.amount === 0 || r.deltas[j] !== -r.amount || this.start.get(id) !== r.amount) return;
        const jmab = input.get(id);
        if (jmab === undefined) return; // abierto durante el evento: no viene del volcado
        const delta = r.amount - jmab;
        if (delta === 0) return;
        apply(r, delta);
        const prev = log[k - 1];
        if (r.contracts.length === 1 && this.s.ledger.contracts[id]?.kind === 'loan' && prev && prev.amount === r.amount) apply(prev, delta);
      });
    });
    return this;
  }

  /** ε de los grupos ya calculados (por identidad del arreglo; `InputTerm` de grupo, derived.ts). */
  private readonly groups = new WeakMap<readonly InputTerm[], number>();

  /** Error de entrada (µ) de una entrada anotada: el redondeo del saldo inicial del contrato o del campo en µ. */
  private termDelta(t: InputTerm): number {
    if ('group' in t) {
      let e = this.groups.get(t.group);
      if (e === undefined) {
        e = this.epsilon(t.group);
        this.groups.set(t.group, e);
      }
      return e;
    }
    if ('contract' in t) {
      const input = INPUT_VALUES.get(this.s)!.get(t.contract);
      const start = this.start.get(t.contract);
      return input === undefined || start === undefined ? 0 : start - input;
    }
    const d = INPUT_FIELDS.get(this.s)?.get(`${t.agent}:${t.field}`);
    if (d === undefined) throw new Error(`InputCarry: sin error de entrada para ${t.agent}:${t.field}`);
    return d;
  }

  /** ε (µ) de una lista de términos: Σ coeficiente × δ. */
  private epsilon(terms: readonly InputTerm[]): number {
    let e = 0;
    for (const t of terms) e += t.coef * this.termDelta(t);
    return e;
  }

  /**
   * Montos calculados (decisión de Nico, 2026-11-13): por cada pago anotado por el motor, ε = Σ coeficiente × δ de sus
   * entradas, llevado con signo a cada pata del pago (las de `paymentLegs`: la cuenta que paga, la que cobra y la
   * liquidación entre bancos). Llamar después de correr el evento.
   */
  fromInputs(rec: InputRecorder): this {
    for (const p of rec.payments) {
      const eps = this.epsilon(p.terms);
      if (eps === 0) continue;
      for (const [id, d] of paymentLegs(this.s.ledger, p.from, p.to, 1)) {
        this.carried.set(id, (this.carried.get(id) ?? 0) + Math.sign(d) * eps);
      }
    }
    this.values = rec;
    return this;
  }

  private values: InputRecorder | undefined;

  /** Error de entrada (en unidades) de un `double` de montos anotado (`derivedValue`), o `undefined`. */
  readonly valueCarry = (agent: number, key: string): number | undefined => {
    const terms = this.values?.values.get(`${agent}:${key}`);
    return terms ? this.epsilon(terms) / 1e6 : undefined;
  };

  /** Cuántos contratos llevan error de entrada y el máximo |δ| acumulado (para el informe del test). */
  summary(): { contracts: number; max: number } {
    let max = 0;
    let n = 0;
    for (const v of this.carried.values()) {
      if (v === 0) continue;
      n++;
      max = Math.max(max, Math.abs(v));
    }
    return { contracts: n, max };
  }

  /**
   * Error de entrada del contrato (µ; port − JMAB): el redondeo de su saldo inicial (si viene del volcado) más los δ
   * que le llegaron por traspasos de saldos enteros.
   */
  readonly carry = (contract: number): number => {
    const input = INPUT_VALUES.get(this.s)!.get(contract);
    const start = this.start.get(contract);
    const own = input === undefined || start === undefined ? 0 : start - input;
    return own + (this.carried.get(contract) ?? 0);
  };
}
