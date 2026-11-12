# Cambio de enfoque: Caiani et al. (2016) como modelo base (2026-11-12)

## Decisión

**Decisión de Nico (2026-11-12):** dejar de combinar reglas de distintos modelos (Gaffeo, Assenza, Caiani, Dosi y otros) y **portar fielmente Caiani et al. (2016)** como modelo base, verificando cada ecuación contra su código publicado (JMAB). Las particularidades argentinas entran como **extensiones**: cada diferencia con Caiani es una extensión documentada, con su fuente y su test.

- **Modelo base:** Caiani, Godin, Caverzasi, Gallegati, Kinsella & Stiglitz (2016), *Agent based-stock flow consistent macroeconomics: Towards a benchmark model*, Journal of Economic Dynamics and Control 69, 375–408.
- **Código de referencia:**
  - [`S120/benchmark`](https://github.com/S120/benchmark): el modelo (agentes, estrategias, `model/mainBaseline.xml` con los parámetros);
  - [`S120/jmab`](https://github.com/S120/jmab): la biblioteca (mercados, expectativas, estrategias genéricas).
- **Versión del autor del paper:** [PDF](https://business.columbia.edu/sites/default/files-efs/imce-uploads/Joseph_Stiglitz/Agent%20based-stock%20flow.pdf). Las ecuaciones no se leen bien en la extracción de texto, por eso la referencia operativa es el código.

## Por qué

### 1. La mezcla de modelos produjo un modelo propio, no validado como conjunto

Las reglas de la Fase 0 y del tramo 1a venían de al menos nueve fuentes, cada una calibrada en su propio modelo:

| Regla | Fuente |
|---|---|
| R1 precio y cantidad | Gaffeo et al. (2008) / CATS; corrección con Dawid et al. (2024) |
| R2 salarios | Delli Gatti et al. (2011), **sin verificar** |
| R4 mercado de trabajo | Riccetti et al. (2015), sin verificar |
| R5 consumo | Godley & Lavoie (2007), SIM/SIMEX |
| R6 mercado de bienes (Fase 1) | Delli Gatti, Terranova & Turco (2023) |
| R7 dividendos | Caiani (ρ) + Ley 19.550 + supuesto de endeudamiento |
| R9 crédito | Dosi et al. (2013) + expectativas de Caiani |
| R10 inversión | Caiani |
| R11 capital | Assenza et al. (2015) + valuación de Caiani + Ramey & Shapiro (2001) |
| R12 quiebras y entrada | Caiani + Assenza + K+S |
| R13 banco | Assenza + Dosi + Stiglitz & Weiss + Caiani + Basilea |

Al juntarlas aparecieron interacciones que ninguna fuente estudió, y cada una pidió un parche:
- **Espiral salarial (paso 1a.3):** R2 sube salarios y nunca los baja, y R1 (CATS) no traslada costos a precios.
- **Ola de quiebras y banco insolvente:** R7 repartía el 90% de los meses buenos; R6 sin fidelidad daba ventas muy volátiles. Parches: R7 revisada, condiciones iniciales calibradas, R6 con fidelidad, R13 con riesgo.
- **"Trampa sin caja":** empresas vivas que no producen nunca más. Parches: R13 por pérdida esperada, R9 con ventas esperadas, Sᵉ inicial.
- **Colapso con inversión neta (R10):** primero por la regla de cantidad del sector de capital, después por la regla de Assenza mezclada con nuestra R2.

Cada parche era razonable y tenía fuente, pero **la suma es un modelo nuevo**, cuyo comportamiento conjunto nadie publicó ni validó. Eso contradice el principio de "no reinventar" (CLAUDE.md, "Fuentes").

### 2. Tres reglas se apartaron de su fuente sin que se notara

1. **R1 (Fase 0):** la cantidad se ajustaba sobre la producción deseada y no sobre la efectiva. La producción deseada crecía sin límite (de 17 a 25.756 trabajadores deseados en la semilla 1). Corregido con Dawid et al. (2024), ec. 14.
2. **R6:** los hogares elegían proveedor al azar todos los meses. CATS tiene fidelidad al proveedor. Corregido con Delli Gatti, Terranova & Turco (2023).
3. **R11, regla de cantidad de las empresas de capital:** se citaba a Assenza (ec. 6.1–6.2), pero se implementó con el paso al azar de R1 sobre ventas censuradas. Con la regla de Assenza, a su vez, la economía se desestabiliza.

Por eso Nico pidió el proceso de revisión término por término (ver "Revisión de las reglas contra sus fuentes" en `fase1-reglas.md`). Esa revisión encontró seis diferencias más.

### 3. R2 no tiene fuente verificable

R2 alimenta la espiral salarial y el salario alto del sector de capital, y es la única regla del núcleo **sin ecuación verificada**:
- el libro de CATS no es de acceso abierto;
- la versión de CATS que se usaba para el capital (Assenza) tiene **salario fijo**.

Caiani sí tiene una regla salarial explícita y con código: salario de reserva adaptativo según la desocupación (*"Workers follow an adaptive heuristic to set their reservation wage: if over the year (i.e., four periods), they have been unemployed…"*, sección 3.4), con un umbral de desempleo de 0,08 en la revisión salarial (cuadro 3).

### 4. La regla de Assenza no encaja

La regla de cantidad de Assenza (ec. 6.2) es fiel a su fuente, pero combinada con nuestra R2 (salarios que no bajan) y con la escasez de trabajo inicial desestabiliza la economía incluso sin inversión neta: desempleo de 54% y criterio de la Fase 0 en 0/20. Es la prueba más clara de que las reglas no se pueden trasplantar de a una: cada una supone el resto de su modelo.

### Por qué Caiani

- **Es un modelo completo y SFC:** hogares, empresas de consumo y de capital, bancos, gobierno y banco central, con matrices de balances y de flujos publicadas. Encaja con el principio 3 (contabilidad SFC).
- **Tiene el código publicado** (JMAB), así que cada ecuación se puede verificar contra lo que de verdad corre, que fue lo que permitió verificar R10.
- **Está calibrado a un estado estacionario** (apéndice A), con todos los parámetros en el cuadro 3.
- **Ya usábamos muchas de sus piezas:** ρ de dividendos, inversión, inventarios al costo, garantía de la planta y venta forzosa, expectativas adaptativas, plazo de préstamos a 5 años.
- **Fue pensado como modelo de referencia** (*"towards a benchmark model"*), para que otros lo extiendan.

## Estado de cada regla al cerrar el enfoque anterior (código en `packages/engine/src/model.ts` y `phase1.ts`)

| Regla | Qué hace hoy | Estado | Lo aprendido |
|---|---|---|---|
| R1 precio y cantidad (consumo) | Tabla de cuatro casos de CATS, paso u ≤ 5%; con capital, tope κK y piso con amortización | Corregida (cantidad sobre la producción efectiva). Diferencias con Assenza: paso 0,05 contra 0,1; piso sin costo financiero | Mueve precios relativos, no el nivel; no traslada costos (Dawid et al., 2024). Al tope de capacidad no sube el precio: fiel a Assenza, y explica menos del 10% del achicamiento del efecto de la emisión |
| R2 salarios | Suben u ≤ 5% si quedaron vacantes; nunca bajan | **Sin fuente verificada** | Con crédito, espiral salarial; frena la expansión del sector de capital |
| R3 demanda de trabajo | ⌈Y*/α⌉, acotada por la capacidad y la liquidez | Fiel a Assenza 5.8 | — |
| R4 mercado de trabajo | Mira 4 empresas con vacantes, va a la de mayor salario | Sin verificar (Riccetti) | — |
| R5 consumo | α1·YD₋₁ + α2·W (0,9 y 0,05 por mes) | Es SIMEX, no SIM (solo la documentación está mal) | — |
| R6 mercado de bienes | Fidelidad al proveedor, β = 1 (Fase 1) | Fiel a DTT (2023) | Sin fidelidad, ventas muy volátiles y quiebras; la volatilidad podría tener forma de U según β |
| R7 dividendos | Anual sobre el resultado acumulado (LSC), ρ·(1 − ℓ) | Adaptación aprobada | Repartir el 90% de cada mes bueno drenaba el patrimonio; la ganancia contable con capital no es caja (llevó a la trampa sin caja) |
| R8 Tesoro | Alícuota con base de pleno empleo, emisión del déficit | Supuesto propio | Sin la base de pleno empleo, desempleo de 64–67% |
| R9 crédito | Límite λ·Sᵉ, orden patrimonio/Sᵉ, 12 meses el capital de trabajo, 60 la inversión | Adaptación aprobada | Con las ventas del mes anterior, el límite tenía un estado absorbente en 0 |
| R10 inversión | Caiani, verificada en el código | **Apagada por defecto** | Colapsa la economía combinada con nuestras reglas del sector de capital |
| R11 capital | Leontief, depreciación δω, 100 empresas de consumo + 20 de capital, inventario al costo, venta forzosa | Interruptor en la regla de cantidad del sector de capital (por defecto, la que se aparta de Assenza) | Con la planta en el patrimonio casi no hay quiebras; sin tope de capacidad vuelve la espiral salarial |
| R12 quiebras y entrada | Patrimonio < 0 o 3 cuotas impagas; venta forzosa r_K = 0,3; entrada uno a uno con Sᵉ = plan × precio | Fiel a Caiani en el disparador | La venta forzosa sin comprador es un impuesto implícito a los depositantes |
| R13 banco | Logística de Assenza, tasa de no arbitraje a un mes, LGD con la planta, racionamiento por pérdida esperada, límite de Basilea | Adaptación aprobada. Dividendos 0,9 contra 0,6 de Caiani | Sin precio del riesgo el banco se fundía (20/20); con R13 queda solvente y su patrimonio se duplica en 50 años (revisar el margen) |

El detalle de cada paso, con todas las tablas, está en [fase1-reglas.md](fase1-reglas.md) (registro histórico). Las reglas de la Fase 0 están en [fase0-reglas.md](fase0-reglas.md).

## Lo aprendido que sirve para el port

**Errores (todos documentados en `fase1-reglas.md`):**
- R1 sobre la producción deseada.
- Ingresos del banco que contaban los intereses capitalizados.
- Error de protocolo: B se calentaba con s = 0,5.
- Demanda del sector de capital que contaba pedidos impagables.
- Tests que pasaban en vacío.
- Afirmaciones mías sin verificar que después resultaron falsas: margen de 1,08, una cita a Fama-French.

**Lección:** verificar contra el código, no contra la descripción del paper.

**Métricas que conviene conservar en el port:**
- empresas paradas (activas sin producir 12 meses o más);
- empresas nuevas atrapadas en su primer año;
- ahorro forzoso (presupuesto de los hogares que no encuentra bienes);
- doble conteo de las colas;
- quiebras por sector;
- patrimonio del banco (final / inicial) y castigos sobre intereses;
- descomposición de la emisión (M·V = P·Y);
- criterio de la Fase 0 con A y B calentadas igual.

**La métrica de zombis** (deuda 24 meses seguidos y ventas en baja) deja de servir con préstamos a 5 años: hay que redefinirla.

**Para los puntos de control:**
- el criterio de G = 0;
- la magnitud del efecto de la emisión (B: 3,3% en la Fase 0 original → 1,3–2,4% según la etapa);
- el margen del banco;
- la tasa de quiebras contra el 5–10% empírico (OEDE, a verificar);
- las quiebras de empresas nuevas en el primer año.

**Determinismo:** Caiani usa funciones trascendentales (logística con exponencial, distribución normal plegada para los ruidos). Ya existen equivalentes deterministas con las cuatro operaciones:
- `detmath.ts:expNeg`;
- `creditRisk.ts:logistic` y `fitGroupedLogistic` (Newton con cantidad fija de iteraciones).

Para la normal plegada habrá que buscar una aproximación determinista (por ejemplo, suma de uniformes, o inversa por tramos) y documentarla como adaptación.

## Infraestructura que se reutiliza

Ninguna de estas piezas depende de qué reglas de comportamiento se usen:

| Pieza | Archivo | Para qué |
|---|---|---|
| PRNG con semilla | `src/rng.ts` (xoshiro128** + splitmix32) | Determinismo |
| Dinero en centavos enteros | `src/money.ts` | Contabilidad exacta |
| Instrumentos y primitivas SFC | `src/ledger.ts` (`issue`, `redeem`, `transfer`, `checkAgentsSfc`, `netFinancialWorth`) | Invariante SFC por construcción |
| Flujos compuestos | `src/flows.ts`: pagos privados, Tesoro, adelantos del BCRA, `lend`, `repayLoan`, `payToBank`, `payFromBank`, `writeOffLoan`, financiamiento del BCRA al banco | Cada peso es activo de alguien y pasivo de otro |
| Motor por etapas | `src/step.ts` (`step` puro, etapas inyectables, verificación SFC por tick) | Las reglas de Caiani se arman como nuevas etapas |
| Calentamiento y relojes | `src/warmup.ts`; `tick` y `elapsedTicks` | Igual |
| Perillas, log y replay | `src/knobs.ts`, `src/replay.ts` | Corridas reproducibles |
| Hash de estado | `src/hash.ts` | Verificar corridas importadas |
| Matemática determinista | `src/detmath.ts`, `src/creditRisk.ts` (logística y ajuste) | Funciones de Caiani sin trascendentales |
| Tests de infraestructura | `no-math-random`, `determinism`, `sfc`, `hash`, `warmup`, `bank` (flujos del crédito), `rng`, `detmath` | Siguen valiendo tal cual |
| Herramientas de medición | `test/helpers/variants.ts` (`runVariant` y métricas), `phase0Criteria.ts`, `scripts/fase1-report.ts` | Se adaptan a las etapas nuevas |
| Test calculado a mano por regla | `test/rules-by-hand.test.ts` (patrón con `FixedRng`) | Proceso obligatorio para cada regla portada |
| App | `packages/app` (Web Worker por cápsula, grilla en Canvas 2D, archivo de corrida v2, e2e en Chrome headless) | La visual consume snapshots; no depende de las reglas |

**Se reemplaza:** las reglas de comportamiento de `model.ts` (Fase 0) y `phase1.ts` (tramo 1a), con sus parámetros (`PARAMS`, `CREDIT`, `CAPITAL`, `MARKET`, `PHASE1_INITIAL`). Quedan en el repositorio como referencia hasta que el port pase sus criterios: la Fase 0 sigue siendo el estado que usa la app.

## Preguntas abiertas para el port (para decidir con Nico antes de escribir código)

1. **Duración del período.** Caiani es trimestral; Petri es mensual (la visual, el log y los indicadores INDEC son mensuales). ¿Se porta trimestral y se mira mensual, o se convierten los parámetros a mensuales (como se hizo con γ y λ_e)?
2. **Cantidad de bancos.** Caiani tiene 10 bancos con mercado de depósitos y de crédito; Petri tiene 1. Varios bancos son parte de la dinámica (red de crédito), pero suman complejidad.
3. **Bonos del gobierno.** En Caiani el gobierno se financia con bonos que compran los bancos y el banco central. En el roadmap, los bonos entran en la Fase 2. ¿Se portan ahora, porque son parte del modelo base?
4. **Gobierno.** Caiani emplea funcionarios públicos (1.360 de 8.000 hogares) y paga un subsidio por desempleo (40% del salario promedio). Petri tiene transferencias universales y la perilla `s`. ¿El gasto de Caiani pasa a ser el base y las perillas actuales se reformulan como extensiones?
5. **Tamaño.** Caiani: 8.000 hogares, 100 empresas de consumo, 20 de capital, 10 bancos. Petri: 2.000 hogares, 100 + 20 empresas, 1 banco. Medir el costo por tick en el navegador.
6. **Criterios de salida.** El de la Fase 0 (más emisión ⇒ más inflación) y el de G = 0 se vuelven a correr con el port. Primero hay que reproducir los resultados publicados de Caiani (estado estacionario, correlaciones del paper) como prueba de que el port es fiel.

## Extensiones argentinas ya identificadas (pendientes, siguen valiendo)

- Ajuste por inflación contable como perilla (RT 6, NIC 29, Ley 27.468): ganancias ficticias, e impuesto a esas ganancias cuando entre Ganancias.
- Recupero de la venta forzosa sobre el costo de reposición, con inflación alta.
- Inflación por restricción de capacidad como perilla de teoría.
- Traslado de costos a precios como perilla de teoría (CATS nulo; CANVAS y K+S total).
- Gasto público nominal, indexado o como % del PBI (tramo 1c).
- Ley de quiebras argentina (cesación de pagos, Ley 24.522).
- Crédito al sector privado bajo en relación con el PBI.
- Tasa real y margen del banco contra datos del BCRA.
- Dato de cierre de empresas del OEDE.
- Sectores (agro, industria, servicios, comercio), formalidad, estratos e indicadores INDEC, del plan de la Fase 1.

Detalle en [pendientes.md](pendientes.md).
