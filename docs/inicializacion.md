# Inicialización del port de Caiani (P2, V1)

Estado al 2026-11-13: **V1 cumplido.** El estado inicial del port coincide con el que vuelca el oráculo, agente por agente. Plan general en [plan-port-caiani.md](plan-port-caiani.md) (sec. 4, V1). Código en `packages/engine/src/caiani/` (`params.ts`, `state.ts`, `init.ts`); test en `packages/engine/test/caiani-init.test.ts`.

Todo lo que se afirma sobre JMAB sale de `reference/jmab-2015/src` (fuente equivalente al `.jar`, V0), de `paper-launcher/Model/modelFile.xml` y del volcado del oráculo.

## 1. Qué hace JMAB antes del primer tick

`AbstractMacroSimulation.begin()` hace tres cosas, en este orden:

1. **`setListeners`.** Cada `SimpleMarketSimulation` (consumo, crédito, trabajo, depósitos y los dos de reservas) arma **su propia lista** de compradores y de vendedores, copiando las poblaciones en el orden del XML. Como esto pasa antes del inicializador, las copias quedan en **orden de creación**. Los dos `BrochureMarket` (capital y bonos) no copian: usan las listas de las poblaciones (`consumptionFirms`, `capitalFirms`, `banks`, `governments`).
2. **`SFCSSMacroAgentInitialiser.initialise`.** Balances, empleo, rezagos y expectativas (sec. 2). En el medio, **mezcla la lista de la población de hogares** (`households.getAgentList().shuffle(prng)`), y ese orden queda para toda la corrida.
3. **`RandomMarketInitialiser.initialise`** de cada mercado, en el orden del XML: mezcla la lista de compradores y, **por cada comprador**, la de vendedores (16.499 mezclas en total). `initialiseCounterpart` está vacío en todos los agentes, así que el único efecto es el **orden de las listas**. En los `BrochureMarket` eso reordena las poblaciones de empresas de consumo, de capital y de bancos. Las listas de los mercados simples persisten toda la corrida (las usan los mezcladores de cada tick).

Composición de las listas propias (orden del XML): consumo (hogares / empresas de consumo), crédito (capital + consumo / bancos), trabajo (capital + consumo + gobierno / hogares), depósitos (hogares + capital + consumo / bancos), reservas ×2 (bancos / BC).

## 2. El inicializador, término por término

Parámetros: bean `macroAgentInitialiser`, líneas 1381–1420 del XML (`params.ts`, con la línea de cada valor). Tamaños: 8.000 hogares, 100 empresas de consumo, 20 de capital, 10 bancos.

| Qué | JMAB (`SFCSSMacroAgentInitialiser`) | Port (`init.ts`) |
|---|---|---|
| Ids | Orden de creación: consumo, capital, bancos, gobierno, hogares, BC | El mismo: id de JMAB = id del port + constante (8.133 en la corrida del oráculo) |
| Hogar i | Efectivo `hhsCash/8000` (= 0); depósito `hhsDep/8000` en el banco i/800; vendedor previo: empresa de consumo i/80; banco previo: el del depósito; salario 5; `dividendsReceived = 2376,600118/8000` | Igual (montos en µ) |
| Rezagos del hogar | `NETWEALTH` = patrimonio; `EMPLOYED` = 0 (1 si después lo contratan); `CONSUMPTION` = `csSales/(8000·cPrice)` | Igual; `NETWEALTH` sale de los saldos en µ |
| Expectativa de precio | 4 filas `[cPrice, cPrice]`; λ·obs + (1 − λ)·exp | Igual (bit a bit) |
| Mezcla de hogares | `households.getAgentList().shuffle(prng)` | `rng.shuffle('SFCSSMacroAgentInitialiser.initialise', 'initHouseholds', …)` |
| Empresa de capital i | Inventario: bien de capital de `ksInv/20` = 10 unidades, valor 10 × `kPrice`, costo 2,5, **edad −1** (la pone el constructor); 50 trabajadores tomados en orden de la lista ya mezclada; depósito 250 en el banco i/2; efectivo 0 | Igual |
| Empresa de consumo i | Inventario: 32 unidades de bien de consumo, valor 32 × `cPrice`, costo 0,93…, edad −1; 20 añadas de capital de 20 unidades del proveedor i/5, edad j, precio `kPrice/(1+g)^j`, valor `kPrice·20·(1 − j/20)/(1+g)^j`; 50 trabajadores; depósito 250 en el banco i/10 | Igual |
| Préstamos iniciales (cada empresa) | 20 préstamos, j = 0…19: banco (banco del depósito + j) mod 10; edad j + 1; `initialAmount = L₀/(1+g)^j`; saldo `L₀·(1/(1+g)^j)·((20 − j)/20)`; tasa 0,0075 | A = µ(L₀/(1+g)^j); saldo = A − redondeo(A·j/20) (sec. 3) |
| Prestamista previo | En j = 1 se fija el banco **del depósito** (`bank`), no el que prestó (`loanBank`) | Igual |
| Rezagos de las empresas | Ganancia antes y después de impuestos, inventario, producción, ventas reales y nominales, precio, patrimonio, inventario nominal (`inv × unitCost`), flujo de caja operativo; consumo, además: capacidad (`cCap × productividad`) y valor del capital | Igual. Ojo: las ventas nominales de consumo son `cOutput·cPrice`, no `cSales` |
| Expectativas de las empresas | Salario (`hhWage`), ventas nominales y ventas reales: 4 filas iguales | Igual |
| Banco i | Efectivo 0; reservas `bsRes/10`; bonos: **`(int) bBond`** = 3.827 bonos de precio 1 (no 3.827,35); un adelanto del BC de **saldo 0** (`bsAdv = 0`), plazo 1, solo interés | Igual (el adelanto de saldo 0 se crea igual: lo borra la primera limpieza) |
| Rezagos del banco | Ganancias, morosidad 0, crédito remanente 0, patrimonio, oferta de crédito `((csLoans + ksLoans)/10)·2/(20 + 1)`, tasas de depósitos y de préstamos | Igual |
| Expectativa de depósitos | Depósitos que debe el banco, 4 filas | Igual (sale de los saldos en µ) |
| Gobierno | `gEmpl` empleados: **no está en el XML, vale 0**; cuenta en el BC con saldo 0 | Igual: el gobierno arranca sin empleados |
| BC | Bonos: `(int) cbBonds` = 28.564 | Igual |
| Agregado | `LAG_AGGUNEMPLOYMENT` = 0,08 en la simulación | `aggregateLags` |

`uniformDistr = 0`: cada `(1 + distr.nextDouble())` vale exactamente 1 (Colt igual consume un número del generador, pero el resultado no depende de él). El port no sortea y rechaza `uniformDistr ≠ 0`, que no se usa.

**Resultado:** 6.000 ocupados (1.000 en capital, 5.000 en consumo) y 2.000 desocupados; el gobierno contrata 1.360 en el tick 1 (sec. 6).

## 3. Diferencias con JMAB (adaptaciones documentadas)

1. **Saldos en µ.** Cada monto pasa por `toMicro` una vez. Los préstamos iniciales se abren con saldo A − redondeo(A·j/L), y no con µ(saldo de JMAB): así las cuotas de `installment` (P1) los cierran exactamente en cero. Difiere del saldo de JMAB en a lo sumo 1 µ (medido).
2. **(1 + g)^j por multiplicaciones** (`powInt`), sin `Math.pow` (principio 4). Difiere de `Math.pow` de Java en a lo sumo 1 ulp (medido: 1,9·10⁻¹⁶ relativo).
3. **`LAG_NETWEALTH` y la expectativa de depósitos** se calculan a partir de los saldos en µ, como lo van a hacer las reglas de P3 (diferencia relativa ≤ 3·10⁻⁷).
4. **Bienes reales**: su valor contable es un `double`, como en JMAB, hasta que P3 decida cómo se registran sus flujos. `goodValue` replica `getValue()`: un bien que todavía tiene su productor (inventario) vale a costo, costo unitario × cantidad, no `value`.
5. **Listas de los `BrochureMarket`**: no se guardan aparte; son las de las poblaciones (`state.populations`), igual que en JMAB, sin referencias compartidas en el estado serializable.
6. **Mezclas en modo PRNG: se reproduce a propósito un defecto de JMAB** (decisión de Nico, 2026-11-13). `AgentList.shuffle` de JMAB, para cada i < n − 1, intercambia la posición i con ⌊n·u⌋, una posición al azar de **toda** la lista. No es uniforme: hay n^(n−1) caminos para n! órdenes. El modo PRNG del `Rng` usa por defecto ese mismo algoritmo (`jmabShuffle`), para que la distribución de los órdenes sea la del `.jar`. Hay un interruptor (`new PrngCaianiRng(rng, { shuffle: 'uniform' })`, Fisher–Yates) para medir más adelante cuánto influye el sesgo. `Collections.shuffle` (empleados) sí es uniforme en Java y queda con Fisher–Yates. En modo oráculo no importa: se consume el orden registrado. Test: para n = 3 el modo por defecto reproduce la distribución exacta de JMAB (9 caminos equiprobables), y el uniforme da 1/6 por orden.

## 4. Verificación (V1)

**Oráculo** (`reference/p0/oracle`, recompilado con `reference/tools/build-oracle.sh`):
- Se registra la mezcla de hogares del inicializador (`shuffle initHouseholds`, tick −1). Antes no estaba instrumentada.
- `oracle.StateDump` vuelca el estado completo en JSON Lines después de la inicialización (`state/init.jsonl`) y, si se pide (`DUMP_TICKS`), al principio de cualquier tick, que es lo que necesita V3. Primera línea: orden de las poblaciones, rezagos agregados y listas de cada mercado. Después, una línea por agente con todos sus campos por reflexión (contratos y bienes de la matriz de stocks, empleados, rezagos, expectativas, estrategias), con las referencias a agentes como ids.
- `oracle.CashWatch` registra todo efectivo distinto de cero después de cada evento (sec. 5).
- La instrumentación nueva no cambia la corrida: con la semilla 12345, los sorteos del tick 1 y los 36 CSV coinciden con la corrida "a" de P0.

**Corrida de referencia:** `reference/tools/run-oracle.sh p2-init 12345 1 -1 999999` (semilla 12345, sorteos desde la inicialización).

**Test** (`caiani-init.test.ts`): inicializa el port con el `Rng` en modo oráculo (16.500 sorteos de la inicialización: se consumen todos) y compara:

| Qué | Cantidad | Resultado |
|---|---|---|
| Órdenes de las 4 poblaciones y de compradores y vendedores de los 8 mercados | 20 listas | idénticos |
| Contratos (por agente, lado y tipo, en orden): tenedor, emisor, saldo, edad, tasa, plazo, amortización, `initialAmount`, bonos | 37.364 | saldo: diferencia máxima **1 µ**; lo demás idéntico |
| Bienes reales: cantidad, valor, precio, costo, edad, productor, parámetros del capital | 2.120 | diferencia relativa máxima 1,9·10⁻¹⁶ |
| Rezagos (id, período, valor) | 25.480 | los mismos; valores puros ≤ 1,9·10⁻¹⁶, los que salen de saldos ≤ 3·10⁻⁷ |
| Expectativas (filas, valor, λ) | 8.370 | ídem |
| Empleador de cada hogar, empleados de cada empresa (en orden), salarios, dividendos, proveedores previos (bienes, banco, prestamista, capital) | todos | idénticos |

Además, casos calculados a mano (depósito de un hogar, préstamo j = 1, bonos truncados, añadas de capital, empleo), que todos los préstamos iniciales cierran en cero con las cuotas de `installment`, y determinismo con el `Rng` en modo PRNG.

## 5. Efectivo de los hogares (rama rara de `Households.payTaxes`)

`ledger-contratos.md` (sec. 4, "Para P3") anotaba que `payTaxes` deja el depósito en negativo si el hogar tiene efectivo y el depósito no alcanza.

**Estado inicial: ningún agente tiene efectivo.** `hhsCash` no está en el XML (vale 0); `bsCash = 0`; las empresas arrancan con 0. Verificado en el volcado y en el port.

**Durante la corrida, leyendo el código:** el único mecanismo que mueve efectivo es `DepositMechanism`, que lleva el efectivo al deseado. Para los hogares el deseado es `liquidez − shareDeposits·liquidez` con `shareDeposits = 1` (línea 2700 del XML): da exactamente 0 en `double`. Las empresas devuelven 0 fijo (`getCashAmount`). Los salarios, el seguro de desempleo y los dividendos se acreditan en depósitos. Así que la rama de `payTaxes` no se ejecutaría nunca.

**Verificación empírica (2026-11-13):** corrida completa del oráculo, semilla 12345, 400 trimestres (`p2-cash`), con `CashWatch` después de cada uno de los 138 eventos de cada tick: **247.152.000 chequeos, ningún efectivo distinto de cero** en hogares, empresas ni bancos, incluso con quiebras de empresas en el medio. La rama rara de `payTaxes` no se ejecuta en la corrida base. El port igual la tiene que portar (con el depósito que queda en negativo), o rechazarla con un error si alguna vez hay efectivo; se decide en P3, en el evento de impuestos. Además, los 36 CSV de los ticks 1 a 6 coinciden con la corrida "a" de P0: la instrumentación nueva no cambia la simulación.

## 6. Empleo público: el gobierno arranca con 0 y contrata 1.360 en el tick 1

El plan decía que el gobierno contrata 1.360. El inicializador no le da empleados (`gEmpl` no está en el XML: vale 0). Pero en cada tick, en `governmentLaborTic` (evento 13), `GovernmentAntiCyclical.computeLaborDemand` (líneas 146–165) hace esto:
1. despide al azar una fracción `turnoverLabor` = 0,05 de sus empleados (bean `turnoverVal`, XML 2018; el mismo de las empresas);
2. fija la demanda en `fixedLaborDemand − empleados` (XML 2870: 1.360), o despide el excedente.

Con el oráculo (semilla 12345, `p3-gov`, estado al final de cada trimestre):

| | t = 0 | trimestre 1 | trimestre 10 | trimestre 100 |
|---|---|---|---|---|
| Empleados públicos | 0 | 1.360 | 1.360 | 1.360 |
| En empresas | 6.000 | 6.000 | 5.860 | 6.163 |
| Desocupados | 2.000 | 640 | 780 | 477 |
| Desempleo (CSV del oráculo) | — | 8,00% | 9,75% | 5,96% |

**Contra el paper:** el cuadro 3 dice N_g = 1.360 empleados públicos (constante) y desempleo inicial u₀ = 0,08. Eso equivale a arrancar con los 1.360 ya empleados: 7.360 ocupados y 640 desocupados. El código arranca en t = 0 con 2.000 desocupados (25%), pero al final del tick 1 está exactamente en la situación del paper (8%). La diferencia solo afecta lo que pasa dentro del tick 1: el rezago `LAG_EMPLOYED` de los 2.000 vale 0, y quiénes terminan como empleados públicos sale del mercado de trabajo del tick 1. El port sigue al código, como manda la regla.

**Corrección al plan:** la rotación de los empleados públicos es 0,05 (`turnoverVal`, cuadro 3 del paper: ϑ = 0,05), no 10%.

## 7. Pendiente de decisión

- **Valor contable de los bienes reales** en `double` o en µ: se decide en P3, cuando entren sus flujos (venta, inversión, amortización, revaluación de inventarios).
