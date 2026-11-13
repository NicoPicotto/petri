/**
 * P2 (V1): inicialización del port de Caiani contra JMAB. Diseño en docs/inicializacion.md.
 *
 * 1. Casos calculados a mano y propiedades (siempre).
 * 2. V1: comparación agente por agente con el estado que vuelca el oráculo después de la
 *    inicialización (`reference/p0/runs/oracle/p2-init/state/init.jsonl`, semilla 12345), usando
 *    el `Rng` en modo oráculo con los sorteos de la inicialización. Se saltea si falta reference/.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import {
  EXPECTATION,
  LAG,
  OracleCaianiRng,
  PrngCaianiRng,
  checkLedger,
  contractIds,
  contractOf,
  initialize,
  installment,
  parseDraws,
  toMicro,
  type AgentId,
  type CaianiState,
  type Contract,
  type ContractKind,
  type FirmState,
} from '../src/caiani';

function init(seed: number): CaianiState {
  return initialize(new PrngCaianiRng(Rng.fromSeed(seed)));
}

describe('inicialización del port de Caiani: casos a mano', () => {
  const s = init(1);
  const L = s.ledger;
  const c0 = s.consumptionFirms[0] as FirmState;

  it('el ledger queda bien formado y sin flujos registrados', () => {
    expect(checkLedger(L)).toEqual([]);
    expect(L.flowLog).toEqual([]);
  });

  it('hogares: depósito de 80.704,13311 / 8.000 en el banco i / 800, sin efectivo', () => {
    // 80704.13311 / 8000 = 10,08801663875 → 10.088.016,63875 µ → 10.088.017 µ.
    const h = s.households[1234]!;
    const dep = contractOf(L, contractIds(L, h.id, 'assets', 'deposit')[0]!);
    expect(dep.amount).toBe(10_088_017);
    expect(dep.issuer).toBe(s.banks[1]!.id); // 1234 / 800 = 1
    const cash = contractOf(L, contractIds(L, h.id, 'assets', 'cash')[0]!);
    expect(cash.amount).toBe(0);
    expect(h.previousSeller).toBe(s.consumptionFirms[15]!.id); // 1234 / 80 = 15
    expect(h.dividendsReceived).toBe(297_075); // 2376,600118 / 8000 = 0,29707501475
  });

  it('nadie arranca con efectivo (hhsCash y bsCash = 0; empresas en 0)', () => {
    for (const c of Object.values(L.contracts)) if (c.kind === 'cash') expect(c.amount).toBe(0);
  });

  it('préstamo inicial j = 1 de la primera empresa de consumo, calculado a mano', () => {
    // cLoan = 5208,435263 / 100 = 52,08435263; A = 52,08435263 / 1,0075 = 51,69662792… → 51.696.628 µ.
    // Saldo = A − redondeo(A·1/20) = 51.696.628 − 2.584.831 = 49.111.797 µ (JMAB: 49,111796524565754).
    const loans = contractIds(L, c0.id, 'liabilities', 'loan').map((id) => contractOf(L, id));
    expect(loans).toHaveLength(20);
    const l1 = loans[1] as Contract;
    expect(l1.age).toBe(2);
    expect(l1.initialAmount).toBe(51_696_628);
    expect(l1.amount).toBe(49_111_797);
    expect(l1.holder).toBe(s.banks[1]!.id); // banco del depósito (0) + 1
    expect(c0.previousLender).toBe(s.banks[0]!.id); // el del depósito, no el de j = 1
  });

  it('los préstamos iniciales cierran en cero exactamente a la edad 20 (no hay condonación)', () => {
    for (const f of [...s.consumptionFirms, ...s.capitalFirms]) {
      for (const id of contractIds(L, f.id, 'liabilities', 'loan')) {
        const l = { ...contractOf(L, id) };
        while (l.age <= (l.length as number)) {
          l.amount -= installment(l).principal;
          l.age += 1;
        }
        expect(l.amount).toBe(0);
      }
    }
  });

  it('bonos truncados a enteros: 3.827 por banco y 28.564 del BC', () => {
    const govBonds = contractIds(L, s.government.id, 'liabilities', 'bond').map((id) => contractOf(L, id));
    expect(govBonds).toHaveLength(11);
    expect(govBonds.slice(0, 10).every((b) => b.amount === 3_827_000_000 && b.quantity === 3827)).toBe(true);
    expect(govBonds[10]!.amount).toBe(28_564_000_000);
  });

  it('empleo: 50 por empresa, 6.000 ocupados, gobierno sin empleados', () => {
    expect(s.capitalFirms.every((f) => f.employees.length === 50)).toBe(true);
    expect(s.consumptionFirms.every((f) => f.employees.length === 50)).toBe(true);
    expect(s.government.employees).toEqual([]);
    const employed = s.households.filter((h) => h.employer !== null);
    expect(employed).toHaveLength(6000);
    for (const h of s.households) expect(h.lags[LAG.EMPLOYED]![0]).toBe(h.employer === null ? 0 : 1);
  });

  it('añadas de capital de la empresa de consumo: valor y precio descontados por (1 + g)^j', () => {
    const v = c0.capitalGoods;
    expect(v).toHaveLength(20);
    expect(v[0]!.value).toBe(2.6875 * 20); // 53,75
    // j = 1: 2,6875·20·(1 − 1/20) / 1,0075
    expect(v[1]!.value).toBe((2.6875 * 20 * (1 - 1 / 20)) / 1.0075);
    expect(v[1]!.age).toBe(1);
    expect(v[0]!.producer).toBe(s.capitalFirms[0]!.id); // 0 / 5
    expect(s.consumptionFirms[7]!.capitalGoods[0]!.producer).toBe(s.capitalFirms[1]!.id); // 7 / 5
  });

  it('determinismo: misma semilla, mismo estado; otra semilla, otro orden', () => {
    expect(JSON.stringify(init(1))).toBe(JSON.stringify(s));
    expect(init(2).populations.households).not.toEqual(s.populations.households);
  });
});

// ---------------------------------------------------------------------------------------------
// V1 contra el oráculo
// ---------------------------------------------------------------------------------------------

const RUN = fileURLToPath(new URL('../../../reference/p0/runs/oracle/p2-init/', import.meta.url));
const DUMP = RUN + 'state/init.jsonl';
const DRAWS = RUN + 'draws.tsv';

/** SM_* de JMAB → tipo de contrato del ledger. 2 y 3 son bienes reales. */
const SM_KIND: Record<number, ContractKind> = { 0: 'cash', 1: 'deposit', 4: 'loan', 5: 'bond', 6: 'reserves', 7: 'advance' };
const AMORT: Record<number, string> = { 0: 'fixedCapital', 2: 'onlyInterest' };

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe.skipIf(!existsSync(DUMP) || !existsSync(DRAWS))('V1: inicialización contra el oráculo (reference/, fuera de git)', () => {
  it('el estado inicial coincide con el de JMAB agente por agente', () => {
    const lines = readFileSync(DUMP, 'utf8').split('\n').filter((l) => l.length > 0);
    const meta = JSON.parse(lines[0]!).meta as { round: number; populations: number[][]; aggregate: J; markets: J[] };
    const agents = new Map<number, J>();
    for (const line of lines.slice(1)) {
      const d = JSON.parse(line) as { id: number; agent: J };
      agents.set(d.id, d.agent);
    }

    // Port ↔ JMAB: misma secuencia de creación (consumo, capital, bancos, gobierno, hogares, BC).
    // JMAB: poblaciones 0 capital, 1 consumo, 2 bancos, 3 hogares, 4 BC, 5 gobierno.
    const sorted = (p: number) => meta.populations[p]!.slice().sort((a, b) => a - b);
    const jmabIds = [...sorted(1), ...sorted(0), ...sorted(2), ...sorted(5), ...sorted(3), ...sorted(4)];
    const toJ = (id: AgentId) => {
      const j = jmabIds[id];
      if (j === undefined) throw new Error(`sin id de JMAB para ${id}`);
      return j;
    };

    const records = parseDraws(readFileSync(DRAWS, 'utf8')).filter((r) => r.tick < 1);
    const rng = new OracleCaianiRng(records);
    const s = initialize(rng, { jmabId: toJ });
    expect(rng.remaining).toBe(0); // se consumieron todos los sorteos de la inicialización
    expect(meta.round).toBe(s.round);

    const diffs: string[] = [];
    const counts = { contracts: 0, goods: 0, lags: 0, expectations: 0, maxAmountDiff: 0, maxRelPure: 0, maxRelFromAmounts: 0 };
    const note = (msg: string) => {
      if (diffs.length < 40) diffs.push(msg);
    };
    const ref = (x: J | null) => (x === null ? null : (x['@agent'] as number));
    const rel = (a: number, b: number) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));
    // Se informa por separado el máximo de los double que no dependen de montos (tolerancia 1e-12 o
    // exactos) y el de los que salen de saldos en µ (1e-6; plan-port-caiani.md, sec. 4, V3).
    const close = (what: string, port: number, java: number, tol: number) => {
      const r = rel(port, java);
      const track = tol > 1e-12 ? 'maxRelFromAmounts' : 'maxRelPure';
      counts[track] = Math.max(counts[track], r);
      if (!(r <= tol)) note(`${what}: port ${port}, JMAB ${java} (rel ${r})`);
    };
    const same = (what: string, port: unknown, java: unknown) => {
      if (port !== java) note(`${what}: port ${String(port)}, JMAB ${String(java)}`);
    };

    // Órdenes de las poblaciones y de los mercados.
    const P = s.populations;
    same('población capital', P.capitalFirms.map(toJ).join(), meta.populations[0]!.join());
    same('población consumo', P.consumptionFirms.map(toJ).join(), meta.populations[1]!.join());
    same('población bancos', P.banks.map(toJ).join(), meta.populations[2]!.join());
    same('población hogares', P.households.map(toJ).join(), meta.populations[3]!.join());
    const marketLists = [
      { buyers: P.consumptionFirms, sellers: P.capitalFirms },
      s.markets.consumption,
      s.markets.credit,
      s.markets.labor,
      s.markets.deposit,
      { buyers: P.banks, sellers: [P.government] },
      s.markets.reservesBonds,
      s.markets.reservesBasel,
    ];
    expect(meta.markets).toHaveLength(marketLists.length);
    marketLists.forEach((m, i) => {
      same(`mercado ${i} compradores`, m.buyers.map(toJ).join(), meta.markets[i]!.buyers.join());
      same(`mercado ${i} vendedores`, m.sellers.map(toJ).join(), meta.markets[i]!.sellers.join());
    });
    same('desempleo agregado rezagado', s.aggregateLags[LAG.AGGUNEMPLOYMENT]?.[0], meta.aggregate['11'].passedValues['0']);

    const firmOf = new Map<AgentId, FirmState>();
    for (const f of [...s.consumptionFirms, ...s.capitalFirms]) firmOf.set(f.id, f);

    for (let id = 0; id < s.ledger.agents.length; id++) {
      const j = agents.get(toJ(id));
      if (!j) {
        note(`falta el agente ${toJ(id)} en el volcado`);
        continue;
      }
      const sm = j['SimpleAbstractAgent.stockMatrix'] as J[][][];
      // Contratos, por lado y tipo, en orden.
      for (const [side, sideName] of [
        [0, 'assets'],
        [1, 'liabilities'],
      ] as const) {
        for (let k = 0; k < 8; k++) {
          const items = sm[side]![k]!;
          const kind = SM_KIND[k];
          if (!kind) continue;
          const ids = contractIds(s.ledger, id, sideName, kind);
          if (ids.length !== items.length) {
            note(`${toJ(id)} ${sideName} ${kind}: port ${ids.length} contratos, JMAB ${items.length}`);
            continue;
          }
          ids.forEach((cid, n) => {
            const c = contractOf(s.ledger, cid);
            const it = items[n]!;
            const w = `${toJ(id)} ${sideName} ${kind}[${n}]`;
            counts.contracts++;
            same(`${w} tenedor`, toJ(c.holder), ref(it['AbstractItem.assetHolder']));
            same(`${w} emisor`, toJ(c.issuer), ref(it['AbstractItem.liabilityHolder']));
            const d = Math.abs(c.amount - toMicro(it['AbstractItem.value']));
            counts.maxAmountDiff = Math.max(counts.maxAmountDiff, d);
            if (d > 2) note(`${w} saldo: port ${c.amount} µ, JMAB ${it['AbstractItem.value']}`);
            same(`${w} edad`, c.age, it['AbstractItem.age']);
            if ('interestRate' in it) same(`${w} tasa`, c.rate, it['interestRate']);
            if (kind === 'loan' || kind === 'advance') {
              same(`${w} plazo`, c.length, it['length']);
              same(`${w} amortización`, c.amortization, AMORT[it['amortization']]);
              const di = Math.abs((c.initialAmount as number) - toMicro(it['initialAmount']));
              if (di > 2) note(`${w} initialAmount: port ${c.initialAmount} µ, JMAB ${it['initialAmount']}`);
            }
            if (kind === 'bond') {
              same(`${w} cantidad`, c.quantity, it['AbstractItem.quantity']);
              same(`${w} precio`, c.price, it['price']);
              same(`${w} vencimiento`, c.maturity, it['maturity']);
            }
          });
        }
      }
      // Bienes reales.
      const f = firmOf.get(id);
      const jc = sm[0]![2]!;
      const jk = sm[0]![3]!;
      if (!f) {
        if (jc.length + jk.length > 0) note(`${toJ(id)} tiene bienes en JMAB y no es empresa en el port`);
      } else {
        same(`${toJ(id)} cantidad de bienes de consumo`, f.consumptionGoods.length, jc.length);
        same(`${toJ(id)} cantidad de bienes de capital`, f.capitalGoods.length, jk.length);
        f.consumptionGoods.forEach((g, n) => {
          const it = jc[n]!;
          const w = `${toJ(id)} bien de consumo [${n}]`;
          counts.goods++;
          close(`${w} cantidad`, g.quantity, it['AbstractItem.quantity'], 0);
          close(`${w} valor`, g.value, it['AbstractItem.value'], 1e-12);
          close(`${w} precio`, g.price, it['AbstractGood.price'], 0);
          close(`${w} costo unitario`, g.unitCost, it['AbstractGood.unitCost'], 0);
          same(`${w} edad`, g.age, it['AbstractItem.age']);
          same(`${w} productor`, toJ(g.producer), ref(it['AbstractGood.producer']));
          same(`${w} duración`, g.duration, it['consumptionGoodDuration']);
        });
        f.capitalGoods.forEach((g, n) => {
          const it = jk[n]!;
          const w = `${toJ(id)} bien de capital [${n}]`;
          counts.goods++;
          close(`${w} cantidad`, g.quantity, it['AbstractItem.quantity'], 0);
          close(`${w} valor`, g.value, it['AbstractItem.value'], 1e-12);
          close(`${w} precio`, g.price, it['AbstractGood.price'], 1e-12);
          close(`${w} costo unitario`, g.unitCost, it['AbstractGood.unitCost'], 0);
          same(`${w} edad`, g.age, it['AbstractItem.age']);
          same(`${w} productor`, toJ(g.producer), ref(it['AbstractGood.producer']));
          same(`${w} productividad`, g.productivity, it['productivity']);
          same(`${w} duración`, g.duration, it['capitalDuration']);
          same(`${w} amortización`, g.amortization, it['capitalAmortization']);
          same(`${w} capital/trabajo`, g.capitalLaborRatio, it['capitalLaborRatio']);
          same(`${w} obsoleto`, g.obsolete, it['obsolete']);
        });
      }
    }

    // Hogares, empresas, bancos, gobierno: empleo, proveedores previos, rezagos y expectativas.
    const strat = (j: J, key: number): J => j['AbstractAgent.strategy'].strategies[String(key)];
    const lagsAndExp = (w: string, port: { lags: J; expectations: J }, j: J) => {
      const jl = j['SimpleAbstractAgent.passedValues'] as J;
      for (const [lid, pv] of Object.entries(jl)) {
        const obs = pv.passedValues as Record<string, number>;
        for (const [period, v] of Object.entries(obs)) {
          counts.lags++;
          const p = port.lags[lid]?.[period];
          if (p === undefined) {
            note(`${w} rezago ${lid}[${period}]: falta en el port (JMAB ${v})`);
            continue;
          }
          // NETWEALTH sale de saldos en µ: tolerancia de los double calculados a partir de montos.
          if (Number(lid) === LAG.NETWEALTH) close(`${w} rezago ${lid}`, p, v, 1e-6);
          else close(`${w} rezago ${lid}`, p, v, 1e-12);
        }
      }
      for (const [lid, m] of Object.entries(port.lags)) {
        for (const period of Object.keys(m as J)) {
          if (jl[lid]?.passedValues?.[period] === undefined) note(`${w} rezago ${lid}[${period}]: sobra en el port`);
        }
      }
      const je = (j['SimpleAbstractAgent.expectations'] ?? {}) as J;
      same(`${w} expectativas`, Object.keys(port.expectations).sort().join(), Object.keys(je).sort().join());
      for (const [eid, e] of Object.entries(je)) {
        const pe = port.expectations[eid];
        if (!pe) continue;
        counts.expectations++;
        const tol = Number(eid) === EXPECTATION.DEPOSITS ? 1e-6 : 1e-12;
        same(`${w} expectativa ${eid} filas`, pe.passed.length, e.passedValues.length);
        (e.passedValues as number[][]).forEach((row, r) => {
          close(`${w} expectativa ${eid}[${r}][0]`, pe.passed[r][0], row[0]!, tol);
          close(`${w} expectativa ${eid}[${r}][1]`, pe.passed[r][1], row[1]!, tol);
        });
        close(`${w} expectativa ${eid}`, pe.expectation, e.expectation, tol);
        same(`${w} λ ${eid}`, pe.lambda, e.adaptiveParam);
      }
    };

    for (const h of s.households) {
      const j = agents.get(toJ(h.id))!;
      const w = `hogar ${toJ(h.id)}`;
      same(`${w} empleador`, h.employer === null ? null : toJ(h.employer), ref(j['AbstractHousehold.employer']));
      same(`${w} salario`, h.wage, j['AbstractHousehold.wage']);
      same(`${w} dividendos`, h.dividendsReceived, toMicro(j['Households.dividendsReceived']));
      same(`${w} vendedor previo`, toJ(h.previousSeller), ref(strat(j, 0)['previousGoodSupplier']));
      same(`${w} banco previo`, toJ(h.previousBank), ref(strat(j, 11)['previousDepositSupplier']));
      lagsAndExp(w, h, j);
    }
    for (const f of [...s.consumptionFirms, ...s.capitalFirms]) {
      const j = agents.get(toJ(f.id))!;
      const w = `empresa ${toJ(f.id)}`;
      same(`${w} empleados`, f.employees.map(toJ).join(), (j['AbstractFirm.employees'] as J[]).map(ref).join());
      same(`${w} banco previo`, toJ(f.previousBank), ref(strat(j, 11)['previousDepositSupplier']));
      same(`${w} prestamista previo`, f.previousLender === null ? null : toJ(f.previousLender), ref(strat(j, 1)['previousLender']));
      if (f.previousCapitalSupplier !== null) {
        same(`${w} proveedor de capital previo`, toJ(f.previousCapitalSupplier), ref(strat(j, 0)['previousSupplier']));
      }
      lagsAndExp(w, f, j);
    }
    for (const b of s.banks) lagsAndExp(`banco ${toJ(b.id)}`, b, agents.get(toJ(b.id))!);
    const jg = agents.get(toJ(s.government.id))!;
    same('empleados públicos', s.government.employees.map(toJ).join(), (jg['Government.employees'] as J[]).map(ref).join());

    console.log('V1:', JSON.stringify(counts));
    expect(diffs).toEqual([]);
    expect(counts.contracts).toBeGreaterThan(30_000);
  }, 120_000);
});
