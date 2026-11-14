/**
 * P3: casos a mano (V2) de los eventos del tick. Registro en docs/reglas-caiani.md. El V3 contra el oráculo está en
 * caiani-v3.test.ts (desde el 2026-11-14).
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import {
  LAG,
  MKT,
  PrngCaianiRng,
  adaptiveMarkUpPrice,
  capitalMarketFirstStepEvent,
  capitalAttractiveness,
  investmentDemandEvent,
  adaptiveInterestRate,
  creditSupplyEvent,
  depositSupplyEvent,
  depositInterestEvent,
  creditDemandEvent,
  creditMarketEvent,
  laborDemandEvent,
  governmentLaborEvent,
  laborMarketEvent,
  productionEvent,
  rdOutcomeEvent,
  researchWorkers,
  consumptionDemandEvent,
  consumptionMarketEvent,
  capitalMarketSecondStepEvent,
  creditInterestsEvent,
  wagePaymentEvent,
  bondInterestEvent,
  advanceInterestEvent,
  taxesEvent,
  dividendsEvent,
  depositDemandEvent,
  depositMarketEvent,
  bankBankruptcyEvent,
  writeDown,
  toMicro,
  delistFromIssuer,
  installments,
  rawInstallments,
  closeContract,
  beginPeriod,
  assertFlows,
  assertLedger,
  desiredCapacityGrowth,
  setLag,
  pay,
  selectGoodSupplier,
  firstAsset,
  netFinancialWorth,
  toUnits,
  adaptiveWage,
  wageMicroReference,
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
  initialize,
  requiredWorkers,
  targetOutput,
  type CaianiRng,
  type CaianiState,
  type FirmState,
} from '../src/caiani';

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

  it('evento 8: cada depósito capitaliza su interés (saldo × tasa del contrato, con arrastre sobre la lista del banco); el depositante lo registra', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    const b = s.banks[0]!;
    const ids = contractIds(s.ledger, b.id, 'liabilities', 'deposit');
    const before = ids.map((id) => ({ ...contractOf(s.ledger, id) }));
    // Una tasa distinta en un contrato: se usa la del contrato, no la del banco.
    contractOf(s.ledger, ids[0]!).rate = 0.01;
    before[0]!.rate = 0.01;
    depositInterestEvent(s);
    let tot = 0;
    let acc = 0;
    ids.forEach((id, n) => {
      const c0 = before[n]!;
      // Arrastre: round(Σ hasta acá) − round(Σ hasta el anterior).
      const interest = Math.round(acc + c0.amount * c0.rate) - Math.round(acc);
      acc += c0.amount * c0.rate;
      expect(Math.abs(interest - c0.amount * c0.rate)).toBeLessThan(1);
      tot += interest;
      expect(contractOf(s.ledger, id).amount).toBe(c0.amount + interest);
    });
    expect(b.totInterestsDeposits).toBe(tot);
    const h = s.households.find((x) => x.id === before[0]!.holder)!;
    expect(h.interestReceived).toBe(Math.round(before[0]!.amount * 0.01)); // el primero de la lista: sin arrastre previo
    expect(Math.abs(tot - acc)).toBeLessThanOrEqual(0.5); // el total, a ≤ 0,5 µ de la suma en double
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

describe('eventos 11 a 14 (mercado de trabajo): casos a mano', () => {
  /**
   * Rng para seguir a mano: las mezclas no reordenan y se anotan (qué y de quién); las normales plegadas
   * salen de una lista fija; cualquier otro sorteo tira error.
   */
  function laborRng(log: string[], normals: number[] = []): CaianiRng {
    let k = 0;
    const no = () => {
      throw new Error('no se esperaba este sorteo');
    };
    return {
      foldedNormal: () => {
        log.push('fn');
        const x = normals[k++];
        if (x === undefined) throw new Error('no quedan normales');
        return x;
      },
      bernoulli: no,
      shuffle: <T,>(_site: string, what: string, items: T[]) => {
        log.push(what);
        return items;
      },
      shuffleEmployees: <T,>(_site: string, owner: number, items: T[]) => {
        log.push(`emp ${owner} (${items.length})`);
        return items;
      },
      sample: no,
      uniform01: no,
    };
  }

  /** Estado inicial en la ronda 5, con el rezago de ocupación de un hogar y el desempleo agregado de la ronda 4. */
  function wageState(employedPast: [number, number, number], aggregateUnemployment: number) {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 5;
    const h = s.households.find((x) => x.employer === null)!;
    h.lags[LAG.EMPLOYED] = { 4: employedPast[0], 3: employedPast[1], 2: employedPast[2] };
    s.aggregateLags[LAG.AGGUNEMPLOYMENT] = { 4: aggregateUnemployment };
    return { s, h };
  }

  it('evento 11, referencia micro: (1 + Σ ocupado en t−1..t−3) / 4 para el desocupado; 0 para el ocupado', () => {
    // Así está en JMAB (`averageUnemployment` arranca en 1 y suma rezagos de OCUPADO): desocupado los
    // cuatro trimestres → 1/4; trabajó uno de los tres anteriores → 2/4.
    expect(wageMicroReference(wageState([0, 0, 0], 0.1).s, wageState([0, 0, 0], 0.1).h)).toBe(0.25);
    const { s, h } = wageState([1, 0, 0], 0.1);
    expect(wageMicroReference(s, h)).toBe(0.5);
    const employed = s.households.find((x) => x.employer !== null)!;
    expect(wageMicroReference(s, employed)).toBe(0);
  });

  it('evento 11, salario: baja si la micro > 0,49; si no, sube si el desempleo agregado ≤ 0,08; piso 0', () => {
    // Recién despedido (micro 0,5): baja 5·0,01.
    let { s, h } = wageState([1, 0, 0], 0.5);
    h.wage = 5;
    expect(adaptiveWage(s, h, laborRng([], [0.01]))).toBe(5 - 1 * 5 * 0.01);
    // Desocupado de larga data (micro 0,25): referencia macro 0 ≤ 0,08 → SUBE (aunque el desempleo sea 50%).
    ({ s, h } = wageState([0, 0, 0], 0.5));
    h.wage = 5;
    expect(adaptiveWage(s, h, laborRng([], [0.01]))).toBe(5 + 1 * 5 * 0.01);
    // Ocupado: sube con desempleo 0,08 (igual al umbral) y queda igual, sin sorteo, con 0,0800001.
    ({ s } = wageState([0, 0, 0], 0.08));
    const e = s.households.find((x) => x.employer !== null)!;
    e.wage = 5;
    expect(adaptiveWage(s, e, laborRng([], [0.02]))).toBe(5 + 5 * 0.02);
    s.aggregateLags[LAG.AGGUNEMPLOYMENT] = { 4: 0.0800001 };
    const log: string[] = [];
    expect(adaptiveWage(s, e, laborRng(log))).toBe(5);
    expect(log).toEqual([]);
    // Piso: un paso mayor que 1 dejaría el salario negativo.
    ({ s, h } = wageState([1, 1, 1], 0.5));
    h.wage = 5;
    expect(adaptiveWage(s, h, laborRng([], [1.5]))).toBe(0);
  });

  it('evento 12: rotación (i < 0,05·N en double), demanda de trabajo y despidos del excedente con otra mezcla', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    computeExpectationsEvent(s); // producción deseada → 50 trabajadores requeridos por empresa de consumo
    const c = s.consumptionFirms[0]!;
    expect(c.employees.length).toBe(50);
    const first3 = c.employees.slice(0, 3);
    const rest = c.employees.slice(3);
    const log: string[] = [];
    laborDemandEvent({ ...s, consumptionFirms: [c], capitalFirms: [] }, laborRng(log));
    // 0,05·50 = 2,5: despide i = 0, 1, 2 (los primeros después de la mezcla, que acá no reordena).
    expect(log).toEqual([`emp ${c.id} (50)`]);
    expect(c.employees).toEqual(rest);
    for (const id of first3) {
      const h = s.households.find((x) => x.id === id)!;
      expect(h.employer).toBeNull();
      expect(h.active[MKT.LABOR]).toBe(true);
    }
    expect(c.laborDemand).toBe(3);
    expect(c.active[MKT.LABOR]).toBe(true);

    // Con 40 requeridos: rotación de 3 (quedan 47); 40 ≤ 47 → otra mezcla, inactiva, despide 47 − 40 = 7.
    const d = s.consumptionFirms[1]!;
    d.desiredOutput = 40 * 6.4; // 40 trabajadores con añadas de productividad 1 y capital/trabajo 6,4
    const log2: string[] = [];
    laborDemandEvent({ ...s, consumptionFirms: [d], capitalFirms: [] }, laborRng(log2));
    expect(log2).toEqual([`emp ${d.id} (50)`, `emp ${d.id} (47)`]);
    expect(d.employees.length).toBe(40);
    expect(d.laborDemand).toBe(0);
    expect(d.active[MKT.LABOR]).toBe(false);

    // 0,05·40 = 2 exacto en double: despide 2 (i = 0, 1), no 3.
    const k = s.capitalFirms[0]!;
    k.employees = k.employees.slice(0, 40);
    const before = k.employees.length;
    k.desiredOutput = 2 * 100; // 100 requeridos
    laborDemandEvent({ ...s, consumptionFirms: [], capitalFirms: [k] }, laborRng([]));
    expect(before).toBe(40);
    expect(k.employees.length).toBe(38);
    expect(k.laborDemand).toBe(62);
  });

  it('evento 13: el gobierno mezcla aunque no tenga empleados y pide los 1.360', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const log: string[] = [];
    governmentLaborEvent(s, laborRng(log));
    expect(log).toEqual([`emp ${s.government.id} (0)`]);
    expect(s.government.laborDemand).toBe(1360);
    expect(s.government.active[MKT.LABOR]).toBe(true);
  });

  it('evento 14: la empresa contrata al más barato de los 10 primeros activos; el gobierno, min(demanda, vistos); rondas hasta cerrar', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    for (const f of [...s.consumptionFirms, ...s.capitalFirms]) f.active[MKT.LABOR] = false;
    for (const h of s.households) h.active[MKT.LABOR] = false;
    s.government.active[MKT.LABOR] = false;
    // Cerrado: nadie activo, ni una mezcla.
    const log0: string[] = [];
    laborMarketEvent(s, laborRng(log0));
    expect(log0).toEqual([]);

    // 12 desocupados activos (en el orden de la lista del mercado); el 3.º es el más barato de los 10
    // primeros; el 11.º, más barato todavía, no llega a verse.
    const sellers = s.markets.labor.sellers;
    const free = sellers.slice(0, 12).map((id) => s.households.find((x) => x.id === id)!);
    for (const [i, h] of free.entries()) {
      h.employer = null;
      h.active[MKT.LABOR] = true;
      h.wage = i === 2 ? 4 : i === 10 ? 3 : 5;
    }
    const c = s.consumptionFirms[0]!;
    c.active[MKT.LABOR] = true;
    c.laborDemand = 1;
    const n0 = c.employees.length;
    const log: string[] = [];
    laborMarketEvent(s, laborRng(log));
    // Ronda 1: mezcla compradores y vendedores; contrata al 3.º y queda inactiva (demanda 0): cerrado.
    expect(log).toEqual(['buyers', 'sellers']);
    expect(c.employees.length).toBe(n0 + 1);
    expect(c.employees[n0]).toBe(free[2]!.id);
    expect(free[2]!.employer).toBe(c.id);
    expect(free[2]!.active[MKT.LABOR]).toBe(false);
    expect(c.laborDemand).toBe(0);
    expect(c.active[MKT.LABOR]).toBe(false);

    // Gobierno con demanda 15: ve 10 (de los 11 activos que quedan) y contrata a los 10 (la mezcla de la copia
    // no reordena acá); ronda 2: ve 1 y lo contrata; ronda 3: sin vendedores activos, cerrado. Demanda 4.
    const g = s.government;
    g.active[MKT.LABOR] = true;
    g.laborDemand = 15;
    const log2: string[] = [];
    laborMarketEvent(s, laborRng(log2));
    expect(log2).toEqual(['buyers', 'sellers', 'workers', 'buyers', 'sellers', 'workers']);
    expect(g.employees.length).toBe(11);
    expect(g.laborDemand).toBe(4);
    expect(g.active[MKT.LABOR]).toBe(true); // sigue activo: el mercado se cerró por falta de vendedores
  });
});

describe('evento 15 (producción): casos a mano', () => {
  it('consumo: añadas de la más productiva a la menos, fracción de la última; costo unitario; rezagos', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const c = s.consumptionFirms[0]!;
    // 20 añadas de 20 unidades, productividad 1, capital/trabajo 6,4 (3,125 trabajadores cada una).
    // 47 empleados: 15 añadas enteras (46,875 trabajadores, 300 unidades) y 0,125·6,4 = 0,8 de la 16.ª.
    c.employees = c.employees.slice(0, 47);
    for (const [i, id] of c.employees.entries()) s.households.find((h) => h.id === id)!.wage = i < 40 ? 5 : 6;
    const inv0 = c.consumptionGoods[0]!.quantity;
    let amort = 0;
    let cap = 0;
    for (const g of c.capitalGoods) {
      amort += (g.price * g.quantity) / g.amortization;
      cap += g.value;
    }
    productionEvent({ ...s, capitalFirms: [] });
    expect(c.consumptionGoods[0]!.quantity).toBe(inv0 + (300 + 6.4 * (47 - 46.875)));
    expect(c.consumptionGoods[0]!.unitCost).toBe((amort + (40 * 5 + 7 * 6)) / (300 + 6.4 * (47 - 46.875)));
    expect(c.lags[LAG.PRODUCTION]![1]).toBe(300 + 6.4 * (47 - 46.875));
    expect(c.lags[LAG.CAPACITY]![1]).toBe(400);
    expect(c.lags[LAG.CAPITALFINANCIALVALUE]![1]).toBe(cap);
    expect(c.active[MKT.CONSGOOD]).toBe(true);
    // Una añada más productiva se usa primero: con productividad 2 en la última de la lista y 3,125
    // trabajadores, produce 40 con ellos aunque esté al final.
    const d = s.consumptionFirms[1]!;
    d.capitalGoods[19]!.productivity = 2;
    d.employees = d.employees.slice(0, 4); // 3,125 en la de productividad 2 (40) y 0,875 en la primera (5,6)
    const q0 = d.consumptionGoods[0]!.quantity;
    productionEvent({ ...s, consumptionFirms: [d], capitalFirms: [] });
    expect(d.consumptionGoods[0]!.quantity).toBeCloseTo(q0 + 40 + 0.875 * 6.4, 12);
  });

  it('consumo sin empleados: no produce, el costo unitario no cambia, inactiva si no tiene inventario', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const c = s.consumptionFirms[0]!;
    for (const id of c.employees) s.households.find((h) => h.id === id)!.employer = null;
    c.employees = [];
    c.consumptionGoods[0]!.quantity = 0;
    const uc = c.consumptionGoods[0]!.unitCost;
    productionEvent({ ...s, capitalFirms: [] });
    expect(c.lags[LAG.PRODUCTION]![1]).toBe(0);
    expect(c.lags[LAG.CAPACITY]![1]).toBe(400);
    expect(c.consumptionGoods[0]!.unitCost).toBe(uc);
    expect(c.active[MKT.CONSGOOD]).toBe(false);
  });

  it('capital: requeridos × 2; con demanda de trabajo sin cubrir, empleados × 2; valor contable recalculado', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const k = s.capitalFirms[0]!;
    const inv = k.capitalGoods[0]!;
    const q0 = inv.quantity;
    k.desiredOutput = 81; // round(40,5) = 41 trabajadores → 82
    k.laborDemand = 0;
    for (const id of k.employees) s.households.find((h) => h.id === id)!.wage = 5;
    productionEvent({ ...s, consumptionFirms: [], capitalFirms: [k] });
    expect(inv.quantity).toBe(q0 + 82);
    expect(inv.unitCost).toBe((k.employees.length * 5) / 82);
    expect(inv.value).toBe(inv.price * inv.quantity * (1 - inv.age / inv.amortization)); // CapitalGood.setQuantity
    // Restringida (le faltan trabajadores), sin I+D: 41/41 = 1 → produce con los 50 que tiene: 100.
    k.laborDemand = 3;
    const q1 = inv.quantity;
    productionEvent({ ...s, consumptionFirms: [], capitalFirms: [k] });
    expect(inv.quantity).toBe(q1 + 2 * k.employees.length);
    // Con I+D > 0 la división entera de JMAB da 41 / (41 + 1) = 0: no produce (la I+D está apagada en el base).
    k.amountResearch = 5;
    k.expectations[EXPECTATION.WAGES]!.expectation = 5;
    const q2 = inv.quantity;
    productionEvent({ ...s, consumptionFirms: [], capitalFirms: [k] });
    expect(inv.quantity).toBe(q2);
    expect(inv.unitCost).toBe(Infinity); // masa salarial / 0, como Java
  });
});

describe('evento 16 (resultado de la I+D): casos a mano', () => {
  it('sin I+D: sin investigadores ni sorteos; el inventario recalcula su valor contable y toma la productividad', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const k = s.capitalFirms[0]!;
    const inv = k.capitalGoods[0]!;
    inv.price = 2.7; // un precio nuevo (evento 1) que todavía no entró al valor contable
    const q = inv.quantity;
    rdOutcomeEvent({ ...s, consumptionFirms: [], capitalFirms: [k] });
    expect(researchWorkers(s, k)).toBe(0);
    expect(k.capitalProductivity).toBe(1);
    expect(inv.productivity).toBe(1);
    expect(inv.quantity).toBe(q * (1 - 0)); // inventoriesLostShare = 0
    expect(inv.value).toBe(2.7 * q * (1 - inv.age / inv.amortization)); // CapitalGood.setQuantity
  });

  it('investigadores: ⌊I+D / wᵉ⌋; con demanda de trabajo sin cubrir, empleados − entero(requeridos·empleados / total)', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const k = s.capitalFirms[0]!;
    const w = k.expectations[EXPECTATION.WAGES]!.expectation; // 5
    k.amountResearch = 2.5 * w; // ⌊2,5⌋ = 2
    k.laborDemand = 0;
    expect(researchWorkers(s, k)).toBe(2);
    // Restringida: requeridos round(20/2) = 10, total 12, 8 empleados → producir ⌊80/12⌋ = 6, investigar 2.
    k.desiredOutput = 20;
    k.laborDemand = 4;
    k.employees = k.employees.slice(0, 8);
    expect(researchWorkers(s, k)).toBe(8 - Math.trunc(80 / 12));
    // Con investigadores, el resultado (Bernoulli y Beta) no está portado: error explícito.
    expect(() => rdOutcomeEvent({ ...s, consumptionFirms: [], capitalFirms: [k] })).toThrow(/no está portado/);
  });
});

describe('evento 17 (demanda de consumo): casos a mano', () => {
  it('ocupado y desocupado: ingreso neto, rezagos, demanda c₁·Y/pᵉ + c₂·W/pᵉ y bandera del mercado', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const employed = s.households.filter((h) => h.employer !== null);
    const emp = employed[0]!;
    const unemp = s.households.find((h) => h.employer === null)!;
    // Salarios: todos 5 salvo dos ocupados con 6 (y uno de ellos es `emp`). Salario medio de los ocupados:
    employed[0]!.wage = 6;
    employed[1]!.wage = 6;
    const n = employed.length;
    const avg = (5 * (n - 2) + 12) / n;
    emp.interestReceived = 100_000; // 0,1
    emp.dividendsReceived = 200_000; // 0,2
    unemp.interestReceived = 0;
    unemp.dividendsReceived = 500_000; // 0,5
    const pe = emp.expectations[EXPECTATION.CONSPRICE]!.expectation;
    const wEmp = toUnits(netFinancialWorth(s.ledger, emp.id));
    const wUnemp = toUnits(netFinancialWorth(s.ledger, unemp.id));
    consumptionDemandEvent(s);
    // Ocupado: bruto 6 + 0,1 + 0,2 = 6,3; impuestos 18% = 1,134; neto 5,166.
    expect(emp.lags[LAG.INCOME]![1]).toBeCloseTo(5.166, 12);
    expect(emp.demand).toBeCloseTo(0.385808 * (5.166 / pe) + 0.25 * (wEmp / pe), 12);
    expect(emp.lags[LAG.CONSUMPTION]![1]).toBe(emp.demand);
    expect(emp.active[MKT.CONSGOOD]).toBe(true);
    // Desocupado: seguro 0,4 × salario medio; bruto 0,5 (dividendos); impuestos 0,09.
    const yU = 0.4 * avg + 0.5 - 0.09;
    expect(unemp.lags[LAG.INCOME]![1]).toBeCloseTo(yU, 12);
    expect(unemp.demand).toBeCloseTo(0.385808 * (yU / pe) + 0.25 * (wUnemp / pe), 12);
  });

  it('demanda 0 no activa al hogar en el mercado de consumo (y no apaga una bandera ya prendida)', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const [h, g] = [s.households[0]!, s.households[1]!];
    h.expectations[EXPECTATION.CONSPRICE]!.expectation = Infinity; // Y/∞ + W/∞ = 0
    g.expectations[EXPECTATION.CONSPRICE]!.expectation = Infinity;
    g.active[MKT.CONSGOOD] = true;
    consumptionDemandEvent({ ...s, households: [h, g] });
    expect(h.demand).toBe(0);
    expect(h.active[MKT.CONSGOOD]).toBe(false);
    expect(g.active[MKT.CONSGOOD]).toBe(true);
  });
});

describe('evento 18 (mercado de consumo): casos a mano', () => {
  /** Rng que devuelve una secuencia fija de Bernoulli (y falla con cualquier otro sorteo). */
  const fixedBernoulli = (xs: boolean[]): CaianiRng => {
    let k = 0;
    const no = () => {
      throw new Error('no se esperaba este sorteo');
    };
    return { foldedNormal: no, bernoulli: () => xs[k++]!, shuffle: no, shuffleEmployees: no, sample: no, uniform01: no };
  };

  it('proveedor: el más barato; previo inactivo → cambia sin sortear; previo más caro → Bernoulli; previo igual de barato → se queda', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    const [a, b, c] = [s.consumptionFirms[0]!, s.consumptionFirms[1]!, s.consumptionFirms[2]!];
    a.consumptionGoods[0]!.price = 1.3;
    b.consumptionGoods[0]!.price = 1.2;
    c.consumptionGoods[0]!.price = 1.25;
    for (const f of [a, b, c]) f.active[MKT.CONSGOOD] = true;
    const h = s.households[0]!;
    // Previo inactivo: precio +∞, cambia al más barato (b) sin sortear.
    h.previousSeller = c.id;
    c.active[MKT.CONSGOOD] = false;
    expect(selectGoodSupplier(s, h, [a.id, b.id], fixedBernoulli([]))).toBe(b.id);
    // Previo activo y más caro (a, 1,3 > 1,2): Bernoulli con p = 1 − e^{λ(1,2 − 1,3)/1,2}; si sale falso, se queda.
    h.previousSeller = a.id;
    expect(selectGoodSupplier(s, h, [c.id, b.id], fixedBernoulli([false]))).toBe(a.id);
    expect(selectGoodSupplier(s, h, [c.id, b.id], fixedBernoulli([true]))).toBe(b.id);
    // Previo igual de barato que el mejor visto (otra empresa con el mismo precio): no es más caro, se queda.
    c.active[MKT.CONSGOOD] = true;
    c.consumptionGoods[0]!.price = 1.2;
    h.previousSeller = c.id;
    expect(selectGoodSupplier(s, h, [a.id, b.id], fixedBernoulli([]))).toBe(c.id);
  });

  /** Estado inicial con un solo hogar y una sola empresa activos en el mercado de consumo. */
  const oneBuyerOneSeller = (demand: number, inventory: number) => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    for (const h of s.households) h.active[MKT.CONSGOOD] = false;
    for (const f of s.consumptionFirms) f.active[MKT.CONSGOOD] = false;
    const h = s.households[0]!;
    const c = s.consumptionFirms[3]!;
    h.active[MKT.CONSGOOD] = true;
    h.demand = demand;
    h.previousSeller = s.consumptionFirms[0]!.id; // inactivo: cambia a c sin sortear
    c.active[MKT.CONSGOOD] = true;
    c.consumptionGoods[0]!.price = 1.25;
    c.consumptionGoods[0]!.quantity = inventory;
    const hDep = firstAsset(s.ledger, h.id, 'deposit')!;
    const cDep = firstAsset(s.ledger, c.id, 'deposit')!;
    return { s, h, c, hDep, cDep, h0: hDep.amount, c0: cDep.amount };
  };

  it('compra la demanda entera: paga cantidad × precio, recibe el bien, queda inactivo; la empresa cobra', () => {
    const { s, h, c, hDep, cDep, h0, c0 } = oneBuyerOneSeller(2, 100);
    expect(h0).toBeGreaterThan(2_500_000);
    const r = consumptionMarketEvent(s, new PrngCaianiRng(Rng.fromSeed(3)));
    expect(r.payments).toBe(1);
    expect(hDep.amount).toBe(h0 - 2_500_000); // 2 × 1,25, un monto entero de µ: exacto
    expect(cDep.amount).toBe(c0 + 2_500_000);
    expect(h.consumptionGoods).toEqual([{ quantity: 2, value: 2.5, price: 1.25, unitCost: 0, age: 0, producer: c.id, duration: c.consumptionGoods[0]!.duration }]);
    expect(c.consumptionGoods[0]!.quantity).toBe(98);
    expect(h.demand).toBe(0);
    expect(h.active[MKT.CONSGOOD]).toBe(false);
    expect(h.previousSeller).toBe(c.id);
    expect(c.active[MKT.CONSGOOD]).toBe(true);
  });

  it('depósito insuficiente: compra ⌊depósito / precio⌋ y queda inactivo', () => {
    const { s, h, hDep, h0 } = oneBuyerOneSeller(1e9, 1e12);
    consumptionMarketEvent(s, new PrngCaianiRng(Rng.fromSeed(3)));
    const q = Math.floor(toUnits(h0) / 1.25);
    expect(h.consumptionGoods[0]!.quantity).toBe(q);
    expect(hDep.amount).toBe(h0 - q * 1_250_000);
    expect(hDep.amount).toBeLessThan(1_250_000);
    expect(h.demand).toBe(1e9 - q);
    expect(h.active[MKT.CONSGOOD]).toBe(false);
  });

  it('la empresa se queda sin inventario: vende lo que tiene, queda inactiva; el hogar sigue activo y el mercado se cierra', () => {
    const { s, h, c, hDep, h0 } = oneBuyerOneSeller(2, 1.5);
    consumptionMarketEvent(s, new PrngCaianiRng(Rng.fromSeed(3)));
    expect(h.consumptionGoods[0]!.quantity).toBe(1.5);
    expect(hDep.amount).toBe(h0 - 1_875_000);
    expect(c.consumptionGoods[0]!.quantity).toBe(0);
    expect(c.active[MKT.CONSGOOD]).toBe(false);
    expect(h.demand).toBe(0.5);
    expect(h.active[MKT.CONSGOOD]).toBe(true);
  });
});

describe('evento 19 (segunda etapa del mercado de capital): casos a mano', () => {
  /**
   * Una empresa de consumo con una sola añada (100 unidades, productividad 1, edad 5) y rezagos del período
   * anterior con OCF/K = cf* (el término del flujo de caja da 0) y Yᵈ / capacidad = 4,8: g = 0,02·(4,8 − 0,8)/0,8.
   */
  const setup = () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    for (const f of s.consumptionFirms) f.active[MKT.CAPGOOD] = false;
    const c = s.consumptionFirms[0]!;
    c.active[MKT.CAPGOOD] = true;
    const proto = c.capitalGoods[0]!;
    c.capitalGoods = [{ ...proto, quantity: 100, productivity: 1, age: 5, obsolete: false }];
    c.desiredOutput = 480;
    c.desiredRealCapitalDemand = 1; // > 0: entra al lazo (se recalcula con el proveedor elegido)
    setLag(c.lags, LAG.CAPITALFINANCIALVALUE, 0, 1);
    setLag(c.lags, LAG.OPERATINGCASHFLOW, 0, RULES.investmentTargetCashFlow);
    const [k0, k1, k2] = [s.capitalFirms[0]!, s.capitalFirms[1]!, s.capitalFirms[2]!];
    const inv = (k: FirmState, price: number, quantity: number) => {
      const g = k.capitalGoods[0]!;
      g.price = price;
      g.quantity = quantity;
      g.productivity = 1;
      g.capitalLaborRatio = proto.capitalLaborRatio;
      k.active[MKT.CAPGOOD] = quantity > 0;
    };
    inv(k0, 2.5, 3); // el previo: activo, menos atractivo que k1 y k2 (más caro), no está en la lista
    inv(k1, 2, 50);
    inv(k2, 1.5, 0); // el más atractivo, pero sin inventario (inactivo)
    c.previousCapitalSupplier = k0.id;
    c.selectedCapitalSuppliers = [k1.id, k2.id];
    const dep = (id: number) => firstAsset(s.ledger, id, 'deposit')!;
    return { s, c, k0, k1, k2, dep };
  };

  it('crecimiento deseado: término de capacidad, piso −1 y sin capacidad', () => {
    const { s, c } = setup();
    const g = (0.02 * (480 / 100 - 0.8)) / 0.8; // el término del flujo de caja es 0 exacto
    expect(desiredCapacityGrowth(s, c)).toBe(g);
    expect(g).toBeCloseTo(0.1, 15);
    setLag(c.lags, LAG.OPERATINGCASHFLOW, 0, -1e6); // flujo de caja muy negativo: piso −1
    expect(desiredCapacityGrowth(s, c)).toBe(-1);
    setLag(c.lags, LAG.OPERATINGCASHFLOW, 0, RULES.investmentTargetCashFlow);
    c.capitalGoods = [];
    expect(desiredCapacityGrowth(s, c)).toBe(-1);
  });

  it('compra al previo (fuera de la lista) hasta agotarlo; después elige de la lista: el sin inventario se saca sin comprar, y compra el resto al siguiente', () => {
    const { s, c, k0, k1, k2, dep } = setup();
    const [c0, a0, b0] = [dep(c.id).amount, dep(k0.id).amount, dep(k1.id).amount];
    const r = capitalMarketSecondStepEvent(s, new PrngCaianiRng(Rng.fromSeed(3)));
    // 1.ª vuelta: previo k0 activo, menos atractivo, p = 0 (pago): se queda. Demanda round(100·g) = 10; k0 tiene 3.
    // 2.ª: k0 inactivo → el más atractivo de la lista (k2, inactivo y sin inventario): demanda
    //      round(110 − 103) = 7, compra 0, se lo saca. 3.ª: k2 inactivo → k1: compra 7. Lista vacía: termina.
    expect(c.capitalGoods.slice(1)).toEqual([
      { quantity: 3, value: 7.5, price: 2.5, unitCost: 0, age: -1, producer: k0.id, productivity: 1, duration: k0.capitalGoods[0]!.duration, amortization: k0.capitalGoods[0]!.amortization, capitalLaborRatio: c.capitalGoods[0]!.capitalLaborRatio, obsolete: false },
      { quantity: 7, value: 14, price: 2, unitCost: 0, age: -1, producer: k1.id, productivity: 1, duration: k1.capitalGoods[0]!.duration, amortization: k1.capitalGoods[0]!.amortization, capitalLaborRatio: c.capitalGoods[0]!.capitalLaborRatio, obsolete: false },
    ]);
    expect(c.selectedCapitalSuppliers).toEqual([]);
    expect(c.previousCapitalSupplier).toBe(k1.id);
    expect(c.desiredRealCapitalDemand).toBe(0);
    expect(c.active[MKT.CAPGOOD]).toBe(false);
    expect(c.desiredCapacityGrowth).toBe((0.02 * (480 / 100 - 0.8)) / 0.8);
    expect(r.payments).toBe(2);
    expect(dep(c.id).amount).toBe(c0 - 21_500_000);
    expect(dep(k0.id).amount).toBe(a0 + 7_500_000);
    expect(dep(k1.id).amount).toBe(b0 + 14_000_000);
    // Inventarios: CapitalGood.setQuantity recalcula el valor contable.
    const g1 = k1.capitalGoods[0]!;
    expect(g1.quantity).toBe(43);
    expect(g1.value).toBe(2 * 43 * (1 - g1.age / g1.amortization));
    expect(k0.capitalGoods[0]!.quantity).toBe(0);
    expect(k0.active[MKT.CAPGOOD]).toBe(false);
    expect(k1.active[MKT.CAPGOOD]).toBe(true);
    expect(k2.capitalGoods[0]!.quantity).toBe(0);
  });

  it('el previo está en la lista: se lo saca; una empresa inactiva en capital no hace nada', () => {
    const { s, c, k1, k2 } = setup();
    c.previousCapitalSupplier = k1.id; // activo y con inventario para toda la demanda
    k2.capitalGoods[0]!.price = 2.5; // ahora k1 es también el más atractivo
    const other = s.consumptionFirms[1]!;
    const before = JSON.stringify(other);
    capitalMarketSecondStepEvent(s, new PrngCaianiRng(Rng.fromSeed(3)));
    expect(c.capitalGoods.slice(1).map((g) => [g.producer, g.quantity])).toEqual([[k1.id, 10]]);
    expect(c.selectedCapitalSuppliers).toEqual([k2.id]);
    expect(JSON.stringify(other)).toBe(before);
  });

  it('reallocateLiquidity: si el primer depósito no alcanza, pasa lo que falta desde el segundo (otro banco) y paga', () => {
    const { s, c, k0, dep } = setup();
    c.selectedCapitalSuppliers = [k0.id];
    k0.capitalGoods[0]!.quantity = 100; // compra la demanda entera (10 × 2,5 = 25)
    const L = s.ledger;
    const d0 = dep(c.id);
    const otherBank = s.banks.find((b) => b.id !== d0.issuer)!;
    const d1id = open(L, 'deposit', c.id, otherBank.id, 0, { rate: 0 }, 'deposits');
    pay(L, d0.id, d1id, d0.amount - 1_000_000, 'deposits'); // queda 1 en el primero
    const total0 = d0.amount + contractOf(L, d1id).amount;
    const r1 = contractIds(L, otherBank.id, 'assets', 'reserves').map((id) => contractOf(L, id).amount)[0]!;
    capitalMarketSecondStepEvent(s, new PrngCaianiRng(Rng.fromSeed(3)));
    expect(c.capitalGoods.slice(1).map((g) => g.quantity)).toEqual([10]);
    // Del segundo depósito pasan 24 al primero; el primero paga 25 y queda en 0 (la empresa queda inactiva).
    expect(d0.amount).toBe(0);
    expect(contractOf(L, d1id).amount).toBe(total0 - 1_000_000 - 24_000_000);
    expect(contractOf(L, contractIds(L, otherBank.id, 'assets', 'reserves')[0]!).amount).toBe(r1 - 24_000_000);
    expect(c.active[MKT.CAPGOOD]).toBe(false);
  });

  it('con el efectivo de la empresa distinto de 0 y el primer depósito corto: error explícito (rama no portada)', () => {
    const { s, c, dep } = setup();
    const L = s.ledger;
    const d0 = dep(c.id);
    const otherBank = s.banks.find((b) => b.id !== d0.issuer)!;
    const d1id = open(L, 'deposit', c.id, otherBank.id, 0, { rate: 0 }, 'deposits');
    pay(L, d0.id, d1id, d0.amount, 'deposits');
    contractOf(L, contractIds(L, c.id, 'assets', 'cash')[0]!).amount = 1_000_000; // solo para el caso
    expect(() => capitalMarketSecondStepEvent(s, new PrngCaianiRng(Rng.fromSeed(3)))).toThrow(/reallocateLiquidity con efectivo/);
  });

  it('depósito insuficiente (con una sola cuenta): compra ⌊depósito / precio⌋ y queda inactiva', () => {
    const { s, c, k0, k1, dep } = setup();
    c.selectedCapitalSuppliers = [k1.id];
    k0.capitalGoods[0]!.quantity = 100;
    const L = s.ledger;
    const d0 = dep(c.id);
    expect(contractIds(L, c.id, 'assets', 'deposit')).toHaveLength(1);
    // Deja 6,1 en el depósito (lo demás va a la cuenta de otro agente del mismo banco).
    const sink = s.consumptionFirms.slice(1).map((f) => dep(f.id)).find((d) => d.issuer === d0.issuer)!;
    pay(L, d0.id, sink.id, d0.amount - 6_100_000, 'deposits');
    capitalMarketSecondStepEvent(s, new PrngCaianiRng(Rng.fromSeed(3)));
    expect(c.capitalGoods.slice(1).map((g) => [g.producer, g.quantity])).toEqual([[k0.id, 2]]); // ⌊6,1 / 2,5⌋
    expect(d0.amount).toBe(1_100_000);
    expect(c.active[MKT.CAPGOOD]).toBe(false);
    expect(c.desiredRealCapitalDemand).toBe(8);
  });
});

describe('evento 20 (servicio de la deuda): casos a mano', () => {
  /** Las demás empresas, sin cuotas este tick (edad 0): no mueven nada. */
  const quietOthers = (s: CaianiState, keep: FirmState) => {
    for (const f of [...s.consumptionFirms, ...s.capitalFirms]) {
      if (f === keep) continue;
      for (const id of contractIds(s.ledger, f.id, 'liabilities', 'loan')) contractOf(s.ledger, id).age = 0;
    }
  };
  const reserves = (s: CaianiState, b: number) => contractOf(s.ledger, contractIds(s.ledger, b, 'assets', 'reserves')[0]!).amount;

  it('junta los dos depósitos en el primero y paga las cuotas de JMAB en double, con redondeo controlado; debtBurden de installments', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    const L = s.ledger;
    const c = s.consumptionFirms[0]!;
    quietOthers(s, c);
    const d0 = firstAsset(L, c.id, 'deposit')!;
    const otherBank = s.banks.find((b) => b.id !== d0.issuer)!;
    const d1 = open(L, 'deposit', c.id, otherBank.id, 0, { rate: 0 }, 'deposits');
    pay(L, d0.id, d1, 10_000_000, 'deposits');
    const total = d0.amount + contractOf(L, d1).amount;
    const loans = contractIds(L, c.id, 'liabilities', 'loan');
    const dues = installments(L, c.id, 'loan');
    const raw = rawInstallments(L, c.id, 'loan');
    const burden = dues.reduce((a, d) => a + d.interest + d.principal, 0);
    const rawTotal = raw.reduce((a, d) => a + d.interest + d.principal, 0);
    const before = loans.map((id) => contractOf(L, id).amount);
    expect(burden).toBeGreaterThan(0);
    const cp = beginPeriod(L);
    const report = creditInterestsEvent(s);
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(report.payments).toBe(1 + 2 * loans.length); // el traspaso del segundo depósito, interés y capital por préstamo
    expect(contractOf(L, d1).amount).toBe(0);
    // Lo que paga la empresa queda a < 1 µ de la suma de JMAB en double; cada préstamo, a < 1 µ de su capital.
    expect(Math.abs(total - d0.amount - rawTotal)).toBeLessThan(1);
    loans.forEach((id, i) => expect(Math.abs(before[i]! - contractOf(L, id).amount - raw[i]!.principal)).toBeLessThan(1));
    expect(c.debtBurden).toBe(burden);
    expect(c.debtInterests).toBe(dues.reduce((a, d) => a + d.interest, 0));
  });

  it('préstamo de otro banco: las reservas pasan del banco del depósito al prestamista (a < 1 µ de la suma en double)', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    const L = s.ledger;
    const c = s.consumptionFirms[0]!;
    const d0 = firstAsset(L, c.id, 'deposit')!;
    const lender = s.banks.find((b) => b.id !== d0.issuer)!;
    // Un préstamo de 20 a 20 trimestres, edad 1, tasa 0,01, del otro banco: cuota 0,2 de interés + 1 de capital.
    const loan = open(L, 'loan', lender.id, c.id, 20_000_000, { rate: 0.01, length: 20, amortization: 'fixedCapital', age: 1, initialAmount: 20_000_000 }, 'loans');
    const [rd, rl] = [reserves(s, d0.issuer), reserves(s, lender.id)];
    const raw = rawInstallments(L, c.id, 'loan');
    expect(raw[raw.length - 1]).toEqual({ interest: 200_000, principal: 1_000_000, exactPrincipal: false });
    const ids = contractIds(L, c.id, 'liabilities', 'loan');
    const toLender = ids.reduce((a, id, i) => a + (contractOf(L, id).holder === lender.id ? raw[i]!.interest + raw[i]!.principal : 0), 0);
    const out = ids.reduce((a, id, i) => a + (contractOf(L, id).holder !== d0.issuer ? raw[i]!.interest + raw[i]!.principal : 0), 0);
    quietOthers(s, c);
    creditInterestsEvent(s);
    expect(contractOf(L, loan).amount).toBe(19_000_000);
    expect(toLender).toBeGreaterThanOrEqual(1_200_000);
    expect(Math.abs(reserves(s, lender.id) - (rl + toLender))).toBeLessThan(1);
    expect(Math.abs(reserves(s, d0.issuer) - (rd - out))).toBeLessThan(1);
  });

  /**
   * Quiebra de una empresa de consumo por el servicio de la deuda. La empresa queda con dos préstamos (30 del banco
   * de su depósito y 10 de otro, edad 1, tasa 0,01, 20 trimestres: servicio 0,3 + 1,5 + 0,1 + 0,5 = 2,4), 1 en el
   * primer depósito y 0,9 en un segundo depósito en el otro banco (liquidez 1,9 < 2,4), y una añada de valor 20.
   */
  const bankruptConsumptionFirm = (capitalValue: number) => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const L = s.ledger;
    const c = s.consumptionFirms[0]!;
    quietOthers(s, c);
    for (const id of [...contractIds(L, c.id, 'liabilities', 'loan')]) {
      contractOf(L, id).amount = 0; // fuera del caso (sin flujos: el caso arranca de este estado)
      closeContract(L, id);
    }
    const d0 = firstAsset(L, c.id, 'deposit')!;
    const other = s.banks.find((b) => b.id !== d0.issuer)!;
    const terms = { rate: 0.01, length: 20, amortization: 'fixedCapital' as const, age: 1 };
    const loanA = open(L, 'loan', d0.issuer, c.id, 30_000_000, { ...terms, initialAmount: 30_000_000 }, 'loans');
    const loanB = open(L, 'loan', other.id, c.id, 10_000_000, { ...terms, initialAmount: 10_000_000 }, 'loans');
    const d1 = open(L, 'deposit', c.id, other.id, 0, { rate: 0 }, 'deposits');
    pay(L, d0.id, d1, 900_000, 'deposits');
    pay(L, d0.id, firstAsset(L, s.consumptionFirms[1]!.id, 'deposit')!.id, d0.amount - 1_000_000, 'deposits');
    c.capitalGoods = [{ ...c.capitalGoods[0]!, quantity: 20, value: capitalValue }];
    return { s, L, c, d0, d1, loanA, loanB, bankA: bankById(s, d0.issuer), bankB: bankById(s, other.id) };
  };
  const bankById = (s: CaianiState, id: number) => s.banks.find((b) => b.id === id)!;

  it('quiebra de una empresa de consumo: reparto de la liquidez por restos mayores, aporte de los dueños, quitas', () => {
    const { s, L, c, d0, d1, loanA, loanB, bankA, bankB } = bankruptConsumptionFirm(20);
    const hDeps = s.households.map((h) => firstAsset(L, h.id, 'deposit')!);
    const w = hDeps[0]!.amount / 1e6; // todos los hogares arrancan con el mismo depósito y sin bienes
    expect(new Set(hDeps.map((d) => d.amount)).size).toBe(1);
    const hBefore = hDeps.reduce((a, d) => a + d.amount, 0);
    const [nplA, nplB] = [bankA.currentNonPerformingLoans, bankB.currentNonPerformingLoans];
    const cp = beginPeriod(L);
    creditInterestsEvent(s);
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(assertLedger(L)).toBeUndefined();
    expect(c.defaulted).toBe(true);
    // Liquidez 1,9 en proporción a 30 y 10: 1,425 y 0,475 (restos 0). El depósito queda en 0; el segundo, en 0, sigue
    // en la lista de la empresa y sale de la del banco.
    expect(d0.amount).toBe(0);
    expect(contractIds(L, c.id, 'assets', 'deposit')).toEqual([d0.id, d1]);
    expect(contractOf(L, d1)).toMatchObject({ amount: 0, delisted: true });
    expect(contractIds(L, bankB.id, 'liabilities', 'deposit')).not.toContain(d1);
    // Pérdida de los bancos 28,575 + 9,525 = 38,1; D = min(0,5 × 20, 38,1) = 10.
    expect(c.bailoutCost).toBe(10_000_000);
    // Los préstamos quedan en 0; lo que no cubrieron la liquidez ni los hogares va a la morosidad del prestamista.
    expect(contractOf(L, loanA).amount).toBe(0);
    expect(contractOf(L, loanB).amount).toBe(0);
    const lossA = bankA.currentNonPerformingLoans - nplA;
    const lossB = bankB.currentNonPerformingLoans - nplB;
    const households = hBefore - hDeps.reduce((a, d) => a + d.amount, 0);
    expect(1_425_000 + 475_000 + households + lossA + lossB).toBe(40_000_000);
    // Primer hogar (todos con patrimonio w, W = 8.000·w): paga 10·w/W·28,575/38,1 = 0,0009375 al préstamo A y,
    // con su patrimonio y las pérdidas ya actualizados, 10·(w − 0,0009375)/W·9,525/(38,1 − 0,0009375) al B.
    const first = s.populations.households[0]!;
    const payA = 0.00125 * (28.575 / 38.1);
    const payB = (((10 * (w - payA)) / (8000 * w)) * 9.525) / (38.1 - payA);
    expect(Math.abs(w * 1e6 - firstAsset(L, first, 'deposit')!.amount - (payA + payB) * 1e6)).toBeLessThan(1);
    // El total de los hogares queda apenas por debajo de D (cada hogar paga el segundo préstamo con su patrimonio ya
    // reducido), y la morosidad se reparte casi como las pérdidas (28,575 : 9,525 = 0,75; por lo mismo, el préstamo B
    // recibe un poco menos: ~4·10⁻⁶).
    expect(households).toBeLessThanOrEqual(10_000_000);
    expect(households).toBeGreaterThan(10_000_000 * (1 - 1e-4));
    expect(Math.abs(lossA / (lossA + lossB) - 0.75)).toBeLessThan(1e-5);
  });

  it('quiebra con aporte negativo: la pérdida total cruza 0 por el sobrepago y el último hogar cobra (bailoutRefund)', () => {
    // Capital 200: D = min(100, 38,1) = 38,1, toda la pérdida (como la empresa 8164 en el tick 108). Con los 8.000
    // hogares iguales, los aportes inflan las participaciones (la pérdida total baja entre préstamo y préstamo) y al
    // llegar al último hogar la pérdida total ya es negativa: su aporte a un préstamo da < 0 y JMAB le paga.
    const { s, L, c, loanA, loanB, bankA, bankB } = bankruptConsumptionFirm(200);
    const order = [...s.populations.households];
    const hDep = new Map(s.households.map((h) => [h.id, firstAsset(L, h.id, 'deposit')!]));
    const before = new Map(order.map((id) => [id, hDep.get(id)!.amount]));
    // Referencia: el lazo de FirmBankruptcyFireSales 152–176 en double, con el patrimonio de cada hogar (depósito;
    // sin bienes) actualizado en cada pago y las pérdidas también.
    const wealth = new Map(order.map((id) => [id, before.get(id)! / 1e6]));
    let W = 0;
    for (const id of order) W += wealth.get(id)!;
    const losses = [28.575, 9.525];
    let T = losses[0]! + losses[1]!;
    const D = T;
    const paid = new Map<number, number>();
    const refunds: { id: number; loan: number; amount: number }[] = [];
    for (const id of order) {
      for (let i = 0; i < 2; i++) {
        const a = (((D * wealth.get(id)!) / W) * losses[i]!) / T;
        if (a < 0) refunds.push({ id, loan: i, amount: a });
        wealth.set(id, wealth.get(id)! - a);
        paid.set(id, (paid.get(id) ?? 0) + a);
        losses[i] = losses[i]! - a;
        T -= a;
      }
    }
    expect(refunds.length).toBe(1);
    expect(refunds[0]!.id).toBe(order[order.length - 1]);
    const [nplA, nplB] = [bankA.currentNonPerformingLoans, bankB.currentNonPerformingLoans];
    const cp = beginPeriod(L);
    creditInterestsEvent(s);
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(assertLedger(L)).toBeUndefined();
    expect(c.bailoutCost).toBe(38_100_000);
    // Cada hogar, a < 1 µ de lo que paga en JMAB (el último cobra en un préstamo y paga en el otro: cuenta mixta).
    for (const id of order) expect(Math.abs(before.get(id)! - hDep.get(id)!.amount - paid.get(id)! * 1e6)).toBeLessThan(1);
    // Hay un registro bailoutRefund: el préstamo sube y el hogar cobra (flujo ownersBailout empresa → hogar).
    const last = order[order.length - 1]!;
    const refundLog = L.flowLog.filter((r) => r.category === 'ownersBailout' && r.payee === last && r.payer === c.id);
    expect(refundLog.length).toBe(1);
    expect(Math.abs(refundLog[0]!.amount + refunds[0]!.amount * 1e6)).toBeLessThan(1);
    // Los préstamos se cierran; la morosidad suma la pérdida que queda en JMAB (banksLosses, con el signo).
    expect(contractOf(L, loanA).amount).toBe(0);
    expect(contractOf(L, loanB).amount).toBe(0);
    expect(Math.abs(bankA.currentNonPerformingLoans - nplA - losses[0]! * 1e6)).toBeLessThan(2);
    expect(Math.abs(bankB.currentNonPerformingLoans - nplB - losses[1]! * 1e6)).toBeLessThan(2);
  });

  it('quiebra con el depósito de un hogar que no alcanza para su aporte: error explícito (JMAB no lo chequea)', () => {
    const { s } = bankruptConsumptionFirm(200); // D = min(100, 38,1) = 38,1
    const h = s.households[0]!;
    h.consumptionGoods = [{ quantity: 1, value: 1e9, price: 1e9, unitCost: 0, age: 0, producer: s.consumptionFirms[2]!.id, duration: 1 }];
    expect(() => creditInterestsEvent(s)).toThrow(/depósito del hogar .* quedaría negativo/);
  });

  it('quiebra de una empresa de capital con liquidez mayor que la deuda: paga todo y el excedente se borra (writeOff)', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    const L = s.ledger;
    const k = s.capitalFirms[0]!;
    quietOthers(s, k);
    for (const id of [...contractIds(L, k.id, 'liabilities', 'loan')]) {
      contractOf(L, id).amount = 0;
      closeContract(L, id);
    }
    const dep = firstAsset(L, k.id, 'deposit')!;
    // Última cuota de un préstamo de 20 (saldo 1) con tasa 0,5: servicio 1 + 0,5 = 1,5 > liquidez 1,2 ≥ deuda 1.
    const loan = open(L, 'loan', dep.issuer, k.id, 1_000_000, { rate: 0.5, length: 20, amortization: 'fixedCapital', age: 20, initialAmount: 20_000_000 }, 'loans');
    pay(L, dep.id, firstAsset(L, s.capitalFirms[1]!.id, 'deposit')!.id, dep.amount - 1_200_000, 'deposits');
    const bank = s.banks.find((b) => b.id === dep.issuer)!;
    const npl = bank.currentNonPerformingLoans;
    const cp = beginPeriod(L);
    creditInterestsEvent(s);
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(k.defaulted).toBe(true);
    expect(contractOf(L, loan).amount).toBe(0);
    expect(dep.amount).toBe(0);
    expect(bank.currentNonPerformingLoans).toBe(npl);
    expect(k.bailoutCost).toBe(0); // sin aporte de los dueños (solo las empresas de consumo)
    const writeOffs = L.flowLog.filter((r) => r.category === 'writeOff');
    expect(writeOffs.map((r) => [r.payer, r.payee, r.amount])).toEqual([[k.id, bank.id, 200_000]]);
  });
});

describe('evento 21 (salarios y seguro de desempleo): casos a mano', () => {
  /** Estado inicial con el tick 1 y el saldo del primer depósito de la empresa de consumo 0 fijado en µ. */
  const setup = (deposit: number | null) => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const L = s.ledger;
    const c = s.consumptionFirms[0]!;
    const dep = firstAsset(L, c.id, 'deposit')!;
    if (deposit !== null) pay(L, dep.id, firstAsset(L, s.consumptionFirms[1]!.id, 'deposit')!.id, dep.amount - deposit, 'deposits');
    const hDep = (id: number) => firstAsset(L, id, 'deposit')!;
    return { s, L, c, dep, hDep };
  };

  it('la empresa le paga a cada empleado su salario (4 × 50 = 200 < depósito 250); el depósito baja en la masa salarial', () => {
    // Con los salarios iniciales (5 × 50 = 250, justo el depósito) el último no cobraría (caso de abajo): salarios de 4.
    const { s, L, c, dep, hDep } = setup(null);
    expect(c.employees.length).toBe(50);
    for (const id of c.employees) s.households.find((h) => h.id === id)!.wage = 4;
    const before = new Map(c.employees.map((id) => [id, hDep(id).amount]));
    const d0 = dep.amount;
    const cp = beginPeriod(L);
    wagePaymentEvent(s, new PrngCaianiRng(Rng.fromSeed(2)));
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(dep.amount).toBe(d0 - 200_000_000);
    for (const id of c.employees) expect(hDep(id).amount).toBe(before.get(id)! + 4_000_000);
  });

  it('con el depósito justo igual a la masa salarial, el último de la mezcla no cobra (salario < depósito es estricto)', () => {
    const { s, c, dep, hDep } = setup(250_000_000);
    const before = new Map(c.employees.map((id) => [id, hDep(id).amount]));
    wagePaymentEvent(s, new PrngCaianiRng(Rng.fromSeed(2)));
    // La mezcla reordena la lista en el lugar: el último de la lista es el que no cobró, y no se lo despide.
    const last = c.employees[c.employees.length - 1]!;
    expect(dep.amount).toBe(5_000_000);
    expect(hDep(last).amount).toBe(before.get(last)!);
    expect(c.employees.slice(0, -1).every((id) => hDep(id).amount === before.get(id)! + 5_000_000)).toBe(true);
    expect(c.employees.length).toBe(50);
    expect(c.defaulted).toBe(false);
  });

  it('masa salarial mayor que el depósito: reparte el depósito en partes iguales en double (10 µ entre 50: 0,2 µ cada uno, como JMAB) con el redondeo del lote, exacto, y quiebra', () => {
    const { s, L, c, dep } = setup(10);
    const n = c.employees.length;
    const cp = beginPeriod(L);
    wagePaymentEvent(s, new PrngCaianiRng(Rng.fromSeed(2)));
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(c.defaulted).toBe(true);
    expect(dep.amount).toBe(0);
    // Camino (a) (decisión de Nico, 2026-11-14): el lote reparte exactamente los 10 µ; cada empleado a < 1 µ de 10/50.
    const wages = L.flowLog.filter((r) => r.category === 'wages' && r.payer === c.id);
    expect(wages.reduce((a, r) => a + r.amount, 0)).toBe(10);
    for (const r of wages) expect(Math.abs(r.amount - 10 / n)).toBeLessThan(1);
    expect(new Set(wages.map((r) => r.payee)).size).toBe(wages.length); // a lo sumo un pago por empleado
    // La quiebra (liquidez 0) condona todos los préstamos.
    for (const id of contractIds(L, c.id, 'liabilities', 'loan')) expect(contractOf(L, id).amount).toBe(0);
  });

  it('gobierno: salarios sin mirar el saldo (la cuenta puede quedar negativa) y seguro de desempleo = 0,4 × salario medio', () => {
    const { s, L, hDep } = setup(null);
    const g = s.government;
    const unemployed = s.households.filter((h) => h.employer === null);
    const [h1, h2] = [unemployed[0]!, unemployed[1]!];
    for (const h of [h1, h2]) h.employer = g.id;
    h2.wage = 7;
    g.employees = [h1.id, h2.id];
    const account = contractIds(L, g.id, 'assets', 'reserves')[0]!;
    const a0 = contractOf(L, account).amount;
    const employed = s.households.filter((h) => h.employer !== null);
    const average = employed.reduce((a, h) => a + h.wage, 0) / employed.length;
    const nUnemployed = s.households.length - employed.length;
    const b1 = hDep(h1.id).amount;
    const cp = beginPeriod(L);
    wagePaymentEvent(s, new PrngCaianiRng(Rng.fromSeed(2)));
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(g.wageBill).toBe(12_000_000);
    expect(hDep(h1.id).amount).toBe(b1 + 5_000_000);
    expect(Math.abs(g.doleExpenditure - 0.4 * average * nUnemployed * 1e6)).toBeLessThan(1);
    // La cuenta del gobierno baja en salarios + seguro (a < 1 µ del total en double).
    expect(Math.abs(a0 - contractOf(L, account).amount - (12_000_000 + 0.4 * average * nUnemployed * 1e6))).toBeLessThan(1);
    const dole = L.flowLog.filter((r) => r.category === 'unemploymentBenefits');
    expect(dole.length).toBe(nUnemployed);
  });
});

describe('evento 22 (intereses y rescate de los bonos): casos a mano', () => {
  it('el gobierno paga interés y valor de cada bono vencido desde su cuenta en el BC; un bono no vencido cobra solo interés', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const L = s.ledger;
    const g = s.government;
    const account = contractIds(L, g.id, 'assets', 'reserves')[0]!;
    const bonds = [...contractIds(L, g.id, 'liabilities', 'bond')];
    expect(bonds.length).toBeGreaterThan(2);
    // Caso: todos con precio 1, tasa 0,0025 y vencimiento 1; todos vencidos (edad 1) salvo el primero (edad 0).
    bonds.forEach((id, i) => {
      const b = contractOf(L, id);
      b.price = 1;
      b.rate = 0.0025;
      b.maturity = 1;
      b.age = i === 0 ? 0 : 1;
      expect(b.amount).toBe(Math.round((b.quantity as number) * 1e6)); // saldo = cantidad × precio
    });
    const holderOf = bonds.map((id) => contractOf(L, id).holder);
    const value = bonds.map((id) => (contractOf(L, id).quantity as number) * 1);
    const reservesOf = (agent: number) => contractIds(L, agent, 'assets', 'reserves').reduce((a, id) => a + contractOf(L, id).amount, 0);
    const before = holderOf.map((h) => (h === s.centralBank.id ? 0 : reservesOf(h)));
    const acc0 = contractOf(L, account).amount;
    const cp = beginPeriod(L);
    bondInterestEvent(s);
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(assertLedger(L)).toBeUndefined();
    // Interés de cada uno: valor × 0,0025; el gobierno paga Σ intereses + Σ valores de los vencidos.
    let interests = 0;
    let principal = 0;
    bonds.forEach((id, i) => {
      const b = contractOf(L, id);
      const interest = value[i]! * 0.0025;
      interests += interest;
      if (i === 0) {
        expect(b.quantity).toBe(value[0]); // no vencido: no se rescata
        expect(b.amount).toBe(Math.round(value[0]! * 1e6));
      } else {
        principal += value[i]!;
        expect(b.quantity).toBe(0);
        expect(b.amount).toBe(0);
      }
      const h = holderOf[i]!;
      if (h === s.centralBank.id) {
        expect(s.centralBank.bondInterestsReceived).toBe(Math.round(interest * 1e6));
      } else {
        expect(s.banks.find((x) => x.id === h)!.bondInterestReceived).toBe(Math.round(interest * 1e6));
        // Reservas del banco: + interés (+ valor si venció), a < 1 µ.
        expect(Math.abs(reservesOf(h) - before[i]! - (interest + (i === 0 ? 0 : value[i]!)) * 1e6)).toBeLessThan(1);
      }
    });
    expect(g.totInterestsBonds).toBe(Math.round(interests * 1e6));
    expect(Math.abs(acc0 - contractOf(L, account).amount - (interests + principal) * 1e6)).toBeLessThan(1);
    const flows = L.flowLog.filter((r) => r.category === 'bondInterest');
    expect(flows.length).toBe(bonds.length);
    // Cada rescate son dos registros `bonds`: el pago al tenedor y la baja del bono.
    expect(L.flowLog.filter((r) => r.category === 'bonds').length).toBe(2 * (bonds.length - 1));
  });
});

describe('evento 23 (servicio de los adelantos del BC): casos a mano', () => {
  it('solo intereses, plazo 1: el banco paga interés y monto inicial con sus reservas; un adelanto de edad 0 no paga', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const L = s.ledger;
    const cb = s.centralBank.id;
    const [b1, b2] = [s.banks[0]!, s.banks[1]!];
    const terms = { rate: 0.005, length: 1, amortization: 'onlyInterest' as const };
    // Banco 1: dos adelantos vencidos, 100 y 40,000001 (interés 0,5 + 0,200000005 = 0,700000005). Banco 2: uno
    // de 30 con edad 0 (tomado en este tick: no paga).
    const a1 = open(L, 'advance', cb, b1.id, 100_000_000, { ...terms, age: 1, initialAmount: 100_000_000 }, 'advances');
    const a2 = open(L, 'advance', cb, b1.id, 40_000_001, { ...terms, age: 1, initialAmount: 40_000_001 }, 'advances');
    const a3 = open(L, 'advance', cb, b2.id, 30_000_000, { ...terms, age: 0, initialAmount: 30_000_000 }, 'advances');
    const res = (b: number) => contractOf(L, contractIds(L, b, 'assets', 'reserves')[0]!).amount;
    const [r1, r2] = [res(b1.id), res(b2.id)];
    const cp = beginPeriod(L);
    advanceInterestEvent(s);
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(assertLedger(L)).toBeUndefined();
    expect(contractOf(L, a1).amount).toBe(0);
    expect(contractOf(L, a2).amount).toBe(0);
    expect(contractOf(L, a3).amount).toBe(30_000_000);
    // Reservas del banco 1: − (100 + 40,000001) − 0,700000005 = −140,700001005 → a < 1 µ.
    expect(Math.abs(r1 - res(b1.id) - 140_700_001.005)).toBeLessThan(1);
    expect(res(b2.id)).toBe(r2);
    expect(b1.advancesInterests).toBe(700_000); // toMicro(0,700000005)
    expect(b2.advancesInterests).toBe(0);
    expect(L.flowLog.filter((r) => r.category === 'advanceInterest').length).toBe(2);
  });
});

describe('evento 24 (impuestos): casos a mano', () => {
  /**
   * Estado inicial en el tick 1 con las poblaciones que recorre el gobierno recortadas a los agentes del caso
   * (el evento las recorre en el orden de sus listas). Devuelve la cuenta del gobierno y las reservas de un banco.
   */
  const setup = () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const L = s.ledger;
    s.populations.capitalFirms = [];
    s.populations.consumptionFirms = [];
    s.populations.banks = [];
    s.populations.households = [];
    const gov = contractOf(L, contractIds(L, s.government.id, 'assets', 'reserves')[0]!);
    const reservesOf = (bank: number) => contractOf(L, contractIds(L, bank, 'assets', 'reserves')[0]!);
    return { s, L, gov, reservesOf };
  };
  const hh = (s: CaianiState, id: number) => s.households.find((h) => h.id === id)!;

  /** Empresa de consumo: inventario 50 a precio 2 y costo 0,8; inventario anterior 40 (nominal 30); producción 100. */
  const consumptionCase = () => {
    const env = setup();
    const { s } = env;
    const c = s.consumptionFirms[0]!;
    s.populations.consumptionFirms = [c.id];
    setLag(c.lags, LAG.INVENTORIES, 0, 40);
    setLag(c.lags, LAG.NOMINALINVENTORIES, 0, 30);
    setLag(c.lags, LAG.PRODUCTION, 1, 100);
    Object.assign(c.consumptionGoods[0]!, { quantity: 50, price: 2, unitCost: 0.8 });
    // Masa salarial 120 (salario medio 2,4); añadas: 10 × 4 / 20 = 2 de amortización (la de edad −1 no cuenta).
    for (const id of c.employees) hh(s, id).wage = 120 / c.employees.length;
    const k0 = c.capitalGoods[0]!;
    c.capitalGoods = [
      { ...k0, quantity: 10, price: 4, amortization: 20, age: 0 },
      { ...k0, quantity: 99, price: 4, amortization: 20, age: -1 },
    ];
    c.debtInterests = 2_000_000;
    c.debtBurden = 5_000_000; // capital de las cuotas: 3
    c.interestReceived = 500_000;
    return { ...env, c };
  };

  it('empresa de consumo: ganancia = 180 − 120 − 2 − 2 + 0,5 + (40 − 30) = 66,5; impuestos 0,18 × 66,5 al gobierno; rezagos y expectativas', () => {
    const { s, L, c, gov, reservesOf } = consumptionCase();
    const dep = firstAsset(L, c.id, 'deposit')!;
    const [d0, g0, r0] = [dep.amount, gov.amount, reservesOf(dep.issuer).amount];
    const expNominal = c.expectations[EXPECTATION.NOMINALSALES]!.expectation;
    const cp = beginPeriod(L);
    const r = taxesEvent(s);
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(assertLedger(L)).toBeUndefined();
    expect(r.relaxed).toBe(false);
    const lag = (id: number) => c.lags[id]![1]!;
    expect(lag(LAG.INVENTORIES)).toBe(50);
    expect(lag(LAG.NOMINALINVENTORIES)).toBe(40); // costo × cantidad
    expect(lag(LAG.REALSALES)).toBe(90); // 100 − 50 + 40
    expect(lag(LAG.NOMINALSALES)).toBe(180);
    expect(lag(LAG.CAPITALAMORTIZATION)).toBe(2);
    expect(lag(LAG.PROFITPRETAX)).toBeCloseTo(66.5, 12);
    expect(lag(LAG.TAXES)).toBeCloseTo(11.97, 12);
    expect(lag(LAG.PROFITAFTERTAX)).toBeCloseTo(54.53, 12);
    // Flujo de caja: 54,53 + 2 (amortización) − (40 − 30) − 3 (capital) = 43,53.
    expect(lag(LAG.OPERATINGCASHFLOW)).toBeCloseTo(43.53, 12);
    expect(c.expectations[EXPECTATION.NOMINALSALES]!.passed[0]).toEqual([180, expNominal]);
    expect(c.expectations[EXPECTATION.REALSALES]!.passed[0]![0]).toBe(90);
    expect(c.expectations[EXPECTATION.WAGES]!.passed[0]![0]).toBeCloseTo(2.4, 12);
    // El pago: depósito − 11,97, reservas de su banco − 11,97, cuenta del gobierno + 11,97 (a < 1 µ del double, que es
    // 11.969.999,999999998 µ: el redondeo controlado puede dar 11.969.999).
    expect(Math.abs(d0 - dep.amount - lag(LAG.TAXES) * 1e6)).toBeLessThan(1);
    expect(dep.amount - d0).toBe(reservesOf(dep.issuer).amount - r0);
    expect(gov.amount - g0).toBe(d0 - dep.amount);
    expect(L.flowLog.filter((f) => f.category === 'taxes')).toHaveLength(1);
  });

  it('empresa de consumo con impuestos mayores que el depósito: no paga (0), y la ganancia después de impuestos es la de antes', () => {
    const { s, L, c, gov } = consumptionCase();
    const dep = firstAsset(L, c.id, 'deposit')!;
    const sink = firstAsset(L, s.consumptionFirms[1]!.id, 'deposit')!;
    pay(L, dep.id, sink.id, dep.amount - 11_000_000, 'deposits'); // deja 11 < 11,97
    const g0 = gov.amount;
    taxesEvent(s);
    expect(c.lags[LAG.TAXES]![1]).toBe(0);
    expect(c.lags[LAG.PROFITAFTERTAX]![1]).toBe(c.lags[LAG.PROFITPRETAX]![1]);
    expect(dep.amount).toBe(11_000_000);
    expect(gov.amount).toBe(g0);
  });

  it('empresa que quebró en el tick: impuestos 0 (actualiza igual las ganancias)', () => {
    const { s, c, gov } = consumptionCase();
    c.defaulted = true;
    const g0 = gov.amount;
    taxesEvent(s);
    expect(c.lags[LAG.TAXES]![1]).toBe(0);
    expect(c.lags[LAG.PROFITPRETAX]![1]).toBeCloseTo(66.5, 12);
    expect(gov.amount).toBe(g0);
  });

  it('empresa de capital: inventarios y producción pasan por (int); sin amortización', () => {
    const { s, L, gov } = setup();
    const k = s.capitalFirms[0]!;
    s.populations.capitalFirms = [k.id];
    setLag(k.lags, LAG.INVENTORIES, 0, 3.6); // (int) 3
    setLag(k.lags, LAG.NOMINALINVENTORIES, 0, 3);
    setLag(k.lags, LAG.PRODUCTION, 1, 12.7); // (int) 12
    Object.assign(k.capitalGoods[0]!, { quantity: 7.9, price: 2.5, unitCost: 1 }); // (int) 7; nominal 7,9
    for (const id of k.employees) hh(s, id).wage = 10 / k.employees.length;
    k.debtInterests = 1_000_000;
    k.debtBurden = 1_000_000;
    k.interestReceived = 0;
    const g0 = gov.amount;
    taxesEvent(s);
    const lag = (id: number) => k.lags[id]![1]!;
    expect(lag(LAG.INVENTORIES)).toBe(7);
    expect(lag(LAG.REALSALES)).toBe(8); // 12 − 7 + 3
    expect(lag(LAG.NOMINALSALES)).toBe(20);
    // 20 − 10 − 1 + 0 + 7,9 − 3 = 13,9; impuestos 2,502; flujo de caja 13,9 − 2,502 − 4,9 − 0 = 6,498.
    expect(lag(LAG.PROFITPRETAX)).toBeCloseTo(13.9, 12);
    expect(lag(LAG.TAXES)).toBeCloseTo(2.502, 12);
    expect(lag(LAG.OPERATINGCASHFLOW)).toBeCloseTo(6.498, 12);
    expect(k.lags[LAG.CAPITALAMORTIZATION]?.[1]).toBeUndefined();
    expect(Math.abs(gov.amount - g0 - lag(LAG.TAXES) * 1e6)).toBeLessThan(1);
  });

  it('banco: ganancia = patrimonio − patrimonio anterior (10); impuestos 1,8 de sus reservas a la cuenta del gobierno; quebrado, 0', () => {
    const { s, L, gov, reservesOf } = setup();
    const b = s.banks[0]!;
    s.populations.banks = [b.id];
    const nw = toUnits(netFinancialWorth(L, b.id));
    setLag(b.lags, LAG.NETWEALTH, 0, nw - 10);
    const [r0, g0] = [reservesOf(b.id).amount, gov.amount];
    const cp = beginPeriod(L);
    taxesEvent(s);
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(b.lags[LAG.PROFITPRETAX]![1]).toBeCloseTo(10, 9);
    expect(b.lags[LAG.TAXES]![1]).toBeCloseTo(1.8, 9);
    expect(Math.abs(r0 - reservesOf(b.id).amount - b.lags[LAG.TAXES]![1]! * 1e6)).toBeLessThan(1);
    expect(gov.amount - g0).toBe(r0 - reservesOf(b.id).amount);
    // Quebrado: no paga.
    const t2 = setup();
    const b2 = t2.s.banks[0]!;
    t2.s.populations.banks = [b2.id];
    b2.defaulted = true;
    const g2 = t2.gov.amount;
    taxesEvent(t2.s);
    expect(b2.lags[LAG.TAXES]![1]).toBe(0);
    expect(t2.gov.amount).toBe(g2);
  });

  it('hogar: 0,18 × (salario + intereses + dividendos) = 0,99; con tope en el depósito; dividendos a 0 y patrimonio después del pago', () => {
    const { s, L, gov } = setup();
    const [h1, h2] = [s.households[0]!, s.households[1]!];
    s.populations.households = [h1.id, h2.id];
    for (const h of [h1, h2]) {
      h.employer = h.employer ?? s.government.id;
      h.wage = 5;
      h.interestReceived = 100_000;
      h.dividendsReceived = 400_000;
    }
    const [d1, d2] = [firstAsset(L, h1.id, 'deposit')!, firstAsset(L, h2.id, 'deposit')!];
    // El segundo hogar se queda con 0,5 en el depósito: paga 0,5 (tope).
    pay(L, d2.id, firstAsset(L, s.households[2]!.id, 'deposit')!.id, d2.amount - 500_000, 'deposits');
    const [a1, g0] = [d1.amount, gov.amount];
    const cp = beginPeriod(L);
    taxesEvent(s);
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(h1.lags[LAG.TAXES]![1]).toBeCloseTo(0.99, 12);
    expect(Math.abs(a1 - d1.amount - h1.lags[LAG.TAXES]![1]! * 1e6)).toBeLessThan(1);
    expect(h2.lags[LAG.TAXES]![1]).toBe(0.5);
    expect(d2.amount).toBe(0);
    expect(gov.amount - g0).toBe(a1 - d1.amount + 500_000);
    expect(h1.lags[LAG.NETWEALTH]![1]).toBe(toUnits(netFinancialWorth(L, h1.id)));
    expect(h2.lags[LAG.NETWEALTH]![1]).toBe(0);
    expect([h1.dividendsReceived, h2.dividendsReceived]).toEqual([0, 0]);
  });

  it('hogar con efectivo y depósito insuficiente: error explícito (rama no portada)', () => {
    const { s, L } = setup();
    const h = s.households[0]!;
    s.populations.households = [h.id];
    h.wage = 5;
    h.employer = h.employer ?? s.government.id;
    const d = firstAsset(L, h.id, 'deposit')!;
    pay(L, d.id, firstAsset(L, s.households[1]!.id, 'deposit')!.id, d.amount - 100_000, 'deposits');
    const cash = contractIds(L, h.id, 'assets', 'cash')[0];
    if (cash === undefined) open(L, 'cash', h.id, s.centralBank.id, 5_000_000, {}, 'deposits');
    else contractOf(L, cash).amount = 5_000_000; // solo para el caso
    expect(() => taxesEvent(s)).toThrow(/rama no portada/);
  });
});

describe('evento 25 (dividendos): casos a mano', () => {
  /**
   * Estado inicial en el tick 1 sin ganancias (todas las empresas con `LAG_PROFITAFTERTAX` = −1 y cada banco con el
   * patrimonio anterior igual al actual) y dos hogares en la población, con depósitos 3 y 1 (el resto pasa a un
   * tercero, fuera de la población). Los casos le dan ganancia a quien paga.
   */
  const setup = () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const L = s.ledger;
    for (const f of [...s.consumptionFirms, ...s.capitalFirms]) setLag(f.lags, LAG.PROFITAFTERTAX, 1, -1);
    for (const b of s.banks) setLag(b.lags, LAG.NETWEALTH, 0, toUnits(netFinancialWorth(L, b.id)));
    const [h1, h2, h3] = [s.households[0]!, s.households[1]!, s.households[2]!];
    s.populations.households = [h1.id, h2.id];
    const sink = firstAsset(L, h3.id, 'deposit')!;
    const d1 = firstAsset(L, h1.id, 'deposit')!;
    const d2 = firstAsset(L, h2.id, 'deposit')!;
    pay(L, d1.id, sink.id, d1.amount - 3_000_000, 'deposits');
    pay(L, d2.id, sink.id, d2.amount - 1_000_000, 'deposits');
    for (const h of [h1, h2]) h.dividendsReceived = 0;
    const reservesOf = (bank: number) => contractOf(L, contractIds(L, bank, 'assets', 'reserves')[0]!);
    return { s, L, h1, h2, d1, d2, reservesOf };
  };

  it('empresa de consumo con ganancia 10: 9 entre los hogares según su patrimonio (6,75 y 2,25); patas y registros', () => {
    const { s, L, h1, h2, d1, d2, reservesOf } = setup();
    const c = s.consumptionFirms[0]!;
    setLag(c.lags, LAG.PROFITAFTERTAX, 1, 10);
    const dep = firstAsset(L, c.id, 'deposit')!;
    const banks = [dep.issuer, d1.issuer, d2.issuer];
    const r0 = new Map(banks.map((b) => [b, reservesOf(b).amount]));
    const f0 = dep.amount;
    const cp = beginPeriod(L);
    const r = dividendsEvent(s);
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(assertLedger(L)).toBeUndefined();
    expect(r.relaxed).toBe(false);
    expect(r.payments).toBe(2);
    expect(c.dividends).toBe(9_000_000);
    expect(d1.amount).toBe(3_000_000 + 6_750_000);
    expect(d2.amount).toBe(1_000_000 + 2_250_000);
    expect(f0 - dep.amount).toBe(9_000_000);
    expect([h1.dividendsReceived, h2.dividendsReceived]).toEqual([6_750_000, 2_250_000]);
    // Reservas: el banco de la empresa paga lo que va a otros bancos; cada banco de un hogar cobra lo que no viene de él.
    const dRes = new Map<number, number>();
    const move = (b: number, x: number) => dRes.set(b, (dRes.get(b) ?? 0) + x);
    for (const [d, x] of [
      [d1, 6_750_000],
      [d2, 2_250_000],
    ] as const) {
      if (d.issuer !== dep.issuer) {
        move(dep.issuer, -x);
        move(d.issuer, x);
      }
    }
    for (const b of new Set(banks)) expect(reservesOf(b).amount - r0.get(b)!).toBe(dRes.get(b) ?? 0);
    expect(L.flowLog.filter((f) => f.category === 'dividends')).toHaveLength(2);
  });

  it('dos empresas: la segunda reparte con el patrimonio que dejó la primera (4 → 3 y 1; 8 → 6 y 2)', () => {
    const { s, h1, h2, d1, d2 } = setup();
    // Ganancias con dividendos 4 y 8 (× 0,9).
    setLag(s.consumptionFirms[0]!.lags, LAG.PROFITAFTERTAX, 1, 4 / 0.9);
    setLag(s.capitalFirms[0]!.lags, LAG.PROFITAFTERTAX, 1, 8 / 0.9);
    dividendsEvent(s);
    // a < 1 µ del double: 4/0,9 × 0,9 no es exactamente 4.
    expect(Math.abs(d1.amount - 3_000_000 - 9_000_000)).toBeLessThanOrEqual(1);
    expect(Math.abs(d2.amount - 1_000_000 - 3_000_000)).toBeLessThanOrEqual(1);
    expect(Math.abs(h1.dividendsReceived - 9_000_000)).toBeLessThanOrEqual(1);
    expect(Math.abs(h2.dividendsReceived - 3_000_000)).toBeLessThanOrEqual(1);
  });

  it('empresa: depósito igual a los dividendos no paga (estricto); depósito entre los dividendos y la ganancia recorta la ganancia al depósito; quebrada no paga', () => {
    const cases = [
      { deposit: 9_000_000, dividends: 0 },
      { deposit: 9_500_000, dividends: 8_550_000 }, // 0,9 × 9,5
    ];
    for (const { deposit, dividends } of cases) {
      const { s, L, d1, d2 } = setup();
      const c = s.consumptionFirms[0]!;
      setLag(c.lags, LAG.PROFITAFTERTAX, 1, 10);
      const dep = firstAsset(L, c.id, 'deposit')!;
      pay(L, dep.id, firstAsset(L, s.consumptionFirms[1]!.id, 'deposit')!.id, dep.amount - deposit, 'deposits');
      const r = dividendsEvent(s);
      expect(c.dividends).toBe(dividends);
      expect(dep.amount).toBe(deposit - dividends);
      expect(r.payments).toBe(dividends > 0 ? 2 : 0);
      expect(d1.amount + d2.amount).toBe(4_000_000 + dividends);
    }
    const { s, L } = setup();
    const c = s.consumptionFirms[0]!;
    setLag(c.lags, LAG.PROFITAFTERTAX, 1, 10);
    c.defaulted = true;
    const f0 = firstAsset(L, c.id, 'deposit')!.amount;
    expect(dividendsEvent(s).payments).toBe(0);
    expect(c.dividends).toBe(0);
    expect(firstAsset(L, c.id, 'deposit')!.amount).toBe(f0);
  });

  it('banco con ganancia 10 (patrimonio − el anterior): 6 desde sus reservas a los hogares; `LAG_PROFITAFTERTAX`; con pérdida no paga', () => {
    const { s, L, h1, h2, d1, d2, reservesOf } = setup();
    const b = s.banks[0]!;
    const nw = toUnits(netFinancialWorth(L, b.id));
    setLag(b.lags, LAG.NETWEALTH, 0, nw - 10);
    const banks = [...new Set([b.id, d1.issuer, d2.issuer])];
    const r0 = new Map(banks.map((x) => [x, reservesOf(x).amount]));
    const cp = beginPeriod(L);
    const r = dividendsEvent(s);
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(assertLedger(L)).toBeUndefined();
    expect(r.payments).toBe(2);
    expect(b.lags[LAG.PROFITAFTERTAX]![1]).toBeCloseTo(10, 9);
    expect(Math.abs(b.dividends - 6_000_000)).toBeLessThanOrEqual(1);
    expect(Math.abs(d1.amount - 3_000_000 - 4_500_000)).toBeLessThanOrEqual(1);
    expect(Math.abs(d2.amount - 1_000_000 - 1_500_000)).toBeLessThanOrEqual(1);
    expect(h1.dividendsReceived + h2.dividendsReceived).toBe(d1.amount + d2.amount - 4_000_000);
    // Reservas: bajan las del banco por lo que va a depósitos de otros bancos; las de esos bancos suben lo mismo; lo que
    // va a un depósito del mismo banco solo sube el depósito (el banco baja su patrimonio).
    const paidOut = d1.amount + d2.amount - 4_000_000;
    let sameBank = 0;
    for (const d of [d1, d2]) if (d.issuer === b.id) sameBank += d.amount - (d === d1 ? 3_000_000 : 1_000_000);
    expect(r0.get(b.id)! - reservesOf(b.id).amount).toBe(paidOut - sameBank);
    expect(toUnits(netFinancialWorth(L, b.id))).toBeCloseTo(nw - paidOut / 1e6, 9);
    // Con pérdida: el rezago se escribe igual y no paga.
    const t2 = setup();
    const b2 = t2.s.banks[0]!;
    setLag(b2.lags, LAG.NETWEALTH, 0, toUnits(netFinancialWorth(t2.L, b2.id)) + 3);
    expect(dividendsEvent(t2.s).payments).toBe(0);
    expect(b2.lags[LAG.PROFITAFTERTAX]![1]).toBeCloseTo(-3, 9);
    expect(b2.dividends).toBe(0);
  });
});

describe('evento 26 (demanda de depósitos): casos a mano', () => {
  it('estado inicial: cada hogar quiere en depósitos todo lo líquido (shareDeposits = 1) y nada en efectivo; empresas y hogares activos en depósitos; sin pagos', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const L = s.ledger;
    const before = JSON.stringify(Object.values(L.contracts).map((c) => c.amount));
    const r = depositDemandEvent(s);
    expect(r.payments).toBe(0);
    expect(JSON.stringify(Object.values(L.contracts).map((c) => c.amount))).toBe(before);
    for (const h of s.households) {
      const liquid = [...contractIds(L, h.id, 'assets', 'cash'), ...contractIds(L, h.id, 'assets', 'deposit')].reduce((a, id) => a + contractOf(L, id).amount, 0);
      expect(h.depositAmount).toBe(liquid);
      expect(h.cashAmount).toBe(0);
      expect(h.active[MKT.DEPOSIT]).toBe(true);
    }
    for (const f of [...s.consumptionFirms, ...s.capitalFirms]) expect(f.active[MKT.DEPOSIT]).toBe(true);
    for (const b of s.banks) expect(b.active[MKT.DEPOSIT]).toBe(false);
    expect(s.government.active[MKT.DEPOSIT]).toBe(false);
  });

  it('hogar con efectivo y dos depósitos, shareDeposits = 0,75: líquidos 10,000001 → depósitos 7,500001 (redondeo de 7,50000075) y efectivo 2,5 (el resto)', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    s.rules = { ...s.rules, householdShareDeposits: 0.75 };
    const L = s.ledger;
    const h = s.households[0]!;
    const d = firstAsset(L, h.id, 'deposit')!;
    const sink = firstAsset(L, s.households[1]!.id, 'deposit')!;
    pay(L, d.id, sink.id, d.amount - 5_000_001, 'deposits');
    let cash = contractIds(L, h.id, 'assets', 'cash')[0];
    if (cash === undefined) cash = open(L, 'cash', h.id, s.centralBank.id, 0, {}, 'deposits');
    // El banco saca el efectivo de sus reservas (los bancos arrancan sin efectivo) y el hogar lo retira de su depósito.
    const bankOf = (bank: number, kind: 'cash' | 'reserves') => contractIds(L, bank, 'assets', kind)[0]!;
    pay(L, bankOf(d.issuer, 'reserves'), bankOf(d.issuer, 'cash'), 2_000_000, 'deposits');
    pay(L, d.id, cash!, 2_000_000, 'deposits'); // depósito 3,000001, efectivo 2
    const other = s.banks.find((b) => b.id !== d.issuer)!;
    open(L, 'deposit', h.id, other.id, 0, { rate: d.rate }, 'deposits');
    const d2 = contractIds(L, h.id, 'assets', 'deposit')[1]!;
    pay(L, sink.id, d2, 5_000_000, 'deposits'); // segundo depósito 5
    depositDemandEvent(s);
    expect(h.depositAmount).toBe(7_500_001);
    expect(h.cashAmount).toBe(2_500_000);
  });

  it('empresa con efectivo 2,5: lo pasa al primer depósito y el efectivo de su banco sube en espejo (patas, invariantes)', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const L = s.ledger;
    const c = s.consumptionFirms[0]!;
    const dep = firstAsset(L, c.id, 'deposit')!;
    const cash = contractOf(L, contractIds(L, c.id, 'assets', 'cash')[0]!);
    const bankCash = contractOf(L, contractIds(L, dep.issuer, 'assets', 'cash')[0]!);
    // El banco saca el efectivo de sus reservas (los bancos arrancan sin efectivo) y la empresa lo retira de su depósito.
    pay(L, contractIds(L, dep.issuer, 'assets', 'reserves')[0]!, bankCash.id, 2_500_000, 'deposits');
    pay(L, dep.id, cash.id, 2_500_000, 'deposits');
    const [d0, b0] = [dep.amount, bankCash.amount];
    const cp = beginPeriod(L);
    const r = depositDemandEvent(s);
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(assertLedger(L)).toBeUndefined();
    expect(r.payments).toBe(1);
    expect(cash.amount).toBe(0);
    expect(dep.amount - d0).toBe(2_500_000);
    expect(bankCash.amount - b0).toBe(2_500_000);
    expect(c.active[MKT.DEPOSIT]).toBe(true);
  });
});

describe('evento 27 (mercado de depósitos): casos a mano', () => {
  /**
   * Estado inicial en el tick 1 con un solo depositante en el mercado y un solo banco activo (`objetivo`): ese es el
   * único que ve. La tasa del banco previo se pone en 0 para que cambie sin sorteo (p = 1 − e^{−∞} = 1).
   */
  const setup = (who: 'household' | 'firm') => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const L = s.ledger;
    const d = who === 'household' ? s.households[0]! : s.consumptionFirms[0]!;
    const first = firstAsset(L, d.id, 'deposit')!;
    const prevBank = s.banks.find((b) => b.id === first.issuer)!;
    const target = s.banks.find((b) => b.id !== first.issuer)!;
    s.markets.deposit.buyers = [d.id];
    d.active[MKT.DEPOSIT] = true;
    d.previousBank = prevBank.id;
    for (const b of s.banks) b.active[MKT.DEPOSIT] = b === target;
    prevBank.depositInterestRate = 0;
    target.depositInterestRate = 0.01;
    const reservesOf = (bank: number) => contractOf(L, contractIds(L, bank, 'assets', 'reserves')[0]!);
    return { s, L, d, first, prevBank, target, reservesOf };
  };

  it('hogar que cambia de banco: abre un depósito en el elegido (tasa del banco, al final de las listas), le pasa el saldo entero con las reservas y cierra el viejo; queda inactivo', () => {
    const { s, L, d, first, prevBank, target, reservesOf } = setup('household');
    const amount = first.amount;
    const [rp, rt] = [reservesOf(prevBank.id).amount, reservesOf(target.id).amount];
    const cp = beginPeriod(L);
    depositMarketEvent(s, new PrngCaianiRng(Rng.fromSeed(2)));
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(assertLedger(L)).toBeUndefined();
    const deps = contractIds(L, d.id, 'assets', 'deposit');
    expect(deps).toHaveLength(1);
    const now = contractOf(L, deps[0]!);
    expect(now.issuer).toBe(target.id);
    expect(now.amount).toBe(amount);
    expect(now.rate).toBe(0.01);
    expect(contractIds(L, target.id, 'liabilities', 'deposit').at(-1)).toBe(now.id);
    expect(contractIds(L, prevBank.id, 'liabilities', 'deposit')).not.toContain(first.id);
    expect(L.contracts[first.id]).toBeUndefined();
    expect(rp - reservesOf(prevBank.id).amount).toBe(amount);
    expect(reservesOf(target.id).amount - rt).toBe(amount);
    expect(d.previousBank).toBe(target.id);
    expect(d.active[MKT.DEPOSIT]).toBe(false);
  });

  it('el previo es el de tasa más alta: se queda, sin sorteo; la tasa del depósito pasa a la del banco', () => {
    const { s, L, d, first, prevBank, target } = setup('household');
    prevBank.depositInterestRate = 0.02;
    prevBank.active[MKT.DEPOSIT] = true;
    target.active[MKT.DEPOSIT] = false;
    const amount = first.amount;
    depositMarketEvent(s, new PrngCaianiRng(Rng.fromSeed(2)));
    expect(contractIds(L, d.id, 'assets', 'deposit')).toEqual([first.id]);
    expect(first.amount).toBe(amount);
    expect(first.rate).toBe(0.02);
    expect(d.previousBank).toBe(prevBank.id);
  });

  it('empresa con el depósito de una quiebra fuera de la lista del banco: si elige ese banco lo sigue usando (le pasa el primero y queda fuera de la lista, como en JMAB); si elige el del primero, lo suelta', () => {
    for (const choose of ['delisted', 'first'] as const) {
      const { s, L, d, first, prevBank, target } = setup('firm');
      // Segundo depósito en el banco objetivo (como el de un crédito), con saldo 1,5, sacado de la lista del banco.
      const orphan = open(L, 'deposit', d.id, target.id, 0, { rate: 0.003 }, 'deposits');
      pay(L, first.id, orphan, 1_500_000, 'deposits');
      delistFromIssuer(L, orphan);
      if (choose === 'first') {
        prevBank.depositInterestRate = 0.02;
        prevBank.active[MKT.DEPOSIT] = true;
        target.active[MKT.DEPOSIT] = false;
      }
      const total = first.amount + contractOf(L, orphan).amount;
      const cp = beginPeriod(L);
      depositMarketEvent(s, new PrngCaianiRng(Rng.fromSeed(2)));
      expect(assertFlows(L, cp)).toBeUndefined();
      expect(assertLedger(L)).toBeUndefined();
      const kept = choose === 'delisted' ? orphan : first.id;
      const gone = choose === 'delisted' ? first.id : orphan;
      expect(contractIds(L, d.id, 'assets', 'deposit')).toEqual([kept]);
      expect(contractOf(L, kept).amount).toBe(total);
      expect(L.contracts[gone]).toBeUndefined();
      if (choose === 'delisted') {
        expect(contractOf(L, orphan).delisted).toBe(true);
        expect(contractIds(L, target.id, 'liabilities', 'deposit')).not.toContain(orphan);
        expect(contractOf(L, orphan).rate).toBe(0.01);
      } else {
        expect(contractIds(L, prevBank.id, 'liabilities', 'deposit')).toContain(first.id);
      }
    }
  });

  it('hogar con efectivo 2 y efectivo deseado 0: el efectivo pasa al depósito elegido y el efectivo de su banco sube en espejo', () => {
    const { s, L, d, first, prevBank, target } = setup('household');
    prevBank.depositInterestRate = 0.02;
    prevBank.active[MKT.DEPOSIT] = true;
    target.active[MKT.DEPOSIT] = false;
    const bankCash = contractOf(L, contractIds(L, prevBank.id, 'assets', 'cash')[0]!);
    let cash = contractIds(L, d.id, 'assets', 'cash')[0];
    if (cash === undefined) cash = open(L, 'cash', d.id, s.centralBank.id, 0, {}, 'deposits');
    pay(L, contractIds(L, prevBank.id, 'assets', 'reserves')[0]!, bankCash.id, 2_000_000, 'deposits');
    pay(L, first.id, cash!, 2_000_000, 'deposits');
    (d as { cashAmount: number }).cashAmount = 0;
    const [d0, b0] = [first.amount, bankCash.amount];
    const cp = beginPeriod(L);
    depositMarketEvent(s, new PrngCaianiRng(Rng.fromSeed(2)));
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(contractOf(L, cash!).amount).toBe(0);
    expect(first.amount - d0).toBe(2_000_000);
    expect(bankCash.amount - b0).toBe(2_000_000);
  });
});

describe('evento 28 (quiebra de los bancos): casos a mano', () => {
  /** `Rng` con el uniforme fijo (el único sorteo del evento). */
  const fixedUniform = (u: number): CaianiRng => ({ uniform01: () => u }) as unknown as CaianiRng;
  /**
   * Estado inicial en el tick 1 con los ratios de capital de los bancos en 0,1 y el primer banco con patrimonio −1
   * (una quita de sus préstamos: el banco pierde, las empresas ganan).
   */
  const setup = () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const L = s.ledger;
    for (const b of s.banks) b.capitalRatio = 0.1;
    const b = s.banks[0]!;
    const nw0 = netFinancialWorth(L, b.id);
    let toLose = nw0 + 1_000_000; // patrimonio final −1
    for (const id of contractIds(L, b.id, 'assets', 'loan')) {
      const x = Math.min(toLose, contractOf(L, id).amount);
      writeDown(L, id, x);
      toLose -= x;
      if (toLose === 0) break;
    }
    if (toLose !== 0) throw new Error('los préstamos no alcanzan para el caso');
    return { s, L, b };
  };

  it('sin bancos con patrimonio negativo no pasa nada (ni sortea)', () => {
    const s = initialize(new PrngCaianiRng(Rng.fromSeed(1)));
    s.round = 1;
    const before = JSON.stringify(Object.values(s.ledger.contracts).map((c) => c.amount));
    bankBankruptcyEvent(s, { uniform01: () => { throw new Error('no tenía que sortear'); } } as unknown as CaianiRng);
    expect(JSON.stringify(Object.values(s.ledger.contracts).map((c) => c.amount))).toBe(before);
    for (const b of s.banks) expect(b.defaulted).toBe(false);
  });

  it('banco con patrimonio −1, ratios de los otros 0,1 y U = 0,5: objetivo 0,15 × préstamos; la quita sale de los depósitos de su lista, en proporción (restos mayores), y el banco queda exactamente en el objetivo', () => {
    const { s, L, b } = setup();
    const loans = contractIds(L, b.id, 'assets', 'loan').reduce((a, id) => a + contractOf(L, id).amount, 0);
    const target = toMicro(0.15 * toUnits(loans)); // ratio = 0,1 + 0,5 × 0,1
    const H = target + 1_000_000;
    const deps = contractIds(L, b.id, 'liabilities', 'deposit');
    const before = deps.map((id) => contractOf(L, id).amount);
    const D = before.reduce((a, x) => a + x, 0);
    const cp = beginPeriod(L);
    bankBankruptcyEvent(s, fixedUniform(0.5));
    expect(assertFlows(L, cp)).toBeUndefined();
    expect(assertLedger(L)).toBeUndefined();
    expect(b.defaulted).toBe(true);
    expect(b.bailoutCost).toBe(H);
    expect(netFinancialWorth(L, b.id)).toBe(target);
    let cut = 0;
    deps.forEach((id, i) => {
      const share = before[i]! - contractOf(L, id).amount;
      expect(Math.abs(share - (H * before[i]!) / D)).toBeLessThan(1);
      cut += share;
    });
    expect(cut).toBe(H);
    const exp = b.expectations[EXPECTATION.DEPOSITS]!;
    for (const row of exp.passed) expect(row).toEqual([toUnits(D - H), toUnits(D - H)]);
    expect(L.flowLog.filter((f) => f.category === 'writeOff').length).toBeGreaterThanOrEqual(deps.length);
    for (const o of s.banks.slice(1)) expect(o.defaulted).toBe(false);
  });

  it('un depósito fuera de la lista del banco no paga la quita (rareza de JMAB)', () => {
    const { s, L, b } = setup();
    const f = s.consumptionFirms.find((c) => firstAsset(L, c.id, 'deposit')!.issuer !== b.id)!;
    const orphan = open(L, 'deposit', f.id, b.id, 0, { rate: 0.003 }, 'deposits');
    pay(L, firstAsset(L, f.id, 'deposit')!.id, orphan, 2_000_000, 'deposits');
    delistFromIssuer(L, orphan);
    bankBankruptcyEvent(s, fixedUniform(0.5));
    expect(contractOf(L, orphan).amount).toBe(2_000_000);
  });

  it('errores explícitos: ratio de otro banco infinito (sin préstamos) y quita mayor que los depósitos', () => {
    const t1 = setup();
    t1.s.banks[1]!.capitalRatio = Infinity;
    expect(() => bankBankruptcyEvent(t1.s, fixedUniform(0.5))).toThrow(/no portado/);
    const t2 = setup();
    for (const b of t2.s.banks) b.capitalRatio = 1e6; // objetivo enorme: la quita supera los depósitos
    expect(() => bankBankruptcyEvent(t2.s, fixedUniform(0.5))).toThrow(/no portado/);
  });
});
