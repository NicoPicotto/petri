# Inventario de decisiones JMAB ↔ port (para d1)

Pedido de Nico (2026-11-16), paso 1 del plan de d1 (reglas-caiani.md, sec. 40, "Plan de implementación de d1"). **Se revisa antes de tocar el oráculo.** Cada fila es un lugar donde JMAB toma una rama (o redondea) sobre un `double` o un monto, y lo que hace el port en ese punto.

## Cómo se armó

- **Del lado del port, medido:** `reference/tools/decision-census.test.ts` corre cada evento suelto desde el volcado de JMAB con un `DecisionRecorder` (sin forzar nada) en seis ticks: 1, 50, 81 y 133 (semilla 12345) y 292 y 300 (semilla 102). Anota qué lugares registran en cada evento y cuántas comparaciones hacen (`reference/p0/runs/oracle/decision-census.tsv`). Así, la columna "eventos" de la tabla A es la medida, no la que sale de leer el código. Cuando un lugar no corre en esos ticks, se aclara.
- **Del lado de JMAB, leído:** el fuente del oráculo (`reference/p0/oracle/src`, el de 2015 con las vigilancias). Las líneas citadas son las de ese árbol, que es el que se instrumenta; difieren unas pocas líneas de `reference/jmab-2015` por las vigilancias. Se recorrieron todas las clases que corren en el base (las que nombra `Model/modelFile.xml` del lanzador) buscando `if`, `while`, `?:`, `Math.min/max/round/floor/ceil/rint` y `(int)` sobre `double`.
- **Del lado del port, leído:** las comparaciones de `events.ts` que no pasan por `decisions.ts`, una por una (sección C).
- **Tamaño de `decisions.tsv`, medido:** 148.725 decisiones en el tick 1, 163.407 en el 50, 249.667 en el 81, 297.994 en el 133, 147.995 en el 292 y 391.118 en el 300. El 300 tiene tres quiebras por salarios, cada una con 8.000 hogares × préstamos en "aporte negativo". A ~80 bytes por línea, entre 12 y 32 MB por tick sin comprimir.

## Convenciones

- **Lugar:** el texto del port (`SITE_…` + descripción). El oráculo escribe ese mismo texto. **Un lugar por línea de JMAB** (propuesta F2).
- **Agente:** el id del agente que ejecuta el método de JMAB (`this` o `this.getAgent()` de la estrategia). En los mecanismos, el comprador o demandante. En el aporte de los dueños, el hogar. Hoy el port pasa el agente solo en algunos lugares (columna "agente hoy"); con d1, todos.
- **Unidades:** en los lugares de clase `amount`, el port compara µ y JMAB unidades: el arnés multiplica los operandos de JMAB por 10⁶. Vale también para los que el port ya escala a mano (`× MICRO_PER_UNIT`: impuestos, dividendos, bonos), porque JMAB escribe los mismos operandos en unidades. En `fromAmounts` y `pure`, factor 1.
- **Clase:** la de hoy. Con la marca "→ de montos (consumo)" van las que pasan a `fromAmounts` por el criterio de origen aprobado (reglas-caiani.md, sec. 1). La clase la decide quien llama, por el tipo de agente, cuando el lugar es compartido.
- **Condición:** cuando el port registra solo en ciertos casos, el oráculo registra en los mismos (por ejemplo, "previo < mejor" solo si el previo no es el mejor; en el otro caso, los dos valores son el mismo `double` y no hay decisión).

## A. Lugares que el port registra hoy (65 llamadas)

`events.ts` es `packages/engine/src/caiani/events.ts`. JMAB, relativo a `reference/p0/oracle/src`.

| Ev. | Lugar (port) | events.ts | JMAB | Clase | Agente hoy | Notas |
|---|---|---|---|---|---|---|
| 0 | `TargetExpectedInventoriesOutputStrategy.computeOutput` (x > 0) | 99 | `jmab/strategies/TargetExpectedInventoriesOutputStrategy.java:54` `Math.max(0, …)` | pure → de montos (consumo) | — | Sin rama en JMAB (E). Hoy solo observa: pasa a usar lo que devuelve (F3) |
| 0 | `CapitalFirm.determineOutput activo (inventario)` / `(⌊Y*⌋)` | 135, 136 | `modellone/agents/CapitalFirm.java:554` | pure | — | Hoy solo observa (F3) |
| 0 | `Bank.onTicArrived depósitos = 0` | 160 | `modellone/agents/Bank.java:180` | amount | — | |
| 1, 2 | `AdaptiveMarkUpOnAC.computePrice referencia > umbral` | 209 | `jmab/strategies/AdaptiveMarkUpOnAC.java:55` | pure → de montos (consumo) (F5) | — | Referencia = inventario / ventas reales rezagadas |
| 1, 2 | `… piso ≠ 0` | 212 | `AdaptiveMarkUpOnAC.java:61` | pure → de montos (consumo) | — | En JMAB, `getPriceLowerBound` se llama varias veces (D3) |
| 1, 2 | `… precio > piso` | 213 | `AdaptiveMarkUpOnAC.java:73` | pure → de montos (consumo) | — | |
| 2, 9, 12 | `ConsumptionFirm.getRequiredWorkers residual > capacidad de la añada` | 231 | `modellone/agents/ConsumptionFirm.java:287` (`getRequiredWorkers`) y `:864` (`getPriceLowerBound`, rama sin producción) | pure → de montos (consumo) | — | Dos líneas de JMAB, un lugar del port: las dos escriben el mismo texto |
| 2 | `ConsumptionFirm.getPriceLowerBound Math.round(trabajadores)` | 282 | `ConsumptionFirm.java:298` (`getRequiredWorkers`, llamado desde `getPriceLowerBound` 828) | pure → de montos (consumo) | — | Misma línea de JMAB que la siguiente: se unifica el nombre (F2) |
| 9, 12 | `ConsumptionFirm.getRequiredWorkers Math.round(trabajadores)` | 785 | `ConsumptionFirm.java:298` | pure → de montos (consumo) | — | |
| 9, 12, 15 | `CapitalFirm.getRequiredWorkers Math.round(Y*/productividad)` | 883 | `CapitalFirm.java:536` | pure | — | |
| 5, 10, 18, 19 | `AbstractSwitchingStrategy.switches potencial < previo` | 407 | `jmab/strategies/SwitchingStrategySimple.java:79` | pure; en el 18 → de montos (precios de consumo) | — | Agente: el comprador (empresa, hogar) |
| 27 | `… previo < potencial` | 410 | `SwitchingStrategySimple.java:85` | pure | — | Depósitos (cobro) |
| 5, 19 | `RealCapitalDemandWithPayBackPeriod obsolescencia` | 458 | `jmab/strategies/RealCapitalDemandWithPayBackPeriod.java:111` | pure | — | Una por añada vieja |
| 5, 19 | `… deseada ≥ residual` | 465 | `RealCapitalDemandWithPayBackPeriod.java:123` | pure | — | |
| 5, 19 | `… Math.round(demanda)` | 467 | `RealCapitalDemandWithPayBackPeriod.java:124` | pure | — | |
| 5, 19 | `BestQualityPriceCapitalSupplierWithSwitching mejor atractivo` | 526 | `jmab/strategies/BestQualityPriceCapitalSupplierWithSwitching.java:125` | pure | — | |
| 5, 19 | `… previo < mejor` | 536 | `BestQualityPriceCapitalSupplierWithSwitching.java:139` | pure | — | Solo si previo ≠ mejor |
| 6, 7 | `CopyOfAdaptiveInterestRateAverageThreshold.computeInterestRate ratio de capital > promedio` / `ratio de liquidez > promedio` | 606 | `jmab/strategies/CopyOfAdaptiveInterestRateAverageThreshold.java:91` | fromAmounts | — | Cociente indeterminado del banco zombi (H) |
| 6, 7 | `… piso 0` | 611 | `CopyOfAdaptiveInterestRateAverageThreshold.java:102` (`Math.max`) | pure | — | Sin rama en JMAB (E); hoy solo observa (F3) |
| 7 | `… techo` | 612 | `CopyOfAdaptiveInterestRateAverageThreshold.java:102` (`Math.min`) | pure | — | Solo con techo finito (depósitos); en crédito es +∞ y no se registra en ningún lado. Hoy solo observa (F3) |
| 6 | `… préstamos ≠ 0` y `… patrimonio > 0` | 641, 642 | `CopyOfAdaptiveInterestRateAverageThreshold.java:70` (`&&`) | amount | — | Repetida 10 × 10 en JMAB (D1). Agente: el banco evaluado |
| 9 | `PeckingOrderTheory.computeCreditDemand requerimiento > liquidez` | 779 | `jmab/strategies/PeckingOrderTheory.java:49` (`Math.max`) | amount | empresa | Sin rama en JMAB (E) |
| 10 | `ExpectedReturnCreditSupply.computeSpecificSupply rendimiento esperado ≥ 0` | 991 | `jmab/strategies/ExpectedReturnCreditSupply.java:88` | fromAmounts | — | Hasta 101 por par banco-empresa (corta en la primera ≥ 0, igual en los dos). Agente: el banco |
| 10 | `CheapestLenderWithSwitching más barato` | 1008 | `jmab/strategies/CheapestLenderWithSwitching.java:113` | pure | — | |
| 10 | `… previo > mínimo` | 1020 | `CheapestLenderWithSwitching.java:126` | pure | — | Solo si previo ≠ mínimo |
| 10 | `ConstrainedCreditMechanism.execute se le dio todo` | 1079 | `jmab/mechanisms/ConstrainedCreditMechanism.java:76` | amount | empresa | |
| 11 | `AdaptiveWageStrategy.computeWage desempleo agregado > umbral` | 1171 | `jmab/strategies/AdaptiveWageStrategy.java:50` (`<=`, al revés) | pure | — | Solo si la rama micro (46) da falso, igual en los dos |
| 12 | `CopyOfCapitalFirm2WagesEnd.computeLaborDemand Math.round(I+D/salario)` | 1256 | `modellone/agents/CopyOfCapitalFirm2WagesEnd.java:174` | pure | — | I+D = 0 en el base: siempre 0 |
| 14 | `SelectCheapestWorkerStrategy más barato` | 1297 | `jmab/strategies/SelectCheapestWorkerStrategy.java:42` | pure | — | |
| 17 | `Households.computeConsumptionDemand demanda > 0` | 1623 | `modellone/agents/Households.java:269` | fromAmounts | — | |
| 18 | `CheapestGoodSupplierWithSwitching.selectGoodSupplier más barato` | 1661 | `jmab/strategies/CheapestGoodSupplierWithSwitching.java:108` | pure → de montos (precios de consumo) | — | La más numerosa: ~40.000 por tick |
| 18 | `… previo más caro` | 1670 | `CheapestGoodSupplierWithSwitching.java:120` | pure → de montos | — | Solo si previo ≠ mínimo |
| 18 | `AtOnceMechanism.execute demanda ≤ inventario` | 1700 | `jmab/mechanisms/AtOnceMechanism.java:56` (`Math.min`) | fromAmounts | — | Sin rama en JMAB (E) |
| 18 | `… depósito < monto` | 1715 | `AtOnceMechanism.java:79` | amount | — | |
| 18 | `… cantidad con el depósito` (piso) | 1717 | `AtOnceMechanism.java:82` | fromAmounts | — | `flooring`: hoy sin agente (F1) |
| 18 | `… depósito agotado` | 1734 | `AtOnceMechanism.java:107` (segundo término del `\|\|`) | amount | — | El primero (`demand == 0`) sale de "demanda ≤ inventario" (C5) |
| 19 | `InvestmentCapacityOperatingCashFlowExpected.computeDesiredGrowth capacidad = 0` / `K = 0` | 1793, 1794 | `modellone/strategies/InvestmentCapacityOperatingCashFlowExpected.java:163` (`\|\|`) | pure | — | |
| 19 | `… max(−1, g)` | 1799 | `InvestmentCapacityOperatingCashFlowExpected.java:168` (`Math.max`) | fromAmounts | — | Sin rama en JMAB (E) |
| 19 | `AbstractMechanism.reallocateLiquidity reunido < monto` | 1843 | `jmab/mechanisms/AbstractMechanism.java:85` | amount | empresa | **JMAB lo evalúa también en el 18 y el 35** (B6) |
| 19 | `AtOnceMechanism.execute capital: depósito < monto` | 1864 | `AtOnceMechanism.java:79` | amount | empresa | |
| 19 | `… capital: cantidad con el depósito` (piso) | 1866 | `AtOnceMechanism.java:82` | fromAmounts | — | `flooring`: hoy sin agente |
| 19 | `… capital: depósito agotado` | 1888 | `AtOnceMechanism.java:107` | amount | — | |
| 20, 21 | `FirmBankruptcyFireSales.bankrupt liquidez ≥ deuda` | 1999 | `modellone/strategies/FirmBankruptcyFireSales.java:119` | amount | — | Repetida por préstamo en JMAB (D2) |
| 20, 21 | `… valor del capital > pérdida` | 2037 | `FirmBankruptcyFireSales.java:145` | fromAmounts | — | |
| 20, 21 | `… aporte negativo` | 2100 | `FirmBankruptcyFireSales.java:166` (signo de `amountToPay`) | fromAmounts | — | Sin rama en JMAB (E): el port separa en dos ramas lo que en JMAB es un signo. Agente: el hogar |
| 20 | `ConsumptionFirm/CapitalFirm.payInterests liquidez ≥ servicio` | 2201 | `ConsumptionFirm.java:659`, `CapitalFirm.java:330` | amount | — | |
| 21 | `CopyOf…2WagesEnd.payWages masa salarial > depósito` | 2275 | `CopyOfConsumptionFirm2WagesEnd.java:127`, `CopyOfCapitalFirm2WagesEnd.java:128` | amount | — | |
| 21 | `… salario < depósito` | 2299 | `CopyOfConsumptionFirm2WagesEnd.java:149`, `CopyOfCapitalFirm2WagesEnd.java:147` | amount | — | Agente: la empresa (el trabajador sale del orden) |
| 24 | `ProfitsWealthTaxStrategy.computeTaxes impuestos > depósito` | 2569 | `jmab/strategies/ProfitsWealthTaxStrategy.java:47` | amount | empresa | |
| 25 | `FixedShareOfProfitsToPopulationAsShareOfWealthDividends.payDividends ganancia > 0` y `ganancia > 0 (banco)` | 2782, 2809 | `modellone/strategies/FixedShareOfProfitsToPopulationAsShareOfWealthDividends.java:53` | amount | empresa / banco | Misma línea de JMAB: se unifica el nombre (F2) |
| 25 | `… depósito > dividendos` | 2786 | `FixedShareOf….java:79` | amount | empresa | |
| 25 | `… ganancia > depósito` | 2788 | `FixedShareOf….java:81` | amount | empresa | |
| 27 | `MostPayingDepositWithSwitching.selectDepositSupplier más alta` | 2898 | `jmab/strategies/MostPayingDepositWithSwitching.java:78` | pure | — | |
| 27 | `… previo < máximo` | 2905 | `MostPayingDepositWithSwitching.java:92` | pure | depositante | Solo si previo ≠ máximo |
| 28 | `BankBankruptcyBailoutCAR.bankrupt patrimonio < 0` | 3073 | `modellone/agents/Bank.java:244` (`determineBankruptcy`) | amount | banco | |
| 29 | `Government.emitBonds déficit < 0` | 3122 | `modellone/agents/Government.java:187` | amount | — | Agente: el gobierno |
| 29 | `… ⌈\|déficit\| / precio⌉` (techo) | 3123 | `Government.java:188` | amount (en µ) | — | |
| 31 | `BondDemandStrategyReserves.bondDemand rama 1 (empleables ≥ oferta)` | 3216 | `modellone/strategies/BondDemandStrategyReserves.java:95` | amount | banco | |
| 31 | `… rint` | 3222 | `BondDemandStrategyReserves.java:96` o `:99` (`Math.rint`) | amount (en µ) | banco | Hoy se registra después de calcular (F3) |
| 35 | `BondMechanism.execute reservas < monto` | 3374 | `jmab/mechanisms/BondMechanism.java:91` | amount | banco | |
| 36 | `BaselIIIReserveRequirementsBLR.computeCreditDemand demanda > 0` | 3420 | `Bank.java:285` | amount | banco | Ver C8 (pedido de menos de 0,5 µ) |

Eventos sin decisiones registradas (medido): 3, 4, 8, 13, 16, 22, 23, 26, 30, 32, 33, 34, 37, 74 y 75. En el 75 falta una (B5).

## B. Comparaciones de JMAB sin registro en el port: a registrar

Cada una decide una rama, puede quedar dentro de la tolerancia y el port hoy la toma sin registrar.

| # | Ev. | JMAB | Port (events.ts) | Clase | Agente | Por qué |
|---|---|---|---|---|---|---|
| B1 | 9 | `CopyOfConsumptionFirm2WagesEnd.java:233` y `CopyOfCapitalFirm2WagesEnd.java:221` `if (creditDemanded>0)` (activa en el mercado de crédito) | 901 `f.creditDemanded > 0` (µ) | amount | empresa | El caso de las zombis (ticks 292, 293 y 300): el pedido de 10⁻¹⁴ es 0 µ. En la medición de la opción (d) hubo que emularlo |
| B2 | 9 | `CopyOfConsumptionFirm2WagesEnd.java:204` `int inv = (int)inventories.getQuantity()` | 814 `Math.trunc(inventories.quantity)` | fromAmounts (piso) | empresa de consumo | El inventario de consumo es un `double` de montos: 2,9999999 contra 3,0000001 cambia el entero. En las de capital (`CopyOfCapitalFirm2WagesEnd.java:204`, events.ts 859) es entero exacto |
| B3 | 15 | `ConsumptionFirm.java:495` `if (inventories.getQuantity()>0)` (`produce`: activa en el mercado de consumo) | 1423 `c.active[MKT.CONSGOOD] = inventories.quantity > 0` | fromAmounts | empresa de consumo | Un inventario residual queda activo en un lado y no en el otro |
| B4 | 20, 21 | `FirmBankruptcyFireSales.java:114` `if (totalDebt!=0)` | 1998 `if (totalDebt === 0) return` (µ) | amount | empresa | Con una deuda residual, JMAB entra al reparto: paga el residuo y **pone el depósito en 0** (la rareza del excedente que desaparece). El port sale antes y la empresa conserva el depósito. No sé si pasa: lo dice el registro |
| B5 | 75 | `Households.java:223` `qty+=c.getQuantity()` (`(int)(qty + cantidad)`, una por bien) | 3656 `Math.trunc(qty + g.quantity)` | fromAmounts (piso) | hogar | Las cantidades son de montos (evento 18): una suma de 0,9999999 contra 1,0000001 cambia el entero y con él la observación del precio. ~1–2 por hogar |
| B6 | 18, 35 | `AbstractMechanism.java:85` (condición del bucle de `reallocateLiquidity`), llamado también desde `AtOnceMechanism.java:73` en el 18 y `BondMechanism.java:88` en el 35 | 18: 1709 `batch.balance(target.id) < needed` (sin registrar); 35: no hay (el port no llama a nada) | amount | hogar (18), banco (35) | JMAB evalúa la condición una vez por compra aunque en el base no tenga efecto (una sola cuenta). Para que las dos secuencias se emparejen hay dos opciones: **(a, recomendada)** el port la registra en el 18 (en 1709, que ya es esa comparación) y en el 35 (antes de "reservas < monto", con los mismos operandos); **(b)** el oráculo la registra solo cuando la llama `AtOnceMechanism` con un bien de capital. (a) es más fiel y cuesta ~8.000 líneas por tick |

## C. Comparaciones que no hace falta registrar

Cada una por un motivo de la lista. Si una de estas se da vuelta, el V3 lo ve igual como diferencia de estado; no se excusa nada.

- **C1. Enteros exactos:** `nbWorkers > currentWorkers` (`ConsumptionFirm.java:317`, `CopyOf…:177`, `GovernmentAntiCyclical.java:155`, `Government.java:267`), `employedWorkers < residualWorkers` (`ConsumptionFirm.java:468`), `laborDemand > 0` y `== 0`, `desiredRealCapitalDemand > 0` (`ConsumptionFirm.java:424`, entero de un `Math.round` registrado), `bondDemand > 0` (`Bank.java:362`, entero de un `rint` registrado), cantidades de capital y de bonos (`BondMechanism.java:68, 70, 97, 107`; `CapitalFirm.java:655–662`), edades de los préstamos y del capital, `qty != 0` (`Households.java:225`: el entero sale de B5), y la referencia micro del salario (`AdaptiveWageStrategy.java:46`: trimestres desocupado / 4 contra 0,49, a distancia ≥ 0,01).
- **C2. Infinito en el base:** oferta de crédito (`ConstrainedCreditMechanism.java:81`, `Bank.java:384`: +∞), comparaciones con ±∞ de "sin previo" (`CheapestGood…:121`, `CheapestLender…:127`, `BestQuality…:140`, `MostPaying…:93`).
- **C3. Ausencia de acción** (la rama solo mueve un residuo; en µ el estado es el mismo): efectivo > 0 (`ConsumptionFirm.java:340, 648, 696`; `CapitalFirm.java:287, 317, 457`; `CopyOf…:118/119`; `FirmBankruptcyFireSales.java:87`: en el base el efectivo de las empresas es 0), `cashHeld != cashAmount` (`DepositMechanism.java:139`), traspasos de `reallocateLiquidity` de 0 µ (events.ts 1852), excedente de la quiebra > 0 (events.ts 2027), pagos de impuestos y de dividendos > 0 (events.ts 2570, 2580, 2603, 2608, 2660, 2674, 2764).
- **C4. Continuas** (`Math.min`/`max` cuyo resultado no elige una rama después): `Math.max(wage, piso)` (`AdaptiveWageStrategy.java:53`), `Math.min(taxes, liquidity)` (`Households.java:317`), `Math.max(…, 0)` de los impuestos (`ProfitsWealthTaxStrategy.java:44, 51`), `Math.max(tasa del banco, tasa de bonos)` (`Bank.java:139`), `Math.min` del monto prestado (`ConstrainedCreditMechanism.java:61`), `Math.max(0, …)` de las reservas empleables (`BondDemandStrategyReserves.java:76, 89`: entran a decisiones registradas) y de `reallocateLiquidity` (`AbstractMechanism.java:90`).
- **C5. Consecuencia de una registrada** (si la registrada se fuerza, esta sigue sola): `demand == 0` y `output == 0` después de la compra (`AtOnceMechanism.java:107, 111`; events.ts 1737) salen de "demanda ≤ inventario"; `quantity > 0` (`AtOnceMechanism.java:85`); `desiredOutput > 0` (`ConsumptionFirm.java:828`; events.ts 280) sale del piso de `targetOutput`; `neededDiscount < minWageDiscount` (`CopyOf…:131`) es la misma que "masa salarial > depósito" con `minWageDiscount` = 1; `taxes > liquidity` (`ConsumptionFirm.java:538, 546`; `CapitalFirm.java:612, 619`) es inalcanzable después de la registrada en `ProfitsWealthTaxStrategy.java:47` (el port tira error); `proba == 1.0` (`AbstractSwitchingStrategy.java:70`) solo con x > ~745; `proba == 0.0` sale de "potencial < previo".
- **C6. No corren en el base:** `selectMultipleGoodSupplier` (`CheapestGood…:145–165`, `BestQuality…:150+`: nadie la llama); `getReferenceVariableForInterestRate` (`Bank.java:547, 566`: la estrategia usa `getCapitalRatio`/`getLiquidityRatio`); `LaborMechanism` (el base usa `UnconstrainedLaborMechanism`, sin comparaciones de montos); la rama `binaryDecision` (`ExpectedReturnCreditSupply.java:79–80`: falso en el base); los pisos de I+D (`CapitalFirm.java:363, 372, 401, 433, 480`; `CopyOfCapital…:217`: `amountResearch` = 0); `price == Double.NaN` (`AdaptiveMarkUpOnAC.java:67, 70`: siempre falso en Java).
- **C7. Redondeos a µ del port** (no son decisiones de JMAB, son la representación del port): intereses del BC (events.ts 173, 177), `depositAmount` (2868), `advancesDemand` (3412). El error que agregan lo cubren las anotaciones de error de entrada.
- **C8. A mirar: Basilea con un pedido de menos de 0,5 µ.** Si JMAB pide 0 < x < 0,5 µ (evento 36), el port lo redondea a 0 µ, "demanda > 0" es frágil y se fuerza: el banco queda activo con 0 µ y el evento 37 tira su error explícito ("pedido ≤ 0"). En 7 semillas × 400 trimestres el único pedido positivo conocido es de 994,90 (tick 292). Propuesta: dejarlo así (error explícito si pasa, regla de la sec. 1) y no portar nada hasta que el oráculo lo muestre.

## D. Decisiones que JMAB repite y el port evalúa una vez

El oráculo las registra **una vez** y verifica las repeticiones: **silencio con verificación**. Un indicador del oráculo (`Decisions.mute()`/`unmute()`) apaga el registro durante las llamadas repetidas. En cada repetición compara el resultado con el registrado y, si difiere, tira un error.

- **D1. Evento 6, elegibilidad de los bancos.** `computeInterestRate` recorre los diez bancos dentro del cálculo de cada banco (`CopyOfAdaptive….java:66–76`): 100 evaluaciones en JMAB, 10 en el port. Se registran en la llamada del primer banco; en las otras nueve se verifica que el conjunto elegible y los dos promedios sean idénticos.
- **D2. Eventos 20 y 21, "liquidez ≥ deuda".** Está dentro del bucle por préstamo (`FirmBankruptcyFireSales.java:119`) con operandos que no cambian en el bucle; el port la evalúa una vez. Se registra con el primer préstamo.
- **D3. Eventos 1 y 2, `getPriceLowerBound`.** `AdaptiveMarkUpOnAC.computePrice` lo llama hasta cinco veces (61, 62, 70, 73 y 77), y cada llamada pasa por `getRequiredWorkers` (residual y `Math.round`). El port lo llama una vez (el comentario de `adaptiveMarkUpPrice` ya lo dice). Se registra la primera llamada y se verifica que las otras devuelvan el mismo piso.
- **Los que no se vean leyendo los aparece el paso 2:** en el suelto de `p3-t133` con el registro, una repetición que falte en esta lista se ve como desalineación (lugar o agente de más del lado de JMAB) y se agrega acá antes de seguir.

## E. Lugares del port que en JMAB no son una rama

El oráculo registra la expresión con los mismos operandos que el port: `targetOutput` (`Math.max`), el piso y el techo de la tasa (`Math.min/max`), "requerimiento > liquidez" (`Math.max`), "demanda ≤ inventario" (`Math.min`), `max(−1, g)` (`Math.max`), "aporte negativo" (el signo de `amountToPay`; operandos: la pérdida del préstamo o la total, la más cercana a 0 relativa a su valor inicial, como el port), los redondeos (`Math.round`, `floor`, `ceil`, `rint`). Forzar una de estas devuelve el valor de la otra rama: 0 en vez de x, el entero de al lado.

## F. Cambios en el port que salen del inventario (paso 3 del plan)

1. **F1. Agente en todos los lugares**, según la convención. `flooring`, `ceiling` y `rounding` lo reciben.
2. **F2. Un nombre por línea de JMAB:** `ConsumptionFirm.getPriceLowerBound Math.round(trabajadores)` pasa a `ConsumptionFirm.getRequiredWorkers Math.round(trabajadores)` (misma línea 298); `… ganancia > 0 (banco)` pasa a `… ganancia > 0`. Es un cambio de texto: el estado no cambia.
3. **F3. Los cuatro lugares que solo observan** pasan a usar lo que devuelve el helper (piso de `targetOutput`, "activo" de las de capital, piso y techo de la tasa, `rint` de los bonos), con el hash de estado en PRNG antes y después, obligatorio.
4. **F4. Registros nuevos B1–B6** (B6 con la opción que elija Nico).
5. **F5. Clases por origen (aprobado):** las marcadas "→ de montos (consumo)" en la tabla A. Agrego una que no estaba en la lista aprobada y sale del mismo criterio: **"referencia > umbral" del margen** (referencia = inventario / ventas reales rezagadas: de montos en las de consumo; en las de capital, entero / entero). A confirmar.

## G. Cocientes con denominador en µ (regla del cociente indeterminado)

Cocientes cuyo denominador puede quedar en 0 µ en el port con un residuo en JMAB:

| Cociente | Dónde | Lo lee | Hoy |
|---|---|---|---|
| Ratio de capital = patrimonio rezagado / préstamos | evento 0 (`Bank.java:194`; events.ts 163) | evento 6 (umbral y referencia) y evento 28 (promedio de los otros bancos para el objetivo del rescate) | **Pasa:** 22 banco-ticks en la semilla 102 (abajo). El evento 28 tira error si el promedio no es finito; nunca pasó en las 85 quiebras de bancos medidas |
| Recupero esperado = valor del capital / deuda de la empresa, con `Math.min(1, ·)` | evento 10 (`ExpectedReturnCreditSupply.java:57`; events.ts 962) | "rendimiento esperado ≥ 0" | Una empresa sin deuda y sin capital da NaN en los dos lados; con un residuo de deuda en JMAB, 1 o un finito. No medido: lo dirá el registro (el operando de la decisión) |
| Piso del precio sin producción = salario × trabajadores(inventario) / inventario | evento 2 (`ConsumptionFirm.java:828+`; events.ts 286) | precio y margen | NaN en los dos con inventario 0 exacto; con un inventario residual en JMAB, un finito. Sin casos conocidos |
| Reparto de la liquidez en la quiebra = liquidez × deudaᵢ / deuda; aportes de los dueños = D × w / W × lᵢ / Λ | eventos 20 y 21 (`FirmBankruptcyFireSales.java:118, 166`) | pagos | **No está protegido por B4** (lo dije mal antes, corrección de Nico): con B4 forzado (deuda 0 µ) el reparto no divide, pero los aportes sí (Λ = 0 µ). Ver H, B4 |

Los demás cocientes con denominador en µ ya tienen su decisión registrada (ratio de liquidez: "depósitos = 0"; crecimiento deseado: "capacidad = 0" y "K = 0") o tienen denominadores que no se acercan a 0 (patrimonio total de los hogares, umbrales con n = 0 en los dos lados).

**Vigilancia pedida por Nico** (reportes de JMAB que ya existen, sin correr nada; `reference/tools/indeterminate-ratio.py`). `banksCapitalRatio` es el ratio del evento 0 de cada tick, el que lee el evento 6:
- 7 semillas × 400 trimestres: **22 banco-ticks con ratio ±∞** (préstamos 0.0 en el evento 0), todos en la semilla 102: 8257 en los ticks 280–284 y 8258 en el 298–314. **22 ticks de 2.800 (0,8%)**; en las otras seis semillas, ninguno. 10 con +∞ (JMAB toma la rama "por encima del promedio"; el port, con NaN, la otra) y 12 con −∞ (misma rama que NaN).
- **El residuo que entra al promedio no pasa nunca:** ningún ratio finito fuera de lo normal (|ratio| > 10). Los residuos de 10⁻¹⁴ que aparecen en el reporte de crédito, que corre a mitad del tick (ticks 279, 280, 297 y 298), se cancelan antes del evento 0 siguiente.
- **Peso en V4:** en una corrida larga del port, en esos 22 ticks el banco zombi elige la rama de NaN. Difiere de JMAB en 10 de 22 decisiones de tasa de un solo banco, sin préstamos y que no recupera clientes. Es pendiente de V4 (pendientes.md), no de la V3.
- **El tramo 297 → 299:** en el 297 el ratio de 8258 es normal (todavía tiene préstamos en el evento 0). En el **298, +∞**: decisión indeterminada que se fuerza. En el **299, −∞**: misma rama que NaN, se cuenta como indeterminada. En los dos el banco queda fuera del promedio, así que el umbral de los otros nueve no se contamina. Las corridas del tramo con volcados y `decisions.tsv` se hacen con el oráculo ya instrumentado (una corrida da las dos cosas).

## H. La rama forzada con el operando en 0 µ (pedido de Nico, 2026-11-16)

Forzar lleva al port a un camino que, con sus valores, no habría tomado. Esta sección dice, para cada lugar de A y B que se puede forzar, qué hace el port en la rama forzada cuando el operando que hacía frágil la decisión vale 0 µ (o está en el umbral), y qué se propone. **Nunca un NaN que se propague en silencio:** cada camino reproduce el resultado de JMAB o termina en un error explícito.

### H.0 Qué no se puede forzar

`decisionDistance` mide un `double` contra 0 en relación con max(|a|, |b|) cuando no se pasa escala: da 1 si a ≠ 0 y 0 si a = 0. Esa decisión es frágil solo si el operando es **0 exacto**. Si el port da 0 y JMAB un residuo, la de JMAB no es frágil y es **falla**, no forzada. Quedan así, sin camino forzado que analizar: "piso ≠ 0" del margen; "capacidad = 0" y "K = 0"; "activo (inventario)" de las de capital (un entero); `Math.round(I+D/salario)` (x = 0, a distancia 1 de 0,5). Varias de las frágiles del censo son de estas: son 0 contra 0 de las zombis, frágiles pero con el mismo resultado en los dos lados.

### H.1 Reglas generales (propuesta)

- **R1. Nunca un saldo negativo por una rama forzada.** Si la rama forzada paga más que el saldo disponible (salario, compra, impuestos, cuota, dividendo, traspaso), el exceso es ≤ 2 µ porque la decisión era frágil de los dos lados. El port paga hasta el saldo y lo que falta queda sin pagar. JMAB paga el monto entero con un saldo apenas mayor: la diferencia está dentro de la tolerancia. Un traspaso o un dividendo que la rama forzada da negativo (−ε) es 0 (ausencia de acción).
- **R2. Decisión sobre un residuo** (aprobada por Nico, 2026-11-16, con límites: **solo operandos de clase `amount` o `fromAmounts`, nunca `pure`, y solo si el operando del port es 0 µ exacto**, no "chico"; cada corrida informa por evento cuántas decisiones se toman por R2 y cuántas líneas de JMAB se consumen sin evaluar, como las hasta 101 de la búsqueda de oferta de las zombis). Una decisión de JMAB cuyos operandos de montos son **todos ≤ 2 µ en valor absoluto**, y la del port con esos montos en 0 µ: la medida relativa de la clase compara ruido contra ruido y no sirve. El arnés toma la rama de JMAB **sin pedir fragilidad relativa**, pero verifica en el registro que los operandos de JMAB sean ≤ 2 µ (si no, falla). Las cuenta aparte ("sobre un residuo", por evento, como las forzadas y las indeterminadas). Los montos que resultan en el port son 0 µ (los de JMAB, < 2 µ). Es una excepción a la regla de las frágiles: **pide el OK de Nico**.
- **R3. Error explícito.** Una rama forzada que dividiría por 0 µ, dejaría una cantidad o un inventario negativo, o llevaría a un camino que JMAB recorre con valores que el port no tiene (un bien de cantidad residual), tira un error con el lugar, el agente, el tick, los operandos de los dos lados y "rama forzada no portada". Se porta cuando el oráculo muestre el caso (regla de la sec. 1).
- **R4. Control de NaN en modo oráculo** (aprobado; la lista de los NaN documentados, explícita y corta, está en reglas-caiani.md, sec. 1). Después de cada evento, el arnés busca NaN en el estado del port. Uno que no esté en la lista de los documentados (cocientes indeterminados de la G, piso del precio con inventario 0 como JMAB 2015) es falla, aunque compareState no lo vea.

### H.2 Lugar por lugar

"Visto" = hubo frágiles en el censo o forzadas en la medición de (d). Esos tienen que funcionar; los demás pueden quedar como R3 hasta que aparezcan.

| Lugar | Rama forzada con 0 µ (o en el umbral) | Qué hace hoy el port | Propuesta |
|---|---|---|---|
| `targetOutput` (x > 0, con escala de los términos) | x > 0 con x_port ≤ 0 | `desiredOutput` = x ≤ 0; en el evento 2, `desiredOutput > 0` va por la otra rama que JMAB (piso con el inventario): otro piso y otro precio | **R3** (no visto). Reproducirlo exigiría usar el x de JMAB como valor |
| `targetOutput` | x ≤ 0 con x_port > 0 | `desiredOutput` = 0, como JMAB | Seguir |
| "activo (⌊Y*⌋)" | cualquiera | Solo la bandera | Seguir |
| "depósitos = 0" | falso con depósitos 0 µ | reservas / 0: ∞ o NaN | **R3** (un banco sin depósitos no pasa nunca, vigilancia del 28) |
| "referencia > umbral", "precio > piso", "residual > capacidad", los `Math.round` de trabajadores y de la demanda de capital, "obsolescencia", "deseada ≥ residual", `max(−1, g)` | cualquiera | Ramas continuas o enteros ±1, sin divisiones por el operando. "deseada ≥ residual" forzada con deseada < residual da x = −ε y `Math.round` → 0, como JMAB | Seguir (vistos: los `Math.round` de trabajadores, "deseada ≥ residual") |
| `switches` "potencial < previo" / "previo < potencial" | verdadero con potencial = previo (o al revés por ε) | x = λ·(previo − potencial)/potencial ≤ 0: con x < 0, **error** ("exponente positivo"); con x = 0, p = 0 y **no sortea**. JMAB sortea una Bernoulli con p ~ ε: el registro de sorteos queda desalineado | x = max(x, 0) y, **solo en modo oráculo**, la Bernoulli se pide aunque p = 0. El `OracleCaianiRng` da el resultado de JMAB y la guarda compara las p (\|p_port − p_JMAB\| ≈ ε, dentro de la guarda). En modo PRNG no hay forzadas: nada cambia |
| "más barato", "mejor atractivo", "más alta", "previo < …" / "previo más caro" / "previo > mínimo" | cualquiera | Elige el otro proveedor, o va a `switches` con previo = mejor (fila anterior) | Seguir |
| "ratio > promedio" | cualquiera | Rama de la tasa | Seguir; ratio indeterminado: regla de la sec. 40 |
| "piso 0" y "techo" de la tasa | la rama de iR con iR_port ≤ 0 (o ≥ techo) | Tasa −ε: JMAB tiene +ε, y la comparación del campo (relativa) falla | **R3** (no visto) |
| "préstamos ≠ 0" (evento 6) | verdadero con préstamos 0 µ | El banco entra al promedio con su ratio NaN/±∞ | Regla del cociente indeterminado (punto 4). Medido: 0 casos en 7 × 400 |
| "patrimonio > 0" (evento 6) | verdadero con patrimonio 0 µ | Entra con ratio 0 / préstamos = 0 (préstamos > 0) | Seguir |
| "requerimiento > liquidez" (**visto**: zombis) | verdadero con req ≤ liq | Hoy devuelve req − liq: 0, o **negativo** si req < liq | Devolver max(req − liq, 0) µ (JMAB: un residuo < 2 µ) |
| **B1** activación (**visto**) | verdadero con pedido 0 µ | La empresa entra al 10 con pedido 0 µ (fila siguiente) | Seguir |
| "rendimiento ≥ 0" con pedido 0 µ (**visto** con B1) | — | El port sale con `amount === 0` sin registrar nada. JMAB recorre la búsqueda con montos de 10⁻¹⁴·(1 − i/100) y registra hasta 101 decisiones sin par | **R2:** en modo oráculo, con pedido 0 µ el port consume las líneas de JMAB de ese par banco-empresa (hasta la primera verdadera o 101), verifica que el pedido de JMAB sea ≤ 2 µ y toma oferta 0 µ |
| "se le dio todo" (**visto**) | falso con 0 µ = 0 µ | Sigue activa con pedido 0; el préstamo de 0 µ ya se abrió (JMAB: uno de ≤ 10⁻¹⁴) | Seguir (medido en (d): 0 diferencias) |
| "desempleo > umbral", "más barato" (trabajo) | cualquiera | Ramas sin operandos en µ | Seguir |
| "demanda > 0" (con escala) | verdadero con demanda_port ≤ 0 | El hogar entra al 18 con demanda ≤ 0 y no compra. JMAB compra un bien de cantidad residual (un bien de más en su lista) | **R3** (no visto) |
| "demanda ≤ inventario" | cualquiera con demanda ≈ inventario | Puede dejar el inventario o la demanda en −ε; después, "inventario = 0" y "demanda = 0" (C5) pueden no seguir | Seguir si lo que queda es ≥ 0; si queda negativo, **R3** (no visto) |
| "depósito < monto" (consumo y capital, **visto** en el 103 y el 133) | falso con saldo < monto (≤ 2 µ) | Paga el monto entero: saldo −ε | **R1** (en el 133 fue −10⁻⁹ µ y el redondeo del lote lo absorbió; con más, saldo negativo) |
| "cantidad con el depósito" (pisos, **vistos**) | k + 1 | Paga (k + 1)·precio > saldo por ≤ 2 µ | **R1**. Con k − 1, seguir (lo medido en el 103: 24 → 23) |
| "reunido < monto" (`reallocateLiquidity`) | verdadero con reunido ≥ monto | Traspaso = monto − reunido ≤ 0: un pago negativo | **R1:** traspaso 0 |
| "depósito agotado" | cualquiera | Solo la bandera | Seguir |
| **B2**, **B5** (truncados) | k ± 1 | Enteros. B5 con 0 va a la rama "sin cantidad" (la observación es la expectativa), que el port ya tiene | Seguir |
| **B3** activo con inventario | verdadero con inventario 0 | Activa con 0: no vende. JMAB vende un bien de cantidad residual | **R3** (no visto) |
| **B4** "deuda ≠ 0" | verdadero con deuda 0 µ | Entra a la quiebra: (i) liquidez > 0: "liquidez ≥ deuda" da verdadero, paga 0 y el excedente (todo el depósito) se da de baja. **Es lo de JMAB** (depósito en 0, la rareza del excedente). (ii) liquidez 0: rama `liquidity === 0`, paga 0. (iii) En una de consumo: pérdida total Λ = 0 µ, los dueños aportan min(capital, 0) = 0 y el aporte de cada hogar es 0 × w/W × 0/0 = **NaN**: hoy, error | (i) y (ii) seguir: el reparto no divide (con deuda 0 µ y liquidez > 0 la rama del reparto proporcional no se alcanza; si se alcanzara, **R3**). (iii) Si el Λ de JMAB (operando del registro) es ≠ 0, los aportes de JMAB son residuos: aportes 0 µ y cada "aporte negativo" por **R2**. Si es 0 exacto, JMAB mismo escribe NaN en los depósitos (rareza registrada): **R3** |
| "liquidez ≥ deuda" | falso con liquidez ≥ deuda | Reparto proporcional: con liquidez > deuda, sobrepaga cada préstamo por ≤ 2 µ | **R1** (cada parte hasta su saldo). Liquidez 0: seguir |
| "liquidez ≥ deuda" | verdadero con liquidez < deuda | Paga las deudas enteras: depósito −ε | **R1** (la última cuota hasta el saldo); el depósito termina en 0, como JMAB |
| "valor del capital > pérdida" | cualquiera | Dueños = pérdida o capital (≈ iguales) | Seguir; con Λ = 0 µ, como B4 (iii) |
| "aporte negativo" | cualquiera | Cobro o pago de un monto de ≤ 2 µ; forzado al signo contrario, un pago de −ε | **R1** (0 µ); con Λ residual, **R2** |
| "liquidez ≥ servicio" (**visto**: 0 contra 0 en zombis) | falso | `firmBankruptcy` con todo en 0: B4, "liquidez ≥ deuda", "valor del capital > pérdida", aportes (filas de arriba) | Seguir, con las filas de arriba |
| "liquidez ≥ servicio" | verdadero con liquidez < servicio | Paga las cuotas: depósito −ε | **R1** |
| "masa salarial > depósito" | verdadero sin empleados | n = 0. JMAB divide por la masa salarial 0 (descuento −∞ o NaN) y paga NaN | **R3** |
| "masa salarial > depósito" | verdadero con empleados | Reparto del depósito entre n > 0 y quiebra, como JMAB | Seguir |
| "salario < depósito" | verdadero con salario ≥ saldo | Paga el salario: saldo −ε | **R1** |
| "impuestos > depósito" (**visto**: zombis) | falso con impuestos > depósito | Impuestos > depósito y el control de la línea 2575 tira el error "inalcanzable" | **R1:** impuestos hasta el depósito |
| "ganancia > 0" (empresa y banco, **visto**) | verdadero con ganancia ≤ 0 | Dividendos = ganancia × parte ≤ 0: un pago negativo si el depósito es > 0 | Ganancia = max(ganancia, 0) en la rama forzada: dividendos 0 (**R1**). Con depósito 0 (zombis), "depósito > dividendos" ya corta |
| "depósito > dividendos", "ganancia > depósito" | forzada con dividendos > depósito por ≤ 2 µ | Paga más que el depósito | **R1** |
| "patrimonio < 0" (banco) | verdadero con patrimonio 0 µ | Rescate con H = objetivo − 0 ≥ 0 | Seguir |
| "patrimonio < 0" | falso con patrimonio −1 o −2 µ | Sin rescate | Seguir |
| "déficit < 0" y su techo | verdadero con déficit 0 µ | ⌈0⌉ = 0 bonos; el techo, frágil (0 contra 10⁻⁸ µ de JMAB), se fuerza a 1, como JMAB | Seguir |
| "rama 1" de los bonos | verdadero | S·propias / E: E = 0 solo con S = 0, y con S = 0 la decisión no se puede forzar (E/precio ≥ 0 siempre) | Seguir, con una guarda **R3** si E = 0 |
| `rint` de los bonos | k ± 1 | Entero ≥ 0 | Seguir |
| "reservas < monto" (35) | verdadero | Ya es error explícito (rama no portada) | Igual |
| Basilea "demanda > 0" | verdadero con 0 µ | Activo con 0 µ; error explícito en el 37 | **C8**, aprobado |
| **B6** `reallocateLiquidity` (18 y 35) | cualquiera | Sin efecto (una sola cuenta): traspasos de 0 | Seguir; R1 si un traspaso da negativo |

### H.3 Qué cambia en el plan

**Aprobado por Nico (2026-11-16):** R1, R3 y los cuatro casos con camino propio, tal como están; R2 y R4 con los límites de arriba. **Diseño:** los caminos que existen solo para la rama forzada (R1, R2 y los cuatro casos) quedan aislados detrás del registrador (solo se alcanzan con un registrador en modo oráculo) y marcados en el código con un comentario uniforme, `// solo rama forzada (modo oráculo): inventario-decisiones H`, para que nadie los confunda con reglas del modelo. El hash de estado en PRNG antes y después sigue siendo obligatorio.


- **Paso 3 (motor):** los caminos "Seguir con …" y R1 son cambios en las ramas forzadas, que solo se alcanzan con el registrador en modo oráculo. Con eso el modo PRNG y V4 no cambian, y el hash de estado en PRNG antes y después lo verifica.
- **Paso 4 (arnés):** R2 (consumo de líneas sobre un residuo, con el control absoluto) y R4 (control de NaN), con sus contadores por evento.
- **Para que aparezcan los R3:** el error dice "rama forzada no portada". Si aparece uno en el V3, se para y se consulta.

## I. Paso 2 hecho: oráculo instrumentado y verificado en el tick 133 (2026-11-16)

**Instrumentación.** Clase nueva `oracle/Decisions.java` (`reference/p0/oracle/src`), con métodos que devuelven exactamente la expresión de JMAB (`rec`, `gt`, `ge`, `lt`, `eq`, `round`, `floor`, `toInt`, `ceil`, `rint`), silencio con verificación (`mute`, `verify`, `memo`) y registro solo en los eventos que porta el port (0–37, 74 y 75). Son 78 llamadas en 26 archivos del fuente de 2015, todas marcadas `// P3 d1: oracle.Decisions`, más D1 (elegibilidad del evento 6), D2 ("liquidez ≥ deuda" con el primer préstamo) y D3 (`getPriceLowerBound` repetido). Copia del fuente anterior en `reference/p0/oracle/src-pre-d1.tgz` y del `.jar` en `oracle-pre-d1.jar`. `run-oracle.sh` escribe `decisions.tsv` y lo comprime (`decisions.tsv.gz`). Todos los nombres de lugar del port tienen su línea en el oráculo (comparado contra el censo).

**Solo observa (verificación byte a byte).** `p3-t133-d1` (misma semilla, ticks y volcados que `p3-t133`; 7,5 minutos), comparada con `reference/tools/compare-runs.sh`: **`draws.tsv`, los 47 volcados y los 37 CSV de `data/` idénticos byte a byte** (86 archivos). `clean.tsv` difiere solo en 5 líneas `hh0`: la vigilancia del hogar sin bienes, que se agregó al oráculo después de la corrida original. Sin esas líneas es idéntico. Las verificaciones de D1–D3 no saltaron. `decisions.tsv`: 314.525 líneas en el tick 133, 4,3 MB comprimido.

**Emparejamiento port ↔ oráculo** (`reference/tools/decisions-align.test.ts`, salida en `reference/p0/runs/oracle/decisions-align.txt`): cada evento suelto del port, sin forzar nada, contra el registro. Del lado de JMAB se descuentan los registros nuevos que el port todavía no tiene (B1–B5, y B6 en el 18 y el 35: 8.415 líneas) y se traducen los nombres de F2.
- **35 de 39 eventos alineados:** mismo largo, mismos lugares en el mismo orden y mismo agente donde el port lo pasa. Operandos `double` idénticos. Montos ≤ 1 µ por el redondeo de las entradas, salvo las sumas de muchos contratos: patrimonio y reservas de los bancos, hasta ~50 µ (rama 1 de los bonos 48,8 µ, "patrimonio > 0" 25 µ, "ganancia > 0" 19,6 µ, "patrimonio < 0" 18,7 µ).
- **Evento 19:** se separa en el vuelco conocido de 8140 ("depósito < monto" a distancia 0). Es lo esperado sin forzar.
- **Eventos 0 y 9, orden de los agentes:** JMAB recorre primero las empresas de consumo y después las de capital; el port, al revés. Cada empresa decide sola (sin sorteos ni estado compartido), así que el resultado no cambia y el V3 no lo veía. Para d1 importa el orden. **Propuesta:** el port recorre en el orden de JMAB (consumo primero) en los eventos 0 y 9, con el hash de estado en PRNG antes y después.
- **Evento 21, "aporte negativo"** (8.000 resultados distintos, todos de un préstamo): la empresa 8183 quiebra con 18 préstamos. En el primero, la pérdida de JMAB es un residuo (−9,2·10⁻¹⁴) y la del port 0 µ: JMAB registra un reembolso de un residuo y el port no. Es el caso de R2. Para que R2 lo reconozca, el port tiene que usar como operando la pérdida del préstamo cuando su valor inicial es 0 µ: hoy la comparación de distancias da 0/0 = NaN y elige la pérdida total (1.638). El estado coincide porque los montos son residuos.
- **Lo que falta en el port** es justamente el paso 3: registros B1–B6, F2, el orden de los eventos 0 y 9, el operando del aporte, los caminos de H.

## J. Paso 3: cambios en el motor (2026-11-16)

Aprobado por Nico (2026-11-16): el orden de los eventos 0 y 9, el operando del aporte con pérdida 0 µ, la distancia NaN como error y la fragilidad de los operandos agregados con su error de entrada.

**`decisions.ts`.**
- **Núcleo `decide`:** lo usan todos los helpers. En modo oráculo:
  - empareja con la línea siguiente de JMAB del evento y falla si el lugar o el agente no coinciden;
  - toma la rama de JMAB si las dos decisiones son frágiles (en los enteros, si difieren en 1), o por R2;
  - si no, falla.
  - Al terminar el evento, una línea de JMAB sin par es falla (`finishEvent`).
- **Contadores por evento:** forzadas (frágiles y R2), líneas de JMAB consumidas sin evaluar (`consumeResidue`), alarmas (forzada a más de 2 µ en montos o fuera de la tolerancia del suelto en `double`) y el mayor |ε| de los operandos agregados por lugar.
- **NaN:** `decisionDistance` tira error con un NaN salvo `nanOk`. Los lugares declarados son dos, en reglas-caiani.md, sec. 1 (a confirmar).
- **Operandos agregados:** los helpers aceptan los términos de entrada de cada operando (`inputs`). Con un registrador que sabe evaluarlos (`inputError`, que en el arnés es `InputCarry.inputError`), la fragilidad se mide con los operandos corregidos por su error de entrada.
- **Sin registrador** (modo PRNG, V4, la app), los helpers devuelven la comparación de siempre.

**`rng.ts`.** `bernoulli(site, p, opts)`:
- `sensitivity` es la guarda de la p derivada del mecanismo (aprobada). El oráculo la usa en lugar de la tolerancia relativa cuando quien llama la da.
- `forced` sortea aunque p ≤ 0 (solo rama forzada).
- El modo PRNG ignora las dos.

**`events.ts`.**
- **Orden de JMAB** en los eventos 0 y 9: primero las empresas de consumo.
- **F1:** agente en todos los lugares salvo "más barato" del trabajo (el port no tiene al empleador ahí; el oráculo registra la empresa) y `switches` (JMAB no conoce al agente; los empareja el orden).
- **F2:** un lugar por línea de JMAB (el redondeo de trabajadores del piso del precio y "ganancia > 0" de los bancos).
- **F3:** el piso de `targetOutput`, "activo" de las de capital, el piso y el techo de la tasa y el `rint` de los bonos usan lo que devuelve el helper.
- **Registros nuevos:**
  - B1: activación del 9;
  - B2: `(int)` del inventario en el 9;
  - B3: activación del 15, con escala la del inventario y la producción;
  - B4: "deuda ≠ 0";
  - B5: truncado del hogar en el 75;
  - B6: `reallocateLiquidity` en el 18, con la lista del hogar, y en el 35, con la del banco.
- **F5:** clase por origen `fromAmounts` en las empresas de consumo (producción deseada, margen, piso, trabajadores requeridos) y en los precios de consumo del 18.
- **Caminos de H**, aislados detrás del registrador y marcados `// solo rama forzada (modo oráculo): inventario-decisiones H`:
  - R1 en compras, traspasos, cuotas, salarios, impuestos, dividendos y reparto de la quiebra;
  - R2 en la búsqueda de oferta con pedido 0 µ y en los aportes con pérdida total 0 µ;
  - R3 con mensaje en los lugares de la tabla H.2;
  - los cuatro casos con camino propio.
- **Operando del aporte:** con la pérdida inicial del préstamo en 0 µ, el operando es esa pérdida.
- **Operandos agregados con términos de entrada:**
  - evento 0: "depósitos = 0";
  - evento 6: "préstamos ≠ 0" y "patrimonio > 0";
  - evento 9: "requerimiento > liquidez" (la liquidez);
  - evento 20: "liquidez ≥ servicio";
  - evento 25: "ganancia > 0" de los bancos;
  - evento 28: "patrimonio < 0";
  - evento 31: "rama 1" y `rint`;
  - evento 36: "demanda > 0";
  - B4: la deuda.

**Verificación.**
- **Hash de estado en PRNG** (`reference/tools/prng-hash.test.ts`, semilla 1, 20 ticks; hash después de cada evento en los ticks 1 y 2 y al final de cada tick en los demás), con el motor de `HEAD` (extraído con `git archive`) y con el modificado: **idéntico**, también con la versión final (después del último ajuste, el NaN de la tasa sin bancos elegibles). El orden de los eventos 0 y 9 no consume sorteos.
- **`pnpm test`** en verde: 430 tests, con casos a mano del modo oráculo en `caiani-decisions.test.ts`.
- **Emparejamiento en el tick 133** con el motor del paso 3 (`decisions-align`, sin forzar): **38 de 39 eventos alineados**, incluidos los eventos 0 y 9 en el orden de JMAB y los registros B1–B6. El 19 se separa en el vuelco conocido de 8140. Los 8.000 "aporte negativo" distintos del 21 son los R2 (pérdida del préstamo 0 µ contra −9,2·10⁻¹⁴ de JMAB).

**Punto 3 de Nico: fragilidad de los operandos agregados.**
- **Cómo se mide:** con la corrección con signo, la fragilidad se mide con 2 µ (o 2k µ en el encadenado) sobre el operando corregido por su error de entrada anotado. Sobre el operando crudo del port, la ventana efectiva es 2 µ + |ε|.
- **|ε| máximo por lugar** (`reference/tools/aggregate-eps.test.ts`, los 12 ticks del V3, eventos sueltos; salida en `aggregate-eps.tsv`). El tick 1 va aparte porque es el caso límite de la simetría: los 8.000 depósitos idénticos con el mismo sesgo de redondeo, +0,361 µ (sec. 1).

| Lugar | máx \|ε\| sin el tick 1 | tick 1 |
|---|---|---|
| "rama 1" de la demanda de bonos (31) | 58,6 µ (300) | 59,4 µ |
| "patrimonio > 0" (6) | 25,1 µ (133) | 290,5 µ |
| "depósitos = 0" (0) | 22,9 µ (50) | 289,0 µ |
| "patrimonio < 0" (28) | 22,7 µ (300) | — |
| "ganancia > 0" de los bancos (25) | 22,0 µ (293) | 27,5 µ |
| "préstamos ≠ 0" (6) | 13,9 µ (300) | — |
| `rint` de los bonos (31) | 5,9 µ (300) | — |
| "deuda ≠ 0" (B4, 20 y 21) | 2,6 µ (146) | — |
| "demanda > 0" de Basilea (36) | 1,9 µ (103) | — |
| "liquidez ≥ servicio" (20) | 1,0 µ (81) | — |
| "requerimiento > liquidez" (9) | 0,5 µ (300) | — |

- **Las siete primeras quedan con una ventana efectiva mayor que 2 µ:** hasta 2 + 58,6 µ, y en el tick 1 hasta 2 + 290,5 µ.
- **La corrección es exacta** (emparejamiento del tick 133 contra los operandos de JMAB). Los operandos agregados, que crudos difieren hasta 48,8 µ, quedan a **≤ 2·10⁻³ µ** una vez corregidos. Sin corregir, una decisión de un banco a 20 µ del umbral se habría tomado por clara y se habría visto como falla.
- **Restos sin corregir:** hasta 1,2 µ, del redondeo a µ del propio operando, que no se anota. Requerimiento financiero 1,17 µ (`toMicro` del requerimiento), servicio de la deuda 0,95 µ (las cuotas), demanda de Basilea 0,32 µ (`Math.round` del pedido). Quedan dentro de los 2 µ.

## Para que revise Nico

**Aprobado por Nico (2026-11-16):** B6 con la opción (a); D con silencio y verificación; F2; F5 ("referencia > umbral" pasa a `fromAmounts`); C8 como error explícito; las listas B y C tal como están. Pendiente: la sección H.

Lo que se revisó en la primera vuelta:

1. B6: opción (a) o (b).
2. D: el silencio con verificación del oráculo.
3. F2: los dos cambios de nombre.
4. F5: la clase de "referencia > umbral" del margen.
5. C8: dejar el pedido de Basilea de menos de 0,5 µ como error explícito.
6. Lo demás de C (motivos por los que no se registra) y la lista B.
