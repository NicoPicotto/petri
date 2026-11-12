# Arquitectura y convenciones

Estado al 2026-11-11 (final de la Fase 0). Lo que sigue describe cómo está armado el código y las convenciones que hay que respetar al extenderlo. Las reglas económicas están en [fase0-reglas.md](fase0-reglas.md) y la contabilidad en [sfc.md](sfc.md).

## Cómo correr

Requiere **Node ≥ 22.12** (Vite 7 no anda con Node 18). Ojo: si pnpm está instalado con Volta, corre con el Node con el que se instaló pnpm, no con el del proyecto; verificar con `pnpm exec node -v`.

| Comando (desde la raíz) | Qué hace |
|---|---|
| `pnpm install` | Instala el monorepo. |
| `pnpm test` | Tests rápidos del motor (~25 s; casi todo es el criterio de salida con 20 semillas). |
| `pnpm test:slow` | Suite lenta: archivos `*.slow.test.ts` (volatilidad según el tamaño y calentamiento con 2.000 hogares, ~75 s). Se separa con `PETRI_SLOW=1` en `packages/engine/vitest.config.ts`. |
| `pnpm typecheck` | `tsc` en engine (código y tests por separado) y en app. |
| `pnpm dev` | App en http://localhost:5173. |
| `pnpm --filter @petri/engine report:fase0` | Reporte del criterio de salida: cola del calentamiento por semilla, distribución de la inflación de A y B, emisión acumulada (~15 s). |
| `pnpm --filter @petri/engine report:fase1` | Diagnóstico con G = 0 (paso 1a.0): liquidez contra demanda, ahorro forzoso, dinero contra masa salarial, en tres escenarios (~25 s). Con argumento: `report:fase1 g0`, `report:fase1 escala` (volatilidad según el tamaño, ~45 s) o `report:fase1 variantes [frio|g0|caliente]` (variantes experimentales, ~1–2 min por escenario). |
| `pnpm --filter @petri/app e2e` | Prueba de punta a punta de la interfaz en Chrome headless (con `pnpm dev` corriendo). |

## Paquetes

- `packages/engine`: TypeScript puro, sin DOM (`lib: ES2022`, `types: []`). Lo consume la app como código fuente (`exports: ./src/index.ts`), sin build.
- `packages/app`: React + Vite. Un Web Worker por cápsula.
- `packages/data`: vacío (Fase 3).

## Motor (`packages/engine/src`)

| Archivo | Contenido |
|---|---|
| `rng.ts` | PRNG xoshiro128** sembrado con splitmix32. Estado = 4 enteros de 32 bits, guardado dentro de `SimState`. |
| `money.ts` | `Cents` (enteros seguros) y helpers. Toda la plata va en centavos. |
| `ledger.ts` | Instrumentos, primitivas `transfer` / `issue` / `redeem`, `checkAgentsSfc`. Ver [sfc.md](sfc.md). |
| `flows.ts` | Flujos compuestos: pagos entre privados, pagos al y del Tesoro, adelantos del BCRA, y los flujos del crédito (préstamos, cancelación, intereses, castigos, financiamiento del BCRA al banco). Ver [sfc.md](sfc.md). |
| `state.ts` | Tipos del estado, `createInitialState`, `cloneState` (copia escrita a mano, sin `structuredClone`), `PHASE0_CONFIG` (500 hogares, la usa la app hasta el paso 1c.6) y `PHASE1_CONFIG` (2.000 hogares y 120 empresas, decisión del 2026-11-11). |
| `params.ts` | Parámetros del modelo, cada uno con su fuente o marcado como supuesto. |
| `model.ts` | Las reglas de la Fase 0 como **etapas** (`Stage`) de un tick, en `PHASE0_STAGES`. |
| `phase1.ts` | **Registro del enfoque anterior** (ver `cambio-de-enfoque.md`; se reemplaza por el port de Caiani). Reglas de la Fase 1, tramo 1a (R9 crédito, R13 banco, R12 quiebras y entrada, R11 capital), en `PHASE1_STAGES` y `makePhase1Stages(credit, experiments, dividends, market, capital)`. Reusa las etapas de la Fase 0 que no cambian. Necesita empresas de capital (`SimConfig.capitalFirms > 0`; van al final de la lista de empresas). |
| `step.ts` | `step(state, knobs, options)`: puro, clona, corre las etapas, avanza el reloj y verifica SFC. |
| `warmup.ts` | `createWarmState`: estado inicial + calentamiento. |
| `knobs.ts` | Perillas, log (`KnobChange`), validación. |
| `replay.ts` | `replay(seed, initialState, log, ticks, { onTick })`. |
| `hash.ts` | `hashState`: FNV-1a doble (64 bits) sobre `JSON.stringify(state)`. |
| `snapshot.ts` | Snapshot plano para la visual (hoy la app arma el suyo en el worker). |

### Convenciones del motor

- **Etapas, no fases.** Las sub-etapas de un tick se llaman `Stage` para no confundirlas con las fases del roadmap. Una regla nueva = una etapa nueva (o un cambio en una existente) en la lista ordenada.
- **Pureza.** `step` no modifica el estado que recibe. Las etapas mutan la copia y solo pueden usar el `Rng` que reciben como fuente de azar.
- **Dos relojes.** `tick` es el mes visible: vuelve a 0 al terminar el calentamiento y es el tick del log de perillas. `elapsedTicks` cuenta todos los meses desde la creación y no se reinicia. Lo que dependa de "¿es el primer mes de vida?" usa `elapsedTicks`.
- **Semántica del log.** Un cambio con `tick = t` se aplica antes de calcular el paso t → t+1. El log tiene que estar ordenado y cada `from` tiene que coincidir con el valor vigente (si no, `replay` falla: el log no corresponde a esa corrida).
- **`replay` no resiembra el PRNG.** Sigue con el estado del generador de `initialState` y exige que `seed === initialState.seed`. Resembrar después del calentamiento repetiría la misma secuencia de números.
- **Determinismo entre navegadores.** Prohibido en `src/`: `Math.random`, `Date`, `performance.now`, `crypto`, funciones trascendentales (`exp`, `log`, `pow`, `sqrt`, trigonométricas) y el operador `**`. Lo verifica `test/no-math-random.test.ts`. Los tests y scripts sí pueden usarlas.
- **Orden de iteración.** Los agentes se recorren por ID o en un orden mezclado con el `Rng`. Los `sort` tienen que tener desempate total (ej.: precio y después ID).
- **Agregar campos al estado cambia el hash.** Cualquier campo nuevo en `SimState` invalida los hashes de los archivos de corrida existentes: hay que subir la versión del formato (ver abajo).

## App (`packages/app/src`)

- **Un worker por cápsula** (`worker/capsule.worker.ts`). El worker es la **fuente de verdad del log**: el tick de cada cambio de perilla es el tick de su estado al procesar el mensaje. Un `setKnob` que llega durante un lote se procesa al terminar el lote y se aplica al inicio del siguiente.
- **Protocolo** (`worker/protocol.ts`): todo pedido lleva `requestId` y recibe una sola respuesta (`batch`, `run` o `error`). Un `batch` trae el estado de cada hogar (arrays tipados transferibles), los indicadores de **cada** mes avanzado, las perillas y el log completo.
- **Lockstep** (`capsule/coordinator.ts`): en cada cuadro se pide `advance(k)` a las dos cápsulas y no se pide más hasta que respondieron ambas, así A y B siempre están en el mismo mes. Las respuestas de una "época" anterior (antes de un reset o un import) se descartan.
- **Las series y los promedios se calculan en la vista** (inflación interanual, promedio de 5 años). No entran al motor ni al hash, así que pueden usar `Math.pow`.
- **Grilla**: Canvas 2D a propósito (PixiJS en la Fase 5).

## Archivo de corrida (`run/runFile.ts`), versión 2

```json
{
  "format": "petri-run", "version": 2, "phase": 0,
  "seed": 20260101,
  "config": { "households": 500, "firms": 30, "burnInTicks": 420,
              "burnInKnobs": { "publicSpending": 5000000, "structuralDeficitShare": 0 } },
  "capsules": [
    { "id": "A", "initialKnobs": { … }, "log": [{ "tick": 47, "knob": "…", "from": 0, "to": 0.5 }],
      "ticks": 686, "finalStateHash": "6cfa4fa5c7621e33" },
    { "id": "B", … }
  ]
}
```

- Montos en centavos. `ticks` cuenta desde el mes 0 visible (el calentamiento no se cuenta).
- Al importar, cada worker hace `createWarmState` + `replay` y compara el hash. La vista muestra "Reproducción verificada ✓" o el detalle de la diferencia.
- La versión 1 (sin calentamiento) se rechaza: su hash ya no se puede verificar.
- La app valida `phase: 0`. Cuando cambie la fase, hay que decidir qué hacer con los archivos de fases anteriores.

## Cómo se verificó lo que no cubren los tests

- **Entre motores JS**: se empaquetó el motor con esbuild y se corrió la misma corrida en Node (V8, el de Chrome) y en JavaScriptCore (el de Safari; en macOS está en `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc`). Los hashes coincidieron, incluido un archivo exportado desde Chrome. Nico verificó en Safari la importación de un archivo v1 exportado en Chrome.
- **Interfaz de punta a punta**: [packages/app/scripts/e2e-cdp.mjs](../packages/app/scripts/e2e-cdp.mjs) levanta Chrome headless y lo maneja vía el protocolo DevTools: Play, mover una perilla de B, exportar, reset, importar y leer el cartel de verificación. Con `pnpm dev` corriendo: `pnpm --filter @petri/app e2e` (opciones `--url`, `--chrome`, `--extra-import <archivo>`). Sale con código 1 si la reproducción no verifica o hay errores en la consola. No usar `--virtual-time-budget`: la app pide cuadros sin parar y Chrome nunca termina.
