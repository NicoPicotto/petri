/**
 * Hash del estado, para verificar que una corrida importada se reprodujo exacta.
 *
 * Serialización: JSON.stringify. El orden de las claves es el de creación (el
 * motor siempre crea los objetos en el mismo orden) y el formato de los números
 * está fijado por el estándar ECMAScript, así que es igual en todos los motores JS.
 *
 * Hash: FNV-1a de 32 bits, aplicado dos veces con bases distintas (64 bits en
 * total). Sirve para detectar diferencias, no es criptográfico.
 */

import type { SimState } from './state';

function fnv1a(text: string, basis: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function hashState(state: SimState): string {
  const text = JSON.stringify(state);
  const a = fnv1a(text, 0x811c9dc5);
  const b = fnv1a(text, 0x050c5d1f);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
