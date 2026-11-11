import { useRef, useState } from 'react';
import { SPEEDS, type Coordinator } from '../capsule/coordinator';
import { formatMonth } from '../format';
import { downloadRunFile, parseRunFile } from '../run/runFile';

export function RunControls({ coordinator, tick }: { coordinator: Coordinator; tick: number }) {
  const [seedDraft, setSeedDraft] = useState(String(coordinator.seed));
  const fileInput = useRef<HTMLInputElement>(null);
  const seedValid = /^\d+$/.test(seedDraft) && Number(seedDraft) <= 0xffffffff;

  const onImport = async (file: File) => {
    try {
      const run = parseRunFile(await file.text());
      setSeedDraft(String(run.seed));
      await coordinator.importRun(run);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <header className="controls">
      <h1>Petri</h1>
      <label className="seed">
        Semilla{' '}
        <input
          value={seedDraft}
          inputMode="numeric"
          onChange={(e) => setSeedDraft(e.target.value.trim())}
          aria-invalid={!seedValid}
        />
      </label>
      <button onClick={() => coordinator.setRunning(!coordinator.running)}>
        {coordinator.running ? '❚❚ Pausa' : '▶ Play'}
      </button>
      <button disabled={!seedValid} onClick={() => void coordinator.reset(Number(seedDraft))} title="Reinicia las dos cápsulas con la semilla">
        Reset
      </button>
      <span className="speed" role="radiogroup" aria-label="Velocidad">
        Velocidad:
        {SPEEDS.map((s) => (
          <button key={s} aria-pressed={coordinator.speed === s} onClick={() => coordinator.setSpeed(s)}>
            {s}
          </button>
        ))}
        meses/s
      </span>
      <span className="tick">{formatMonth(tick)}</span>
      <span className="spacer" />
      <button
        onClick={async () => {
          try {
            downloadRunFile(await coordinator.exportRun());
          } catch (err) {
            alert(err instanceof Error ? err.message : String(err));
          }
        }}
      >
        Exportar corrida
      </button>
      <button onClick={() => fileInput.current?.click()}>Importar</button>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void onImport(file);
        }}
      />
    </header>
  );
}
