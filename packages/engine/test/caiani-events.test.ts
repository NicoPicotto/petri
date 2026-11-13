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
  adaptiveInterestRate,
  creditSupplyEvent,
  depositSupplyEvent,
  depositInterestEvent,
  creditDemandEvent,
  creditMarketEvent,
  expectedReturnCreditSupply,
  logisticDefaultProbability,
  loanInterestRate,
  RULES,
  debtPayments,
  peckingOrderCreditDemand,
  consumptionFinancialRequirement,
  capitalFinancialRequirement,
  createLedger,
  addAgent,
  open,
  EXPECTATION,
  contractIds,
  contractOf,
  type AdaptiveRateParams,
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
  DecisionRecorder,
  compareOutcomes,
  summarizeDecisions,
  withDecisions,
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

describe('evento 6 (oferta de crédito): casos a mano', () => {
  const r: AdaptiveRateParams = { adaptive: 1, increase: false, sigma: 0.0094, upperBound: Infinity, reference: 'ratio de capital' };
  const banks = [
    { ratio: 0.2, pastRate: 0.008 },
    { ratio: 0.1, pastRate: 0.006 },
  ];

  it('tasa: media ∓ media·|N| según el ratio de capital contra el promedio (increase = false)', () => {
    // Umbral (0,2 + 0,1)/2 = 0,15; tasa media 0,007. Ratio 0,2 > 0,15: baja → 0,007 − 0,007·0,1.
    expect(adaptiveInterestRate(0.2, banks, fixedNormals([0.1]), r)).toBe(0.007 - 1 * 0.007 * 0.1);
    // Ratio 0,1 ≤ 0,15: sube.
    expect(adaptiveInterestRate(0.1, banks, fixedNormals([0.1]), r)).toBe(0.007 + 1 * 0.007 * 0.1);
    // Igual al umbral: no lo supera, sube.
    expect(adaptiveInterestRate(0.15, banks, fixedNormals([0.1]), r)).toBe(0.007 + 0.007 * 0.1);
  });

  it('piso 0; sin bancos con préstamos y patrimonio positivo, NaN (como JMAB)', () => {
    expect(adaptiveInterestRate(0.2, banks, fixedNormals([1.5]), r)).toBe(0);
    expect(adaptiveInterestRate(0.2, [], fixedNormals([0.1]), r)).toBeNaN();
  });

  it('sobre el estado inicial: oferta infinita, activo en crédito, un sorteo por banco', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    computeExpectationsEvent(s);
    const xs = s.banks.map((_, i) => 0.001 * (i + 1));
    const rng = fixedNormals(xs);
    creditSupplyEvent(s, rng);
    // Al inicio los 10 bancos son iguales: todos en el promedio (no lo superan) → suben. La media de
    // diez 0,0075 en double no es exactamente 0,0075: se toma la misma suma.
    let sum = 0;
    for (let i = 0; i < s.banks.length; i++) sum += 0.0075;
    const av = sum / s.banks.length;
    s.banks.forEach((b, i) => {
      expect(b.bankInterestRate).toBe(av + av * xs[i]!);
      expect(b.totalLoanSupply).toBe(Infinity);
      expect(b.lags[LAG.BANKTOTLOANSUPPLY]![1]).toBe(Infinity);
      expect(b.active[MKT.CREDIT]).toBe(true);
    });
  });
});

describe('eventos 7 y 8 (depósitos): casos a mano', () => {
  it('tasa de depósitos: todos los bancos en el promedio, techo = tasa de adelantos', () => {
    const p: AdaptiveRateParams = { adaptive: 1, increase: false, sigma: 0.0094, upperBound: 0.005, reference: 'ratio de liquidez' };
    const banks = [
      { ratio: 0.3, pastRate: 0.003 },
      { ratio: 0.2, pastRate: 0.002 },
    ];
    // Umbral 0,25, media 0,0025. Liquidez 0,3 > 0,25: baja; 0,2: sube.
    expect(adaptiveInterestRate(0.3, banks, fixedNormals([0.1]), p)).toBe(0.0025 - 0.0025 * 0.1);
    expect(adaptiveInterestRate(0.2, banks, fixedNormals([0.1]), p)).toBe(0.0025 + 0.0025 * 0.1);
    // Paso enorme: techo 0,005.
    expect(adaptiveInterestRate(0.2, banks, fixedNormals([3]), p)).toBe(0.005);
  });

  it('evento 7 sobre el estado inicial: un sorteo por banco y activo en depósitos', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    computeExpectationsEvent(s);
    const xs = s.banks.map((_, i) => 0.001 * (i + 1));
    depositSupplyEvent(s, fixedNormals(xs));
    for (const b of s.banks) {
      expect(b.active[MKT.DEPOSIT]).toBe(true);
      expect(Math.abs(b.depositInterestRate - 0.0025)).toBeLessThan(0.0025 * 0.011);
    }
  });

  it('evento 8: cada depósito capitaliza round(saldo × tasa del contrato); el depositante lo registra', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    const b = s.banks[0]!;
    const ids = contractIds(s.ledger, b.id, 'liabilities', 'deposit');
    const before = ids.map((id) => ({ ...contractOf(s.ledger, id) }));
    // Una tasa distinta en un contrato: se usa la del contrato, no la del banco.
    contractOf(s.ledger, ids[0]!).rate = 0.01;
    before[0]!.rate = 0.01;
    depositInterestEvent(s);
    let tot = 0;
    ids.forEach((id, n) => {
      const c0 = before[n]!;
      const interest = Math.round(c0.amount * c0.rate);
      tot += interest;
      expect(contractOf(s.ledger, id).amount).toBe(c0.amount + interest);
    });
    expect(b.totInterestsDeposits).toBe(tot);
    const h = s.households.find((x) => x.id === before[0]!.holder)!;
    expect(h.interestReceived).toBe(Math.round(before[0]!.amount * 0.01));
    // Hogar con 10,088… de depósito a 0,25%: 25.220 µ (JMAB: 0,025220041596875).
    expect(Math.round(10_088_016.63875 * 0.0025)).toBe(25_220);
  });
});

describe('evento 9 (demanda de crédito): casos a mano', () => {
  it('servicio de la deuda: nada con edad 0; capital fijo A/L e interés tasa × saldo; solo intereses al vencer', () => {
    const L = createLedger();
    const bank = addAgent(L, 'bank');
    const firm = addAgent(L, 'consumptionFirm');
    // Préstamo de 100 a 20 trimestres, edad 0 (dado este tick): no se paga.
    open(L, 'loan', bank, firm, 100_000_000, { rate: 0.01, age: 0, length: 20, amortization: 'fixedCapital' }, 'loans');
    // Préstamo de 200 a 20 trimestres, edad 3, saldo 170: interés 0,01·170 = 1,7; capital 200/20 = 10.
    open(L, 'loan', bank, firm, 170_000_000, { rate: 0.01, age: 3, length: 20, amortization: 'fixedCapital', initialAmount: 200_000_000 }, 'loans');
    // Solo intereses, a 4 trimestres, edad 4 (vence): interés 0,02·50 = 1 y todo el capital, 50.
    open(L, 'loan', bank, firm, 50_000_000, { rate: 0.02, age: 4, length: 4, amortization: 'onlyInterest' }, 'loans');
    expect(debtPayments(L, firm)).toEqual({ burden: 1_700_000 + 10_000_000 + 1_000_000 + 50_000_000, interests: 2_700_000 });
  });

  it('PeckingOrderTheory: crédito = max(requerimiento − (depósitos + efectivo), 0)', () => {
    const L = createLedger();
    const bank = addAgent(L, 'bank');
    const cb = addAgent(L, 'centralBank');
    const firm = addAgent(L, 'capitalFirm');
    open(L, 'deposit', firm, bank, 30_000_000, {}, 'deposits');
    open(L, 'cash', firm, cb, 5_000_000, {}, 'deposits');
    expect(peckingOrderCreditDemand(L, firm, 50)).toBe(15_000_000); // 50 − 35
    expect(peckingOrderCreditDemand(L, firm, 35)).toBe(0); // igual a la liquidez: no pide
    expect(peckingOrderCreditDemand(L, firm, -10)).toBe(0);
  });

  /** Empresa del estado inicial con expectativas fijadas a mano. */
  function withExpectations(f: FirmState, nominalSales: number, realSales: number, wages: number) {
    f.expectations[EXPECTATION.NOMINALSALES]!.expectation = nominalSales;
    f.expectations[EXPECTATION.REALSALES]!.expectation = realSales;
    f.expectations[EXPECTATION.WAGES]!.expectation = wages;
  }

  it('requerimiento de la empresa de consumo (CopyOfConsumptionFirm2WagesEnd.computeCreditDemand)', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    const c = s.consumptionFirms[0]!;
    const k = s.capitalFirms[0]!;
    withExpectations(c, 400, 320, 5);
    // 20 añadas de 20 (productividad 1, capital/trabajo 6,4): producir 320 → 50 trabajadores; N·wᵉ = 250.
    c.desiredOutput = 320;
    c.consumptionGoods[0]!.quantity = 32.7; // ⌊32,7⌋ = 32 = 0,1·320: el término del inventario da 0
    c.consumptionGoods[0]!.unitCost = 0.8;
    // Añadas con edades 0..19, precio 2, amortización 20: cada una 20·2/20 = 2 → 40. Una de edad −1 no cuenta.
    c.capitalGoods.forEach((g, i) => {
      g.age = i;
      g.price = 2;
      g.amortization = 20;
    });
    c.interestReceived = 1_000_000;
    c.debtInterests = 3_000_000;
    c.debtBurden = 10_000_000;
    // Inversión: 10 unidades al precio del PRIMER vendedor visto (2,5), aunque el proveedor elegido sea otro.
    c.desiredRealCapitalDemand = 10;
    k.capitalGoods[0]!.price = 2.5;
    c.selectedCapitalSuppliers = [k.id, s.capitalFirms[1]!.id];
    s.capitalFirms[1]!.capitalGoods[0]!.price = 99;
    // Πᵉ = 400 − 250 + 1 − 3 + 0 − 40 = 108; impuestos 108·0,18 = 19,44; dividendos 108·0,82·0,9 = 79,704.
    // Requerimiento = 250 + 25 + 10 − 1 + 19,44 + 79,704 − 400 + 1·250 = 233,144.
    expect(consumptionFinancialRequirement(s, c)).toBeCloseTo(233.144, 9);
    c.capitalGoods[0]!.age = -1; // sin esa añada (0 ≤ edad falla): amortización 38, Πᵉ = 110
    expect(consumptionFinancialRequirement(s, c)).toBeCloseTo(250 + 25 + 10 - 1 + 110 * 0.18 + 110 * 0.82 * 0.9 - 400 + 250, 9);
  });

  it('requerimiento de la empresa de capital (CopyOfCapitalFirm2WagesEnd.computeCreditDemand)', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    const k = s.capitalFirms[0]!;
    withExpectations(k, 60, 50, 5);
    k.desiredOutput = 21; // 21 / 2 = 10,5 → Math.round de Java: 11 trabajadores; N·wᵉ = 55
    k.capitalGoods[0]!.quantity = 5.7; // ⌊5,7⌋ = 5 = 0,1·50
    k.capitalGoods[0]!.unitCost = 2.5;
    k.interestReceived = 500_000;
    k.debtInterests = 1_000_000;
    k.debtBurden = 4_000_000;
    k.amountResearch = 12; // ⌊12/5⌋·5 = 10
    // Πᵉ = 60 − 55 + 0,5 − 1 + 0 = 4,5; impuestos 0,81; dividendos 4,5·0,82·0,9 = 3,321.
    // Requerimiento = 55 + 10 + 4 − 0,5 + 3,321 + 0,81 − 60 + 1·55 = 67,631.
    expect(capitalFinancialRequirement(s, k)).toBeCloseTo(67.631, 9);
  });

  it('evento 9 sobre el estado inicial: servicio de la deuda, crédito pedido y activa en crédito si pide', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    computeExpectationsEvent(s);
    for (const c of s.consumptionFirms) c.selectedCapitalSuppliers = [s.capitalFirms[0]!.id];
    creditDemandEvent(s);
    for (const f of [...s.consumptionFirms, ...s.capitalFirms]) {
      expect(f.debtBurden).toBe(debtPayments(s.ledger, f.id).burden);
      expect(f.debtBurden).toBeGreaterThan(0); // los préstamos iniciales tienen edad ≥ 1
      expect(f.active[MKT.CREDIT]).toBe(f.creditDemanded > 0);
    }
  });
});

describe('evento 10 (mercado de crédito): casos a mano', () => {
  it('tasa del préstamo: max(tasa del banco, tasa de bonos)', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    const b = s.banks[0]!;
    b.bankInterestRate = 0.008;
    b.bondInterestRate = 0.0025;
    expect(loanInterestRate(b)).toBe(0.008);
    b.bankInterestRate = 0.001;
    expect(loanInterestRate(b)).toBe(0.0025);
  });

  it('probabilidad de default logística: 1 / (1 + e^{(OCF − a·cuota)/cuota}), cuota = r·m + m/plazo', () => {
    // m = 100, r = 0,01, plazo 20: cuota = 1 + 5 = 6. OCF = 30, a = 3,922445: exponente (30 − 23,53467)/6.
    const x = (30 - 3.922445 * 6) / 6;
    expect(logisticDefaultProbability(30, 0.01, 100, 20, 3.922445)).toBeCloseTo(1 / (1 + Math.exp(x)), 12);
    // Monto 0: cuota 0, exponente ±∞ → p = 0 (OCF > 0) o 1 (OCF < 0), como Java; 0/0 → NaN.
    expect(logisticDefaultProbability(30, 0.01, 0, 20, 3.9)).toBe(0);
    expect(logisticDefaultProbability(-30, 0.01, 0, 20, 3.9)).toBe(1);
    expect(logisticDefaultProbability(0, 0.01, 0, 20, 3.9)).toBeNaN();
  });

  /** ExpectedReturnCreditSupply escrito directo de JMAB, con Math.pow y Math.exp (solo para el test). */
  function javaSupply(required: number, ocf: number, r: number, a: number, recovered: number): number {
    const D = 20;
    const s = 1 / D;
    for (let i = 0; i < 101; i++) {
      const m = required * (1 - i / 100);
      const pay = r * m + m / D;
      const p = 1 / (1 + Math.exp((ocf - a * pay) / pay));
      let er = 0;
      for (let t = 0; t < D; t++) er += Math.pow(1 - p, t) * (-1 + s * t) * m * (1 - recovered) + Math.pow(1 - p, t + 1) * r * m;
      for (let t = 1; t < D - 1; t++) er += Math.pow(1 - p, t + 1) * (t - 0.5 * t * s * (1 + t)) * r * m;
      er *= p;
      er += Math.pow(1 - p, D) * r * m * (D - 0.5 * (D - 1) * s * D);
      if (er >= 0) return m;
    }
    return 0;
  }

  it('oferta por rendimiento esperado: el primer monto pedido·(1 − i/100) con rendimiento ≥ 0', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const c = s.consumptionFirms[0]!;
    const b = s.banks[0]!;
    b.bankInterestRate = 0.0075;
    b.bondInterestRate = 0.0025;
    // Recupero esperado = min(1, Σ valor del capital × 0,5 / Σ deuda).
    let debt = 0;
    for (const id of contractIds(s.ledger, c.id, 'liabilities', 'loan')) debt += contractOf(s.ledger, id).amount / 1e6;
    let cap = 0;
    for (const g of c.capitalGoods) cap += g.value * 0.5;
    const rec = Math.min(1, cap / debt);
    // Tres flujos de caja: sobrado (presta todo), justo (recorta) y negativo (no presta).
    for (const [ocf, a] of [
      [1000, RULES.riskAversionC],
      [40, RULES.riskAversionC],
      [-50, RULES.riskAversionC],
    ] as const) {
      c.lags[LAG.OPERATINGCASHFLOW] = { 0: ocf };
      expect(expectedReturnCreditSupply(s, b, c, 100, true)).toBeCloseTo(javaSupply(100, ocf, 0.0075, a, rec), 9);
    }
    c.lags[LAG.OPERATINGCASHFLOW] = { 0: 1000 };
    expect(expectedReturnCreditSupply(s, b, c, 100, true)).toBe(100);
    c.lags[LAG.OPERATINGCASHFLOW] = { 0: -50 };
    expect(expectedReturnCreditSupply(s, b, c, 100, true)).toBe(0);
    // Con OCF 40 recorta: se verifica que el recorte coincide con el cálculo directo y que es intermedio.
    c.lags[LAG.OPERATINGCASHFLOW] = { 0: 40 };
    const cut = expectedReturnCreditSupply(s, b, c, 100, true);
    expect(cut).toBeGreaterThan(0);
    expect(cut).toBeLessThan(100);
    // La empresa de capital usa la aversión K (21,51): con el mismo OCF le prestan menos.
    const k = s.capitalFirms[0]!;
    k.lags[LAG.OPERATINGCASHFLOW] = { 0: 40 };
    expect(expectedReturnCreditSupply(s, b, k, 100, false)).toBeLessThan(cut);
  });

  /** Rng sin reordenar (las mezclas dejan la lista como está); cualquier Bernoulli tira error. */
  function identityRng(log: string[]): CaianiRng {
    const no = () => {
      throw new Error('no se esperaba este sorteo');
    };
    return {
      foldedNormal: no,
      bernoulli: no,
      shuffle: <T,>(_site: string, what: string, items: T[]) => {
        log.push(what);
        return items;
      },
      shuffleEmployees: no,
      sample: no,
      uniform01: no,
    };
  }

  it('mercado: préstamo al prestamista previo, depósito nuevo si no tiene cuenta en ese banco; cerrado sin compradores activos', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    for (const b of s.banks) {
      b.bankInterestRate = 0.0075; // todos iguales: nadie cambia de prestamista y no hay sorteos
      b.bondInterestRate = 0.0025;
      b.totalLoanSupply = Infinity;
      b.active[MKT.CREDIT] = true;
    }
    for (const f of [...s.consumptionFirms, ...s.capitalFirms]) f.active[MKT.CREDIT] = false;
    // Sin compradores activos: el mercado está cerrado y no se mezcla nada.
    const log: string[] = [];
    creditMarketEvent(s, identityRng(log));
    expect(log).toEqual([]);

    const [c0, c1] = s.consumptionFirms;
    for (const c of [c0!, c1!]) {
      c.lags[LAG.OPERATINGCASHFLOW] = { 0: 1e6 }; // sin riesgo: presta todo
      c.active[MKT.CREDIT] = true;
      c.creditDemanded = 50_000_000;
    }
    // c1: prestamista previo distinto del banco de su depósito.
    const depBank1 = contractOf(s.ledger, contractIds(s.ledger, c1!.id, 'assets', 'deposit')[0]!).issuer;
    const other = s.banks.find((b) => b.id !== depBank1)!;
    other.depositInterestRate = 0.003;
    c1!.previousLender = other.id;
    const dep0 = contractIds(s.ledger, c0!.id, 'assets', 'deposit');
    const dep0Before = contractOf(s.ledger, dep0[0]!).amount;
    expect(contractOf(s.ledger, dep0[0]!).issuer).toBe(c0!.previousLender);
    creditMarketEvent(s, identityRng(log));
    // Una mezcla de compradores y una de vendedores por comprador activo.
    expect(log).toEqual(['buyers', 'sellers', 'sellers']);
    for (const c of [c0!, c1!]) {
      const loans = contractIds(s.ledger, c.id, 'liabilities', 'loan');
      const l = contractOf(s.ledger, loans[loans.length - 1]!);
      expect(l).toMatchObject({ amount: 50_000_000, age: 0, rate: 0.0075, length: 20, amortization: 'fixedCapital', holder: c.previousLender });
      expect(c.creditDemanded).toBe(0);
      expect(c.active[MKT.CREDIT]).toBe(false);
    }
    // c0: se acredita en su depósito; c1: depósito nuevo en el otro banco, con su tasa de depósitos.
    expect(contractOf(s.ledger, dep0[0]!).amount).toBe(dep0Before + 50_000_000);
    const deps1 = contractIds(s.ledger, c1!.id, 'assets', 'deposit');
    expect(deps1.length).toBe(2);
    expect(contractOf(s.ledger, deps1[1]!)).toMatchObject({ issuer: other.id, amount: 50_000_000, rate: 0.003 });
  });
});

const ORACLE = fileURLToPath(new URL('../../../reference/p0/runs/oracle/', import.meta.url));

/** Corridas de referencia: semilla 12345, volcados al principio del tick y después de los eventos 0–14. */
const RUNS = [
  { run: 'p3-t1', tick: 1 },
  { run: 'p3-t50', tick: 50 },
];

/** Eventos portados, en orden; `rng` = el evento sortea (si no, se verifica que el registro no tenga sorteos). */
const EVENTS: { e: number; run: (s: CaianiState, rng: CaianiRng) => void }[] = [
  { e: 0, run: (s) => computeExpectationsEvent(s) },
  { e: 1, run: capitalPriceEvent },
  { e: 2, run: consumptionPriceEvent },
  { e: 3, run: capitalMarketFirstStepEvent },
  { e: 4, run: (s) => rdDecisionEvent(s) },
  { e: 5, run: investmentDemandEvent },
  { e: 6, run: creditSupplyEvent },
  { e: 7, run: depositSupplyEvent },
  { e: 8, run: (s) => depositInterestEvent(s) },
  { e: 9, run: (s) => creditDemandEvent(s) },
  { e: 10, run: creditMarketEvent },
];
const LAST = EVENTS[EVENTS.length - 1]!.e;

describe.each(RUNS)('V3 por evento contra el oráculo, tick $tick (reference/, fuera de git)', ({ run, tick }) => {
  const dir = `${ORACLE}${run}/state/`;
  const dumpOf = (name: string) => readDump(dir + name);
  const before = `tick-${tick}.jsonl`;
  const after = (e: number) => `tick-${tick}-ev-${e}.jsonl`;
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
  /** Registro de decisiones de cada modalidad (lo llenan los dos tests de abajo; vitest los corre en orden). */
  const single = new DecisionRecorder();
  const chained = new DecisionRecorder();

  it.skipIf(!available)('el estado reconstruido desde un volcado coincide con el volcado', () => {
    const d = dumpOf(before);
    const r = compareState(stateFromDump(d), d);
    expect(r.diffs).toEqual([]);
    expect(r.counts.maxAmountDiff).toBe(0);
  }, 120_000);

  it.skipIf(!available)(`cada evento desde el volcado anterior (0–${LAST})`, () => {
    for (const { e, run: ev } of EVENTS) {
      const s = stateFromDump(dumpOf(e === 0 ? before : after(e - 1)));
      const rng = drawsOf(e);
      withDecisions(single, e, () => ev(s, rng));
      expect(rng.remaining).toBe(0);
      check(s, after(e), `evento ${e}`);
    }
    console.log(`Decisiones, tick ${tick}, cada evento suelto:\n  ${summarizeDecisions(single.log).join('\n  ')}`);
  }, 120_000);

  it.skipIf(!available)(`eventos 0–${LAST} encadenados desde el principio del tick`, () => {
    const s = stateFromDump(dumpOf(before));
    for (const { e, run: ev } of EVENTS) {
      const rng = drawsOf(e);
      withDecisions(chained, e, () => ev(s, rng));
      expect(rng.remaining).toBe(0);
    }
    check(s, after(LAST), `eventos 0–${LAST}`);
    console.log(`Decisiones, tick ${tick}, encadenados:\n  ${summarizeDecisions(chained.log).join('\n  ')}`);
    // Decisiones que se dan vuelta entre el encadenado y el evento suelto (que arranca del estado de JMAB).
    const { flips, lengthMismatch } = compareOutcomes(single.log, chained.log);
    console.log(`Decisiones dadas vuelta, tick ${tick}: ${flips.length}`, JSON.stringify(flips.slice(0, 10)), lengthMismatch);
    expect(lengthMismatch).toEqual([]);
  }, 120_000);
});
