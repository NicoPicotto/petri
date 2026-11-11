/**
 * Grilla de hogares: un punto por hogar. Canvas 2D a propósito (PixiJS entra en la Fase 5).
 */

import { useEffect, useRef } from 'react';

export type GridMode = 'employment' | 'income';

const COLUMNS = 25;
const CELL = 12;
const DOT = 9;

interface Props {
  status: Uint8Array;
  income: Float64Array;
  mode: GridMode;
}

function quintileThresholds(income: Float64Array): number[] {
  const sorted = Array.from(income).sort((a, b) => a - b);
  return [0.2, 0.4, 0.6, 0.8].map((q) => sorted[Math.floor(q * (sorted.length - 1))] ?? 0);
}

export function DotGrid({ status, income, mode }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const n = status.length;
  const rows = Math.max(1, Math.ceil(n / COLUMNS));

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const css = getComputedStyle(canvas);
    const color = (name: string) => css.getPropertyValue(name).trim();
    const employed = color('--dot-employed');
    const unemployed = color('--dot-unemployed');
    const ramp = [1, 2, 3, 4, 5].map((i) => color(`--dot-q${i}`));
    const thresholds = mode === 'income' ? quintileThresholds(income) : [];

    const ratio = window.devicePixelRatio || 1;
    canvas.width = COLUMNS * CELL * ratio;
    canvas.height = rows * CELL * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, COLUMNS * CELL, rows * CELL);
    for (let i = 0; i < n; i++) {
      if (mode === 'employment') {
        ctx.fillStyle = status[i] === 1 ? employed : unemployed;
      } else {
        const x = income[i] ?? 0;
        const q = thresholds.filter((t) => x > t).length;
        ctx.fillStyle = ramp[q] ?? unemployed;
      }
      const cx = (i % COLUMNS) * CELL;
      const cy = Math.floor(i / COLUMNS) * CELL;
      ctx.fillRect(cx + (CELL - DOT) / 2, cy + (CELL - DOT) / 2, DOT, DOT);
    }
  }, [status, income, mode, n, rows]);

  return (
    <canvas
      ref={ref}
      className="dot-grid"
      style={{ width: COLUMNS * CELL, height: rows * CELL }}
      role="img"
      aria-label={`Grilla de ${n} hogares`}
    />
  );
}
