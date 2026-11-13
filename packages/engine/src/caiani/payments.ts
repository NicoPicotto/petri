/**
 * Pagos de un evento en dos fases (decisión de Nico, 2026-11-13; docs/reglas-caiani.md, sec. 1,
 * "Reservas: redondeo controlado por evento").
 *
 * 1. **Fase en `double`.** El evento corre como en JMAB: cada pago entre cuentas se anota como pendiente,
 *    con su monto en µ como `double` (`PaymentBatch.pay`). Las decisiones que dependen de saldos dentro del
 *    evento usan el saldo en µ más los pendientes (`PaymentBatch.balance`), como JMAB usa sus `double`.
 * 2. **Redondeo conjunto al cerrar el evento** (`PaymentBatch.settle`): se buscan montos enteros mᵢ con
 *    |mᵢ − xᵢ| < 1 tales que, para cada cuenta que paga, cada cuenta que cobra, cada banco de las que pagan
 *    y cada banco de las que cobran, la suma de los mᵢ quede a < 1 µ de la suma de los xᵢ
 *    (`controlledRound`). Existe siempre: "cuenta ⊂ banco" del lado que paga y del lado que cobra son dos
 *    familias laminares, y la matriz de incidencia de la unión de dos familias laminares es totalmente
 *    unimodular (redondeo controlado de una tabla de doble entrada: Bacharach, 1966; Cox y Ernst, 1982).
 *    Se calcula como un flujo entero factible con cotas piso y techo en la red
 *    fuente → bancos que pagan → cuentas que pagan → pagos → cuentas que cobran → bancos que cobran → sumidero.
 * 3. **Registro** de los montos enteros en el ledger, en el orden de los pagos (`applyPayments`, atómico).
 *
 * Qué garantiza: cada cuenta queda a < 1 µ de lo que pagó o cobró en `double` en el evento; una cuenta que
 * cobra y paga en el lote, a < 1 µ en lo cobrado y en el neto (lo pagado solo, a < 2 µ); las reservas de un
 * banco cambian en (lo que cobraron sus clientes) − (lo que pagaron), con los pagos dentro del mismo banco
 * cancelados, así que quedan a < 2 µ. La cuenta del gobierno es una cuenta más, con el BC como "banco". Un
 * monto que ya es entero queda exacto. **Techo sobre el neto** (decisión de Nico, 2026-11-13): ninguna cuenta
 * que no sea de reservas paga en neto más que su saldo al empezar el lote, así que si su saldo final en
 * `double` es ≥ 0, el redondeado también, y si es 0 exacto, queda en 0 exacto.
 *
 * Determinismo: el flujo se calcula con Dinic, recorriendo las aristas en orden de inserción (el de los
 * pagos), sin azar ni `Map` iterados por claves no enteras. Solo las cuatro operaciones, `floor` y `ceil`.
 */

import { applyPayments, contractOf, paymentRecords, type ContractId, type FlowCategory, type IntegerPayment, type Ledger, type PaymentKind } from './ledger';
import type { Micro } from './money';

export interface PendingPayment {
  from: ContractId;
  to: ContractId;
  /** Monto en µ, como `double` (sin redondear). */
  amount: number;
  category: FlowCategory;
  /** `account` (de cuenta a cuenta), o un pago a un préstamo (`to` es el préstamo): ver `PaymentKind`. */
  kind: PaymentKind;
}

export interface SettleReport {
  payments: number;
  /** Se usaron las cotas relajadas (ver `controlledRound`). */
  relaxed: boolean;
  /** Máximo |mᵢ − xᵢ| (< 1 por construcción). */
  maxPaymentDiff: number;
  /** Máximo |Σmᵢ − Σxᵢ| sobre las cuatro familias (< 1 con las cotas estrictas). */
  maxGroupDiff: number;
}

/** Lote de pagos pendientes de un evento. Se crea al empezar el evento y se cierra con `settle`. */
export class PaymentBatch {
  readonly pending: PendingPayment[] = [];
  /** Variación pendiente de cada contrato tocado (en µ, `double`), incluidas las reservas de liquidación. */
  private readonly net = new Map<ContractId, number>();
  private settled = false;

  constructor(readonly ledger: Ledger) {}

  /**
   * Anota un pago de cuenta a cuenta (como `pay` del ledger: depósitos, efectivo o reservas, con la
   * liquidación entre bancos que corresponda). `amount` en µ, `double` finito ≥ 0; un 0 no se anota.
   */
  pay(from: ContractId, to: ContractId, amount: number, category: FlowCategory): void {
    this.add('account', from, to, amount, category);
  }

  /**
   * Anota un pago a un préstamo desde la cuenta `from` (`ledger.paymentRecords`): `interest` (al prestamista,
   * el préstamo no cambia), `repay` (capital: el préstamo baja; categoría `loans`) o `bailout` (aporte de los
   * dueños: el hogar paga y el préstamo de la empresa baja; categoría `ownersBailout`). Con un bono, `interest` y
   * `repay` van con las categorías `bondInterest` y `bonds` (evento 22); con un adelanto del BC, `advanceInterest` y
   * `advances` (evento 23).
   */
  payLoan(kind: Exclude<PaymentKind, 'account' | 'bailoutRefund'>, from: ContractId, loan: ContractId, amount: number): number {
    const k = contractOf(this.ledger, loan).kind;
    const category: FlowCategory =
      kind === 'interest'
        ? k === 'bond' ? 'bondInterest' : k === 'advance' ? 'advanceInterest' : 'loanInterest'
        : kind === 'repay'
          ? k === 'bond' ? 'bonds' : k === 'advance' ? 'advances' : 'loans'
          : 'ownersBailout';
    return this.add(kind, from, loan, amount, category);
  }

  /**
   * Anota un aporte de los dueños negativo (`bailoutRefund`): el préstamo sube y el depósito del hogar cobra
   * (con las reservas del prestamista al banco del hogar). Categoría `ownersBailout`. Devuelve el índice.
   */
  refundBailout(loan: ContractId, deposit: ContractId, amount: number): number {
    return this.add('bailoutRefund', loan, deposit, amount, 'ownersBailout');
  }

  /** Monto entero con que se registró el pago `index` (el que devuelve `payLoan`), después de `settle`. */
  settledAmount(index: number): Micro {
    if (!this.settled || !this.rounded) throw new Error('PaymentBatch: el lote no se cerró');
    if (index < 0) return 0;
    return this.rounded[index] as Micro;
  }

  private rounded: number[] | undefined;

  /** Anota el pago y devuelve su índice en `pending` (−1 si el monto es 0 y no se anota). */
  private add(kind: PaymentKind, from: ContractId, to: ContractId, amount: number, category: FlowCategory): number {
    if (this.settled) throw new Error('PaymentBatch: el lote ya se cerró');
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`PaymentBatch.pay: monto inválido ${amount}`);
    if (amount === 0) return -1;
    for (const r of paymentRecords(this.ledger, kind, from, to, amount, category)) {
      for (const [id, d] of r.legs) this.net.set(id, (this.net.get(id) ?? 0) + d);
    }
    this.pending.push({ from, to, amount, category, kind });
    return this.pending.length - 1;
  }

  /** Saldo del contrato en µ (`double`): el del ledger más los pagos pendientes del lote. */
  balance(contract: ContractId): number {
    return contractOf(this.ledger, contract).amount + (this.net.get(contract) ?? 0);
  }

  /** Redondeo controlado de los pendientes y registro en el ledger (atómico). Cierra el lote. */
  settle(): SettleReport {
    if (this.settled) throw new Error('PaymentBatch: el lote ya se cerró');
    this.settled = true;
    const n = this.pending.length;
    if (n === 0) {
      this.rounded = [];
      return { payments: 0, relaxed: false, maxPaymentDiff: 0, maxGroupDiff: 0 };
    }
    const L = this.ledger;
    const x = this.pending.map((p) => p.amount);
    const fromAcc = this.pending.map((p) => p.from);
    // Grupo de la "cuenta que cobra": la cuenta, o el préstamo para el capital (`repay`, `bailout`: la suma de lo
    // que baja cada préstamo queda a < 1 µ); el interés y el sobrepago de un préstamo son un grupo aparte (clave
    // −(id + 1); nunca van juntos: el sobrepago es de una empresa que quebró y no paga intereses), así el techo
    // del préstamo (abajo) no los incluye.
    const toAcc = this.pending.map((p) => (p.kind === 'interest' || p.kind === 'bailoutExcess' ? -(p.to + 1) : p.to));
    // Banco que paga: el emisor de la cuenta que paga, o el prestamista en la devolución de un aporte (el préstamo
    // "paga": las reservas salen del prestamista).
    const fromBank = this.pending.map((p) => (p.kind === 'bailoutRefund' ? contractOf(L, p.from).holder : contractOf(L, p.from).issuer));
    // Banco que cobra: el emisor de la cuenta que cobra, o el prestamista (el que recibe las reservas).
    const toBank = this.pending.map((p) =>
      p.kind === 'account' || p.kind === 'bailoutRefund' ? contractOf(L, p.to).issuer : contractOf(L, p.to).holder,
    );
    // Techo de lo que paga en neto (pagado − cobrado) cada cuenta que no es de reservas (las reservas pueden
    // quedar negativas): su saldo al empezar el lote. Para una cuenta que solo paga es el techo de lo pagado.
    // Un préstamo que "paga" (la devolución de un aporte) sube: no tiene techo de ese lado.
    const payerCap = (acc: number): number | undefined => {
      const c = contractOf(L, acc);
      return c.kind === 'reserves' || c.kind === 'loan' ? undefined : c.amount;
    };
    // Techo de los préstamos que bajan: su saldo (un préstamo no puede quedar negativo). Si además sube en el lote
    // (devolución de un aporte), el techo es de lo que baja en neto (`controlledRound`).
    const loanGroups = new Set<number>();
    this.pending.forEach((p) => {
      if (p.kind === 'repay' || p.kind === 'bailout') loanGroups.add(p.to);
    });
    const receiverCap = (acc: number): number | undefined => (loanGroups.has(acc) ? contractOf(L, acc).amount : undefined);
    const r = controlledRound(x, { fromBank, fromAcc, toAcc, toBank }, payerCap, receiverCap);
    const payments: IntegerPayment[] = this.pending.map((p, i) => ({
      from: p.from,
      to: p.to,
      amount: r.m[i] as Micro,
      category: p.category,
      kind: p.kind,
    }));
    applyPayments(L, payments);
    this.rounded = r.m;
    return { payments: n, relaxed: r.relaxed, maxPaymentDiff: r.maxPaymentDiff, maxGroupDiff: r.maxGroupDiff };
  }
}

// ---------------------------------------------------------------------------------------------
// Redondeo controlado
// ---------------------------------------------------------------------------------------------

export interface PaymentGroups {
  /** Por pago: banco (emisor) de la cuenta que paga, cuenta que paga, cuenta que cobra, banco de la que cobra. */
  fromBank: readonly number[];
  fromAcc: readonly number[];
  toAcc: readonly number[];
  toBank: readonly number[];
}

export interface ControlledRounding {
  m: number[];
  relaxed: boolean;
  maxPaymentDiff: number;
  maxGroupDiff: number;
}

/**
 * Tolerancia de las cotas relajadas, en µ. Las sumas de los xᵢ se calculan en `double`: si la suma exacta
 * está pegada a un entero, el error de la suma en `double` (del orden de 10⁻⁶ µ para sumas de 10¹⁰ µ) puede
 * dejarla del otro lado y volver infactibles las cotas estrictas. En ese caso (rarísimo) se reintenta con
 * [⌊s − ε⌋, ⌈s + ε⌉]; la garantía de esa familia pasa a ser ≤ 1 µ (en vez de < 1). Se informa en `relaxed`.
 */
export const RELAXED_EPSILON = 1e-3;

/**
 * Redondeo controlado de los montos `x` (en µ, `double` ≥ 0): enteros mᵢ ∈ {⌊xᵢ⌋, ⌈xᵢ⌉} tales que la suma
 * de cada grupo de cada familia (cuenta que paga ⊂ banco de la que paga; cuenta que cobra ⊂ banco de la que
 * cobra) quede en {⌊s⌋, ⌈s⌉}, con s la suma en `double` de sus xᵢ (en el orden de los pagos). `cap(cuenta)`
 * agrega un techo entero a lo que paga en neto una cuenta (su saldo), y `receiverCap(cuenta)`, a lo que cobra
 * en neto una cuenta (el saldo de un préstamo que baja; si además "paga", lo que baja en neto).
 *
 * **Cuentas que cobran y pagan** (la misma clave en `fromAcc` y en `toAcc`, en el mismo banco): en vez de lo
 * pagado P, se acota el neto P − R en {⌊p − r⌋, ⌈p − r⌉} (con el techo `cap`) y lo cobrado R en {⌊r⌋, ⌈r⌉};
 * los bancos de esas cuentas, sin lo que ellas cobran (P_banco − ΣR, R_banco − ΣR, cada uno a < 1 µ de su
 * `double`: las reservas, que cambian en la diferencia, a < 2 µ). Sigue siendo una red de flujo: hay solución
 * entera si la hay fraccionaria (Hoffman), y los xᵢ lo son si ninguna cuenta paga en neto más que su techo.
 *
 * Tira un error si los grupos no son laminares (una cuenta con dos bancos) o si no hay solución ni con las
 * cotas relajadas (no debería pasar salvo por un techo que la suma en `double` ya supera: un sobregiro real).
 */
export function controlledRound(
  x: readonly number[],
  g: PaymentGroups,
  cap: (account: number) => number | undefined = () => undefined,
  receiverCap: (account: number) => number | undefined = () => undefined,
): ControlledRounding {
  const n = x.length;
  for (const v of x) if (!Number.isFinite(v) || v < 0) throw new Error(`controlledRound: monto inválido ${v}`);
  // Grupos: índice denso por familia, en orden de primera aparición (determinista).
  const fam = (keys: readonly number[]) => {
    const index = new Map<number, number>();
    const key: number[] = [];
    const of = keys.map((k) => {
      let i = index.get(k);
      if (i === undefined) {
        i = key.length;
        index.set(k, i);
        key.push(k);
      }
      return i;
    });
    return { of, key };
  };
  const PB = fam(g.fromBank);
  const PA = fam(g.fromAcc);
  const QA = fam(g.toAcc);
  const QB = fam(g.toBank);
  // Laminaridad: cada cuenta en un solo banco.
  const bankOfPA = new Array<number>(PA.key.length).fill(-1);
  const bankOfQA = new Array<number>(QA.key.length).fill(-1);
  for (let i = 0; i < n; i++) {
    const a = PA.of[i] as number;
    const b = QA.of[i] as number;
    if ((bankOfPA[a] as number) >= 0 && bankOfPA[a] !== PB.of[i]) throw new Error(`controlledRound: la cuenta ${PA.key[a]} paga desde dos bancos`);
    if ((bankOfQA[b] as number) >= 0 && bankOfQA[b] !== QB.of[i]) throw new Error(`controlledRound: la cuenta ${QA.key[b]} cobra en dos bancos`);
    bankOfPA[a] = PB.of[i] as number;
    bankOfQA[b] = QB.of[i] as number;
  }
  const sums = (of: readonly number[], size: number) => {
    const s = new Array<number>(size).fill(0);
    for (let i = 0; i < n; i++) s[of[i] as number] = (s[of[i] as number] as number) + (x[i] as number);
    return s;
  };
  const sPB = sums(PB.of, PB.key.length);
  const sPA = sums(PA.of, PA.key.length);
  const sQA = sums(QA.of, QA.key.length);
  const sQB = sums(QB.of, QB.key.length);

  // Cuentas que cobran y pagan en el lote ("mixtas"): la arista banco → cuenta del lado que paga lleva el neto
  // pagado (P − R), con el techo de la cuenta (`cap`), y lo cobrado (R) va por una arista cuenta que cobra →
  // cuenta que paga, en vez de ir al banco que cobra. Las aristas de los bancos llevan entonces las sumas sin lo
  // cobrado por sus cuentas mixtas (P_banco − ΣR y R_banco − ΣR): la variación de las reservas, que es la
  // diferencia, no cambia (decisión de Nico, 2026-11-13; reglas-caiani.md, sec. 1, "Techo sobre el neto").
  const qaOfKey = new Map<number, number>();
  QA.key.forEach((k, j) => qaOfKey.set(k, j));
  /** Por cuenta que paga: índice de la misma cuenta del lado que cobra, o −1. */
  const mixedQA = PA.key.map((k) => qaOfKey.get(k) ?? -1);
  const isMixedQA = new Array<boolean>(QA.key.length).fill(false);
  const tPB = [...sPB];
  const tQB = [...sQB];
  /** Neto pagado (en double) de cada cuenta que paga: p − r si es mixta, p si no. */
  const tPA = [...sPA];
  mixedQA.forEach((j, k) => {
    if (j < 0) return;
    const b = bankOfPA[k] as number;
    if (PB.key[b] !== QB.key[bankOfQA[j] as number]) {
      throw new Error(`controlledRound: la cuenta ${PA.key[k]} paga desde el banco ${PB.key[b]} y cobra en el ${QB.key[bankOfQA[j] as number]}`);
    }
    isMixedQA[j] = true;
    const r = sQA[j] as number;
    tPA[k] = (sPA[k] as number) - r;
    tPB[b] = (tPB[b] as number) - r;
    tQB[bankOfQA[j] as number] = (tQB[bankOfQA[j] as number] as number) - r;
  });

  const attempt = (eps: number): number[] | null => {
    const lo = (s: number) => Math.floor(s - eps);
    const hi = (s: number) => Math.ceil(s + eps);
    // Nodos: 0 = fuente, 1 = sumidero, después PB, PA, QA, QB.
    const oPB = 2;
    const oPA = oPB + PB.key.length;
    const oQA = oPA + PA.key.length;
    const oQB = oQA + QA.key.length;
    const nodes = oQB + QB.key.length;
    const net = new LowerBoundNetwork(nodes);
    tPB.forEach((s, k) => net.edge(0, oPB + k, lo(s), hi(s)));
    tPA.forEach((s, k) => {
      const c = cap(PA.key[k] as number);
      // Cuenta mixta con techo del lado que cobra (un préstamo que baja con aportes y sube con devoluciones): lo
      // que baja en neto (R − P) no supera su saldo, o sea P − R ≥ −techo.
      const rc = (mixedQA[k] as number) >= 0 ? receiverCap(PA.key[k] as number) : undefined;
      net.edge(oPB + (bankOfPA[k] as number), oPA + k, rc === undefined ? lo(s) : Math.max(lo(s), -rc), c === undefined ? hi(s) : Math.min(hi(s), c));
    });
    const payEdges = x.map((v, i) => net.edge(oPA + (PA.of[i] as number), oQA + (QA.of[i] as number), Math.floor(v), Math.ceil(v)));
    mixedQA.forEach((j, k) => {
      if (j >= 0) net.edge(oQA + j, oPA + k, lo(sQA[j] as number), hi(sQA[j] as number));
    });
    sQA.forEach((s, k) => {
      if (isMixedQA[k]) return;
      const c = receiverCap(QA.key[k] as number);
      net.edge(oQA + k, oQB + (bankOfQA[k] as number), lo(s), c === undefined ? hi(s) : Math.min(hi(s), c));
    });
    tQB.forEach((s, k) => net.edge(oQB + k, 1, lo(s), hi(s)));
    net.edge(1, 0, 0, INF);
    if (!net.feasible()) return null;
    return payEdges.map((e) => net.flowOn(e));
  };

  let relaxed = false;
  let m = attempt(0);
  if (m === null) {
    relaxed = true;
    m = attempt(RELAXED_EPSILON);
  }
  if (m === null) throw new Error('controlledRound: no hay redondeo factible (¿una cuenta paga más que su saldo?)');
  let maxPaymentDiff = 0;
  m.forEach((v, i) => (maxPaymentDiff = Math.max(maxPaymentDiff, Math.abs(v - (x[i] as number)))));
  // Diferencia de cada arista de grupo (las que acota la red): bancos sin lo cobrado por sus cuentas mixtas, neto
  // pagado de las cuentas que pagan, lo cobrado por cada cuenta que cobra.
  let maxGroupDiff = 0;
  const groupTotals = (of: readonly number[], size: number) => {
    const t = new Array<number>(size).fill(0);
    for (let i = 0; i < n; i++) t[of[i] as number] = (t[of[i] as number] as number) + (m![i] as number);
    return t;
  };
  const mPB = groupTotals(PB.of, PB.key.length);
  const mPA = groupTotals(PA.of, PA.key.length);
  const mQA = groupTotals(QA.of, QA.key.length);
  const mQB = groupTotals(QB.of, QB.key.length);
  mixedQA.forEach((j, k) => {
    if (j < 0) return;
    const r = mQA[j] as number;
    mPA[k] = (mPA[k] as number) - r;
    mPB[bankOfPA[k] as number] = (mPB[bankOfPA[k] as number] as number) - r;
    mQB[bankOfQA[j] as number] = (mQB[bankOfQA[j] as number] as number) - r;
  });
  for (const [mt, st] of [
    [mPB, tPB],
    [mPA, tPA],
    [mQA, sQA],
    [mQB, tQB],
  ] as const) {
    mt.forEach((v, k) => (maxGroupDiff = Math.max(maxGroupDiff, Math.abs(v - (st[k] as number)))));
  }
  return { m, relaxed, maxPaymentDiff, maxGroupDiff };
}

// ---------------------------------------------------------------------------------------------
// Flujo entero factible con cotas inferiores (circulación), por Dinic
// ---------------------------------------------------------------------------------------------

/** 2⁵² (sin `**`: principio 4). */
const INF = 4_503_599_627_370_496;

/**
 * Red con cotas [lo, hi] por arista. `feasible` busca una circulación entera que las cumpla (con la arista
 * sumidero → fuente agregada por quien la usa): reduce las cotas inferiores a ofertas y demandas en los nodos
 * y corre un flujo máximo desde una superfuente a un supersumidero (Dinic). Determinista.
 */
class LowerBoundNetwork {
  private readonly head: number[];
  private readonly to: number[] = [];
  private readonly cap: number[] = [];
  private readonly next: number[] = [];
  private readonly lower: number[] = [];
  private readonly excess: number[];
  private nodes: number;

  constructor(nodes: number) {
    this.nodes = nodes;
    this.head = new Array<number>(nodes + 2).fill(-1);
    this.excess = new Array<number>(nodes).fill(0);
  }

  private addArc(u: number, v: number, c: number): number {
    const e = this.to.length;
    this.to.push(v, u);
    this.cap.push(c, 0);
    this.next.push(-1, -1);
    this.lower.push(0, 0);
    // Inserción al final de la lista de u y de v (orden de inserción, para el determinismo del recorrido).
    this.append(u, e);
    this.append(v, e + 1);
    return e;
  }

  private readonly tail: number[] = [];
  private append(u: number, e: number): void {
    const t = this.tail[u];
    if (t === undefined || t < 0) this.head[u] = e;
    else this.next[t] = e;
    this.tail[u] = e;
  }

  /** Arista u → v con cotas [lo, hi] enteras. Devuelve su id. */
  edge(u: number, v: number, lo: number, hi: number): number {
    if (!(lo <= hi)) {
      // Cotas vacías (solo con un techo por debajo del piso): arista imposible.
      const e = this.addArc(u, v, 0);
      this.lower[e] = lo;
      this.excess[v] = (this.excess[v] as number) + lo;
      this.excess[u] = (this.excess[u] as number) - lo;
      this.impossible = true;
      return e;
    }
    const e = this.addArc(u, v, hi - lo);
    this.lower[e] = lo;
    this.excess[v] = (this.excess[v] as number) + lo;
    this.excess[u] = (this.excess[u] as number) - lo;
    return e;
  }

  private impossible = false;
  private readonly initialCap: number[] = [];

  feasible(): boolean {
    if (this.impossible) return false;
    const s = this.nodes;
    const t = this.nodes + 1;
    this.nodes += 2;
    let need = 0;
    for (let v = 0; v < s; v++) {
      const ex = this.excess[v] as number;
      if (ex > 0) {
        this.addArc(s, v, ex);
        need += ex;
      } else if (ex < 0) this.addArc(v, t, -ex);
    }
    for (let e = 0; e < this.cap.length; e++) this.initialCap[e] = this.cap[e] as number;
    return this.maxFlow(s, t) === need;
  }

  /** Flujo en la arista `e` (cota inferior + lo que pasó). */
  flowOn(e: number): number {
    return (this.lower[e] as number) + (this.initialCap[e] as number) - (this.cap[e] as number);
  }

  private maxFlow(s: number, t: number): number {
    const N = this.nodes;
    const level = new Array<number>(N);
    const it = new Array<number>(N);
    let flow = 0;
    for (;;) {
      level.fill(-1);
      level[s] = 0;
      const queue = [s];
      for (let q = 0; q < queue.length; q++) {
        const u = queue[q] as number;
        for (let e = this.head[u] as number; e >= 0; e = this.next[e] as number) {
          const v = this.to[e] as number;
          if ((this.cap[e] as number) > 0 && level[v] === -1) {
            level[v] = (level[u] as number) + 1;
            queue.push(v);
          }
        }
      }
      if (level[t] === -1) return flow;
      for (let u = 0; u < N; u++) it[u] = this.head[u] as number;
      for (;;) {
        const f = this.augment(s, t, INF, level, it);
        if (f === 0) break;
        flow += f;
      }
    }
  }

  /** Camino aumentante en el grafo de niveles (DFS iterativo, con punteros de arista por nodo). */
  private augment(s: number, t: number, limit: number, level: number[], it: number[]): number {
    const pathEdges: number[] = [];
    let u = s;
    for (;;) {
      if (u === t) {
        let f = limit;
        for (const e of pathEdges) f = Math.min(f, this.cap[e] as number);
        for (const e of pathEdges) {
          this.cap[e] = (this.cap[e] as number) - f;
          this.cap[e ^ 1] = (this.cap[e ^ 1] as number) + f;
        }
        return f;
      }
      let advanced = false;
      for (; (it[u] as number) >= 0; it[u] = this.next[it[u] as number] as number) {
        const e = it[u] as number;
        const v = this.to[e] as number;
        if ((this.cap[e] as number) > 0 && level[v] === (level[u] as number) + 1) {
          pathEdges.push(e);
          u = v;
          advanced = true;
          break;
        }
      }
      if (advanced) continue;
      // Callejón sin salida: se poda el nodo y se retrocede.
      level[u] = -1;
      const back = pathEdges.pop();
      if (back === undefined) return 0;
      u = this.to[back ^ 1] as number;
      it[u] = this.next[it[u] as number] as number;
    }
  }
}
