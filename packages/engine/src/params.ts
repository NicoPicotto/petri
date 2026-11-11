/**
 * Parámetros del modelo de la Fase 0.
 *
 * Detalle de cada regla y sus fuentes: docs/fase0-reglas.md.
 * Salvo que se indique otra cosa, los valores son SUPUESTOS A CALIBRAR, no
 * valores tomados de un paper.
 */

import type { Cents } from './money';

export const PARAMS = {
  /** Unidades de bien producidas por trabajador por mes. Normalización (no tiene contenido empírico). */
  laborProductivity: 10,

  /** R1: tope del ajuste aleatorio de precio, u ~ U(0, h). Supuesto a calibrar. Regla: Gaffeo et al. (2008). */
  priceStepMax: 0.05,
  /** R1: tope del ajuste aleatorio de cantidad, u ~ U(0, h). Supuesto a calibrar. Regla: Gaffeo et al. (2008). */
  quantityStepMax: 0.05,

  /** R2: tope de la suba salarial cuando quedan vacantes sin cubrir. Supuesto a calibrar. */
  wageStepMax: 0.05,

  /** R4: empresas con vacantes que mira cada desocupado. Supuesto a calibrar. Regla: Riccetti et al. (2015). */
  laborSearchSize: 4,
  /** R6: empresas que mira cada hogar para comprar. Supuesto a calibrar. Regla: CATS (Delli Gatti et al., 2011). */
  goodsSearchSize: 3,

  /** R5: propensión a consumir del ingreso disponible (mensual). Forma de SIM; valor propio a calibrar (SIM usa 0,6). */
  consumeOutOfIncome: 0.9,
  /** R5: propensión a consumir de la riqueza (mensual). Forma de SIM; valor propio a calibrar (SIM usa 0,4). */
  consumeOutOfWealth: 0.05,

  /** R7: fracción de la ganancia positiva que se reparte como dividendo. Caiani et al. (2016). */
  dividendPayout: 0.9,

  /** Indicador de pobreza: unidades del bien en la canasta mensual. Provisional hasta tener datos de la EPH. */
  basketUnits: 6,
} as const;

export const INITIAL = {
  /** Salario mensual inicial, en centavos (1000 pesos). Unidad arbitraria: el modelo no tiene nivel de precios absoluto. */
  wage: 100_000 as Cents,
  /** Precio inicial = costo unitario × este factor. Supuesto. */
  markup: 1.1,
  /** Fracción de hogares empleados al inicio. Supuesto. */
  employmentRate: 0.92,
  /** Depósitos iniciales de los hogares, en meses de salario. Supuesto (coincide con la riqueza de estado estacionario de R5). */
  householdDepositMonths: 2,
  /** Depósitos iniciales de las empresas, en meses de masa salarial. Supuesto. */
  firmDepositMonths: 2,
} as const;
