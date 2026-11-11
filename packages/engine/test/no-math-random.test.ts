import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

// Fuentes de no determinismo prohibidas en el motor.
const FORBIDDEN = [/Math\.random/, /Date\.now/, /new Date\(/, /performance\.now/, /crypto\./];

// Determinismo entre navegadores: ECMAScript deja que cada motor aproxime a su
// manera las funciones trascendentales y el operador `**` ("implementation-
// approximated"), así que Chrome y Safari pueden dar resultados distintos en el
// último bit. Las cuatro operaciones, floor, ceil, round, min, max e imul son
// exactas según IEEE-754 y el estándar, y esas sí se permiten.
const TRANSCENDENTAL = [
  /Math\.(exp|expm1|log|log1p|log2|log10|pow|sqrt|cbrt|hypot)\b/,
  /Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh)\b/,
  /\*\*/,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

// Los comentarios pueden mencionar lo prohibido (para documentarlo); el código no.
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('motor determinista', () => {
  it('detecta un uso prohibido en código pero no en comentarios', () => {
    expect(FORBIDDEN[0]!.test(stripComments('// Math.random está prohibido'))).toBe(false);
    expect(FORBIDDEN[0]!.test(stripComments('const x = Math.random();'))).toBe(true);
  });

  it('no usa fuentes de azar ni de tiempo fuera del PRNG', () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((file) => {
      const code = stripComments(readFileSync(file, 'utf8'));
      return FORBIDDEN.filter((re) => re.test(code)).map((re) => `${file}: ${re}`);
    });
    expect(offenders).toEqual([]);
  });

  it('no usa funciones trascendentales ni ** (no son bit a bit iguales entre motores JS)', () => {
    const offenders = sourceFiles(SRC).flatMap((file) => {
      const code = stripComments(readFileSync(file, 'utf8'));
      return TRANSCENDENTAL.filter((re) => re.test(code)).map((re) => `${file}: ${re}`);
    });
    expect(offenders).toEqual([]);
  });

  it('el detector de trascendentales funciona', () => {
    expect(TRANSCENDENTAL[0]!.test('Math.pow(2, 3)')).toBe(true);
    expect(TRANSCENDENTAL[2]!.test(stripComments('const x = a ** 2;'))).toBe(true);
    expect(TRANSCENDENTAL[2]!.test(stripComments('/** xoshiro128** */'))).toBe(false);
  });
});
