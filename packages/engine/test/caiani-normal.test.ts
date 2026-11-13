/**
 * Normal plegada determinista (normal.ts): cuantiles conocidos, momentos, Kolmogorov–Smirnov,
 * monotonía y determinismo (docs/ledger-contratos.md, sec. 2.8).
 */

import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import { Z_MAX, foldedCdf, foldedNormalFromUniform, foldedSurvival, inverseFoldedCdf } from '../src/caiani/normal';

describe('normal plegada: F y su inversa', () => {
  it('cuantiles conocidos de |Z| (referencia: statistics.NormalDist de Python)', () => {
    // u → z con P(|Z| ≤ z) = u, es decir z = Φ⁻¹((1 + u)/2).
    const cases: [number, number][] = [
      [0, 0],
      [0.5, 0.6744897501960817],
      [0.6826894921370859, 1],
      [0.95, 1.959963984540054],
      [0.99, 2.5758293035489004],
      [0.999, 3.290526731491895],
      [1 - 2 ** -20, 4.9009642079631925],
      [1 - 2 ** -32, 6.3379577545537895],
    ];
    for (const [u, z] of cases) expect(Math.abs(inverseFoldedCdf(u) - z)).toBeLessThan(2e-9);
  });

  it('F por serie y por fracción continua coinciden donde se empalman (z = 3)', () => {
    expect(Math.abs(foldedSurvival(3) - 0.0026997960632601913)).toBeLessThan(1e-15);
    expect(Math.abs(foldedSurvival(2.9999999) - foldedSurvival(3))).toBeLessThan(1e-9);
    expect(foldedCdf(3) + foldedSurvival(3)).toBeCloseTo(1, 15);
  });

  it('F(F⁻¹(u)) = u', () => {
    const rng = Rng.fromSeed(3);
    for (let k = 0; k < 2000; k++) {
      const u = rng.nextFloat();
      expect(Math.abs(foldedCdf(inverseFoldedCdf(u)) - u)).toBeLessThan(1e-11); // error de la interpolación
    }
  });

  it('es monótona en u, también alrededor de los nodos de la tabla', () => {
    const us: number[] = [];
    const rng = Rng.fromSeed(11);
    for (let k = 0; k < 100_000; k++) us.push(rng.nextFloat());
    for (let z = 0; z < Z_MAX; z += 1 / 256) {
      const f = foldedCdf(z);
      for (const d of [-1e-12, 0, 1e-12]) if (f + d >= 0 && f + d < 1) us.push(f + d);
    }
    us.sort((a, b) => a - b);
    let prev = -1;
    for (const u of us) {
      const z = inverseFoldedCdf(u);
      expect(z).toBeGreaterThanOrEqual(prev);
      prev = z;
    }
    expect(inverseFoldedCdf(1 - 2 ** -32)).toBeLessThan(Z_MAX);
  });
});

describe('normal plegada: sorteos', () => {
  const N = 1_000_000;
  const rng = Rng.fromSeed(2026);
  const draws = Array.from({ length: N }, () => foldedNormalFromUniform(rng.nextFloat(), 1));

  it('media σ√(2/π) y varianza σ²(1 − 2/π) con 10⁶ sorteos', () => {
    const mean = draws.reduce((s, x) => s + x, 0) / N;
    const variance = draws.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (N - 1);
    // Errores estándar: √(0,363/10⁶) ≈ 6·10⁻⁴ para la media, ≈ 1·10⁻³ para la varianza; margen de ~5.
    expect(Math.abs(mean - 0.7978845608028654)).toBeLessThan(3e-3);
    expect(Math.abs(variance - 0.36338022763241865)).toBeLessThan(5e-3);
  });

  it('Kolmogorov–Smirnov contra la distribución de |Z| (nivel 1%)', () => {
    const sample = draws.slice(0, 100_000).sort((a, b) => a - b);
    const n = sample.length;
    let d = 0;
    sample.forEach((x, i) => {
      const f = foldedCdf(x);
      d = Math.max(d, Math.abs((i + 1) / n - f), Math.abs(f - i / n));
    });
    expect(d).toBeLessThan(1.628 / Math.sqrt(n));
  });

  it('misma semilla, mismos valores; σ escala', () => {
    const a = Rng.fromSeed(9);
    const b = Rng.fromSeed(9);
    for (let k = 0; k < 100; k++) {
      const u = a.nextFloat();
      expect(foldedNormalFromUniform(u, 0.0094)).toBe(foldedNormalFromUniform(b.nextFloat(), 0.0094));
      expect(foldedNormalFromUniform(u, 2)).toBe(2 * inverseFoldedCdf(u));
    }
  });
});
