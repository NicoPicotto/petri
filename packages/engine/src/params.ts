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

/**
 * Mercado de bienes de la Fase 1 (R6 con fidelidad al proveedor, aprobada el
 * 2026-11-11). Fuente: Delli Gatti, Terranova & Turco (2023), WP 129 UCSC,
 * sección 3.9 y cuadro del Apéndice A (citan a Delli Gatti et al., 2010).
 */
export const MARKET = {
  /** β_s, intensidad de elección de un proveedor nuevo. Valor del cuadro del Apéndice A: 1. */
  supplierSwitchIntensity: 1,
} as const;

/**
 * Parámetros del crédito (R9) y del banco (R13), Fase 1. Detalle y fuentes en
 * docs/fase1-reglas.md. Aprobados por Nico el 2026-11-11. Salvo el coeficiente
 * de capital, son SUPUESTOS A CALIBRAR (Fase 3).
 */
export const CREDIT = {
  /** Tasa base (del BCRA), anual. Parámetro fijo en la Fase 1; perilla en la Fase 2. Supuesto. */
  baseRateAnnual: 0.03,
  /** R13: recargo proporcional del banco, r_L = (1 + μ_L)·r. Dosi et al. (2013), ec. 7 (allí μ_L = 0,5). */
  loanMarkup: 0.5,
  /** R9: plazo del crédito de capital de trabajo, en meses (cuotas iguales de capital). Supuesto. */
  loanTermMonths: 12,
  /**
   * R9: deuda máxima = λ · ventas del mes anterior. Forma de Dosi et al. (2013), ec. 3.
   * Valor: SUPUESTO. El paper es inconsistente (λ = 2 en el cuadro, 0 ≤ λ ≤ 1 en el
   * texto) y no define la duración del período.
   */
  debtToSalesMax: 3,
  /** R13: préstamos ≤ patrimonio del banco / este coeficiente. Mínimo de Basilea, aplicado por el BCRA. */
  capitalRatioMin: 0.08,
  /** R13: el banco reparte dividendos solo con el patrimonio por encima de esta fracción de los préstamos. Supuesto. */
  capitalRatioTarget: 0.1,
  /** R13: fracción de la ganancia que reparte el banco. Igual que R7. Supuesto. */
  bankDividendPayout: 0.9,
  /** R12: meses seguidos de cuota impaga que llevan a la quiebra (contra empresas zombis). Supuesto. */
  arrearsMonthsToBankruptcy: 3,
  /** R12: meses entre la quiebra y la entrada de la empresa que la reemplaza. Supuesto. */
  entryDelayMonths: 3,
  /** R12: capital inicial de la empresa entrante, en meses de su masa salarial. Supuesto. */
  entrantEquityMonths: 1,
  /**
   * R13 revisada (Assenza, Delli Gatti & Grazzini, 2015): el banco estima la
   * probabilidad mensual de quiebra φ(λ) con su historia de deudores.
   * Ventana y mínimo de datos aprobados por Nico (2026-11-11).
   */
  riskWindowMonths: 120,
  riskMinMonths: 24,
  /** Tramos de apalancamiento para agrupar las observaciones. Supuesto. */
  riskBins: 20,
  /** Iteraciones fijas de Newton para la logística (determinismo). Supuesto. */
  logisticIterations: 25,
  /** Tramos gruesos del fallback (frecuencias por tramo) si la logística es degenerada. Supuesto. */
  riskCoarseBands: 5,
  /**
   * Racionamiento (Stiglitz & Weiss, 1981, AER 71(3)): si φ supera este umbral
   * mensual, el banco rechaza el préstamo en vez de cobrar una tasa absurda.
   * Valor: SUPUESTO, con sensibilidad.
   */
  maxDefaultProbability: 0.03,
} as const;

/**
 * Capital y sector de bienes de capital (R11, aprobada el 2026-11-11). Fuentes:
 * Assenza, Delli Gatti & Grazzini (2015), CESifo WP 4765, ec. 5.3–5.6 y 6.1–6.3;
 * Caiani et al. (2016), JEDC 69. Detalle en docs/fase1-reglas.md. Salvo ω̄ y la
 * memoria ν, son SUPUESTOS A CALIBRAR (Fase 3).
 */
export const CAPITAL = {
  /** ω̄: utilización normal de la capacidad. Assenza et al. (2015), cuadro 2; Caiani et al. (2016): 80–90%. */
  normalUtilization: 0.85,
  /**
   * κ: unidades de bien de consumo por unidad de capital por mes. Sale del
   * objetivo capital/producto anual = 1,5 a la utilización normal (solo
   * maquinaria y equipo, sin construcciones ni vivienda): κ = 1/(12·ω̄·1,5).
   */
  capitalProductivity: 1 / (12 * 0.85 * 1.5),
  /**
   * δ: depreciación mensual del capital USADO (K −= δ·ω·K; Assenza et al., 2015,
   * ec. 5.5). Objetivo: ~6% anual a la utilización normal, δ = 0,06/(12·ω̄).
   */
  depreciationRate: 0.06 / (12 * 0.85),
  /** α_K: unidades de bien de capital por trabajador por mes. Normalización (igual a α). */
  capitalGoodsLaborProductivity: 10,
  /** ν: memoria del capital usado para la reposición (Assenza et al., 2015, cuadro 2). */
  replacementMemory: 0.5,
  /** r_K: recupero de la venta forzosa sobre el valor libro. Ramey & Shapiro (2001): 28 centavos por dólar. */
  fireSaleRecovery: 0.3,
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
  /** Patrimonio inicial del banco, como fracción de los depósitos privados iniciales (R13). Supuesto. */
  bankEquityShare: 0.05,
} as const;
