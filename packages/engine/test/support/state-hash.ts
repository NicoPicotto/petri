/**
 * Hash SHA-256 del estado del port recorrido en orden (claves de objetos ordenadas, `Map` y `Set` como listas), alimentado de
 * a pedazos; los números no finitos como texto. Mismo método que reference/tools/prng-hash.test.ts. Para comparar dos
 * estados sin un `toEqual` del estado entero (lento: bloquea a vitest con el estado de 8.000 hogares).
 */
import { createHash } from 'node:crypto';

export function hashState(state: unknown): string {
  const h = createHash('sha256');
  const seen = new WeakSet<object>();
  let buf: string[] = [];
  let len = 0;
  const put = (x: string) => {
    buf.push(x);
    len += x.length;
    if (len > 1 << 20) {
      h.update(buf.join(''));
      buf = [];
      len = 0;
    }
  };
  const walk = (v: unknown): void => {
    if (v instanceof Map) {
      put('M[');
      for (const [k, x] of v) {
        walk(k);
        put(':');
        walk(x);
        put(',');
      }
      put(']');
    } else if (v instanceof Set) {
      put('S[');
      for (const x of v) {
        walk(x);
        put(',');
      }
      put(']');
    } else if (Array.isArray(v)) {
      put('[');
      for (const x of v) {
        walk(x);
        put(',');
      }
      put(']');
    } else if (v && typeof v === 'object') {
      if (seen.has(v)) {
        put('<ciclo>');
        return;
      }
      seen.add(v);
      put('{');
      for (const k of Object.keys(v).sort()) {
        put(JSON.stringify(k));
        put(':');
        walk((v as Record<string, unknown>)[k]);
        put(',');
      }
      put('}');
      seen.delete(v);
    } else if (typeof v === 'number') {
      put(Number.isFinite(v) ? JSON.stringify(v) : String(v));
    } else {
      put(JSON.stringify(v) ?? 'undefined');
    }
  };
  walk(state);
  h.update(buf.join(''));
  return h.digest('hex');
}
