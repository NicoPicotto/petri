/*
 * Petri — Copyright (C) 2026 Nicolas Picotto
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Traducción a TypeScript, MODIFICADA, de código de:
 *   JMAB / modelo Benchmark — Copyright (C) 2013 Alessandro Caiani and Antoine Godin
 *   (GNU GPL v3 o posterior). https://github.com/S120/jmab, https://github.com/S120/benchmark
 * Origen: el orden de los eventos de la lista `events` de Model/modelFile.xml (referencia: benchmarkModel.jar del paper).
 * Modificaciones: ver docs/reglas-caiani.md, sec. 2 (mapa del tick).
 */

/**
 * Un tick (trimestre) del port de Caiani: los eventos de comportamiento en el orden de JMAB (reglas-caiani.md, sec. 2):
 * 0–37, 74 y el 75 en sus seis bloques (75.1–75.6, el orden de despacho de JMAB). Los reportes (38–73) no tocan el estado y
 * no están en la lista; el gancho `afterEvent` con el evento 37 es su lugar.
 *
 * Aprobado por Nico el 2026-11-17 (P4): reemplaza las copias de esta lista en las herramientas de reference/tools. El arnés
 * del V3 (test/support/v3-steps.ts) conserva la suya, con sus controles por evento; `caiani-tick.test.ts` verifica que las
 * dos tengan el mismo orden y den el mismo estado.
 */
import { beginPeriod } from './flows';
import type { CaianiRng } from './rng';
import type { CaianiState } from './state';
import {
  UPDATE_EXPECTATIONS_BLOCKS,
  advanceInterestEvent,
  bankBankruptcyEvent,
  bondDemandEvent,
  bondInterestEvent,
  bondMarketFirstStepEvent,
  bondMarketSecondStepEvent,
  bondSupplyEvent,
  capitalMarketFirstStepEvent,
  capitalMarketSecondStepEvent,
  capitalPriceEvent,
  cbBondsPurchasesEvent,
  computeExpectationsEvent,
  consumptionDemandEvent,
  consumptionMarketEvent,
  consumptionPriceEvent,
  creditDemandEvent,
  creditInterestsEvent,
  creditMarketEvent,
  creditSupplyEvent,
  depositDemandEvent,
  depositInterestEvent,
  depositMarketEvent,
  depositSupplyEvent,
  dividendsEvent,
  governmentLaborEvent,
  investmentDemandEvent,
  laborDemandEvent,
  laborMarketEvent,
  laborSupplyEvent,
  populationHandlerEvent,
  productionEvent,
  rdDecisionEvent,
  rdOutcomeEvent,
  reservesDemandBaselEvent,
  reservesDemandBondEvent,
  reservesMarketBaselEvent,
  reservesMarketBondEvent,
  taxesEvent,
  wagePaymentEvent,
} from './events';

/** Un evento del tick: `id` es su índice en la lista de JMAB (75 + k/10 para el bloque k del evento 75). */
export interface TickEvent {
  readonly id: number;
  readonly run: (s: CaianiState, rng: CaianiRng) => unknown;
}

/** Los eventos del tick, en el orden de JMAB. */
export const CAIANI_TICK_EVENTS: readonly TickEvent[] = [
  { id: 0, run: (s) => computeExpectationsEvent(s) },
  { id: 1, run: capitalPriceEvent },
  { id: 2, run: consumptionPriceEvent },
  { id: 3, run: capitalMarketFirstStepEvent },
  { id: 4, run: (s) => rdDecisionEvent(s) },
  { id: 5, run: investmentDemandEvent },
  { id: 6, run: creditSupplyEvent },
  { id: 7, run: depositSupplyEvent },
  { id: 8, run: (s) => depositInterestEvent(s) },
  { id: 9, run: (s) => creditDemandEvent(s) },
  { id: 10, run: creditMarketEvent },
  { id: 11, run: laborSupplyEvent },
  { id: 12, run: laborDemandEvent },
  { id: 13, run: governmentLaborEvent },
  { id: 14, run: laborMarketEvent },
  { id: 15, run: (s) => productionEvent(s) },
  { id: 16, run: (s) => rdOutcomeEvent(s) },
  { id: 17, run: (s) => consumptionDemandEvent(s) },
  { id: 18, run: consumptionMarketEvent },
  { id: 19, run: capitalMarketSecondStepEvent },
  { id: 20, run: (s) => creditInterestsEvent(s) },
  { id: 21, run: wagePaymentEvent },
  { id: 22, run: (s) => bondInterestEvent(s) },
  { id: 23, run: (s) => advanceInterestEvent(s) },
  { id: 24, run: (s) => taxesEvent(s) },
  { id: 25, run: (s) => dividendsEvent(s) },
  { id: 26, run: (s) => depositDemandEvent(s) },
  { id: 27, run: depositMarketEvent },
  { id: 28, run: bankBankruptcyEvent },
  { id: 29, run: (s) => bondSupplyEvent(s) },
  { id: 30, run: bondMarketFirstStepEvent },
  { id: 31, run: (s) => bondDemandEvent(s) },
  { id: 32, run: (s) => reservesDemandBondEvent(s) },
  { id: 33, run: reservesMarketBondEvent },
  { id: 34, run: (s) => cbBondsPurchasesEvent(s) },
  { id: 35, run: bondMarketSecondStepEvent },
  { id: 36, run: (s) => reservesDemandBaselEvent(s) },
  { id: 37, run: reservesMarketBaselEvent },
  // 38–73: reportes de JMAB (no tocan el estado).
  { id: 74, run: (s) => populationHandlerEvent(s) },
  ...UPDATE_EXPECTATIONS_BLOCKS.map((run, k) => ({ id: 75 + (k + 1) / 10, run: (s: CaianiState) => run(s) })),
];

/** Ganchos de un tick (no cambian el estado si quien los pasa no lo hace). */
export interface TickHooks {
  /** Después de cada evento, con su `id` (p. ej. para medir tiempos o, con el 37, calcular los reportes). */
  afterEvent?: (id: number, s: CaianiState) => void;
}

/**
 * Corre un tick: avanza la ronda (`s.round` + 1; la inicialización deja 0), abre el período del registro de flujos
 * (`beginPeriod`: sin eso el registro crece sin límite) y corre los eventos en orden.
 */
export function caianiTick(s: CaianiState, rng: CaianiRng, hooks: TickHooks = {}): void {
  s.round += 1;
  beginPeriod(s.ledger);
  for (const ev of CAIANI_TICK_EVENTS) {
    ev.run(s, rng);
    hooks.afterEvent?.(ev.id, s);
  }
}
