/**
 * Escala de los flujos del V3 encadenado (reglas-caiani.md, sec. 1, "Regla del encadenado por escala de los
 * flujos"; aprobada por Nico el 2026-11-13). En una cadena de k eventos, un valor v pasa si
 * |v_port − v_JMAB| ≤ max(2k µ, ρ·S(v)) (montos) o ≤ max(10⁻⁶ |v|, ρ·S(v)) (`double` de montos), con
 * S(v) = |v al empezar la cadena| + Σ |operaciones que lo tocaron|.
 *
 * - **Contratos del ledger:** Σ |monto| de los registros del `flowLog` que lo listan (pagos, créditos, débitos,
 *   liquidaciones de reservas). Un contrato abierto dentro de la cadena arranca de 0.
 * - **Los demás valores** (por etiqueta de `compareState`): |valor inicial| + Σ |Δ| después de cada evento.
 * - **Bienes de consumo que compra un hogar en el evento** (se crean a partir de una transferencia): la escala
 *   se propaga como en los pagos. La cantidad de la i-ésima compra hereda la escala de la demanda del hogar al
 *   empezar el evento más la del inventario de **cada** vendedor hasta esa compra (la demanda restante salió de
 *   restarles); el valor, esa escala × precio; la demanda que le queda al hogar, la de su última compra. La
 *   escala del inventario de un vendedor es la de su valor al cerrar el evento (inicial + Σ |Δ|, incluidas las
 *   ventas de este evento): cubre también las ventas posteriores a la compra, así que sobreestima un poco.
 *
 * No toca el motor: solo lee el estado y el `flowLog` del ledger.
 */
import type { AgentId, CaianiState, FlowRecord } from '../../src/caiani';
import type { ScaleSource } from './jmab-dump';

/** Antes de un evento: cuántos bienes de consumo tiene cada hogar (los nuevos son los que se crean en él). */
export type GoodsSnapshot = Map<AgentId, number>;

export class ChainScales implements ScaleSource {
  /** Por contrato: |saldo al empezar la cadena|. */
  private readonly start = new Map<number, number>();
  /** Por contrato: Σ |monto| de los flujos del `flowLog` que lo tocaron. */
  private readonly flows = new Map<number, number>();
  private log: FlowRecord[];
  private logIndex = 0;
  /** Por etiqueta: escala y valor confirmados al cerrar el evento anterior. */
  private readonly S = new Map<string, number>();
  private readonly prev = new Map<string, number>();
  /** Lo calculado durante la comparación en curso (se confirma con `commit`). */
  private readonly pending = new Map<string, [number, number]>();
  /** Escalas propagadas del evento en curso (bienes creados y demandas). */
  private readonly overrides = new Map<string, number>();

  constructor(
    private readonly s: CaianiState,
    readonly rho: number,
    private readonly toJ: (id: AgentId) => number,
  ) {
    for (const c of Object.values(s.ledger.contracts)) this.start.set(c.id, Math.abs(c.amount));
    this.log = s.ledger.flowLog;
    if (this.log.length > 0) throw new Error('ChainScales: el flowLog tiene que empezar vacío (beginPeriod)');
  }

  private sync(): void {
    if (this.s.ledger.flowLog !== this.log) throw new Error('ChainScales: se reemplazó el flowLog dentro de la cadena');
    for (; this.logIndex < this.log.length; this.logIndex++) {
      const r = this.log[this.logIndex]!;
      for (const id of r.contracts) this.flows.set(id, (this.flows.get(id) ?? 0) + Math.abs(r.amount));
    }
  }

  contract(id: number): number {
    this.sync();
    return (this.start.get(id) ?? 0) + (this.flows.get(id) ?? 0);
  }

  /** Escala de una etiqueta con su valor actual, sin anotarla. */
  private peek(label: string, v: number): number {
    const o = this.overrides.get(label);
    if (o !== undefined) return o;
    const S0 = this.S.get(label);
    const p = this.prev.get(label);
    if (S0 === undefined || p === undefined) return Number.isFinite(v) ? Math.abs(v) : 0;
    const d = Math.abs(v - p);
    return S0 + (Number.isFinite(d) ? d : 0);
  }

  value(label: string, v: number): number {
    const S = this.peek(label, v);
    if (Number.isFinite(v)) this.pending.set(label, [S, v]);
    return S;
  }

  /** Después de comparar: confirma escalas y valores para el evento siguiente. */
  commit(): void {
    for (const [label, [S, v]] of this.pending) {
      this.S.set(label, S);
      this.prev.set(label, v);
    }
    this.pending.clear();
    this.overrides.clear();
  }

  /** Antes de correr un evento. */
  snapshot(): GoodsSnapshot {
    const snap: GoodsSnapshot = new Map();
    for (const h of this.s.households) snap.set(h.id, h.consumptionGoods.length);
    return snap;
  }

  /**
   * Después de correr el evento y antes de comparar: escalas propagadas de los bienes de consumo que compraron
   * los hogares en el evento y de la demanda que les queda. Devuelve cuántos bienes nuevos hubo.
   */
  propagate(snap: GoodsSnapshot): number {
    const firms = new Map(this.s.consumptionFirms.map((f) => [f.id, f]));
    let created = 0;
    for (const h of this.s.households) {
      const n0 = snap.get(h.id) ?? 0;
      const goods = h.consumptionGoods;
      if (goods.length <= n0) continue;
      const demandLabel = `hogar ${this.toJ(h.id)} demanda de consumo`;
      // Escala de la demanda al empezar el evento (la confirmada después del evento anterior).
      let acc = this.S.get(demandLabel) ?? Math.abs(this.prev.get(demandLabel) ?? h.demand);
      for (let i = n0; i < goods.length; i++) {
        const g = goods[i]!;
        const seller = firms.get(g.producer);
        const inv = seller?.consumptionGoods[0];
        if (!seller || !inv) throw new Error(`ChainScales: el bien ${i} del hogar ${h.id} no tiene vendedor con inventario`);
        acc += this.peek(`${this.toJ(seller.id)} bien de consumo [0] cantidad`, inv.quantity);
        this.overrides.set(`${this.toJ(h.id)} bien de consumo [${i}] cantidad`, acc);
        this.overrides.set(`${this.toJ(h.id)} bien de consumo [${i}] valor`, acc * g.price);
        created++;
      }
      this.overrides.set(demandLabel, acc);
    }
    return created;
  }
}
