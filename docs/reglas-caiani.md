# Reglas del port de Caiani (P3)

Estado al 2026-11-13: **infraestructura de V3 por evento lista; eventos 0 a 15 portados y verificados en los ticks 1 y 50 (bit a bit en los `double` puros; montos con la regla general de tolerancia, sec. 1, todos ≤ 2 µ desde el redondeo con arrastre); contador de decisiones discretas en el V3.** Para retomar en una sesión nueva, ver la sec. 15. Plan general en [plan-port-caiani.md](plan-port-caiani.md) (sec. 4 y 7). Código: `packages/engine/src/caiani/events.ts` (eventos), `state.ts` (estado), `params.ts` (`RULES`); tests en `packages/engine/test/caiani-events.test.ts`, arnés en `test/support/jmab-dump.ts`.

Todo lo que se afirma sobre JMAB sale de `reference/jmab-2015/src` (fuente equivalente al `.jar`, V0), de `paper-launcher/Model/modelFile.xml` y de los volcados del oráculo.

## 1. Método

**Unidad: el evento.** El tick de JMAB es una lista de eventos (`modelFile.xml`, propiedad `events`, desde la línea 43). En cada evento, los agentes que lo tienen en `activeTicEvents` ejecutan su `onTicArrived`. El port tiene una función por evento, en el mismo orden.

**V3 por evento:**
1. El oráculo vuelca el estado al principio del tick t (`DUMP_TICKS=t`) y después del evento e (`DUMP_EVENTS="t:e"`).
2. El port reconstruye su estado desde el volcado "antes" (`stateFromDump`), corre el evento con el `Rng` en modo oráculo (los sorteos del evento: `draws.tsv` ahora trae el índice del evento en la sexta columna) y se compara con el volcado "después" (`compareState`).
3. Comparar los dos volcados de JMAB entre sí dice exactamente **qué estado toca el evento**. Eso define qué campos agregar al estado del port.

**Reconstrucción del estado** (`stateFromDump`): los contratos se emparejan por `@oid` (el oráculo numera cada ítem dentro de un volcado; el mismo objeto está en la lista del tenedor y en la del emisor), y cada lista conserva el orden de JMAB. Verificado: el estado reconstruido del tick 1 coincide con su volcado sin ninguna diferencia.

**Orden de despacho.** Dentro de un evento, JMAB llama a los agentes en **orden de creación** (el de suscripción al planificador), no en el de la lista de la población (que las mezclas reordenan). Verificado en los eventos 1 y 2: el paso |N| de cada empresa, despejado de su margen antes y después, coincide a 10⁻¹³ con el registrado en esa posición de la secuencia. Importa porque el oráculo registra las normales sin el id del agente: el port las tiene que pedir en el mismo orden. Los arreglos del estado del port (`households`, `consumptionFirms`, etc.) están en orden de creación.

**Tolerancias** (plan, sec. 4, V3). Los `double` calculados a partir de montos, 10⁻⁶ relativo; los demás `double`, 10⁻⁹ (sin cambios). Los montos siguen una **regla general**, igual para todos los campos (pedido de Nico, 2026-11-13; reemplaza las tolerancias que se habían ido agregando campo por campo en los eventos 8 a 10):

- **Evento suelto** (arranca del volcado de JMAB): **2 µ**. Es la verificación estricta. Un monto que el port calcula redondeando una vez un `double` de JMAB difiere en a lo sumo ~1,5 µ: hasta 0,5 µ por pasar la entrada a µ, 0,5 µ por redondear el resultado y 0,5 µ por pasar a µ el valor de JMAB para comparar.
- **Encadenado** (desde el principio del tick, sin volver a cargar el estado de JMAB): **2 µ por evento corrido**, o sea 2·k µ después de k eventos. Se compara después de **cada** evento, no solo al final. Supuesto de la regla: cada evento agrega como mucho su error estricto a los montos que escribe, y lo que hace con los montos que recibe (sumas y restas de pocos términos, productos por tasas, participaciones o (1 − i/100)) no amplifica el error. Un campo que deriva más rápido indica una amplificación (por ejemplo, una suma sobre muchos montos) o un error del port: se reporta.
- **Sin casos por campo.** Si un campo no cumple la regla, no se agranda su tolerancia: se reporta (abajo) y se decide qué hacer con él.

Implementación: `V3_AMOUNT_TOL` y `chainedAmountTol(k)` en `test/support/jmab-dump.ts`; `compareState` recibe la tolerancia y devuelve, por tipo de campo, la diferencia máxima y cuántos la superan, que el test imprime en cada corrida.

**Medición con la regla (eventos 0–10, ticks 1 y 50; los eventos 11–14 no mueven montos y dan diferencia 0).** Contratos (depósitos, préstamos), intereses de cada depositante y préstamos nuevos: ≤ 1 µ en el suelto; en el encadenado, hasta 2 µ (tick 1) y 4 µ (tick 50) después del evento 10, contra una tolerancia de 22 µ. Antes, los préstamos nuevos del encadenado tenían una tolerancia propia (3 µ por préstamo de la empresa más 2).

**Campos que no cumplían la regla (2026-11-13), resueltos con el redondeo con arrastre.** Con el primer arnés de la regla, cuatro campos la superaban en el evento suelto: `totInterestsDeposits` (evento 8: 33 y 11 µ en los ticks 1 y 50), `debtBurden` (evento 9: 3 y 6 µ), `debtInterests` (3 µ) y `creditDemanded` (5 µ). Causa común: el port **sumaba montos ya redondeados a µ** (un interés por depósito, una cuota por préstamo) y JMAB **suma los `double`**; con n términos la diferencia llega a n/2 µ. No es deriva: aparecía igual en el evento suelto. El test los reportaba en `REPORTED_AMOUNT_FIELDS` sin tolerarlos (hoy esa lista está vacía y queda como mecanismo para casos futuros).

**Redondeo con arrastre (decisión de Nico, 2026-11-13).** Cuando un agente recorre una lista de montos que JMAB acumula en `double`, cada monto se redondea como m_i = round(S_i) − round(S_{i−1}), con S_i la suma acumulada en `double` (`CarryRounder`, `money.ts`). Cada monto queda a < 1 µ de su `double` y la suma de cualquier tramo seguido de la lista, a ≤ 1 µ de la suma de JMAB; el agregado sigue siendo la suma de lo acreditado o pagado (consistencia SFC). Aplicado en el evento 8 (intereses de los depósitos de cada banco) y en las cuotas de los préstamos (`installments`: eventos 9 y 20; cambio de la decisión 3 de P1, ver [ledger-contratos.md](ledger-contratos.md), sec. 4). **Resultado en los ticks 1 y 50:** todos los montos ≤ 2 µ en el suelto y en el encadenado (`totInterestsDeposits` ≤ 1 µ, `debtBurden` ≤ 1 µ, `creditDemanded` ≤ 2 µ, préstamos y depósitos ≤ 2 µ).

**Reservas y cuentas con muchos pagadores (propuesta para antes del primer evento con pagos entre agentes, el 18; a decidir por Nico).**

*El problema.* El arrastre resuelve las cuentas que pagan (o cobran) un tramo seguido de una lista: el depósito de la empresa que paga 50 salarios, el total de intereses de un banco. No resuelve las cuentas que reciben montos **intercalados** de muchos pagadores. Un pago de P (banco a) a Q (banco b) mueve cuatro cuentas: el depósito de P, el de Q y, si a ≠ b, las reservas de a y de b. Cada monto es entero y las reservas se mueven exactamente por el monto, así que el error de las reservas de un banco es la suma de los errores de redondeo de todos los pagos entre bancos que lo tocan. Con el arrastre por pagador, esos errores no se cancelan: con ~600 pagos que entran a un banco en un evento de salarios, ~0,3·√600 ≈ 7 µ típico. Lo mismo para el depósito de una empresa de consumo que cobra a cientos de hogares (cada uno con su propio arrastre) y para la cuenta del gobierno con los impuestos.

*Por qué no alcanza con otro orden de arrastre.* Hay que acotar a la vez cuatro familias de sumas: lo que paga cada pagador, lo que cobra cada cobrador, lo que sale de cada banco y lo que entra a cada banco. Un arrastre sobre una sola lista acota una sola familia.

*Propuesta: redondeo controlado por evento.* En cada evento con pagos:
1. **Fase en `double`:** el evento corre como en JMAB, con los montos en `double`. Las decisiones que dependen de saldos dentro del evento (pagar hasta lo que alcanza, la quiebra si no llega a pagar) usan el saldo en µ más los pagos pendientes en `double`, como JMAB.
2. **Redondeo conjunto** al cerrar el evento: se buscan montos enteros m_i a < 1 µ de cada x_i tales que, para cada pagador, cada cobrador, cada banco de los pagadores y cada banco de los cobradores, la suma redondeada quede a < 1 µ de la suma en `double`. Existe siempre: las familias "pagador ⊂ banco del pagador" y "cobrador ⊂ banco del cobrador" son dos familias laminares, y la matriz de incidencia de la unión de dos familias laminares es totalmente unimodular (redondeo controlado de una tabla de doble entrada: Bacharach, 1966; Cox y Ernst, 1982). Se calcula como un flujo entero con cotas piso y techo en una red fuente → bancos de pagadores → pagadores → pagos → cobradores → bancos de cobradores → sumidero (algoritmo determinista, con el orden de JMAB para desempatar).
3. **Se registran** los flujos enteros en el ledger, en el orden de JMAB.

*Qué garantiza.* Cada depósito queda a < 1 µ de lo que pagó o cobró en el evento. Las reservas de un banco cambian en (lo que entró a sus clientes) − (lo que salió de sus clientes); los pagos dentro del mismo banco se cancelan; los dos términos son sumas de las familias, así que el cambio queda a < 2 µ. La cuenta del gobierno es un "banco" más (el BC). Un monto que ya es entero (la transferencia de un saldo entero, al cambiar de banco) queda exacto, y un pagador no puede gastar más de lo que tiene: si la suma en `double` es igual a su saldo, la redondeada también. Todo cumple la regla de 2 µ del evento suelto sin tolerancias por campo; en el encadenado vale la deriva de 2 µ por evento.

*Costos y riesgos.*
- Hay que reorganizar los eventos de pagos en dos fases (un buffer de pagos pendientes en el ledger). Es más trabajo que el arrastre simple, pero es una pieza única que usan todos los eventos de pagos (18, 19, 20, 21, 22, 24, 25, 27 y los de bonos y reservas).
- Costo: un flujo máximo por evento sobre ~10⁴ aristas (el evento de consumo, el más grande), despreciable frente a lo que ya cuesta el evento.
- El arrastre por lista queda como caso particular (un solo pagador) y se puede seguir usando donde no hay pagos entre bancos (intereses de depósitos, cuotas).

*Alternativas descartadas.* (a) Arrastre por par de bancos: acota las reservas pero deja sin acotar los depósitos de los pagadores. (b) Comparar las reservas descontando el residuo de redondeo que registra el ledger: es estricto con la lógica, pero lo que se calcula después a partir de las reservas (adelantos, ratio de liquidez) heredaría el residuo y habría que propagarlo. (c) Una tolerancia por cantidad de pagos que tocaron la cuenta: es lo que se quiere evitar.


**Decisiones discretas (contador de V3, 2026-11-13, pedido de Nico).** Módulo `caiani/decisions.ts`, test a mano en `test/caiani-decisions.test.ts`.
- Cada comparación que define una rama en un evento pasa por un helper (`gt`, `ge`, `lt`, `record`, `rounding`) que devuelve lo mismo que la comparación sola. Con un registrador activo (`withDecisions(rec, evento, fn)`) anota, por evento y por lugar, la **distancia al umbral** en la escala de la tolerancia del valor comparado (µ absolutos para montos; relativa para los `double`, a la escala de los operandos o de los términos de los que sale el valor) y el resultado. Si la distancia es ≤ la tolerancia, la decisión es **frágil**: una diferencia que V3 admite alcanzaría para darla vuelta. El registro solo observa: sin registrador, los helpers no hacen nada más que comparar.
- **Decisiones dadas vuelta:** el V3 corre cada evento suelto (desde el volcado de JMAB, o sea con las entradas de JMAB) y encadenado desde el principio del tick, los dos con registrador; `compareOutcomes` lista las comparaciones con otro resultado en la misma posición. Una que se da vuelta hoy igual hace fallar la comparación de estado aguas abajo; el contador dice dónde empezó.
- **Qué no se registra:** comparaciones entre enteros exactos (edades, plazos, cantidades de la lista), banderas de actividad que vienen de otro evento (se registran donde se deciden), y la comparación del atractivo del proveedor previo cuando el previo **es** el mejor (es el mismo cálculo dos veces, no puede darse vuelta). El piso de la producción deseada (`max(0, …)`) se mide contra la escala de los términos de la resta, no contra el resultado.
- **Qué no se registra (evento 15):** la comparación "trabajadores de la añada < restantes" de `ConsumptionFirm.produce`. En el umbral las dos ramas dan la misma producción (la función es continua), así que un vuelco no cambia el resultado más allá de la diferencia que lo provocó. Antes de sacarla daba 100 empates exactos en el tick 1 (50 trabajadores = 16 añadas × 3,125) y 2 en el 50.
- **Qué no se registra (eventos 11–14):** la referencia micro del salario (vale k/4 exacto, sec. 12) y `laborDemand` contra los empleados (enteros).
- **`rounding` (corregido el 2026-11-13):** la distancia de x a k + 0,5 se mide relativa a max(|x|, |k + 0,5|); antes era relativa a |x|, y un 0 exacto (la I+D nula del evento 12) contaba como frágil con distancia 0.
- **Resultado en los ticks 1 y 50 (eventos 0–14):** ninguna decisión se da vuelta. Frágiles:

  | Evento | Tick 1 | Tick 50 |
  |---|---|---|
  | 0 | 0 de 150 | 0 de 150 |
  | 1 | **20 de 60**: inventario / ventas = 10/100 = 0,1, exactamente el umbral (empate exacto; `>` es falso y el margen sube) | 0 de 60 |
  | 2 | **100 de 2.400**: inventario / ventas a 2,4·10⁻¹⁰ del umbral (32 / 320,0000000776…) | 0 de 2.586 |
  | 3, 4 | sin comparaciones numéricas | ídem |
  | 5 | 0 de 2.882 | 0 de 3.063 |
  | 6 | **10 de 40**: ratio de capital a ~10⁻¹⁵ del promedio (sec. 8) | 0 de 40 |
  | 7 | **10 de 30**: ratio de liquidez en el promedio (distancia mínima 0) | 0 de 30 |
  | 8 | sin comparaciones | ídem |
  | 9 | 0 de 2.426 | 0 de 2.426 |
  | 10 | 0 de 785 | 0 de 12.641 (rendimiento esperado a 1,1·10⁻⁴ relativo del 0 como mínimo) |
  | 11 | **6.000 de 8.000**: el desempleo agregado inicial es 0,08, exactamente el umbral (empate exacto; `>` es falso y el salario de los 6.000 ocupados sube) | 0 de 7.772 (distancia mínima 0,29) |
  | 12 | 0 de 2.140 | 0 de 2.326 |
  | 13 | sin comparaciones numéricas | ídem |
  | 14 | 0 de 3.600 (salario más barato; distancia mínima 1,2·10⁻⁶) | 0 de 5.250 (6,8·10⁻⁶) |
  | 15 | 0 de 2.000 | 0 de 2.186 |

  Las frágiles del tick 1 vienen de que la inicialización deja a todas las empresas y bancos de cada tipo iguales y justo en los umbrales (y el desempleo justo en el 8% del umbral de los salarios). En el tick 50 la distancia más chica es 1,8·10⁻⁴ (redondeo de los trabajadores requeridos).

**Ticks de referencia del V3 (Nico, 2026-11-13).** Como el tick 1 tiene decisiones frágiles por la simetría de la inicialización, **las verificaciones V3 de referencia son las que arrancan en los ticks 50, 200 y 399**. El tick 1 es el **caso límite**: se sigue corriendo y se informa, pero una decisión frágil que se dé vuelta ahí no se lee como un error del port sin mirarla primero en los ticks de referencia.

**Corridas de referencia** (semilla 12345; el test `caiani-events.test.ts` las recorre con `describe.each`):
- `DUMP_TICKS=1 DUMP_EVENTS="1:0,1:1,…,1:14" reference/tools/run-oracle.sh p3-t1 12345 1 -1 999999`
- `DUMP_TICKS=50 DUMP_EVENTS="50:0,50:1,…,50:14" reference/tools/run-oracle.sh p3-t50 12345 50 50 50`

(`DUMP_EVENTS` es la lista completa `t:0` a `t:14`; se puede armar con `seq 0 14 | sed 's/^/1:/' | paste -sd, -`.) Se volvieron a correr el 2026-11-13 con los volcados de los eventos 0 a 14: los de los eventos 11–14 ya están para cuando se porten.

Se pueden correr las dos a la vez (directorios distintos); tardan ~1 y ~4 minutos.

**Estructura del test (2026-11-13).** Un `it` por evento, suelto y encadenado (el encadenado comparte el estado entre tests, en orden), y uno final con las decisiones. Después de cada test se cede una macrotarea (`afterEach` con `setImmediate`): entre tests vitest solo espera microtareas y, sin eso, el worker no atiende su RPC durante todo el archivo; con los eventos 11–14 el archivo pasa el minuto y vitest informaba "Timeout calling onTaskUpdate" (un error que hace fallar la corrida aunque los tests pasen).

Al portar un evento nuevo e: agregar `t:e` a `DUMP_EVENTS` de las dos corridas y volver a correrlas (~1 y ~3 minutos). Después de portar el tick entero: V3 completo desde t = 1, 50, 200 y 399. El tick 1 es muy simétrico (todas las empresas iguales): el 50 es el que ejercita las ramas.

**No finitos en los volcados:** el oráculo escribe NaN e infinitos como cadenas (`"Infinity"`, de `Double.toString`); `readDump` los convierte a number al leer (desde el evento 6, que deja `totalLoanSupply` = +∞).

**Herramienta auxiliar** (fuera del repo, a recrear si hace falta): un diff de dos volcados que lista, por población, qué campos cambian, cuántos agentes y un ejemplo, y si cambia el orden de las poblaciones o de los mercados (comparando sin los `@oid`, que se renumeran en cada volcado). Con eso se ve qué estado toca un evento antes de leer el código.

**Registro de los mezcladores (cambio del oráculo, 2026-11-13).** Los mezcladores `BrochureSelectionRandomRobinBuyerMixer` y `SelectionRandomRobinBuyerMixer` mezclan **en el lugar** la lista de vendedores una vez por comprador (`sellers.shuffle(prng)`), y esa lista persiste: es la de la población (mercado de capital) o la propia del mercado (consumo, crédito, trabajo, depósitos), y la mezcla siguiente arranca de ese orden. Antes el oráculo registraba solo los vendedores elegidos (`sample`), con lo que el port no podía reconstruir el orden de la lista. Ahora registra la mezcla completa (`shuffle sellers:…`) y ya no emite `sample` desde los mezcladores (`reference/p0/oracle/src/jmab/mixing/*.java`, marcado `P3`; recompilado con `build-oracle.sh`). El port hace lo mismo que JMAB en los dos modos: mezcla y toma los primeros `nbSellers` activos (`selectSellers` en `events.ts`). No cambia el generador (solo lo que se escribe). Costo: en los mercados de trabajo y consumo el registro de un tick crece varios MB.

**Ids en las mezclas de los eventos.** Los eventos piden las mezclas con ids del port; `OracleCaianiRng` recibe `agentId` (id del port → id de JMAB) y lo aplica antes de comparar con el registro. `initialize` sigue pasando un `idOf` con ids de JMAB y no fija `agentId`.

## 2. Mapa del tick (eventos de comportamiento)

Índices de la lista `events`. Los 39–134 son reportes (no modifican el estado; a confirmar con los volcados). Sorteos por evento en el tick 1 (semilla 12345) entre paréntesis.

| # | Evento | Estado |
|---|---|---|
| 0 | `computeExpectationsTic`: expectativas, producción deseada, ratios de los bancos, ganancias del BC | **portado, V3 ✓** |
| 1 | `capitalPriceTic`: precio de las empresas de capital (20 normales) | **portado, V3 ✓** |
| 2 | `consumptionPriceTic`: precio de las empresas de consumo (100) | **portado, V3 ✓** |
| 3 | `capitalMarketTic1`: primera etapa del mercado de capital (101 mezclas) | **portado, V3 ✓** |
| 4 | `rdDecisionTic` (I+D, apagada en el base) | **portado, V3 ✓** |
| 5 | `investmentDemandTic` (sin sorteos en los ticks 1 y 50) | **portado, V3 ✓** |
| 6 | `creditSupplyTic` (10) | **portado, V3 ✓** |
| 7 | `depSupplyTic` (10) | **portado, V3 ✓** |
| 8 | `depInterestTic` | **portado, V3 ✓** |
| 9 | `creditDemandTic` | **portado, V3 ✓** |
| 10 | `creditMarketTic` (201) | **portado, V3 ✓** |
| 11 | `laborSupplyTic` (8.000) | **portado, V3 ✓** |
| 12 | `laborDemandTic` (120) | **portado, V3 ✓** |
| 13 | `governmentLaborTic` (1) | **portado, V3 ✓** |
| 14 | `laborMarketTic` (768) | **portado, V3 ✓** |
| 15 | `productionTic` | **portado, V3 ✓** |
| 16 | `rdOutcomeTic` | |
| 17 | `consumptionDemandTic` | |
| 18 | `consumptionMarketTic` (14.675) | |
| 19 | `capitalMarketTic2` (1) | |
| 20 | `creditInterestsTic` | |
| 21 | `payWageTic` (121) | |
| 22 | `bondInterestTic` | |
| 23 | `advInterestTic` | |
| 24 | `taxesTic` | |
| 25 | `dividendsTic` | |
| 26 | `depDemandTic` | |
| 27 | `depMarketTic` (13.998) | |
| 28 | `bankruptcyTic` | |
| 29–37 | bonos y reservas (`bondSupplyTic` … `reservesMarketBaselTic`) (30: 1; 35: 1) | |
| 135 | `populationHandlerTic` | |
| 136 | `updateExpectationsTic` (incluye `cleanSM`) | |

## 3. Evento 0: `computeExpectationsTic`

Lo escuchan las empresas, los hogares, los bancos y el BC (el gobierno no). No hay sorteos ni interacción entre agentes.

| Agente | JMAB | Port (`computeExpectationsEvent`) |
|---|---|---|
| Empresa de capital | `CopyOfCapitalFirm2WagesEnd.onTicArrived` 60–65: `bailoutCost = 0`, `defaulted = false`, `computeExpectations()`, `determineOutput()` | igual |
| | `CapitalFirm.determineOutput` 550–560: Y* con la estrategia; activa en el mercado de capital (`MKT_CAPGOOD`) si inventario + ⌊Y*⌋ > 0 | igual; el inventario es el primer bien de capital |
| Empresa de consumo | `CopyOfConsumptionFirm2WagesEnd.onTicArrived` 63–68, `ConsumptionFirm.determineOutput` 250–255: igual, y la activa siempre en el mercado de capital (como compradora) | igual |
| Producción deseada | `TargetExpectedInventoriesOutputStrategy.computeOutput` 47: Y* = max(0, Sᵉ + (0,1·Sᵉ − inventario)), Sᵉ = expectativa de ventas reales; `inventoryShare` = 0,1 (XML 1800 y 2094) | `targetOutput` |
| Expectativas | `SimpleAbstractAgent.computeExpectations` 535: `updateExpectation` de cada una; `SimpleAdaptiveExpectation.updateExpectation` 128: λ·obs + (1 − λ)·exp | igual (bit a bit) |
| Hogar | `Households.onTicArrived` 183–185: `computeExpectations()` | igual |
| Banco | `Bank.onTicArrived` 167–194: `bailoutCost = 0`, morosidad del tick = 0, `defaulted = false`, expectativas; `liquidityRatio` = reservas / depósitos (0 si no hay depósitos); `capitalRatio` = patrimonio del período anterior (`getPassedValue(LAG_NETWEALTH, 1)`) / préstamos | igual, con sumas en µ. Sin préstamos, como JMAB, da Infinity |
| BC | `CentralBank.onTicArrived` 136–152: `interestsOnAdvances` = suma de adelantos × 0,005 (`advancesInterestRate`, XML 2966); `interestsOnBonds` = **primer** bono × su tasa; activo en adelantos | igual, montos en µ |

**Rezagos:** `TreeMapPassedValues` guarda las últimas 4 observaciones (`LAG_DEPTH`); `getObservation` de un período que no está tira una excepción en Java. `getLag` del port hace lo mismo, y `setLag` reproduce la eviction de `addObservation` (saca la más vieja si ya hay 4, aunque el período nuevo ya estuviera).

**Verificación:**
- A mano: Y* de una empresa de consumo al inicio (320,0000000854072, el valor de JMAB) y casos de borde; ratio de liquidez del banco 0 y ganancias del BC (28.564 × 0,0025 = 71,41) sobre el estado inicial del port.
- V3, tick 1: 37.364 contratos, 2.120 bienes, 25.481 rezagos, 8.370 expectativas, banderas de mercado y campos nuevos. `double` puros: diferencia 0. Ratios de los bancos (salen de montos): 2,6·10⁻⁸. Montos: 0 µ.

## 4. Eventos 1 y 2: precios (`capitalPriceTic`, `consumptionPriceTic`)

**Qué cambia en JMAB** (diff de volcados, tick 1): el margen de la estrategia de precios, `expectedVariableCosts`, el precio del inventario y el rezago `LAG_PRICE` del período. Nada más (el valor contable del inventario no se recalcula: `setPrice` no llama a `updateValue`). Evento 1: las 20 empresas de capital; evento 2: las 100 de consumo. Un sorteo `fn` por empresa, en orden de creación.

| Qué | JMAB | Port |
|---|---|---|
| Disparo | `CopyOfCapitalFirm2WagesEnd.onTicArrived` 66–67 → `CapitalFirm.computePrice` 565–574; `CopyOfConsumptionFirm2WagesEnd` 69–70 → `ConsumptionFirm.computePrice` 683–690: precio de la estrategia en el inventario y `addValue(LAG_PRICE, precio)` | `capitalPriceEvent`, `consumptionPriceEvent` |
| Sin inventario | crea un bien temporal, pero la estrategia ya habría fallado en `getPrice()` (NullPointerException) | error explícito |
| Referencia | `getReferenceVariableForPrice` (capital 822–826, consumo 889–893): inventario / ventas reales del período anterior (`getPassedValue(LAG_REALSALES, 1)`) | igual |
| Margen | `AdaptiveMarkUpOnAC.computePrice`: piso anterior = precio / (1 + μ); si referencia > 0,1, μ −= 1·μ·\|N(0; 0,0094)\|; si no, μ += 1·μ·\|N\| (XML 1864–1870 y 2161–2168; `foldedNormal1`, 2980–2984). Márgenes iniciales: 0,075 (capital) y 0,318857 (consumo) | `adaptiveMarkUpPrice`; los márgenes iniciales los pone `initialize` |
| Precio | piso·(1 + μ), o piso anterior·(1 + μ) si el piso es 0; nunca por debajo del piso | igual |
| Piso, capital | `CapitalFirm.getPriceLowerBound` 810–814: salario esperado / `laborProductivity` (= 2, XML 1546); lo guarda en `expectedVariableCosts` | igual |
| Piso, consumo | `ConsumptionFirm.getPriceLowerBound` 826–881: si Y* > 0, salario esperado × `getRequiredWorkers()` / Y*; si no, salario esperado × trabajadores para el inventario / inventario (0/0 = NaN con inventario 0, como en 2015) | `consumptionLowerBound` |
| Trabajadores requeridos | `ConsumptionFirm.getRequiredWorkers` 267–297: añadas ordenadas por productividad (de mayor a menor; a igual productividad, en el orden de la lista; `TreeMap.descendingKeySet`), cantidad / (capital/trabajo) por añada usada; `(int) Math.round` | `requiredWorkers` (sin redondear) + `Math.round` donde JMAB redondea |

**Detalle:** `getPriceLowerBound` se llama hasta tres veces dentro de `computePrice`, pero solo lee estado y escribe `expectedVariableCosts` con el mismo valor: el port la llama una vez.

**Verificación:**
- A mano: margen que baja y que sube, piso 0 (usa el piso anterior), trabajadores requeridos con dos productividades, piso de la empresa de consumo al inicio (0,7812499997914863, el valor de JMAB), piso sin producción deseada (incluido el NaN).
- V3, ticks 1 y 50, cada evento desde el volcado anterior y los tres encadenados desde el principio del tick: **diferencia 0** en todo lo que toca el evento (márgenes, precios, pisos, rezagos). En el tick 50 se ejercitan las dos ramas del margen (capital: 4 bajan, 16 suben; consumo: 46 y 54). La rama sin producción deseada no aparece en ninguno de los dos ticks: la cubre solo el caso a mano.

## 5. Evento 3: primera etapa del mercado de capital (`capitalMarketTic1`)

**Qué cambia en JMAB** (diff de volcados, tick 1): el orden de las poblaciones de empresas de capital y de consumo, y `selectedCapitalGoodSuppliers` de las 100 empresas de consumo. Nada más. Ningún agente tiene este evento en `activeTicEvents`: actúa solo el mercado.

| Qué | JMAB | Port (`capitalMarketFirstStepEvent`) |
|---|---|---|
| Disparo | `AbstractTwoStepMarketSimulation.eventOccurred`: fija el mercado activo (`MKT_CAPGOOD`; queda así para los eventos siguientes hasta otro evento de mercado) → `BrochureMarket.firstStep` → `BrochureSelectionRandomRobinBuyerMixer.invokeFirstInteractions` | igual |
| Listas | `capitalMarketPopulation` (XML 238–243): las listas **de las poblaciones** (el `BrochureMarket` no tiene lista propia), así que las mezclas reordenan las poblaciones | `s.populations.consumptionFirms` y `capitalFirms`, en el lugar |
| Compradores | se mezclan una vez; **no** se filtran por activos | igual |
| Vendedores | por cada comprador: se mezcla la lista y se toman los primeros `nbSellers` = 5 (XML 255) activos en `MKT_CAPGOOD` (fijado en el evento 0) | `selectSellers` |
| Llegada | si hay al menos uno, `ConsumptionFirm.onAgentArrival` (208–216) guarda la lista en `selectedCapitalGoodSuppliers`; si no hay ninguno, no hay evento y la empresa **conserva la lista anterior** | `selectedCapitalSuppliers` (`null` hasta la primera vez) |

**Verificación:**
- A mano: una mezcla de compradores y una por comprador; los primeros 5 activos saltean a los inactivos; sin vendedores activos se conserva la lista anterior.
- V3, ticks 1 y 50: **diferencia 0**, incluidos el orden de las dos poblaciones y las 100 listas. Control negativo: alterar una lista o un campo nuevo aparece como diferencia.

## 6. Evento 4: I+D (`rdDecisionTic`)

Lo escuchan solo las empresas de capital: `CopyOfCapitalFirm2WagesEnd.onTicArrived` 69–70 → `CapitalFirm.researchDecision` 542–545 → `RandDInvestmentSharePastSales.computeRandDInvestment`: `amountResearch` = ventas nominales del período anterior (`getPassedValue(LAG_NOMINALSALES, 1)`) × `researchShare`, con `researchShare` = 0 (XML 1821). Sin sorteos (confirmado: el evento no tiene registros). Da 0, pero se porta (`rdDecisionEvent`) porque `amountResearch` entra en la demanda de trabajo y en el pedido de crédito de las empresas de capital, y porque, como JMAB, falla si falta el rezago. V3, ticks 1 y 50: diferencia 0.

## 7. Evento 5: demanda de inversión (`investmentDemandTic`)

**Qué cambia en JMAB** (diff de volcados): `desiredRealCapitalDemand` de las 100 empresas de consumo. Podrían cambiar también el proveedor previo (`previousSupplier` de la estrategia), la bandera `obsolete` de las añadas y `active[MKT_CAPGOOD]` (solo a `true`), pero en los ticks 1 y 50 no cambian.

| Qué | JMAB | Port (`investmentDemandEvent`) |
|---|---|---|
| Disparo | solo empresas de consumo, en orden de creación: `CopyOfConsumptionFirm2WagesEnd.onTicArrived` 72–75 | igual |
| Proveedor | `BestQualityPriceCapitalSupplierWithSwitching.selectGoodSupplier` (114–148) sobre los vendedores del evento 3: el de mayor atractivo ((w / (productividad × capital/trabajo)) × duración / precio, con el inventario del vendedor), el primero en caso de empate; atractivo del previo = −∞ si está inactivo en el mercado activo (capital) | `capitalAttractiveness` |
| Cambio | si el previo es menos atractivo: cambia si su atractivo es −∞, o si `switches(previo, mejor)` (`AbstractSwitchingStrategy.switches`: con p = 0 o 1 no sortea) | `switches`, `switchingProbability` |
| Probabilidad | `SwitchingStrategySimple.getProbability` (77–): con `payOrReceive` = true (XML 1794), 1 − e^{λ(potencial − previo)/potencial} si potencial < previo, si no 0; λ = −ln 0,5 / 0,20 (XML 1791) | `expNeg` y `LN2` (constante; sin `Math.log`) |
| Demanda | `ConsumptionFirm.computeDesiredInvestment` (421–427) → `RealCapitalDemandWithPayBackPeriod.computeRealCapitalDemand` (97–130): capacidad actual (añadas con edad ≠ −1), residual (las no obsoletas con vida restante > 1), deseada = (1 + `desiredCapacityGrowth`) × actual; `(int) Math.round((deseada − residual) / productividad nueva)` si deseada ≥ residual, si no 0. Si > 0, activa en el mercado de capital | `realCapitalDemand`; `Math.round` de Java 6 como ⌊x + 0,5⌋ (x ≥ 0) |
| Crecimiento deseado | `desiredCapacityGrowth` lo calcula la segunda etapa del mercado de capital (evento 19, `InvestmentCapacityOperatingCashFlowExpected`): el evento 5 usa **el del tick anterior** (0 en el tick 1) | campo `desiredCapacityGrowth` |

**Hallazgos (diferencias paper ↔ código, registradas en [caiani-referencia.md](caiani-referencia.md) el 2026-11-13; la extensión según el paper queda para después de V4, ver [pendientes.md](pendientes.md)):**
1. **Nunca se cambia de proveedor de capital por atractivo.** El atractivo es "más es mejor", pero la estrategia de cambio está configurada como pago (`payOrReceive` = true), que solo da probabilidad positiva si el candidato es *menor* que el previo. Como solo se consulta cuando el candidato es mayor, p = 0 siempre: la empresa cambia de proveedor solo si el previo quedó inactivo. Coincide con los volcados (ningún sorteo en el evento 5). El paper describe un cambio con probabilidad creciente en la diferencia de atractivo.
2. **Condición de obsolescencia invertida** (la que se corrigió en 2017, plan sec. 0): una añada queda obsoleta si la **vieja** tiene más productividad del trabajo que la nueva y ese ahorro supera el precio. Sin I+D todas las añadas tienen la misma productividad (los dos términos dan 0 − precio < 0), así que no se activa en el base.

**Verificación:**
- A mano: probabilidad de cambio en pago y en cobro (p = 1/2 cuando la diferencia relativa es 0,2), atractivo, demanda con capacidad residual y añada de edad −1, obsolescencia con la condición de 2015, proveedor previo activo (no cambia, sin sorteo) e inactivo (cambia al mejor).
- V3, ticks 1 y 50: **diferencia 0**. Demanda de 20 en todas las empresas en el tick 1; de 3 a 45 en el tick 50. **Sin cobertura de V3:** el cambio de proveedor (previo inactivo) y la obsolescencia no aparecen en ninguno de los dos ticks.

## 8. Evento 6: oferta de crédito (`creditSupplyTic`)

**Qué cambia en JMAB** (diff de volcados, ticks 1 y 50): en los 10 bancos, `bankInterestRate`, `totalLoanSupply` (+∞), el rezago `LAG_BANKTOTLOANSUPPLY` (17) del período y `active[MKT_CREDIT]` (a `true`). Además cambian `threshold` y `avInterest` de la estrategia de la tasa, pero son variables de trabajo: la estrategia los pisa antes de leerlos en cada llamada, así que no se portan. Un sorteo `fn` por banco, en orden de creación.

| Qué | JMAB | Port |
|---|---|---|
| Disparo | `Bank.onTicArrived` 199–202 → `determineBankGenericInterestRate` (273–277) y `determineCreditSupply` (378–387) | `creditSupplyEvent` |
| Promedios | `CopyOfAdaptiveInterestRateAverageThreshold.computeInterestRate` 64–80 (`mktId` = MKT_CREDIT; la misma estrategia fija la tasa de depósitos, sec. 9): sobre los bancos con préstamos (`getNumericBalanceSheet()[0][SM_LOAN] != 0`) y patrimonio > 0, **en el orden de la lista de la población** (`banks.getAgents()`): umbral = ratio de capital medio (el del evento 0), tasa media = `LAG_LOANINTEREST` del período anterior. Sin ninguno, 0/0 = NaN | `adaptiveInterestRate` (común a los dos mercados); la lista de elegibles se arma una vez (nada de lo que lee cambia dentro del evento) |
| Tasa | 91–102: con `increase` = false (XML 2444), si el ratio de capital del banco supera el umbral, media − 1·media·\|N(0; 0,0094)\|; si no, media + 1·media·\|N\| (`adaptiveParameter` = 1, XML 2446; `foldedNormal1`, 2980–2984); acotada a [0, +∞) (`Bank.getInterestRateLowerBound`/`UpperBound` del crédito, 524–530 y 591–595) | igual; `Math.max`/`min` propagan NaN igual en Java y en JS |
| Umbral del XML | `threshold` = 0,17995897 (2447) | no se usa: se pisa con el promedio antes de leerlo |
| Tasa inicial | 0,0075 (propiedad del prototipo, XML 2288) | `RULES.initialBankInterestRate` |
| Oferta | `InfiniteSupplyCreditStrategy` (XML 2555–2556): +∞, en `totalLoanSupply` y en `LAG_BANKTOTLOANSUPPLY`; activo en crédito si > 0 | igual; `totalLoanSupply` es un double en unidades de Caiani (no µ), porque vale +∞ |

**Detalle de orden:** la suma de las diez tasas del tick 1 da 0,0075000000000000015, no 0,0075: el orden de la suma importa para el bit a bit, y es el de la población (que reordenan las mezclas), no el de creación.

**Empate en el tick 1.** Al principio los 10 bancos son iguales, y la distancia de cada ratio de capital al promedio es ~10⁻¹⁴ relativo: la rama (sube o baja) de cada banco la decide el ruido de redondeo de JMAB. Encadenado desde el principio del tick, el ratio de capital del port difiere en 2,9·10⁻¹⁰ (sale de saldos en µ), cuatro órdenes más que esa distancia; aun así las ramas coinciden porque el error es **el mismo en los diez bancos** (mismo patrimonio y mismos préstamos, salvo redondeo) y no cambia los signos. Es una decisión discreta frágil: si en otro punto de partida se da vuelta, es un caso para el contador de decisiones (plan, sec. 4, V3). En el tick 50 la distancia más chica es 2,5%.

**Verificación:**
- A mano: la tasa baja si el ratio supera el promedio y sube si no (también si es igual), piso 0, sin bancos elegibles da NaN; sobre el estado inicial del port, oferta +∞, rezago, mercado de crédito activo y un sorteo por banco.
- V3, ticks 1 y 50, desde el volcado anterior y encadenado desde el principio del tick: **diferencia 0**. Las dos ramas aparecen en los dos ticks. En los dos ticks los 10 bancos entran en los promedios: la exclusión (sin préstamos o con patrimonio ≤ 0) la cubre solo el caso a mano. Control negativo: con `increase` = true aparecen las 10 tasas como diferencia.

## 9. Eventos 7 y 8: depósitos (`depSupplyTic`, `depInterestTic`)

**Qué cambia en JMAB** (diff de volcados, ticks 1 y 50). Evento 7: en los 10 bancos, `depositInterestRate` y `active[MKT_DEPOSIT]` (a `true`; en el tick 50 ya lo estaba), más las variables de trabajo de la estrategia (no se portan, como en el evento 6); un sorteo `fn` por banco. Evento 8: el saldo de todos los depósitos (en los dos balances), `interestsReceived` / `interestReceived` de los 8.000 hogares y las 120 empresas, y `totInterestsDeposits` de los bancos; sin sorteos.

| Qué | JMAB | Port |
|---|---|---|
| Disparo 7 | `Bank.onTicArrived` 203–205 → `determineDepositInterestRate` (369–375): tasa con la estrategia y activo en depósitos | `depositSupplyEvent` |
| Tasa de depósitos | `CopyOfAdaptiveInterestRateAverageThreshold` con `mktId` = MKT_DEPOSIT (`banksDepInterestStrategy`, XML 2512–2520): promedios de **todos** los bancos (53–63), en el orden de la población: umbral = ratio de liquidez medio (evento 0), tasa media = `LAG_DEPOSITINTEREST` del período anterior; `increase` = false (2516), `adaptiveParameter` = 1 (2518), `foldedNormal2` (σ 0,0094, 2986–2990); acotada a [0, `advancesInterestRate`] = [0; 0,005] (`Bank.getInterestRateUpperBound`, 591–595; XML 2297). Tasa inicial 0,0025 (XML 2299) | `adaptiveInterestRate` con techo; `RULES.initialDepositInterestRate`, `bankAdvancesInterestRate`, `depositRate*` |
| Disparo 8 | `Bank.onTicArrived` 196–198 → `payDepositInterests` (392–403) | `depositInterestEvent` |
| Interés | por depósito del banco, en el orden de su lista: interés = tasa **del contrato** × saldo; `depositor.interestPaid(interés)`, que **asigna** (`Households` 448–451, `ConsumptionFirm` 930–933, `CapitalFirm` 857–860); saldo = saldo·(1 + tasa), sin contrapartida en dinero; `totInterestsDeposits` = suma | interés = `Math.round(saldo µ × tasa)`; `credit(…, 'depositInterest')` (el banco paga con su propio pasivo); `interestReceived` (µ) asignado; total = suma de lo acreditado |

**Unidades del evento 8.** Los intereses de cada banco se redondean a µ **con arrastre** sobre su lista de depósitos (sec. 1): cada uno queda a < 1 µ de valor × tasa y el total, a ≤ 1 µ de la suma de JMAB. El saldo nuevo es saldo + interés. `interestReceived` y `totInterestsDeposits` son lo acreditado (es lo que entra después en las ganancias de las empresas, `ConsumptionFirm` 625 y `CapitalFirm` 682, y en el ingreso bruto de los hogares, `Households` 459). `totInterestsDeposits` en JMAB **no lo lee nadie** (ni agentes ni reportes). Antes del arrastre (un redondeo por depósito) su diferencia con JMAB era 33 µ en el tick 1 y 11 µ en el 50; ahora, ≤ 1 µ.

**Verificación:**
- A mano: tasa de depósitos que baja y que sube según la liquidez, techo 0,005; evento 7 sobre el estado inicial (un sorteo por banco, activo en depósitos); evento 8 sobre el estado inicial, con una tasa de contrato distinta de la del banco (se usa la del contrato), saldos nuevos, interés del depositante y total.
- V3, ticks 1 y 50, suelto y encadenado: evento 7 **diferencia 0**; evento 8, ≤ 1 µ en los 36.000–37.000 contratos, en los intereses de cada depositante y en el total del banco. En el tick 1 la decisión de la tasa de depósitos es un empate (sec. 1, decisiones): los 10 bancos tienen el mismo ratio de liquidez.

## 10. Evento 9: demanda de crédito (`creditDemandTic`)

**Qué cambia en JMAB** (diff de volcados, ticks 1 y 50): en las 120 empresas, `creditDemanded`, `debtBurden`, `debtInterests`, la matriz `debtPayments` y `active[MKT_CREDIT]` (a `true`). Sin sorteos.

| Qué | JMAB | Port |
|---|---|---|
| Disparo | `CopyOfCapitalFirm2WagesEnd.onTicArrived` 72–73 → `computeCreditDemand` (195–222); `CopyOfConsumptionFirm2WagesEnd.onTicArrived` 76–77 → `computeCreditDemand` (197–235; reemplaza al de `ConsumptionFirm` 401–416) | `creditDemandEvent` |
| Servicio de la deuda | `computeDebtPayments` (`ConsumptionFirm` 355–396, `CapitalFirm` 490–530): por préstamo con edad > 0, interés = tasa × saldo y capital = inicial / plazo (capital fijo; XML 1542 y 2011); con edad 0, nada | `debtPayments`, con `installment` del ledger (la cuota que se paga en el evento 20); en µ |
| `debtPayments` | matriz de trabajo: `payInterests` (evento 20) la vuelve a calcular antes de usarla | no se porta |
| Trabajadores | consumo: `getRequiredWorkers` (267–298, `(int) Math.round`); capital: `CapitalFirm.getRequiredWorkers` (535–537) = `(int) Math.round(Y* / 2)` | `requiredWorkers` + `javaRoundToInt` |
| Ganancia esperada | Πᵉ = Sᵉ nominal − N·wᵉ + intereses cobrados (evento 8) − intereses de la deuda + (0,1·Sᵉ real − ⌊inventario⌋)·costo unitario; consumo, además, − amortización (Σ cantidad × precio / 20 de las añadas con 0 ≤ edad < 20) | `consumptionFinancialRequirement`, `capitalFinancialRequirement`, en el orden de evaluación de Java |
| Impuestos y dividendos esperados | Πᵉ·0,18 (`profitTaxVal`, XML 1880); Πᵉ·(1 − 0,18)·0,9 (XML 1895 y 2185) | `RULES.profitTaxRate`, `firmProfitShare*` |
| Requerimiento, consumo | N·wᵉ + inversión + servicio − intereses cobrados + impuestos + dividendos − Sᵉ nominal + 1·N·wᵉ (`shareOfExpIncomeAsDeposit`, XML 2013) | igual |
| Requerimiento, capital | N·wᵉ + ⌊I+D / wᵉ⌋·wᵉ + servicio − intereses cobrados + **dividendos + impuestos** (en ese orden) − Sᵉ nominal + 1·N·wᵉ (XML 1548) | igual |
| Crédito | `PeckingOrderTheory` (XML 1855 y 2152, `stocksId` = [SM_DEP, SM_CASH]): max(requerimiento − depósitos − efectivo, 0); si es > 0, activa en crédito | `peckingOrderCreditDemand`: requerimiento a µ y resta en µ |

**Hallazgo (diferencia paper ↔ código, registrada en [caiani-referencia.md](caiani-referencia.md) el 2026-11-13; la extensión según el paper queda para después de V4, ver [pendientes.md](pendientes.md)):** la inversión del requerimiento de la empresa de consumo se valúa al precio del **primer vendedor visto** en el evento 3 (`selectedCapitalGoodSuppliers.get(0)`), no al del proveedor elegido en el evento 5, al que se le calcula la demanda real (el paper, sec. 3.1.4, dice el del elegido). En los ticks 1 y 50 no coinciden en 95 y 96 de las 100 empresas. El port reproduce el código.

**Unidades.** `debtBurden`, `debtInterests` y `creditDemanded` están en µ. El servicio de la deuda es la suma de las cuotas de `installments` (redondeo con arrastre sobre la lista de préstamos de la empresa; [ledger-contratos.md](ledger-contratos.md), sec. 4): queda a ≤ 1 µ del de JMAB. Antes del arrastre (cada cuota redondeada por separado) las diferencias eran: servicio 3 y 6 µ, intereses 1 y 3 µ, crédito pedido 2 y 5 µ (ticks 1 y 50); ahora, 1, 1 y 2 µ.

**Verificación:**
- A mano: servicio de la deuda con un préstamo de edad 0 (no paga), uno de capital fijo y uno de solo intereses que vence; `PeckingOrderTheory` con depósito y efectivo (pide la diferencia; con requerimiento igual a la liquidez o negativo, 0); requerimientos de una empresa de consumo (con una añada de edad −1 que no amortiza y la inversión al precio del primer vendedor) y de una de capital (con I+D y `Math.round` de 10,5 = 11), calculados término por término; evento sobre el estado inicial.
- V3, ticks 1 y 50, suelto y encadenado: servicio de la deuda e intereses ≤ 1 µ, crédito pedido ≤ 2 µ (regla general, sec. 1). Todo lo demás, diferencia 0. En el tick 1 piden crédito las 120 empresas; en el 50, 111 (las dos ramas).

## 11. Evento 10: mercado de crédito (`creditMarketTic`)

**Qué cambia en JMAB** (diff de volcados): préstamos nuevos (edad 0) en el pasivo de las empresas y el activo de los bancos; depósitos acreditados, o abiertos en el banco prestamista; `creditDemanded` (a 0 o menos), `active[MKT_CREDIT]` de las empresas a las que se les dio todo (a `false`), `previousLender`, y el orden de las listas del mercado de crédito (compradores y vendedores). Sorteos: una mezcla de compradores, una de vendedores por comprador activo y las Bernoulli del cambio de prestamista (tick 1: 1 + 120 + 80; tick 50: 1 + 115 + 63).

| Qué | JMAB | Port |
|---|---|---|
| Disparo | `SimpleMarketSimulation` (XML 303–322, `nbRuns` = 1): si `closed()` (ningún comprador activo con algún vendedor activo, `AbstractMarketMixer`) no pasa nada; si no, `SelectionRandomRobinBuyerMixer.invokeInteractions` | `creditMarketEvent` |
| Listas | propias del mercado (`s.markets.credit`): compradores = empresas de capital y de consumo, vendedores = bancos; las mezclas reordenan en el lugar | igual |
| Mezclador | mezcla los compradores; para cada **activo** en crédito, mezcla los vendedores y toma los primeros 3 activos (XML 333) | igual, con `selectSellers` |
| Prestamista | `CheapestLenderWithSwitching.selectLender`: el más barato de los 3 (el primero en caso de empate); tasa previa = +∞ si el previo está muerto, sin oferta para la empresa o inactivo; si la previa es mayor, cambia si es +∞ o con `switches` (pago, λ = ln 2 / 0,15, XML 1764–1770) | `selectLender`; `switches` del evento 5; `isDead` es siempre falso (población fija) |
| Tasa | `Bank.getInterestRate` (134–140): max(`bankInterestRate`, `bondInterestRate`) | `loanInterestRate`; campo nuevo `bondInterestRate` del banco (inicial 0,0025, XML 2298) |
| Oferta del banco | `ExpectedReturnCreditSupply.computeSpecificSupply` (XML 2567–2574, `binaryDecision` = false): primer monto pedido·(1 − i/100), i = 0…100, con rendimiento esperado ≥ 0; recupero = min(1, Σ valor del capital × 0,5 / Σ deuda); plazo 20 | `expectedReturnCreditSupply`; fórmula en el código |
| Probabilidad de default | `DeterministicLogisticCashFlowComputer`: 1 / (1 + e^{(OCF − a·cuota)/cuota}), cuota = tasa·monto + monto/20, OCF = `LAG_OPERATINGCASHFLOW` del período anterior, a = 3,922445 (consumo) o 21,513347 (capital) (XML 2286–2287) | `logisticDefaultProbability` con `logistic` de creditRisk |
| Préstamo | `ConstrainedCreditMechanism` (XML 338–341): monto = min(pedido, oferta, oferta total del banco); `Loan` a la tasa del banco, edad 0, plazo 20, capital fijo; se acredita en el **primer depósito de la empresa en ese banco** o se abre uno con la tasa de depósitos del banco; pedido −= monto; si se le dio todo, inactiva en crédito; oferta total del banco −= monto (+∞: no cambia) | `creditTransaction`; un préstamo de 0 también se crea (lo cierra `cleanSM`) |

**Adaptaciones (principio 4).** `Math.pow` con exponente entero es un producto (`powInt`) y la exponencial de la logística es `expNeg`. El rendimiento esperado no es bit a bit el de Java, pero solo importa su signo, que se registra como decisión (`fromAmounts`, con la escala de la suma de los términos en valor absoluto): ninguna frágil en los dos ticks, distancia mínima 1,1·10⁻⁴. Las p de las Bernoulli del cambio de prestamista difieren de las registradas en ≤ 4·10⁻¹² relativo (`pDiffs`). Con monto 0 (i = 100) la oferta es 0 por cualquier rama: no se registra.

**Qué se ejercita.** Tick 1: las 120 empresas reciben todo lo pedido; 7 cambian de prestamista y abren depósito en el banco nuevo. Tick 50: de 115 activas, 28 reciben todo, 55 una parte y 28 nada (préstamo de 0); 35 cambian de prestamista; 105 depósitos nuevos (incluidos los de 0 en el prestamista).

**Verificación:**
- A mano: tasa máxima entre la del banco y la de bonos; probabilidad logística (y los bordes con monto 0); oferta contra el cálculo directo de JMAB con `Math.pow`/`Math.exp` en tres flujos de caja (presta todo, recorta, no presta) y con la aversión de las empresas de capital; mercado cerrado sin mezclas; préstamo acreditado en el depósito existente y depósito nuevo en otro banco, con su tasa.
- V3, ticks 1 y 50: evento suelto, diferencia ≤ 1 µ (montos de los préstamos nuevos); encadenado desde el principio del tick, hasta 4 µ, dentro de la regla general (sec. 1). Listas del mercado, prestamistas previos y banderas: diferencia 0.

## 12. Eventos 11 a 14: mercado de trabajo (`laborSupplyTic`, `laborDemandTic`, `governmentLaborTic`, `laborMarketTic`)

**Qué cambia en JMAB** (diff de volcados, tick 50). Evento 11: el salario de los 8.000 hogares (y la bandera de trabajo de los desocupados, que en el 50 ya estaba). Evento 12: listas de empleados, `laborDemand` y bandera de trabajo de las 120 empresas; empleador y bandera de los despedidos (548). Evento 13: lo mismo para el gobierno (68 despedidos). Evento 14: el orden de las dos listas del mercado de trabajo, las contrataciones (593 hogares), `laborDemand` a 0 y las banderas. Sorteos en el tick 50: evento 11, 8.000 `fn`; evento 12, 165 `shuffleEmp` (120 de la rotación y 45 de la rama de despidos); evento 13, 1; evento 14, 560 mezclas del mezclador y 7 del gobierno (tick 1: 8.000; 120; 1; 632 + 136).

| Qué | JMAB | Port |
|---|---|---|
| Disparo 11 | `Households.onTicArrived` 186–188 → `computeWage` (203–209): salario con la estrategia y, si no tiene empleador, activo en trabajo | `laborSupplyEvent`, hogares en orden de creación |
| Salario | `AdaptiveWageStrategy.computeWage` (XML 2800–2806): si la referencia micro > 0,49, w −= 1·w·\|N(0; 0,0094)\|; si no, y la macro ≤ 0,08, w += 1·w·\|N\|; si no, igual. Piso `getWageLowerBound` = 0 (`Households` 375–378) | `adaptiveWage`; un sorteo solo si cambia |
| Referencia micro | `Households.getMicroReferenceVariableForWage` (393–403): ocupado, 0; desocupado, (1 + Σ_{i=1}^{3} `LAG_EMPLOYED`(t − i)) / 4 (`employmentWageLag` = 4, XML 2701) | `wageMicroReference` (con `getLag`) |
| Referencia macro | `getMacroReferenceVariableForWage` (423–428): desocupado, 0; ocupado, `getAggregateValue(LAG_AGGUNEMPLOYMENT, 1)` | `wageMacroReference` |
| Disparo 12 | `CopyOfConsumptionFirm2WagesEnd.onTicArrived` 79–81 → `computeLaborDemand` (166–190); `CopyOfCapitalFirm2WagesEnd` 75–77 → 163–189. Orden de creación: primero consumo, después capital (lo confirma el orden de los sorteos) | `laborDemandEvent` |
| Rotación | `Collections.shuffle(employees)` y `fireAgent` de los primeros, `for (i = 0; i < turnoverLabor·N; i++)` con `turnoverLabor` = 0,05 (XML 2018–2020): despide ⌈0,05·N⌉ (con N = 40, 0,05·40 = 2 exacto: 2) | `adjustWorkforce`, la misma comparación en `double` |
| Despido | `AbstractFirm.fireAgent` (129–133): sin empleador, activo en trabajo; `cleanEmployeeList` (215–223) saca de la lista a los que no tienen empleador | `fire`, `cleanEmployeeList` |
| Requeridos | consumo: `getRequiredWorkers()` (267–298, redondeado); capital: `getRequiredWorkers()` (535–537) + `(int) Math.round(amountResearch / wᵉ)` (0 sin I+D) | `consumptionRequiredWorkersInt`, `capitalRequiredWorkersInt` |
| Ajuste | si requeridos > N: `laborDemand` = diferencia, activo; si no: `laborDemand` = 0, inactivo, **otra** `Collections.shuffle` (aunque no haya que despedir a nadie) y despide a los primeros N − requeridos | igual |
| Disparo 13 | `GovernmentAntiCyclical.onTicArrived` 75–77 → `computeLaborDemand` (146–167): lo mismo con requeridos = `fixedLaborDemand` = 1.360 (XML 2870); la mezcla de la rotación se hace aunque no tenga empleados (tick 1) | `governmentLaborEvent` |
| Disparo 14 | `SimpleMarketSimulation` (XML 345–378) con `nbRuns` = 8.000: `step` repite el mezclador mientras no esté cerrado (`AbstractMarketMixer.closed`: algún comprador activo con algún vendedor activo) | `laborMarketEvent` |
| Mezclador | `SelectionRandomRobinBuyerMixer` (`nbSellers` = 10, XML 377): por ronda, mezcla los compradores (empresas de capital y de consumo y gobierno, lista propia del mercado); para cada uno activo en trabajo, mezcla los hogares y toma los primeros 10 activos | `selectSellers` del evento 3 |
| Empresa | `ConsumptionFirm.onAgentArrival` 239–243, `CapitalFirm` 274–278: `SelectCheapestWorkerStrategy.selectWorker`, **un** trabajador por llegada: el de menor salario (el primero si hay empate) | `cheapestWorker` |
| Gobierno | `Government.onAgentArrival` 159–168: `SelectRandomWorkerStrategy.selectWorkers(vistos, laborDemand)`: mezcla una copia de los vistos y toma min(`laborDemand`, vistos) | igual |
| Contratación | `UnconstrainedLaborMechanism.execute`: el hogar pasa a tener empleador, `addEmployee` (`laborDemand` − 1, al final de la lista), hogar inactivo; empleador inactivo si `laborDemand` llega a 0 | `hire` |

**Hallazgo (diferencia paper ↔ código, para registrar si Nico está de acuerdo).** La regla del salario está **invertida para los desocupados**. La referencia micro se llama `averageUnemployment` y arranca en 1 (el trimestre actual, desocupado), pero suma los rezagos de `LAG_EMPLOYED`, que valen 1 cuando el hogar **tenía** empleador (`Households.updateExpectations`). Así, un desocupado de los cuatro trimestres da 1/4 ≤ 0,49 y pasa a la rama macro, donde su referencia es 0 ≤ 0,08: **sube** su salario siempre. Uno que trabajó en alguno de los tres trimestres anteriores da ≥ 1/2 y lo **baja**. El paper (sec. 3.4, eq. 3.15) dice lo contrario: baja el que estuvo desocupado más de dos de los últimos cuatro trimestres. Medido sobre los volcados (semilla 12345), con la lectura corregida (contar trimestres desocupado en vez de ocupado): en el tick 1 los 2.000 desocupados suben en el código y bajarían con la corrección; en el tick 50 el código y la corrección eligen otra rama en 384 de los 455 desocupados. Para el desocupado de larga data, el código no deja que su salario de reserva baje; como las empresas contratan al más barato de los que ven, eso lo deja atrás en la fila. El port reproduce el código; plan, sec. 2 (R2), describe la regla del paper.

**Otros detalles de JMAB que el port reproduce:**
- `laborDemand` inicial: el inicializador contrata con `addEmployee`, que resta 1, así que las empresas arrancan con −(empleados) (−50 las de consumo). Lo detectó V1 al comparar el campo; no tiene efecto (el evento 12 lo pisa antes de leerlo).
- Con requeridos = N (nadie que despedir), la rama de despidos igual mezcla la lista: consume un sorteo y cambia el orden de los empleados (que después usa el pago de salarios).
- `SelectCheapestWorkerStrategy.selectWorkers` (la versión de varios trabajadores, con `maxWage` = +∞ y un `TreeMap` por salario que pisa los salarios repetidos) **no se usa** en el base: las empresas llaman a `selectWorker`.

**Verificación:**
- A mano: referencia micro (1/4, 1/2, 0 para el ocupado); salario que baja (recién despedido), que sube (desocupado de larga data, aun con 50% de desempleo; ocupado con desempleo igual al umbral), que queda igual sin sorteo (desempleo apenas por encima) y piso 0; rotación con 0,05·50 = 2,5 (despide 3) y 0,05·40 = 2 (despide 2), demanda de trabajo y activa; rama de despidos con su segunda mezcla; gobierno sin empleados (mezcla igual, pide 1.360); mercado cerrado sin mezclas; la empresa contrata al más barato de los 10 primeros activos (no ve al 11.º); el gobierno contrata min(demanda, vistos) en rondas hasta que se cierra por falta de vendedores.
- V3, ticks 1 y 50, suelto y encadenado: **diferencia 0** en salarios, empleadores, listas de empleados (en orden), `laborDemand`, banderas y listas del mercado. En el tick 1 contratan el gobierno (1.360, al azar) y las empresas; en el 50, 16 empresas de capital, 59 de consumo y el gobierno (68). Ramas: en el tick 50 aparecen las dos del salario que lo cambian (baja: 228 desocupados; sube: el resto), las dos del ajuste de planta y las dos llegadas (empresa y gobierno). **Sin cobertura de V3:** la rama que deja el salario igual (desempleo del período anterior > 8%; en el tick 50 es 5,7%) y el piso 0 del salario: solo casos a mano.

## 13. Evento 15: producción (`productionTic`)

**Qué cambia en JMAB** (diff de volcados, tick 50): el inventario de las 120 empresas (cantidad y costo unitario; en las de capital también el valor contable), los rezagos `LAG_PRODUCTION` (las 120), `LAG_CAPACITY` y `LAG_CAPITALFINANCIALVALUE` (las de consumo) y la bandera del mercado de consumo (41 empresas pasan a activas). Sin sorteos.

| Qué | JMAB | Port (`productionEvent`) |
|---|---|---|
| Disparo | `CopyOfConsumptionFirm2WagesEnd.onTicArrived` 82–84 y `CopyOfCapitalFirm2WagesEnd` 78–80 → `produce()`; orden de creación (consumo, capital) | igual |
| Consumo, con empleados | `ConsumptionFirm.produce` 440–500: sobre todas las añadas (orden de la lista), capacidad Σ cantidad × productividad, valor Σ `getValue` (el contable: la empresa no es el productor) y amortización Σ precio × cantidad / amortización. Producción: añadas de la más productiva a la menos (`TreeMap.descendingKeySet`; a igual productividad, orden de la lista); si cantidad / capital-trabajo < trabajadores restantes, la añada entera (productividad × cantidad); si no, capital-trabajo × restantes × productividad, y no quedan trabajadores | `consumptionProduce` |
| Consumo, inventario | cantidad += producción; costo unitario = (amortización + masa salarial) / producción (`getWageBill`, AbstractFirm 189–195: Σ salarios de los empleados). `ConsumptionGood.setQuantity` no toca el valor contable | igual |
| Consumo, sin empleados | solo capacidad y valor; producción 0, costo unitario sin cambios | igual |
| Consumo, mercado | activa en consumo si el inventario es > 0, si no inactiva | igual |
| Capital | `CapitalFirm.produce` 394–420: con empleados, trabajadores = `getRequiredWorkers()` (`(int) Math.round(Y*/2)`); si `laborDemand` > 0 (no cubrió la demanda), trabajadores = `Math.round(producción / (producción + ⌊I+D / wᵉ⌋) × empleados)` con **división entera** (1 sin I+D: produce con todos sus empleados); producción = trabajadores × 2 (`laborProductivity`) | `capitalProduce`; la división entera con `Math.trunc` |
| Capital, inventario | `CapitalGood.setQuantity` (184–193) **recalcula el valor contable**: precio × cantidad × (1 − edad / amortización); costo unitario = masa salarial / producción | `setCapitalGoodQuantity` |
| Rezagos | `LAG_PRODUCTION` (las dos); `LAG_CAPACITY` y `LAG_CAPITALFINANCIALVALUE` (consumo) | `setLag` |

**Detalle de JMAB (sin efecto en el base):** con I+D > 0 y la demanda de trabajo sin cubrir, la división entera da 0: la empresa de capital no produce y su costo unitario queda en masa salarial / 0 = +∞. La I+D está apagada en el base (`researchShare` = 0). El port lo reproduce (caso a mano).

**Verificación:**
- A mano: 47 empleados con 20 añadas iguales (15 enteras y 0,8 unidades de la 16.ª), costo unitario y rezagos; una añada más productiva al final de la lista se usa primero; sin empleados (no produce, inactiva sin inventario); capital sin restricción (round(81/2) = 41 → 82), restringida (todos sus empleados × 2), valor contable recalculado y el caso de la división entera con I+D.
- V3, ticks 1 y 50, suelto: **diferencia 0** (`double` bit a bit: inventarios, costos unitarios, valores, rezagos). Encadenado desde el principio del tick: `double` puros bit a bit; ratios de los bancos a ≤ 2,6·10⁻⁸; montos ≤ 2 µ. **Sin cobertura de V3:** la empresa de consumo sin empleados y la de capital restringida (en el tick 50 las 16 empresas de capital que buscaban trabajadores cubren su demanda en el evento 14): solo casos a mano.

## 14. Estado agregado al port en P3 hasta ahora

- Todos los agentes (`AgentFlags`): `active[MKT_*]`, `defaulted`.
- Empresas: `desiredOutput`, `bailoutCost` (µ), `markUp`, `expectedVariableCosts`.
- Bancos: `liquidityRatio`, `capitalRatio`, `bailoutCost`, `currentNonPerformingLoans` (µ); `bankInterestRate`, `totalLoanSupply` (evento 6); `depositInterestRate` (evento 7), `totInterestsDeposits` (µ, evento 8); `bondInterestRate` (lo lee el evento 10; lo fija el mercado de bonos).
- Hogares y empresas: `interestReceived` (µ, evento 8).
- BC (`centralBank`): `interestsOnAdvances`, `interestsOnBonds` (µ).
- Rezagos: `setLag` con la eviction de `TreeMapPassedValues` (4 observaciones) y `getLag`.
- Empresas de consumo: `selectedCapitalSuppliers` (evento 3), `desiredCapacityGrowth`, `desiredRealCapitalDemand` (evento 5). Empresas de capital: `amountResearch` (evento 4).
- Empresas: `debtBurden`, `debtInterests`, `creditDemanded` (µ, evento 9).
- Empresas y gobierno: `laborDemand` (eventos 12–14; el inicializador lo deja en −empleados).
- Parámetros (`RULES`, con su línea del XML): participación del inventario objetivo, tasa de adelantos del BC, margen (umbral, paso, σ, iniciales), productividad del trabajo en capital, vendedores por comprador en el mercado de capital, `researchShare`, λ y `payOrReceive` del cambio de proveedor de capital, tasas iniciales de los bancos, estrategias de las tasas de préstamos y de depósitos (paso, sentido, σ) y techo de la tasa de depósitos; impuesto a las ganancias, `profitShare` y `shareOfExpIncomeAsDeposit` de las empresas (evento 9); plazo de los préstamos, vendedores del mercado de crédito, λ y `payOrReceive` del cambio de prestamista, aversiones al riesgo, quita y tasa de bonos inicial del banco (evento 10); estrategia del salario (umbrales micro y macro, pasos, σ, `employmentWageLag`), rotación, empleo público objetivo, vendedores y rondas del mercado de trabajo (eventos 11–14).
- `OracleCaianiRng`: opción `agentId` (sec. 1).

Cada campo nuevo va en `state.ts`, en `initialize` (valor del constructor de JMAB), en `stateFromDump` y en `compareState` (`test/support/jmab-dump.ts`).

## 15. Para retomar en una sesión nueva

1. Leer este documento (sec. 1: método; sec. 2: mapa) y [inicializacion.md](inicializacion.md).
2. Siguiente: **evento 16, `rdOutcomeTic`** (I+D, apagada en el base), **17, `consumptionDemandTic`**, y después 18–28 (consumo y pagos). Antes del evento 18 (primer pago entre agentes), decidir la propuesta del redondeo controlado (sec. 1, "Reservas"). Los volcados de las corridas de referencia (2026-11-13) llegan hasta el evento 37; los de los eventos 135 y 136 no se generan (ver pendientes).
3. Por cada evento: agregar `t:e` a las dos corridas de referencia y correrlas; diff de volcados; leer el código de los agentes que escuchan el evento (`activeTicEvents`); portar en `events.ts` con la línea de JMAB al lado; casos a mano y V3 en `caiani-events.test.ts` (agregar el evento a la tabla `EVENTS`); cada comparación que define una rama, con los helpers de `decisions.ts`; registrar acá.
4. Norma operativa: no editar los scripts de `reference/tools` mientras corre algo largo ([arquitectura.md](arquitectura.md), "Corridas largas").
