# Plan del port de Caiani et al. (2016)

Estado al 2026-11-12. Plan aprobado por Nico el 2026-11-12 (las siete decisiones de la sección 6). Motivos del cambio de enfoque: [cambio-de-enfoque.md](cambio-de-enfoque.md).

Todo lo que se afirma acá sobre las reglas de Caiani sale del **código**. El PDF del paper todavía no se leyó entero (faltaba `poppler`): la comparación paper ↔ código es parte de P0.

## 0. Qué es "el código de Caiani"

Hay tres versiones distintas, y no son iguales:

| Versión | Dónde | Qué es |
|---|---|---|
| **`.jar` del paper (referencia canónica)** | `reference/paper-launcher/benchmarkModel.jar` + `Model/modelFile.xml` | Archivo de lanzamiento que acompaña al paper (`BenchamarkModel_Baseline_Sensitivity.rar`, dentro de `S120/benchmark`). Clases compiladas en febrero–marzo de 2015, paquete `modellone`, firmas `CopyOf…2WagesEnd`. Corre **400 trimestres**, **25 réplicas** (`baseline.prop`). Es lo único que produjo las tablas publicadas. **No está en la historia de git** (que empieza en julio de 2015). |
| git 2016 | `reference/benchmark-pre-cleaning` (`a2c0ac3^`), `reference/benchmark-2016` (`2050cbe`), `reference/jmab-2016` (`213b281`) | El fuente legible más cercano. `modelBaseline.xml` se renombró a `modelBenchmark_full.xml` el 2016-02-19 ("Cleaning"); el encabezado del XML que dice *"Innovation, Demand, and Finance…"* es un comentario viejo. |
| git HEAD | `reference/benchmark` (2020), `reference/jmab` (2018) | Con cambios posteriores: PRNG (2017), corrección de la condición de obsolescencia del capital (sin efecto sin I+D), estrategias nuevas. **No usar como referencia del port.** |

**Decisión (Nico, 2026-11-12):** la referencia canónica es el `.jar` del paper. El fuente de git sirve para leerlo; toda diferencia entre el `.jar` descompilado y el fuente se documenta (P0).

**Resultado de V0 (2026-11-12):** el fuente equivalente al `.jar` es el primer commit de JMAB, `bef514f` (julio de 2015, trae `modellone` adentro), copiado en `reference/jmab-2015`. Las diferencias con el `.jar` no cambian el comportamiento. **El port se lee de ahí, no del código de 2016.** Detalle en [caiani-referencia.md](caiani-referencia.md).

`model/mainBaseline.xml`, la ruta que citaban CLAUDE.md y `cambio-de-enfoque.md`, **no existe en HEAD** (ver arriba).

## 1. Hallazgos que corrigen supuestos nuestros

1. **Quiebra de empresas por iliquidez, no por patrimonio.** En el código (las tres versiones), una empresa quiebra cuando no puede pagar **salarios**, el **servicio de la deuda** o los **impuestos**. El chequeo `patrimonio < 0` existe solo para los **bancos** (`Bank.determineBankruptcy`). El paper coincide: la sec. 2.1 dice *"firms may default when they run out of liquidity to pay wages or to honor the debt service while banks default if their net wealth turns negative"*; la frase general de la sec. 3.3 (*"run out of liquidity or … net-wealth turns negative"*) es ambigua (corregido el 2026-11-12 al leer el paper; ver [caiani-referencia.md](caiani-referencia.md)). Nuestra R12 decía "fiel a Caiani en el disparador": era falso.
2. **La empresa quebrada no sale.** La liquidez se reparte entre los bancos acreedores; los hogares (como dueños, en proporción a su riqueza) pagan a los bancos hasta el 50% del valor del capital (`haircut`); el resto es pérdida del banco. La empresa sigue con su capital: la población de empresas es fija (`NoEntryPopulationHandler`; `dead = true` está comentado).
3. **La tasa de los préstamos no depende del riesgo de la empresa.** `Bank.getInterestRate` devuelve `max(tasa del banco, tasa de bonos)`; el premio por empresa está comentado. El riesgo entra por el racionamiento (rendimiento esperado con probabilidad de default logística).
4. **La I+D está apagada en el escenario base** (`researchShare = 0`): no se porta. Hay que verificar que sus eventos no consuman números aleatorios (importa para V3).
5. **El PRNG de Caiani se siembra con la fecha** (`MersenneTwister64(new Date())`): sus corridas no son reproducibles. Igual nunca se iba a poder igualar número a número (otro generador).
6. **Dividendos a todos los hogares**, en proporción a su riqueza, cada trimestre (no a un dueño).

## 2. Mapa de reglas

| Petri (enfoque anterior) | Caiani (clase activa en la configuración del paper) | Destino |
|---|---|---|
| R1 precio y cantidad (CATS) | Producción = ventas esperadas + 10% de inventario objetivo − inventario (`TargetExpectedInventoriesOutputStrategy`). Precio = margen sobre el costo laboral unitario esperado; el margen sube o baja con un paso \|N(0; 0,0094)\| según inventario/ventas contra 0,1 (`AdaptiveMarkUpOnAC`) | Se reemplaza. Traslada costos a precios |
| R2 salarios (sin fuente) | Salario de reserva por hogar: si estuvo desocupado más de 0,49 de los últimos 4 trimestres, baja; si está ocupado y el desempleo agregado es ≤ 8%, sube; paso \|N(0; 0,0094)\| (`AdaptiveWageStrategy`) | Se reemplaza. Un salario por trabajador, no por empresa |
| R3 demanda de trabajo | Trabajadores según producción y añadas de capital (Leontief, relación capital/trabajo 6,4), rotación al azar del 5%, despido del excedente | Se reemplaza |
| R4 mercado de trabajo | La empresa toma a los más baratos de una muestra de 10 (`SelectCheapestWorkerStrategy`); el gobierno contrata 1.360 al azar | Se reemplaza |
| R5 consumo (SIMEX) | C real = 0,385808·YD/pᵉ + 0,25·riqueza/pᵉ (`ConsumptionFixedPropensitiesOOIWWithPersistency`, persistencia 0) | Se reemplaza |
| R6 mercado de bienes (fidelidad) | Más barato de 5; cambia con probabilidad 1 − e^{λ(p′−p)/p′}, λ = ln 2 / 0,2 (`CheapestGoodSupplierWithSwitching`) | Se reemplaza |
| R7 dividendos (anual, un dueño) | 90% de la ganancia neta positiva, cada trimestre, si alcanzan los depósitos; a todos los hogares según su riqueza; bancos 60% | Se reemplaza. El esquema anual de la Ley 19.550 queda como candidato a extensión |
| R8 Tesoro | 1.360 empleados públicos (rotación 10%), seguro de desempleo = 40% del salario medio, impuesto 18% a ingresos y ganancias, déficit con bonos a 1 trimestre; los bancos compran, el banco central compra el resto; las ganancias del BC van al gobierno (`GovernmentAntiCyclical`) | Se reemplaza. La perilla `s` y la emisión se reformulan como extensión |
| R9 crédito | Demanda = salarios + inversión + servicio de la deuda + impuestos y dividendos esperados − ventas esperadas + colchón de una masa salarial; se usan primero los depósitos (`PeckingOrderTheory`); préstamos a 20 trimestres; banco más barato de 3, con cambio | Se reemplaza |
| R10 inversión | g = 0,01·(OCF/K − 0,043448)/0,043448 + 0,02·(uso − 0,8)/0,8 (`InvestmentCapacityOperatingCashFlowExpected`); proveedor de 5 por calidad-precio | Se vuelve a verificar contra el `.jar` |
| R11 capital | Añadas con vida y amortización de 20 trimestres; el sector de capital produce solo con trabajo, inventario objetivo 10%, margen adaptativo 0,075 | Se reemplaza |
| R12 quiebras y entrada | Ver hallazgos 1 y 2 | Se reemplaza |
| R13 banco | 10 bancos. Tasa de préstamos adaptativa según el ratio de capital contra el promedio; tasa de depósitos según la liquidez; oferta por rendimiento esperado con probabilidad logística (aversión al riesgo 3,922 para consumo y 21,513 para capital), recortando el pedido de a 1% (`ExpectedReturnCreditSupply`, `DeterministicLogisticCashFlowComputer`); Basilea (6%), adelantos del BC a 0,005; quiebra con patrimonio < 0 → rescate con quita a los depositantes hasta el ratio promedio + U(0; 0,1) (`BankBankruptcyBailoutCAR`) | Se reemplaza |
| Expectativas | Adaptativas, λ = 0,25 (`SimpleAdaptiveExpectation`) | Se mantiene |

**Se descarta:** `PHASE1_INITIAL`, las variantes experimentales (`Phase1Experiments`), la base de pleno empleo de R8, el dueño único, la métrica de zombis. `model.ts` y `phase1.ts` quedan como registro hasta que el port pase sus criterios; la app sigue con la Fase 0 hasta P6.

## 3. Infraestructura

**Se reutiliza tal cual:** `rng`, `step` y las etapas, `warmup`, perillas/log/`replay`, `hash`, `detmath` y `creditRisk` (logística, `expNeg`), los tests de infraestructura, la app (workers, lockstep, grilla), las métricas de `cambio-de-enfoque.md`.

**Se adapta:**
- **Ledger con contratos bilaterales** (diseño detallado: [ledger-contratos.md](ledger-contratos.md)). Hoy las posiciones son agregadas por agente y no dicen en qué banco está un depósito. Con 10 bancos: depósitos, préstamos (con tasa, plazo, edad y cuota), bonos y reservas son contratos (tenedor, emisor, monto). Un pago entre clientes de bancos distintos mueve reservas (como en JMAB). Las primitivas `issue`/`transfer`/`redeem` y `checkSfc` se conservan, a nivel de contrato.
- **Escala monetaria.** Caiani usa `double`: salario 5 por trimestre, precio 1,03. En centavos, el paso del margen (~0,3 centavos) se redondea a cero. Propuesta: precios, tasas y expectativas en `double` (deterministas con las cuatro operaciones), saldos enteros en una unidad mucho más chica (p. ej. 1 unidad de Caiani = 10⁶), verificando el techo de `MAX_SAFE_INTEGER`. A decidir en P1.
- **Normal plegada determinista.** Propuesta: tabla precalculada de la inversa de la normal con interpolación (o ziggurat con `expNeg`), documentada como adaptación y con test de momentos. Lo demás: `pow` con exponente entero → multiplicaciones; `log` en `thresholdMean` → constante precalculada; `exp` → `detmath`.
- **Archivo de corrida v3** (cambian el estado y el período).

**Nuevo:**
- **Invariante de flujos:** matriz de transacciones por tick (filas suman cero) y Δstock = flujo (Caiani: `TFMComputer`).
- **Módulo propio para el port**, separado de `phase0`/`phase1`.
- **Arnés del oráculo** (V3), fuera del motor.

## 4. Verificación

- **V0, referencia.** Descompilar el `.jar` y compararlo con el fuente de git (`benchmark-pre-cleaning` + `jmab-2016`). Documentar cada diferencia y las correcciones posteriores: expectativas (dic. 2015, según los autores no afecta a `SimpleAdaptiveExpectation`), `Collections.shuffle` y `Math.random` (mar. 2016), PRNG (jun. 2017), obsolescencia (2017). Leer el paper entero y anotar sus diferencias con el código.
- **V1, condiciones iniciales.** Portar `SFCSSMacroAgentInitialiser`; el balance del período 0 igual al de Java salvo redondeo.
- **V2, regla por regla.** Ecuación y línea de JMAB al lado del código; test calculado a mano (patrón de `test/rules-by-hand.test.ts`).
- **V3, oráculo con trazas.** JMAB instrumentado con semilla fija vuelca el estado y la secuencia de números aleatorios consumidos. El port recibe ese estado y un `Rng` que devuelve esa secuencia, calcula el tick siguiente y se compara etapa por etapa. **Tolerancias (decisión de Nico, 2026-11-13; reemplazan el 1e-9 relativo original, que con saldos en µ no se puede cumplir):** montos, unos pocos µ (tantos como redondeos tocaron esa cuenta en el tick); `double` calculados a partir de montos, 1e-6 relativo; `double` que no dependen de montos (expectativas de precios, márgenes), 1e-9 relativo. **Una decisión discreta que se da vuelta** (un umbral, la elección del más barato) por una diferencia dentro de la tolerancia no es falla: **se cuenta y se informa en cada corrida de V3** (pedido de Nico), con el lugar, el tick y las dos diferencias. De a un tick, desde estados en t = 1, 50, 200 y 399 (en trayectorias largas es esperable que algún umbral se dé vuelta). Obliga a respetar el orden de eventos y de sorteos de JMAB.
- **V4, reproducción estadística.** 100 réplicas × 400 trimestres por lado; se descartan las que colapsan (desempleo > 80%, como su script); filtro HP λ = 1600; últimos 100 trimestres (`startRound = simRounds − 100` en `BaselineAnalysis.R`).

  **Objetivo: la distribución del `.jar` del paper** (decisión de Nico, 2026-11-12: si las réplicas confirmaban la diferencia con la tabla publicada, "manda el código"). Se confirmó con 25 réplicas y se reconfirmó con 100 (detalle en [caiani-referencia.md](caiani-referencia.md), "Lote de 25 réplicas" y "Lote de 100 réplicas"). Archivo de referencia: `reference/p0/runs/resumen-100.json` (promedio de la tendencia en la ventana, por réplica).

  | Indicador | `.jar`: media de 100 réplicas (desvío entre réplicas) | Tabla publicada ("Summary Baseline", solo como registro) |
  |---|---|---|
  | PBI real | 36.947 (78) | 36.760 |
  | Desempleo | 7,52% (0,10) | 7,84% |
  | Inversión real | 6.908 (54) | 6.962 |
  | Consumo real | 30.039 (95) | 29.790 |
  | Inflación de bienes de consumo | 0,532% trimestral (0,022) | 0,4245% |
  | Inflación de bienes de capital | 0,572% trimestral (0,021) | 0,4607% |
  | Crecimiento del ingreso neto | 0,536% trimestral (0,021) | 0,4231% |
  | Apalancamiento de los bancos | 5,51 (0,75) | 5,049 |
  | Apalancamiento de las empresas de consumo | 0,831 (0,017) | 0,7456 |

  Más la volatilidad del ciclo y las correlaciones, también calculadas sobre las réplicas del `.jar` (las de `Summary Correlation Analysis Baseline.xlsx` quedan como registro).

  **Criterio de V4 (acordado con Nico el 2026-11-12, escrito antes de cualquier resultado del port).** Implementado en `reference/tools/v4_compare.py`; los estadísticos por réplica salen de `reference/tools/analyze_baseline.py`, con las mismas definiciones que `BaselineAnalysis.R`.
  - **Unidad de comparación:** un valor por réplica y por estadístico. Las réplicas del port usan semillas distintas entre sí, con la misma regla de descarte (desempleo > 0,8). El `.jar` no tuvo ninguna caída en 100; cualquier caída del port se investiga.
  - **Estadísticos (34 por réplica):**
    - los 9 promedios de la tendencia en la ventana (tabla de arriba);
    - los 9 desvíos del ciclo relativo a la tendencia en la ventana (`cycSD:`, lo que la fila "Standard Deviation Cycle" promedia);
    - los momentos del ciclo de toda la corrida, como en el análisis de correlaciones de `BaselineAnalysis.R` (ciclo HP de log PBI, log inversión, log consumo y desempleo en nivel; estimadores de `acf`/`ccf` de R):
      - volatilidad relativa al PBI de la inversión, el consumo y el desempleo;
      - correlaciones cruzadas con el PBI en los rezagos −1, 0 y +1;
      - autocorrelación de rezago 1 de las cuatro series.
  - **Medias:** prueba t de **Welch** (varianzas distintas). Tamaño: |media del port − media del `.jar`| < **0,5 desvíos entre réplicas del `.jar`**.
  - **Dispersión entre réplicas** (los 9 promedios de la tendencia): prueba de **Brown–Forsythe**, que es robusta a la falta de normalidad. Tamaño: |desvío del port − desvío del `.jar`| < 0,5 desvíos del `.jar`.
  - **Comparaciones múltiples:** corrección de **Holm** sobre la familia completa (34 pruebas de medias + 9 de dispersión = 43), con nivel conjunto **1%**.
  - **Un estadístico pasa** si Holm no rechaza **y** se cumple el tamaño.
  - **Resultado:**
    - 0 fallas: V4 cumplido;
    - **1 falla aislada: se investiga antes de concluir que hay un error** (se mira la regla que más pesa en ese estadístico, con V3 si hace falta);
    - 2 o más: hay una discrepancia, que se localiza con V3.
  - **Calibración (2026-11-12).** La condición de tamaño se evalúa sobre la diferencia observada, así que depende del número de réplicas. Con n réplicas por lado, la diferencia de medias entre dos lotes del mismo modelo tiene un desvío de s·√(2/n).
    - Con n = 25, cada estadístico falla por azar con probabilidad P(|Z| > 1,77) ≈ 8%: un port perfecto pasaría sin fallas solo ~6% de las veces.
    - Prueba empírica (`v4_compare.py --split`, el `.jar` contra sí mismo, 12 réplicas contra 13): 13 fallas de 43, todas por tamaño; Holm no rechazó ninguna.
    - Con **100 réplicas por lado** (las que dice el paper), la probabilidad de falla por azar en cada estadístico de medias es ~0,04%, y un port perfecto pasa ~99% de las veces.
    - **Decisión (Nico, 2026-11-12): 100 réplicas del `.jar` y 100 del port.** La tabla de arriba ya es la de las 100 del `.jar` (2026-11-13).
    - Prueba empírica con las 100 (`v4_compare.py --split`, 50 contra 50): **0 fallas de 43**; el tamaño más grande fue 0,34 desvíos (ccf+1 de la inversión). Con 100 contra 100 el margen es mayor todavía.
- **V5, sensibilidades.** Los experimentos del paper (aversión al riesgo de los bancos, depósitos precautorios, pesos de la inversión) en la misma dirección y orden de magnitud.
- **Después:** volver a correr el criterio de la Fase 0 (emisión ⇒ inflación) y el de G = 0 sobre el port.

## 5. Unidad de tiempo

**Decisión (Nico, 2026-11-12): trimestral primero; mensual después, como extensión documentada.**

- V3 y V4 solo funcionan con el mismo período que Caiani.
- Pasar a mensual no es solo reescalar parámetros: los pasos de margen y salario por período, los umbrales, los rezagos y la gestación del capital cambian la dinámica. Hacer las dos cosas a la vez impide atribuir una discrepancia.
- **Conversión, cuando toque:** tasas equivalentes mensuales; λ de expectativas 1 − 0,75^{1/3}; propensión a consumir de la riqueza ajustada al mes; plazos y vidas ×3; rezagos 4 → 12; inventario objetivo 0,3 de las ventas mensuales; ruido σ/√3; probabilidades de cambio 1 − (1−p)^{1/3}; colchón de una masa salarial trimestral = tres mensuales. **Criterio:** la versión mensual agregada a trimestres reproduce los momentos de la trimestral.
- **Mientras tanto:** el tick del motor, de la app y del log es un trimestre. Los indicadores mensuales tipo INDEC esperan a esa extensión.

## 6. Decisiones (Nico, 2026-11-12)

1. Período trimestral primero.
2. 10 bancos.
3. Bonos ahora (son el financiamiento del gobierno en el modelo base). Roadmap actualizado en CLAUDE.md: los bonos pasan de la Fase 2 a la base de la Fase 1.
4. El gobierno de Caiani es el base; `s` y el gasto se reformulan como extensiones después de reproducir.
5. Tamaño: 8.000 hogares, 100 empresas de consumo, 20 de capital, 10 bancos, 1.360 empleados públicos.
6. Se instala un JDK (Temurin 8) para el oráculo, y `poppler` para leer el paper.
7. Referencia canónica: el `.jar` del paper.

## 7. Orden de trabajo

1. **P0, referencia y oráculo (fuera del motor):** leer el paper; descompilar el `.jar` y compararlo con git (V0); correr el `.jar` con 25+ semillas fijas y guardar la distribución de referencia; instrumentar JMAB para volcar estados y sorteos.
2. **P1, infraestructura:** ledger de contratos con varios bancos, escala monetaria, normal determinista, invariante de flujos, módulo nuevo. **Hecho (2026-11-13):** `packages/engine/src/caiani/`; diseño y registro en [ledger-contratos.md](ledger-contratos.md).
3. **P2, inicialización** (V1).
4. **P3, reglas en el orden del tick de JMAB:** expectativas → precios → inversión → crédito y depósitos → trabajo → producción → consumo → pagos (salarios, intereses, impuestos, dividendos) → quiebras → bonos y reservas. Cada una con V2 y V3.
5. **P4, reproducción** (V4, V5).
6. **P5:** criterio de la Fase 0 y G = 0 sobre el port; costo por tick en el navegador con 8.000 hogares.
7. **P6:** conectar la app (ticks trimestrales) y archivar las reglas viejas.

Después: extensiones (período mensual, particularidades argentinas, perillas).

## 8. Licencia

**Lo verificado (2026-11-12):**
- **Fuentes de JMAB y del benchmark:** 306 de 307 archivos `.java` tienen el encabezado *"Copyright (C) 2013 Alessandro Caiani and Antoine Godin … GNU General Public License … version 3 … or (at your option) any later version"*.
- **READMEs de ambos repos** (agregados el 2016-02-18): *"Copyright (c) 2016 Alessandro Caiani and Antoine Godin"* + el texto de la **licencia MIT**. No hay archivo `LICENSE` en ninguno de los dos repos.
- **`.jar` del paper:** sin archivo de licencia ni fuentes; es código compilado de los mismos autores (2015, antes del README con MIT). Trae dependencias de terceros (Colt, Spring, log4j, JABM) que **no se portan**.
- **Petri hoy no tiene licencia** (ni `LICENSE` ni campo `license` en los `package.json`): por defecto, todos los derechos reservados.

**Lectura:** las señales son contradictorias (GPL-3.0-or-later por archivo; MIT en el README). Los autores pueden licenciar bajo las dos, pero no está claro cuál quisieron. Lo prudente es tomar la más restrictiva, **GPL-3.0-or-later**, hasta que los autores confirmen otra cosa.

**¿Petri es obra derivada?** Implementar las ecuaciones del paper no lo es (las ideas y la matemática no tienen copyright). Una traducción fiel del código, línea por línea y respetando su estructura y el orden de sorteos, sí lo es: la traducción está cubierta por el derecho de autor. Con el proceso del plan (V2, V3), hay que tratar el port como **obra derivada**.

**Qué implica bajo GPL-3.0-or-later:**
- El motor, y la app que lo empaqueta y lo entrega al navegador (eso es "distribuir"), tienen que licenciarse bajo **GPL-3.0-or-later** (o una compatible, como AGPL-3.0).
- Hay que publicar el código fuente (ya es el plan: open source), conservar el aviso de copyright de Caiani y Godin en los archivos portados, marcar que fueron modificados y no agregar restricciones.
- Las dependencias actuales (React, uPlot, Vite, PixiJS: MIT) son compatibles con GPL.
- `reference/` no se sube a git, así que no se redistribuye el código ni el `.jar` de ellos.

**Si los autores confirman MIT:** alcanza con incluir su aviso de copyright y el texto de la MIT; Petri podría elegir cualquier licencia.

**Recomendación (a decidir por Nico):** licenciar Petri bajo **GPL-3.0-or-later** antes de escribir la primera línea del port. Cumple con las dos lecturas (el código MIT se puede incluir en un proyecto GPL) y encaja con un proyecto open source sin fines de lucro. Opcional: escribirles a Caiani y Godin para aclarar la licencia. Esto no es asesoramiento legal.
