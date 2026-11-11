import { useEffect, useState, useSyncExternalStore } from 'react';
import { Coordinator } from './capsule/coordinator';
import { Charts } from './components/Charts';
import { CapsulePanel } from './components/CapsulePanel';
import { RunControls } from './components/RunControls';

const DEFAULT_SEED = 20260101;

function Lab({ coordinator }: { coordinator: Coordinator }) {
  const version = useSyncExternalStore(coordinator.subscribe, coordinator.getVersion);
  const { A, B } = coordinator.views;
  const v = coordinator.verification;

  return (
    <main>
      <RunControls coordinator={coordinator} tick={A.tick} />
      {coordinator.error && <p className="banner banner-error">Error en el motor: {coordinator.error}</p>}
      {v?.kind === 'verified' && (
        <p className="banner banner-ok">
          Reproducción verificada ✓ — hash A {v.hashes.A} · B {v.hashes.B}
        </p>
      )}
      {v?.kind === 'mismatch' && <p className="banner banner-error">La reproducción no coincide: {v.detail}</p>}
      <div className="capsules">
        <CapsulePanel view={A} coordinator={coordinator} />
        <CapsulePanel view={B} coordinator={coordinator} />
      </div>
      <Charts a={A} b={B} version={version} />
    </main>
  );
}

export function App() {
  const [coordinator, setCoordinator] = useState<Coordinator | null>(null);

  useEffect(() => {
    const c = new Coordinator(DEFAULT_SEED);
    void c.reset();
    setCoordinator(c);
    return () => c.dispose();
  }, []);

  return coordinator ? <Lab coordinator={coordinator} /> : null;
}
