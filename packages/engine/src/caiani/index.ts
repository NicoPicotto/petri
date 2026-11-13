/**
 * Port de Caiani et al. (2016): infraestructura de P1 (docs/plan-port-caiani.md, docs/ledger-contratos.md).
 * Convive con el motor de la Fase 0 y del tramo 1a hasta P6; no se exporta desde src/index.ts todavía.
 */
export * from './money';
export * from './ledger';
export * from './flows';
export * from './normal';
export * from './rng';
export * from './params';
export * from './state';
export * from './init';
export * from './events';
export * from './decisions';
