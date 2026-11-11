import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

// Fuentes de no determinismo prohibidas en el motor.
const FORBIDDEN = [/Math\.random/, /Date\.now/, /new Date\(/, /performance\.now/, /crypto\./];

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
});
