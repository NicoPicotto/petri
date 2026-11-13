# Petri — simulador de economía política (nombre de trabajo)

## Estado actual (2026-11-12)

- **Cambio de enfoque (decisión de Nico, 2026-11-12):** el modelo base pasa a ser **Caiani et al. (2016)**, portado fielmente y verificado contra su código (JMAB). Las particularidades argentinas entran como extensiones documentadas. Motivos, estado de cada regla, lo aprendido e infraestructura que se reutiliza: [docs/cambio-de-enfoque.md](docs/cambio-de-enfoque.md).
- **Fase 0: cerrada** con sus reglas propias (CATS + SIM). La app la sigue usando hasta que el port de Caiani pase sus criterios. El criterio de salida de la Fase 0 se vuelve a correr con el port.
- **Fase 1, tramo 1a (enfoque anterior): cerrado como registro.** El código está en `packages/engine/src/phase1.ts`. Por defecto: R10 apagada y la regla de cantidad original del sector de capital; con eso el criterio de la Fase 0 se cumple en 20/20. Todo el registro está en `docs/fase1-reglas.md`.
- **Plan del port aprobado (Nico, 2026-11-12):** [docs/plan-port-caiani.md](docs/plan-port-caiani.md). Decisiones: período **trimestral** primero (mensual después, como extensión), **10 bancos**, **bonos ahora**, gobierno de Caiani como base, **8.000 hogares**, JDK para un oráculo con trazas, y el **`.jar` del paper como referencia canónica**.
- **P0 cerrado** (registro en [docs/caiani-referencia.md](docs/caiani-referencia.md)): V0 hecho (el fuente equivalente al `.jar` es `reference/jmab-2015`), paper leído, oráculo reproducible armado, lotes de 25 y de 100 réplicas del `.jar` analizados. La tabla publicada del paper no sale del `.jar` (inflación 0,53% contra 0,42% publicado, muy fuera de la variación entre réplicas); por decisión de Nico, el objetivo de V4 es la distribución del `.jar`. Criterio de V4 escrito en el plan (sec. 4); 100 réplicas por lado; las 100 del `.jar` están hechas (2026-11-13, referencia en `reference/p0/runs/resumen-100.json`). **P1 hecho (2026-11-13):** módulo `packages/engine/src/caiani/` (dinero en µ, ledger de contratos, invariantes de flujos, normal plegada, `Rng` semántico con modo oráculo), con las decisiones de Nico registradas en [docs/ledger-contratos.md](docs/ledger-contratos.md). **P2 hecho (2026-11-13):** `caiani/init.ts` reproduce la inicialización de JMAB y V1 se cumple contra el volcado del oráculo agente por agente ([docs/inicializacion.md](docs/inicializacion.md)); corrige la nota de P1 sobre la condonación de los préstamos iniciales (no existe). Mezclas en modo PRNG con el algoritmo sesgado de JMAB, a propósito (decisión de Nico, 2026-11-13). **P3 en curso:** V3 por evento (el oráculo vuelca el estado antes y después de cada evento); eventos 0–18 portados y verificados en los ticks 1 y 50 (`double` puros bit a bit en el evento suelto); regla general de tolerancia de los montos (2 µ en el evento suelto, 2 µ por evento en el encadenado), que se cumple en todos los montos desde el redondeo con arrastre (decisión de Nico, 2026-11-13; cambia la cuota de los préstamos, ver `docs/ledger-contratos.md`); los pagos entre agentes usan el **redondeo controlado por evento** (decisión de Nico, 2026-11-13; `caiani/payments.ts`); en el encadenado hasta el evento 18 hay campos reportados que esperan decisión de Nico (`docs/reglas-caiani.md`, sec. 17); el V3 cuenta las decisiones discretas frágiles y las que se dan vuelta (`caiani/decisions.ts`); los V3 de referencia son los que arrancan en los ticks 50, 200 y 399 (el 1 es el caso límite, por la simetría inicial); los eventos del final del tick son el 74 y el 75 (no 135 y 136); sigue el evento 19; registro en [docs/reglas-caiani.md](docs/reglas-caiani.md). **Norma (Nico, 2026-11-13):** si al implementar aparece una regla o un cambio no aprobado, se propone antes de meterlo.
- **Licencia:** GPL-3.0-or-later (decisión de Nico, 2026-11-12). `LICENSE`, `NOTICE`, y encabezado obligatorio en los archivos portados (plantilla en `docs/arquitectura.md`, "Licencia y avisos").
- El código de Caiani (clones, `.jar` del paper, scripts de R) está en `reference/`, fuera de git. Ver `reference/README.md`.
- Al arrancar una sesión, leer en este orden:
  1. [docs/plan-port-caiani.md](docs/plan-port-caiani.md): plan del port, versiones del código de Caiani, mapa de reglas, verificación, decisiones, licencia. Junto con [docs/caiani-referencia.md](docs/caiani-referencia.md): qué código es la referencia, diferencias paper ↔ código, corridas y oráculo (P0); [docs/inicializacion.md](docs/inicializacion.md) (P2, V1) y [docs/reglas-caiani.md](docs/reglas-caiani.md) (P3: método de V3 por evento, mapa del tick, reglas portadas).
  2. [docs/cambio-de-enfoque.md](docs/cambio-de-enfoque.md): por qué Caiani es el modelo base, estado de cada regla del enfoque anterior, lo aprendido, infraestructura reutilizable.
  3. [docs/pendientes.md](docs/pendientes.md): qué quedó abierto y qué extensiones argentinas están identificadas.
  4. [docs/arquitectura.md](docs/arquitectura.md): cómo correr el proyecto, estructura del motor y de la app, convenciones (etapas, relojes, log, replay, determinismo), formato del archivo de corrida.
  5. [docs/sfc.md](docs/sfc.md): matriz de balances y primitivas contables.
  6. Registro histórico, cuando haga falta: [docs/fase1-reglas.md](docs/fase1-reglas.md) (tramo 1a con el enfoque anterior: mediciones, errores, revisión contra fuentes) y [docs/fase0-reglas.md](docs/fase0-reglas.md) (reglas R1–R8 de la Fase 0).
- Comandos: `pnpm test`, `pnpm test:slow`, `pnpm typecheck`, `pnpm dev`, `pnpm --filter @petri/engine report:fase0`, `pnpm --filter @petri/engine report:fase1`. Requiere Node ≥ 22.12.

## Visión

Un simulador de economía política que funciona como una **cápsula de Petri**: se aplica un "tratamiento" (políticas económicas) a una sociedad simulada y se observa qué emerge. No es un juego donde uno encarna a un ciudadano. El usuario es un científico/gobernante que observa la cápsula y, si quiere, interviene moviendo perillas.

Combina lo mejor de **Democracy 4** (perillas de política, grupos con reclamos y aprobación) y **Victoria 3** (población por estratos con necesidades y nivel de vida, industrias que crecen o quiebran, grupos de interés). Le suma algo que ninguno de los dos tiene: rigor de modelo basado en agentes y validación contra la historia económica argentina.

- Proyecto **open source, sin fines de lucro**. Hoy es una herramienta personal de exploración y aprendizaje.
- Tiene que correr liviano en una MacBook, en el navegador.
- Está gamificado: los agentes se ven (pixel art o baja resolución). No es solo gráficos.

## Principios de diseño (no negociables)

1. **Los resultados emergen, no se programan.** No puede existir código del tipo "emisión → inflación". La inflación, el desempleo, la brecha cambiaria y demás tienen que surgir de la interacción entre agentes.
2. **Lo que tiene consenso es regla fija; lo que se discute es perilla.** Las reglas de comportamiento con amplio consenso empírico se implementan como reglas. Lo que está en disputa entre escuelas económicas se implementa como **perilla de teoría** visible y conmutable (ej.: inflación monetarista vs. estructuralista). El simulador no puede tener sesgos ideológicos escondidos.
   - Ejemplo de referencia: la relación entre emisión e inflación es fuerte en países con inflación alta, pero débil con inflación baja (De Grauwe & Polan, 2005). Lo que se discute son los mecanismos: si el déficit es causa o síntoma, el peso de la inercia, la indexación y las expectativas, el traslado de la devaluación a precios, y si conviene desinflar con shock o de manera gradual.
3. **Contabilidad stock-flujo consistente (SFC).** Cada peso es activo de alguien y pasivo de otro. Nunca aparece ni desaparece dinero de la nada. Esto tiene que verificarse con un invariante en cada tick (en tests y en modo debug).
4. **Determinismo total.** Generador de números aleatorios con semilla (PRNG seedeado). **Prohibido `Math.random`** en el motor. Misma semilla + mismo log de perillas = misma corrida, exacta, **también entre navegadores**: por eso el motor tampoco usa funciones trascendentales (`Math.exp`, `log`, `pow`, `sqrt`, trigonométricas) ni el operador `**`, que el estándar deja aproximar distinto a cada motor JS. Solo se usan las cuatro operaciones, `floor`, `ceil`, `round`, `min`, `max` e `imul`, que son exactas. Un test lo verifica.
5. **Cada regla de comportamiento se documenta con su fuente** (paper, modelo de referencia o supuesto explícito). Nada de números mágicos sin explicación.
6. **Sin agentes LLM.** Los agentes son reglas simples. Los LLM son caros y terminan moviendo los resultados más que las políticas que se quieren probar.
7. **El motor está separado de la visual.** El motor es TypeScript puro, sin DOM. La visual solo consume snapshots del estado.

## Modelo: agentes y capas

### Capa económica

- **Hogares**: ingreso, sector donde trabajan, condición formal o informal, empleo o desempleo, ahorro en **pesos o en dólares**, estrato.
- **Empresas** por sector: **agro, industria, servicios, comercio**. Cada una tiene perfil **exportador o importador**. Fijan precios, contratan, invierten, pueden abrir o quebrar.
- **Bancos**: depósitos, crédito, encajes.
- **Tesoro**: recauda, gasta, se endeuda.
- **BCRA**, separado del Tesoro: emite, fija la tasa, administra las reservas y el régimen cambiario. La separación Tesoro/BCRA es clave para simular déficit financiado con emisión.
- **Resto del mundo** (el "clima" de la cápsula): precios de commodities, tasa internacional (Fed), acceso a crédito externo. Admite shocks: sequías, suba de tasas, caída de commodities.

### Capa social (inspirada en Victoria 3)

- Los hogares se agrupan en **estratos** con **necesidades** (alimentos, vivienda, servicios, etc.) y un **nivel de vida**.
- Los **reclamos surgen de necesidades insatisfechas**.

### Capa política (inspirada en Democracy 4 y Victoria 3)

- **Grupos de interés**: sindicatos, industriales, campo, jubilados (extensible). Cada uno tiene un nivel de aprobación o enojo hacia las políticas vigentes.
- **Retroalimentación**: la cápsula genera reclamos y el usuario decide si responde moviendo perillas. No hay elecciones ni cambios de gobierno automáticos.
- **Ignorar reclamos tiene consecuencias económicas**, con reglas visibles y documentadas igual que las perillas:
  - Sindicato enojado → paros → cae la producción.
  - Industriales enojados → frenan la inversión.
  - Ahorristas desconfiados → se pasan al dólar (presión cambiaria, corridas).
- Si el usuario prefiere solo observar, no mueve ninguna perilla y la cápsula sigue su curso, con sus consecuencias.

### Log de perillas

- **Cada movimiento de perilla queda registrado** con el tick/fecha simulada, la perilla, el valor anterior y el valor nuevo.
- **Una corrida = semilla + condiciones iniciales + log.** Esto permite:
  - Reproducir cualquier corrida de forma exacta.
  - **Reaplicar el mismo log en otra cápsula con otro contexto mundial** (con sequía o sin sequía, por ejemplo) para separar las buenas decisiones de la suerte.
  - Exportar, importar y compartir corridas.

## Perillas

Tipos de control:
- **Discretas** para los regímenes grandes, porque cambiar de régimen es un evento: régimen cambiario, default.
- **Deslizadores continuos** para las magnitudes: alícuotas, tasas, montos (al estilo Democracy).
- **Perillas de teoría**: seleccionan qué mecanismo en disputa usa el modelo (ver principio 2).

| Área | Perillas |
|---|---|
| **Fiscal: impuestos** | IVA, Ganancias, retenciones a exportaciones |
| **Fiscal: gasto** | Jubilaciones, planes sociales, empleo público, obra pública |
| **Fiscal: subsidios** | Energía y transporte; subsidios a industrias puntuales |
| **Monetaria** | Financiamiento del BCRA al Tesoro (emisión), tasa de interés, encajes bancarios |
| **Deuda** | Tomar deuda interna o externa, en pesos o en dólares; default o reestructuración (discreta) |
| **Cambiaria** (discreta) | Libre, fijo tipo convertibilidad, crawling peg, cepo, dolarización |
| **Comercio exterior** | Aranceles, cupos o licencias de importación |
| **Regulación** | Control de precios, salario mínimo, paritarias, costo de despido |

## Indicadores

**Los indicadores se calculan con la misma metodología que el INDEC** (por ejemplo, pobreza e indigencia por canasta básica y no por un umbral inventado), para poder comparar con las series reales.

- **Macro**: inflación, PBI, desempleo, salario real, déficit fiscal (primario y financiero), deuda/PBI, reservas, brecha cambiaria, riesgo país, balanza comercial.
- **Social**: pobreza e indigencia, Gini, informalidad, nivel de vida por estrato.
- **Sectorial**: empresas por sector, aperturas y quiebras, inversión, empleo por sector.
- **Político**: aprobación por grupo de interés, conflictividad (paros, cortes, corridas al dólar).

## Cápsulas en paralelo

Esto es un **requisito central**, no un extra. Varias cápsulas corren en simultáneo con la **misma población inicial y la misma semilla** pero distintas políticas (o distinto contexto mundial), y se ven lado a lado en cámara rápida para comparar contrafácticos.

## Fuentes

### Modelo base: Caiani et al. (2016)

**El modelo de comportamiento es Caiani, Godin, Caverzasi, Gallegati, Kinsella & Stiglitz (2016)**, *Agent based-stock flow consistent macroeconomics: Towards a benchmark model*, Journal of Economic Dynamics and Control 69 (decisión de Nico, 2026-11-12; motivos en `docs/cambio-de-enfoque.md`).
- **Se porta fielmente y se verifica contra su código publicado:** [`S120/benchmark`](https://github.com/S120/benchmark) (agentes, estrategias) y [`S120/jmab`](https://github.com/S120/jmab). **Referencia canónica:** el `.jar` y el `Model/modelFile.xml` del archivo de lanzamiento del paper (`BenchamarkModel_Baseline_Sensitivity.rar`, dentro de `S120/benchmark`), copiados en `reference/paper-launcher/` (decisión de Nico, 2026-11-12). La configuración que estaba en git como `Model/modelBaseline.xml` se renombró a `Model/modelBenchmark_full.xml` en 2016; no usar la de HEAD. Si el paper y el código difieren, manda el código, y la diferencia se documenta.
- **Toda diferencia con Caiani es una extensión documentada:** qué cambia, por qué (particularidad argentina, determinismo, período mensual, etc.), con fuente y con test. No se mezclan reglas de otros modelos en el núcleo sin pasar por esa vía.
- **Proceso por regla:** en `docs/`, la ecuación de Caiani (y la línea de JMAB) al lado de la implementación, término por término; y un test con un caso calculado a mano (patrón de `test/rules-by-hand.test.ts`).
- **Otros modelos como referencia, no como fuente de reglas del núcleo:** CATS (Delli Gatti et al.; Assenza et al., 2015), K+S (Dosi et al.), Mark-0 (Gualdi, Bouchaud et al.). Sirven para contrastar resultados, para candidatos a perillas de teoría (principio 2) y para extensiones, cada una documentada como tal.

### Datos (condiciones iniciales y validación)

- **EPH (INDEC)**: microdatos públicos de la Encuesta Permanente de Hogares. Sirven para generar una población sintética que sea una "Argentina en miniatura" (distribución de ingresos, informalidad, sectores).
- **BCRA**: base monetaria, reservas, tipo de cambio, tasas.
- **Ministerio de Economía**: ejecución presupuestaria, deuda.
- **Contexto mundial**: precios de commodities (Banco Mundial, Pink Sheet), tasa de la Fed (FRED).
- ⚠️ **El IPC del INDEC de 2007 a 2015 está intervenido.** Para ese período hay que usar series alternativas (IPC provinciales como San Luis o CABA).

### Para qué sirven los datos históricos

**No son las condiciones iniciales de la cápsula limpia.** Sirven para **validar la "física" del simulador**: si el modelo, arrancando con la Argentina de un año dado y con las políticas que se aplicaron de verdad, reproduce lo que pasó, entonces es creíble lo que diga sobre políticas nunca probadas. Es lo mismo que hacen los modelos climáticos con tormentas pasadas. De paso, quedan escenarios históricos jugables.

**Episodios de validación:**
1. Final de la convertibilidad (1998–2001)
2. Salida con devaluación (2002–2003)
3. Alta inflación con cepo (2012–2023)

## Stack

- **Lenguaje**: TypeScript en todo el proyecto (modo `strict`).
- **Build/dev**: **Vite**. No usar Next.js.
- **Monorepo**: pnpm workspaces, con tres paquetes:
  - `packages/engine`: motor de simulación. TypeScript puro, sin DOM y sin dependencias de UI. Recibe estado + perillas y devuelve el siguiente estado. Se tiene que poder testear solo y portar a Rust/WASM en el futuro sin tocar el resto.
  - `packages/app`: interfaz con React + Vite.
  - `packages/data`: scripts que procesan la EPH y las series históricas y generan datos de entrada (JSON).
- **Concurrencia**: **un Web Worker por cápsula**, para aprovechar los núcleos y que la UI no se trabe.
- **Visual de agentes**: **PixiJS** (WebGL), a partir de la Fase 5. La grilla de la Fase 0 usa **Canvas 2D a propósito**: para 500 puntos alcanza y no suma dependencias.
- **UI** (perillas, paneles, log, reclamos): **React**.
- **Gráficos**: **uPlot** (liviano, series de tiempo largas).
- **Azar**: PRNG con semilla, implementación propia de **xoshiro128\*\*** (sembrado con splitmix32) en `packages/engine/src/rng.ts`. Nunca `Math.random` en el motor.
- **Tests**: Vitest. Como mínimo: invariante SFC, determinismo (misma semilla + log = mismo resultado) y los criterios de cada fase.
- **Plataforma**: web app en el navegador. No hay planes de app de escritorio.

## Roadmap

Cada fase tiene un **criterio de salida**. **Ninguna fase arranca si la anterior no cumple el suyo.**

### Fase 0: MVP
- Economía **cerrada** (sin resto del mundo).
- ~**500 hogares**, ~**30 empresas** de un solo sector, **1 banco**, **Tesoro**, **BCRA**.
- Contabilidad SFC desde el día uno.
- **Dos perillas**: gasto público y **déficit estructural financiado con emisión** (`s`: la parte del gasto que los impuestos no cubren a pleno empleo). El déficit cíclico, por debajo del pleno empleo, también se emite automáticamente porque en esta fase no hay bonos; el indicador **emisión efectiva** muestra el total emitido (estructural + cíclico). Detalle en `docs/fase0-reglas.md`.
- **Cuatro indicadores**: inflación, desempleo, salario real, pobreza.
- **Dos cápsulas lado a lado** con la misma semilla.
- **Log de perillas** y reproducción de corridas.
- **Visual simple**: grilla de puntitos coloreados según ingreso o empleo (el pixel art llega en la Fase 5). Sirve para resolver temprano cómo el motor le pasa datos a la visual. Se dibuja con **Canvas 2D a propósito**; PixiJS entra en la Fase 5.
- Sin capa política.
- **Criterio de salida**: con más emisión en la cápsula B, **la inflación emerge sola** (sin una regla que la programe), y misma semilla + mismo log = misma corrida, exacta.
- **Estado: criterio cumplido** (2026-11-10, 20 semillas: inflación anual de A entre 0,31% y 0,70%, de B entre 3,32% y 3,57%; ver "Resultados" en `docs/fase0-reglas.md`). Además de lo pedido, la Fase 0 sumó un calentamiento de 240 meses, una regla provisoria (R7, colchón de liquidez) y el indicador de emisión efectiva. Después de corregir R1, eliminar el colchón de R7 y pasar a 420 meses de calentamiento (2026-11-11), se sigue cumpliendo: A entre 0,18% y 0,55%, B entre 1,46% y 2,31%, B > A en las 20 semillas.

### Fase 1: Economía interna completa
- **Base:** el port fiel de Caiani et al. (2016) (hogares, empresas de consumo y de capital, bancos, gobierno, banco central, crédito, inversión y quiebras), verificado contra JMAB. Primer criterio: reproducir sus resultados publicados. Lo que sigue son extensiones sobre esa base.
  - Incluye lo que el modelo base trae (decisión de Nico, 2026-11-12): **10 bancos**, **bonos del gobierno** (que compran los bancos y el banco central), empleo público y seguro de desempleo, 8.000 hogares. Período **trimestral**; el paso a mensual es una extensión con su propia validación. Plan en `docs/plan-port-caiani.md`.
- Sectores agro, industria, servicios y comercio.
- Formalidad e informalidad.
- Estratos con necesidades y nivel de vida.
- Todas las perillas **fiscales** y de **regulación**.
- Indicadores sociales con metodología INDEC.
- **Criterio de salida**: sin tocar perillas, la economía se mantiene estable durante décadas simuladas (no explota ni colapsa), y cada perilla produce efectos en la dirección esperada.
  - Verificar que con más agentes la volatilidad mensual del desempleo y la inflación baja a niveles plausibles (ver "Limitaciones conocidas" en `docs/fase0-reglas.md`).
  - Con G = 0, la economía privada (con inversión y crédito) debe poder sostenerse sola sin colapso de empleo. Hoy el modelo depende del gasto público como única demanda autónoma (propiedad del SIM): esto es un supuesto con carga ideológica que la Fase 1 tiene que eliminar.

### Fase 2: Sector externo y dólar
- Resto del mundo, exportadores e importadores.
- Regímenes cambiarios, aranceles, cupos, retenciones.
- Ahorro en dólares, deuda externa, default o reestructuración.
- Perillas **monetarias**: tasa de interés del BCRA y encajes. En la Fase 1 son los parámetros fijos de Caiani (decisión del 2026-11-11). Los **bonos del Tesoro (deuda interna)** ya entran en la Fase 1 con el port de Caiani (decisión de Nico, 2026-11-12); acá se suman las perillas de deuda (emisión de bonos en pesos o en dólares, interna o externa). Retenciones a las exportaciones también entran acá.
- Shocks mundiales.
- **Criterio de salida**: con cepo **emerge la brecha** cambiaria sola, y con emisión fuerte **emerge la corrida al dólar**.

### Fase 3: Validación histórica
- Población generada desde la EPH.
- Escenarios 1998–2001, 2002–2003 y 2012–2023, con las políticas reales cargadas como log.
- **Perillas de teoría** (ej. monetarista vs. estructuralista) para ver cuál reproduce mejor la historia.
- **Criterio de salida**: el modelo reproduce la **dirección y el orden de magnitud** de los indicadores clave. Si no, se vuelve a ajustar las reglas de las Fases 1 y 2.

### Fase 4: Capa política
- Grupos de interés, reclamos, aprobación.
- Consecuencias económicas de ignorar reclamos (paros, freno de inversión, dolarización), con reglas visibles y documentadas.
- Va después de la validación a propósito: primero hay que confiar en la economía, y después se suma el ruido humano.
- **Criterio de salida**: ignorar reclamos tiene costos medibles y explicables.

### Fase 5: Experiencia
- Ciudad en **pixel art**: barrios, fábricas que abren y cierran, gente que se muda o pierde el trabajo. Es una muestra representativa del sistema que corre debajo, no un sprite por agente.
- Más de dos cápsulas.
- Exportar e importar corridas (semilla + log).
- Escenarios históricos jugables.

## Reglas de trabajo para Claude Code

- **No hacer commits ni push de git.** Los hace Nico. Como mucho, sugerir el mensaje de commit.
- **Ir paso a paso.** Cuando se corre un comando, un test o una simulación, esperar la salida real antes de sacar conclusiones. No asumir resultados.
- **Respetar la fase actual.** No adelantar funcionalidades de fases futuras. Si algo parece necesario antes de tiempo, proponerlo y preguntar.
- **No tomar decisiones de diseño del modelo sin consultar.** Ante una regla de comportamiento nueva, proponerla con su fuente y esperar el visto bueno.
- **Respetar los principios de diseño**: nada de resultados programados, SFC, determinismo, reglas documentadas.
- Idioma: la comunicación con Nico es en español. El código (identificadores) va en inglés y los comentarios y la documentación pueden ir en español.
