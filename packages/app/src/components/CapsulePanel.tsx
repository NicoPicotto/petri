import { useState } from 'react';
import type { KnobChange, KnobName } from '@petri/engine';
import type { CapsuleView, Coordinator } from '../capsule/coordinator';
import { formatNumber, formatPct, formatPesos } from '../format';
import { DotGrid, type GridMode } from './DotGrid';
import { KnobSlider } from './KnobSlider';

const KNOB_LABELS: Record<KnobName, string> = {
  publicSpending: 'Gasto público',
  structuralDeficitShare: 'Déficit estructural financiado con emisión',
};

function formatKnob(knob: KnobName, value: number): string {
  return knob === 'publicSpending' ? `${formatPesos(value)}/mes` : formatPct(value, 0);
}

function last<T>(xs: T[]): T | undefined {
  return xs[xs.length - 1];
}

function Indicator({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="indicator" title={hint}>
      <span className="indicator-label">{label}</span>
      <span className="indicator-value">{value}</span>
    </div>
  );
}

function LogList({ log }: { log: KnobChange[] }) {
  if (log.length === 0) return <p className="muted">Sin cambios de perillas.</p>;
  return (
    <ol className="log">
      {[...log].reverse().map((e, i) => (
        <li key={log.length - i}>
          <span className="log-tick">mes {e.tick}</span> {KNOB_LABELS[e.knob]}: {formatKnob(e.knob, e.from)} →{' '}
          {formatKnob(e.knob, e.to)}
        </li>
      ))}
    </ol>
  );
}

export function CapsulePanel({ view, coordinator }: { view: CapsuleView; coordinator: Coordinator }) {
  const [mode, setMode] = useState<GridMode>('employment');
  const s = view.series;
  const yoy = last(s.inflationYoY);
  const p = s.priceIndex;
  const monthly = p.length > 1 ? p[p.length - 1]! / p[p.length - 2]! - 1 : null;
  // Promedio anual de los últimos 5 años (geométrico). Solo para mostrar: no entra al motor.
  const avg5y = p.length > 60 ? Math.pow(p[p.length - 1]! / p[p.length - 61]!, 1 / 5) - 1 : null;
  const recentEmission = s.effectiveEmission.slice(-12);
  const emission12 = recentEmission.length > 0 ? recentEmission.reduce((a, b) => a + b, 0) / recentEmission.length : null;

  return (
    <section className={`capsule capsule-${view.id.toLowerCase()}`} aria-label={`Cápsula ${view.id}`}>
      <h2>
        <span className="capsule-swatch" aria-hidden /> Cápsula {view.id}
      </h2>

      <div className="knobs">
        <KnobSlider
          label={KNOB_LABELS.publicSpending}
          value={view.knobs.publicSpending}
          min={0}
          max={20_000_000}
          step={100_000}
          format={(v) => formatKnob('publicSpending', v)}
          onCommit={(v) => void coordinator.setKnob(view.id, 'publicSpending', v)}
        />
        <KnobSlider
          label={KNOB_LABELS.structuralDeficitShare}
          value={view.knobs.structuralDeficitShare}
          min={0}
          max={1}
          step={0.05}
          format={(v) => formatKnob('structuralDeficitShare', v)}
          onCommit={(v) => void coordinator.setKnob(view.id, 'structuralDeficitShare', v)}
        />
      </div>

      <div className="grid-block">
        <DotGrid status={view.status} income={view.income} mode={mode} />
        <div className="grid-legend" role="radiogroup" aria-label="Color de la grilla">
          <label>
            <input type="radio" checked={mode === 'employment'} onChange={() => setMode('employment')} /> Empleo
          </label>
          <label>
            <input type="radio" checked={mode === 'income'} onChange={() => setMode('income')} /> Ingreso (quintiles)
          </label>
          {mode === 'employment' ? (
            <span className="legend-keys">
              <i className="key key-employed" /> ocupado <i className="key key-unemployed" /> desocupado
            </span>
          ) : (
            <span className="legend-keys">
              <i className="key key-q1" /> más bajo … <i className="key key-q5" /> más alto
            </span>
          )}
        </div>
      </div>

      <div className="indicators">
        <Indicator
          label="Inflación interanual"
          value={yoy !== null && yoy !== undefined ? formatPct(yoy) : `${formatPct(monthly)} mensual`}
          hint="Variación del índice de precios respecto de 12 meses antes"
        />
        <Indicator
          label="Inflación anual, prom. 5 años"
          value={formatPct(avg5y)}
          hint="Promedio anual (geométrico) de los últimos 60 meses. Aparece a partir del año 5."
        />
        <Indicator label="Desempleo" value={formatPct(last(s.unemployment))} />
        <Indicator label="Salario real" value={formatNumber(last(s.realWage))} hint="Salario promedio en unidades del bien" />
        <Indicator label="Pobreza" value={formatPct(last(s.poverty))} hint="Hogares con ingreso menor a la canasta (provisional)" />
        <Indicator
          label="Emisión efectiva (12 meses)"
          value={formatPct(emission12, 0)}
          hint="Emisión / gasto, promedio de los últimos 12 meses. Incluye el déficit estructural y el cíclico."
        />
      </div>

      <details className="log-block" open>
        <summary>Log de perillas ({view.log.length})</summary>
        <LogList log={view.log} />
      </details>
    </section>
  );
}
