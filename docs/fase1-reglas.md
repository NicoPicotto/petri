# Fase 1: reglas y estado

> **Registro histórico (2026-11-12).** Este documento registra el tramo 1a con el enfoque anterior (reglas combinadas de varios modelos). Desde el 2026-11-12 el modelo base es Caiani et al. (2016): ver [cambio-de-enfoque.md](cambio-de-enfoque.md). Las mediciones, los errores y la revisión contra fuentes de acá siguen valiendo como antecedente.

> El plan aprobado por Nico el 2026-11-11 está resumido en la sección "Plan". Los valores numéricos son **supuestos a calibrar**.
> Las reglas de la Fase 0 (R1–R8) siguen en [fase0-reglas.md](fase0-reglas.md); este archivo solo trae lo nuevo o lo que cambia.

## Plan (aprobado el 2026-11-11)

La fase va en **tres tramos**, con un punto de control con Nico al final de cada uno:

- **1a. Crédito, capital e inversión** (un sector de consumo + bienes de capital). Su objetivo es el criterio de G = 0 y la volatilidad.
- **1b. Sectores, necesidades, estratos e indicadores INDEC.** Los sectores son agro, industria de consumo, industria de capital y construcción, servicios y comercio.
- **1c. Formalidad y perillas fiscales y de regulación**, una perilla por paso, con la dirección esperada escrita antes de correr el test.

**Decisiones de Nico:**

| # | Tema | Decisión |
|---|---|---|
| 1 | Comercio | Intermediario con inventario: compra a agro e industria y vende a los hogares. |
| 2 | Tasa de interés y encajes | Parámetros fijos en la Fase 1. Pasan a ser perillas en la Fase 2, junto con los bonos (anotado en `CLAUDE.md`). |
| 3 | Criterio de G = 0 | Con G = 0 desde la creación, 20 semillas y 50 años: el desempleo promedio de los últimos 10 años es menor a 15%, sin tendencia, y la producción nunca se corta. Al pasar a G = 0 después del calentamiento, la economía se recupera en menos de 10 años. Se documenta además un **mapa de parámetros** que muestre en qué región se cumple. |
| 4 | Archivos de corrida de la Fase 0 | La app los rechaza con un mensaje claro. Nico pone el tag de git `fase-0`. |
| 5 | Perilla `s` | Se reemplaza por impuestos explícitos en el tramo 1c. |
| 6 | Retenciones | Pasan a la Fase 2. |
| — | Valuación del capital | Antes de R12 (quiebras), proponer con fuente cómo se valúa el capital en el patrimonio neto (costo histórico, de reposición o depreciado), porque define cuándo quiebra una empresa. |

**Reglas propuestas** (cada una espera su OK antes de implementarse):

| Regla | Contenido |
|---|---|
| R9 | Crédito |
| R10 | Inversión |
| R11 | Producción con capital |
| R12 | Quiebras y entrada |
| R13 | Banco |
| R7 revisada | Dividendos sin colchón |
| R14 | Consumo con el sistema lineal de gasto |
| R15 | Frecuencia de revisión de precios por sector |
| R16 | Formalidad |
| R17 | Búsqueda desde el empleo |
| R18 | Salario mínimo y paritarias |
| R19 | Indemnización |
| R20 | Control de precios |
| R8 v2 | Impuestos y gasto |

Las fuentes de cada una están en el plan. Se pasan a este archivo a medida que se aprueban.

## Paso 1a.0: diagnóstico con G = 0 (2026-11-11)

**Herramientas:**
- [test/helpers/diagnostics.ts](../packages/engine/test/helpers/diagnostics.ts) intercala *sondas* entre las etapas de la Fase 0. Las sondas solo leen el estado y no usan el generador de azar; un test verifica que el hash de la corrida medida es igual al de la normal.
- Reporte completo: `pnpm --filter @petri/engine report:fase1` (~25 s).
- Tests: [g0-diagnostic.test.ts](../packages/engine/test/g0-diagnostic.test.ts).

Medido en los últimos 10 de 50 años visibles, con 20 semillas. Los números son promedios de las 20 semillas.

| Escenario | Desempleo | Dinero / masa salarial de pleno empleo | Ahorro forzoso / gasto | Empresas limitadas por liquidez |
|---|---|---|---|---|
| Referencia: Fase 0 tal como está (G = 50.000, s = 0) | 4,6% | 5,78 meses | 14,8% | 100% |
| G = 0 desde la creación | **66,9%** (62–72%) | **3,84 meses** | 43,1% | 100% |
| Calentamiento con G = 50.000 y G = 0 desde el mes 0 | **10,9%** (6–14%) | 5,43 meses | 15,2% | 100% |

### Hallazgo 1: el empleo lo determina el dinero

- Con G = 0 no hay emisión y el dinero privado queda exactamente constante. Un test lo verifica.
- **Todas** las empresas, todos los meses, quieren más trabajadores de los que pueden pagar. El empleo queda en "depósitos de las empresas / salario".
- La diferencia entre los dos escenarios con G = 0 es solo cuánto dinero había al sacar el gasto:
  - **Desde la creación**, queda el dinero inicial (3,84 meses de masa salarial de pleno empleo) y el desempleo es de 67%.
  - **Si se pasa a G = 0 después del calentamiento**, queda el dinero que la emisión cíclica acumuló durante los 240 meses (5,43 meses) y el desempleo es de 11%.
- **Corrección a la Fase 0**: el contrafáctico citado en `fase0-reglas.md` (56% a 69%) corresponde al escenario "desde la creación". Si se pasa a G = 0 después del calentamiento, la economía **no** colapsa.

### Hallazgo 2: defecto en R1, la producción deseada crece sin límite

En el código, R1 ajusta `plannedOutput` sobre sí misma (`q ← q·(1+u)`), no sobre lo que la empresa efectivamente produjo. Una empresa limitada por liquidez produce poco, vende todo y vuelve a subir su producción deseada, mes tras mes. Semilla 1, con G = 50.000:

| Mes | Trabajadores deseados (mediana de las 30 empresas) | Máximo | Empresas limitadas por liquidez |
|---|---|---|---|
| 12 | 17 | 19 | 15/30 |
| 120 | 42 | 156 | 29/30 |
| 240 (fin del calentamiento) | 113 | 2.496 | 30/30 |
| 840 | 25.756 | 4.641.686.613 | 30/30 |

**Consecuencias:**
1. Desde más o menos el mes 120, R3 no despide nunca por cantidad: cada empresa contrata todo lo que puede pagar. R1 sigue moviendo los **precios**, pero la **cantidad** dejó de tener efecto.
2. **R7 deja de repartir dividendos.** El colchón es "1 mes de masa salarial *deseada*", que se vuelve astronómico. En la semilla 1 no hay dividendos desde el mes 137. Durante toda la parte visible de las corridas de la Fase 0, los dueños no cobran nada y las empresas retienen el 100% de la ganancia.
3. Los resultados de la Fase 0 (más emisión ⇒ más inflación) siguen valiendo como hechos medidos. Pero el mecanismo que describe `fase0-reglas.md` no es el que opera: "empresas que buscan contratar → vacantes → salarios" funciona, pero con la cantidad desanclada. El análisis del calentamiento también está afectado: la "convergencia" convive con esta deriva.

### Corrección de R1 (aprobada y aplicada el 2026-11-11)

- **Regla:** la cantidad se ajusta sobre la producción efectiva del mes anterior: `q ← y_{t−1}·(1 ± u)`, y `q ← y_{t−1}` cuando se ajusta el precio. El estado guarda `Firm.lastOutput`.
- **Fuente, confirmada contra el texto:** Dawid, Delli Gatti, Fierro & Poledna (2024), *Implications of Behavioral Rules in Agent-Based Macroeconomics*, CESifo WP 11411. Su ecuación 14 dice `Y*_t = (1 + (1 − δ_QD)·γ^QD)·(1 + δ_Y·γ^Y)·Y_{t−1}`, "relative to output in the previous period". El cuadro 1 pone a CATS como caso particular: con `δ_Y = 0`, y `δ_QD` condicional según ajuste precio o cantidad. El paper original (Gaffeo et al., 2008) no se pudo descargar (403).
- Los sorteos aleatorios siguen en el mismo orden. Cambia el estado, así que **cambian los hashes**: los archivos de corrida exportados antes de la corrección ya no verifican (Nico lo aceptó). No se subió la versión del formato. Eso queda para la v3 de la Fase 1 (paso 1c.6).

**Efecto en el diagnóstico con G = 0** (20 semillas, últimos 10 de 50 años):

| Escenario | Desempleo antes | Desempleo después | Margen después |
|---|---|---|---|
| Referencia (G = 50.000, s = 0) | 4,6% | 4,3% | 1,69 |
| G = 0 desde la creación | 67% | **100%** | — |
| G = 0 desde el mes 0, después del calentamiento | 10,9% | **6–12%** (media ~8,5%) | 1,73 |

- **Desde la creación, la economía se detiene.** Las empresas quedan sin depósitos para pagar ni un salario, los hogares tienen todo el dinero y no hay nada que comprar. Es un estado del que no se sale sin crédito: el ejemplo más claro de por qué hace falta el capital de trabajo financiado por el banco (R9).
- **Después del calentamiento, con el dinero acumulado, se sostiene.** Hay ~2% de puestos perdidos por liquidez y 14% de ahorro forzoso.

**Efecto en la Fase 0, y qué quedó para decidir:** ver [fase0-reglas.md](fase0-reglas.md):
- Las secciones "Resultados después de la corrección de R1" y "Revisión después de la corrección de R1" (en Calentamiento).
- Las notas de R7 y R8. En resumen: el criterio se cumple; el colchón de R7 ya no hace falta; la base de pleno empleo de R8 sí; y el calentamiento de 240 meses queda corto (se propone 360).

### Qué cambia del plan

- El diagnóstico confirma la hipótesis del dinero fijo y la vuelve más fuerte: sin crédito, la economía con G = 0 desde la creación se detiene del todo.
- **Decisiones de Nico (2026-11-11):** calentamiento de 360 meses con un test por promedios de 5 años, y eliminación inmediata del colchón de R7 (ver `fase0-reglas.md`). Con los dos cambios, el diagnóstico con G = 0 da:
  - Desde la creación: 100% de desempleo.
  - Al pasar a G = 0 después del calentamiento: entre 5,6% y 22,6%, media 12,5%, con margen ~1,82.
  - Referencia (G = 50.000): 4,3%.

## Paso 1a.1: escala y volatilidad (2026-11-11)

**Herramientas:**
- [test/helpers/scale.ts](../packages/engine/test/helpers/scale.ts) escala todo en proporción a la Fase 0: empresas = 6% de los hogares y gasto = 100 pesos por hogar por mes.
- Reporte: `pnpm --filter @petri/engine report:fase1 escala` (~45 s).
- Test: [scale.slow.test.ts](../packages/engine/test/scale.slow.test.ts), en la **suite lenta nueva**: `pnpm test:slow`. Los archivos `*.slow.test.ts` quedan fuera de `pnpm test`.

Medido con 10 semillas, 20 años después del calentamiento de 360 meses, s = 0:

| Hogares | Empresas | Desempleo medio | Desvío del nivel de desempleo | Desvío del cambio mensual | Inflación mensual: desvío | Ventanas de 5 años: desvío · rango | Margen | ms por mes | Calentamiento |
|---|---|---|---|---|---|---|---|---|---|
| 500 | 30 | 4,6% | 3,30 pp | 1,42 pp | 0,33% | 0,56% · −1,9% a 2,6% | 1,80 | 0,49 | 0,2 s |
| 1.000 | 60 | 3,6% | 2,41 pp | 1,01 pp | 0,24% | 0,48% · −0,8% a 2,3% | 1,76 | 0,98 | 0,3 s |
| 2.000 | 120 | 2,8% | 2,12 pp | 0,73 pp | 0,18% | 0,43% · −1,0% a 1,5% | 1,72 | 2,00 | 0,7 s |
| 4.000 | 240 | 2,7% | 2,18 pp | 0,53 pp | 0,15% | 0,53% · −0,9% a 1,8% | 1,70 | 4,10 | 1,5 s |

Proporción contra 500 hogares (1/√N esperaría 0,71 · 0,50 · 0,35):

| Hogares | Nivel de desempleo | Cambio mensual | Inflación mensual | Ventanas de 5 años |
|---|---|---|---|---|
| 1.000 | 0,73 | 0,71 | 0,73 | 0,84 |
| 2.000 | 0,64 | 0,52 | 0,54 | 0,77 |
| 4.000 | 0,66 | 0,37 | 0,44 | 0,94 |

**Lectura:**
1. **El ruido mes a mes es efecto del tamaño, como suponía la hipótesis de la Fase 0.** El cambio mensual del desempleo y la inflación mensual caen como 1/√N.
2. **Las oscilaciones lentas no lo son.** El desvío del nivel de desempleo se planta en ~2,1 pp desde 2.000 hogares, y el de la inflación de 5 años no baja (~0,5 pp). Son ciclos agregados del modelo: la limitación 2 de la Fase 0 ("inflación de 5 años ruidosa") **no se arregla con más agentes**. Una hipótesis para verificar, no comprobada: vienen de la emisión cíclica (recesión → déficit → emisión → precios). Habría que mirarlo de nuevo cuando el crédito haga endógeno el dinero.
3. **El tamaño mueve los niveles**: con más empresas, el desempleo medio baja de 4,6% a 2,7% y el margen de 1,80 a 1,70. La búsqueda mira siempre 3 o 4 empresas, cualquiera sea el total; con más empresas, la economía se coordina un poco mejor.
4. **Rendimiento**: el costo es lineal, ~1 ms por mes cada 1.000 hogares en Node. La app corre hasta 120 meses por segundo por cápsula (~8 ms por mes); la Fase 1 va a sumar costo por sectores y crédito.

**Tamaño elegido por Nico (2026-11-11): 2.000 hogares y 120 empresas** (`PHASE1_CONFIG`). Se lleva casi toda la reducción del ruido mes a mes (0,52 y 0,54) y usa 2 ms de los ~8 por mes, lo que deja lugar para lo que agrega la Fase 1. Con 4.000 se gana poco más (solo en el ruido mes a mes) y se usa la mitad del presupuesto antes de agregar nada. `PHASE0_CONFIG` (500 hogares) queda como referencia de la Fase 0: la usan sus tests, el diagnóstico con G = 0 y la app hasta el paso 1c.6.

**Qué es "plausible" para la volatilidad:** el criterio de salida pide niveles plausibles y todavía no hay una referencia con datos. Propuesta: definirla en la Fase 3 contra series del INDEC (la EPH es trimestral, así que habría que comparar la volatilidad trimestral simulada) y, mientras tanto, usar este reporte para seguir la tendencia.

### Calentamiento con 2.000 hogares

Nico pidió 420 meses y volver a verificar la convergencia con el tamaño nuevo. Bloques de 5 años desde la creación, 20 semillas:

| Años | 15–20 | 20–25 | 25–30 | 30–35 | **35–40** | 40–45 | 45–50 | 50–55 | 55–60 |
|---|---|---|---|---|---|---|---|---|---|
| Desempleo | 10,7% | 7,3% | 4,0% | 3,0% | **2,5%** | 2,9% | 2,6% | 2,6% | 3,0% |
| Margen | 1,75 | 1,75 | 1,74 | 1,73 | **1,72** | 1,73 | 1,72 | 1,71 | 1,71 |

Brecha entre los últimos 5 años del calentamiento y el régimen (años 40 a 50):

| Calentamiento | Desempleo: media · error estándar | Margen |
|---|---|---|
| 360 | 1,23 pp · 0,36 | 0,013 |
| **420** | **0,23 pp · 0,39** | **−0,002** |
| 480 | −0,29 pp · 0,34 | −0,008 |

**Con 420 meses alcanza**: la brecha está dentro de un error estándar. El test de la suite lenta `burnin-phase1.slow.test.ts` exige menos de 1 pp y menos de 0,01 en margen (con 360 meses falla). `PHASE0_CONFIG` también pasó a 420.

## Paso 1a.2: balance del banco (2026-11-11)

Solo contabilidad. Todavía ninguna regla presta, así que las corridas de la Fase 0 dan lo mismo que antes (lo que cambia es el hash, porque hay un instrumento nuevo).

- **Instrumento nuevo `centralBankCredit`**: financiamiento del BCRA al banco (pases o redescuentos). Es activo del BCRA y pasivo del banco.
- **Flujos nuevos** en `flows.ts`: `lend`, `repayLoan`, `payToBank`, `payFromBank`, `writeOffLoan`, `ensureBankReserves` y `repayCentralBankCredit`. **Patrimonio:** `netFinancialWorth`. Detalle y efectos en [sfc.md](sfc.md).
- **`payToTreasury` ahora pide reservas al BCRA si al banco no le alcanzan.** En la Fase 0 eso nunca pasa (el banco tiene reservas = depósitos); un test lo verifica.
- **Tests** (`test/bank.test.ts`, 12):
  - El préstamo crea un depósito por el mismo monto y no cambia ningún patrimonio.
  - Prestar no requiere reservas.
  - Los intereses suben el patrimonio del banco en lo mismo que baja el del deudor.
  - El castigo baja el patrimonio del banco exactamente en el monto castigado.
  - Un pago al Tesoro funciona con un banco sin reservas.
  - El patrimonio financiero neto total sigue siendo cero.
  - Las reglas de la Fase 0 no generan préstamos.
- La etapa de transacciones al azar de los tests ahora también ejercita el instrumento nuevo, así que el invariante SFC se prueba con él.

**Siguiente: paso 1a.3** (crédito para capital de trabajo, R9 + R13). La propuesta está abajo y espera el OK de Nico.

## Propuesta para el paso 1a.3: R9 y R13

**Estado (2026-11-11):** Nico aprobó R9 y R13 con sus parámetros, con cuatro condiciones:
1. Confirmar contra el texto la ecuación del límite de deuda de Dosi et al. (2013). **No coincidió** (ver "Verificación contra el texto" abajo). Se espera que Nico elija la versión.
2. En el punto de control 1a, medir en A y B el crédito total, la tasa real (nominal − inflación) y la proporción de empresas endeudadas. Con la tasa nominal fija, si la inflación supera la tasa, el crédito podría explotar.
3. En el paso 1a.4, verificar que no queden empresas zombis por cuotas impagas acumuladas.
4. Proponer la valuación del capital antes del paso 1a.5.

### Verificación contra el texto: Dosi et al. (2013)

Fuente: working paper OFCE 2012-06 (la versión de JEDC 37 es paga), sección 3.4 y cuadro de parámetros.

| | Propuesta original | Texto |
|---|---|---|
| Límite por empresa | Deuda ≤ 3 meses de ventas promedio (últimos 3 meses) | Ec. 3: `Deb_j(t) ≤ λ·S_j(t−1)`, ventas de un solo período anterior. El texto dice 0 ≤ λ ≤ 1, pero el cuadro usa λ = 2 (inconsistencia del paper). No se dice cuánto dura un período. |
| Límite total | Patrimonio del banco / 8% (Basilea) | Ec. 4: `MTC(t) = k·Σ_j NW_j(t−1)`, k = 2. Es un multiplicador sobre el patrimonio neto de las **empresas**, fijado por un "banco central no modelado". No hay patrimonio del banco. |
| Orden de atención | Menos deuda sobre ventas primero | Por patrimonio neto / ventas (mayor primero) |
| Tasa del préstamo | Base + spread fijo | Ec. 7: `r_L = (1 + μ_L)·r`, con μ_L = 0,5 y r = 2,5% |
| Tasa de los depósitos | 0 | Ec. 6: `r_D = (1 − μ_D)·r`, con μ_D = 1, o sea 0 |

**Versión corregida que se propone (espera el OK de Nico):**
- Límite por empresa como en la ec. 3: deuda ≤ λ · ventas del mes anterior.
- Orden de atención como en Dosi: por patrimonio neto / ventas, mayor primero.
- Tasa del préstamo como en la ec. 7: (1 + μ_L)·r. Con r = 3% y μ_L = 0,5 da 4,5% anual.
- Depósitos sin interés (coincide).
- Límite total: hay que elegir entre el multiplicador de Dosi y el requisito de capital del banco (Basilea). Ver la pregunta a Nico.

**Decisión de Nico (2026-11-11):**
- Límite total por el **capital del banco** (8%, Basilea).
- **λ = 3 meses de ventas del mes anterior**, documentado como supuesto: el paper es inconsistente y no define la duración del período.
- En el punto de control 1a, correr también el criterio de G = 0 y el de la Fase 0 con λ = 2 y λ = 6, para ver si los resultados cambian cualitativamente.

## Paso 1a.3: implementación y hallazgo (2026-11-11)

**Implementado** en [src/phase1.ts](../packages/engine/src/phase1.ts):
- `PHASE1_STAGES`, armadas con `makePhase1Stages(params)` para poder correr sensibilidades sin tocar los parámetros aprobados. `PHASE0_STAGES` quedan intactas: la Fase 0, sus tests y la app no cambian.
- Etapas en orden: apertura → R2 + R1 + **R9 (pedido y otorgamiento)** + R3 → mercado de trabajo → producción → gasto → mercado de bienes → **servicio de la deuda** → R7 (ganancia después de intereses) → **banco (R13)** → cierre.
- **Estado nuevo**:
  - En cada empresa: `loanBook` (saldo y cuota de cada préstamo), `lastRevenue`, `interestThisMonth` y `arrearsMonths`.
  - En el banco: `ownerId`.
  - En el estado: `credit`, con los flujos del mes.
- **Patrimonio inicial del banco**: 5% de los depósitos iniciales, como deuda pasada del Tesoro con el BCRA (`payTreasuryToBank`).
- **Flujos nuevos**: `payBankToCentralBank` (los intereses del BCRA pasan al Tesoro en el acto) y `payBankToTreasury`.
- **Corrección propia antes de medir:** la primera versión contaba como ganancia del banco los intereses capitalizados (los que no se cobraron). Eso no es lo aprobado ("intereses **cobrados**"); se corrigió.
- **Tests de mecánica** en `test/phase1-credit.test.ts`:
  - determinismo;
  - la suma de los saldos de cada empresa es igual a su deuda todos los meses;
  - el banco no supera su límite de capital al prestar;
  - ninguna empresa supera λ con préstamos nuevos;
  - los dividendos del banco salen solo de lo cobrado.

### Hallazgo: con R9 y R13, sin quiebras, la economía colapsa

Con G = 50.000, 500 hogares y 50 años, el desempleo llega a ~100%:
- **Desde la creación:** pasa en todas las semillas probadas.
- **Después de un calentamiento con la Fase 0** (economía estable): pasa en 2 de 3 semillas en 10–30 años; la tercera queda en 69%.

Al final, todas las empresas tienen deuda y están en mora.

**Mecanismo** (semilla 1, desde el estado calentado):
1. El crédito saca el freno de liquidez. Las empresas desean ~510 puestos para 500 hogares, así que siempre quedan vacantes sin cubrir.
2. R2 sube el salario cada mes que hay vacantes y nunca lo baja. El salario promedio pasa de 1.042 a 1.430 (**+37% en 6 años**), con el precio clavado en ~190.
3. **Los precios no trasladan el costo.** El margen precio/costo cae de ~1,3 a ~1,08. Con ~15% del stock sin vender, las empresas pierden plata y cubren la pérdida con crédito (la deuda pasa de 12k a 806k).
4. **Espiral de deuda.** Las cuotas se comen los depósitos con los que se pagan salarios. Repagar préstamos destruye depósitos, así que el dinero se contrae (deflación de deudas, Fisher). Y no hay quiebras que saquen a las empresas que pierden.

En la Fase 0 esto no pasaba porque la falta de liquidez limitaba las vacantes y frenaba la suba de salarios.

**Por qué R1 no traslada costos:** en CATS **no hay traslado de costos a precios**. Dawid, Delli Gatti, Fierro & Poledna (2024), sección 2.4: "In CATS, wage increases are fully absorbed in the markup", contra "full pass-through" en CANVAS y K+S. O sea, nuestra R1 es fiel a CATS. En CATS lo que limita la caída del margen son las quiebras (R12). El grado de traslado de costos es una diferencia entre familias de modelos, y Dawid et al. muestran que cambia la dinámica de la inflación. Por el principio 2 es candidato a **perilla de teoría** (Fase 3).

**Decisión de Nico:** sumar R12 ya, fusionando los pasos 1a.3 y 1a.4.

## R12: quiebras y entrada (implementada el 2026-11-11)

**Quiebra.** Una empresa quiebra si su patrimonio neto financiero es negativo, o si lleva **3 meses seguidos sin pagar completa la cuota** (contra empresas zombis, pedido de Nico). Al quebrar:
- despide a todos;
- sus depósitos van al banco a cuenta de la deuda y el resto se castiga (`writeOffLoan`);
- si sobra algo, vuelve al dueño (responsabilidad limitada);
- queda **inactiva**: no contrata, no produce, y los hogares no la visitan al buscar dónde comprar (`goodsMarketP1`).

Fuente: Delli Gatti et al. (2011); Assenza, Delli Gatti & Grazzini (2015).

**Entrada.** A los 3 meses entra una empresa nueva en el mismo lugar:
- tamaño: el mediano de las activas;
- precio y salario: los promedios;
- capital: 1 mes de su masa salarial, que pone un hogar elegido al azar entre los que tienen depósitos suficientes (una transferencia: no se crea dinero). Si ninguno alcanza, se reintenta el mes siguiente;
- sin ventas previas, así que no puede pedir crédito hasta vender (R9).

**Parámetros** (supuestos): `arrearsMonthsToBankruptcy` = 3, `entryDelayMonths` = 3, `entrantEquityMonths` = 1.

**Tests** (`phase1-credit.test.ts`):
- ninguna empresa activa termina un mes con 3 o más cuotas impagas seguidas;
- una empresa cerrada no tiene deuda ni trabajadores.

### Hallazgo 2: el banco se funde y el crédito se congela para siempre

Con R12, las quiebras castigan préstamos, y el patrimonio del banco (5% de los depósitos iniciales) se agota:
- **Desde la creación** (semilla 1): en el año 5 el patrimonio queda negativo. Desde ahí el banco no presta más, y el desempleo se estabiliza en ~70% con G > 0 y en 100% con G = 0.
- **Desde una economía calentada con la Fase 0**: la espiral salarial se repite (el salario promedio sube 23% en 4 años con el precio quieto). Las quiebras castigan ~20.000 pesos por año y el banco queda insolvente en el año ~15. Después, sin crédito, la economía vuelve a comportarse como la de la Fase 0: los precios se acomodan (de 189 a 239) y el desempleo baja a 3–13%.

Con 3 semillas, 500 y 2.000 hogares, el resultado a 50 años es el mismo en todos los casos: el banco termina con patrimonio negativo y nadie endeudado. El desempleo da entre 41% y 70% con G > 0, y 100% con G = 0.

**Dos problemas de diseño** (esperan la decisión de Nico):
1. **Nada recapitaliza a un banco insolvente.** Hay que decidir una regla. Las opciones son una recapitalización privada (como la entrada de empresas), un salvataje público (tiene carga ideológica: candidato a perilla, Fase 2 o 4) o cerrar el banco.
2. **La espiral salarial sigue.** Con crédito, la demanda de trabajo supera a los hogares, y R2 sube los salarios sin techo. R1 no traslada costos, porque es fiel a CATS. Las quiebras limpian empresas, pero no frenan la suba de salarios. Es un ciclo tipo Goodwin: cuando hay pleno empleo, la participación de los salarios sube y se comen las ganancias. Pero sin que el salario baje ni que el precio acompañe al costo, la suba no se revierte. Las salidas posibles tocan reglas con consenso (R2: el salario no baja) o en disputa (traslado de costos: perilla de teoría).

**R9. Crédito para capital de trabajo**

- **Demanda.** Después de R1, si los depósitos de la empresa no alcanzan para pagar la masa salarial de los trabajadores deseados, pide la diferencia: `pedido = max(0, w · deseados − depósitos)`. Primero usa fondos propios y después crédito (pecking order, Myers & Majluf, 1984).
- **Límite por empresa.** La deuda total no puede superar λ meses de ventas promedio de los últimos 3 meses. Así lo hacen Dosi, Fagiolo, Napoletano & Roventini (2013), *Income distribution, credit and fiscal policies in an agent-based Keynesian model*, JEDC 37: el crédito disponible es proporcional a las ventas pasadas. **Hay que confirmar la ecuación contra el texto.**
- **Límite del banco.** Total de préstamos ≤ patrimonio del banco / coeficiente de capital. Con un coeficiente de 8%, el mínimo de Basilea, que el BCRA aplica. Si el banco no alcanza a cubrir todos los pedidos, atiende primero a las empresas con menos deuda sobre ventas (el ranking de Dosi et al., 2013).
- **Repago.** Cuotas iguales de capital durante 12 meses, más intereses sobre el saldo.
- **Si la empresa no puede pagar la cuota (provisorio):** paga lo que puede y lo que falta se suma al saldo. La quiebra llega con R12, en el paso 1a.4.
- **Orden del tick:** R1 → **pedido y otorgamiento de crédito** → R3 (contrata hasta lo que puede pagar con depósitos + crédito) → … → mercado de bienes → **servicio de la deuda** → R7 (dividendos sobre la ganancia después de intereses).

**R13. Banco**

- **Tasa de los préstamos** = tasa base + spread fijo. La tasa base es un parámetro fijo en la Fase 1 (decisión 2). El spread según apalancamiento de Delli Gatti et al. (2010) necesita el capital de las empresas, así que se propone cuando entre R11.
- **Ganancia** = intereses cobrados − préstamos castigados − intereses pagados al BCRA.
- **Dividendo** = ρ_b · ganancia, solo con el patrimonio por encima del objetivo (10% de los préstamos). Va a un hogar dueño elegido al azar, como en las empresas (Caiani et al., 2016).
- **Patrimonio inicial del banco:** sale de la misma historia que la riqueza inicial de la Fase 0, deuda pasada del Tesoro con el BCRA. El Tesoro le da reservas al banco sin depósito del otro lado, así que el patrimonio queda igual a esas reservas.
- **Financiamiento del BCRA al banco:** paga la tasa base. La ganancia del BCRA va al Tesoro.
- **Los depósitos no pagan interés**, igual que en la Fase 0. Es una simplificación a revisar.

**Parámetros propuestos** (todos supuestos a calibrar, salvo el coeficiente de capital):

| Parámetro | Valor | Nota |
|---|---|---|
| Tasa base | 3% anual (0,25% mensual) | Supuesto. La inflación de la línea de base es de ~0,3% anual, así que la tasa real es positiva. |
| Spread | 2% anual | Supuesto |
| Plazo del capital de trabajo | 12 meses | Supuesto |
| λ (deuda máxima en meses de ventas) | 3 | Supuesto; confirmar el orden de magnitud con Dosi et al. (2013) |
| Coeficiente de capital mínimo | 8% | Basilea, aplicado por el BCRA |
| Objetivo de patrimonio del banco para repartir dividendos | 10% de los préstamos | Supuesto |
| ρ_b (reparto del banco) | 0,9 | Igual que R7 |
| Patrimonio inicial del banco | 5% de los depósitos privados iniciales | Supuesto |

**Tests previstos:**
- Con crédito disponible, ninguna empresa contrata menos que lo deseado por liquidez, salvo que la frene el límite λ o el del banco.
- El banco nunca supera el límite de capital.
- Los intereses entran en la ganancia del banco y en la base de R7.
- Regresión: el criterio de la Fase 0 (B > A).
- Diagnóstico: G = 0 desde la creación ya no se tiene que trabar en 100%. Es lo que se espera, pero no está garantizado: falta la inversión.

**Valuación del capital (pedido para antes de R12):** en el paso 1a.4 las empresas todavía no tienen capital (entra en el 1a.5), así que su patrimonio es solo financiero (depósitos − préstamos). La propuesta de cómo valuar el capital la traigo antes del paso 1a.5. Si preferís verla antes de R12, aviso.

## Pedidos de Nico para el tramo 1b

- Al repartir las empresas por sector, **reportar cuántas quedan en cada sector y si alguno queda con muy pocas** (con 120 empresas y 5 sectores, un sector chico puede quedar con un puñado y volver a tener el ruido del tamaño chico).

### Decisión de Nico y mediciones del 2026-11-11

**Decisión:** dejar sin regla al banco insolvente hasta resolver la espiral. Responder primero por qué R1 no sube precios, y medir dos variantes experimentales por separado (20 semillas, tabla comparativa).

**¿Por qué R1 no sube el precio con pleno empleo? No es un bug.** Medido con una sonda antes y después de R1 (semilla 1, desde una economía calentada, promedios de 6 meses):
- **R1 hace lo que dice.** Todas las empresas que agotan stock con precio bajo el promedio suben el precio: ~9–12 por mes, y la cuenta coincide exacto todos los meses. El piso de costo no se activa nunca.
- **Las subas y las bajas se compensan.** ~8–10 empresas por mes quedan con stock y precio por encima del promedio, así que lo bajan. El promedio queda en ~189. R1 mueve precios **alrededor** del promedio; el nivel sube solo si las que agotan stock son sobre todo las baratas.
- **La mitad de las que agotan stock suben la cantidad, no el precio.** Son las que están en o por encima del promedio (~9–12 por mes). Por eso la presión de la demanda va a cantidad → empleo → vacantes → salarios (R2), no a precios.
- **Corrección de un dato anterior:** en los primeros 6 años el margen no cae a 1,08 sino a ~1,43. El 1,08 era del mes 240, ya con la demanda hundida.

**Variantes experimentales** (en `makePhase1Stages(credit, experiments)`, apagadas por defecto, **no aprobadas**):
- **(a) traslado de costos:** si la empresa sube el salario un x%, el precio sube lo mismo (traslado total, como CANVAS y K+S según Dawid et al., 2024).
- **(b) salario que baja:** una empresa con pérdidas y stock sin vender baja el salario un u·ξ, con u la tasa de desempleo (estilo Mark-0, Gualdi et al., 2015).

Reporte: `pnpm --filter @petri/engine report:fase1 variantes [frio|g0|caliente]`.

**Tabla 1. Calentamiento con las mismas reglas desde la creación, G = 200.000** (20 semillas, 2.000 hogares, 50 años visibles; mín · mediana · máx):

| | Aprobadas | (a) Traslado de costos | (b) Salario que baja |
|---|---|---|---|
| Desempleo, últimos 10 años | 35% · 69% · 73% | 21% · 69% · 73% | 3% · 12% · 20% |
| Colapsos (desempleo ≥ 50%) | 18/20 | 18/20 | 0/20 |
| Inflación anual | −0,09% (mediana) | −0,04% | −1,43% |
| Banco insolvente | 19/20, en el año 5 (mediana) | 19/20, año 5 | 20/20, año 5 |

Con G = 0 desde la creación, las tres variantes colapsan en 20/20 y el banco se funde en el año 4–5.

**El banco se funde en el transitorio inicial**, antes de que haya espiral. Esta tabla mide sobre todo una economía que ya se quedó sin crédito.

**Tabla 2. Calentamiento con la Fase 0 y crédito desde el mes 0, G = 200.000:**

| | Aprobadas | (a) Traslado de costos | (b) Salario que baja |
|---|---|---|---|
| Desempleo, últimos 10 años | 1,7% · 5,0% · 11,5% | 1,6% · 3,2% · 11,5% | 1,3% · 2,9% · 7,4% |
| Colapsos | 0/20 | 0/20 | 0/20 |
| Inflación anual | 0,41% | 0,23% | 0,17% |
| Quiebras por año (de 120 empresas) | 2,5 | 2,6 | 2,5 |
| Banco insolvente | 20/20 | 17/20 | 16/20 |

**Tabla 3. Primeros 5 años con crédito** (desde la economía calentada; mediana de 20 semillas):

| | Aprobadas | (a) Traslado de costos | (b) Salario que baja |
|---|---|---|---|
| Suba del salario | +24% | +19% | +25% |
| Suba del precio | +9% | +16% | +8% |
| Empresas con vacantes sin cubrir | 13% | 11% | 14% |
| Quiebras (de 120 empresas) | **87** | 94 | 82 |
| Castigos / intereses cobrados | 436k / 81k | 440k / 73k | 436k / 79k |
| Patrimonio del banco | −96% | −98% | −97% |

**Lectura:**
1. **El problema principal no es la espiral: es la ola de quiebras.** En los primeros 5 años quiebra el equivalente al 70% de las empresas, y los castigos son 5 veces los intereses cobrados. Hipótesis, no verificada: las empresas reparten el 90% de la ganancia (R7) y casi no acumulan patrimonio. Con deuda de capital de trabajo, un mes malo (stock sin vender) deja el patrimonio financiero negativo y R12 la quiebra. Sin crédito, esas mismas empresas solo se achicaban. Además, la tasa (4,5%) no cubre esas pérdidas.
2. **La espiral salarial existe, pero es secundaria.** Los salarios suben ~24% en 5 años. El traslado de costos (a) la achica (+19% de salario, +16% de precio). El salario que baja (b) no la toca: solo baja con pérdidas y desempleo.
3. **Ninguna variante evita que el banco se funda.** La causa son los castigos, no los precios.

**Para decidir con Nico:** qué atacar primero. Opciones: la definición de quiebra en R12 (con el capital de trabajo en la cuenta), el reparto de dividendos (R7) o el precio del riesgo en la tasa (R13).

## R1 mueve precios relativos, no el nivel (documentado el 2026-11-11, pedido de Nico)

R1 (Gaffeo et al., 2008; CATS) compara el precio de cada empresa con el **promedio del mercado**:
- **Agotó stock y está bajo el promedio:** sube el precio.
- **Agotó stock y está en o por encima del promedio:** sube la cantidad.
- **Le sobró stock y está en o por encima del promedio:** baja el precio.
- **Le sobró stock y está bajo el promedio:** baja la cantidad.

**Consecuencias:**
1. **La regla mueve precios relativos**: empuja a cada empresa hacia el promedio. El **nivel** sube solo si las subas le ganan a las bajas, o sea si las que agotan stock son sobre todo las baratas. Con pleno empleo (semilla 1, economía calentada, primeros 6 años con crédito), ~9–12 empresas suben el precio y ~8–10 lo bajan cada mes: el promedio queda quieto (~189).
2. **La presión de la demanda va a cantidades.** Cuando hay exceso de demanda, la mitad de las empresas que agotan stock están en o por encima del promedio y R1 les hace subir la **cantidad**. Para producir más necesitan trabajadores. Con pleno empleo quedan vacantes sin cubrir (~13% de las empresas) y R2 sube el salario. O sea: exceso de demanda → cantidad → empleo → vacantes → **salarios**, no precios.
3. **El costo no pasa al precio.** El precio solo sigue al salario si R1 lo sube por estar bajo el promedio o si toca el piso de costo, que con márgenes de ~1,4 no se activa. Es el "traslado nulo" de CATS (Dawid, Delli Gatti, Fierro & Poledna, 2024, sección 2.4: "wage increases are fully absorbed in the markup").
4. En la Fase 0 esto no se veía, porque la falta de liquidez limitaba las vacantes. Con crédito, la cadena cantidad → salarios queda libre.

## Verificación de la hipótesis de las quiebras (2026-11-11)

Medido sobre las empresas que quiebran en los primeros 5 años con crédito: economía calentada con la Fase 0, 2.000 hogares, 5 semillas, **413 quiebras**. Para cada una se registraron los 12 meses previos.

| | Resultado |
|---|---|
| Causa de la quiebra | patrimonio negativo en 413/413; mora en 0/413 |
| "Mes malo": patrimonio ≥ 0 el mes anterior y pérdida en el último mes | 412/413 |
| Deuda que crece ×1,5 con el patrimonio en baja en los 12 meses | 343/413 |
| Los dividendos de los 12 meses previos alcanzaban para cubrir el patrimonio negativo final | **412/413** |
| Patrimonio (mediana), 12 meses antes → al quebrar | 30,2k → −4,2k pesos |
| Dividendos pagados en los 12 meses previos (mediana) | **88,6k pesos**, ~3,4 meses de masa salarial (25,8k) |
| Deuda al quebrar (mediana) | 14,6k pesos, ~0,6 meses de masa salarial |
| Último mes (casos típicos) | las ventas caen a 20–70% de la masa salarial, sin agotar stock |

**Se confirma la hipótesis, con un matiz.** Las empresas no quiebran por una deuda grande, sino por **no tener colchón propio**:
- R7 reparte el 90% de cada mes con ganancia y absorbe el 100% de cada mes con pérdida. Con ventas volátiles, esa asimetría drena el patrimonio de forma sistemática: de ~30k a ~2k en 12 meses, pagando ~89k de dividendos.
- Cuando llega un mes con ventas bajas, la deuda de capital de trabajo deja el patrimonio negativo y R12 la quiebra.
- Muchas no tenían deuda 12 meses antes: se endeudaron en los últimos meses.

## Propuesta de R7 revisada (espera el OK de Nico)

Orden acordado: **R7 → medir → R13 → medir → R12 solo si sigue haciendo falta.** Un cambio por vez.

**Fuentes verificadas:**
- **Ley General de Sociedades 19.550** (Infoleg):
  - art. 68: "Los dividendos no pueden ser aprobados ni distribuidos a los socios, sino por ganancias realizadas y líquidas";
  - art. 71: "Las ganancias no pueden distribuirse hasta tanto no se cubran las pérdidas de ejercicios anteriores."
- **Pecking order** (Myers & Majluf, 1984; Myers, 1984, *The Capital Structure Puzzle*, Journal of Finance 39): las empresas usan primero sus fondos propios y después la deuda. Una empresa endeudada que reparte está financiando dividendos con deuda.
- **K+S con crédito** (Dosi et al., 2013, paso 7 de la secuencia): las empresas primero devuelven los préstamos con su flujo de caja y depositan lo que sobra. No reparten antes de pagar.
- **Descartada:** Fama & French (2002) no dice que las empresas más endeudadas paguen menos dividendos. Su resultado sobre dividendos depende de la rentabilidad y la inversión, así que no se usa como fuente.

**Regla propuesta, en dos partes:**
1. **Resultados acumulados** (arts. 68 y 71 de la LSC). Cada empresa lleva un resultado acumulado no distribuido: `RA ← RA + ganancia del mes`, que puede ser negativa. Solo reparte si `RA > 0`, y como mucho `RA`. Corrige la asimetría que drena el patrimonio. La ley habla de ejercicios anuales; acá se aplica mes a mes. Esa simplificación es un supuesto.
2. **Reparto según el endeudamiento** (pecking order). `ρ = ρ_max · (1 − ℓ)`, con `ℓ = deuda / (λ · ventas del mes anterior)`, acotado a [0, 1]: la fracción de su capacidad de deuda (R9) que la empresa ya usa. Sin deuda reparte como hoy (ρ_max = 0,9); en el tope de deuda no reparte nada.
   - **No es un colchón:** no depende de los depósitos ni de la masa salarial, solo de la deuda.
   - **Lo que tiene de supuesto:** la forma lineal y el uso de λ como escala. La fuente da la dirección (con deuda, fondos propios primero), no la forma.

**Dividendo del mes:** `min(ρ(ℓ) · RA, depósitos)` si `RA > 0`; se descuenta de `RA`.

**Qué se espera, sin garantía:**
- La parte 1 ataca el drenaje, que según la verificación es lo principal. La parte 2 sola no alcanzaría, porque muchas empresas no tenían deuda 12 meses antes de quebrar.
- **Medición propuesta**, un cambio por vez dentro de R7: la parte 1 sola, la parte 2 sola y las dos juntas. Cada una con 20 semillas: quiebras, castigos e intereses, patrimonio del banco y criterio de la Fase 0.

## R7 revisada: implementación (aprobada el 2026-11-11)

**Decisión de Nico:**
- Las dos partes, medidas por separado y juntas, con 20 semillas.
- La parte 1 es **anual**, como dice la ley: balance anual, primero se cubren las pérdidas acumuladas y después se reparte. La mensual se mide solo para comparar.
- Antes de R13, mostrar la tabla con quiebras, castigos frente a intereses, patrimonio del banco y criterio de la Fase 0.

**Código** ([src/phase1.ts](../packages/engine/src/phase1.ts)):
- `DividendPolicy { accumulated: 'none' | 'annual' | 'monthly', leverage }`. La aprobada es `APPROVED_DIVIDENDS = { accumulated: 'annual', leverage: true }`, que es la que usa `PHASE1_STAGES`.
- **Estado nuevo:** `Firm.retainedEarnings`, el resultado acumulado no distribuido. Suma la ganancia o pérdida de cada mes y resta los dividendos. La empresa entrante arranca en 0, porque el capital aportado no es resultado distribuible.
- **Cierre de ejercicio escalonado** (supuesto): la empresa i cierra en el mes `i mod 12`. Si todas cerraran el mismo mes, los dividendos se pagarían juntos y meterían un ciclo anual artificial en la demanda.
- **Al cierre:** si el resultado acumulado es positivo, reparte `ρ · RA`, con `ρ = 0,9 · (1 − ℓ)` y `ℓ` = fracción usada de la capacidad de deuda de R9 (`debtCapacityUsed`). Nunca más que sus depósitos.
- **Tests** (`phase1-credit.test.ts`):
  - solo reparte en su mes de cierre;
  - solo con resultado acumulado positivo;
  - nunca más que `0,9 · (1 − ℓ) · RA`;
  - en el tope de deuda, `ℓ = 1`.
- **Medición:** `pnpm --filter @petri/engine report:fase1 dividendos` (~10 min).

### Medición de R7 (2026-11-11)

Condiciones: 20 semillas, 2.000 hogares, calentamiento de 420 meses con las mismas reglas desde la creación, 50 años visibles, G = 200.000. A: s = 0; B: s = 0,5. Valores: mediana (mín–máx).

| Variante | Quiebras en los primeros 5 años (de 120) | Castigos / intereses cobrados | Banco insolvente (año, mediana) | Desempleo, últimos 10 años | Inflación A | Inflación B | Criterio Fase 0: A < 1% · B > A |
|---|---|---|---|---|---|---|---|
| R7 anterior (90% de cada mes con ganancia) | 111 (100–122) | 4,00 | 19/20 (año 5) | 69,2% (35–73%) | −0,09% | −0,02% | 20/20 · **15/20** |
| Parte 1 anual | 93 (84–97) | 4,03 | 19/20 (año 11) | **2,5%** (1,6–4,1%) | 0,30% | 1,13% | 20/20 · 20/20 |
| Parte 1 mensual (comparación) | 80 (76–85) | 3,02 | 20/20 (año 10) | 20,1% (8–28%) | 0,00% | 0,29% | 20/20 · 16/20 |
| Parte 2 (según endeudamiento) | 99 (90–110) | 3,37 | 16/20 (año 7) | 71,0% (8–76%) | −0,08% | 0,09% | 20/20 · 15/20 |
| **Partes 1 anual + 2 (APROBADA)** | **93** (88–98) | **3,90** | **20/20 (año 13)** | **2,2%** (1,6–5,3%) | 0,28% | 1,10% | **20/20 · 20/20** |
| Partes 1 mensual + 2 (comparación) | 79 (76–86) | 3,08 | 19/20 (año 9) | 17,5% (7–24%) | 0,00% | 0,22% | 20/20 · 19/20 |

**Lectura:**
1. **R7 aprobada mejora mucho la economía real.**
   - El desempleo de los últimos 10 años baja de 69% a 2,2%.
   - El criterio de la Fase 0 vuelve a cumplirse en las 20 semillas (con la R7 anterior, B > A en solo 15/20).
   - Lo que hace la diferencia es la parte 1 anual: las empresas acumulan patrimonio y se autofinancian.
2. **R7 no resuelve las pérdidas del banco.**
   - Los castigos siguen siendo ~4 veces los intereses cobrados.
   - El banco queda insolvente en 20/20; la mediana pasa del año 5 al 13.
   - En los últimos 10 años casi no hay crédito (mediana de empresas endeudadas: 0%). La economía buena del final es una economía **sin crédito** que se autofinancia.
3. **La parte 2 sola casi no cambia nada.** Coincide con la verificación: las quebradas no tenían deuda 12 meses antes.
4. **La versión mensual quiebra menos al principio, pero termina peor** (17–20% de desempleo).
5. **La ola de quiebras sigue concentrada en el transitorio inicial**: ~93 de 120 empresas en los primeros 5 años desde la creación, cuando el precio inicial es bajo para las fricciones (ver `fase0-reglas.md`, "Calentamiento"). Ese transitorio es el que funde al banco en la mayoría de las semillas.

**Siguiente según lo acordado: R13**, con una propuesta para que la tasa cubra el riesgo. Queda anotado que el transitorio inicial pesa mucho; calibrar las condiciones iniciales (opcional pendiente) o prender el crédito después de un calentamiento son alternativas a discutir.

## Calibración de las condiciones iniciales (2026-11-11)

**Decisión de Nico:** tratar el transitorio antes de R13, calibrando las condiciones iniciales con las proporciones del régimen estable. **No** prender el crédito después del calentamiento: sería otro shock artificial.

**Régimen estable** (reglas aprobadas, 2.000 hogares, G = 200.000; años 40 a 50 desde la creación; 20 semillas; `report:fase1 regimen`):

| Proporción | Antes (`INITIAL`, Fase 0) | Régimen: mín · mediana · máx | Valor calibrado (`PHASE1_INITIAL`) |
|---|---|---|---|
| Margen precio/costo | 1,10 | 1,170 · 1,196 · 1,218 | **1,196** |
| Depósitos de cada hogar / su ingreso disponible mensual | 2 meses de salario, igual para todos | 4,61 · 4,69 · 4,76 | **4,69 meses** |
| Depósitos (= patrimonio, sin deuda) de las empresas / masa salarial | 2 meses | 1,43 · 1,58 · 1,68 | **1,58 meses** |
| Tasa de empleo | 92% | 96,2% · 97,7% · 98,1% | **97,7%** |
| Patrimonio del banco | 5% de los depósitos iniciales | sin régimen estable (el banco se funde) | **sin cambio** |

- **Patrimonio del banco.** No hay régimen del banco que medir. Lo que sí se midió es la demanda de crédito del régimen (otorgado + racionado): ~2,2% de la masa salarial por mes. Con cuotas a 12 meses, el stock sería de ~0,14 meses de masa salarial, y el objetivo del 10% pediría ~0,014 meses. El 5% actual (~0,1 meses) es unas 8 veces eso. **El banco no se funde por falta de capital sino por pérdidas.**
- **El margen del régimen bajó de ~1,78 a ~1,20** con la R7 revisada (antes estaba anotado en pendientes como alto contra la evidencia).
- **Implementación:** `SimConfig.initial` (`InitialOverrides`) y `PHASE1_INITIAL`. Solo los usa `PHASE1_CONFIG`, así que la Fase 0 y sus tests no cambian. Los depósitos de cada hogar son 4,69 meses de *su* ingreso inicial (los desocupados arrancan con menos), coherente con R5.

### Medición (reglas aprobadas, 20 semillas, 2.000 hogares; `report:fase1 calibracion`)

| | Iniciales de la Fase 0 | Calibradas |
|---|---|---|
| Desempleo en los primeros 5 años desde la creación | 18,8% (17,7–20,6%) | **3,5%** (2,7–4,7%) |
| Quiebras en los primeros 5 años (de 120) | 93 | **101** (88–110) |
| Castigos / intereses cobrados | 3,90 | 4,48 |
| Banco insolvente | 20/20 (año 13) | **19/20** (año 14) |
| Desempleo, últimos 10 años | 2,2% | 2,8% |
| Criterio Fase 0: A < 1% · B > A | 20/20 · 20/20 | **20/20 · 20/20** |
| Inflación A · B (mediana) | 0,28% · 1,10% | 0,28% · 1,32% |

**Quiebras por año** con las iniciales calibradas (5 semillas, años 1 a 15):

| Semilla | Años 1–15 | El banco queda < 0 |
|---|---|---|
| 1 | 7 24 22 30 20 20 8 6 2 5 1 2 1 1 0 | año 13 |
| 2 | 12 20 25 26 21 14 5 5 3 0 2 1 2 0 1 | — |
| 3 | 8 18 27 21 27 19 2 0 0 0 0 0 0 0 0 | año 7 |
| 4 | 9 20 22 22 20 20 6 0 0 0 1 1 0 2 2 | año 7 |
| 5 | 11 22 21 28 25 20 0 0 5 1 1 2 2 1 0 | — |

**Lectura:**
1. **La calibración elimina el transitorio macro**: el desempleo de los primeros 5 años baja de 19% a 3,5%.
2. **La ola de quiebras no venía del transitorio.** Mientras el banco puede prestar, quiebran **~20–30 de 120 empresas por año (~20% anual)**. Las quiebras se cortan cuando el banco se queda sin patrimonio y deja de prestar (año ~7). Las "0 quiebras por año" del régimen son una economía sin crédito.
3. **El banco queda insolvente "en régimen"** (19/20). Según lo acordado, lo siguiente es R13. Pero con castigos de ~4 veces los intereses, una tasa que cubra el riesgo tendría que ser de un orden de magnitud mayor, y una tasa más alta aumenta las quiebras.
4. **Hipótesis a verificar:** las ventas de cada empresa son muy volátiles mes a mes. Hay 3 empresas visitadas al azar entre 120, se compra primero en la más barata y el bien es perecedero. Con deuda de capital de trabajo, un mes de ventas bajas deja el patrimonio negativo y R12 la quiebra. En la verificación, el último mes tenía ventas de 20–70% de la masa salarial. Sin crédito eso no quebraba a nadie. Candidatos: R12 (cuándo quiebra), la fidelidad de clientes en R6 o los inventarios almacenables (tramo 1b). Espera la decisión de Nico.

## Por qué quiebran tanto: volatilidad de ventas y R6 (2026-11-11)

**Pedido de Nico:**
1. Medir la volatilidad de las ventas por empresa y si explica las quiebras.
2. Verificar contra el texto cómo eligen proveedor los hogares en CATS.
3. Buscar una tasa empírica de salida de empresas.

### 1. Volatilidad de ventas

Medido en los primeros 5 años desde la creación, con las iniciales calibradas, 2.000 hogares y 5 semillas.

| | Sin crédito (reglas de la Fase 0) | Con crédito (Fase 1 aprobada) |
|---|---|---|
| Coef. de variación de las ventas mensuales de cada empresa (mediana · p90) | 0,28 · 0,39 | 0,33 · 0,45 |
| Cambio absoluto de ventas de un mes al siguiente (mediana · p90) | 6% · 51% | 7% · 76% |
| Meses malos (ventas < 70% de la masa salarial), sobre meses-empresa | 5,3% | 13,7% |
| Quiebras con mes malo el último mes | — (0 quiebras) | **448/508 (88%)** |
| P(quiebra \| mes malo y deuda) | — | **21%** (428/2.064) |

**Sí explica las quiebras.**
- Las ventas de cada empresa son muy volátiles: en 1 de cada 10 meses cambian más de 50–75% respecto del anterior.
- El 88% de las quiebras viene después de un mes malo, y un mes malo con deuda termina en quiebra 1 de cada 5 veces.
- Sin crédito, esos meses malos no quiebran a nadie.

### 2. Cómo eligen proveedor los hogares en CATS: nuestra R6 se apartó

Fuente verificada: Delli Gatti, Terranova & Turco (2023), *Mind the knowledge gap!*, Working Paper n. 129, Dipartimento di Economia e Finanza, Università Cattolica del Sacro Cuore, sección 3.9, citando a Delli Gatti et al. (2010).

> "The choice of the seller follows a preferential attachment scheme. In period t, household h compares the price paid in period t − 1 (charged by the previous seller, firm i) [...] with the lowest among the prices charged by Z_c − 1 C-firms (competitors of firm i) visited in period t [...]. If the latter is lower than the former, the consumer will switch to the new supplier with a certain probability [...] increasing with the gap."

- Probabilidad de cambio: `Pr = 1 − exp(−β_s · (P_{i,t−1} − P_z) / P_z)`, con β_s > 0 (intensidad de elección).
- Si el proveedor elegido no alcanza, el hogar compra en los otros Z_c − 1, de más barato a más caro.
- **Nuestra R6 no tiene memoria:** cada mes visita 3 empresas al azar y compra primero en la más barata. Eso genera mucha más rotación de clientes que la fidelidad de CATS, y es candidata a ser la principal fuente de la volatilidad de ventas.
- **Para implementarla hay que resolver la función exponencial,** que el principio 4 prohíbe usar con `Math.exp`. Opciones:
  - una aproximación propia con solo las cuatro operaciones (serie o Padé), que es exacta y reproducible entre motores;
  - una forma lineal acotada, `min(1, β_s · brecha)`.
- **Falta buscar el valor de β_s** en Delli Gatti et al. (2010).

### 3. Referencia empírica de salida de empresas

| Fuente | Tasa | Nota |
|---|---|---|
| Bartelsman, Haltiwanger & Scarpetta (NBER, capítulo c0480; IZA DP 1374, 2004) | **5–10% anual** de la población de empresas, en la mayoría de los países estudiados | Más rotación en servicios que en industria, y en países menos desarrollados |
| OEDE, Argentina (Ministerio de Trabajo), según nota de El Cronista | Tasa de cierre 3,41% (2023), 3,17% (2024), 3,65% (2025) | **No se pudo confirmar si es anual o trimestral.** Cubre empresas con al menos un empleo registrado. Hay que verificarlo en el sitio del OEDE. |

**El ~20% anual del modelo (mientras hay crédito) está 2 a 4 veces por encima** del rango internacional de 5–10%.

## R6 con fidelidad al proveedor (aprobada e implementada el 2026-11-11)

**Decisión de Nico:**
- Corregir R6 para que sea fiel a CATS.
- La exponencial con una aproximación propia de cantidad fija de términos, con un test de precisión contra `Math.exp` (solo en el test).
- Verificar β y correr sensibilidad.
- Medir con 20 semillas.

**Regla** (`goodsMarketP1` en [src/phase1.ts](../packages/engine/src/phase1.ts)):
- **Proveedor:** el hogar conserva su proveedor del mes anterior (`Household.supplierId`) y visita Z − 1 = 2 empresas más, distintas de él.
- **Cambio:** si la más barata de las visitadas es más barata que su proveedor, se cambia con probabilidad `1 − e^(−β·(P_ant − P_z)/P_z)`.
- **Orden de compra:** primero en el proveedor elegido; si no le alcanza, en las demás visitadas (el proveedor anterior incluido, si cambió), de la más barata a la más cara.
- **Sin proveedor** (al principio, o si quebró): visita Z = 3 al azar y elige la más barata.
- **Fuente:** Delli Gatti, Terranova & Turco (2023), WP 129 UCSC, sección 3.9 (citan a Delli Gatti et al., 2010).
  - **β_s = 1** y **Z_c = 3** salen del cuadro de calibración del Apéndice A. No se pudo leer Delli Gatti et al. (2010) directamente.
  - En el texto extraído del PDF se pierde un signo de la fórmula. Se usa la forma en que la probabilidad crece con la brecha, que es lo que describe el texto.
  - El paper no define cuánto dura un período. Por eso se corre sensibilidad con β = 0,3 y β = 3.
- **Exponencial determinista:** `expNeg` en [src/detmath.ts](../packages/engine/src/detmath.ts). Usa reducción de rango `e^−x = (e^(−x/256))^256` y una serie de Taylor de 10 términos con Horner, solo con las cuatro operaciones. Error relativo < 1e−12 en [0, 40] contra `Math.exp` (`test/detmath.test.ts`).
- **Tests** (`phase1-credit.test.ts`): con β = 0 nadie cambia de proveedor; con β enorme, todo cambio es hacia una empresa más barata.
- **Parámetro:** `MARKET.supplierSwitchIntensity`. `makePhase1Stages` recibe `market` como cuarto argumento, para la sensibilidad.
- **Medición:** `pnpm --filter @petri/engine report:fase1 r6` (~6 min).

### Medición de R6 (2026-11-11)

Condiciones: reglas aprobadas, iniciales calibradas, 20 semillas, 2.000 hogares, calentamiento de 420 meses desde la creación, 50 años visibles. Valores: mediana (mín–máx). La primera columna repite, como referencia, las mediciones anteriores (sin fidelidad).

| | R6 sin fidelidad | **β = 1 (paper)** | β = 0,3 | β = 3 |
|---|---|---|---|---|
| Coef. de variación de las ventas por empresa (años 2–5) | 0,33 | **0,15** (0,12–0,17) | 0,20 | 0,15 |
| Meses malos (ventas < 70% de la masa salarial) | 13,7% | **3,2%** (2,7–4,2%) | 5,1% | 3,0% |
| Quiebras en los primeros 5 años (de 120) | 101 | **81** (71–93) | 131 | 64 |
| Ídem, como tasa anual (empírico: 5–10%) | ~17% | **13,5%** (11,8–15,5%) | 21,8% | 10,7% |
| Castigos / intereses cobrados | 4,48 | **1,92** (1,28–3,42) | 3,70 | 1,74 |
| Banco insolvente (año, mediana) | 19/20 (año 14) | **20/20 (año 25)** | 19/20 (año 14) | 17/20 (año 26) |
| Desempleo, primeros 5 años | 3,5% | **1,3%** | 2,5% | 0,9% |
| Desempleo, últimos 10 años | 2,8% | **2,1%** (0,6–16,4%) | 1,6% | 3,3% |
| Inflación A · B | 0,28% · 1,32% | **0,11% · 0,79%** | 0,08% · 0,65% | 0,35% · 1,17% |
| Criterio Fase 0: A < 1% · B > A | 20/20 · 20/20 | **20/20 · 18/20** | 20/20 · 20/20 | 20/20 · 20/20 |

Las mediciones "sin fidelidad" son de `report:fase1 calibracion` y de la tabla de volatilidad (5 semillas).

**Lectura:**
1. **La fidelidad reduce a la mitad la volatilidad de las ventas** (coef. de variación de 0,33 a 0,15; meses malos de 13,7% a 3,2%). Se confirma que la R6 sin memoria era la fuente principal.
2. **Las quiebras bajan pero siguen altas:** 13,5% anual con β = 1, todavía por encima del 5–10% empírico. Con β = 3 llegan a 10,7%, el borde superior.
3. **El banco sigue quedando insolvente** (20/20), pero más tarde (año 25 en vez de 14). Los castigos bajan de ~4,5 a ~1,9 veces los intereses. Ya no es un orden de magnitud: **una R13 que cobre el riesgo ahora es plausible**.
4. **El criterio de la Fase 0 se debilita con β = 1:** B > A en 18/20, y la inflación de B baja a 0,79%. Con β = 0,3 y β = 3 se cumple en 20/20. Hay que seguirlo; ver la nota en `pendientes.md` sobre la magnitud del efecto de la emisión.
5. **Resultado no monótono, sin explicar:** con β = 0,3 (clientes más fieles) hay *más* volatilidad y quiebras que con β = 1 y β = 3. Una hipótesis, no verificada: con clientes muy fieles, cuando una empresa quiebra su clientela cae de golpe sobre otras, y una empresa cara no pierde clientes a tiempo para corregir. Habría que medirlo antes de calibrar β.

**Siguiente según lo acordado: R13**, ya que el banco sigue insolvente en régimen.

## Verificación de la dirección de β (2026-11-11)

**Pedido de Nico:**
- Verificar que más β implica más cambios de proveedor.
- Medir el % de hogares que cambian por mes.
- Un test unitario con la dirección.
- Revisar el signo de la brecha.

**No hay bug.** `switchProbability(β, P_ant, P_nuevo)` (en `phase1.ts`) da `1 − e^(−β·(P_ant − P_nuevo)/P_nuevo)` si el nuevo es más barato, y 0 si no. La brecha es positiva cuando el nuevo es más barato. Tests en `test/detmath.test.ts`:
- misma brecha, más β ⇒ más probabilidad;
- mismo β, más brecha ⇒ más probabilidad;
- el valor coincide con `1 − Math.exp(−0,1)`;
- nunca hay cambio si el nuevo no es más barato.

Sacar la función a un helper no cambió la aritmética, así que la tabla de R6 no se volvió a correr por esto.

**Cambios de proveedor por mes** (años 2 a 5 desde la creación, 5 semillas):

| β | Cambios voluntarios (% de hogares con proveedor activo) | Reasignaciones forzadas por quiebra (media, % de hogares) | Dispersión de precios entre empresas (coef. var.) | Clientes por empresa (coef. var.) | Quiebras años 2–5 por semilla |
|---|---|---|---|---|---|
| 0,3 | 0,57% | 0,68% | 0,021 | **0,71** | 79 |
| 1 | 1,60% | 0,49% | 0,020 | 0,56 | 45 |
| 3 | 4,25% | 0,32% | 0,020 | **0,46** | 40 |

- **La dirección es la correcta:** más β, más cambios.
- **Los cambios voluntarios son pocos porque la dispersión de precios es chica** (~2%): la brecha típica es ~2%, y con β = 1 eso da ~2% de probabilidad de cambio.
- **Hipótesis, no verificada:** la volatilidad tendría forma de U en la tasa de cambios.
  - **Con muy pocos cambios (β = 0,3)**, los clientes quedan muy desparejos entre empresas (coef. var. 0,71) y no siguen a las que crecen. La producción (R1) y la clientela se desacoplan, y las empresas con pocos clientes tienen meses malos y quiebran.
  - **Sin memoria (la R6 vieja)**, la clientela se rearma al azar todos los meses.

## Error de protocolo en las mediciones del criterio de la Fase 0 (2026-11-11)

Al descomponer a dónde va la emisión de B apareció un error mío de método.
- **El error:** en las tablas "Medición de R7", "Calibración" y "R6", **la cápsula B se calentaba con s = 0,5** (35 años de emisión antes del mes 0). El criterio de la Fase 0 calienta A y B igual (s = 0) y solo B cambia en el mes 0.
- **Por qué importa:** el gasto es nominal y no se indexa. Después de 35 años de emisión, la economía nominal de B es ~4 veces más grande (masa salarial 7,8M contra ~2M) y el mismo gasto de 200.000 pesos es un déficit mucho menor en relación con esa economía. Por eso la inflación medida de B era baja (0,79% con R6). Un chequeo de una corrida de B confirmó que la emisión sí es ~52% del gasto, como se diseñó.
- **Qué columnas están afectadas:** **solo** la inflación de B y "B > A" de esas tres tablas. Las quiebras, el banco, el desempleo y la inflación de A se midieron sobre A, que siempre se calentó con s = 0.
- **Corregido** en `test/helpers/variants.ts` y en `report:fase1 emision`: el calentamiento usa s = 0 para A y B. La tabla de R6 y la descomposición se vuelven a correr con el protocolo correcto.

**Segundo error dentro del mismo arreglo:** `runVariant` calentaba en un bucle propio que usaba las perillas de la cápsula y no `burnInKnobs`, así que el primer arreglo no le llegaba. Corregido. Ahora sí coinciden la tabla de R6 y la descomposición: inflación de B de 1,60% y 1,65% anual.

### Tabla de R6 con el protocolo correcto (reemplaza la fila del criterio de la Fase 0 de la tabla de R6)

Con el protocolo correcto solo cambian la inflación de B y "B > A". El resto de la tabla de R6 es igual (se midió sobre A).

| | β = 1 (paper) | β = 0,3 | β = 3 |
|---|---|---|---|
| Inflación A (mín · mediana · máx) | 0,06% · 0,11% · 0,66% | 0,00% · 0,08% · 0,59% | 0,11% · 0,35% · 0,68% |
| Inflación B | 1,25% · **1,60%** · 2,64% | 1,03% · 1,75% · 2,07% | 1,23% · 1,78% · 2,63% |
| Criterio Fase 0: A < 1% · B > A | **20/20 · 20/20** | 20/20 · 20/20 | 20/20 · 20/20 |

El "18/20" y el 0,79% de B informados antes eran por el error de protocolo. Las columnas de B de las tablas "Medición de R7" y "Calibración" tienen el mismo problema y **no se volvieron a correr**: R6 las reemplaza como estado vigente.

## A dónde va la emisión extra de B (2026-11-11)

Pedido de Nico: medir, sin cambiar nada, por qué se achica el efecto de la emisión.

**Método:**
- Identidad cuantitativa M·V = P·Y: M = depósitos privados; V = ventas / M; P = índice de precios; Y = unidades vendidas.
- Tasas anuales logarítmicas entre el promedio del primer y del último año de los 50 visibles.
- 20 semillas, 2.000 hogares, iniciales calibradas, protocolo correcto: A y B se calientan igual y B cambia en el mes 0.
- Reporte: `report:fase1 emision`.

**B − A (medianas):**

| | Reglas de la Fase 0 (R1 corregida, sin crédito) | Reglas de la Fase 1 (R6, R7 revisada, crédito, quiebras) |
|---|---|---|
| Emisión extra acumulada / M inicial | 3,23 | 3,07 |
| M (depósitos privados) | +2,67% | +2,46% |
| M de hogares · M de empresas | +2,49% · +3,47% | +2,61% · +2,04% |
| V (ventas / M) | −0,27% | **−1,12%** |
| **P (precios)** | **+2,42%** | **+1,52%** |
| Y (unidades vendidas) | −0,02% | −0,04% |
| M/P (saldos reales) | +0,25% | **+1,13%** |
| W (salario nominal) | +2,51% | +1,00% |
| Empleo · préstamos | ~0 · 0 | ~0 · 0 |

**Lectura:**
1. **Con las reglas de la Fase 0, la emisión extra va casi entera a precios y salarios.** Cada punto de dinero extra da ~0,9 puntos de precios. La velocidad casi no cambia y la producción tampoco.
2. **Con las reglas de la Fase 1, ~45% de la emisión extra queda como saldos reales acumulados.** La velocidad cae 1,1% por año en B, y los precios suben ~0,6 puntos por punto de dinero. Los salarios suben menos que los precios (+1,00% contra +1,52%).
3. **La producción y el empleo no absorben nada en ninguno de los dos casos:** la economía está cerca del pleno empleo.
4. **De dónde sale la caída de la inflación de B** (del ~3,3% original):
   - **corrección de R1:** ~1 punto (la Fase 0 corregida da 2,4%);
   - **reglas de la Fase 1:** ~0,9 puntos más, por la caída de la velocidad (1,5%);
   - **el 0,79% informado antes era un error de protocolo.**
5. **Hipótesis, no verificada,** de por qué cae la velocidad con las reglas de la Fase 1: en B los salarios suben menos que los precios, así que el margen y las ganancias suben. Con el reparto anual de R7, las ganancias se acumulan y van a los dueños, que concentran riqueza y gastan solo el 5% mensual de ella (α2 de R5). Habría que medir la distribución de los depósitos entre dueños y trabajadores para confirmarlo.

## Propuesta de R13 revisada: la tasa cobra el riesgo (espera el OK de Nico)

**Por qué:** con R6 y R7 corregidas, el banco castiga ~1,9 veces lo que cobra de intereses y queda insolvente en 20/20 (año ~25). La tasa actual, `(1 + μ_L)·r` = 4,5% anual igual para todos (Dosi et al., 2013, ec. 7), no tiene en cuenta el riesgo de cada deudor.

**Fuente verificada:** Assenza, Delli Gatti & Grazzini (2015), *Emergent dynamics of a macroeconomic agent based model with capital and credit*, JEDC 50; versión CESifo WP 4765, sección 8.
- **Apalancamiento:** λ = (L + F) / (L + E + F), con L la deuda, E el patrimonio y F el préstamo nuevo. Está en [0, 1).
- **Probabilidad de quiebra:** "Using these data, the bank will estimate a logistic regression between the bankruptcy probability φ and the individual leverage λ". Los datos son, para cada deudor, su apalancamiento y si sobrevivió o quebró, en una ventana T̂.
- **Tasa:** el banco es neutral al riesgo y presta mientras el rendimiento esperado no sea menor que un múltiplo μ del de un deudor sin riesgo (no arbitraje). De ahí sale una tasa por deudor que crece con su apalancamiento (ec. 8.9).
- **Cuadro 2:** μ = 1,2 ("bank's gross mark-up"); r = 0,01 por período; θ = 0,05 (cuota sobre el saldo); ζ = 0,002 (pérdida máxima por préstamo como fracción del patrimonio del banco).
- **Advertencia de los autores:** la logística subestima el riesgo cuando λ → 1.

**Adaptación propuesta** (la ec. 8.9 supone amortización geométrica θ, a plazo infinito; nuestros préstamos tienen 12 cuotas iguales de capital):
1. **Estimación de φ (como en la fuente).** Cada mes, el banco registra cada deudor con su λ al empezar el mes y si quebró en el mes (1) o no (0), en una ventana de T̂ = 120 meses. Ajusta una logística mensual `φ(λ) = 1 / (1 + e^−(a + b·λ))`:
   - por Newton con cantidad fija de iteraciones, usando `expNeg` (solo las cuatro operaciones, determinista);
   - con pocos datos (menos de 24 meses o ninguna quiebra), φ = la frecuencia observada de quiebras entre deudores.
2. **Pérdida dada la quiebra (LGD):** la fracción castigada sobre la deuda de los que quebraron, observada en la misma ventana.
3. **Tasa por deudor (no arbitraje, misma lógica que la ec. 8.9, a un mes):**
   - el banco cobra `1 + r_i` si el deudor sobrevive y recupera `1 − LGD` si quiebra;
   - iguala eso a lo que rinde un deudor sin riesgo: `(1 − φ)(1 + r_i) + φ(1 − LGD) = 1 + r_0`, de donde `r_i = (r_0 + φ·LGD) / (1 − φ)`;
   - `r_0` es la tasa mensual actual del deudor sin riesgo (`(1 + μ_L)·r / 12`, ya aprobada). Con φ = 0, la regla coincide con la actual.
   - Es la fórmula estándar de precio por pérdida esperada (pérdida esperada = probabilidad de quiebra × pérdida dada la quiebra, como en Basilea II).
4. **La tasa se fija al otorgar y queda fija para ese préstamo** (`Loan.rate`). Un deudor riesgoso paga más.

**Qué NO se cambia (un cambio por vez):**
- El límite total del banco (8% de capital, Basilea) y el límite de deuda de R9 (λ_R9 = 3 meses de ventas) siguen igual.
- El límite por préstamo de Assenza et al. (`φ·(L + ΔL) ≤ ζ·E_banco`) queda como opción para después, si hace falta.
- No se usa el μ = 1,2 de la fuente: es un recargo sobre el rendimiento total de un préstamo a plazo infinito, no comparable con un mes. El recargo sobre el deudor sin riesgo ya está en `r_0` (aprobado con Dosi).

**Parámetros nuevos** (supuestos): T̂ = 120 meses; mínimo de 24 meses de datos para usar la logística; 25 iteraciones de Newton; φ acotada a [0; 0,5].

**Qué se espera, sin garantía:**
- Con φ mensual de ~1–2% entre deudores y LGD de ~0,8, el recargo sería de ~1–1,6% mensual (12–19% anual) para los más riesgosos.
- Debería cubrir los castigos, pero una tasa más alta también vuelve más frágiles a los deudores. Esa realimentación es justamente la que describen Assenza et al.

**Medición propuesta** (20 semillas, protocolo correcto):
- quiebras por año (contra el 5–10%);
- castigos / intereses;
- patrimonio del banco e insolvencia;
- tasa promedio y dispersión entre deudores;
- crédito y empresas endeudadas;
- criterio de la Fase 0;
- la tasa real (pedido para el punto de control).

## R13 revisada: implementación (aprobada el 2026-11-11)

**Decisión de Nico:** OK, con dos ajustes:
1. **En vez de topear φ en 50%, racionar.** Si φ supera un umbral, el banco rechaza el préstamo. Con φ = 0,5 la fórmula daría ~80% mensual. Fuente: Stiglitz & Weiss (1981), *Credit Rationing in Markets with Imperfect Information*, AER 71(3). El umbral es un supuesto, con sensibilidad a dos valores más.
2. **Logística con cantidad fija de iteraciones, y un fallback explícito** si el ajuste no converge o es degenerado. Contar cuántas veces se usa.

La ventana de 120 meses y el mínimo de 24 quedaron aprobados.

**Código:**
- **Estimación del riesgo** ([src/creditRisk.ts](../packages/engine/src/creditRisk.ts), funciones puras):
  - el banco guarda, por mes, cuántos deudores había en cada uno de 20 tramos de apalancamiento y cuántos quebraron, más la deuda de los quebrados y lo castigado (`Bank.riskWindow`, 120 meses);
  - `fitGroupedLogistic`: logística agrupada por Newton, **25 iteraciones fijas**, solo las cuatro operaciones y `expNeg`;
  - **degenerado si:** no hay quiebras o no hay sobrevivientes, la matriz es singular, el último paso de Newton es mayor que 1e−6 (no convergió), los parámetros no son finitos, o **b ≤ 0** (un riesgo que baja con el apalancamiento contradice la fuente);
  - `estimateRisk`, con tres estimadores según los datos:

    | Estimador | Cuándo se usa |
    |---|---|
    | `none` (φ = 0) | no hay datos |
    | `frequency` (frecuencia global) | menos de 24 meses de datos |
    | `logistic` | hay datos suficientes y el ajuste es válido |
    | `bands` (frecuencias en 5 tramos) | **fallback**: la logística es degenerada |

  - la pérdida dada la quiebra (LGD) es lo castigado sobre la deuda de los quebrados en la ventana; sin quiebras todavía se supone 1.
- **Crédito** (`allocateCredit` en `phase1.ts`):
  - λ = (deuda + préstamo) / (deuda + préstamo + patrimonio), o 1 si el patrimonio es ≤ 0; φ = φ(λ);
  - **si φ > `maxDefaultProbability` (0,03 mensual, supuesto), se rechaza**;
  - si no, `r = (r0 + φ·LGD)/(1 − φ)`, fijada en el préstamo (`Loan.rate`). Cada préstamo paga su propia tasa.
- **Indicadores del mes** (`state.credit`): `rationedByRisk`, `rationedByRiskAmount`, `riskEstimator` y `newLoanRate`.
- **Tests:**
  - `creditRisk.test.ts`, 10 tests:
    - σ contra `Math.exp`;
    - recupera los parámetros de una logística conocida;
    - detecta los casos degenerados;
    - cada fallback se usa cuando corresponde;
    - la tasa deja al banco en el mismo rendimiento esperado que un deudor sin riesgo.
  - `phase1-credit.test.ts`:
    - con un umbral imposible, el banco no presta;
    - toda tasa es ≥ r0;
    - la ventana no crece.
- **Medición:** `pnpm --filter @petri/engine report:fase1 r13` (~6 min).

### Medición de R13 (2026-11-11)

Condiciones: reglas aprobadas (con R6 y R13 revisadas), iniciales calibradas, 20 semillas, 2.000 hogares, calentamiento de 420 meses desde la creación (A y B igual), 50 años visibles. Valores: mediana (mín–máx).

| | Antes de R13 (R6, β = 1) | **Umbral 0,03 (base)** | Umbral 0,015 | Umbral 0,06 |
|---|---|---|---|---|
| Quiebras anuales, primeros 5 años | 13,5% | **1,8%** (1,3–2,8%) | 1,2% | 4,0% |
| Quiebras anuales, 50 años visibles (empírico: 5–10%) | ~0% (sin crédito) | **6,2%** (5,0–7,1%) | 3,1% | 10,1% |
| Castigos / intereses cobrados | 1,92 | **0,29** | 0,20 | 0,34 |
| Banco insolvente | 20/20 (año 25) | **0/20** | 0/20 | 3/20 (años 47–61) |
| Patrimonio del banco, final / inicial | ~0 | **1,18** (0,74–1,46) | 1,36 | 1,08 |
| Préstamos rechazados por racionamiento (por corrida, 85 años) | — | **4.834** (4.264–5.411) | 5.962 | 3.071 |
| Tasa anual promedio de los préstamos nuevos | 4,5% (fija) | **9,0%** (8,1–9,7%) | 6,5% | 11,8% |
| Tasa real (tasa − inflación de A) | ~4,4% | **8,9%** | 6,4% | 11,7% |
| Empresas endeudadas, últimos 10 años | 0% (sin crédito) | **50,5%** | 50,4% | 49,1% |
| Deuda / masa salarial, últimos 10 años | 0 | **0,41** | 0,42 | 0,43 |
| Desempleo, últimos 10 años | 2,1% | **4,9%** (2,5–**19,0%**) | 4,4% (2,0–8,7%) | 5,9% |
| Inflación A · B | 0,11% · 1,60% | **0,09% · 2,35%** | 0,10% · 2,46% | 0,10% · 2,32% |
| Criterio Fase 0: A < 1% · B > A | 20/20 · 20/20 | **20/20 · 20/20** | 20/20 · 20/20 | 20/20 · 20/20 |

**Estimador del riesgo** (meses, sumando 20 semillas × 1.020 meses):

| Umbral | Logística | Fallback por tramos | Frecuencia global (primeros 24 meses) | Sin datos |
|---|---|---|---|---|
| 0,03 (base) | 97,6% | **0** | 440 | 40 |
| 0,015 | 97,6% | **0** | 440 | 40 |
| 0,06 | 95,2% | **12** (0,1%) | 440 | 528 (después de quebrar el banco, sin deudores) |

**Lectura:**
1. **R13 resuelve el banco.** Con el umbral base, el banco queda solvente en 20/20 y termina con más patrimonio que al inicio. Los castigos son ~0,3 veces los intereses: el riesgo queda cubierto.
2. **Hay crédito en régimen por primera vez:** la mitad de las empresas tiene deuda (0,4 meses de masa salarial). Antes, el crédito desaparecía cuando el banco quebraba.
3. **Las quiebras quedan dentro del rango empírico:** 6,2% anual en régimen con el umbral base (5–10%). El umbral las mueve mucho: 3,1% con 0,015 y 10,1% con 0,06 (con 3 bancos insolventes).
4. **El racionamiento trabaja:** ~4.800 pedidos rechazados por corrida (~5 por mes).
5. **La tasa real es alta:** ~9% anual con el umbral base. Es la prima de riesgo de deudores con 6% de quiebra anual y ~80% de pérdida. Para comparar con Argentina, en la Fase 3.
6. **La logística casi nunca falla:** 0 meses de fallback con el umbral base y 12 con 0,06.
7. **La inflación de B sube de 1,60% a 2,35%** al volver el crédito. Hipótesis: con crédito, menos dinero queda ocioso y la velocidad cae menos. Verificarlo en el punto de control (junto con la hipótesis de la velocidad).
8. **Atención:** con el umbral base, una semilla termina con 19% de desempleo en los últimos 10 años. Hay que mirarla en el punto de control.

## Propuesta: valuación del capital en el patrimonio neto (opción A aprobada el 2026-11-11)

**Decisión de Nico (2026-11-11):** opción A. También se aprueban las dos recomendaciones: venta forzosa con descuento d (supuesto a calibrar; verificar Ramey & Shapiro, 2001) y amortización dentro del costo unitario que usa R1 como piso. La opción C (ajuste por inflación contable) queda como perilla para la Fase 2/3 (ver `pendientes.md`).

**Por qué hace falta antes de R11.** Hoy el patrimonio neto de una empresa es solo financiero (depósitos − préstamos). Cuando entre el capital, una empresa que pide 100 para comprar máquinas queda con patrimonio financiero −100, y R12 la quebraría ese mismo mes. El patrimonio neto se usa en cuatro lugares, así que la valuación los define a todos:
1. R12: quiebra si el patrimonio neto < 0.
2. R13: apalancamiento λ = deuda / (deuda + patrimonio).
3. R9: orden de atención del banco (patrimonio / ventas).
4. R7: la ganancia que se acumula para repartir dividendos (si la amortización es un costo).

### Fuentes verificadas contra el texto

- **Caiani et al. (2016), JEDC 69** (versión del autor):
  - Valuación: *"the financial value of each capital batch is lowered by a constant share of the original purchasing value in each period, while the correspondent real stock of machinery can be used at full potential till it reaches [obsolescence]"*. Es **costo histórico con amortización lineal**, lote por lote.
  - Ganancia: la ganancia de las empresas de consumo resta la *"capital amortization"*, que no es un pago a nadie (*"do not correspond to any actual exchange of real or financial resources between agents"*).
  - Control contable: *"the sum of the net worth of all the agents in the economy … is exactly equal to the values of real assets"*.
  - Quiebra: *"Firms and banks may go bankrupt when they run out of liquidity or if their net-wealth turns negative"*. Con quiebra, los acreedores intentan recuperar *"through fire sales of firm's physical capital to households"*, con el valor rebajado en una proporción fija (*"in accordance with empirical evidence"*; el valor del parámetro no se lee en la extracción del PDF).
  - Física: cada lote dura 20 períodos y se descarta entero. Los autores advierten que eso genera ciclos de eco artificiales en la inversión (autocorrelación de orden 20 más alta que la real).
- **Assenza, Delli Gatti & Grazzini (2015), JEDC 50** (CESifo WP 4765, ec. 8.15):
  - Balance: `v^k·K + D = L + E`, donde v^k es el *"book value of physical capital"*. Es valor libro, aunque el texto no detalla cómo se actualiza v^k.
  - La ganancia resta la reposición del capital gastado valuada al valor libro (ec. 8.17). La compra de capital nuevo se paga al precio corriente (ec. 8.16).
  - Física: depreciación geométrica δ, solo sobre el capital que se usa (ec. 5.5).
  - Quiebra: *"If equity turns negative, the firm goes bankrupt"*. El banco se queda con la deuda y la liquidez; el texto no dice qué pasa con el capital.
- **Normas contables:** NIC 16 (modelo del costo: costo menos depreciación acumulada) y la RT 17 de la FACPCE en la Argentina. En contextos de inflación alta, el costo histórico se **reexpresa** por el índice de precios: RT 6 (FACPCE) y NIC 29. El ajuste se rehabilitó en 2018 (Ley 27.468); falta verificar el detalle normativo.
- **Ley argentina de quiebras (a verificar):** la Ley 24.522 dispara la quiebra por **cesación de pagos** (art. 1), no por patrimonio negativo. La pérdida del capital social es causal de disolución en la Ley 19.550 (art. 94, inc. 5). Nuestra R12 ya tiene los dos disparadores: patrimonio < 0 y 3 cuotas impagas.

### Opciones

| | A. Costo histórico depreciado (valor libro) | B. Costo de reposición | C. Costo histórico reexpresado por inflación |
|---|---|---|---|
| Valor del capital | Lo que se pagó, menos la depreciación acumulada | Unidades que quedan × precio corriente del bien de capital | A, multiplicado por la inflación desde la compra |
| Fuente | Caiani et al. (2016); Assenza et al. (2015); NIC 16 / RT 17 | Contabilidad nacional (SCN 2008, inventario permanente a precios corrientes); Godley & Lavoie (2007), a verificar | RT 6 / NIC 29 |
| Comprar capital mueve el patrimonio | No (depósitos → capital al mismo valor) | Sí: se revalúa en cuanto cambia el precio del capital | No |
| Riesgo | Con inflación alta subvalúa el capital y adelanta quiebras | Una suba del precio del capital "enriquece" a las empresas sin ninguna transacción, y viceversa. El precio sale de pocas empresas de capital (volátil). | Necesita un índice de precios dentro del modelo |
| Fase | 1 | — | 2/3, cuando haya inflación alta |

### Propuesta: opción A, con la depreciación contable igual a la física

1. **Valor libro por empresa:** `V`, en centavos (entero).
   - Al comprar `k` unidades a precio `p`: `V += p·k`. Es una transferencia de depósitos al vendedor; el capital queda **fuera de la matriz financiera**, como dice el plan.
   - Cada mes: amortización `A = floor(δ·V)`, y `V −= A`. Con la misma δ que la depreciación física de R11, el valor libro baja al mismo ritmo que las unidades. Equivale al costo promedio ponderado de los lotes, sin guardar lotes, con aritmética entera.
   - **Por qué no lotes con amortización lineal y descarte entero, como Caiani:** los propios autores advierten que genera ciclos de eco. La depreciación física (geométrica o por lotes) se decide en la propuesta de R11. Si R11 termina usando lotes, el valor libro se lleva por lote, igual que en Caiani.
2. **Patrimonio neto = depósitos − préstamos + V.** Se usa en R12, R13 y R9.
3. **La amortización es un costo en la ganancia** (Caiani, ec. de ganancia; Assenza, ec. 8.17): resta en el resultado acumulado de R7, aunque no sea un pago. Así las empresas no reparten como dividendo lo que necesitan para reponer el capital.
4. **Control contable nuevo** (Caiani): Σ patrimonio neto de todos los agentes = Σ V. Va en un test junto al invariante SFC, que no cambia.
5. **Cuando haya inflación alta (Fase 2/3):** reexpresar V por el índice de precios (opción C, RT 6), como perilla o como regla. Lo anoto en pendientes.

### Dos decisiones que se desprenden (se proponen en detalle con R11/R12)

- **Qué pasa con el capital de una empresa que quiebra.** Hoy el banco solo recupera los depósitos.
  - **(i) Venta forzosa (Caiani):** un hogar compra la planta a `(1 − d)·V` y ese pago va al banco. La planta queda en el mismo lugar y la usa la empresa que entra (hoy la entrada ya reutiliza el lugar de la quebrada). El descuento `d` es un supuesto a calibrar, con fuente empírica a buscar (Shleifer & Vishny, 1992, como marco teórico; Ramey & Shapiro, 2001, JPE, como evidencia de descuentos grandes en equipos usados, a verificar).
  - **(ii) El capital se pierde:** más simple, pero sube la pérdida del banco y, por R13, la tasa. No es neutral.
  - **Recomiendo (i).**
- **Si la amortización entra en el costo unitario que usa R1 como piso de precio.** Caiani la incluye en el costo unitario. Es una decisión de R1/R11 y la traigo con R11.

### Qué NO cambia

El invariante SFC financiero, R12 (los dos disparadores), R13 (la logística sobre λ), el límite del banco y λ_R9.

## Propuesta de R11: producción con capital y sector de bienes de capital (aprobada el 2026-11-11)

**Decisión de Nico (2026-11-11):** aprobada con la tabla de decisiones tal cual (100/20, K/Y = 1,5, δ ≈ 6% anual, solo reposición en 1a.5, r_K = 0,3 con sensibilidad, compra de capital con la búsqueda de R6). Agregados:
- **K/Y = 1,5 es solo maquinaria y equipo,** sin construcciones ni vivienda. Por eso es menor que los 2,5–3,5 habituales del stock de capital total.
- **Si ningún hogar puede comprar la planta:** ver "Venta forzosa sin comprador" más abajo.
- El recupero se mide sobre el costo de reposición y lo aplicamos sobre el valor libro: anotado en `pendientes.md` para la Fase 2/3.

### Venta forzosa sin comprador (definición, 2026-11-11)

Primero se busca un comprador individual: un hogar al azar entre los que tienen depósitos ≥ `r_K·V`. Ese hogar queda como dueño de la planta y capitaliza a la empresa que entra (con lo que pueda, hasta el aporte de R12).

Si **ningún hogar** alcanza, se aplica la regla de **Caiani et al. (2016), sección 3.3**, verificada contra el texto: *"Individual households' contribution to fire sales follows the same rule of dividends distribution …, the disbursement being distributed proportionally to households' net wealth"*.
- Todos los hogares pagan la planta en proporción a sus depósitos. Al redondear hacia abajo cada parte, el precio efectivo puede quedar unos centavos por debajo de `r_K·V`.
- La planta queda en el lugar con ese valor libro. El dueño de la empresa que entra se elige con la regla de entrada de R12 (un hogar al azar que pueda aportar el capital inicial).
- **Costo de esta regla:** los que pagaron no reciben nada a cambio (es una transferencia hacia el futuro dueño). Por eso se cuenta cuántas veces se usa.
- **No se usa la alternativa de perder el capital:** dejaría a la empresa entrante sin planta (con Leontief no podría producir) y subiría la pérdida del banco.

### Fuentes verificadas contra el texto

- **Assenza, Delli Gatti & Grazzini (2015)**, CESifo WP 4765:
  - **Empresas de consumo (ec. 5.3–5.5):**
    - Producción Leontief `Ŷ = min(α·N, κ·K)`, con α y κ *"exogenous, constant and uniform across firms"*.
    - Producción efectiva `Y = ω·κ·K`, donde ω es la utilización de la capacidad.
    - Ley de movimiento del capital: `K_{t+1} = (1 − δ·ω_{t+1})·K_t + I_t`. Solo se deprecia el capital que se usa: *"only capital which is actually used in production depreciates"*.
  - **Empresas de capital (ec. 6.1–6.3):**
    - Producen solo con trabajo: `Y = α·N`.
    - Sus bienes se almacenan. Fijan precio y cantidad según el precio de la competencia y sus inventarios: la producción deseada es la demanda esperada menos el inventario.
  - **Inversión de reposición (ec. 5.6):** `I^r = δ·K̄`.
  - **Cuadro 1:** los inventarios de bienes de consumo y de capital están en el balance, y el capital va *"evaluated at book value"*.
  - **Cuadro 2:** δ = 0,02 por período, κ = 1/3, utilización deseada ω̄ = 0,85.
- **Caiani et al. (2016):**
  - **Cuadro 3:** 100 empresas de consumo y 20 de capital (1/5); cada una empieza con 25 empleados.
  - **Inventarios:** *"In accordance with standard accounting rules, firms' inventories are evaluated at the firms' current unit cost of production"*. La variación del valor del inventario entra en la ganancia.
  - **Capital nuevo:** *"New machineries are employed in the production process starting from the next period"*.
  - **Costo unitario:** *"Unit costs are computed as overall production costs, including the financial amortization of capital, divided by output"*.
  - **Utilización deseada:** 80–90%, citando a Eichner (1976) y Lavoie (2014).
  - **Empresas de capital:** no tienen amortización, lo que implica que producen sin capital. Es una lectura del cuadro de flujos, no una frase del texto.
  - **Quiebra:** si quiebra una empresa de capital, *"the loss is totally borne by banks, as capital firms do not have any collateral"*.
- **Ramey & Shapiro (2001)**, JPE 109(5), pedido de Nico:
  - *"The estimated average market value of equipment in our sample is 28 cents per dollar of replacement cost. Even machine tools, which typically have good resale markets, sell for less than 40 percent of replacement cost"*.
  - El capital vendido a empresas **del mismo sector** tiene menos descuento.
  - Su depreciación estimada por antigüedad va *"from 1.5 to almost 9 percent"*.

### Propuesta

**1. Dos sectores con las 120 empresas aprobadas:** 100 de consumo y 20 de capital (la proporción de Caiani). El bien de consumo sigue siendo perecedero en el tramo 1a; los inventarios de consumo entran en el 1b.

**2. Empresas de consumo: Leontief.**
- Capacidad = κ·K. R1 sigue igual, pero la producción deseada queda acotada por la capacidad: `min(plannedOutput, κ·K)`. R3 contrata `producción / α`.
- Si una empresa está al tope de su capacidad y le falta stock, no puede crecer: esa es la señal que usa R10 para invertir.

**3. Depreciación física según el uso** (Assenza, ec. 5.5): `K −= δ·ω·K` cada mes, con ω = producción / capacidad.
- El valor libro baja en la misma proporción (aprobado). Contablemente es el método de las unidades de producción, que NIC 16 admite.
- Consecuencia útil: la amortización **por unidad producida** es `δ·(V/K)/κ`. **No depende de la utilización**, así que el piso de precio no sube en las recesiones solo porque se produce menos.

**4. Piso de precio de R1** (aprobado): `salario/α + δ·(V/K)/κ`. Es el costo unitario con la amortización, como en Caiani.

**5. Empresas de capital: solo trabajo, `Y = α_K·N`, con inventario sin merma.**
- **Precio y cantidad:** la misma regla de cuatro casos (R1), con las señales de Assenza (ec. 6.1–6.2):
  - exceso de demanda (pedidos sin atender) o inventario sin vender;
  - la comparación es con el precio promedio de los bienes de capital;
  - producción deseada = ventas esperadas − inventario.
- **Piso de precio:** `salario/α_K`.
- **Valuación del inventario:** al costo unitario corriente (Caiani). Entra en su patrimonio neto, y su variación entra en la ganancia de R7. Sin eso, una empresa de capital que produce para stock tendría patrimonio financiero negativo y R12 la quebraría.

**6. Mercado de bienes de capital.**
- Las empresas de consumo compran a las de capital con la misma búsqueda y fidelidad de R6 (Z empresas, β). Es un supuesto: se usa la misma regla que para los hogares.
- El pago es una transferencia de depósitos. Se paga con depósitos y, si no alcanzan, con crédito de R9: el pedido de crédito suma la compra de capital, con los mismos límites.
- El capital comprado se usa **desde el mes siguiente** (Caiani).
- Orden del mes: producción → mercado de bienes de capital → mercado de bienes de consumo (el orden de Caiani).

**7. Inversión provisoria en este paso: solo reposición,** `I = δ·K̄` (Assenza, ec. 5.6), con K̄ = el capital deseado a la utilización normal. Así el paso 1a.5 se mide con el capital constante en promedio, y R10 (1a.6) suma la inversión neta. Un cambio por vez.

**8. Quiebras con capital** (venta forzosa aprobada):
- **Empresa de consumo:**
  - un hogar elegido como hoy para capitalizar la entrada compra la planta a `r_K·V`;
  - el pago va a los depósitos de la empresa quebrada y de ahí al banco, y el resto de la deuda se castiga;
  - la planta queda en el mismo lugar con valor libro `r_K·V` (su nuevo costo histórico), y la usa la empresa que entra, de ese mismo dueño;
  - si ningún hogar puede pagarla, el capital se pierde.
- **Empresa de capital:** no tiene garantía, como en Caiani; el inventario se pierde y la pérdida es toda del banco.
- **Recupero `r_K`:** 0,3 como base (Ramey & Shapiro: 28 centavos por dólar), con sensibilidad a 0,15 y 0,5. Nuestro comprador es del mismo sector, así que podría pagar algo más: por eso la sensibilidad hacia arriba.

**9. Control contable nuevo:** Σ patrimonio neto de todos = Σ valor libro del capital + Σ inventarios valuados. El SFC financiero no cambia.

### Parámetros (supuestos a calibrar; se fijan con objetivos, no con números sueltos)

| Parámetro | Propuesta | Fuente / razón |
|---|---|---|
| α (consumo) y α_K (capital) | 10 unidades por trabajador por mes, igual en los dos sectores | Normalización |
| ω̄, utilización normal | 0,85 | Assenza, cuadro 2; Caiani (80–90%) |
| κ, producto por unidad de capital | Sale del objetivo capital/producto anual = 1,5 a ω̄: `κ = 1/(12·0,85·1,5)` ≈ 0,065 por mes | Supuesto: **solo maquinaria y equipo, sin construcciones ni vivienda**; por eso es menor que los 2,5–3,5 habituales del capital total. Verificar con datos argentinos (ARKLEMS, cuentas nacionales) en la Fase 3 |
| δ | ~6% anual a ω̄: `δ = 0,06/(12·0,85)` ≈ 0,0059 por mes | Mezcla de equipo y construcciones; dentro del rango de Ramey & Shapiro (1,5–9%). Verificar en la Fase 3 |
| r_K, recupero de la venta forzosa | 0,3 (sensibilidad 0,15 y 0,5) | Ramey & Shapiro (2001) |

Con esos objetivos, la reposición es ~9% del producto anual (0,06 × 1,5). El sector de capital emplearía ~8% de los ocupados (~8 trabajadores por empresa de capital contra ~18 por empresa de consumo).

### Condiciones iniciales

- Capital inicial por empresa de consumo a la utilización normal: `K₀ = Y₀/(ω̄·κ)`, con `V₀ = K₀ ×` el precio inicial del capital.
- Hay que recalibrar `PHASE1_INITIAL` con las proporciones del régimen, como se hizo antes: el patrimonio de las empresas cambia mucho.
- Calentamiento: 420 meses, sin cambios. La Fase 0 (`PHASE0_STAGES`) no se toca.

### Tests

- La producción nunca supera κ·K.
- El capital baja exactamente δ·ω·K por mes, y V en la misma proporción.
- Comprar capital es una transferencia de depósitos: el patrimonio de quien compra no cambia, y el capital se usa recién desde el mes siguiente.
- El piso de precio incluye la amortización.
- Empresas de capital: producido = vendido + variación del inventario.
- Σ patrimonio neto = Σ V + Σ inventarios.
- Venta forzosa: el banco recibe `r_K·V`, la entrante arranca con `V = r_K·V_anterior` y se cumple el SFC.
- Medición (20 semillas): criterio de la Fase 0, quiebras, banco, desempleo, utilización media y tamaño del sector de capital.

### Para decidir

1. Reparto 100 de consumo / 20 de capital.
2. Objetivos de capital/producto 1,5 y δ ≈ 6% anual.
3. Inversión solo de reposición en 1a.5, con R10 aparte.
4. r_K = 0,3, con sensibilidad.
5. La compra de capital usa la misma búsqueda y fidelidad de R6 (supuesto).

## R11: implementación (2026-11-11)

**Código:**
- `src/phase1.ts`:
  - etapas `productionP1` y `capitalMarket`;
  - R1 de las empresas de capital en `firmsPlanP1`, más el tope de capacidad, el piso con amortización y el pedido de reposición;
  - `sellPlant` (venta forzosa), y la entrada y la quiebra por sector;
  - la ganancia de R7 con la amortización y la variación del inventario;
  - funciones `firmNetWorth`, `inventoryValue`, `capacityOf` y `unitCostFloor`, y `searchSuppliers` (la búsqueda de R6, compartida por los dos mercados).
- `src/params.ts`: `CAPITAL`, con los parámetros y sus fuentes.
- `src/state.ts`: campos nuevos de `Firm`, `SimConfig.capitalFirms` (`PHASE1_CONFIG`: 20), `stats.capitalPriceIndex` y contadores de ventas forzosas y de pedidos de capital.

**Orden del mes:** apertura → entrada → plan (R2, R1, reposición, R9/R13, R3) → mercado de trabajo → producción → mercado de bienes de capital → gobierno → mercado de bienes de consumo → servicio de la deuda → quiebras → R7 → banco → cierre.

**Otros cambios:**
- **Índice de precios y producción:** `closeMonth` calcula el índice de precios y la producción **solo con las empresas de consumo**. En la Fase 0 todas son de consumo, así que no cambia nada: el criterio de la Fase 0 sigue pasando igual.
- **Fase 0 sin sectores:** las reglas de la Fase 0 no conocen los sectores. El test lento de calentamiento y la sección `emision` del reporte usan el tamaño de la Fase 1 con `capitalFirms: 0`. El escenario `variantes caliente` (calentar con la Fase 0 y prender el crédito) quedó obsoleto.
- **Guarda:** `PHASE1_STAGES` falla con un mensaje claro si no hay empresas de capital, porque sin capital ninguna empresa de consumo podría producir.

**Tests (`test/phase1-capital.test.ts`, 12):**
- condiciones iniciales a la utilización normal;
- producción ≤ κ·K, y la restricción se usa;
- K y V bajan exactamente δ·ω;
- la compra de capital no cambia el patrimonio del comprador ni la producción del mes;
- piso de precio con amortización y producción deseada ≤ capacidad;
- inventario = inicial + producido − vendido;
- **patrimonio neto − resultado acumulado constante en la vida de cada empresa**: la contabilidad de la ganancia cierra, con la amortización y el inventario;
- venta forzosa con comprador (el banco cobra r_K·V, la planta queda con ese valor);
- venta forzosa sin comprador (cada hogar paga su parte proporcional);
- quiebra de una empresa de capital (el inventario se pierde);
- la empresa entrante usa la planta y la capitaliza quien la compró.

Los tests de crédito pasaron a 25 de consumo + 5 de capital. Resultado: 97 tests rápidos y la suite lenta pasan; typecheck limpio.

### Medición de R11 (2026-11-11; `report:fase1 r11`, ~6 min)

20 semillas, 2.000 hogares, 100 empresas de consumo + 20 de capital, calentamiento de 420 meses desde la creación (A y B igual), 50 años visibles. Medianas (mín–máx entre paréntesis cuando importa).

| | Antes de R11 (R13 base) | **R11, r_K = 0,3 (base)** | r_K = 0,15 | r_K = 0,5 |
|---|---|---|---|---|
| Quiebras anuales en régimen (empírico 5–10%) | 6,2% | **0,1%** (0–0,5%) | 0,0% | 0,1% |
| Quiebras en los primeros 5 años desde la creación | — | 21 | 18 | 23 |
| Quiebras de empresas de capital | — | **0** en las 20 semillas | 0 | 0 |
| Ventas forzosas en 50 años: con comprador · entre todos | — | 5 · 0 (máx. 26 · 3) | 2 · 0 | 7 · 1 (máx. 5) |
| Banco insolvente | 0/20 | **0/20** | 0/20 | 0/20 |
| Castigos / intereses | 0,29 | **0,00** | 0,00 | 0,00 |
| Tasa anual promedio de los préstamos | 9,0% | **4,5%** (sin prima de riesgo) | 4,5% | 4,5% |
| Empresas endeudadas (últ. 10 años) | 50% | **15%** (7–81%) | 11% | 54% |
| Desempleo, últimos 10 años | 4,9% (máx. 19%) | **7,3%** (2,9–18,0%) | 9,7% | 8,3% |
| Desempleo, primeros 5 años | — | 1,2% | 1,6% | 0,8% |
| Empleo en el sector de capital / ocupados | — | **8,1%** (objetivo 8,3%) | 8,1% | 8,1% |
| Utilización media · empresas al tope de capacidad | — | **87% · 61%** | 83% · 59% | 87% · 62% |
| Tendencia del capital total | — | −0,03% anual | −0,02% | −0,04% |
| Pedidos de capital cumplidos | — | 99,5% | 99,6% | 99,2% |
| Precio del capital / precio del consumo | — | 0,76 (inicial 1,00) | 0,70 | 0,74 |
| Margen (precio / costo salarial) | ~1,20 | 1,57 | 1,63 | 1,58 |
| Inflación A · B | 0,09% · 2,35% | **0,23% · 1,34%** | 0,28% · 1,38% | 0,26% · 1,35% |
| Criterio de la Fase 0 | 20/20 | **20/20** | 20/20 | 20/20 |

**Lo que se cumple:**
- El criterio de la Fase 0 (20/20), el banco solvente, el empleo del sector de capital en el objetivo (8,1%), el capital constante en promedio (es solo reposición, sin R10) y los pedidos de capital cumplidos (99,5%).
- La venta forzosa casi nunca necesita la regla de "entre todos": mediana 0, máximo 3 en 50 años.
- r_K casi no mueve nada, porque casi no hay quiebras.

**Hallazgos (hipótesis, NO verificadas):**
1. **Las quiebras casi desaparecen: 0,1% anual, contra 5–10% empírico.**
   - *Hipótesis A:* el valor libro de la planta (~18 meses de producción) es un colchón de patrimonio tan grande que el patrimonio neto casi nunca queda negativo. La quiebra queda solo para la mora de 3 cuotas, y con poca deuda casi no pasa. Es consecuencia directa de la opción A.
   - *Hipótesis B:* el tope de capacidad protege a las empresas. Con 61% al tope, hay exceso de demanda y casi todas venden todo.
   - Sin quiebras, el banco no ve riesgo, la tasa vuelve a la base (4,5%) y nadie es racionado por riesgo.
2. **El desempleo sube (4,9% → 7,3%, con semillas hasta 18%).**
   - *Hipótesis:* desempleo por falta de capital. La capacidad total está fija (solo reposición) y 61% de las empresas no puede contratar más aunque le sobre demanda.
   - Además, con la tabla de R1 de CATS, una empresa al tope con exceso de demanda y precio ≥ al promedio "quiere" producir más, pero no puede y tampoco sube el precio. El exceso de demanda queda como ahorro forzoso de los hogares.
   - Es lo que R10 (inversión neta) tiene que resolver: no corregirlo antes.
3. **El efecto de la emisión se achica: la inflación de B baja de 2,35% a 1,34%.** B > A sigue en 20/20. Se suma al seguimiento de la magnitud del efecto.
4. **El precio relativo del capital cae** de 1,00 a 0,76. Las empresas de capital venden poco y a pedido, y el piso de su precio es solo el costo salarial.
5. **El margen sobre el costo salarial sube** de ~1,20 a ~1,57. Parte es la amortización (que ahora entra en el piso) y parte la escasez de capacidad.

**Siguiente:** R10 (inversión neta, Caiani et al., 2016), con propuesta y fuente. Los hallazgos 1 y 2 se vuelven a medir con R10. Si las quiebras siguen lejos del rango empírico, hay que revisar R12 con Nico.

## R1 al tope de capacidad: verificación contra Assenza et al. (2015) (2026-11-11)

**Pregunta de Nico:** una empresa que agota stock, con precio ≥ promedio y al tope de su capacidad, ¿sube el precio? Hoy R1 le dice "subí la cantidad", no puede, y el exceso de demanda queda como ahorro forzoso. El modelo no permite inflación por restricción de capacidad.

**Texto (CESifo WP 4765, sección 5.1, ec. 5.1–5.2):**
- *Precio:* sube solo si `Δ ≤ 0 y P_i < P̄`, y baja solo si `Δ > 0 y P_i > P̄`.
- *Cantidad:* `Y* = Y + ρ(−Δ)` si `Δ ≤ 0 y P_i > P̄`.
- *"In each of the four scenarios the firm changes either the price or the quantity but not both at the same time"*.
- No hay un caso aparte para la capacidad. La nota 14 dice que la producción deseada y la efectiva pueden diferir (*"if the firm does not fill all the vacancies or does not get enough credit … the firm has to scale down activity"*). La capacidad entra en la contratación (ec. 5.8: `N* = min(Y*/α, κK/α)`) y en la inversión (ec. 5.7), no en el precio.

**Conclusión: nuestra R1 no se apartó.** Que una empresa al tope no suba el precio es un **supuesto de CATS**, y queda anotado como **candidato a perilla de teoría** (inflación por restricción de oferta: sí o no) en `pendientes.md`.

**Una diferencia que sí importa para R10:** en Assenza, la producción deseada `Y*` **no se acota** por la capacidad. Es la señal que usa la inversión. En nuestra implementación de R11, `plannedOutput` se acota a κ·K, así que la señal se pierde. R10 tiene que usar la producción deseada antes del tope, como hace Caiani (ver la propuesta de R10).

### ¿Cuánto del achicamiento del efecto de la emisión explica esto? (`report:fase1 capacidad`, ~6 min)

Variantes **experimentales** (`Phase1Experiments`, apagadas por defecto, no aprobadas):
- **(c)** la empresa al tope con exceso de demanda sube el precio;
- **(d)** sin tope de capacidad.

20 semillas; medianas (mín–máx).

| | R11 aprobada | (c) sube el precio al tope | (d) sin tope |
|---|---|---|---|
| Inflación A · B | 0,23% · 1,34% | 0,75% · 1,92% | colapsa (ver abajo) |
| **B − A** | **1,11 pp** (0,89–1,23) | **1,20 pp** (0,91–1,46) | — |
| Ahorro forzoso / gasto deseado: A · B | 16,9% · 33,4% | 26,8% · 35,9% | — |
| Empresas que agotan stock: A · B | 59% · 61% | 48% · 46% | — |
| Al tope de capacidad (A) | 61% | 29% | — |
| Desempleo, últimos 10 años: A · B | 7,3% · 7,3% | **24,6% · 22,5%** | 100% |
| Margen sobre el costo salarial: A · B | 1,57 · 2,62 | 2,30 · 3,93 | — |

*Nota técnica:* esta tabla se corrió con la depreciación escrita como `δ·min(1, ω)` en todas las variantes. En la versión aprobada se restauró la expresión original, `δ·y/(κK)`, que difiere en el último dígito de punto flotante. Las medianas de la columna aprobada coinciden con la medición de R11 (0,23% · 1,34%; 7,3%).

**Resultados:**
1. **El precio al tope explica poco del achicamiento.** El efecto B − A era ~2,26 pp antes de R11 (2,35% − 0,09%) y es 1,11 pp con R11. Subir el precio al tope lo lleva a 1,20 pp: recupera **~0,09 pp de 1,15 pp, menos del 10%**.
2. **El ahorro forzoso es enorme:** un tercio del gasto deseado de B no encuentra bienes (17% en A). Es una pista (hipótesis, no verificada) de a dónde va la emisión con R11: queda como dinero sin gastar porque no hay capacidad para producir más, no como precios. Coincide con 61% de empresas al tope y sin inversión neta.
3. **(c) no es una mejora "gratis":** sube el desempleo a ~24%, porque las empresas suben precios en vez de producir y la utilización baja a 72%.
4. **(d) colapsa en 20/20 semillas por otra razón.** Sin el tope, la demanda de trabajo supera a la oferta y vuelve la espiral salarial del paso 1a.3 (el salario sube de 1.000 a 1.900 pesos en 15 años). Las empresas se quedan sin caja y la economía cae en la **trampa sin caja** de abajo, con 100% de desempleo. No sirve como contrafáctico. Muestra que hoy **el tope de capacidad es lo que frena la espiral salarial**.

## Hallazgo: la trampa sin caja (empresas "vivas" que no producen nunca más) (2026-11-11)

**Medición** (versión aprobada, 20 semillas, 50 años visibles): en cada semilla hay **entre 7 y 20 de las 100 empresas de consumo activas sin producir durante los 50 años completos**. Se correlaciona con el desempleo: la semilla 15, con 18% de desempleo, tiene 20 empresas paradas; la semilla 17, con 3,1%, tiene 9.

**Mecanismo, verificado en una empresa de la semilla 15 que se traba en el mes 171 desde la creación:**
1. **R7 se lleva toda la caja.** En su mes de cierre, el dividendo anual (ρ = 0,9 del resultado acumulado, con tope en los depósitos) le deja 0 de depósitos. El resultado acumulado era mayor que la caja, porque parte de la ganancia contable está en la planta.
2. **El banco la raciona por riesgo** con apalancamiento ≈ 0,2. Con la planta dentro del patrimonio, todos los apalancamientos quedan por debajo de 0,25. La logística sale muy empinada (b ≈ 20) y da φ(0,2) ≈ 3,5%, por encima del umbral de 3%.
3. **Además, la pérdida dada la quiebra observada es 0** (las ventas forzosas y los depósitos cubren la deuda), pero el racionamiento mira solo φ, no la pérdida esperada φ·LGD.
4. **No produce, y el bloqueo es permanente.** Sus ventas del mes anterior quedan en 0, y con eso el límite de deuda de R9 (λ_R9 · ventas) queda en 0 para siempre.
5. **No quiebra:** no tiene deuda (no hay mora) y la planta le sostiene el patrimonio.

**Consecuencias:**
- *Quiebras:* explica buena parte de su caída (hipótesis A de la medición de R11): las empresas que antes quebraban ahora quedan vivas y paradas.
- *Desempleo:* explica buena parte de su suba. Hay capacidad instalada que no se usa y no se recicla, porque sin quiebra no hay entrada.

**No se puede comparar con el antes:** el estado anterior a R11 no está en git, y la trampa existía en principio (una empresa sin deuda, sin caja y sin ventas tampoco quebraba). Lo nuevo con R11 es que el patrimonio incluye la planta, y eso cambia la escala del apalancamiento (paso 2) y quita la salida por patrimonio negativo (paso 5).

**Opciones para decidir con Nico (ninguna implementada):**
- (a) **Salida por cuota de mercado ~0.** En K+S (Dosi, Fagiolo & Roventini, 2010), las empresas salen si su cuota de mercado se acerca a cero o su patrimonio es negativo (falta verificar contra el texto). Una empresa sin producir N meses sale, con venta forzosa y entrada. Es lo más directo y tiene fuente.
- (b) **R13: racionar por pérdida esperada (φ·LGD), no solo por φ.** Con garantía, una probabilidad alta de quiebra no implica pérdida.
- (c) **R9: límite de deuda con las ventas esperadas** (o con la capacidad) en vez de las del mes anterior, para que un mes sin ventas no bloquee el crédito para siempre.
- (d) **R7: que el dividendo no deje a la empresa sin caja para el próximo mes de salarios.** Caiani et al. (2016) tiene un objetivo de depósitos precautorios de 1 masa salarial (cuadro 3, *"Firms' precautionary deposits as share of WB"* = 1), que las empresas financian con crédito. Es parecido al colchón que se eliminó, pero ahora con fuente.

## Venta forzosa sin comprador: es un impuesto implícito a los depositantes (2026-11-11, pedido de Nico)

Cuando ningún hogar puede pagar la planta solo, la regla de Caiani et al. (2016) la hace pagar a todos los hogares en proporción a sus depósitos, y no reciben nada a cambio. **En la práctica es un impuesto implícito, proporcional a los depósitos, que recauda la empresa quebrada en favor del banco** (que cobra la deuda) y del dueño futuro de la planta. No pasa por el Tesoro y no aparece en ningún indicador fiscal.
- En las mediciones de R11 se usó una mediana de 0 veces en 50 años (máximo 3 por semilla).
- **Cada uso queda contado** (`credit.fireSalesPooled`), para que no pase inadvertido.
- Si en algún escenario se vuelve frecuente (por ejemplo, con hogares más pobres en la Fase 3), hay que revisar la regla.
- El descuento que usa Caiani sobre el capital de las empresas quebradas es 0,5 (cuadro 3, *"Haircut on defaulted firms' capital value"*), es decir, recupera el 50%. Nuestra base de 0,3 sale de Ramey & Shapiro, y la sensibilidad con 0,5 cubre el valor de Caiani.

## Propuesta de R10: inversión neta (espera el OK de Nico)

### Fuente verificada

**Caiani et al. (2016), sección 3.1.4 y cuadro 3.** La ec. 3.10 no se lee en la extracción del PDF, así que se verificó en el **código publicado por los autores**: `S120/benchmark`, `InvestmentCapacityOperatingCashFlowExpected.java`, y `S120/jmab`, `RealCapitalDemandSimple.java`.
- **Texto:** *"Firms invest in each period in order to attain a desired productive capacity rate of growth depending on the desired rate of capacity utilization and the past period rate of return"*. El denominador de la tasa de ganancia es *"the previous period value of the firm's stock of capital"*.
- **Código, tasa de crecimiento deseada de la capacidad:**
  ```
  g = γ1·(r − r̄)/r̄ + γ2·(u − ū)/ū,   acotada abajo en −1
  r = flujo de caja operativo del período anterior / valor del capital del período anterior
  u = producción DESEADA / capacidad
  ```
- **Código, demanda real de capital:** `capacidad deseada = (1 + g)·capacidad actual`, y se compran `ceil((capacidad deseada − capacidad que sigue funcionando)/productividad)` unidades. La reposición va incluida, y no hay compras negativas.
- **Flujo de caja operativo (texto):** *"after-tax profit plus capital amortization costs (for consumption firms), minus changes inventories and principal repayments"*.
- **Cuadro 3 (períodos trimestrales):**
  - γ1 (*"Profit rate weight"*) = 0,01;
  - γ2 (*"Capacity utilization rate weight"*) = 0,02;
  - ū = 0,8;
  - r̄ = 0,04345, marcado *"SS-given"*: sale del estado estacionario del modelo, no es un dato;
  - préstamos de 20 trimestres (5 años).

**Coherencia con Assenza et al. (2015), ec. 5.7:** capital deseado = capital usado / ω̄, más la reposición. Es la misma idea con la utilización sola. Caiani suma la rentabilidad, que es lo aprobado en el plan ("utilización y tasa de ganancia").

### Adaptación propuesta

1. **Producción deseada sin tope** (cambio en R11): R1 calcula la producción deseada `Y*` como hoy, se guarda, y recién después se acota a la capacidad para contratar. `u = Y*/(κ·K)`, como en Caiani y Assenza.
2. **Tasa de ganancia:**
   - `r = flujo de caja operativo / V del mes anterior`;
   - flujo de caja operativo = ganancia de R7 + amortización − cuotas de capital pagadas. Sin inventario, porque el bien de consumo es perecedero. En la Fase 1 no hay impuesto a las ganancias de las empresas.
3. **`g = γ1·(r − r̄)/r̄ + γ2·(u − ū)/ū`**, acotada abajo en −1.
4. **Pedido de capital** = `max(0, ceil(g·K + δ·K̄))`: el crecimiento deseado más la reposición de R11 (que reemplaza a "la capacidad que sigue funcionando" de Caiani, porque nuestra depreciación es geométrica y no por lotes). El capital es irreversible: no se vende.
5. **Parámetros mensuales** (supuestos):
   - γ1 = 0,01/3 y γ2 = 0,02/3: el cuadro de Caiani es trimestral;
   - ū = 0,85, la utilización normal ya aprobada (Caiani usa 0,8);
   - **r̄ se calibra con el régimen**, como hace Caiani (*"SS-given"*): flujo de caja operativo / V medio en el régimen de R11. Si no, la inversión tendría un sesgo sistemático hacia arriba o hacia abajo.
   - Sensibilidad: γ ×0,5 y ×2.
6. **Financiamiento:** con R9, como la reposición. Decisión pendiente: el plazo de los préstamos para invertir. Caiani usa 5 años para todos los préstamos; nuestro capital de trabajo usa 12 meses. Propuesta: 60 meses para la parte del préstamo que financia inversión (Caiani). Alternativa: dejar 12 meses (un cambio por vez) y medir.

### Qué NO cambia

R1 (salvo guardar la producción deseada), R9, R12, R13 y la valuación.

### Tests

- Alta utilización y alta rentabilidad ⇒ pedido > reposición.
- Capacidad ociosa y baja rentabilidad ⇒ pedido = 0 o solo reposición. Nunca negativo.
- `g ≥ −1`.
- SFC.
- Medición (20 semillas): criterio de la Fase 0, criterio de G = 0, quiebras, banco, desempleo, utilización (que vuelva cerca de ū), crecimiento del capital, empleo por sector, ahorro forzoso.

### Orden sugerido

Primero resolver la **trampa sin caja** (opciones arriba), porque contamina cualquier medición de R10: las empresas trabadas no invierten ni salen. Después R10.

## Decisión de Nico sobre la trampa sin caja (2026-11-11)

- **(a) no:** saca a las empresas después de caer pero no evita que caigan, y subiría las quiebras de forma artificial.
- **Orden, midiendo después de cada paso** (empresas paradas, quiebras, desempleo, banco, criterio de la Fase 0):
  1. **(b) R13:** racionar por pérdida esperada (φ × pérdida dada la quiebra), no solo por φ.
  2. **(c) R9:** solo si la trampa persiste. El límite con las ventas del mes anterior tiene un estado absorbente en 0; reemplazarlo por ventas promedio o esperadas, con fuente.
  3. (a) y (d) quedan en reserva.
- **R10 aprobada,** con la producción deseada sin tope como señal y préstamos de inversión a 60 meses (Caiani). Se implementa después de resolver la trampa.

## Propuesta: R13 con racionamiento por pérdida esperada (espera el OK de Nico)

### Fuentes verificadas contra el texto

- **Assenza, Delli Gatti & Grazzini (2015)**, CESifo WP 4765, sección 8.2:
  - *"We assume that the bank's risk manager aims at limiting the maximum loss deriving from commercial loans … The expected loss from lending to the f-th firm … is φ_f(ΔL_{f,t} + L_{f,t−1})"*, con la condición `φ_f·(ΔL + L) ≤ ζ·E_banco` (ec. 8.11). De ahí sale el préstamo máximo (ec. 8.12): `ΔL ≤ (ζ·E_banco − φ·L)/φ`.
  - El racionamiento depende de la **pérdida esperada**, pero Assenza supone pérdida total en la quiebra: *"if the firm goes bankrupt, the whole stock of credit is lost"* (sección 8.1). Es decir, LGD = 1.
- **Caiani et al. (2016)**, sección 3.2:
  - *"consumption firms' collateral is identified with their stock of real capital. In the case of a default by a consumption firm, each bank then expects to be able to recover [a share] of outstanding loans … through fire sales of its capital. [That share] is equal to ratio between capital discounted value … and firm's outstanding debt"*. Para las empresas de capital es 0, *"since capital firms have no collateral"*.
  - *"Banks are willing to satisfy agents' demand for credit whenever the expected return is greater or equal than zero. Otherwise, the bank may still be willing to provide some credit, if there exist an amount for which the expected return is non-negative"*.
- **Basilea II** (BCBS, 2006): la pérdida esperada es `PD × LGD × EAD`. Es la misma descomposición; falta verificar el párrafo exacto.

### Propuesta

1. **Pérdida dada la quiebra por empresa (Caiani):**
   - `LGD_i = max(0, 1 − r_K·V_i / (L_i + ΔL))`, donde la garantía es la planta al precio de la venta forzosa (r_K·V, la misma que usa R12);
   - empresas de capital: `LGD_i = 1` (sin garantía);
   - reemplaza a la LGD promedio de la historia del banco, que hoy da 0 porque las ventas forzosas y los depósitos cubren la deuda.
2. **Racionamiento por pérdida esperada por peso prestado:** rechazar si `φ_i·LGD_i > θ`.
   - Sigue siendo racionamiento por umbral (Stiglitz & Weiss, 1981, ya aprobado), pero mide lo que Assenza mide (pérdida esperada) con la garantía que usa Caiani.
   - **Umbral θ = 0,024**: es el umbral actual de φ (0,03) por la LGD que se observaba antes de R11 (~0,8). Así, para un deudor sin garantía la regla es casi la misma que hoy, y solo cambia para los préstamos cubiertos por la planta. Sensibilidad con dos valores más.
   - **Un préstamo cubierto por la planta (LGD_i = 0) no se raciona nunca por riesgo.**
3. **La tasa usa la misma LGD_i:** `r = (r0 + φ·LGD_i)/(1 − φ)` (la fórmula aprobada, con la pérdida de cada empresa). Un préstamo cubierto paga la tasa sin riesgo.
4. **No se usa el límite por préstamo de Assenza** (`φ·(L+ΔL) ≤ ζ·E_banco`, ζ = 0,002). Sería un cambio de estructura además del de métrica. Queda como opción.

### Qué no cambia

La estimación de φ (logística sobre el apalancamiento, ventana de 120 meses), el límite total del banco (8%), R9, R12 y R7.

### Lo que se espera (sin garantía)

- **Debería evitar que las empresas caigan en la trampa.** En el caso estudiado (semilla 15, mes 172) el préstamo pedido era ~16.000 pesos y la garantía, 0,3 × 63.855 ≈ 19.000 pesos: LGD_i = 0, así que se habría prestado.
- **No saca a las que ya cayeron:** con ventas del mes anterior en 0, el límite de R9 sigue en 0. Eso es lo que atacaría (c), si hace falta.
- **Riesgo:** con garantía, el banco presta más a empresas frágiles. Si la venta forzosa recupera menos de lo esperado, el banco pierde. Hay que vigilar la solvencia del banco y la sensibilidad a r_K.

### Tests

- Préstamo totalmente cubierto ⇒ se otorga aunque φ supere el umbral viejo.
- Sin garantía ⇒ igual que hoy con θ/0,8.
- Empresa de capital ⇒ LGD = 1.
- La tasa de un préstamo cubierto es r0.
- SFC y determinismo.

## R13 con racionamiento por pérdida esperada: implementación y medición (2026-11-11)

**Código:**
- `lossGivenDefaultOf(firm, exposure, r_K)` y `allocateCredit` en `src/phase1.ts`.
- `CREDIT.maxExpectedLoss = 0,024` reemplaza a `maxDefaultProbability`.
- La tasa usa la pérdida de cada empresa (`LGD_i`).

**Corrección a la propuesta:** dije que un préstamo cubierto "paga la tasa sin riesgo". Con la fórmula aprobada paga `r0/(1 − φ)`, apenas más que r0: si el deudor quiebra, el banco recupera el capital pero pierde el interés del mes.

**Tests nuevos (2):**
- la pérdida por empresa: 0 si la planta cubre, 0,5 si cubre la mitad, 1 en las empresas de capital;
- con umbral 0, solo se prestan créditos totalmente cubiertos por la planta.

Resultado: 99 tests pasan.

**Medición** (`report:fase1 perdida`, ~6 min; 20 semillas; medianas, mín–máx):

| | Antes (racionar por φ) | **θ = 0,024 (base)** | θ = 0,012 | θ = 0,048 |
|---|---|---|---|---|
| Empresas paradas ≥ 12 meses (de 100) | 13 (7–20) | **5 (1–8)** | 6 (2–8) | 4 (2–6) |
| Máx. meses seguidos parada | 600 | 600 | 600 | 600 |
| Quiebras anuales, consumo (empírico 5–10%) | 0,1% | **1,0%** (0,4–1,9%) | 0,6% | 1,3% |
| Quiebras anuales, capital | 0% | 0% | 0% | 0% |
| Ventas forzosas en 50 años: con comprador · entre todos | 5 · 0 | **45 · 3** (máx. 9) | 29 · 1 | 62 · 3 |
| Desempleo A, últimos 10 años | 7,3% (2,9–18%) | **5,2%** (2,9–7,0%) | 5,0% | 4,1% |
| Desempleo B, últimos 10 años | 7,3% | 2,4% | 2,7% | 2,2% |
| Ahorro forzoso A · B | 17% · 33% | 14% · 30% | 14% · 31% | 13% · 30% |
| Banco insolvente · castigos/intereses · patrimonio final/inicial | 0/20 · 0,00 · 1,33 | **0/20 · 0,00 · 2,17** | 0/20 · 0,00 · 2,05 | 0/20 · 0,04 · 2,28 |
| Rechazados por riesgo (por corrida) | 267 | 303 | 366 | 185 |
| Tasa anual · empresas endeudadas | 4,5% · 15% | 4,8% · **81%** | 4,6% · 80% | 5,2% · 84% |
| Al tope de capacidad · utilización | 61% · 87% | 68% · 94% | 67% · 93% | 67% · 95% |
| Inflación A · B · B − A | 0,23% · 1,34% · 1,11 pp | **0,21% · 1,37% · 1,17 pp** | 0,21% · 1,30% · 1,09 pp | 0,19% · 1,41% · 1,22 pp |
| Criterio de la Fase 0 | 20/20 | **20/20** | 20/20 | 20/20 |

**Lectura:**
- (b) reduce la trampa a menos de la mitad (13 → 5 empresas paradas), baja el desempleo de A y su dispersión (máximo 18% → 7%), y sube un poco las quiebras (0,1% → 1,0%).
- El banco sigue solvente y duplica su patrimonio. Ahora el 81% de las empresas tiene deuda.
- La venta "entre todos" (el impuesto implícito) se usa más: mediana 3, máximo 9 en 50 años.
- **La trampa persiste:** sigue habiendo empresas paradas los 50 años completos.

### Por qué persiste (verificado, 10 semillas, desde la creación)

Se clasificó cada vez que una empresa de consumo activa deja de producir, según su situación al planificar:

| Causa | Casos |
|---|---|
| **Límite de R9 agotado** (deuda ≥ 3 × ventas del mes anterior) | **1.472** |
| Sin caja después del crédito (racionada por riesgo: la planta no cubre todo el préstamo) | 243 |
| Ventas del mes anterior = 0 (ya estaba trabada) | 81 |

**Cómo se traba:**
1. Una empresa endeudada choca con el límite de R9 y no puede pagar salarios ese mes.
2. Sus ventas del mes pasan a 0, y el límite queda en `3 × 0 − deuda < 0` para siempre: es el **estado absorbente** que señaló Nico.
3. Si tiene deuda, quiebra por mora a los 3 meses (de ahí sale la mayoría de las quiebras de la tabla). Si no tiene, queda parada para siempre.

## Propuesta: R9 con ventas esperadas en el límite de deuda (espera el OK de Nico)

### Fuentes

- **Dosi et al. (2013), JEDC 37, ec. 3** (la forma ya aprobada): deuda ≤ λ · ventas **del período anterior**. Con un solo mes sin ventas, el límite queda en 0 y no hay forma de salir.
- **Caiani et al. (2016), expectativas adaptativas.** Las variables esperadas siguen `x^e_t = x^e_{t−1} + λ_e·(x_{t−1} − x^e_{t−1})`, con λ_e = 0,25 por trimestre (cuadro 3, *"Adaptive expectations parameter"* = 0,25). Forma **verificada en el código de los autores** (`S120/jmab`, `SimpleAdaptiveExpectation.java`): `expectation = adaptiveParam·valor_pasado + (1 − adaptiveParam)·expectativa_pasada`.
- **Assenza et al. (2015), ec. 5.2:** la demanda esperada también es un promedio con pesos que decaen exponencialmente (*"expected future demand is a weighted average of current and past quantities with exponentially decaying weights"*). Ya verificado.

### Propuesta

1. **Ventas esperadas por empresa:** `S^e_t = S^e_{t−1} + λ_e·(S_{t−1} − S^e_{t−1})`, en centavos, actualizada al cierre de cada mes.
   - λ_e mensual = 0,09, equivalente al 0,25 trimestral de Caiani: `1 − 0,75^(1/3) ≈ 0,0914`. Se calcula fuera del motor y se escribe como constante, porque el motor no usa potencias.
   - Sensibilidad: λ_e = 0,25 (el valor de Caiani aplicado por mes) y 0,5.
2. **Límite de deuda de R9:** deuda ≤ λ_R9 · `S^e` (en lugar de las ventas del mes anterior). Un mes sin ventas baja el límite ~9%, no a 0. La empresa puede pedir prestado para pagar salarios, volver a producir y vender.
3. **Lo mismo en los otros dos usos de las ventas del mes anterior,** para que "capacidad de deuda" signifique lo mismo en todo el modelo:
   - el orden de atención del banco (patrimonio / ventas), que además hoy divide por 0 si las ventas son 0;
   - la fracción de capacidad de deuda usada que modula los dividendos (R7, parte 2).
4. **Empresa que entra:** `S^e = 0`, como hoy (no puede pedir crédito hasta vender). Arranca con su capital inicial.
5. **Condiciones iniciales:** `S^e` = las ventas iniciales.

### Qué no cambia

λ_R9 = 3, el plazo de 12 meses, R13 (pérdida esperada), R12 y R7, salvo el punto 3.

### Lo que se espera (sin garantía)

- Debería eliminar el estado absorbente: una empresa con planta y sin caja puede volver a pedir crédito.
- **Riesgo:** las empresas que pierden ventas siguen endeudándose más tiempo (el límite baja despacio). Más deuda impaga y más quiebras por mora, o empresas que sobreviven endeudadas. Hay que mirar las quiebras, los castigos del banco y la deuda.

### Tests

- Un mes sin ventas no deja el límite en 0.
- `S^e` sigue la ecuación (convergencia a ventas constantes).
- Entrante con `S^e = 0`.
- SFC y determinismo.

## R9 con ventas esperadas: implementación y medición (aprobada el 2026-11-11)

**Código:**
- `Firm.expectedSales` (Sᵉ) y `CREDIT.salesExpectationWeight = 0,0914`.
- Se actualiza en el cierre del mes, solo para las empresas activas.
- La usan el límite de R9, el orden de atención del banco y la capacidad de deuda usada de R7.
- La empresa que entra arranca con Sᵉ = 0; las condiciones iniciales usan las ventas iniciales.

**Tests:**
- 2 nuevos: un mes sin ventas baja Sᵉ en λ_e y no deja el límite en 0; Sᵉ converge a ventas constantes.
- 2 ajustados porque el test suponía mal:
  - "con umbral 0 solo se prestan créditos cubiertos" ahora mira solo los meses con estimación logística, porque sin historia φ = 0 y el banco presta igual;
  - "la entrante la capitaliza quien compró la planta" ahora corre varias semillas, porque el caso no aparece en todas.

Resultado: 101 tests pasan.

**Medición** (`report:fase1 r9`, ~6 min; 20 semillas; medianas, mín–máx):

| | Antes (R13 pérdida esperada) | **λ_e = 0,0914 (base)** | λ_e = 0,25 | λ_e = 0,5 |
|---|---|---|---|---|
| Empresas paradas ≥ 12 meses (de 100) | 5 (1–8) | **1 (0–4)** | 2 (0–6) | 3 (1–5) |
| Máx. meses seguidos parada (mediana entre semillas) | 600 | 600 (mín. 1) | 600 | 600 |
| Empresas nuevas en 50 años (20 semillas) | — | 199 | 565 | 939 |
| … con algún mes sin producir en el 1er año | — | 35 | 146 | 376 |
| … paradas ≥ 6 meses en el 1er año (trampa) | — | **5** | 14 | 23 |
| … quebradas en el 1er año | — | 30 | 119 | 324 |
| **Zombis** (deuda 24 meses seguidos y Sᵉ en baja; promedio por mes) | — | **5,1** (3,5–7,2; máx. 13) | 3,0 | 2,8 |
| Quiebras anuales, consumo (empírico 5–10%) | 1,0% | **0,1%** | 0,5% | 0,9% |
| Desempleo A · B (últimos 10 años) | 5,2% · 2,4% | **2,9% · 1,8%** (A: 2,2–4,6%) | 3,5% · 2,2% | 4,4% · 2,3% |
| Ahorro forzoso A · B | 14% · 30% | 13% · 30% | 13% · 30% | 13% · 29% |
| Banco: insolvente · castigos/intereses · patrimonio final/inicial | 0/20 · 0,00 · 2,17 | **0/20 · 0,00 · 2,33** | 0/20 · 0,01 · 2,29 | 0/20 · 0,01 · 2,26 |
| Rechazados por riesgo · empresas endeudadas | 303 · 81% | 38 · 87% | 148 · 85% | 282 · 82% |
| Al tope de capacidad · utilización | 68% · 94% | 71% · 98% | 69% · 97% | 69% · 96% |
| Inflación A · B · B − A | 0,21% · 1,37% · 1,17 pp | **0,15% · 1,34% · 1,19 pp** | 0,20% · 1,36% · 1,19 pp | 0,20% · 1,40% · 1,23 pp |
| Criterio de la Fase 0 | 20/20 | **20/20** | 20/20 | 20/20 |

**Lectura:**
- La trampa casi desaparece: mediana de 1 empresa parada, y el desempleo de A baja a 2,9%.
- **Las quiebras bajan otra vez, a 0,1%:** con el límite suave, casi nadie choca con él y cae en mora.
- **Aparecen los zombis que temía Nico:** en promedio, ~5 de 100 empresas tienen deuda desde hace 2 años o más, ventas en baja y siguen vivas.
- Un λ_e más alto (memoria más corta) baja los zombis y sube las quiebras, pero también sube las empresas paradas, porque el límite vuelve a caer rápido.

### Lo que queda de la trampa: las empresas nuevas (verificado)

Las empresas que siguen paradas los 50 años tienen planta (pérdida si quiebran = 0), no tienen deuda y tienen Sᵉ = 0. Seguí una (semilla 2, empresa 2031, entra en el mes 39):

| Mes | Trabajadores | Producido | Vendido | Clientes fieles | Depósitos | Sᵉ |
|---|---|---|---|---|---|---|
| 39 (entra) | 20 | 200 | **0** | 0 | 0 (gastó el capital inicial en salarios) | 0 |
| 40 | 0 | 0 | 0 | 3 | 0 | 0 |
| 42 | 0 | 0 | 0 | 6 | 0 | 0 |

**Mecanismo:**
1. La empresa entra con un capital inicial de exactamente 1 mes de salarios (R12) y con Sᵉ = 0.
2. El primer mes no vende: no tiene clientes fieles (R6, β = 1) y su precio (el promedio) no es más bajo que el de los proveedores de nadie.
3. Gasta todo en salarios y termina con depósitos en 0 y Sᵉ = 0, así que el límite de crédito es 0.
4. Ya tiene clientes fieles al mes siguiente, pero nunca puede volver a producir.

En 50 años y 20 semillas, **5 de 199 empresas nuevas** quedan así. Son pocas, pero son permanentes, y explican las paradas restantes.

## Propuesta: Sᵉ inicial de la empresa que entra (espera el OK de Nico)

### Fuentes verificadas

- **Assenza et al. (2015), sección 5.1:** *"the firm forms expectations on future demand and sets desired production at the level of expected demand"* (`Y* = Yᵉ`). La demanda esperada de una empresa **es** su plan de producción.
- **Dosi, Fagiolo & Roventini (2010), K+S** (LEM WP 2008/21, sección 2.4): *"entrants are on average smaller than incumbents, with the stock of capital of new consumption-good firms and the stock of liquid assets of entrants in both sectors being a fraction of the average stocks of the incumbents"* (Caves, 1998; Bartelsman et al., 2005). La empresa que entra se inicializa con lo que tienen las que ya están.

### Propuesta

- **Sᵉ inicial = producción planeada × precio** de la empresa que entra, ambos fijados por R12 (tamaño mediano, precio promedio). Es su propia demanda esperada valuada a su precio, como en Assenza. Con el tamaño mediano y el precio promedio, es aproximadamente la Sᵉ de una empresa mediana del sector, que es lo que haría K+S.
- **No cambia nada más:** el capital inicial, la planta, R13 y la pérdida esperada siguen igual.
  - Para una empresa de consumo con planta, el banco presta si la planta cubre (LGD).
  - Para una empresa de capital, sin garantía, el racionamiento por φ sigue actuando.

### Alternativa

Sᵉ inicial = una fracción de la mediana de las que ya están (K+S: las que entran son más chicas). Necesita un parámetro más; queda como opción.

### Riesgo

El banco le presta a una empresa sin historia de ventas, hasta 3 meses de su plan. Si no vende, se endeuda y quiebra por mora en 3 meses, en vez de quedar parada para siempre. Es lo esperable: la quiebra es la salida que hoy no tiene.

### Tests

- La empresa que entra tiene Sᵉ = plan × precio.
- Medición: empresas nuevas paradas en el 1er año, quiebras de empresas nuevas, empresas paradas, zombis.

## Sᵉ inicial de la empresa que entra: medición (aprobada el 2026-11-11)

Sᵉ inicial = producción planeada × precio. Medido con 20 semillas antes de R10 (script ad hoc; mismas métricas que `report:fase1 r9`):

| | R9 (Sᵉ inicial = 0) | **Sᵉ inicial = plan × precio** |
|---|---|---|
| Empresas paradas ≥ 12 meses | 1 (0–4) | **0 (0–0)**; máx. 3 meses seguidos |
| Empresas nuevas · paradas ≥ 6 meses en el 1er año · quebradas en el 1er año | 199 · 5 · 30 | 426 · **0** · 153 (36%) |
| Zombis (promedio por mes) | 5,1 | 5,5 |
| Quiebras anuales, consumo | 0,1% | 0,4% |
| Desempleo A · B | 2,9% · 1,8% | 3,2% · 1,8% |
| Banco: insolvente · patrimonio final/inicial · castigos/intereses | 0/20 · 2,33 · 0,00 | 0/20 · 2,35 · 0,02 |
| Inflación A · B · criterio de la Fase 0 | 0,15% · 1,34% · 20/20 | 0,18% · 1,39% · **20/20** |

**La trampa sin caja queda resuelta.** Más empresas nuevas quiebran en su primer año (36%), en lugar de quedar paradas. Zombis y quiebras bajas se evalúan en el punto de control 1a, después de R10 (decisión de Nico).

**r̄ calibrado** con este régimen (flujo de caja operativo / V, años 40–50 desde la creación, A): mediana **0,00825 por mes** (0,0071–0,0092). Caiani usa 0,04345 por trimestre (~0,0145 por mes).

## R10: implementación y medición (2026-11-11)

**Código (`src/phase1.ts`, `src/params.ts`):**
- `desiredCapacityGrowth(firm)`: g = γ1·(r − r̄)/r̄ + γ2·(u − ū)/ū, acotada en −1.
- `Firm.desiredOutput`: la producción deseada por R1 antes del tope, que es la señal de utilización.
- `Firm.cashFlowRate`: (ganancia + amortización − cuotas pagadas) / V, calculada en R7.
- Pedido de capital = reposición δ·K̄ + g·K, acumulado; nunca negativo.
- Los préstamos se parten: la parte de la inversión va a 60 meses (`CREDIT.investmentLoanTermMonths`) y el resto a 12.
- Parámetros: γ1 = 0,01/3, γ2 = 0,02/3, ū = 0,85, r̄ = 0,00825.

**Tests:** 2 nuevos (dirección de g y cota en −1; pedido ≥ 0, crecimiento por encima de la reposición, préstamos a 60 meses) y 1 de vacuidad ajustado (las quiebras ahora se buscan en varias semillas). Resultado: 103 tests pasan.

**Medición** (`report:fase1 r10`, ~7 min; 20 semillas; medianas):

| | Sin R10 (solo reposición) | **R10, γ base** | γ × 0,5 | γ × 2 |
|---|---|---|---|---|
| Desempleo A, últimos 10 años | 3,2% | **84%** | 42% | 93% |
| Tendencia anual del capital | ~0% | **−3,1%** | −0,7% | −4,7% |
| Precio del capital / precio del consumo | ~0,76 | **15** | 3,8 | 12 |
| Empleo en el sector de capital / ocupados | 8,1% | **2,9%** | 7,6% | 3,3% |
| Inversión / ventas de consumo | ~9% | 56% | 36% | 66% |
| Ahorro forzoso A | 13% | 70% | 35% | 85% |
| Quiebras anuales, consumo · zombis | 0,4% · 5,5 | 12,5% · 35 | 5,8% · 36 | 13,7% · 25 |
| Deuda / masa salarial | ~0,5 | 7,1 | 3,4 | 8,4 |
| Inflación A · B > A | 0,18% · 20/20 | **1,97% · 12/20** | 0,96% · 12/20 | 2,46% · 14/20 |
| Criterio de la Fase 0 (A < 1%) | 20/20 | **0/20** | 13/20 | 0/20 |

**R10 con la regla de cantidad actual de las empresas de capital colapsa la economía, y el criterio de la Fase 0 deja de cumplirse.**

### Diagnóstico (verificado, semilla 1, desde la creación)

| Mes | Pedidos de capital · comprados | Empresas de capital que venden todo | Trabajadores en el sector de capital | Precio capital / consumo | Desempleo |
|---|---|---|---|---|---|
| 1 | 1.593 · 1.511 | 16/20 | 161 | 1,00 | 2,3% |
| 12 | 1.418 · 1.051 | 20/20 | **105** | 1,03 | 0% |
| 60 | 1.986 · 1.726 | 17/20 | 174 | 1,40 | 0% |
| 120 | 1.538 · 1.392 | 16/20 | 140 | 1,76 | 0% |
| 240 | 1.228 · 994 | 15/20 | 103 | 2,53 | 18,7% |

Las empresas de capital venden todo y dejan pedidos sin atender, pero **no se expanden**: achican su planta y suben el precio sin parar. El capital no se repone, la capacidad de consumo cae, se pierden empleos y la economía entra en espiral. Las empresas de capital acumulan depósitos (de 27 a 245 millones de pesos en 20 años).

**Causa: un apartamiento mío de la fuente en R11.** La regla de R11 para las empresas de capital citaba a Assenza et al. (2015), ec. 6.1–6.2, pero la implementé con:
- el paso de cantidad al azar de R1 (u ≤ 5% por mes);
- como base, las **ventas** del mes anterior, que nunca superan lo producido (demanda censurada). La empresa no "ve" la demanda que no atendió.

**Texto de Assenza (ec. 6.2, verificado):**
- `Y* = Y + ρ·(−Δ) − inventario` si `Δ ≤ 0 y P > P̄`;
- `Y* = Y − ρ·Δ − inventario` si `Δ > 0 y P < P̄`;
- Δ es el error de pronóstico (producción − demanda) y **ρ = 0,9** (cuadro 2, *"Quantity adjustment parameter"*).

La cantidad se ajusta en proporción a la demanda **insatisfecha**, no al azar. Mientras la demanda de capital fue plana (solo reposición), la diferencia no se notaba. Con la inversión neta, la oferta de capital no puede seguir a la demanda.

**Nota:** la R1 de las empresas de consumo (Fase 0, Gaffeo et al., 2008) también usa el paso al azar. Assenza usa ρ·(−Δ) también para ellas (ec. 5.2). Ahí no es un apartamiento: la fuente de esa regla es Gaffeo, no Assenza. Pero es una diferencia entre versiones de CATS a tener en cuenta.

## Propuesta: corregir la regla de cantidad de las empresas de capital (espera el OK de Nico)

**Fuente:** Assenza, Delli Gatti & Grazzini (2015), CESifo WP 4765, ec. 6.1–6.2 y cuadro 2 (ρ = 0,9). Verificado contra el texto.

1. **Demanda de cada empresa de capital:** se registra en el mercado de bienes de capital como la suma de lo que le pidió cada comprador que la visitó (lo que le faltaba a ese comprador cuando le tocó esa empresa), lo haya podido vender o no. Δ = producción − demanda.
   - *Ojo:* si un comprador no consigue todo en A y completa en B, la parte que no consiguió en A cuenta como demanda de A y de B. Es la "cola de compradores insatisfechos" de Assenza; puede sobreestimar un poco la demanda.
2. **Precio (ec. 6.1, como hoy):** sube si `Δ ≤ 0 y P < P̄`; baja si `Δ > 0 y P > P̄`.
3. **Cantidad (ec. 6.2):**
   - si `Δ ≤ 0 y P ≥ P̄`: `Y* = Y + ρ·(−Δ) − inventario`;
   - si `Δ > 0 y P < P̄`: `Y* = Y − ρ·Δ − inventario`;
   - en los otros dos casos: `Y* = Y − inventario` (solo cambia el precio).
   - Y = producción del mes anterior, ρ = 0,9. Se mantiene el supuesto de nunca planear menos que un trabajador.
4. **No cambia:** la R1 de las empresas de consumo (Fase 0) ni R10.

**Lo que se espera (sin garantía):** que el sector de capital siga a la demanda de inversión, que su precio relativo se estabilice y que la capacidad crezca hacia ū. Se mide con las mismas métricas de R10, más el criterio de la Fase 0.

## Corrección de la regla de cantidad de las empresas de capital: implementación y medición (2026-11-11)

**Decisión de Nico:** aprobada la regla de Assenza (ec. 6.1–6.2), con la medición del doble conteo. R10 queda **apagada por defecto** (`CAPITAL.netInvestment = 0`), para que el criterio de la Fase 0 se cumpla entre commits.

**Código:**
- `Firm.demandUnits` y `Firm.lastDemand`, registradas en el mercado de bienes de capital.
- `CAPITAL.capitalQuantityAdjustment = 0,9` (ρ) y el interruptor `CAPITAL.capitalQuantityRule`: 0 = la regla de R11 original, 1 = Assenza.
- `credit.capitalDemandRegistered`, para medir el doble conteo.

**Primera implementación: error mío.** Conté como demanda lo que le faltaba al comprador, pudiera pagarlo o no. Las empresas de capital veían siempre exceso de demanda, nunca bajaban el precio, y el precio del capital llegó a 160–600 veces el del consumo, con colapso total. **Se corrigió:** la demanda registrada es `min(lo que le falta, lo que puede pagar a ese precio)`, que es la demanda efectiva de Assenza.

**Medición con la demanda efectiva** (`report:fase1 r11k`, ~7 min; 20 semillas; medianas):

| | R11 original, R10 apagada (referencia) | Assenza, R10 apagada | Assenza, R10 γ base | Assenza, R10 γ × 0,5 |
|---|---|---|---|---|
| **Doble conteo** (demanda registrada / unidades pedidas) | — | **0,99** (0,97–1,02) | 0,79 | 0,91 |
| Pedidos de capital cumplidos | ~99% | 86% | 65% | 76% |
| Precio del capital / consumo | ~0,76 | **5,3** | 5,6 | 5,8 |
| Empleo en el sector de capital | 8,1% | 6,9% | 6,1% | 6,1% |
| Tendencia anual del capital | ~0% | −0,65% | −1,35% | −1,23% |
| Desempleo A | 3,2% | **54%** | 67% | 62% |
| Quiebras anuales, consumo | 0,4% | 8,3% | 8,9% | 8,6% |
| Inflación A · criterio de la Fase 0 (A < 1% · B > A) | 0,18% · 20/20 · 20/20 | **1,25% · 0/20 · 19/20** | 1,49% · 0/20 · 15/20 | 1,31% · 0/20 · 15/20 |

**El doble conteo es despreciable** (0,99 con R10 apagada). Con R10 prendida la demanda registrada es incluso menor que la pedida (0,79), porque parte de los pedidos no se pueden pagar al precio de la empresa que se visita.

**La regla de Assenza desestabiliza la economía incluso sin R10.** Diagnóstico (semilla 1, no verificado del todo):
1. **Escasez de trabajo al arrancar:** en los primeros 12 meses hay pleno empleo (desempleo 0%) y las empresas de capital no cubren sus vacantes (12–17 de 20). R2 les sube el salario, que nunca baja. Terminan pagando 28% más que las de consumo, y eso sube el piso de su precio.
2. **Las empresas de capital producen siempre algo menos que la demanda:** Δ ≤ 0 en 12–18 de 20 todos los meses. La mitad con precio por debajo del promedio solo sube el precio (en Assenza cambia el precio o la cantidad, nunca las dos cosas). El precio relativo del capital deriva de 1,0 a 1,74 en 20 años.
3. **La reposición se encarece,** las empresas de consumo se endeudan, aumentan las quiebras y, pasado el año 20, la economía cae.

**Estado:** el interruptor queda en 0 (la regla original, que se aparta de Assenza) para que el criterio de la Fase 0 se cumpla. Con la configuración por defecto: criterio 20/20, A 0,16%, B 1,37%, desempleo de A 3,3%, 0 empresas paradas. **Espera la decisión de Nico.**

**Nota sobre los préstamos de inversión a 60 meses:** vinieron con R10 y siguen activos con R10 apagada, porque también financian la reposición. Cambian la medición por defecto respecto de la de Sᵉ inicial (zombis 5,5 → 46; empresas nuevas 426 → 756; patrimonio del banco ×2,35 → ×2,88). **La métrica de zombis deja de servir:** con préstamos a 5 años, toda empresa que repone capital tiene deuda 24 meses seguidos. Hay que redefinirla para el punto de control (por ejemplo, deuda creciente y ventas en baja).

## Revisión de las reglas contra sus fuentes (2026-11-11, pedido de Nico)

**Proceso de acá en adelante:** para cada regla, la ecuación de la fuente al lado de la implementación, término por término, y un test con un caso calculado a mano (`test/rules-by-hand.test.ts`, 23 tests).

**Leyenda:**
- ✓ = igual a la fuente;
- **A** = adaptación aprobada por Nico;
- **S** = supuesto documentado (la fuente no da el valor o no aplica);
- **D** = diferencia no documentada hasta hoy;
- **NV** = fuente no verificada contra el texto (no tengo acceso al texto).

### R1. Precio y cantidad de las empresas de consumo — `model.ts:firmsPlan`, `phase1.ts:firmsPlanP1`

Fuente: Gaffeo et al. (2008), NV; la estructura de CATS está verificada en Dawid et al. (2024), ec. 14 y cuadro 1, y en Assenza et al. (2015), ec. 5.1–5.2.

| Término | Fuente | Implementación | |
|---|---|---|---|
| Señal de demanda | Δ = producción − demanda (Assenza) / exceso de demanda | `soldOut` = vendió todo el stock (bien perecedero) | ✓ |
| Precio de referencia | precio promedio del mercado | índice de precios de las ventas del mes anterior | ✓ |
| Sube el precio | Δ ≤ 0 y P < P̄: P(1 + η) | `soldOut` y P < P̄: P·(1 + u) | ✓ |
| Baja el precio | Δ > 0 y P > P̄: P(1 − η) | no `soldOut` y P ≥ P̄ | ✓ (empate P = P̄: **S**) |
| Cantidad | CATS: Y* = (1 ± γ)·Y_{t−1} (Dawid); Assenza: Y* = Y + ρ(−Δ) | Y_{t−1}·(1 ± u) | ✓ con Gaffeo y Dawid; Assenza usa otra versión |
| Tamaño del paso | Assenza: η ~ U(0; 0,1) | u ~ U(0; 0,05) | **S/D:** el valor 0,05 es un supuesto, pero la versión de CATS que usamos para el sector de capital usa 0,1 |
| Piso de precio | Assenza: *"a certain threshold (AC) which covers average cost"* | w/α (Fase 0); w/α + δ(V/K)/κ (Fase 1) | **D:** no incluye el costo financiero (intereses) en el costo medio; el texto no lo detalla |
| Tope de capacidad | Assenza ec. 5.8: N* = min(Y*/α, κK/α) | plannedOutput ≤ ⌊κK⌋ | ✓ |
| Mínimo de un trabajador | *"will not choose a quantity below the level that guarantees the employment of at least one worker"* (Assenza 5.1) | Y* ≥ α | ✓ |

### R2. Salarios — `firmsPlan`

Fuente: Delli Gatti et al. (2011), **NV** (libro sin acceso). Assenza et al. (2015) usa **salario fijo y uniforme** (cuadro 2: w = 1), así que la versión de CATS que usamos para el capital no tiene dinámica salarial.

| Término | Fuente | Implementación | |
|---|---|---|---|
| Suba | ¿w(1 + ξ) si hay vacantes? (NV) | w·(1 + u), u ~ U(0; 0,05), si quedaron vacantes | **NV** |
| Baja | rigidez a la baja (Bewley, 1999; Dickens et al., 2007) | nunca baja | **S** con evidencia empírica |

**Hallazgo:** R2 es la única regla del núcleo sin ecuación verificada. Además, es la que alimenta la espiral salarial (1a.3) y el salario alto de las empresas de capital (arriba). Prioridad para verificar.

### R3. Demanda de trabajo y despidos — `firmsPlan`, `firmsPlanP1`

| Término | Fuente (Assenza 5.8–5.9) | Implementación | |
|---|---|---|---|
| Deseados | N* = min(Y*/α, κK/α) | ⌈plannedOutput/α⌉ (plannedOutput ya acotado) | ✓ |
| Vacantes | max(N* − N, 0) | igual | ✓ |
| Despidos | *"selects at random … workers and fires them"* | al azar | ✓ |
| Liquidez | brecha de financiamiento con crédito (sec. 7) | N ≤ ⌊depósitos/w⌋ después del crédito | ✓ |

### R4. Mercado de trabajo — `laborMarket`

Fuente: Riccetti, Russo & Gallegati (2015), **NV**. Assenza: el desocupado visita Ze = 5 empresas (cuadro 2), con salario uniforme.

| Término | Fuente | Implementación | |
|---|---|---|---|
| Empresas visitadas | Assenza Ze = 5 | M = 4 | **S** (valor) |
| Elección | (salario uniforme en Assenza) | la de mayor salario | **NV** |

### R5. Consumo — `goodsMarket`, `goodsMarketP1`

Fuente: Godley & Lavoie (2007), cap. 3.

| Término | Fuente | Implementación | |
|---|---|---|---|
| Ingreso | SIM: C = α1·YD + α2·H₋₁ (YD del período) | α1·YD_{t−1} + α2·W | **D (de documentación):** es la versión **SIMEX** (YDᵉ = YD₋₁, expectativas ingenuas), no SIM. La regla está bien; `fase0-reglas.md` dice SIM. |
| Riqueza | H₋₁ | depósitos al inicio del mes | ✓ |
| Valores | SIM 0,6 / 0,4 | 0,9 / 0,05 por mes | **S** (documentado) |

### R6. Mercado de bienes

- **Fase 0** (CATS, NV en detalle): visita Z = 3 al azar y compra en la más barata primero. ✓ con la descripción de Assenza (Zc = 2, valor **S**).
- **Fase 1:** fidelidad de Delli Gatti, Terranova & Turco (2023), sección 3.9, ya verificada: conserva el proveedor, visita Z − 1 más y cambia con `1 − e^(−β·(P_ant − P_nuevo)/P_nuevo)`, β = 1. ✓

### R7. Ganancias y dividendos — `profitsP1`

| Término | Fuente (Caiani 3.1.3, cuadro 3) | Implementación | |
|---|---|---|---|
| Ganancia | ventas + intereses cobrados + Δ valor de inventarios − salarios − intereses − amortización | ventas − salarios − intereses − amortización + Δ inventario (no hay intereses por depósitos) | ✓ |
| Reparto | ρ = 0,9 de la ganancia del período, si es positiva | ρ·(1 − ℓ) del resultado acumulado, una vez por año | **A** (LSC arts. 68 y 71, más el endeudamiento) |

### R8. Tesoro y BCRA

Estructura de SIM (Godley & Lavoie, cap. 3) ✓. La regla de la alícuota con base de pleno empleo es propia, **S** (documentada).

### R9. Crédito — `allocateCredit`

| Término | Fuente | Implementación | |
|---|---|---|---|
| Límite de deuda | Dosi et al. (2013), ec. 3: deuda ≤ λ·S_{t−1} (verificado) | ⌊λ·Sᵉ⌋ − deuda | **A** (Sᵉ de Caiani, verificado en el código) |
| Expectativa | Caiani: xᵉ = λ_e·x₋₁ + (1 − λ_e)·xᵉ₋₁, λ_e = 0,25 por trimestre | λ_e = 0,0914 por mes | ✓ (conversión) |
| Orden de atención | Dosi: patrimonio/ventas, de mayor a menor | patrimonio/Sᵉ | **A** |
| Tasa base | Dosi ec. 7: r_L = (1 + μ)·r | igual, μ = 0,5 | ✓ |
| Plazo | Caiani: 20 trimestres para todos los préstamos | 60 meses la inversión, 12 el capital de trabajo | **A** |

### R10. Inversión — `desiredCapacityGrowth`

Verificada en el código de los autores.

| Término | Caiani | Implementación | |
|---|---|---|---|
| g | γ1·(r − r̄)/r̄ + γ2·(u − ū)/ū, ≥ −1 | igual | ✓ |
| r | flujo de caja pasado / valor del capital pasado | (ganancia + amortización − cuotas)/V | ✓ |
| u | producción deseada / capacidad | desiredOutput/(κK) | ✓ |
| Unidades | ⌈((1+g)·cap − cap residual)/productividad⌉ | ⌊acumulado de g·K + δ·K̄⌋, arrastrando la fracción | **A/D menor:** techo contra piso con arrastre; equivalentes en el promedio |
| Parámetros | trimestrales | ÷3; r̄ calibrado con el régimen como *"SS-given"* | **A** |

### R11. Capital

| Término | Fuente | Implementación | |
|---|---|---|---|
| Producción de consumo | Assenza 5.3–5.4: min(αN, κK) | min(αN, ⌊κK⌋) | ✓ |
| Depreciación | Assenza 5.5: K₊₁ = (1 − δω)K + I | K −= δωK | ✓ |
| Reposición | Assenza 5.6: δK̄/γ, con K̄ = νK̄₋₁ + (1−ν)Y/κ | δK̄ (se invierte todos los meses: γ = 1) | ✓ |
| Valor libro | Caiani: amortización lineal por lote | geométrica según el uso | **A** |
| Producción de capital | Assenza 6.3: αN | α_K·N | ✓ |
| Precio y cantidad del capital | Assenza 6.1–6.2 | interruptor: 0 = R11 original (**D** con la fuente), 1 = Assenza | **pendiente de decisión** |
| Inventario | Caiani: al costo unitario corriente | w/α_K por unidad | ✓ |
| Capital nuevo | Caiani: se usa desde el período siguiente | igual | ✓ |

### R12. Quiebras y entrada

| Término | Fuente | Implementación | |
|---|---|---|---|
| Disparador | Caiani 3.3: *"run out of liquidity or … net-wealth turns negative"* | patrimonio < 0 o 3 cuotas impagas | ✓ (3: **S**) |
| Venta forzosa | Caiani: a los hogares, con descuento (*haircut* 0,5) | r_K = 0,3 (Ramey & Shapiro) | **A** |
| Sin comprador | Caiani: en proporción a la riqueza | en proporción a los depósitos | ✓ |
| Entrada | Assenza: reemplazo uno a uno; K+S: fracción del promedio | uno a uno, tamaño mediano, 3 meses de demora, capital de 1 mes de salarios | ✓ / **S** |
| Sᵉ inicial | Assenza 5.1: demanda esperada = plan | plan × precio | ✓ |

### R13. Banco — `allocateCredit`, `bankStage`, `creditRisk.ts`

| Término | Fuente | Implementación | |
|---|---|---|---|
| Apalancamiento | Assenza 8.1: (L + F)/(E + L + F) | (deuda + pedido)/(deuda + pedido + patrimonio) | ✓ |
| φ | Assenza: logística sobre la historia | logística agrupada, ventana de 120 meses | ✓ (agrupación **A**) |
| Tasa | Assenza 8.9 (plazo infinito, μ = 1,2) | no arbitraje a un mes: (r0 + φ·LGD)/(1 − φ) | **A** |
| LGD | Caiani 3.2: garantía de la planta / deuda | 1 − r_K·V/exposición | ✓ |
| Racionamiento | Assenza 8.11: φ·(L + F) ≤ ζ·E_b | φ·LGD > θ | **A** |
| Límite total | Basilea, 8% | igual | ✓ |
| **Dividendos del banco** | Caiani cuadro 3: *"Banks' profit share distributed as dividends"* = **0,6** | **0,9** ("igual que R7, supuesto") | **D:** hay un valor con fuente y usamos otro. Relevante para la observación de Nico sobre el patrimonio del banco |

### Diferencias encontradas (fuera de la de las empresas de capital, ya conocida)

1. **R2 no tiene ecuación verificada** (NV), y la versión de CATS que seguimos para el capital usa salario fijo. Es la regla que alimenta la espiral salarial.
2. **R13: los dividendos del banco** usan 0,9 cuando Caiani da 0,6.
3. **R1: el tamaño del paso de precio** es 0,05 (supuesto); Assenza usa U(0; 0,1).
4. **R1: el piso de precio** no incluye el costo financiero; Assenza habla de "costo medio".
5. **R5 es SIMEX, no SIM** (solo documentación).
6. **R10: techo contra piso con arrastre** en las unidades (menor).
7. **Tamaños de búsqueda** (M = 4, Z = 3 contra 5 y 2 de Assenza): supuestos, sin cambio.

Ninguna se corrigió: esperan la decisión de Nico.
