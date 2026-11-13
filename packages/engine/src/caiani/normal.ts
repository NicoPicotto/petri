/**
 * Normal plegada determinista: |N(0, σ)| = σ · F⁻¹(u), con F(z) = 2Φ(z) − 1 la distribución de |Z|
 * y u uniforme en [0, 1). Aprobada por Nico el 2026-11-12 (pendientes.md, "Normal plegada").
 *
 * - Un uniforme por sorteo y monótona en u (números aleatorios comunes entre cápsulas).
 * - Sin funciones trascendentales (principio 4): F se calcula con las cuatro operaciones y `expNeg`,
 *   en una tabla de nodos que se arma al cargar el módulo; entre nodos, interpolación cúbica de
 *   Hermite de z(u), con las derivadas exactas dz/du = 1/(2φ(z)).
 * - Se corta en z = 6,5: F(6,5) = 1 − 8·10⁻¹¹, más allá del uniforme más grande que da el PRNG
 *   (1 − 2⁻³², que corresponde a z ≈ 6,33).
 * - En modo oráculo (V3) no se usa: el Rng semántico devuelve el valor |N| que registró el `.jar`.
 *
 * Cálculo de F:
 * - z < 3: serie de Marsaglia, 2Φ(z) − 1 = 2φ(z) · Σ z^(2n+1) / (1·3·5···(2n+1)) (todos los
 *   términos positivos, sin cancelación).
 * - z ≥ 3: el complemento, 1 − F(z) = 2φ(z) · R(z), con la razón de Mills R por fracción continua
 *   (Laplace): R(z) = 1/(z + 1/(z + 2/(z + 3/(z + ...)))). Así la cola tiene error relativo chico.
 */

import { expNeg } from '../detmath';

/** 1/√(2π). */
const INV_SQRT_2PI = 0.3989422804014327;
/** Paso de la tabla en z. */
const H = 1 / 256;
export const Z_MAX = 6.5;
const TAIL_FROM = 3;
const CF_TERMS = 300;

function phi(z: number): number {
  return INV_SQRT_2PI * expNeg((z * z) / 2);
}

/** Serie de Marsaglia: Σ z^(2n+1) / (2n+1)!!. */
function marsagliaSum(z: number): number {
  const z2 = z * z;
  let term = z;
  let sum = z;
  for (let n = 1; n < 500; n++) {
    term = (term * z2) / (2 * n + 1);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

/** Razón de Mills (1 − Φ(z)) / φ(z) por fracción continua, evaluada de atrás para adelante. */
function millsRatio(z: number): number {
  let v = z;
  for (let k = CF_TERMS; k >= 1; k--) v = z + k / v;
  return 1 / v;
}

/** 1 − F(z) = P(|Z| > z), para z ≥ 0. */
export function foldedSurvival(z: number): number {
  if (!(z >= 0)) throw new Error(`foldedSurvival: z tiene que ser ≥ 0, llegó ${z}`);
  if (z < TAIL_FROM) return 1 - 2 * phi(z) * marsagliaSum(z);
  return 2 * phi(z) * millsRatio(z);
}

/** F(z) = P(|Z| ≤ z) = 2Φ(z) − 1, para z ≥ 0. */
export function foldedCdf(z: number): number {
  if (!(z >= 0)) throw new Error(`foldedCdf: z tiene que ser ≥ 0, llegó ${z}`);
  if (z < TAIL_FROM) return 2 * phi(z) * marsagliaSum(z);
  return 1 - 2 * phi(z) * millsRatio(z);
}

// Tabla de nodos: z_i = i·H; F_i, G_i = 1 − F_i (calculado directo en la cola) y m_i = dz/du = 1/(2φ(z_i)).
const N_NODES = Math.round(Z_MAX / H) + 1;
const NODE_Z: number[] = [];
const NODE_F: number[] = [];
const NODE_G: number[] = [];
const NODE_SLOPE: number[] = [];
for (let i = 0; i < N_NODES; i++) {
  const z = i * H;
  NODE_Z.push(z);
  NODE_F.push(foldedCdf(z));
  NODE_G.push(foldedSurvival(z));
  NODE_SLOPE.push(1 / (2 * phi(z)));
}

/**
 * F⁻¹(u) para u en [0, 1): el z ≥ 0 con P(|Z| ≤ z) = u. Por encima del último nodo
 * (u > 1 − 8·10⁻¹¹, que el PRNG no produce) devuelve Z_MAX.
 */
export function inverseFoldedCdf(u: number): number {
  if (!(u >= 0 && u < 1)) throw new Error(`inverseFoldedCdf: u tiene que estar en [0, 1), llegó ${u}`);
  const last = N_NODES - 1;
  if (u >= (NODE_F[last] as number)) return Z_MAX;
  // Búsqueda binaria del intervalo [F_i, F_{i+1}) que contiene a u.
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((NODE_F[mid] as number) <= u) lo = mid;
    else hi = mid;
  }
  const i = lo;
  const z0 = NODE_Z[i] as number;
  const z1 = NODE_Z[i + 1] as number;
  // En la cola se trabaja con el complemento g = 1 − u (exacto para u ≥ 1/2) para no perder dígitos.
  let delta: number;
  let t: number;
  if (z0 >= TAIL_FROM) {
    delta = (NODE_G[i] as number) - (NODE_G[i + 1] as number);
    t = ((NODE_G[i] as number) - (1 - u)) / delta;
  } else {
    delta = (NODE_F[i + 1] as number) - (NODE_F[i] as number);
    t = (u - (NODE_F[i] as number)) / delta;
  }
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * z0 + h10 * delta * (NODE_SLOPE[i] as number) + h01 * z1 + h11 * delta * (NODE_SLOPE[i + 1] as number);
}

/** |N(0, σ)| a partir de un uniforme u en [0, 1). */
export function foldedNormalFromUniform(u: number, sigma: number): number {
  if (!(sigma >= 0)) throw new Error(`foldedNormal: σ tiene que ser ≥ 0, llegó ${sigma}`);
  return sigma * inverseFoldedCdf(u);
}
