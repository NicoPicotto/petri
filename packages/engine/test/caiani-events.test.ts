/**
 * P3: eventos del tick contra el oráculo (V3) y casos a mano (V2). Registro en docs/reglas-caiani.md.
 *
 * Método de V3 por evento: el oráculo vuelca el estado antes y después del evento e del tick t
 * (`DUMP_TICKS`, `DUMP_EVENTS`); el port arranca del estado "antes" (reconstruido con `stateFromDump`),
 * corre el evento con el `Rng` en modo oráculo y se compara con el estado "después".
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import {
  LAG,
  MKT,
  OracleCaianiRng,
  PrngCaianiRng,
  adaptiveMarkUpPrice,
  capitalMarketFirstStepEvent,
  capitalPriceEvent,
  capitalAttractiveness,
  investmentDemandEvent,
  realCapitalDemand,
  switchingProbability,
  LN2,
  rdDecisionEvent,
  computeExpectationsEvent,
  consumptionLowerBound,
  consumptionPriceEvent,
  initialize,
  parseDraws,
  requiredWorkers,
  targetOutput,
  type CaianiRng,
  type CaianiState,
  type FirmState,
} from '../src/caiani';
import { compareState, idMaps, readDump, stateFromDump } from './support/jmab-dump';

describe('evento 0 (computeExpectations): casos a mano', () => {
  it('producción deseada: Y* = max(0, Sᵉ + 0,1·Sᵉ − inventario)', () => {
    // Empresa de consumo al inicio: Sᵉ = 320,0000000776429, inventario 32 → 320,0000000854072 (JMAB).
    expect(targetOutput(320.0000000776429, 32, 0.1)).toBe(320.0000000854072);
    expect(targetOutput(100, 10, 0.1)).toBe(100); // empresa de capital: 100 + 10 − 10
    expect(targetOutput(10, 50, 0.1)).toBe(0); // inventario de sobra: no produce
  });

  it('sobre el estado inicial del port: ratios del banco y ganancias del BC', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    computeExpectationsEvent(s);
    // Reservas 2.856,458248 / depósitos 11.070,413… del banco 0.
    expect(s.banks[0]!.liquidityRatio).toBeCloseTo(2856.458248 / 11070.41331, 6);
    expect(s.centralBank.interestsOnBonds).toBe(71_410_000); // 28.564 × 0,0025
    expect(s.centralBank.interestsOnAdvances).toBe(0); // adelantos de saldo 0
    expect(s.centralBank.active[MKT.ADVANCES]).toBe(true);
    expect(s.consumptionFirms.every((c) => c.active[MKT.CAPGOOD])).toBe(true);
  });
});

/** Rng que devuelve una secuencia fija de normales plegadas (para casos a mano). */
function fixedNormals(xs: number[]): CaianiRng {
  let k = 0;
  const no = () => {
    throw new Error('no se esperaba este sorteo');
  };
  return {
    foldedNormal: () => xs[k++]!,
    bernoulli: no,
    shuffle: no,
    shuffleEmployees: no,
    sample: no,
    uniform01: no,
  };
}

describe('eventos 1 y 2 (precios): casos a mano', () => {
  const r = { markUpThreshold: 0.1, markUpAdaptive: 1, markUpSigma: 0.0094 };

  it('margen: baja si inventario/ventas > 0,1 y sube si no; precio = piso·(1 + margen)', () => {
    const f = { markUp: 0.1 } as FirmState;
    // Inventario 20 / ventas 100 = 0,2 > 0,1: margen 0,1 − 1·0,1·0,05 = 0,095; piso 2 → 2·1,095 = 2,19.
    expect(adaptiveMarkUpPrice(f, 20, 2.2, 100, () => 2, fixedNormals([0.05]), r)).toBe(2 * (1 + 0.095));
    expect(f.markUp).toBe(0.1 - 0.1 * 0.05);
    // 5 / 100 = 0,05 ≤ 0,1: sube.
    const g = { markUp: 0.1 } as FirmState;
    adaptiveMarkUpPrice(g, 5, 2.2, 100, () => 2, fixedNormals([0.05]), r);
    expect(g.markUp).toBe(0.1 + 0.1 * 0.05);
  });

  it('con piso 0 usa el piso anterior, precio / (1 + margen anterior)', () => {
    const f = { markUp: 0.25 } as FirmState;
    // Piso anterior 2,5 / 1,25 = 2; margen sube a 0,25·1,1 = 0,275 → 2·1,275.
    expect(adaptiveMarkUpPrice(f, 0, 2.5, 100, () => 0, fixedNormals([0.1]), r)).toBe((2.5 / 1.25) * (1 + 0.25 * 1.1));
  });

  it('trabajadores requeridos: añadas más productivas primero, cantidad / (capital/trabajo)', () => {
    const g = (productivity: number, quantity: number) =>
      ({ productivity, quantity, capitalLaborRatio: 6.4 }) as Parameters<typeof requiredWorkers>[0][number];
    // Producir 30: la añada de productividad 2 (capacidad 20) entera → 10/6,4; faltan 10 → 10 de la de 1 → 10/6,4.
    expect(requiredWorkers([g(1, 50), g(2, 10)], 30)).toBe(10 / 6.4 + 10 / 6.4);
    // Empresa de consumo inicial: 20 añadas de 20, producir 320 → 50 trabajadores.
    expect(Math.round(requiredWorkers(Array.from({ length: 20 }, () => g(1, 20)), 320.0000000854072))).toBe(50);
  });

  it('piso de la empresa de consumo al inicio: 5 × 50 / 320,0000000854072 (JMAB: 0,7812499997914863)', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    computeExpectationsEvent(s);
    expect(consumptionLowerBound(s.consumptionFirms[0]!)).toBe(0.7812499997914863);
  });

  it('piso sin producción deseada: salario × trabajadores para el inventario (sin redondear) / inventario', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    const c = s.consumptionFirms[0]!;
    c.desiredOutput = 0;
    c.consumptionGoods[0]!.quantity = 10;
    // 10 unidades con añadas de productividad 1 y capital/trabajo 6,4: 10/6,4 trabajadores; salario esperado 5.
    expect(consumptionLowerBound(c)).toBe((5 * (10 / 6.4)) / 10);
    c.consumptionGoods[0]!.quantity = 0;
    expect(consumptionLowerBound(c)).toBeNaN(); // 0/0, como JMAB 2015
  });
});

describe('evento 3 (primera etapa del mercado de capital): casos a mano', () => {
  /** Rng cuyas mezclas invierten la lista (para seguir a mano qué ve cada comprador). */
  function reversingRng(log: string[]): CaianiRng {
    const no = () => {
      throw new Error('no se esperaba este sorteo');
    };
    return {
      foldedNormal: no,
      bernoulli: no,
      shuffle: <T,>(_site: string, what: string, items: T[]) => {
        log.push(what);
        return items.reverse();
      },
      shuffleEmployees: no,
      sample: no,
      uniform01: no,
    };
  }

  it('mezcla compradores una vez y vendedores una vez por comprador; toma los primeros 5 activos', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    computeExpectationsEvent(s);
    const K = s.populations.capitalFirms.slice();
    const C = s.populations.consumptionFirms.slice();
    // Inactivas las dos primeras de la lista invertida (las dos últimas de la original).
    const byId = new Map(s.capitalFirms.map((k) => [k.id, k]));
    byId.get(K[K.length - 1]!)!.active[MKT.CAPGOOD] = false;
    byId.get(K[K.length - 2]!)!.active[MKT.CAPGOOD] = false;
    const log: string[] = [];
    capitalMarketFirstStepEvent(s, reversingRng(log));
    expect(log).toEqual(['buyers', ...C.map(() => 'sellers')]);
    // 100 compradores: la lista de vendedores se invierte 100 veces (vuelve al orden original) y la de
    // compradores una vez.
    expect(s.populations.capitalFirms).toEqual(K);
    expect(s.populations.consumptionFirms).toEqual(C.slice().reverse());
    const cById = new Map(s.consumptionFirms.map((c) => [c.id, c]));
    // Primer comprador (el último de la lista original): ve la lista invertida, sin las dos inactivas.
    const rev = K.slice().reverse();
    expect(cById.get(C[C.length - 1]!)!.selectedCapitalSuppliers).toEqual(rev.slice(2, 7));
    // Segundo: ve la lista original; las inactivas están al final y no llegan.
    expect(cById.get(C[C.length - 2]!)!.selectedCapitalSuppliers).toEqual(K.slice(0, 5));
  });

  it('sin vendedores activos no hay evento: la empresa conserva la lista anterior', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    for (const k of s.capitalFirms) k.active[MKT.CAPGOOD] = false;
    const prev = [s.capitalFirms[3]!.id];
    s.consumptionFirms[0]!.selectedCapitalSuppliers = prev;
    capitalMarketFirstStepEvent(s, reversingRng([]));
    expect(s.consumptionFirms[0]!.selectedCapitalSuppliers).toBe(prev);
    expect(s.consumptionFirms[1]!.selectedCapitalSuppliers).toBeNull();
  });
});

describe('evento 4 (I+D): caso a mano', () => {
  it('amountResearch = ventas nominales del período anterior × researchShare (0 en el base)', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    rdDecisionEvent(s);
    expect(s.capitalFirms.every((k) => k.amountResearch === 0)).toBe(true);
    const k = s.capitalFirms[0]!;
    k.lags[LAG.NOMINALSALES] = { 0: 200 };
    rdDecisionEvent({ ...s, rules: { ...s.rules, researchShare: 0.05 } });
    expect(k.amountResearch).toBe(10);
    delete k.lags[LAG.NOMINALSALES];
    expect(() => rdDecisionEvent(s)).toThrow(/rezago/);
  });
});

describe('evento 5 (demanda de inversión): casos a mano', () => {
  const λ = LN2 / 0.2;

  it('probabilidad de cambio (SwitchingStrategySimple): pago y cobro', () => {
    // Pago: solo si el nuevo es más barato. 1 − e^{λ(90 − 100)/90}.
    expect(switchingProbability(100, 90, λ, true)).toBeCloseTo(1 - Math.exp((λ * (90 - 100)) / 90), 12);
    expect(switchingProbability(90, 100, λ, true)).toBe(0);
    // Cobro: solo si el nuevo paga más. 1 − e^{λ(90 − 100)/90}.
    expect(switchingProbability(90, 100, λ, false)).toBeCloseTo(1 - Math.exp((λ * (90 - 100)) / 90), 12);
    expect(switchingProbability(100, 90, λ, false)).toBe(0);
    // Mitad de probabilidad cuando el precio nuevo es 20% más bajo que el previo... en relación al nuevo:
    // λ·0,2 = ln 2 → p = 1/2 si (previo − nuevo)/nuevo = 0,2.
    expect(switchingProbability(120, 100, λ, true)).toBeCloseTo(0.5, 12);
  });

  it('atractivo del capital: salario esperado / (productividad × capital/trabajo) × duración / precio', () => {
    const g = { productivity: 1, capitalLaborRatio: 6.4, duration: 20, price: 2.5 } as Parameters<typeof capitalAttractiveness>[1];
    expect(capitalAttractiveness(5, g)).toBe(((5 / 6.4) * 20) / 2.5);
  });

  it('demanda real de capital: capacidad deseada − residual, en unidades de capital nuevo', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    const c = s.consumptionFirms[0]!;
    // 20 añadas de 20 unidades, productividad 1, edades 0..19, duración 20: capacidad 400; la de edad 19
    // no sigue el período siguiente (20 − 19 = 1): residual 380. Con crecimiento 0,05: 420 − 380 = 40.
    expect(c.capitalGoods.length).toBe(20);
    c.capitalGoods.forEach((g, i) => {
      g.age = i;
      g.obsolete = false;
    });
    c.desiredCapacityGrowth = 0.05;
    const newK = { ...c.capitalGoods[0]!, price: 1000 };
    expect(realCapitalDemand(c, newK)).toBe(40);
    // Sin crecimiento y capacidad residual mayor que la deseada: 0. Una añada de edad −1 no cuenta
    // en la capacidad actual pero sí en la residual.
    c.desiredCapacityGrowth = 0;
    c.capitalGoods[5]!.age = -1;
    // Capacidad actual 19·20 = 380 (sin la de edad −1); residual 380 (la de edad −1 sí, la de 19 no):
    // deseada = residual → round(0) = 0.
    expect(realCapitalDemand(c, newK)).toBe(0);
    // Obsolescencia, condición de JMAB 2015 (invertida; se corrigió en 2017): la añada vieja queda
    // obsoleta si ((ℓ vieja − ℓ nueva) / w)·(vida restante) − precio nuevo > 0, o sea si la VIEJA tiene
    // más productividad del trabajo. Capital nuevo mejor: no marca nada.
    realCapitalDemand(c, { ...newK, capitalLaborRatio: 12.8, price: 0.01 });
    expect(c.capitalGoods.some((g) => g.obsolete)).toBe(false);
    // Capital nuevo peor (ℓ 3,2 contra 6,4) y barato: (3,2 / 5)·(20 − edad) − 0,01 > 0 para toda vida
    // restante ≥ 1 → todas obsoletas.
    realCapitalDemand(c, { ...newK, capitalLaborRatio: 3.2, price: 0.01 });
    expect(c.capitalGoods.every((g) => g.obsolete)).toBe(true);
  });

  it('proveedor: el más atractivo; solo reemplaza al previo si está inactivo (la probabilidad de pago da 0)', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    computeExpectationsEvent(s);
    const [k0, k1, k2] = s.capitalFirms;
    k0!.capitalGoods[0]!.price = 3;
    k1!.capitalGoods[0]!.price = 2; // el más atractivo (más barato)
    k2!.capitalGoods[0]!.price = 2.5;
    for (const c of s.consumptionFirms) c.selectedCapitalSuppliers = [k0!.id, k1!.id, k2!.id];
    const a = s.consumptionFirms[0]!;
    const b = s.consumptionFirms[1]!;
    a.previousCapitalSupplier = k2!.id; // activo y menos atractivo: no cambia (p = 0, sin sorteo)
    b.previousCapitalSupplier = k2!.id;
    k2!.active[MKT.CAPGOOD] = true;
    const rng = fixedNormals([]); // cualquier sorteo tira error
    investmentDemandEvent({ ...s, consumptionFirms: [a] }, rng);
    expect(a.previousCapitalSupplier).toBe(k2!.id);
    k2!.active[MKT.CAPGOOD] = false; // inactivo: cambia al más atractivo
    investmentDemandEvent({ ...s, consumptionFirms: [b] }, rng);
    expect(b.previousCapitalSupplier).toBe(k1!.id);
  });
});

const ORACLE = fileURLToPath(new URL('../../../reference/p0/runs/oracle/', import.meta.url));

/** Corridas de referencia: semilla 12345, volcados al principio del tick y después de los eventos 0–2. */
const RUNS = [
  { run: 'p3-t1', tick: 1 },
  { run: 'p3-t50', tick: 50 },
];

describe.each(RUNS)('V3 por evento contra el oráculo, tick $tick (reference/, fuera de git)', ({ run, tick }) => {
  const dir = `${ORACLE}${run}/state/`;
  const dumpOf = (name: string) => readDump(dir + name);
  const before = `tick-${tick}.jsonl`;
  const after = (e: number) => `tick-${tick}-ev-${e}.jsonl`;
  const LAST = 5;
  const available = existsSync(dir + after(LAST));
  const draws = available ? parseDraws(readFileSync(`${ORACLE}${run}/draws.tsv`, 'utf8')) : [];
  let toJ: ((id: number) => number) | undefined;
  const drawsOf = (event: number) => {
    toJ ??= idMaps(dumpOf(before).meta).toJ;
    const rng = new OracleCaianiRng(
      draws.filter((r) => r.tick === tick && r.event === event),
      { agentId: toJ },
    );
    rng.tick = tick;
    return rng;
  };
  const check = (s: CaianiState, name: string, label: string) => {
    const r = compareState(s, dumpOf(name));
    console.log(`V3 tick ${tick}, ${label}:`, JSON.stringify(r.counts));
    expect(r.diffs).toEqual([]);
  };

  it.skipIf(!available)('el estado reconstruido desde un volcado coincide con el volcado', () => {
    const d = dumpOf(before);
    const r = compareState(stateFromDump(d), d);
    expect(r.diffs).toEqual([]);
    expect(r.counts.maxAmountDiff).toBe(0);
  }, 120_000);

  it.skipIf(!available)('cada evento desde el volcado anterior (0–5)', () => {
    const s0 = stateFromDump(dumpOf(before));
    computeExpectationsEvent(s0);
    check(s0, after(0), 'evento 0');
    const s1 = stateFromDump(dumpOf(after(0)));
    const rng1 = drawsOf(1);
    capitalPriceEvent(s1, rng1);
    expect(rng1.remaining).toBe(0);
    check(s1, after(1), 'evento 1');
    const s2 = stateFromDump(dumpOf(after(1)));
    const rng2 = drawsOf(2);
    consumptionPriceEvent(s2, rng2);
    expect(rng2.remaining).toBe(0);
    check(s2, after(2), 'evento 2');
    const s3 = stateFromDump(dumpOf(after(2)));
    const rng3 = drawsOf(3);
    capitalMarketFirstStepEvent(s3, rng3);
    expect(rng3.remaining).toBe(0);
    check(s3, after(3), 'evento 3');
    const s4 = stateFromDump(dumpOf(after(3)));
    rdDecisionEvent(s4);
    check(s4, after(4), 'evento 4');
    const s5 = stateFromDump(dumpOf(after(4)));
    const rng5 = drawsOf(5);
    investmentDemandEvent(s5, rng5);
    expect(rng5.remaining).toBe(0);
    check(s5, after(5), 'evento 5');
  }, 120_000);

  it.skipIf(!available)('eventos 0–5 encadenados desde el principio del tick', () => {
    const s = stateFromDump(dumpOf(before));
    computeExpectationsEvent(s);
    capitalPriceEvent(s, drawsOf(1));
    consumptionPriceEvent(s, drawsOf(2));
    capitalMarketFirstStepEvent(s, drawsOf(3));
    expect(drawsOf(4).remaining).toBe(0); // el evento 4 no sortea
    rdDecisionEvent(s);
    const rng5 = drawsOf(5);
    investmentDemandEvent(s, rng5);
    expect(rng5.remaining).toBe(0);
    check(s, after(5), 'eventos 0–5');
  }, 120_000);
});
