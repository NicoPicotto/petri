/*
 * Petri — Copyright (C) 2026 Nicolas Picotto
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Piezas compartidas por el V3 de un tick (`caiani-v3.test.ts`) y la V3 que cruza ticks (`caiani-v3-chain.test.ts`):
 * la tabla de eventos portados (con los bloques del 75), los volcados de después de cada paso, el informe y la
 * verificación de una comparación de estado, y el informe de las decisiones forzadas del modo oráculo (d1).
 * Se sacaron de `caiani-v3.test.ts` sin cambiar su comportamiento (reglas-caiani.md, sec. 40).
 */
import { expect } from 'vitest';
import {
  computeExpectationsEvent,
  capitalPriceEvent,
  consumptionPriceEvent,
  capitalMarketFirstStepEvent,
  rdDecisionEvent,
  investmentDemandEvent,
  creditSupplyEvent,
  depositSupplyEvent,
  depositInterestEvent,
  creditDemandEvent,
  creditMarketEvent,
  laborSupplyEvent,
  laborDemandEvent,
  governmentLaborEvent,
  laborMarketEvent,
  productionEvent,
  rdOutcomeEvent,
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
  bondSupplyEvent,
  bondMarketFirstStepEvent,
  bondDemandEvent,
  reservesDemandBondEvent,
  reservesMarketBondEvent,
  cbBondsPurchasesEvent,
  bondMarketSecondStepEvent,
  reservesDemandBaselEvent,
  reservesMarketBaselEvent,
  populationHandlerEvent,
  UPDATE_EXPECTATIONS_BLOCKS,
  type DecisionRecorder,
  type CaianiRng,
  type CaianiState,
} from '../../src/caiani';
import { formatForced } from './jmab-decisions';
import { V3_CHAIN_RHO, type CompareResult } from './jmab-dump';

/**
 * Cierre de un lote de pagos en el V3: se informa y se exige que cierre sin cotas relajadas, con cada pago y cada
 * grupo a < 1 µ de su suma en double (decisión de Nico, 2026-11-13: lo estricto de los agregados derivados queda en
 * los componentes; reglas-caiani.md, sec. 1).
 */
/** Bordes redondeados por contrato del último lote cerrado (cota del lote por mecanismo; la lee el suelto). */
let lastEdgesMap: ReadonlyMap<number, number> | undefined;
export const lastEdges = (): ReadonlyMap<number, number> | undefined => lastEdgesMap;
export const resetLastEdges = (): void => {
  lastEdgesMap = undefined;
};
function settled(event: number, r: { relaxed: boolean; maxPaymentDiff: number; maxGroupDiff: number; edges: ReadonlyMap<number, number> }): void {
  lastEdgesMap = r.edges;
  const maxEdges = Math.max(0, ...r.edges.values());
  console.log(`evento ${event}, cierre del lote: ${JSON.stringify({ payments: (r as { payments?: number }).payments, relaxed: r.relaxed, maxPaymentDiff: r.maxPaymentDiff, maxGroupDiff: r.maxGroupDiff, maxEdges })}`);
  expect(r.relaxed).toBe(false);
  expect(r.maxPaymentDiff).toBeLessThan(1);
  expect(r.maxGroupDiff).toBeLessThan(1);
}

/** Eventos portados, en orden. */
export const EVENTS: { e: number; run: (s: CaianiState, rng: CaianiRng) => void }[] = [
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
  { e: 11, run: laborSupplyEvent },
  { e: 12, run: laborDemandEvent },
  { e: 13, run: governmentLaborEvent },
  { e: 14, run: laborMarketEvent },
  { e: 15, run: (s) => productionEvent(s) },
  { e: 16, run: (s) => rdOutcomeEvent(s) },
  { e: 17, run: (s) => consumptionDemandEvent(s) },
  { e: 18, run: (s, rng) => settled(18, consumptionMarketEvent(s, rng)) },
  { e: 19, run: (s, rng) => settled(19, capitalMarketSecondStepEvent(s, rng)) },
  { e: 20, run: (s) => settled(20, creditInterestsEvent(s)) },
  { e: 21, run: (s, rng) => settled(21, wagePaymentEvent(s, rng)) },
  { e: 22, run: (s) => settled(22, bondInterestEvent(s)) },
  { e: 23, run: (s) => settled(23, advanceInterestEvent(s)) },
  { e: 24, run: (s) => settled(24, taxesEvent(s)) },
  { e: 25, run: (s) => settled(25, dividendsEvent(s)) },
  { e: 26, run: (s) => settled(26, depositDemandEvent(s)) },
  { e: 27, run: depositMarketEvent },
  { e: 28, run: bankBankruptcyEvent },
  { e: 29, run: (s) => bondSupplyEvent(s) },
  { e: 30, run: bondMarketFirstStepEvent },
  { e: 31, run: (s) => bondDemandEvent(s) },
  { e: 32, run: (s) => reservesDemandBondEvent(s) },
  { e: 33, run: reservesMarketBondEvent },
  { e: 34, run: (s) => cbBondsPurchasesEvent(s) },
  { e: 35, run: bondMarketSecondStepEvent },
  { e: 36, run: (s) => reservesDemandBaselEvent(s) },
  { e: 37, run: reservesMarketBaselEvent },
  // 38–73: reportes, no tocan el estado (no se portan); el suelto del 74 arranca del volcado del 37.
  { e: 74, run: (s) => populationHandlerEvent(s) },
  // Evento 75 por bloques (despacho de JMAB: consumo, capital, bancos, gobierno, hogares, BC), contra los volcados de adentro
  // del 75 (`tick-T-ev-75-in-K-Clase.jsonl`, DUMP_INSIDE) y el del 75 (reglas-caiani.md, sec. 38–39). 75.k = bloque k.
  ...UPDATE_EXPECTATIONS_BLOCKS.map((run, k) => ({ e: 75 + (k + 1) / 10, run: (s: CaianiState) => run(s) })),
];
export const LAST = EVENTS[EVENTS.length - 1]!.e;
/** Volcados de los bloques del 75: el que hay **después** de cada bloque (el de antes del bloque siguiente, y el del 75). */
export const END_DUMPS: Record<number, string> = {
  75.1: '75-in-1-CopyOfCapitalFirm2WagesEnd',
  75.2: '75-in-2-Bank',
  75.3: '75-in-3-GovernmentAntiCyclical',
  75.4: '75-in-4-HouseholdsWithDole',
  75.5: '75-in-5-CentralBank',
  75.6: '75',
};
/** Volcado de JMAB después del paso e del tick t. */
export const afterDump = (tick: number, e: number): string => `tick-${tick}-ev-${END_DUMPS[e] ?? e}.jsonl`;
/** Evento anterior en la lista (el 74 sigue al 37: los reportes 38–73 no se portan). */
export const prevEvent = (e: number): number => EVENTS[EVENTS.findIndex((x) => x.e === e) - 1]!.e;

/**
 * Campos que no cumplen la regla general de tolerancia y quedan **reportados** (no se agranda la tolerancia):
 * se informan en cada corrida y esperan una decisión de Nico. Ver reglas-caiani.md, sec. 1, "Tolerancias".
 * Cada entrada es el tipo de campo (la etiqueta sin ids ni índices, como la imprime `compareState`) y en qué
 * modalidad se reporta.
 * - Montos: ninguno desde el redondeo con arrastre (2026-11-13).
 * - Bienes de consumo después del evento 18, encadenado (2026-11-13): cantidades y valores que son **residuos**
 *   (lo que queda del inventario de una empresa después de decenas de ventas, o el resto de la demanda de un
 *   hogar en su segunda compra). El error absoluto es el de las demandas del encadenado (~10⁻⁶), pero relativo
 *   a un residuo chico pasa el 10⁻⁶. En el evento suelto son bit a bit. Ver reglas-caiani.md, sec. 17.
 * - Morosidad de un banco en el evento 20, suelto: **resuelta** con la regla de agregados derivados (2026-11-13;
 *   ya no se reporta). Registro: en el tick 108 la
 *   morosidad del banco 8255 queda a 3,67 µ de JMAB. Suma lo que queda de los 5 préstamos de la empresa 8182
 *   (todos de ese banco): cada préstamo está a < 1 µ de lo que recibe en double (redondeo controlado), pero la suma
 *   de los 5 no tiene cota propia (~3,1 µ), más el error de entrada de los saldos (~0,5 µ). reglas-caiani.md, sec. 19.
 */
export const REPORTED_FIELDS: { field: string; chainedOnly: boolean; events?: number[] }[] = [];

/** Montos con diferencia > 0, por tipo de campo: máximo, cuántos superan la tolerancia y de cuántos. */
function reportAmounts(tick: number, label: string, r: CompareResult): void {
  const rows = Object.entries(r.amountFields)
    .filter(([, v]) => v.max > 0)
    .map(([k, v]) => `${k}: máx ${v.max} µ${v.over > 0 ? `, ${v.over} de ${v.n} sobre la tolerancia` : ''}`);
  if (rows.length > 0) console.log(`Montos, tick ${tick}, ${label}:\n  ${rows.join('\n  ')}`);
}

/**
 * Informa una comparación de estado y falla con las diferencias que superan la tolerancia. Los campos de
 * `REPORTED_FIELDS` (en su modalidad) que la superan se informan aparte y no hacen fallar el test
 * (reglas-caiani.md, sec. 1, "Tolerancias": campos reportados). `chained`: la comparación es del encadenado.
 * Toda diferencia de estado que no sea un campo reportado es falla (sin la excusa de las frágiles desde el paso 6 de d1).
 */
export function checkCompare(r: CompareResult, tick: number, label: string, event: number, chained: boolean): void {
  console.log(`V3 tick ${tick}, ${label}:`, JSON.stringify(r.counts));
  // Regla del cociente indeterminado (reglas-caiani.md, sec. 40): campos que no se comparan.
  if (r.indeterminate.length > 0) console.log(`Cociente indeterminado en los dos lados, tick ${tick}, ${label} (no se compara): ${r.indeterminate.join('; ')}`);
  reportAmounts(tick, label, r);
  const scaledRows = Object.entries(r.scaled)
    .filter(([, v]) => v.maxErrOverS > 0)
    .sort((a, b) => b[1].maxErrOverS - a[1].maxErrOverS)
    // Los 8 con el peor cociente y, siempre, los que necesitaron la escala para pasar.
    .filter(([, v], i) => i < 8 || v.byScale > 0)
    .map(([k, v]) => `${k}: diferencia/S máx ${v.maxErrOverS.toExponential(2)}, ρ·S máx ${v.maxRhoS.toPrecision(3)}${v.byScale > 0 ? `, ${v.byScale} pasan solo por ρ·S` : ''}`);
  if (scaledRows.length > 0) console.log(`Escala de los flujos, tick ${tick}, ${label} (ρ = ${V3_CHAIN_RHO}):\n  ${scaledRows.join('\n  ')}`);
  const reported = REPORTED_FIELDS.filter((f) => (chained || !f.chainedOnly) && (!f.events || f.events.includes(event))).map((f) => f.field);
  const isReported = (kind: string) => reported.includes(kind);
  const reportedRows = [...Object.entries(r.amountFields), ...Object.entries(r.doubleFieldsOver)].filter(([k, v]) => isReported(k) && v.over > 0);
  if (reportedRows.length > 0) {
    console.log(`Campos reportados, tick ${tick}, ${label}:\n  ${reportedRows.map(([k, v]) => `${k}: ${v.over} sobre la tolerancia, máx ${v.max}`).join('\n  ')}`);
  }
  const unexpected = r.diffs.filter((d) => !isReported(d.slice(0, d.indexOf(':')).replace(/\d+/g, '#')));
  expect(unexpected).toEqual([]);
  // `diffs` guarda solo las primeras 40: si se llenó con reportados, el total tiene que cuadrar con ellos.
  const reportedOver = reportedRows.reduce((a, [, v]) => a + v.over, 0);
  expect(r.total - reportedOver).toBe(unexpected.length);
}

/** Totales del modo oráculo de una modalidad (suelto, encadenado o un tick de un tramo). */
export interface D1Totals {
  forced: number;
  residue: number;
  indeterminate: number;
  alarms: number;
  consumed: number;
}
export const newD1Totals = (): D1Totals => ({ forced: 0, residue: 0, indeterminate: 0, alarms: 0, consumed: 0 });

/**
 * Informe de las decisiones forzadas de un evento (modo oráculo, d1): las suma a `t` e imprime el detalle (las primeras
 * 20 y, si hay más, el resumen por lugar, agente y tipo). Devuelve la distancia máxima del port de las forzadas.
 */
export function d1Report(t: D1Totals, tick: number, label: string, e: number, rec: DecisionRecorder, from: number, toJ: (id: number) => number): number {
  const list = rec.forced.slice(from);
  const consumed = rec.consumed.get(e) ?? 0;
  t.forced += list.filter((f) => f.kind === 'frágil').length;
  t.residue += list.filter((f) => f.kind === 'residuo').length;
  t.indeterminate += list.filter((f) => f.kind === 'indeterminada').length;
  t.alarms += list.filter((f) => f.alarm).length;
  t.consumed += consumed;
  if (list.length === 0 && consumed === 0) return 0;
  const maxCorr = Math.max(0, ...list.map((f) => f.distancePort));
  const maxRaw = Math.max(0, ...list.map((f) => f.distancePortRaw));
  console.log(
    `d1, tick ${tick}, ${label}: ${list.length} forzadas (frágiles ${list.filter((f) => f.kind === 'frágil').length}, R2 ${list.filter((f) => f.kind === 'residuo').length}, ` +
      `alarmas ${list.filter((f) => f.alarm).length}), distancia máx del port ${maxCorr.toPrecision(3)} (cruda ${maxRaw.toPrecision(3)}), ` +
      `${consumed} líneas de JMAB consumidas sin evaluar` +
      (list.length > 0 ? `\n  ${formatForced(list.slice(0, 20), toJ).join('\n  ')}${list.length > 20 ? `\n  … y ${list.length - 20} más` : ''}` : ''),
  );
  if (list.length > 20) {
    // Resumen agrupado por tipo y lugar, con la cantidad de agentes y los primeros 10: todas las forzadas del evento, aunque
    // el detalle se corte. No una línea por agente: con las 8.000 R2 del evento 21 (ticks 133, 146 y 300) eso era un
    // console.log de 8.000 líneas, que en el pool `forks` de vitest provoca el "Timeout calling onTaskUpdate" y el código de
    // salida 1 (diagnóstico del 2026-11-17, reference/tools/rpc-timeout-repro.test.ts; reglas-caiani.md, sec. 1, "Suites").
    const groups = new Map<string, { n: number; agents: Set<number> }>();
    for (const f of list) {
      const key = `${f.kind}: "${f.site}"`;
      const g = groups.get(key) ?? { n: 0, agents: new Set<number>() };
      g.n++;
      if (f.agent !== undefined) g.agents.add(toJ(f.agent));
      groups.set(key, g);
    }
    const rows = [...groups].map(([k, g]) => {
      const ids = [...g.agents];
      const shown = ids.slice(0, 10).join(', ') + (ids.length > 10 ? `, … (${ids.length - 10} más)` : '');
      return `${g.n} × ${k}${ids.length > 0 ? `, ${ids.length} agentes: ${shown}` : ''}`;
    });
    console.log(`d1, tick ${tick}, ${label}, por tipo y lugar:\n  ${rows.join('\n  ')}`);
  }
  return maxCorr;
}
