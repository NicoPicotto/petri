/**
 * Matemática determinista: solo las cuatro operaciones, con cantidad fija de
 * pasos. Da el mismo resultado bit a bit en cualquier motor JS (principio 4 de
 * CLAUDE.md: Math.exp y compañía no están garantizadas iguales entre motores).
 */

/** Pasos de reducción de rango: e^−x = (e^(−x/2^K))^(2^K). */
const HALVINGS = 8;
const SCALE = 256; // 2^HALVINGS
/** Términos de la serie de Taylor de e^−y para y ≤ MAX_X / SCALE. */
const TERMS = 10;
/** Más allá de esto, e^−x < 1e−17: se devuelve 0. */
const MAX_X = 40;

/**
 * e^−x para x ≥ 0. Error relativo < 1e−12 en [0, 40] (verificado contra
 * Math.exp en test/detmath.test.ts).
 */
export function expNeg(x: number): number {
  if (!(x >= 0)) throw new Error(`expNeg: x tiene que ser ≥ 0, llegó ${x}`);
  if (x > MAX_X) return 0;
  const y = x / SCALE;
  // Taylor de e^−y con Horner: 1 − y(1 − y/2(1 − y/3(1 − ...)))
  let sum = 1;
  for (let n = TERMS; n >= 1; n--) sum = 1 - (y / n) * sum;
  let result = sum;
  for (let k = 0; k < HALVINGS; k++) result = result * result;
  return result;
}
