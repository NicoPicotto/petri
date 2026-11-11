/**
 * Generador de números pseudoaleatorios con semilla.
 *
 * Algoritmo: xoshiro128** (Blackman & Vigna, 2018, "Scrambled Linear
 * Pseudorandom Number Generators"). Estado de 4 × uint32, período 2^128 − 1.
 * La semilla se expande a 4 palabras con splitmix32, como recomiendan los autores
 * para evitar estados iniciales con muchos ceros.
 *
 * El estado es un array plano de números: se puede guardar dentro de SimState,
 * clonar y serializar. Así `step` es una función pura.
 *
 * En el motor está prohibido Math.random (hay un test que lo verifica).
 */

export type RngState = [number, number, number, number];

const UINT32_RANGE = 4294967296; // 2^32

/** Expande una semilla entera a un estado inicial de xoshiro128**. */
export function createRngState(seed: number): RngState {
  if (!Number.isInteger(seed)) {
    throw new Error(`La semilla tiene que ser un entero, llegó ${seed}`);
  }
  let s = seed >>> 0;
  const next = (): number => {
    // splitmix32
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
  const state: RngState = [next(), next(), next(), next()];
  // xoshiro no puede arrancar con estado todo en cero.
  if (state.every((w) => w === 0)) state[0] = 1;
  return state;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * Vista mutable sobre un RngState. Se crea al inicio de un tick y al final se
 * vuelve a escribir en el estado con `toState()`.
 */
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(state: RngState) {
    [this.s0, this.s1, this.s2, this.s3] = state;
  }

  static fromSeed(seed: number): Rng {
    return new Rng(createRngState(seed));
  }

  toState(): RngState {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  /** Entero uniforme en [0, 2^32). */
  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Real uniforme en [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / UINT32_RANGE;
  }

  /**
   * Entero uniforme en [0, maxExclusive). Para maxExclusive mucho menor que
   * 2^32 (siempre es el caso acá) el sesgo de usar floor es despreciable.
   */
  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error(`nextInt necesita un entero positivo, llegó ${maxExclusive}`);
    }
    return Math.floor(this.nextFloat() * maxExclusive);
  }

  /** Real uniforme en [0, max). */
  uniform(max: number): number {
    return this.nextFloat() * max;
  }

  /** Mezcla el array en el lugar (Fisher-Yates). */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /** Un elemento al azar. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick sobre una lista vacía');
    return items[this.nextInt(items.length)] as T;
  }
}
