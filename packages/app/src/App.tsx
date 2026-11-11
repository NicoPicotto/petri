import { useEffect, useRef, useState } from 'react';
import { PHASE0_CONFIG } from '@petri/engine';
import type { MainToWorker, WorkerToMain } from './worker/protocol';

const SEED = 20260101;

export function App() {
  const workerRef = useRef<Worker | null>(null);
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('./worker/capsule.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
      const msg = event.data;
      if (msg.type === 'snapshot') {
        setTick(msg.snapshot.tick);
        setRunning(msg.running);
      } else {
        setError(msg.message);
        setRunning(false);
      }
    };
    send({ type: 'init', seed: SEED, config: PHASE0_CONFIG });
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  function send(msg: MainToWorker) {
    workerRef.current?.postMessage(msg);
  }

  function toggle() {
    const next = !running;
    setRunning(next);
    send({ type: next ? 'play' : 'pause' });
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>Petri — cápsula A</h1>
      <p>Semilla: {SEED}</p>
      <p style={{ fontSize: 48, fontVariantNumeric: 'tabular-nums', margin: '16px 0' }}>Tick: {tick}</p>
      <button onClick={toggle}>{running ? 'Pausa' : 'Play'}</button>
      {error && <p style={{ color: 'crimson' }}>Error en el motor: {error}</p>}
    </main>
  );
}
