/**
 * Dinero del port de Caiani: enteros seguros en µ, con 1 unidad de Caiani = 10⁶ µ
 * (decisión de Nico, 2026-11-12; docs/ledger-contratos.md, sec. 2.1).
 *
 * Lo que es dinero (saldos de contratos y montos de cada flujo) va en µ. Lo que no es dinero
 * (precios, tasas, expectativas, cantidades reales) va en double, calculado con las cuatro
 * operaciones. Todo flujo calculado en double pasa por `toMicro` una sola vez, al registrarse.
 *
 * Toda aritmética de dinero pasa por estos helpers, para poder migrar a bigint si los escenarios
 * con inflación alta lo piden (pendientes.md, "Escala monetaria").
 */

export type Micro = number;

/** µ por unidad de Caiani. */
export const MICRO_PER_UNIT = 1_000_000;

export function assertMicro(x: number, what = 'monto'): asserts x is Micro {
  if (!Number.isSafeInteger(x)) {
    throw new Error(`${what} tiene que ser un entero seguro de µ, llegó ${x}`);
  }
}

export function assertNonNegativeMicro(x: number, what = 'monto'): asserts x is Micro {
  assertMicro(x, what);
  if (x < 0) throw new Error(`${what} no puede ser negativo, llegó ${x}`);
}

/**
 * Unidades de Caiani (double) → µ. `Math.round` es exacta según el estándar, así que la conversión
 * es determinista. Ojo: redondea las mitades hacia +∞ (−2,5 → −2), también para negativos.
 */
export function toMicro(units: number): Micro {
  if (!Number.isFinite(units)) throw new Error(`toMicro: llegó ${units}`);
  const r = Math.round(units * MICRO_PER_UNIT);
  assertMicro(r, 'toMicro');
  // Math.round(−0,3) da −0; se normaliza para que la serialización sea estable.
  return r === 0 ? 0 : r;
}

/** µ → unidades de Caiani (double), para reglas de comportamiento y reportes. No es exacta. */
export function toUnits(x: Micro): number {
  return x / MICRO_PER_UNIT;
}

export function addMicro(a: Micro, b: Micro): Micro {
  const r = a + b;
  assertMicro(r, 'resultado de la suma');
  return r;
}

export function subMicro(a: Micro, b: Micro): Micro {
  const r = a - b;
  assertMicro(r, 'resultado de la resta');
  return r;
}

/**
 * Reparte `total` µ en proporción a `weights` por el método de restos mayores (Hamilton):
 * cada parte recibe el piso de su cuota y las unidades que sobran van a los restos más grandes.
 * Empates: gana el id más chico. La suma de las partes es exactamente `total`.
 *
 * Uso: dividendos a los hogares, liquidez de una empresa quebrada entre sus acreedores, quitas.
 * `ids` tiene que tener ids distintos (desempatan); `weights`, valores finitos ≥ 0 con suma > 0.
 */
export function allocateLargestRemainder(total: Micro, weights: readonly number[], ids: readonly number[]): Micro[] {
  assertNonNegativeMicro(total, 'total a repartir');
  const n = weights.length;
  if (ids.length !== n) throw new Error('allocateLargestRemainder: weights e ids de distinto largo');
  if (n === 0) {
    if (total === 0) return [];
    throw new Error('allocateLargestRemainder: no hay a quién repartir');
  }
  let sum = 0;
  for (const w of weights) {
    if (!Number.isFinite(w) || w < 0) throw new Error(`allocateLargestRemainder: peso inválido ${w}`);
    sum += w;
  }
  if (!(sum > 0)) throw new Error('allocateLargestRemainder: la suma de los pesos tiene que ser > 0');

  const parts = new Array<number>(n);
  const rest = new Array<number>(n);
  let assigned = 0;
  for (let i = 0; i < n; i++) {
    const quota = (total * (weights[i] as number)) / sum;
    const floor = Math.min(Math.floor(quota), total);
    parts[i] = floor;
    rest[i] = quota - floor;
    assigned += floor;
  }
  // Orden de prioridad: resto más grande primero; a igual resto, id más chico.
  const order = Array.from({ length: n }, (_, i) => i);
  const ids0 = ids;
  order.sort((a, b) => {
    const d = (rest[b] as number) - (rest[a] as number);
    if (d !== 0) return d;
    return (ids0[a] as number) - (ids0[b] as number);
  });
  let left = total - assigned;
  // Por el redondeo de double, la suma de los pisos puede pasarse en algunas unidades (muy raro):
  // se descuentan de los restos más chicos, sin dejar partes negativas.
  for (let k = n - 1; left < 0 && k >= 0; k--) {
    const i = order[k] as number;
    if ((parts[i] as number) > 0) {
      parts[i] = (parts[i] as number) - 1;
      left += 1;
      if (k === 0 && left < 0) k = n; // otra vuelta (no debería pasar)
    }
  }
  for (let k = 0; left > 0; k = (k + 1) % n) {
    const i = order[k] as number;
    if ((weights[i] as number) > 0) {
      parts[i] = (parts[i] as number) + 1;
      left -= 1;
    }
  }
  return parts;
}
