# Fase 0 — Reglas de comportamiento

> Aprobado por Nico el 2026-11-10 con las opciones recomendadas y cuatro ajustes (consumo, salarios, impuesto y criterio de salida), ya incorporados abajo.
> Los valores numéricos son **supuestos a calibrar**, no números validados.
> Todo esto es la **Fase 0** del roadmap de `CLAUDE.md` (MVP). Las etapas dentro de un tick se llaman *etapas* (`Stage` en el código) para no confundirlas con las fases del roadmap.

## Objetivo

Que con la misma semilla y el mismo gasto, la cápsula con más financiamiento monetario muestre **más inflación sin que ninguna regla la programe**. El mecanismo esperado (que tiene que *emerger*, no estar escrito):
emisión → déficit → más riqueza financiera privada → más demanda de bienes → empresas que se quedan sin stock suben precios y buscan contratar → vacantes sin cubrir suben salarios → más demanda.

Si en vez de inflación aparece solo más empleo (porque hay capacidad ociosa), también es un resultado legítimo: lo que importa es que surja de las reglas.

> **Corrección del 2026-11-11 (paso 1a.0 de la Fase 1).** Hasta esa fecha, el código tenía un defecto en R1: la producción deseada se ajustaba sobre sí misma y crecía sin límite. En las corridas medidas antes de la corrección, el mecanismo que operaba era más simple que el de arriba. Desde el mes ~120, **todas las empresas contrataban todo lo que podían pagar**: el empleo lo fijaban los depósitos de las empresas y la regla de cantidad no tenía efecto. Además, R7 dejó de pagar dividendos (ver R1 y R7). El criterio de salida se cumple igual antes y después de la corrección (ver "Resultados").

## Supuestos generales

- **1 tick = 1 mes.**
- **Un solo bien de consumo**, perecedero (lo que no se vende en el mes se pierde). Simplifica inventarios; es el supuesto del modelo CATS básico.
- **Producción solo con trabajo**, lineal: `y = α · N` (α = 10 unidades por trabajador por mes, normalización). Sin capital en la Fase 0.
- Todos los pagos son con **depósitos** (no se usa efectivo en la Fase 0).
- El **banco es pasivo** en la Fase 0: tiene depósitos y reservas, no presta, no cobra ni paga interés.

## Condiciones iniciales ("cápsula limpia", estilizada hasta tener la EPH)

- 500 hogares, 30 empresas iguales. 92% de los hogares empleados, repartidos al azar entre las empresas.
- Salario inicial `w0` igual en todas las empresas; precio inicial = costo unitario × 1,1.
- Cada empresa tiene **un dueño**: un hogar elegido al azar (30 hogares "propietarios", un 6%).
- Depósitos iniciales: hogares ≈ 2 meses de salario; empresas ≈ 2 meses de masa salarial.
- **Origen contable de esos depósitos**: deuda pasada del Tesoro con el BCRA (`advances`). Es la historia de Godley & Lavoie: la riqueza financiera privada inicial es la contracara de la deuda pública acumulada. Cierra la matriz SFC desde el tick 0.

## Calentamiento (agregado el 2026-11-10)

Antes del mes 0 visible, cada cápsula corre **420 meses de calentamiento** (240 hasta el 2026-11-11; 360 por unas horas el mismo día) (`PHASE0_CONFIG.burnInTicks`). Durante el calentamiento las perillas están fijas (`burnInKnobs`: G = 50.000 pesos/mes, s = 0), es igual para A y B (misma semilla) y el usuario no puede intervenir. Al terminar, el reloj visible vuelve a 0; el estado guarda aparte los meses transcurridos (`elapsedTicks`) y la semilla. El generador de azar sigue desde donde quedó, no se resiembra. Código: `createWarmState` en [warmup.ts](../packages/engine/src/warmup.ts).

### Por qué hace falta: condiciones iniciales inconsistentes entre sí

Sin calentamiento hay un transitorio en los primeros 3 a 5 años: el desempleo sube hasta ~30% y después se recupera. Viene de tres inconsistencias de las condiciones iniciales. Las tres apuntan a lo mismo: **se arranca con menos dinero del que la economía necesita para funcionar con sus fricciones**.

1. **El precio inicial es bajo para las fricciones de búsqueda.** El precio arranca en 1,10 × costo unitario. Con búsqueda sobre 3 empresas, siempre queda entre 10% y 15% del stock sin vender (aunque 2/3 de las empresas se agoten). Para cubrir salarios vendiendo ~88%, el precio tiene que ser al menos ~1,14 × costo. Las empresas pierden plata desde el primer mes (ventas de 0,94 a 0,99 de la masa salarial). El margen al que converge el modelo es ~1,16 a 1,21.
2. **Los depósitos de los hogares suponen un mundo sin racionamiento.** Arrancan con 2 meses de ingreso, la riqueza de equilibrio de R5 si el hogar compra todo lo que quiere. Con fricciones, parte de la demanda queda como ahorro forzoso y en equilibrio los hogares terminan con ~4 meses de ingreso. Ese dinero sale de las empresas, por sus pérdidas.
3. **El dinero total no alcanza para esa distribución.** Se arranca con 1,92 M y en equilibrio hacen falta ~2,5 M. Con s = 0, el único camino para conseguir lo que falta es el déficit cíclico: la recesión genera déficit, el déficit genera emisión y la emisión completa el dinero.

Cuando el capital de trabajo de las empresas cae por debajo de la masa salarial deseada (alrededor del mes 12), despiden aunque se agoten, y viene la recesión. Hay dos inconsistencias menores: los desocupados arrancan con 2 meses de *salario* pero solo cobran la transferencia (desahorran), y los dueños arrancan sin los dividendos en su ingreso del mes anterior.

Calibrar las condiciones iniciales (margen ~1,2, más depósitos) acortaría el calentamiento. **Queda como opcional; no está hecho.**

> **Ojo (2026-11-11):** todo lo de esta sección se midió con el defecto de R1. Después de corregirlo, el margen de equilibrio es ~1,7 (no 1,16–1,21) y la convergencia es más lenta (ver la tabla siguiente).

### Revisión después de la corrección de R1 (2026-11-11)

Promedio de 20 semillas por bloque de 5 años desde la creación, con G = 50.000:

| Años | 0–5 | 5–10 | 10–15 | 15–20 | **20–25** | 25–30 | 30–35 | 35–40 | 40–60 |
|---|---|---|---|---|---|---|---|---|---|
| Desempleo | 32,7% | 28,0% | 16,5% | 9,6% | **5,8%** | 4,5% | 3,6% | 3,5% | 4,2%–4,5% |
| Margen precio/costo | 1,25 | 1,62 | 1,72 | 1,73 | **1,74** | 1,72 | 1,71 | 1,69 | 1,69–1,71 |

- **Con 240 meses (fin del año 20) el desempleo todavía está bajando**: 5,8% en los años 20–25 contra ~4% del régimen. Se estabiliza desde el año 30, más o menos.
- **El test del calentamiento falla por poco**: la pendiente media del margen en los últimos 24 meses da 0,0058/año, contra el umbral de 0,005. Con calentamientos de 180, 240, 300, 360 y 480 meses, esa pendiente da 0,0083, 0,0058, −0,0081, 0,0000 y 0,0090: oscila alrededor de cero con un ruido del mismo tamaño que el umbral. Por eso, la cola de 24 meses no sirve para distinguir 240 de 480. Los promedios por bloque sí la distinguen.
- **Decisión (Nico, 2026-11-11)**: un test por promedios de 5 años y un calentamiento de 360 meses, llevado después a **420** (ver abajo).

### Calentamiento de 360 meses, sin el colchón de R7 (2026-11-11)

Al eliminar el colchón de R7, la convergencia cambió un poco. Promedio de 20 semillas por bloque de 5 años desde la creación:

| Años | 15–20 | 20–25 | **25–30** | 30–35 | 35–40 | 40–45 | 45–50 | 50–55 | 55–60 |
|---|---|---|---|---|---|---|---|---|---|
| Desempleo | 9,2% | 5,7% | **5,8%** | 4,4% | 4,9% | 4,2% | 4,3% | 5,1% | 4,3% |
| Margen | 1,84 | 1,81 | **1,80** | 1,81 | 1,79 | 1,79 | 1,77 | 1,77 | 1,77 |

**Test** (`phase0-criteria.test.ts`, "calentamiento"): para cada semilla, compara el promedio de los últimos 5 años del calentamiento con el del régimen (años 40 a 50 desde la creación). La brecha media tiene que ser menor a 2 pp en desempleo y a 0,03 en margen. Los umbrales se fijaron mirando estas mediciones, de modo que separen 240 de 360:

| Calentamiento | Brecha media de desempleo · desvío entre semillas | Brecha media de margen |
|---|---|---|
| 180 | 13,1 pp · 1,9 | 0,033 |
| 240 | 4,9 pp · 2,1 | 0,055 |
| 300 | 1,4 pp · 2,4 | 0,023 |
| **360** | **1,5 pp · 2,3** | **0,019** |
| 420 | 0,1 pp · 2,2 | 0,021 |

**Residuo con 360 meses**: el desempleo de los años 25–30 queda ~1,5 pp por encima del régimen. El error estándar es de ~0,5 pp, así que el residuo no es solo ruido. Con 420 meses desaparece. **Nico decidió pasar a 420** (2026-11-11). Con el tamaño de la Fase 1 (2.000 hogares) también alcanza: ver [fase1-reglas.md](fase1-reglas.md), paso 1a.1.

### Verificación de que 240 meses alcanzan

Últimos 24 meses del calentamiento, 20 semillas. Pendiente por mínimos cuadrados, anualizada; "fuera de régimen" = la media de la ventana está a más de 2 desvíos de las medias de 24 meses del régimen de largo plazo.

| Calentamiento | Fuera de régimen | Pendiente del desempleo: negativas · media | Pendiente del margen: negativas · media |
|---|---|---|---|
| 120 | 4 | 15/20 · −1,36 pp/año | 17/20 · −0,010/año |
| 180 | 1 | 8/20 · 0,00 | 14/20 · −0,001 |
| **240** | 1 | 12/20 · −0,26 | 13/20 · −0,003 |
| 360 | 4 | 13/20 · −0,21 | 9/20 · +0,001 |

Con 120 todavía hay una tendencia sistemática a la baja. Desde 180 las pendientes se reparten alrededor de cero; las semillas "fuera de régimen" con 180 o más son ruido (con 40 comparaciones a 2 desvíos se esperan ~2 por azar). Se eligió 240 para tener margen. Un test lo verifica: `phase0-criteria.test.ts`, "calentamiento (20 semillas)". El detalle por semilla se ve con `pnpm --filter @petri/engine report:fase0`.

**Ojo con leer un mes suelto**: el desempleo mensual oscila mucho en el régimen estable (por ejemplo, entre 0% y 12% en los últimos 24 meses del calentamiento de la semilla 20260101, con media de 5%). Que el mes 0 muestre un valor alto no significa que el calentamiento no terminó.

## Orden de cada tick

1. Tesoro fija la alícuota del mes.
2. Empresas ajustan precio, cantidad y salario según lo que pasó el mes anterior; calculan cuántos trabajadores necesitan y despiden el excedente.
3. Mercado de trabajo.
4. Producción y pago de salarios (con retención de impuesto).
5. Tesoro paga el gasto público (si no le alcanza la recaudación, pide adelantos al BCRA).
6. Mercado de bienes.
7. Empresas calculan ganancia y pagan dividendos.
8. Indicadores.

## Reglas

### R1. Precio y cantidad de las empresas

Fuente: Gaffeo, Delli Gatti, Desiderio & Gallegati (2008), *Adaptive microfoundations for emergent macroeconomics*, Eastern Economic Journal 34(4); Delli Gatti et al. (2011), *Macroeconomics from the Bottom-up* (modelo CATS básico).

Cada empresa mira dos cosas del mes anterior: si vendió todo (exceso de demanda) y si su precio está por encima o por debajo del precio promedio del mercado `P̄`.

| Situación | Vendió todo (sin stock) | Le sobró stock |
|---|---|---|
| Precio < P̄ | **sube precio** `p ← p·(1+u)` | **baja cantidad** `q ← q·(1−u)` |
| Precio ≥ P̄ | **sube cantidad** `q ← q·(1+u)` | **baja precio** `p ← p·(1−u)` |

`u ~ Uniforme(0, h)`, con h = 0,05 para precios y h = 0,05 para cantidades. Piso: el precio nunca baja del costo unitario `w/α`.

**La cantidad se ajusta sobre la producción efectiva del mes anterior** `y_{t−1}`, no sobre la producción deseada: `q ← y_{t−1}·(1 ± u)`. En los dos casos en que se ajusta el precio, `q ← y_{t−1}`. Fuente: Dawid, Delli Gatti, Fierro & Poledna (2024), *Implications of Behavioral Rules in Agent-Based Macroeconomics*, CESifo WP 11411, ec. 14 y cuadro 1. Allí la regla de CATS es `Y*_t = (1 + γ)·Y_{t−1}`, con `Y_{t−1}` la producción del período anterior.
- **Historia (defecto corregido el 2026-11-11):** hasta esa fecha el código hacía `q ← q·(1 ± u)` sobre la producción deseada. Una empresa que no podía pagar los salarios para producir lo que quería producía poco, vendía todo y volvía a subir la meta. En la semilla 1, la mediana de trabajadores deseados por empresa pasaba de 17 (mes 12) a 113 (mes 240) y a 25.756 (mes 840). Detalle en [fase1-reglas.md](fase1-reglas.md), "Hallazgo 2".

Lo importante: **ninguna regla dice "si hay emisión, subí precios"**. Solo reaccionan a si vendieron todo o no.

### R2. Salarios

Fuente: regla de ajuste por vacantes de los modelos CATS (Delli Gatti et al., 2011). Rigidez nominal a la baja: Bewley (1999), *Why Wages Don't Fall during a Recession*; Dickens et al. (2007), *How Wages Change*, Journal of Economic Perspectives 21(2).

- Si la empresa **no cubrió sus vacantes** el mes anterior: `w ← w·(1+u)`, con `u ~ U(0; 0,05)`.
- Si las cubrió: el salario no cambia.
- **El salario nominal no baja nunca.** Esto tiene amplio consenso empírico, así que lo propongo como regla fija y no como perilla.
- Un salario por empresa, igual para todos sus trabajadores.
- **Pendiente para fases futuras**: la indexación y la inercia salarial (cuánto se ajustan los salarios a la inflación pasada) es candidata a **perilla de teoría**, porque el peso de la inercia es parte del debate entre explicaciones de la inflación (ver principio 2 de `CLAUDE.md`). En la Fase 0 no hay indexación.

### R3. Demanda de trabajo y despidos

- Trabajadores deseados = `⌈q / α⌉`.
- Si tiene de más, despide al azar a los que sobran.
- Si no le alcanzan los depósitos para pagar la masa salarial, contrata solo hasta lo que puede pagar.
- **Sin crédito ni quiebras en la Fase 0**: sin deuda, una empresa no puede quedar insolvente; en el peor caso se achica a cero empleados y puede volver a contratar. (Crédito, quiebras y entrada de empresas quedan para la Fase 1.) Supuesto: la cantidad deseada nunca baja de `α` (un trabajador), para que una empresa achicada pueda volver a crecer.

### R4. Mercado de trabajo

Fuente: emparejamiento descentralizado con búsqueda sobre un subconjunto de empresas, Riccetti, Russo & Gallegati (2015), *An agent based decentralized matching macroeconomic model*, Journal of Economic Interaction and Coordination 10(2); Delli Gatti et al. (2011).

- Los desempleados, en orden aleatorio, miran `M = 4` empresas al azar entre las que tienen vacantes y se van a la que paga más.
- Aceptan cualquier salario (sin salario de reserva en la Fase 0).
- Los empleados no buscan otro trabajo en la Fase 0.

### R5. Consumo y ahorro de los hogares

Fuente: función de consumo del modelo SIM de Godley & Lavoie (2007), *Monetary Economics*, cap. 3: `C = α1·YD + α2·W`, donde YD es el ingreso disponible y W la riqueza financiera del período anterior.

- Gasto deseado del mes = `α1 · ingreso disponible del mes anterior + α2 · depósitos al inicio del mes`.
- De SIM se toma **solo la forma** de la función. Los valores **no** son los de SIM (que usa α1 = 0,6 y α2 = 0,4 en un período sin duración definida). Acá: **α1 = 0,9 y α2 = 0,05 por mes, supuestos propios a calibrar**. Elegidos para que la riqueza de estado estacionario, `W* = (1 − α1)/α2 · YD`, sea unos 2 meses de ingreso, consistente con las condiciones iniciales.
- El gasto nunca supera los depósitos del hogar.
- La regla es **nominal**: un hogar con más pesos quiere gastar más pesos. La versión "real con expectativas de precios" (Caiani et al., 2016) la dejaría para cuando haya expectativas en el modelo.

### R6. Mercado de bienes

Fuente: búsqueda de mercado del modelo CATS (Delli Gatti et al., 2011).

- Los hogares, en orden aleatorio, miran `Z = 3` empresas al azar y compran primero en la más barata. Si se queda sin stock, pasan a la siguiente.
- Si no consiguen gastar todo lo que querían, el resto queda en sus depósitos (ahorro forzoso). Esa demanda insatisfecha es justamente la señal que hace subir precios en R1.

### R7. Ganancias y dividendos

Fuente: Caiani et al. (2016), *Agent based-stock flow consistent macroeconomics: Towards a benchmark model*, Journal of Economic Dynamics and Control 69.

- Ganancia = ventas − masa salarial.
- Si es positiva, se paga como dividendo al dueño `min(ρ · ganancia, depósitos)`, con ρ = 0,9.
- **Colchón de liquidez: ELIMINADO el 2026-11-11** (decisión de Nico). Era una regla provisoria sin fuente, y su razón de ser era el defecto de R1. Con R1 corregida, el criterio se cumple sin colchón y no hay colapsos. Se conserva abajo la historia.
- *Historia:* **Colchón de liquidez — PROVISORIO** (agregado el 2026-11-10, supuesto explícito sin fuente): la empresa retiene al menos **1 mes de su masa salarial deseada** antes de repartir dividendos. Sin esta regla, el ahorro forzoso de los hogares (por las fricciones de búsqueda) dejaba a las empresas sin capital de trabajo y, sin crédito, no podían contratar aunque vendieran todo. **Revisar cuando entre el crédito bancario en la Fase 1.**
  - *Con el defecto de R1* (hasta el 2026-11-11), la masa salarial deseada crecía sin límite, así que el colchón también. En la semilla 1 no hubo dividendos desde el mes 137: en toda la parte visible de las corridas de la Fase 0, los dueños no cobraron nada.
  - *Después de la corrección de R1* (medido el 2026-11-11, 20 semillas): las empresas reparten dividendos todos los meses. **Con el colchón en 0 el criterio se sigue cumpliendo**: A entre 0,16% y 0,48% anual, B > A en 20/20, desempleo de A en los últimos 10 años entre 2,7% y 6,7%, sin colapsos. O sea, el colchón parece haber sido una consecuencia del defecto. Por eso se eliminó.

### R8. Tesoro y BCRA (las dos perillas)

Fuente: estructura del modelo SIM de Godley & Lavoie (2007, cap. 3), donde el gasto se financia con impuestos y con dinero del banco central.

- **Gasto público** (perilla, pesos por mes, nominal): transferencias iguales a todos los hogares, `⌊G / H⌋` a cada uno.
- **Déficit estructural financiado con emisión** `s` (perilla, `structuralDeficitShare`): la parte de G que los impuestos **no cubren a pleno empleo**. El Tesoro fija `τ = (1 − s)·G / base de pleno empleo`, acotada a [0, 1]. La base de pleno empleo es: todos los hogares cobrando el salario promedio de las empresas, más los dividendos del mes anterior.
  - *Historia*: la versión original usaba la base imponible del mes anterior, y la perilla era "% del gasto financiado con emisión". Con esa regla cualquier nivel de actividad era un equilibrio (los impuestos siempre igualaban `(1 − s)·G`) y la economía se hundía por las fricciones. Con la base de pleno empleo, s = 0 significa presupuesto equilibrado a pleno empleo.
  - *Revisado después de la corrección de R1* (2026-11-11, 20 semillas): **la base de pleno empleo sigue siendo necesaria.** Con la base del mes anterior, A termina con 64% a 67% de desempleo en las 20 semillas (72% si además se saca el colchón de R7).
- **Impuesto proporcional al ingreso** (no de suma fija). La base son salarios y dividendos brutos; las transferencias no pagan. Se **retiene en la fuente**: la empresa le paga al hogar `bruto − ⌊τ·bruto⌋` y le gira la retención al Tesoro. Como el hogar nunca paga el impuesto desde sus depósitos, **no puede quedar con depósitos negativos**. Además, el invariante SFC lo prohíbe (un hogar no puede emitir depósitos) y hay un test que lo verifica en cada tick.
- Lo que falta para pagar el gasto se cubre con **adelantos del BCRA**. Esa es la emisión.
- **El déficit cíclico se emite automáticamente**: por debajo del pleno empleo, la recaudación no llega a `(1 − s)·G` y la diferencia también se cubre con adelantos, porque en la Fase 0 todavía no hay bonos. Por eso, incluso con s = 0 hay algo de emisión en las recesiones (funciona como estabilizador automático). Cuando haya deuda (Fase 2), el déficit cíclico se podrá financiar con bonos.
- Indicador **"emisión efectiva"**: emisión del mes / gasto del mes. Incluye el déficit estructural y el cíclico.
- El gasto es **nominal**: con inflación, el mismo gasto en pesos compra menos. No hay indexación automática.

## Indicadores (aproximación a la metodología INDEC)

- **Índice de precios**: precio promedio de las ventas del mes ponderado por cantidades. Con un solo bien coincide con un Laspeyres. **Inflación** = variación mensual (y anualizada).
- **Desempleo**: desocupados / población activa. En la Fase 0, todos los hogares son activos.
- **Salario real**: salario promedio / índice de precios.
- **Emisión efectiva**: adelantos del BCRA del mes / gasto del mes (ver R8).
- **Pobreza**: porcentaje de hogares con ingreso mensual menor a una **canasta** = cantidad fija del bien × precio del mes. Es la lógica del INDEC (canasta valorizada a precios corrientes), simplificada: un solo bien y sin adulto equivalente. Tamaño de la canasta: provisional, por ejemplo el consumo de un hogar con salario mínimo inicial, hasta tener datos de la EPH.

## Cómo verificar el criterio de salida

Tests en [phase0-criteria.test.ts](../packages/engine/test/phase0-criteria.test.ts). Reporte con la distribución completa: `pnpm --filter @petri/engine report:fase0`.

Corridas de 50 años visibles (600 meses, después del calentamiento), 20 semillas, tendencia = pendiente de ln(P) por mínimos cuadrados desde el mes 0, anualizada. Gasto G = 50.000 pesos/mes en las dos cápsulas.

1. **Línea de base**: con `s = 0`, la tendencia anual de precios es menor a 1% en todas las semillas.
2. **A/B**: B (`s = 0,5`) tiene más inflación que A (`s = 0`) **en todas las semillas**.
3. **Cordura** (no es un objetivo): ninguna cápsula deja de producir y el desempleo promedio de los últimos 10 años es menor a 50%. El pleno empleo **no** es criterio.
4. **Determinismo**: misma semilla + mismo log = misma corrida, exacta (también con las reglas del modelo).
5. **Invariante SFC** en cada tick, y ningún hogar con depósitos negativos.

### Resultados vigentes (2026-11-11: R1 corregida, sin colchón en R7, calentamiento de 420 meses)

| | A (s = 0) | B (s = 0,5) |
|---|---|---|
| Inflación anual: mín · mediana · máx | 0,18% · 0,33% · 0,55% | 1,46% · 2,02% · 2,31% |
| Emisión acumulada / gasto (mediana) | 3,1% | 52,8% |
| Desempleo, últimos 10 años | 2,5% a 6,7% | 2,4% a 11,5% |

Se cumple el criterio: la línea de base es menor a 1% y B supera a A en las 20 semillas. La brecha del calentamiento contra el régimen es de 0,10 pp en desempleo y de 0,021 en margen.

### Resultados con 360 meses de calentamiento (registro)

| | A (s = 0) | B (s = 0,5) |
|---|---|---|
| Inflación anual: mín · mediana · máx | 0,20% · 0,35% · 0,53% | 1,68% · 1,99% · 2,38% |
| Emisión acumulada / gasto (mediana) | 3,1% | 53,2% |
| Desempleo, últimos 10 años | 2,2% a 6,5% | 2,6% a 11,9% |
| Margen precio / costo unitario (promedio) | ~1,78 | |

Se cumple el criterio: la línea de base es menor a 1% y B supera a A en las 20 semillas, sin superposición. La correlación entre semillas en A (emisión acumulada contra tendencia de precios) baja a 0,20.

### Resultados con R1 corregida, todavía con colchón y 240 meses (registro)

| | A (s = 0) | B (s = 0,5) |
|---|---|---|
| Inflación anual: mín · mediana · máx | 0,21% · 0,38% · 0,55% | 1,87% · 2,22% · 2,83% |
| Emisión acumulada / gasto (mediana) | 3,0% | 52,7% |
| Desempleo, últimos 10 años | 1,7% a 7,2% | 2,3% a 9,7% |
| Margen precio / costo unitario (promedio) | ~1,7 | |

- **Se cumple el criterio**: la línea de base es menor a 1% y B supera a A en las 20 semillas. Las distribuciones no se superponen.
- **El margen precio/costo pasa de ~1,19 a ~1,7.** Al no poder agrandar la meta sin límite, las empresas que venden todo con precio bajo el promedio suben el precio en vez de la cantidad, y el margen se estabiliza más arriba.
- **El calentamiento de 240 meses no alcanza del todo** (ver "Calentamiento").

### Resultados antes de la corrección de R1 (2026-11-10, calentamiento de 240 meses)

Se conservan como registro histórico; las corridas tenían el defecto de R1.

| | A (s = 0) | B (s = 0,5) |
|---|---|---|
| Inflación anual: mín · mediana · máx | 0,31% · 0,56% · 0,70% | 3,32% · 3,49% · 3,57% |
| Emisión acumulada / gasto (mediana) | 3,1% | 48,7% |
| Desempleo, últimos 10 años | 3,3% a 7,3% | 1,8% a 4,1% |

Las distribuciones no se superponen: B supera a A en las 20 semillas.

**De dónde sale la deriva de A**: de la emisión cíclica. Evidencia:
- En A, el dinero privado crece entre 1,21 y 1,45 veces en los 50 años, y los precios entre 1,21 y 1,40 veces. Entre semillas, la emisión acumulada y la tendencia de precios se correlacionan (0,58), y el crecimiento del dinero con el de los precios (0,70).
- Contrafáctico de diagnóstico con G = 0 (no hay emisión de ningún tipo; corrido antes de agregar el calentamiento, midiendo desde el mes 120): el dinero queda constante y la tendencia de precios queda entre −0,08% y +0,05% anual en las 20 semillas. Ese escenario, sin estabilizador, termina con 56% a 69% de desempleo.
  - **Corrección (2026-11-11):** ese número es el de **G = 0 desde la creación**. Si se pasa a G = 0 después del calentamiento, la economía no colapsa: 11% de desempleo con el defecto de R1, y entre 6% y 12% después de corregirlo. Después de la corrección, G = 0 desde la creación lleva al **100%** de desempleo: las empresas se quedan sin depósitos para pagar un solo salario y, sin crédito, nada las saca de ahí. Ver [fase1-reglas.md](fase1-reglas.md), paso 1a.0.

## Limitaciones conocidas

Anotadas el 2026-11-11.

1. **El desempleo mensual oscila mucho en régimen estable.** Después del calentamiento, sin tendencia, el desempleo de un mes a otro va de 0% a ~12%. Ejemplo: semilla 20260101, últimos 24 meses del calentamiento, media 5%.
2. **La inflación medida en ventanas de 5 años es muy ruidosa en régimen estable.** En una corrida de B (s = 0,5), las ventanas de 5 años van de ~0,3% a ~6,2% anual, con mediana ~3,1%, aunque la tendencia de largo plazo es ~3,2–3,5%. La interanual mes a mes es todavía más ruidosa.

**Hipótesis**: el tamaño chico de la cápsula (30 empresas, 500 hogares). Con 30 empresas, que una sola contrate o despida mueve el desempleo agregado varios puntos, y las decisiones de precio y cantidad (R1) son sorteos que no llegan a promediarse. **No está verificada.** Queda como parte del criterio de salida de la Fase 1 (ver `CLAUDE.md`).

**Verificada en parte (2026-11-11, paso 1a.1 de la Fase 1):** el ruido mes a mes (limitación 1) cae como 1/√N con más agentes. La dispersión de la inflación en ventanas de 5 años (limitación 2) **no** baja con el tamaño: son ciclos agregados del modelo. Detalle en [fase1-reglas.md](fase1-reglas.md).

Mientras tanto, para comparar cápsulas conviene mirar la tendencia de largo plazo o los gráficos, no un mes suelto.

## Decisiones tomadas

1. Gasto público = **transferencias iguales a todos los hogares** (plan universal).
2. La parte no emitida se financia con **impuestos** (SIM). La emisión es el déficit (estructural + cíclico).
3. **Crédito, quiebras y entrada de empresas quedan para la Fase 1.**
4. R7 con colchón de liquidez (provisorio) y R8 con base de pleno empleo, aprobados el 2026-11-10. **El colchón se eliminó el 2026-11-11** (era consecuencia del defecto de R1).
6. **R1 corregida** el 2026-11-11: la cantidad se ajusta sobre la producción efectiva del mes anterior. Calentamiento llevado a **420 meses**, con un test por promedios de 5 años.
5. Calentamiento de 240 meses antes del mes 0 visible, aprobado el 2026-11-10. El archivo de corrida pasa a la versión 2 (`config.burnInTicks` y `config.burnInKnobs`); los archivos v1 se rechazan porque su hash ya no se puede verificar.

## Inflación en la interfaz

El panel muestra la **interanual** (P_t / P_t−12 − 1, como la informa el INDEC) y el **promedio anual de los últimos 5 años** (geométrico, (P_t / P_t−60)^(1/5) − 1). Los dos se calculan en la vista, no en el motor. Las dos medidas son ruidosas: en una corrida típica de B (s = 0,5), las ventanas de 5 años van de ~0,3% a ~6%, con mediana ~3%. Para comparar A y B, sirve más la tendencia de largo plazo o el gráfico.
