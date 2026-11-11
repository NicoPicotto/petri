/** Gráficos A vs. B superpuestos (uPlot), uno por indicador. */

import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { CapsuleView, Series } from '../capsule/coordinator';
import { formatNumber, formatPct } from '../format';

interface ChartSpec {
  title: string;
  pick: (s: Series) => (number | null)[];
  format: (v: number) => string;
}

const CHARTS: ChartSpec[] = [
  { title: 'Inflación interanual', pick: (s) => s.inflationYoY, format: (v) => formatPct(v) },
  { title: 'Desempleo', pick: (s) => s.unemployment, format: (v) => formatPct(v) },
  { title: 'Salario real (unidades del bien)', pick: (s) => s.realWage, format: (v) => formatNumber(v) },
  { title: 'Pobreza', pick: (s) => s.poverty, format: (v) => formatPct(v) },
  { title: 'Emisión efectiva (emisión / gasto)', pick: (s) => s.effectiveEmission, format: (v) => formatPct(v, 0) },
];

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function Chart({ spec, a, b, version }: { spec: ChartSpec; a: CapsuleView; b: CapsuleView; version: number }) {
  const container = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  const data = (): uPlot.AlignedData => {
    const n = Math.min(a.series.tick.length, b.series.tick.length);
    const years = a.series.tick.slice(0, n).map((t) => t / 12);
    return [years, spec.pick(a.series).slice(0, n), spec.pick(b.series).slice(0, n)];
  };

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const axis = { stroke: cssVar('--text-muted'), grid: { stroke: cssVar('--grid') }, ticks: { stroke: cssVar('--grid') } };
    const opts: uPlot.Options = {
      width: el.clientWidth,
      height: 180,
      legend: { show: true },
      scales: { x: { time: false } },
      axes: [
        { ...axis, label: 'años', values: (_u, vals) => vals.map((v) => String(v)) },
        { ...axis, size: 60, values: (_u, vals) => vals.map((v) => spec.format(v)) },
      ],
      series: [
        { label: 'año', value: (_u, v) => (v === null ? '—' : (v as number).toFixed(1)) },
        { label: 'A', stroke: cssVar('--capsule-a'), width: 1.5, value: (_u, v) => (v === null ? '—' : spec.format(v)) },
        { label: 'B', stroke: cssVar('--capsule-b'), width: 1.5, value: (_u, v) => (v === null ? '—' : spec.format(v)) },
      ],
    };
    plot.current = new uPlot(opts, data(), el);
    const resize = new ResizeObserver(() => plot.current?.setSize({ width: el.clientWidth, height: 180 }));
    resize.observe(el);
    return () => {
      resize.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
    // El gráfico se crea una vez; los datos se actualizan en el efecto de abajo.
  }, []);

  useEffect(() => {
    plot.current?.setData(data());
  }, [version]);

  return (
    <figure className="chart">
      <figcaption>{spec.title}</figcaption>
      <div ref={container} />
    </figure>
  );
}

export function Charts({ a, b, version }: { a: CapsuleView; b: CapsuleView; version: number }) {
  return (
    <section className="charts" aria-label="Gráficos A vs. B">
      {CHARTS.map((spec) => (
        <Chart key={spec.title} spec={spec} a={a} b={b} version={version} />
      ))}
    </section>
  );
}
