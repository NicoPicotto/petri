/**
 * Dinero en centavos enteros.
 *
 * Con flotantes, millones de sumas acumulan error y el invariante SFC
 * ("cada fila suma exactamente cero") deja de ser verificable. Con enteros
 * seguros (|x| ≤ 2^53 − 1 centavos ≈ 9 × 10^13 pesos) las sumas son exactas.
 *
 * Toda aritmética de dinero pasa por estos helpers para poder migrar a bigint
 * en el futuro sin tocar el resto del motor.
 */

export type Cents = number;

export function isCents(x: number): boolean {
  return Number.isSafeInteger(x);
}

export function assertCents(x: number, what = 'monto'): asserts x is Cents {
  if (!Number.isSafeInteger(x)) {
    throw new Error(`${what} tiene que ser un entero seguro de centavos, llegó ${x}`);
  }
}

export function assertPositiveCents(x: number, what = 'monto'): asserts x is Cents {
  assertCents(x, what);
  if (x <= 0) throw new Error(`${what} tiene que ser positivo, llegó ${x}`);
}

export function addCents(a: Cents, b: Cents): Cents {
  const r = a + b;
  assertCents(r, 'resultado de la suma');
  return r;
}

export function subCents(a: Cents, b: Cents): Cents {
  const r = a - b;
  assertCents(r, 'resultado de la resta');
  return r;
}

export function pesos(amount: number): Cents {
  const r = Math.round(amount * 100);
  assertCents(r);
  return r;
}
