# Reglas del port de Caiani (P3)

Estado al 2026-11-13: **infraestructura de V3 por evento lista; eventos 0 a 19 portados y verificados en los ticks 1 y 50 (bit a bit en los `double` puros; montos con la regla general de tolerancia, sec. 1); pagos con redondeo controlado por evento (`payments.ts`, sec. 1, "Reservas"); contador de decisiones discretas en el V3.** El encadenado usa la regla por escala de los flujos (sec. 1, aprobada e implementada el 2026-11-13): sin campos reportados. Para retomar en una sesión nueva, ver la sec. 15. Plan general en [plan-port-caiani.md](plan-port-caiani.md) (sec. 4 y 7). Código: `packages/engine/src/caiani/events.ts` (eventos), `state.ts` (estado), `params.ts` (`RULES`); tests en `packages/engine/test/caiani-events.test.ts`, arnés en `test/support/jmab-dump.ts`.

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
- **Encadenado** (desde el principio del tick, sin volver a cargar el estado de JMAB): **2 µ por evento corrido**, o sea 2·k µ después de k eventos. Se compara después de **cada** evento, no solo al final. Supuesto de la regla: cada evento agrega como mucho su error estricto a los montos que escribe, y lo que hace con los montos que recibe (sumas y restas de pocos términos, productos por tasas, participaciones o (1 − i/100)) no amplifica el error. Un campo que deriva más rápido indica una amplificación (por ejemplo, una suma sobre muchos montos) o un error del port: se reporta. **Desde el 2026-11-13 el encadenado usa la regla por escala de los flujos** (abajo), que mantiene estos 2k µ como piso.
- **Sin casos por campo.** Si un campo no cumple la regla, no se agranda su tolerancia: se reporta (abajo) y se decide qué hacer con él.

Implementación: `V3_AMOUNT_TOL` y `chainedAmountTol(k)` en `test/support/jmab-dump.ts`; `compareState` recibe la tolerancia y devuelve, por tipo de campo, la diferencia máxima y cuántos la superan, que el test imprime en cada corrida.

**Medición con la regla (eventos 0–10, ticks 1 y 50; los eventos 11–14 no mueven montos y dan diferencia 0).** Contratos (depósitos, préstamos), intereses de cada depositante y préstamos nuevos: ≤ 1 µ en el suelto; en el encadenado, hasta 2 µ (tick 1) y 4 µ (tick 50) después del evento 10, contra una tolerancia de 22 µ. Antes, los préstamos nuevos del encadenado tenían una tolerancia propia (3 µ por préstamo de la empresa más 2).

**Regla del encadenado por escala de los flujos (propuesta a pedido de Nico y aprobada por él el 2026-11-13; implementada en el arnés, `test/support/chain-scale.ts`).** El supuesto de "2 µ por evento" vale para valores que salen de pocas operaciones; falla con sumas de muchos montos derivados (reservas: ~1.600 compras en el evento 18) y con restos por cancelación (inventario que queda). Regla corregida, igual para todos los valores, sin casos por campo; **la verificación estricta sigue siendo el evento suelto** (2 µ, 10⁻⁶, 10⁻⁹, sin cambios):

- En el encadenado de k eventos, un valor v pasa si |v_port − v_JMAB| ≤ max(2k µ, ρ · S(v)) para los montos, y ≤ max(tolerancia del evento suelto × |v|, ρ · S(v)) para los `double` de montos, con **ρ = 10⁻⁶** (la tolerancia de los `double` de montos).
- **S(v), escala de los flujos que lo produjeron:** |valor al empezar la cadena| + Σ |operaciones que lo tocaron| en los eventos corridos.
  - *Montos (contratos del ledger):* Σ |monto| de los registros de `flowLog` que tocaron el contrato (pagos, créditos, débitos, liquidaciones de reservas). El ledger ya lo registra: no cambia el motor.
  - *`double` (bienes, demanda):* el arnés suma |Δ| de cada valor después de cada evento. Para lo que se crea dentro de un evento a partir de una transferencia (el bien que compra un hogar), la escala se propaga como en los pagos: hereda la de las dos puntas (la demanda del comprador al empezar el evento y el inventario del vendedor), y cada compra posterior del mismo hogar suma la escala de los vendedores anteriores (su demanda restante salió de restarles). Es el análisis de error hacia adelante con la escala de los términos, como en las decisiones discretas (más arriba); no agrega nada al motor.
- **Medición (ticks 1 y 50, encadenado 0–18):** montos, peor error/S = 5,8·10⁻⁷ (tick 1) y 2,1·10⁻⁶ (tick 50, un depósito con 1 µ de error y 0,48 unidades de flujos: lo cubre el piso de 2k µ); reservas 10⁻⁹–10⁻¹⁰; todo pasa con ρ = 10⁻⁶. Bienes: con la escala del inventario (inicial + Σ|Δ|) los restos de las empresas pasan; con solo la demanda inicial del hogar, el peor bien da 2,1·10⁻⁶ (no pasa): por eso la propagación de las compras anteriores.
- **Costo:** con ρ·S, la tolerancia de las reservas en el encadenado es ~10⁴ µ (contra 18 µ medidos): un error de un pago chico en un evento con pagos solo lo detecta el evento suelto. Alternativa más ajustada, si se prefiere: S = √(Σ operaciones²) (los errores de muchos montos se suman como una caminata al azar), con ρ a calibrar. Recomiendo la de Nico (Σ|·|) por simple y porque el suelto es la verificación estricta.
- **Implementación (2026-11-13).** `ChainScales` (`test/support/chain-scale.ts`) lleva S: por contrato, |saldo al empezar la cadena| + Σ |monto| de los registros del `flowLog` que lo listan (un contrato abierto en la cadena arranca de 0); por etiqueta de `compareState`, |valor inicial| + Σ |Δ| después de cada evento (una pasada de `compareState` sobre el estado inicial fija los valores iniciales). `compareState` la recibe en `CompareOptions.scale` y aplica max(2k µ, ρ·S) a los montos y max(10⁻⁶ relativo, ρ·S) a los `double` de montos; los `double` puros, sin cambios. Informa por campo el peor diferencia/S, el ρ·S más grande y cuántos valores pasan **solo** por ρ·S. ρ = `V3_CHAIN_RHO` = 10⁻⁶.
  - *Propagación* (`propagate`, antes de comparar): para cada bien de consumo que un hogar compró en el evento (los que no estaban antes), la cantidad de la i-ésima compra tiene S = S(demanda del hogar al empezar el evento) + Σ S(inventario de cada vendedor hasta esa compra); el valor, esa S × precio; la demanda que le queda al hogar, la S de su última compra. Es genérica (cualquier evento que cree bienes de consumo de hogares), no del evento 18. **Detalle:** la S del inventario de un vendedor es la de su valor al **cerrar** el evento (incluye las ventas posteriores a la compra): sobreestima un poco y evita reconstruir el orden de las compras.
  - El motor no cambia. `REPORTED_FIELDS` del test quedó vacía.
- **Medición con la regla implementada (2026-11-13, ticks 1 y 50, encadenado 0–18):** todo pasa, sin campos reportados. Bienes de consumo del tick 50: las 21 cantidades y los 20 valores que superaban el 10⁻⁶ relativo pasan por ρ·S, con el peor diferencia/S = 1,8·10⁻⁸ (cantidades) y 6,1·10⁻⁹ (valores), unas 50 veces por debajo de ρ; su ρ·S llega a 0,002 unidades. En el tick 1 ningún bien supera la tolerancia base. Montos: ninguno necesita ρ·S (depósitos 11 µ y reservas 18 µ, debajo de 2k = 38 µ); peor diferencia/S de los depósitos, 5,8·10⁻⁷. Lo que afloja la regla (ρ·S más grande): depósitos 1.170 µ, préstamos 218 µ (tick 50).

**Campos que no cumplían la regla (2026-11-13), resueltos con el redondeo con arrastre.** Con el primer arnés de la regla, cuatro campos la superaban en el evento suelto: `totInterestsDeposits` (evento 8: 33 y 11 µ en los ticks 1 y 50), `debtBurden` (evento 9: 3 y 6 µ), `debtInterests` (3 µ) y `creditDemanded` (5 µ). Causa común: el port **sumaba montos ya redondeados a µ** (un interés por depósito, una cuota por préstamo) y JMAB **suma los `double`**; con n términos la diferencia llega a n/2 µ. No es deriva: aparecía igual en el evento suelto. El test los reportaba en `REPORTED_AMOUNT_FIELDS` sin tolerarlos (hoy esa lista está vacía y queda como mecanismo para casos futuros).

**Redondeo con arrastre (decisión de Nico, 2026-11-13).** Cuando un agente recorre una lista de montos que JMAB acumula en `double`, cada monto se redondea como m_i = round(S_i) − round(S_{i−1}), con S_i la suma acumulada en `double` (`CarryRounder`, `money.ts`). Cada monto queda a < 1 µ de su `double` y la suma de cualquier tramo seguido de la lista, a ≤ 1 µ de la suma de JMAB; el agregado sigue siendo la suma de lo acreditado o pagado (consistencia SFC). Aplicado en el evento 8 (intereses de los depósitos de cada banco) y en las cuotas de los préstamos (`installments`: eventos 9 y 20; cambio de la decisión 3 de P1, ver [ledger-contratos.md](ledger-contratos.md), sec. 4). **Resultado en los ticks 1 y 50:** todos los montos ≤ 2 µ en el suelto y en el encadenado (`totInterestsDeposits` ≤ 1 µ, `debtBurden` ≤ 1 µ, `creditDemanded` ≤ 2 µ, préstamos y depósitos ≤ 2 µ).

**Reservas y cuentas con muchos pagadores: redondeo controlado por evento (aprobado por Nico el 2026-11-13; implementado en `caiani/payments.ts`, ver "Implementación" al final de este apartado).**

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

*Implementación (2026-11-13).* `caiani/payments.ts`, tests a mano y de propiedades en `test/caiani-payments.test.ts`.
- `PaymentBatch`: el evento lo crea al empezar; `pay(desde, hacia, monto en µ como double, categoría)` anota el pago pendiente (las mismas patas que `pay` del ledger, incluida la liquidación entre bancos, pero sin tocar el ledger); `balance(contrato)` = saldo en µ + pendientes, para las decisiones del evento; `settle()` redondea y registra, y cierra el lote.
- `controlledRound`: red fuente → bancos que pagan → cuentas que pagan → pagos → cuentas que cobran → bancos que cobran → sumidero, con cotas [⌊s⌋, ⌈s⌉] en cada arista (s = suma en `double`, en el orden de los pagos); circulación entera factible por reducción de las cotas inferiores a un flujo máximo (Dinic, aristas en orden de inserción: determinista). Verifica que las familias sean laminares (cada cuenta en un solo banco).
- `applyPayments` (ledger): registra el lote de forma **atómica** (valida los saldos finales de todas las cuentas antes de tocar nada) y cada pago queda en el registro de flujos con su categoría. Los saldos intermedios no se validan: con montos redondeados, una cuenta que cobra y paga en el mismo evento puede pasar por −1 µ en el medio.
- **Dos detalles de implementación** (no cambian la regla; aprobados por Nico el 2026-11-13):
  - *Techo de las cuentas que solo pagan:* la suma de lo que paga una cuenta que no cobra nada en el lote (y no es de reservas) tiene además el techo de su saldo al empezar el lote. Sin eso, si la suma en `double` supera el saldo por ruido de redondeo (p. ej. 0,3 + 7,9 + 1,8 = 10,000000000000002 µ), el redondeo podía dar saldo + 1 y dejar un depósito negativo.
  - *Cotas relajadas:* si las cotas estrictas no tienen solución (solo puede pasar si una suma exacta está pegada a un entero y la suma en `double` cae del otro lado), se reintenta con [⌊s − 10⁻³⌋, ⌈s + 10⁻³⌉] y la garantía de esa familia pasa a ser ≤ 1 µ. Se informa en `relaxed`. En los 600 lotes al azar del test y en los cuatro lotes del V3 (8.000–8.037 pagos) no hizo falta nunca.
- **Medición en el evento 18** (el único con pagos portado hasta ahora): en los ticks 1 y 50 el cierre registra 8.000 y 8.037 pagos, con la diferencia máxima de cada pago y de cada suma < 1 µ; en el evento suelto, todos los montos (depósitos, reservas de los 10 bancos) quedan a ≤ 1 µ de JMAB. Encadenado: ver sec. 17.


**Decisiones discretas (contador de V3, 2026-11-13, pedido de Nico).** Módulo `caiani/decisions.ts`, test a mano en `test/caiani-decisions.test.ts`.
- Cada comparación que define una rama en un evento pasa por un helper (`gt`, `ge`, `lt`, `record`, `rounding`) que devuelve lo mismo que la comparación sola. Con un registrador activo (`withDecisions(rec, evento, fn)`) anota, por evento y por lugar, la **distancia al umbral** en la escala de la tolerancia del valor comparado (µ absolutos para montos; relativa para los `double`, a la escala de los operandos o de los términos de los que sale el valor) y el resultado. Si la distancia es ≤ la tolerancia, la decisión es **frágil**: una diferencia que V3 admite alcanzaría para darla vuelta. El registro solo observa: sin registrador, los helpers no hacen nada más que comparar.
- **Decisiones dadas vuelta:** el V3 corre cada evento suelto (desde el volcado de JMAB, o sea con las entradas de JMAB) y encadenado desde el principio del tick, los dos con registrador; `compareOutcomes` lista las comparaciones con otro resultado en la misma posición. Una que se da vuelta hoy igual hace fallar la comparación de estado aguas abajo; el contador dice dónde empezó.
- **Qué no se registra:** comparaciones entre enteros exactos (edades, plazos, cantidades de la lista), banderas de actividad que vienen de otro evento (se registran donde se deciden), y la comparación del atractivo del proveedor previo cuando el previo **es** el mejor (es el mismo cálculo dos veces, no puede darse vuelta). El piso de la producción deseada (`max(0, …)`) se mide contra la escala de los términos de la resta, no contra el resultado.
- **Qué no se registra (evento 15):** la comparación "trabajadores de la añada < restantes" de `ConsumptionFirm.produce`. En el umbral las dos ramas dan la misma producción (la función es continua), así que un vuelco no cambia el resultado más allá de la diferencia que lo provocó. Antes de sacarla daba 100 empates exactos en el tick 1 (50 trabajadores = 16 añadas × 3,125) y 2 en el 50.
- **Qué no se registra (eventos 11–14):** la referencia micro del salario (vale k/4 exacto, sec. 12) y `laborDemand` contra los empleados (enteros).
- **Qué no se registra (evento 18):** la comparación del precio del proveedor previo cuando el previo **es** el más barato de los vistos (el mismo precio dos veces; daba 76–79 "frágiles" con distancia 0 por tick). Las condiciones `demanda == 0` y `inventario == 0` después de la compra tampoco: son consecuencia exacta de la decisión `demanda ≤ inventario`, que sí se registra.
- **Qué no se registra (evento 19):** `min(demanda, inventario)` de la compra de capital: en el empate las dos ramas dan lo mismo y en el base los dos son enteros (daba 1 "frágil" con distancia 0 en el tick 50: demanda = inventario). Tampoco la condición del lazo (demanda > 0, enteros).
- **`flooring` (2026-11-13):** decisión de un piso (`Math.floor`): el umbral es el entero más cercano. La usa el evento 18 (unidades que compra un hogar al que no le alcanza el depósito).
- **`rounding` (corregido el 2026-11-13):** la distancia de x a k + 0,5 se mide relativa a max(|x|, |k + 0,5|); antes era relativa a |x|, y un 0 exacto (la I+D nula del evento 12) contaba como frágil con distancia 0.
- **Resultado en los ticks 1 y 50 (eventos 0–18):** ninguna decisión se da vuelta. Frágiles:

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
  | 16 | sin comparaciones numéricas | ídem |
  | 17 | 0 de 8.000 | 0 de 8.000 |
  | 18 | 0 de ~70.600 (el más barato a 2,1·10⁻⁷ como mínimo) | 0 de ~70.500 (cambio de proveedor a 1,3·10⁻⁶) |
  | 19 | 0 de 3.382 | 0 de 4.052 |
  | 20 | 0 de 120 | 0 de 120 |

  Las frágiles del tick 1 vienen de que la inicialización deja a todas las empresas y bancos de cada tipo iguales y justo en los umbrales (y el desempleo justo en el 8% del umbral de los salarios). En el tick 50 la distancia más chica es 1,8·10⁻⁴ (redondeo de los trabajadores requeridos).

**Ticks de referencia del V3 (Nico, 2026-11-13).** Como el tick 1 tiene decisiones frágiles por la simetría de la inicialización, **las verificaciones V3 de referencia son las que arrancan en los ticks 50, 200 y 399**. El tick 1 es el **caso límite**: se sigue corriendo y se informa, pero una decisión frágil que se dé vuelta ahí no se lee como un error del port sin mirarla primero en los ticks de referencia.

**Corridas de referencia** (semilla 12345; el test `caiani-events.test.ts` las recorre con `describe.each`; los volcados llegan hasta el evento 37):
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

Índices de la lista `events` **sin los comentarios del XML**: la lista de `modelFile.xml` (líneas 41–188) tiene tres bloques comentados (`<!-- … -->`: líneas 81–141 y 167–170, con 59 y 2 reportes (por eso el mapa viejo daba 74 + 61 = 135), y 184–186, con `serializationTic`), y Spring no los carga. Quedan 76 eventos: 0–37 de comportamiento, **38–73 reportes**, **74 `populationHandlerTic`** y **75 `updateExpectationsTic`**. Antes este mapa contaba las referencias comentadas y daba 135 y 136 para los dos últimos: por eso `DUMP_EVENTS` con esos índices no generaba archivo (el oráculo numera los eventos que de verdad se disparan, `OrderedEventsSimulation.fireListEvents`). Verificado el 2026-11-13 con una corrida del tick 1 (`p3-end-t1`, volcados de los eventos 37, 38, 73, 74 y 75): 37 → 38 y 38 → 73 no cambian nada (los reportes no tocan el estado), 73 → 74 tampoco en el tick 1, y 74 → 75 trae la actualización de expectativas, los rezagos del período y `cleanSM` (edades, préstamos y bienes que se cierran). Sorteos por evento en el tick 1 (semilla 12345) entre paréntesis.

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
| 16 | `rdOutcomeTic` | **portado, V3 ✓** |
| 17 | `consumptionDemandTic` | **portado, V3 ✓** |
| 18 | `consumptionMarketTic` (14.675) | **portado, V3 ✓** |
| 19 | `capitalMarketTic2` (1) | **portado, V3 ✓** |
| 20 | `creditInterestsTic` | **portado sin la quiebra**, V3 ✓ en los ticks 1 y 50 con las reservas del evento suelto reportadas (sec. 19) |
| 21 | `payWageTic` (121) | |
| 22 | `bondInterestTic` | |
| 23 | `advInterestTic` | |
| 24 | `taxesTic` | |
| 25 | `dividendsTic` | |
| 26 | `depDemandTic` | |
| 27 | `depMarketTic` (13.998) | |
| 28 | `bankruptcyTic` | |
| 29–37 | bonos y reservas (`bondSupplyTic` … `reservesMarketBaselTic`) (30: 1; 35: 1) | |
| 38–73 | reportes (no modifican el estado; verificado en el tick 1) | no se portan |
| 74 | `populationHandlerTic` | |
| 75 | `updateExpectationsTic` (incluye `cleanSM`) | |

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
- Empresas de capital: `capitalProductivity` (evento 16; 1 en el base).
- Hogares: `demand` (eventos 17 y 18) y `consumptionGoods` (los bienes que compran en el evento 18, con su valor en unidades de Caiani como `double`, igual que el resto de los bienes reales).
- Parámetros (`RULES`, con su línea del XML): participación del inventario objetivo, tasa de adelantos del BC, margen (umbral, paso, σ, iniciales), productividad del trabajo en capital, vendedores por comprador en el mercado de capital, `researchShare`, λ y `payOrReceive` del cambio de proveedor de capital, tasas iniciales de los bancos, estrategias de las tasas de préstamos y de depósitos (paso, sentido, σ) y techo de la tasa de depósitos; impuesto a las ganancias, `profitShare` y `shareOfExpIncomeAsDeposit` de las empresas (evento 9); plazo de los préstamos, vendedores del mercado de crédito, λ y `payOrReceive` del cambio de prestamista, aversiones al riesgo, quita y tasa de bonos inicial del banco (evento 10); estrategia del salario (umbrales micro y macro, pasos, σ, `employmentWageLag`), rotación, empleo público objetivo, vendedores y rondas del mercado de trabajo (eventos 11–14); `inventoriesLostShare` (evento 16); seguro de desempleo, alícuotas de los hogares, persistencia y propensiones a consumir (evento 17); vendedores y rondas del mercado de consumo, λ y `payOrReceive` del cambio de proveedor de consumo (evento 18).
- `OracleCaianiRng`: opción `agentId` (sec. 1).
- Pagos de un evento: `PaymentBatch` y `controlledRound` (`payments.ts`), `applyPayments` y `paymentLegs` (ledger).
- Evento 19: parámetros de `InvestmentCapacityOperatingCashFlowExpected` en `RULES` (`investmentCashFlowWeight`, `investmentCapacityWeight`, `investmentTargetCashFlow`, `investmentTargetCapacityUtilization`, XML 2125–2128); no hay campos nuevos de estado (las añadas nuevas van en `capitalGoods`, con edad −1).

Cada campo nuevo va en `state.ts`, en `initialize` (valor del constructor de JMAB), en `stateFromDump` y en `compareState` (`test/support/jmab-dump.ts`).

## 15. Para retomar en una sesión nueva

1. Leer este documento (sec. 1: método; sec. 2: mapa) y [inicializacion.md](inicializacion.md).
2. Siguiente: **dos decisiones de Nico del evento 20** (sec. 19): el redondeo de las cuotas para las reservas y la propuesta de la quiebra de empresas (`FirmBankruptcyFireSales`, que también usan los eventos 21 y 24). Después, 21–28 (pagos: todos con `PaymentBatch`, sec. 1, "Reservas"). Corrida de referencia nueva: **`p3-t81`** (semilla 12345, volcados del tick 81, eventos 0–37), con una quiebra por deuda (evento 20) y cuatro por salarios (evento 21); se suma a `RUNS` del test cuando la quiebra esté portada. Los volcados del final del tick son los eventos **74 y 75** (sec. 2).
3. Por cada evento: agregar `t:e` a las dos corridas de referencia y correrlas; diff de volcados (herramienta: `dumpdiff.py`, abajo); leer el código de los agentes que escuchan el evento (`activeTicEvents`); portar en `events.ts` con la línea de JMAB al lado; casos a mano y V3 en `caiani-events.test.ts` (agregar el evento a la tabla `EVENTS`); cada comparación que define una rama, con los helpers de `decisions.ts`; registrar acá.
4. Norma operativa: no editar los scripts de `reference/tools` mientras corre algo largo ([arquitectura.md](arquitectura.md), "Corridas largas").
5. Norma de Nico (2026-11-13): si al implementar aparece una regla o un cambio no aprobado, **se propone antes de meterlo** en el código.

**Herramienta de diff de volcados** (2026-11-13; `reference/tools/dumpdiff.py`, fuera de git como el resto de `reference/`): `python3 -I reference/tools/dumpdiff.py antes.jsonl despues.jsonl [ejemplos]` aplana cada agente (sin los `@oid`), agrupa los campos que cambian por población y por tipo (índices como `#`) y da cuántos agentes y un ejemplo; también compara `meta` (poblaciones, mercados, agregados).

## 16. Eventos 16 y 17: resultado de la I+D y demanda de consumo (`rdOutcomeTic`, `consumptionDemandTic`)

**Qué cambia en JMAB** (diff de volcados, tick 50). Evento 16: nada (el valor contable que recalcula ya estaba al día después del evento 15). Evento 17: `demand`, `active[MKT_CONSGOOD]` (a `true`) y los rezagos `LAG_INCOME` y `LAG_CONSUMPTION` de los 8.000 hogares. Sin sorteos en ninguno de los dos.

| Qué | JMAB | Port |
|---|---|---|
| Disparo 16 | `CopyOfCapitalFirm2WagesEnd.onTicArrived` 81–82 → `CapitalFirm.researchOutcome` (360–379), empresas de capital con empleados | `rdOutcomeEvent` |
| Investigadores | demanda de I+D = `(int) Math.floor(amountResearch / wᵉ)`; con `laborDemand` > 0: empleados − `Math.round(requeridos · empleados / (requeridos + I+D))` con aritmética **entera**; si no, la demanda de I+D | `researchWorkers` (`javaInt` reproduce el `(int)` de Java: NaN da 0) |
| Ganancia | `RandDOutcomeBetaDistribution` (XML 1831–1837): 0 sin investigadores; si no, Bernoulli(1 − e^{−0,05·n}) y 0,2 × Beta(2, 5) | 0 sin investigadores; **con investigadores, error** (abajo) |
| Inventario | `UpdateInventoriesProductivityWithCost` (1839–1842): `setQuantity(cantidad × (1 − 0))`, que en `CapitalGood` recalcula el valor contable, y productividad = la de la empresa | `setCapitalGoodQuantity`; `RULES.inventoriesLostShare` |
| Disparo 17 | `Households.onTicArrived` 189–191 → `computeConsumptionDemand` (263–271) | `consumptionDemandEvent` |
| Ingreso neto | `getNetIncome` (346–366): ocupado, bruto − impuestos; desocupado, 0,4 × salario medio de los ocupados (`unemploymentBenefit`, XML 2872) + bruto − impuestos. Bruto = salario (si tiene empleador) + intereses + dividendos (`getGrossIncome`, 458–460). Impuestos = max(0 × patrimonio + 0,18 × bruto, 0) (`IncomeWealthTaxStrategy`, 2808–2812) | `householdNetIncome`, `householdGrossIncome`, `householdTaxes` |
| Salario medio | suma en el orden de la lista de la población, recalculada para cada desocupado (8.000 × 8.000 operaciones) | una vez por evento (nada de lo que lee cambia adentro) |
| Patrimonio | `getNetWealth` (`getNumericBalanceSheet`): activos − pasivos, incluidos los bienes de consumo | ledger en µ + valor de los bienes (`householdNetWealth`); en el evento 17 los hogares tienen solo efectivo y depósito |
| Demanda | `ConsumptionFixedPropensitiesOOIWWithPersistency` (2778–2787): 0 × consumo anterior + 1 × (0,385808 × Y/pᵉ + 0,25 × W/pᵉ); rezagos `LAG_INCOME` (antes) y `LAG_CONSUMPTION` (después); activo si > 0 | igual; la decisión "demanda > 0" se mide contra la escala de sus términos |

**Rama no portada (evento 16; error explícito aprobado por Nico el 2026-11-13):** con investigadores (I+D > 0) el resultado necesita una Beta, que el `Rng` semántico no tiene (ni el oráculo la registra como valor). En el base `researchShare` = 0 y nunca hay investigadores, así que el port tira un error explícito si aparecen, en vez de inventar el sorteo. Si en algún momento se quiere la I+D, hay que agregar la Beta al `Rng` (y al registro del oráculo).

**Verificación:**
- A mano: evento 16 sin I+D (valor contable recalculado con un precio nuevo, productividad), investigadores sin restricción y con restricción (8 − ⌊80/12⌋ = 2), error con investigadores; evento 17 con un ocupado (bruto 6,3, neto 5,166) y un desocupado (seguro sobre el salario medio con dos salarios distintos), rezagos, bandera, y demanda 0 (no activa ni apaga).
- V3, ticks 1 y 50: evento 16 diferencia 0. Evento 17 suelto: demanda y rezagos a 2·10⁻⁸ (tick 1) y 2,7·10⁻⁷ (tick 50) relativo, por los intereses, dividendos y depósitos en µ; encadenado, 3,4·10⁻⁷ y 4,1·10⁻⁷. En el tick 1 todos los hogares tienen el mismo salario (5); el 50 ejercita salarios distintos y desocupados.

## 17. Evento 18: mercado de consumo (`consumptionMarketTic`)

**Qué cambia en JMAB** (diff de volcados, tick 50): el orden de las listas del mercado de consumo (compradores y vendedores); los depósitos de los hogares y de las empresas (y sus reservas, en el BC); un `ConsumptionGood` nuevo por compra en el balance del hogar (8.037 en 8.000 hogares); el inventario de las 100 empresas; `demand` (a 0) y `active[MKT_CONSGOOD]` de los hogares; `previousGoodSupplier` (814 hogares); `active[MKT_CONSGOOD]` de las empresas que se quedan sin inventario (37). Sorteos: tick 1, 1 ronda (8.001 mezclas y 6.674 Bernoulli del cambio de proveedor); tick 50, 3 rondas (8.040 mezclas, 6.210 Bernoulli).

| Qué | JMAB | Port |
|---|---|---|
| Disparo | `SimpleMarketSimulation` (XML 265–283), `nbRuns` = 100: el mezclador se repite mientras haya un comprador activo y un vendedor activo | `consumptionMarketEvent` |
| Mezclador | `SelectionRandomRobinBuyerMixer` (`nbSellers` = 5, 291–295): mezcla los hogares; para cada uno activo en consumo, mezcla las empresas y toma las primeras 5 activas | `selectSellers` (el del evento 3) |
| Proveedor | `CheapestGoodSupplierWithSwitching.selectGoodSupplier`: el más barato (el primero si hay empate); el previo vale +∞ si está inactivo; si el previo es más caro, cambia si vale +∞ o con `switches` (pago, λ = ln 2 / 0,2, `switchingStrategy3`, 1780–1786) | `selectGoodSupplier` |
| Precio | `ConsumptionFirm.getPrice` (802–805): el del inventario | igual |
| Compra | `AtOnceMechanism.execute`: cantidad = min(demanda, inventario); monto = cantidad × precio; cobra el primer depósito de la empresa (`getPayableStock`), paga el primer depósito del hogar (`getPayingStocks`); si el depósito no alcanza, el hogar queda inactivo y compra ⌊depósito / precio⌋ | `consumptionPurchase`; el depósito es el saldo en µ + los pendientes del lote (`PaymentBatch.balance`) |
| Pago | `AbstractBank.transfer` (con reservas entre bancos) | `PaymentBatch.pay`; se registra al cerrar el evento con redondeo controlado (sec. 1, "Reservas") |
| Bien | `new ConsumptionGood(monto, cantidad, hogar, empresa, precio, duración)`: edad 0, costo unitario 0 | igual (valor en unidades de Caiani, `double`) |
| Después | inventario − cantidad (`ConsumptionGood.setQuantity` no recalcula el valor); demanda − cantidad; hogar inactivo si la demanda o el depósito llegan a 0; empresa inactiva si el inventario llega a 0 | igual |
| `reallocateLiquidity` | pasa a la cuenta que paga lo que falte desde las otras cuentas del hogar (depósitos y efectivo) | no mueve nada si las otras cuentas están en 0; **si no, error** (abajo) |

**Rama no portada (error explícito aprobado por Nico el 2026-11-13):** `reallocateLiquidity` con otra cuenta del hogar con saldo. En la corrida base no pasa: el efectivo de los hogares es siempre 0 ([inicializacion.md](inicializacion.md), sec. 5) y cada hogar tiene un solo depósito (verificado en los volcados de los ticks 1 y 50, antes del evento 18 y después del mercado de depósitos, evento 27). Es la misma situación que la rama de `Households.payTaxes` con efectivo (pendientes).

**Qué se ejercita.** Tick 1: una ronda; las 8.000 compras cubren la demanda entera; 24 hogares cambian de proveedor. Tick 50: tres rondas; 37 empresas se quedan sin inventario y 35 hogares compran a dos empresas (la segunda compra es el resto de su demanda); 814 cambian de proveedor. **Sin cobertura de V3:** el hogar al que no le alcanza el depósito (solo caso a mano).

**Verificación:**
- A mano: el proveedor (previo inactivo cambia sin sortear; previo más caro, Bernoulli en los dos sentidos; empate entre empresas distintas, se queda); compra de la demanda entera (2 × 1,25: el pago de 2.500.000 µ es exacto), depósito insuficiente (⌊depósito / 1,25⌋ unidades, queda < 1,25), empresa que se queda sin inventario (el hogar sigue activo y el mercado se cierra).
- V3, ticks 1 y 50, **evento suelto: `double` bit a bit (diferencia 0) y todos los montos ≤ 1 µ** (depósitos de hogares y empresas, reservas de los 10 bancos). Sin decisiones frágiles ni dadas vuelta.
- **V3 encadenado desde el principio del tick (0–18).** Con la regla vieja (2 µ por evento) quedaban dos cosas para decidir; se resolvieron con la regla por escala de los flujos (sec. 1), con la que todo pasa sin campos reportados. Registro de lo que se había encontrado:
  1. **Montos.** Después del evento 18: depósitos 8 µ (tick 1) y 11 µ (tick 50), reservas 2 y 18 µ; la tolerancia del encadenado es 2 × 19 = 38 µ. Pero el evento 18 solo agrega hasta 16 µ, más que sus 2 µ del evento suelto: no se cumple el supuesto de la regla ("cada evento agrega como mucho su error estricto"). **Causa:** no es el redondeo (en el suelto, ≤ 1 µ). Es una amplificación por suma: en el encadenado, la demanda de cada hogar difiere de la de JMAB en ~10⁻⁷ relativo (sale de sus intereses, dividendos y depósito en µ, eventos 8 y 17), o sea ~0,1–0,4 µ en el monto de cada compra; las reservas de un banco suman ~1.600 compras entre bancos y los depósitos de una empresa ~80, y esos errores se acumulan como una caminata al azar (√1.600 × 0,15 µ ≈ 6 µ típico; 18 µ como máximo en 10 bancos).
  2. **`double` de bienes de consumo** (reportados, `REPORTED_FIELDS` del test; no se agrandó ninguna tolerancia): en el tick 50, 21 cantidades y 20 valores superan el 10⁻⁶ relativo, hasta 2,2·10⁻⁵. Son **residuos**: lo que queda del inventario de una empresa después de ~80 ventas (la última compra se lleva el resto) o el resto de la demanda de un hogar en su segunda compra. El error absoluto es el de las demandas sumadas (~7·10⁻⁶ unidades), chico frente a lo vendido pero grande frente a un residuo de 0,1–0,4 unidades. En el evento suelto son bit a bit.
  - **Respuesta de Nico (2026-11-13):** no agrandar tolerancias por campo; corregir el supuesto de la regla del encadenado. Regla aprobada e implementada (sec. 1): los bienes pasan con ρ = 10⁻⁶ (peor diferencia/S 1,8·10⁻⁸).

## 18. Evento 19: segunda etapa del mercado de capital (`capitalMarketTic2`)

**Qué cambia en JMAB** (diff de volcados, tick 50): el orden de la población de empresas de consumo (y de la lista de compradores del mercado 0, que es la misma); 106 añadas nuevas en 99 empresas de consumo, al final de su lista de capital (edad −1); los depósitos de esas empresas y de las de capital, y las reservas; el inventario de las 20 empresas de capital (cantidad y valor) y la bandera de 9 que se quedan sin inventario; `previousSupplier` (9 empresas); `desiredCapacityGrowth` y `desiredRealCapitalDemand` de las 100; `active[MKT_CAPGOOD]` de 98; y `selectedCapitalGoodSuppliers` de 28. Un solo sorteo: la mezcla de compradores.

| Qué | JMAB | Port (`capitalMarketSecondStepEvent`) |
|---|---|---|
| Disparo | `AbstractTwoStepMarketSimulation.eventOccurred` (segunda etapa) → `BrochureMarket.secondStep` → `BrochureSelectionRandomRobinBuyerMixer.invokeSecondInteractions`: mezcla los compradores (la lista de la población, en el lugar) y manda la llegada a cada uno **activo** en el mercado de capital, en ese orden | igual |
| Llegada | `ConsumptionFirm.onAgentArrival` 216–227 (rama de la segunda etapa) | igual |
| Crecimiento deseado | `InvestmentCapacityOperatingCashFlowExpected.computeDesiredGrowth` (XML 2121–2130): capacidad = Σ cantidad × productividad (todas las añadas); K = `LAG_CAPITALFINANCIALVALUE` (t − 1); tasa de flujo de caja = `LAG_OPERATINGCASHFLOW` (t − 1) / K; −1 si la capacidad o K son 0; si no, max(−1, 0,01·(OCF/K − 0,043447814)/0,043447814 + 0,02·(Y*/capacidad − 0,8)/0,8) | `desiredCapacityGrowth`; parámetros en `RULES` |
| Lazo | n = vendedores vistos + 1 (fijo al empezar); mientras i < n, la demanda real sea > 0 y queden vistos: `selectGoodSupplier(vistos, 0, true)` → `computeDesiredInvestment(elegido)` (recalcula la demanda real con el crecimiento nuevo y el capital ya comprado, que entra en la capacidad residual) → `commit` (compra) → `selectedCapitalGoodSuppliers.remove(elegido)` | igual; la elección y la demanda son las del evento 5 (`selectCapitalSupplier`, `computeDesiredInvestment`, extraídas sin cambios) |
| Compra | `AtOnceMechanism.execute` con `CapitalGood`: cantidad = min(demanda, inventario); monto = cantidad × precio del inventario; cobra el primer depósito de la empresa de capital (`CapitalFirm.getPayableStock`); `ConsumptionFirm.getPayingStocks` (MKT_CAPGOOD) = depósitos con el efectivo insertado antes del último (`add(size − 1, cash)`), paga el primero de esos depósitos | `capitalPurchase` |
| `reallocateLiquidity` | si el primer depósito no alcanza, pasa lo que falta desde las otras cuentas, en el orden de la lista: otro depósito con `transfer` (pago entre bancos) | igual, con `PaymentBatch.pay` (categoría `deposits`); **con efectivo distinto de 0, error** (abajo) |
| Sin plata | si el depósito no alcanza: inactiva en capital, compra ⌊depósito / precio⌋ | igual |
| Bien | `new CapitalGood(monto, cantidad, empresa, vendedor, precio, productividad, duración, amortización, capital/trabajo)`: edad −1, costo unitario 0, al final de la lista | igual |
| Después | inventario − cantidad (`CapitalGood.setQuantity` recalcula el valor contable); demanda − cantidad; inactiva si la demanda o el depósito llegan a 0; vendedor inactivo sin inventario | igual; pagos con redondeo controlado al cerrar el evento (sec. 1) |

**De dónde sale el cambio de `selectedCapitalGoodSuppliers` (pedido de Nico, 2026-11-13).** La segunda etapa saca de la lista a cada proveedor que elige (`remove`, línea 225), y la lista es **el mismo `ArrayList`** que guardó la primera etapa (`this.selectedCapitalGoodSuppliers = event.getObjects()`, línea 215): se modifica en el lugar. Solo cambia si el elegido estaba en la lista. Desglose del tick 50 (100 empresas): 72 compraron una vez a su proveedor previo, que **no** estaba entre los 5 vistos (con `payOrReceive` = true se quedan con el previo mientras esté activo, sec. 7): `remove` no hace nada; 20 compraron una vez a uno de la lista; 3 agotaron al previo y completaron con uno de la lista; 1 compró a dos de la lista; y en 4 se sacaron además vendedores sin inventario sin comprarles (la estrategia elige el más atractivo de la lista **sin mirar si está activo**; con inventario 0 la compra es de 0, pero igual se lo saca). 20 + 3 + 1 + 4 = 28. Registrado como rareza del código en [caiani-referencia.md](caiani-referencia.md) (elegir un vendedor sin inventario y sacarlo aunque la compra sea 0); candidato a extensión después de V4 (pendientes). Consecuencias que el port reproduce: la lista achicada es la que queda hasta el evento 3 del tick siguiente, y si en ese evento una empresa no ve ningún vendedor activo conserva la lista achicada (que puede quedar vacía: el evento 5 tira el error de JMAB).

**Rama no portada (error explícito aprobado por Nico el 2026-11-13, mismo criterio que el del hogar):** `reallocateLiquidity` con el efectivo de la empresa distinto de 0 tira un error explícito, como la del hogar en el evento 18. Las empresas tienen un ítem de efectivo siempre en 0 (verificado en los volcados de los ticks 1 y 50; inicializacion.md, sec. 5: nadie tiene efectivo en 400 trimestres). La rama de otro depósito sí está portada.

**Qué se ejercita.** Tick 1: 100 compras (una por empresa). Tick 50: 106 compras en 99 empresas, 9 empresas de capital se quedan sin inventario, 9 cambios de proveedor. En los dos ticks el primer depósito alcanza siempre. **Sin cobertura de V3:** `reallocateLiquidity` desde el segundo depósito (90 de 100 empresas tienen dos depósitos, pero nunca hace falta), el depósito insuficiente, el crecimiento con capacidad o K en 0 y el piso −1: solo casos a mano.

**Verificación:**
- A mano: crecimiento deseado (término de capacidad con el del flujo de caja en 0 exacto, piso −1, sin capacidad); lazo con el previo fuera de la lista (compra 3 hasta agotarlo; después elige de la lista al más atractivo sin inventario, compra 0 y lo saca; recalcula la demanda, 7, y se la compra al siguiente; lista vacía, montos, añadas, inventarios y valor contable recalculado); previo en la lista (se lo saca; otra empresa inactiva no cambia); `reallocateLiquidity` desde un segundo depósito en otro banco (pasan 24, las reservas del otro banco bajan 24, el primer depósito queda en 0 y la empresa inactiva); error con efectivo; depósito insuficiente (⌊6,1 / 2,5⌋ = 2).
- V3, ticks 1 y 50, **evento suelto: `double` bit a bit y montos ≤ 1 µ** (cierre del lote: 100 y 106 pagos, diferencia máxima de cada pago y de cada suma < 1 µ). Encadenado 0–19: depósitos 9 y 11 µ, reservas 2 y 17 µ (tolerancia 2k = 40 µ), sin campos reportados. Sin decisiones frágiles ni dadas vuelta.

## 19. Evento 20: servicio de la deuda de las empresas (`creditInterestsTic`)

**Qué cambia en JMAB** (diff de volcados, tick 50): saldos de los préstamos (pasivo de las empresas, activo de los bancos), depósitos de las empresas, reservas, y la matriz de trabajo `debtPayments` (no se porta). Sin sorteos. Tick 81 (corrida `p3-t81`): además, una quiebra (empresa 8168: `defaulted`, `bailoutCost` = 182,94, morosidad del banco 0,0033) y los depósitos de los hogares.

| Qué | JMAB | Port (`creditInterestsEvent`) |
|---|---|---|
| Disparo | solo empresas, orden de creación (consumo, capital): `CopyOfConsumptionFirm2WagesEnd.onTicArrived` 88–89, `CopyOfCapitalFirm2WagesEnd` 87–88 → `payInterests` (`ConsumptionFirm` 634–673, `CapitalFirm` 303–348; iguales salvo que la de capital vuelve a poner `defaulted` = true) | `payLoanInterests` |
| Cuotas | `computeDebtPayments` otra vez (`debtBurden`, `debtInterests`) | `installments`, la misma función y lista que el evento 9 |
| Dos depósitos | si tiene **exactamente** dos, `transfer` de todo el segundo al primero (aunque no haga falta) | `pay` del saldo entero (exacto) |
| Efectivo | si > 0, al primer depósito (el efectivo del banco sube en espejo) | `pay` (exacto; en el base no pasa) |
| Pago | si primer depósito ≥ `debtBurden`: por préstamo, en orden, depósito − (interés + capital), reservas del banco del depósito → prestamista si son distintos, préstamo − capital | `serviceLoan` con la cuota de `installments` |
| Quiebra | si no alcanza: `bankruptcy()` → `FirmBankruptcyFireSales` | **error explícito** hasta que se apruebe la propuesta (abajo) |

**Verificación:**
- A mano: junta los dos depósitos y paga las cuotas (depósito final = total − servicio, préstamos − capital, `debtBurden` y `debtInterests`); préstamo de otro banco (reservas del banco del depósito → prestamista, por cada cuota de un préstamo de otro banco); sin liquidez, el error de la quiebra.
- V3, ticks 1 y 50: `double` bit a bit. Tick 1: montos ≤ 1 µ. **Tick 50, evento suelto: las reservas de 5 de los 10 bancos superan los 2 µ (3 a 6 µ)**; depósitos y préstamos ≤ 2 µ. Quedan **reportadas** (`REPORTED_FIELDS` del test, solo en el evento 20; ahora la lista acepta un filtro por evento). Encadenado 0–20: depósitos 9 y 11 µ, reservas 2 y 18 µ (tolerancia 42 µ), pasa. Sin decisiones frágiles.

**Decisión 1 (Nico): las reservas del evento 20.** Es el problema de las cuentas que reciben de muchos pagadores (sec. 1, "Reservas"): cada cuota queda a < 1 µ de la de JMAB (arrastre sobre la lista de cada empresa, `installments`), pero las reservas de un banco suman las cuotas de todas las empresas con depósito en otro banco que le deben, y esos errores no se cancelan. Opciones:
- **A (recomendada): redondeo controlado también en el evento 20.** El evento paga con `PaymentBatch` los montos de JMAB en `double` (interés = tasa × saldo; capital = A/L, o el saldo en la última cuota), y el redondeo conjunto acota a la vez cada cuenta que paga, cada banco, cada préstamo y cada prestamista. Hace falta: (i) que `PaymentBatch` acepte pagos a un préstamo (patas de `payTo` + baja del préstamo), y (ii) mantener las dos reglas aprobadas de las cuotas: la última cuota sigue siendo el saldo entero (un monto entero queda exacto en el redondeo controlado) y la corrección del desvío entra en el `double` del capital (A/L − c). Consecuencia: la cuota pagada de un préstamo puede diferir en 1 µ de la de `installments` que usa el evento 9 (el total de la empresa sigue a < 1 µ). Habría que ajustar la frase "los eventos 9 y 20 usan la misma función" de ledger-contratos.md (decisión 4).
- B: dejarlo como está: viola la regla de 2 µ en el evento suelto (habría que tolerarlo por campo, lo que la regla no permite).

**Decisión 2 (Nico): propuesta para portar la quiebra de empresas (`FirmBankruptcyFireSales.bankrupt`, XML 1883–1886 y 2177–2180, quita 0,5).** No es opcional: en la corrida base de 400 trimestres (semilla 12345) hay 325 quiebras por deuda y quiebras por salarios en 264 trimestres; la usan los eventos 20, 21 y 24. Lo que hace JMAB, y lo que propongo para el port:
1. **Dos depósitos:** pasa todo el segundo al primero y **saca el segundo solo de la lista del banco** (la empresa lo conserva, en 0): las dos listas quedan inconsistentes en JMAB. Propuesta: cerrar el contrato en las dos puntas (el ledger no admite un contrato colgado) y que `compareState` acepte esa diferencia de forma, documentada.
2. **Efectivo:** al depósito (igual que en `payInterests`).
3. **Reparto de la liquidez** entre los préstamos, en proporción a su saldo (todo, si la liquidez alcanza para la deuda): propuesta, **restos mayores** con desempate por id (decisión de diseño ya aprobada en ledger-contratos.md, sec. 2.1, para este caso): la suma es exactamente la liquidez y el depósito queda en 0, como el `setValue(0)` de JMAB.
4. **Rareza: el excedente desaparece.** Si la liquidez supera la deuda total (posible en la quiebra por salarios del evento 21 o con la última cuota), JMAB paga toda la deuda y pone el depósito en 0: el excedente se borra (ganancia del banco, pérdida de la empresa). Propuesta: reproducirlo con un `writeDown` explícito (categoría `writeOff`) y registrarlo en caiani-referencia.md como rareza.
5. **Aporte de los dueños** (solo empresas de consumo): D = min(0,5 × Σ valor de las añadas, pérdida de los bancos) va a `bailoutCost`; cada hogar paga D × patrimonio del hogar / patrimonio total × pérdida del préstamo / pérdida total, por préstamo (8.000 × préstamos pagos en `double`; el depósito del hogar baja y, si el banco no es el prestamista, se mueven reservas; el préstamo baja). Propuesta: `PaymentBatch` con redondeo controlado (con el agregado (i) de la decisión 1) y una **categoría de flujo nueva** para este pago (transferencia corriente hogares → empresa que cancela deuda; p. ej. `ownersBailout`). JMAB no chequea que el depósito del hogar alcance: con un depósito que quedaría negativo, error explícito. Un hogar con patrimonio negativo "cobra" en vez de pagar; se reproduce.
6. **Lo que queda de los préstamos** se pone en 0: `writeOff` en el ledger y `currentNonPerformingLoans` del banco += la pérdida.
7. La empresa no sale (población fija): `defaulted` = true, y sigue operando.
Verificación propuesta: casos a mano de cada paso y V3 en el tick 81 (`p3-t81`), que tiene una quiebra por deuda en el evento 20 y cuatro por salarios en el 21.

