# Referencia de Caiani: qué código es y qué dice (P0)

Registro de P0 del plan ([plan-port-caiani.md](plan-port-caiani.md)). Las copias locales están en `reference/` (fuera de git; ver `reference/README.md`). Los archivos de trabajo de P0 están en `reference/p0/`.

## V0. El `.jar` del paper contra el fuente de git (2026-11-12)

**Método.** Se descompiló `paper-launcher/benchmarkModel.jar` con CFR 0.152. El fuente de git se compiló con el mismo compilador que el `.jar` (Eclipse, ECJ 4.6.1, `-g -1.6`) contra las bibliotecas del lanzador, y se descompiló con el mismo CFR. Así se eliminan las diferencias de formato del compilador; con `javac` quedaban 72 archivos con ruido (bucles `for` reescritos como `while`).

**Fuente equivalente al `.jar`:** el primer commit de JMAB, `bef514f` (2015-07-28), que todavía trae el modelo (paquete `modellone`) adentro. Copia: `reference/jmab-2015/src`. Su `modellone` es idéntico al del primer commit del benchmark (`a134145`, `reference/benchmark-2015`).

**Diferencias con el `.jar` (23 archivos), todas sin efecto en el comportamiento:**
- Se agrega un parámetro con el id del tipo de préstamo a `getInterestRate`, `getLoanSupply`, `get/setTotalLoansSupply` y `get/setCurrentNonPerformingLoans`. Siempre vale 4 (`SM_LOAN`), el único tipo de préstamo.
- Métodos nuevos que nadie llama en el escenario base (`addToMarketPopulation`, `getMarket`).
- Getters renombrados en el inicializador (`getksOCF` → `getKsOCF`).
- `Main` arranca `DesktopSimulationManager` en vez de `SimulationManager`.
- `RealGDPComputer`: es un reporte. No entra en V4: el script de R calcula el PBI real como inversión + consumo.
- Dos mezcladores (`Dynamic…RandomRobinBuyerMixer`) solo están en git y no se usan.

**Conclusión:** para leer el código del paper se usa `reference/jmab-2015/src` (`jmab` + `modellone`). Las clases que corren en el escenario base son las de `Model/modelFile.xml` del lanzador (`CopyOfConsumptionFirm2WagesEnd`, `CopyOfCapitalFirm2WagesEnd`, `HouseholdsWithDole`, `Bank`, `GovernmentAntiCyclical`, `CentralBank`, etc.).

## De 2015 a 2016 (git): cambios de comportamiento

El estudio del plan se hizo con el código de 2016. Entre 2015 (`.jar`) y 2016:
1. **`ConsumptionFirm.getPriceLowerBound`:** en 2016, si no se planea producir y no queda inventario, el costo esperado es 0. En 2015 ese caso daba NaN. Es un caso borde; **el port sigue a 2015** y tiene que documentar qué pasa con el NaN.
2. **`SimpleAdaptiveExpectation.addObservation`:** se corrigió el sentido en que se corre el historial. **Sin efecto:** la expectativa usa solo la fila 0, que se escribe después del corrimiento (lo afirmaban los autores y se verificó leyendo el código). Los rezagos (`TreeMapPassedValues`) no cambiaron.
3. **Ratio de liquidez objetivo:** pasa de parámetro de la estrategia a campo del banco, con el mismo valor (0,258026342).
4. **`AdaptiveMarkUpOnAC`:** un `return` agregado en la rama sin costo esperado; da lo mismo mientras el precio sea positivo.

El resto son interfaces nuevas, mensajes de depuración y cambios de forma.

## Fuentes de azar en el `.jar` (importa para V3)

El `.jar` mezcla tres fuentes de azar:
- `MersenneTwister64` de Colt, sembrado con la fecha (`new Date()`): normal plegada, cambio de proveedor (binomial), muestras de los mercados.
- **`Collections.shuffle(this.employees)` sin semilla:** orden de los empleados al despedir (rotación y excedente) y al pagar salarios. Además desordena la lista misma.
- **`Math.random()`:** el ratio de capital objetivo del rescate de bancos (`BankBankruptcyBailoutCAR`: promedio de los otros bancos + U(0; 0,1)).

Consecuencias:
- **Una corrida del `.jar` no se puede reproducir** aunque se fije la semilla. Para V4 no importa (se comparan estadísticas).
- **Para V3** hace falta una compilación instrumentada del fuente de 2015 que pase todo el azar por un solo generador con semilla y **registre cada sorteo con su tipo** (normal plegada, Bernoulli, permutación, uniforme, muestra). El `Rng` del port tiene que pedir sorteos con el mismo significado, para que el de prueba pueda devolver los valores registrados y detectar enseguida un desalineamiento.
- Se corrigió en git en marzo de 2016 (`Collections.shuffle` → `AgentList.shuffle(prng)`; `Math.random` → `Uniform(0; 0,1; prng)`). El reparto estadístico es el mismo.

## Lectura del paper (working paper de febrero de 2016, en el repo)

Texto extraído en `reference/p0/paper-wp.txt` (`pdftotext -layout`). Secuencia del tick (sec. 2.1), comportamientos (sec. 3), calibración (sec. 4), cuadro 3 de parámetros.

**Quiebras (corrección a lo que se anotó antes el mismo día):**
- La sección 2.1 dice: *"firms may default when they run out of liquidity to pay wages or to honor the debt service while banks default if their net wealth turns negative"*. **Coincide con el código.**
- La sección 3.3 dice en general *"Firms and banks may go bankrupt when they run out of liquidity or if their net-wealth turns negative"*, y después asigna el patrimonio negativo a los bancos. Es ambigua, no contradictoria.
- La cita del registro de la Fase 1 (*"run out of liquidity or … net-wealth turns negative"*) sale de esa frase general.
- El código suma un tercer caso de iliquidez: no poder pagar los **impuestos**.

**Diferencias entre paper y código (manda el código):**

| Tema | Paper | Código (`.jar`) |
|---|---|---|
| Rescate de un banco | se bajan los depósitos hasta que el ratio de capital llega al mínimo de 6% | hasta el promedio de los otros bancos + U(0; 0,1) |
| Normal plegada | (µ, σ²) = (1; 0,0094) en el cuadro 3 | media 0, desvío 0,0094 |
| Trabajadores iniciales de las empresas de consumo | 4.000 (cuadro 3) | 5.000 (inicializador; la matriz de flujos del propio paper usa 25.000 de salarios = 5.000 × 5). Errata del cuadro |
| Réplicas | 100 (sec. 5) | 25 en el lanzador (`baseline.prop`); 25 en las sensibilidades (sec. 5.3) |
| Quiebra por impuestos | no se menciona | sí |
| Empleados públicos iniciales | 1.360, con desempleo inicial u₀ = 0,08 (cuadro 3) | 0 en t = 0 (`gEmpl` no está en el XML); los 1.360 se contratan en el tick 1 y el desempleo queda en 8% ([inicializacion.md](inicializacion.md), sec. 6) |
| Tasa de los préstamos | eq. 3.12, ajuste según el ratio de capital contra el promedio | igual; el premio por empresa está comentado |
| Cambio de proveedor de capital | la empresa cambia al proveedor más atractivo con una probabilidad creciente en la diferencia de atractivo | **probabilidad siempre 0.** La estrategia (`BestQualityPriceCapitalSupplierWithSwitching` + `SwitchingStrategySimple`) está configurada como pago (`payOrReceive` = true, XML 1794), que solo da p > 0 si el candidato es *menor* que el previo; pero se consulta solo cuando el candidato es más atractivo (más es mejor). La empresa cambia de proveedor únicamente si el previo quedó inactivo en el mercado. Verificado con el oráculo: el evento 5 no tiene sorteos ([reglas-caiani.md](reglas-caiani.md), sec. 7). Registrado el 2026-11-13 (Nico) |
| Precio de la inversión en el pedido de crédito de la empresa de consumo | sec. 3.1.4: la inversión nominal deseada es la demanda real × el precio *"applied by the selected supplier"*, y entra en la demanda de crédito (eq. 3.11) | **precio del primer vendedor visto** en la primera etapa del mercado de capital (evento 3, `selectedCapitalGoodSuppliers.get(0)`), no el del proveedor elegido en el evento 5, al que sí se le calcula la demanda real (`CopyOfConsumptionFirm2WagesEnd.computeCreditDemand` 197–235). En los ticks 1 y 50 (semilla 12345) el primero visto no es el elegido en 95 y 96 de las 100 empresas; la diferencia de precio llega a 0,15% y 1,2%, y la inversión nominal agregada del pedido cambia −0,005% y +0,06%. El port reproduce el código ([reglas-caiani.md](reglas-caiani.md), sec. 10). Registrado el 2026-11-13 (Nico) |
| Salario de reserva de los desocupados | sec. 3.4, eq. 3.15: el trabajador que estuvo desocupado **más de dos de los últimos cuatro trimestres** baja su salario pedido; si no, lo sube si el desempleo agregado del período anterior es bajo | **invertido para los desocupados.** `Households.getMicroReferenceVariableForWage` (393–403) arranca en 1 (el trimestre actual) pero suma `LAG_EMPLOYED` de los tres anteriores, que vale 1 si el hogar **tenía** empleador: cuenta trimestres ocupado. Un desocupado de los cuatro trimestres da 1/4 ≤ 0,49 y pasa a la rama macro, donde su referencia es 0 ≤ 0,08 (`getMacroReferenceVariableForWage`, 423–428): **sube** su salario siempre. Uno que trabajó en alguno de los tres anteriores da ≥ 1/2 y lo **baja**. Tick 50 (semilla 12345, volcado antes del evento 11): 455 desocupados; con el código bajan 228 y suben 227; contando trimestres desocupado (la lectura del paper y del nombre de la variable) bajarían 298 y subirían 157; **eligen otra rama 384 de los 455** (84%). En el tick 1, los 2.000 desocupados suben con el código y bajarían con la corrección. El port reproduce el código ([reglas-caiani.md](reglas-caiani.md), sec. 12). Registrado el 2026-11-13 (Nico) |
| Obsolescencia de las añadas de capital | — | condición **invertida** en 2015 (corregida en git en 2017; plan, sec. 0): una añada queda obsoleta si la **vieja** tiene más productividad que la nueva y ese ahorro supera el precio. Sin I+D todas las añadas tienen la misma productividad y nunca se activa en el escenario base. El port reproduce la condición de 2015. Registrado el 2026-11-13 (Nico) |

**Pendiente de leer con detalle:** sección 5 (resultados y hechos estilizados), para fijar los objetivos de V4 además de las tablas xlsx.

## Corridas del `.jar` (referencia para V4)

- **Cómo correrlo:** `reference/tools/run-baseline.sh N P` (N réplicas, P en paralelo). Cada réplica corre en una copia del lanzador (`reference/p0/runs/baseline/run-XX/`) con `java -Djava.awt.headless=true -Djabm.config=Model/mainFile.xml -jar benchmarkModel.jar`; los CSV salen en `data/`.
- **Costo:** ~25 minutos por réplica de 400 trimestres en esta Mac (JDK x86_64 bajo Rosetta). La memoria real es ~0,7 GB por JVM.
- **Análisis:** `reference/tools/analyze_baseline.py`, que replica `BaselineAnalysis.R` (no hay R instalado): mismas definiciones, filtro HP λ = 1600 y ventana de los últimos 100 trimestres. Además da el promedio de cada réplica, para la dispersión entre réplicas.
- **Prueba de humo (2026-11-12, 1 réplica):**

  | | Prueba | Paper (Summary Baseline) |
  |---|---|---|
  | PBI real | 36.924 | 36.760 |
  | Desempleo | 7,53% | 7,84% |
  | Inversión real | 6.877 | 6.962 |
  | Consumo real | 30.047 | 29.790 |
  | Inflación C (% trimestral) | 0,504 | 0,425 |
  | Inflación K (% trimestral) | 0,532 | 0,461 |
  | Crecimiento del ingreso neto | 0,510 | 0,423 |
  | Apalancamiento bancos | 5,64 | 5,05 |
  | Apalancamiento empresas C | 0,853 | 0,746 |

  Las cantidades reales coinciden muy de cerca. La inflación y el apalancamiento dan más altos; en las tablas de sensibilidad del propio paper, con parámetros vecinos al base, la inflación da 0,50–0,52 y el apalancamiento de los bancos 5,1–5,6. **Si las 25 réplicas confirman la diferencia, el objetivo de V4 tiene que ser la distribución del `.jar` y no la tabla publicada** (que pudo salir de otra versión o de las 100 réplicas del paper). Decisión de Nico.
- **Lote de 25 réplicas (2026-11-12):** `reference/tools/run-baseline.sh 25 4`, ~26 minutos por réplica con 4 en paralelo. **Ninguna colapsó.** Resumen en `reference/p0/runs/resumen-25.json`; la comparación sale de `reference/tools/compare_published.py`.

  **Método de la comparación.** El filtro HP es lineal, así que el "Average Trend" publicado es la media, entre réplicas, del promedio de la tendencia de cada réplica en la ventana. Si la tabla publicada saliera del mismo `.jar`, publicado − nuestra media tendría esperanza 0 y desvío s·√(1/25 + 1/N_pub), con s el desvío entre nuestras réplicas. Se usa N_pub = 25 (el lanzador) y N_pub = 100 (lo que dice el paper), con la t de Student de 24 grados de libertad. Además se cuenta, sin supuestos, cuántas réplicas individuales quedan del lado del valor publicado.

  | | Publicado | `.jar` (media de 25) | Desvío entre réplicas | Réplicas del lado del publicado | z (lote de 25 / de 100) | ¿Dentro del IP 95%? |
  |---|---|---|---|---|---|---|
  | PBI real | 36.760 | 36.949 | 68 | 0/25 | −9,8 / −12,5 | No |
  | Desempleo | 7,84% | 7,51% | 0,10 | 0/25 por encima | +12,1 / +15,3 | No |
  | Inversión real | 6.962 | 6.888 | 51 | 1/25 por encima | +5,1 / +6,5 | No |
  | Consumo real | 29.790 | 30.061 | 85 | 0/25 | −11,3 / −14,2 | No |
  | Inflación C | 0,4245 | 0,530 | 0,020 | 0/25 (mín 0,485) | −18,6 / −23,6 | No |
  | Inflación K | 0,4607 | 0,566 | 0,020 | 0/25 (mín 0,521) | −18,6 / −23,5 | No |
  | Crecimiento del ingreso neto | 0,4231 | 0,534 | 0,019 | 0/25 (mín 0,486) | −20,3 / −25,7 | No |
  | Apalancamiento bancos | 5,049 | 5,42 | 0,73 | 9/25 | −1,8 / −2,3 | Sí con 25 (p = 0,09); justo afuera con 100 (p = 0,03) |
  | Apalancamiento empresas C | 0,7456 | 0,834 | 0,014 | 0/25 (mín 0,809) | −22,3 / −28,2 | No |

  **Conclusión:**
  - **La tabla publicada no sale del `.jar` del lanzador.** Ocho de nueve indicadores quedan muy afuera, y en inflación y apalancamiento de las empresas ninguna réplica individual llega al valor publicado. No es ruido de muestreo.
  - El apalancamiento de los bancos es la excepción porque varía mucho entre réplicas (de 3,9 a 7,0). No sirve para discriminar.
  - Las cantidades reales difieren menos del 1%, pero la diferencia es sistemática. La inflación y el apalancamiento de las empresas difieren ~25% y ~12%.
  - Origen probable: otra versión del código u otra configuración que la del `.jar` (no se investigó más). Coincide con que en las tablas de sensibilidad del propio paper, con parámetros vecinos al base, la inflación da 0,50–0,52.
  - **Por decisión de Nico, el objetivo de V4 es la distribución del `.jar`** (`plan-port-caiani.md`, sec. 4). La tabla publicada queda como registro.

- **Lote de 100 réplicas (2026-11-12/13):** `reference/tools/run-baseline.sh 100 4` sumó las 75 que faltaban (de las 16:00 a las 03:47, ~31 minutos por réplica con 4 en paralelo; 4,9 GB en total). **Ninguna colapsó.** Resumen en `reference/p0/runs/resumen-100.json`; es la referencia de V4.

  | | Publicado | `.jar` (media de 100) | Desvío entre réplicas | Réplicas del lado del publicado | z (lote de 25 / de 100) | ¿Dentro del IP 95%? |
  |---|---|---|---|---|---|---|
  | PBI real | 36.760 | 36.947 | 78 | 2/100 | −10,7 / −16,9 | No |
  | Desempleo | 7,84% | 7,52% | 0,10 | 0/100 por encima | +14,7 / +23,2 | No |
  | Inversión real | 6.962 | 6.908 | 54 | 14/100 por encima | +4,4 / +7,0 | No |
  | Consumo real | 29.790 | 30.039 | 95 | 0/100 (mín 29.796) | −11,8 / −18,6 | No |
  | Inflación C | 0,4245 | 0,532 | 0,022 | 0/100 (mín 0,483) | −21,8 / −34,4 | No |
  | Inflación K | 0,4607 | 0,572 | 0,021 | 0/100 (mín 0,521) | −23,4 / −37,0 | No |
  | Crecimiento del ingreso neto | 0,4231 | 0,536 | 0,021 | 0/100 (mín 0,486) | −24,0 / −37,9 | No |
  | Apalancamiento bancos | 5,049 | 5,51 | 0,75 | 28/100 | −2,7 / −4,3 | No (p = 0,008 / 4e-5) |
  | Apalancamiento empresas C | 0,7456 | 0,831 | 0,017 | 0/100 (mín 0,783) | −22,2 / −35,0 | No |

  - Las medias casi no se movieron respecto del lote de 25; la conclusión se mantiene y se refuerza. **Ahora los nueve indicadores quedan afuera**, incluido el apalancamiento de los bancos (con 25 réplicas había quedado adentro por poco).
  - El `.jar` contra sí mismo con el criterio de V4 (`v4_compare.py --split`, 50 contra 50): 0 fallas de 43.
  - Momentos del ciclo (media de 100, desvío): volatilidad relativa al PBI de la inversión 4,60 (0,20), del consumo 0,755 (0,046) y del desempleo 1,038 (0,019); correlación contemporánea con el PBI de la inversión 0,766, del consumo 0,595 y del desempleo −0,532; desempleo en t+1 contra PBI en t −0,964 (0,004); autocorrelación de rezago 1 del PBI 0,552, de la inversión 0,277, del consumo 0,852 y del desempleo 0,426.

## Oráculo (V3): fuente 2015 instrumentado

- **Qué es:** `reference/p0/oracle/` es una copia de `reference/jmab-2015/src` con todo el azar instrumentado, compilada con ECJ en `oracle.jar`. Se corre con `reference/tools/run-oracle.sh <nombre> <semilla> <rondas> [desde hasta]`.
- **Cambios contra el fuente (solo en el azar):**
  - `Collections.shuffle(employees)` y `Math.random()` pasan a un `java.util.Random` con semilla.
  - El `prng` de la configuración se siembra con un número fijo en vez de la fecha.
  - Se arranca con `net.sourceforge.jabm.SimulationManager` (como el `.jar`), sin interfaz.
  - La distribución de cada sorteo es la misma que en el `.jar`.
- **Registro de sorteos** (`draws.tsv`, una línea por sorteo: secuencia, tick, tipo, lugar, resultado). Tipos: `fn` (normal plegada), `bern` (cambio de proveedor, con su p), `shuffle` (orden de compradores, de vendedores en cada mezcla de los mercados y de candidatos a empleo público), `sample` (vendedores que ve cada comprador; desde el 2026-11-13 los mezcladores ya no lo emiten: ver `reglas-caiani.md`, sec. 1), `shuffleEmp` (orden de los empleados de una empresa), `unif` (rescate de bancos). Se registra el **resultado**, no el número crudo: el port no necesita reproducir los algoritmos de Colt, solo pedir los mismos sorteos.
- **Reproducibilidad verificada (2026-11-12):**
  - Dos corridas con la semilla 12345 y 6 trimestres: los mismos 212.680 sorteos y los mismos 36 CSV.
  - Dos corridas con la semilla 777 y 60 trimestres (14 quiebras de empresas en el medio): los mismos CSV.
  - La semilla 778 da otros resultados (32 de 36 CSV distintos).
- **Volumen:** ~35.000 sorteos por trimestre con el registro completo; para V3 se registra solo la ventana de ticks que se compara.
- **Volcado del estado (P2, 2026-11-13):** `oracle.StateDump` vuelca el estado completo en JSON Lines después de la inicialización y, con `DUMP_TICKS="1,50"`, al principio de esos ticks (lo que necesita V3). La mezcla de hogares del inicializador ahora se registra (`shuffle initHouseholds`); los sorteos de la inicialización tienen tick −1 (`logFrom = -1` para incluirlos). `oracle.CashWatch` registra el efectivo distinto de cero después de cada evento. Se compila con `reference/tools/build-oracle.sh`. Detalle en [inicializacion.md](inicializacion.md), sec. 4.
- **V3 por evento (P3, 2026-11-13):** `draws.tsv` lleva el índice del evento en una sexta columna; `DUMP_EVENTS="t:e"` vuelca el estado después del evento e del tick t; cada ítem del volcado tiene un `@oid` para reconstruir los contratos. Método en [reglas-caiani.md](reglas-caiani.md).
