# Reglas del port de Caiani (P3)

Estado al 2026-11-13: **infraestructura de V3 por evento lista; eventos 0 a 8 portados y verificados en los ticks 1 y 50 (bit a bit salvo un total de intereses que no lee nadie, sec. 9); contador de decisiones discretas en el V3.** Para retomar en una sesión nueva, ver la sec. 11. Plan general en [plan-port-caiani.md](plan-port-caiani.md) (sec. 4 y 7). Código: `packages/engine/src/caiani/events.ts` (eventos), `state.ts` (estado), `params.ts` (`RULES`); tests en `packages/engine/test/caiani-events.test.ts`, arnés en `test/support/jmab-dump.ts`.

Todo lo que se afirma sobre JMAB sale de `reference/jmab-2015/src` (fuente equivalente al `.jar`, V0), de `paper-launcher/Model/modelFile.xml` y de los volcados del oráculo.

## 1. Método

**Unidad: el evento.** El tick de JMAB es una lista de eventos (`modelFile.xml`, propiedad `events`, desde la línea 43). En cada evento, los agentes que lo tienen en `activeTicEvents` ejecutan su `onTicArrived`. El port tiene una función por evento, en el mismo orden.

**V3 por evento:**
1. El oráculo vuelca el estado al principio del tick t (`DUMP_TICKS=t`) y después del evento e (`DUMP_EVENTS="t:e"`).
2. El port reconstruye su estado desde el volcado "antes" (`stateFromDump`), corre el evento con el `Rng` en modo oráculo (los sorteos del evento: `draws.tsv` ahora trae el índice del evento en la sexta columna) y se compara con el volcado "después" (`compareState`).
3. Comparar los dos volcados de JMAB entre sí dice exactamente **qué estado toca el evento**. Eso define qué campos agregar al estado del port.

**Reconstrucción del estado** (`stateFromDump`): los contratos se emparejan por `@oid` (el oráculo numera cada ítem dentro de un volcado; el mismo objeto está en la lista del tenedor y en la del emisor), y cada lista conserva el orden de JMAB. Verificado: el estado reconstruido del tick 1 coincide con su volcado sin ninguna diferencia.

**Orden de despacho.** Dentro de un evento, JMAB llama a los agentes en **orden de creación** (el de suscripción al planificador), no en el de la lista de la población (que las mezclas reordenan). Verificado en los eventos 1 y 2: el paso |N| de cada empresa, despejado de su margen antes y después, coincide a 10⁻¹³ con el registrado en esa posición de la secuencia. Importa porque el oráculo registra las normales sin el id del agente: el port las tiene que pedir en el mismo orden. Los arreglos del estado del port (`households`, `consumptionFirms`, etc.) están en orden de creación.

**Tolerancias** (plan, sec. 4, V3): montos, 2 µ, o tantos µ como redondeos a µ entraron si el monto es una suma de montos redondeados (el arnés lo aplica campo por campo: hoy solo `totInterestsDeposits`, sec. 9); `double` calculados a partir de montos, 10⁻⁶ relativo; los demás `double`, 10⁻⁹.

**Decisiones discretas (contador de V3, 2026-11-13, pedido de Nico).** Módulo `caiani/decisions.ts`, test a mano en `test/caiani-decisions.test.ts`.
- Cada comparación que define una rama en un evento pasa por un helper (`gt`, `ge`, `lt`, `record`, `rounding`) que devuelve lo mismo que la comparación sola. Con un registrador activo (`withDecisions(rec, evento, fn)`) anota, por evento y por lugar, la **distancia al umbral** en la escala de la tolerancia del valor comparado (µ absolutos para montos; relativa para los `double`, a la escala de los operandos o de los términos de los que sale el valor) y el resultado. Si la distancia es ≤ la tolerancia, la decisión es **frágil**: una diferencia que V3 admite alcanzaría para darla vuelta. El registro solo observa: sin registrador, los helpers no hacen nada más que comparar.
- **Decisiones dadas vuelta:** el V3 corre cada evento suelto (desde el volcado de JMAB, o sea con las entradas de JMAB) y encadenado desde el principio del tick, los dos con registrador; `compareOutcomes` lista las comparaciones con otro resultado en la misma posición. Una que se da vuelta hoy igual hace fallar la comparación de estado aguas abajo; el contador dice dónde empezó.
- **Qué no se registra:** comparaciones entre enteros exactos (edades, plazos, cantidades de la lista), banderas de actividad que vienen de otro evento (se registran donde se deciden), y la comparación del atractivo del proveedor previo cuando el previo **es** el mejor (es el mismo cálculo dos veces, no puede darse vuelta). El piso de la producción deseada (`max(0, …)`) se mide contra la escala de los términos de la resta, no contra el resultado.
- **Resultado en los ticks 1 y 50 (eventos 0–8):** ninguna decisión se da vuelta. Frágiles:

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

  Las frágiles del tick 1 vienen de que la inicialización deja a todas las empresas y bancos de cada tipo iguales y justo en los umbrales. En el tick 50 la distancia más chica es 1,8·10⁻⁴ (redondeo de los trabajadores requeridos).

**Corridas de referencia** (semilla 12345; el test `caiani-events.test.ts` las recorre con `describe.each`):
- `DUMP_TICKS=1 DUMP_EVENTS="1:0,1:1,1:2,1:3,1:4,1:5,1:6,1:7,1:8" reference/tools/run-oracle.sh p3-t1 12345 1 -1 999999`
- `DUMP_TICKS=50 DUMP_EVENTS="50:0,50:1,50:2,50:3,50:4,50:5,50:6,50:7,50:8" reference/tools/run-oracle.sh p3-t50 12345 50 50 50`

Los volcados de los eventos 7 y 8 ya están (se agregaron el 2026-11-13 junto con el 6, para no volver a correr al portarlos).

Se pueden correr las dos a la vez (directorios distintos); tardan ~1 y ~4 minutos.

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
| 8 | `depInterestTic` | **portado, V3 ✓** (total del banco dentro de la tolerancia por redondeos) |
| 9 | `creditDemandTic` | |
| 10 | `creditMarketTic` (201) | |
| 11 | `laborSupplyTic` (8.000) | |
| 12 | `laborDemandTic` (120) | |
| 13 | `governmentLaborTic` (1) | |
| 14 | `laborMarketTic` (768) | |
| 15 | `productionTic` | |
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

**Unidades del evento 8.** El interés se redondea a µ una vez por depósito (como las ganancias del BC, evento 0) y el saldo nuevo es saldo + interés: difiere de valor·(1 + tasa) de JMAB en menos de 1 µ por depósito. `interestReceived` y `totInterestsDeposits` son lo acreditado (es lo que entra después en las ganancias de las empresas, `ConsumptionFirm` 625 y `CapitalFirm` 682, y en el ingreso bruto de los hogares, `Households` 459). `totInterestsDeposits` en JMAB **no lo lee nadie** (ni agentes ni reportes); su diferencia con JMAB es la acumulación de los redondeos de ~800 depósitos por banco: 33 µ en el tick 1 y 11 µ en el 50, dentro de la tolerancia "un µ por redondeo" del plan.

**Verificación:**
- A mano: tasa de depósitos que baja y que sube según la liquidez, techo 0,005; evento 7 sobre el estado inicial (un sorteo por banco, activo en depósitos); evento 8 sobre el estado inicial, con una tasa de contrato distinta de la del banco (se usa la del contrato), saldos nuevos, interés del depositante y total.
- V3, ticks 1 y 50, suelto y encadenado: evento 7 **diferencia 0**; evento 8 **diferencia 0** en los 36.000–37.000 contratos y en los intereses de cada depositante; el total del banco, dentro de la tolerancia (arriba). En el tick 1 la decisión de la tasa de depósitos es un empate (sec. 1, decisiones): los 10 bancos tienen el mismo ratio de liquidez.

## 10. Estado agregado al port en P3 hasta ahora

- Todos los agentes (`AgentFlags`): `active[MKT_*]`, `defaulted`.
- Empresas: `desiredOutput`, `bailoutCost` (µ), `markUp`, `expectedVariableCosts`.
- Bancos: `liquidityRatio`, `capitalRatio`, `bailoutCost`, `currentNonPerformingLoans` (µ); `bankInterestRate`, `totalLoanSupply` (evento 6); `depositInterestRate` (evento 7), `totInterestsDeposits` (µ, evento 8).
- Hogares y empresas: `interestReceived` (µ, evento 8).
- BC (`centralBank`): `interestsOnAdvances`, `interestsOnBonds` (µ).
- Rezagos: `setLag` con la eviction de `TreeMapPassedValues` (4 observaciones) y `getLag`.
- Empresas de consumo: `selectedCapitalSuppliers` (evento 3), `desiredCapacityGrowth`, `desiredRealCapitalDemand` (evento 5). Empresas de capital: `amountResearch` (evento 4).
- Parámetros (`RULES`, con su línea del XML): participación del inventario objetivo, tasa de adelantos del BC, margen (umbral, paso, σ, iniciales), productividad del trabajo en capital, vendedores por comprador en el mercado de capital, `researchShare`, λ y `payOrReceive` del cambio de proveedor de capital, tasas iniciales de los bancos, estrategias de las tasas de préstamos y de depósitos (paso, sentido, σ) y techo de la tasa de depósitos.
- `OracleCaianiRng`: opción `agentId` (sec. 1).

Cada campo nuevo va en `state.ts`, en `initialize` (valor del constructor de JMAB), en `stateFromDump` y en `compareState` (`test/support/jmab-dump.ts`).

## 11. Para retomar en una sesión nueva

1. Leer este documento (sec. 1: método; sec. 2: mapa) y [inicializacion.md](inicializacion.md).
2. Siguiente: **evento 9, `creditDemandTic`** (demanda de crédito de las empresas: `PeckingOrderTheory`, plan sec. 2, R9) y **10, `creditMarketTic`** (201 sorteos en el tick 1; primer `SelectionRandomRobinBuyerMixer` con lista propia del mercado: usar `selectSellers`; `ExpectedReturnCreditSupply` con `DeterministicLogisticCashFlowComputer`; `ConstrainedCreditMechanism` resta de `totalLoanSupply`). Antes: volver a correr las dos corridas de referencia con `DUMP_EVENTS` hasta el evento que se vaya a portar (conviene agregar varios de una vez, p. ej. 9–14).
3. Por cada evento: agregar `t:e` a las dos corridas de referencia y correrlas; diff de volcados; leer el código de los agentes que escuchan el evento (`activeTicEvents`); portar en `events.ts` con la línea de JMAB al lado; casos a mano y V3 en `caiani-events.test.ts` (agregar el evento a la tabla `EVENTS`); cada comparación que define una rama, con los helpers de `decisions.ts`; registrar acá.
4. Norma operativa: no editar los scripts de `reference/tools` mientras corre algo largo ([arquitectura.md](arquitectura.md), "Corridas largas").
