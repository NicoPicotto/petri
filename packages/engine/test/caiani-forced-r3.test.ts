/**
 * Caminos R3 de la rama forzada (docs/inventario-decisiones.md, sec. H; reglas-caiani.md, sec. 1, "Decisiones frágiles dadas
 * vuelta"): en modo oráculo, una decisión frágil de los dos lados se fuerza a la rama de JMAB; donde esa rama, con los
 * valores del port, dividiría por 0 µ, dejaría una cantidad negativa o llevaría a un camino que JMAB recorre con valores que
 * el port no tiene, el port tira "rama forzada no portada". Un caso a mano por lugar, con un registrador en modo oráculo que
 * fuerza la rama (pendientes.md, P4: en V4 el port corre sin oráculo y estos caminos no se alcanzan; acá se fija que tiren su
 * error y no sigan en silencio).
 *
 * `TargetedOracle`: registrador en modo oráculo cuyo registro de JMAB tiene solo las decisiones del lugar (y agente) que se
 * quiere forzar; las demás decisiones del evento devuelven la del port sin emparejar (como si JMAB coincidiera). Así se llega
 * al lugar sin escribir el registro entero del evento; el lugar en sí pasa por `DecisionRecorder.decide` completo
 * (fragilidad de los dos lados, R2, alineación).
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import {
  DecisionRecorder,
  MKT,
  PrngCaianiRng,
  SITE_AT_ONCE,
  SITE_CONSUMPTION_DEMAND,
  SITE_INTEREST_RATE,
  SITE_PAY_WAGES_CONSUMPTION,
  SITE_TARGET_OUTPUT,
  adaptiveInterestRate,
  bondDemandEvent,
  computeExpectationsEvent,
  consumptionDemandEvent,
  consumptionMarketEvent,
  contractIds,
  contractOf,
  credit,
  firstAsset,
  initialize,
  pay,
  productionEvent,
  targetOutput,
  wagePaymentEvent,
  withDecisions,
  type AdaptiveRateParams,
  type CaianiRng,
  type DecisionOptions,
  type OracleDecision,
  type Tolerance,
} from '../src/caiani';

class TargetedOracle extends DecisionRecorder {
  constructor(
    private readonly site: string,
    private readonly agent: number | undefined,
    event: number,
    lines: OracleDecision[],
  ) {
    super();
    this.oracle = new Map([[event, lines]]);
  }

  override decide(
    site: string,
    outcome: number,
    a: number,
    b: number,
    tolerance: Tolerance,
    scale: number | undefined,
    agent: number | undefined,
    integer: boolean,
    opts: DecisionOptions | undefined,
  ): number {
    if (site !== this.site || (this.agent !== undefined && agent !== this.agent)) {
      this.lastForced = false;
      return outcome;
    }
    return super.decide(site, outcome, a, b, tolerance, scale, agent, integer, opts);
  }
}

const R3 = /rama forzada no portada/;
const fresh = () => {
  const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
  s.round = 1;
  return s;
};

describe('rama forzada: caminos R3 (inventario-decisiones, sec. H)', () => {
  it('producción deseada (evento 0): "x > 0" forzada a verdadero con x = 0 en el port', () => {
    // Sᵉ = 100, inventario 110: x = 100 + (10 − 110) = 0 exacto; escala de los términos 110, distancia 0 (frágil).
    // JMAB: x = 10⁻¹² > 0 (distancia 10⁻¹⁴, frágil): se fuerza a verdadero y el port tendría Y* = 0 con la rama de x > 0.
    const rec = new DecisionRecorder();
    rec.oracle = new Map([[0, [{ site: SITE_TARGET_OUTPUT, agent: -1, outcome: 1, a: 1e-12, b: 0 }]]]);
    expect(() => withDecisions(rec, 0, () => targetOutput(100, 110, 0.1))).toThrow(R3);
    // Control: con la rama de JMAB igual a la del port (x ≤ 0), sigue (Y* = 0).
    const ok = new DecisionRecorder();
    ok.oracle = new Map([[0, [{ site: SITE_TARGET_OUTPUT, agent: -1, outcome: 0, a: -1e-12, b: 0 }]]]);
    expect(withDecisions(ok, 0, () => targetOutput(100, 110, 0.1))).toBe(0);
  });

  it('banco sin depósitos (evento 0): "depósitos = 0" forzada a falso con 0 µ (reservas / 0)', () => {
    const s = fresh();
    const L = s.ledger;
    const [b0, b1] = [s.banks[0]!, s.banks[1]!];
    // Todos los depósitos del banco 0 pasan a un depósito del banco 1 (con sus reservas): quedan en 0 µ.
    const to = s.households.map((h) => firstAsset(L, h.id, 'deposit')!).find((d) => d.issuer === b1.id)!;
    for (const id of contractIds(L, b0.id, 'liabilities', 'deposit')) pay(L, id, to.id, contractOf(L, id).amount, 'deposits');
    expect(contractIds(L, b0.id, 'liabilities', 'deposit').every((id) => contractOf(L, id).amount === 0)).toBe(true);
    // JMAB: depósitos de 10⁻⁶ unidades (1 µ) ≠ 0. Con los operandos del port en 0 µ exacto y los de JMAB ≤ 2 µ se toma por R2
    // (residuo), que se evalúa antes que la fragilidad.
    const site = 'Bank.onTicArrived depósitos = 0';
    const rec = new TargetedOracle(site, b0.id, 0, [{ site, agent: -1, outcome: 0, a: 1e-6, b: 0 }]);
    expect(() => withDecisions(rec, 0, () => computeExpectationsEvent(s))).toThrow(/banco .*rama forzada no portada/);
    expect(rec.forced.map((f) => [f.site, f.kind, f.port, f.jmab])).toEqual([[site, 'residuo', 1, 0]]);
  });

  describe('tasa adaptativa (eventos 6 y 7): piso 0 y techo', () => {
    const banks = [
      { ratio: 0.1, pastRate: 0.01 },
      { ratio: 0.1, pastRate: 0.01 },
    ];
    /** Paso = adaptativo × tasa media × normal = 1 × 0,01 × 1 = 0,01. */
    const unitNormal = { foldedNormal: () => 1 } as unknown as CaianiRng;
    const params = (upperBound: number): AdaptiveRateParams => ({ adaptive: 1, increase: false, sigma: 0.0094, upperBound, reference: 'ratio de capital' });
    const above = `${SITE_INTEREST_RATE} ratio de capital > promedio`;

    it('piso: "iR > 0" forzada a verdadero con iR = 0 exacto en el port', () => {
      // Referencia 0,2 > promedio 0,1, sin `increase`: iR = 0,01 − 0,01 = 0 (distancia 0 a escala 0,01, frágil).
      const rec = new DecisionRecorder();
      rec.oracle = new Map([
        [
          6,
          [
            { site: above, agent: -1, outcome: 1, a: 0.2, b: 0.1 },
            { site: `${SITE_INTEREST_RATE} piso 0`, agent: -1, outcome: 1, a: 1e-17, b: 0 },
          ],
        ],
      ]);
      expect(() => withDecisions(rec, 6, () => adaptiveInterestRate(0.2, banks, unitNormal, params(Infinity)))).toThrow(R3);
    });

    it('techo: "iR < techo" forzada a verdadero con iR = techo en el port', () => {
      // Referencia 0,05 ≤ promedio 0,1: iR = 0,01 + 0,01 = 0,02 = techo (distancia 0, frágil); JMAB 0,02 − 10⁻¹⁷.
      const rec = new DecisionRecorder();
      rec.oracle = new Map([
        [
          7,
          [
            { site: above, agent: -1, outcome: 0, a: 0.05, b: 0.1 },
            { site: `${SITE_INTEREST_RATE} piso 0`, agent: -1, outcome: 1, a: 0.02, b: 0 },
            { site: `${SITE_INTEREST_RATE} techo`, agent: -1, outcome: 1, a: 0.02 - 1e-17, b: 0.02 },
          ],
        ],
      ]);
      expect(() => withDecisions(rec, 7, () => adaptiveInterestRate(0.05, banks, unitNormal, params(0.02)))).toThrow(R3);
      // Sin oráculo, la misma cuenta da el techo.
      expect(adaptiveInterestRate(0.05, banks, unitNormal, params(0.02))).toBe(0.02);
    });
  });

  it('inventario de la empresa de consumo (evento 15, B3): "inventario > 0" forzada a verdadero con inventario 0', () => {
    const s = fresh();
    const c = s.consumptionFirms[0]!;
    c.employees = []; // sin empleados no produce: el inventario queda en 0 y la escala (inventario, producción) es 0
    c.consumptionGoods[0]!.quantity = 0;
    // JMAB: inventario residual de 10⁻¹⁴ (operandos del port en 0 exacto y de JMAB ≤ 2 µ: R2).
    const site = 'ConsumptionFirm.produce inventario > 0';
    const rec = new TargetedOracle(site, c.id, 15, [{ site, agent: -1, outcome: 1, a: 1e-14, b: 0 }]);
    expect(() => withDecisions(rec, 15, () => productionEvent(s))).toThrow(/empresa de consumo .*rama forzada no portada/);
    expect(rec.forced.map((f) => [f.kind, f.port, f.jmab])).toEqual([['residuo', 0, 1]]);
  });

  it('demanda de consumo (evento 17): "demanda > 0" forzada a verdadero con demanda 0', () => {
    const s = fresh();
    const L = s.ledger;
    const [h, other] = [s.households[0]!, s.households[1]!];
    // Ocupado con salario 0, sin intereses, dividendos ni bienes, y su depósito pasado a otro hogar: ingreso neto 0 y
    // patrimonio 0, así que la demanda es 0 exacto (escala de los términos 0).
    h.employer = s.consumptionFirms[0]!.id;
    h.wage = 0;
    h.interestReceived = 0;
    h.dividendsReceived = 0;
    h.consumptionGoods = [];
    const d = firstAsset(L, h.id, 'deposit')!;
    pay(L, d.id, firstAsset(L, other.id, 'deposit')!.id, d.amount, 'deposits');
    const site = `${SITE_CONSUMPTION_DEMAND} demanda > 0`;
    const rec = new TargetedOracle(site, h.id, 17, [{ site, agent: -1, outcome: 1, a: 1e-15, b: 0 }]);
    expect(() => withDecisions(rec, 17, () => consumptionDemandEvent(s))).toThrow(/hogar .*rama forzada no portada/);
    expect(h.demand).toBe(0);
  });

  it('compra de consumo (evento 18): "demanda ≤ inventario" forzada a verdadero con demanda > inventario (inventario negativo)', () => {
    const s = fresh();
    for (const x of s.households) x.active[MKT.CONSGOOD] = false;
    for (const f of s.consumptionFirms) f.active[MKT.CONSGOOD] = false;
    const h = s.households[0]!;
    const c = s.consumptionFirms[3]!;
    h.active[MKT.CONSGOOD] = true;
    h.demand = 2 + 2e-12; // 10⁻¹² relativo por encima del inventario: frágil
    h.previousSeller = s.consumptionFirms[0]!.id; // inactivo: cambia a c sin sortear
    c.active[MKT.CONSGOOD] = true;
    c.consumptionGoods[0]!.price = 1.25;
    c.consumptionGoods[0]!.quantity = 2;
    const site = `${SITE_AT_ONCE} demanda ≤ inventario`;
    const rec = new TargetedOracle(site, h.id, 18, [{ site, agent: -1, outcome: 1, a: 2, b: 2 }]);
    expect(() => withDecisions(rec, 18, () => consumptionMarketEvent(s, new PrngCaianiRng(Rng.fromSeed(3))))).toThrow(/hogar .*rama forzada no portada/);
  });

  it('salarios (evento 21): "masa salarial > depósito" sin empleados es inalcanzable (se sale antes, como JMAB)', () => {
    // El R3 de `payFirmWages` (masa salarial 0 > depósito) no se puede alcanzar: sin empleados la función vuelve antes de la
    // decisión (JMAB: `if (employees.size() > 0)`, CopyOfConsumptionFirm2WagesEnd 105–107), así que no hay decisión que
    // forzar. Con el registro de JMAB preparado para forzarla, la línea queda sin consumir.
    const s = fresh();
    const c = s.consumptionFirms[0]!;
    c.employees = [];
    const site = `${SITE_PAY_WAGES_CONSUMPTION} masa salarial > depósito`;
    const rec = new TargetedOracle(site, c.id, 21, [{ site, agent: -1, outcome: 1, a: 0, b: 0 }]);
    withDecisions(rec, 21, () => wagePaymentEvent(s, new PrngCaianiRng(Rng.fromSeed(3))));
    expect(rec.cursor.get(21) ?? 0).toBe(0); // la línea de JMAB del evento 21 quedó sin consumir
    expect(rec.forced).toEqual([]);
  });

  it('demanda de bonos (evento 31): "rama 1" con empleables 0 (S·propias / 0) tira el error, también sin registrador', () => {
    // E = 0 con oferta S ≥ 1 no es frágil (distancia ≥ 10⁶ µ): la rama 1 con E = 0 solo se da con S = 0, y entonces no hace
    // falta forzarla (0 ≥ 0). Pasa en modo PRNG. JMAB: (int) Math.rint(0 · 0 / 0) = (int) NaN = 0 bonos. En el base no
    // pasa (la emisión sin déficit, 0 bonos, no corre en 7 semillas × 400 trimestres: reglas-caiani.md, sec. 28).
    const s = fresh();
    const L = s.ledger;
    s.government.bondOffer = { quantity: 0, price: 1, rate: 0.0025, maturity: 1, age: 0 };
    // Depósitos de cada banco + 2.000 unidades: 0,258 × depósitos queda por encima de las reservas de todos (E = 0).
    for (const b of s.banks) credit(L, contractIds(L, b.id, 'liabilities', 'deposit')[0]!, 2_000_000_000, 'depositInterest');
    expect(() => bondDemandEvent(s)).toThrow(R3);
  });
});
