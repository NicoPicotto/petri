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
| Tasa de los préstamos | eq. 3.12, ajuste según el ratio de capital contra el promedio | igual; el premio por empresa está comentado |

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
- **Lote de 25 réplicas:** en curso (`reference/p0/runs/baseline/`).

## Oráculo (V3): fuente 2015 instrumentado

- **Qué es:** `reference/p0/oracle/` es una copia de `reference/jmab-2015/src` con todo el azar instrumentado, compilada con ECJ en `oracle.jar`. Se corre con `reference/tools/run-oracle.sh <nombre> <semilla> <rondas> [desde hasta]`.
- **Cambios contra el fuente (solo en el azar):**
  - `Collections.shuffle(employees)` y `Math.random()` pasan a un `java.util.Random` con semilla.
  - El `prng` de la configuración se siembra con un número fijo en vez de la fecha.
  - Se arranca con `net.sourceforge.jabm.SimulationManager` (como el `.jar`), sin interfaz.
  - La distribución de cada sorteo es la misma que en el `.jar`.
- **Registro de sorteos** (`draws.tsv`, una línea por sorteo: secuencia, tick, tipo, lugar, resultado). Tipos: `fn` (normal plegada), `bern` (cambio de proveedor, con su p), `shuffle` (orden de compradores y de candidatos a empleo público), `sample` (vendedores que ve cada comprador), `shuffleEmp` (orden de los empleados de una empresa), `unif` (rescate de bancos). Se registra el **resultado**, no el número crudo: el port no necesita reproducir los algoritmos de Colt, solo pedir los mismos sorteos.
- **Reproducibilidad verificada (2026-11-12):**
  - Dos corridas con la semilla 12345 y 6 trimestres: los mismos 212.680 sorteos y los mismos 36 CSV.
  - Dos corridas con la semilla 777 y 60 trimestres (14 quiebras de empresas en el medio): los mismos CSV.
  - La semilla 778 da otros resultados (32 de 36 CSV distintos).
- **Volumen:** ~35.000 sorteos por trimestre con el registro completo; para V3 se registra solo la ventana de ticks que se compara.
- **Falta, para P3:** volcar el estado completo (balances, contratos, expectativas, rezagos, márgenes, proveedores previos) al principio de un tick, en un formato que lea el port. Se arma en P3, regla por regla, porque el formato depende del estado del port (P1).
