# Ledger de contratos (P1): diseño

Estado: **aprobado e implementado** (decisiones de Nico del 2026-11-13, sec. 3; código en `packages/engine/src/caiani/`, sec. 4). Plan general en [plan-port-caiani.md](plan-port-caiani.md), sec. 3. Decisiones ya tomadas que este diseño usa (Nico, 2026-11-12):
- escala monetaria: saldos enteros, con 1 unidad de Caiani = 10⁶ unidades del ledger (µ);
- normal plegada determinista por inversa de la distribución;
- 10 bancos y bonos desde la base.

Todo lo que se afirma sobre JMAB sale de `reference/jmab-2015/src` (el fuente equivalente al `.jar`, V0) y de `paper-launcher/Model/modelFile.xml`.

## 1. Cómo lo hace JMAB

**Ítems compartidos.** Cada instrumento es un objeto (`AbstractItem`) con `value`, `quantity`, `age`, `assetHolder` y `liabilityHolder`. El mismo objeto está en la lista de activos del tenedor y en la de pasivos del emisor, así que **cada fila del balance suma cero por construcción**.

**Listas por agente.** Cada agente tiene `stockMatrix[activo|pasivo][tipo]`: listas en **orden de inserción**. Muchas reglas dependen de ese orden. Por ejemplo, la empresa usa `deposits.get(0)` como cuenta principal (`ConsumptionFirm.payInterests`), y los préstamos se recorren en orden para el servicio de la deuda.

Tipos (`StaticValues.SM_*`):

| id | Tipo | Tenedor → emisor en el escenario base |
|---|---|---|
| 0 | `CASH` | hogares, empresas, bancos → banco central |
| 1 | `DEP` (depósitos) | hogares, empresas → bancos |
| 2, 3 | `CONSGOOD`, `CAPGOOD` | bienes reales (no son pasivo de nadie) |
| 4 | `LOAN` | bancos → empresas |
| 5 | `BONDS` | bancos, banco central → gobierno |
| 6 | `RESERVES` | bancos **y la cuenta del gobierno** → banco central (son `Deposit` en el BC) |
| 7 | `ADVANCES` | banco central → bancos (`Loan`) |

**Pagos entre bancos** (`AbstractBank.transfer`). Se baja el depósito del pagador y se sube el del cobrador. Si los bancos son distintos, las reservas pasan del banco del pagador al del cobrador.
- **Sin chequeo de saldo**: las reservas de un banco pueden quedar **negativas** durante el tick.
- Se corrigen con adelantos del BC (`ReservesMechanism`), que se piden según `BaselIIIReserveRequirementsBLR`: (efectivo + reservas) ≥ 0,08 × depósitos.

**Pagos del gobierno** (`CentralBank.transfer`). Baja la cuenta del gobierno en el BC, sube el depósito del cobrador y suben las reservas del banco del cobrador.

**Préstamos** (`ConstrainedCreditMechanism`):
- Se crea un `Loan` y se acredita en un depósito del deudor **en el banco prestamista**. Si el deudor no tenía cuenta ahí, se abre una. Por eso una empresa puede tener dos cuentas (el código dice "at max 2"), y antes de pagar pasa todo a la primera.
- Amortización `FIXED_CAPITAL` (tipo 0), 20 trimestres: el capital de cada cuota es `initialAmount / length`.
- El interés es `tasa × saldo`, y solo se paga si `age > 0`.

**Adelantos del BC:** `ONLY_INTERESTS` (tipo 2), 1 trimestre, tasa 0,005. Se pagan desde las reservas.

**Interés de los depósitos** (`Bank.payDepositInterests`): se capitaliza (`value *= 1 + tasa`). Es un gasto del banco y un ingreso del depositante.

**Bonos:**
- Precio 1, vencimiento 1, tasa 0,0025 al inicio. Cada compra crea un `Bond` nuevo (tenedor: banco o BC; emisor: gobierno).
- La emisión sin vender queda en un `Bond` que el gobierno se tiene a sí mismo (`assetHolder = liabilityHolder = gobierno`).

**Limpieza** (`SimpleAbstractAgent.cleanSM`, una vez por tick y por agente):
- Recorre los activos de atrás para adelante, hace `update()` (`age += 1`) y saca los ítems con `remove()`: préstamo con `value == 0 || age > length`, bono con `maturity < age`.
- El ítem se saca de las dos listas; el resto conserva el orden.

**Préstamos de las condiciones iniciales** (verificado con el oráculo en P2, 2026-11-13; [inicializacion.md](inicializacion.md)):
- El inicializador crea préstamos ya empezados: edad j + 1, saldo = original × (20 − j)/20, con original = préstamo por empresa / (1 + g)ʲ.
- **Corrección (P2):** acá se había anotado que quedaban con `initialAmount = saldo actual` (lo que hace el constructor) y que vencían con saldo pendiente, una condonación implícita. **Es falso:** el inicializador llama después a `loan.setInitialAmount(original)`, y el volcado del oráculo lo confirma. Pagan original/20 por trimestre y **cierran en cero exactamente a la edad 20**. No hay condonación.

## 2. Diseño

### 2.1 Dinero

- `Micro`: entero seguro, 1 unidad de Caiani = 10⁶ µ. `money.ts` se generaliza (hoy habla de centavos): mismos helpers, otra unidad. La Fase 0 sigue con centavos hasta P6.
- **Lo que es dinero se guarda en µ:** saldos de contratos y montos de cada flujo.
- **Lo que no es dinero se guarda en `double`:** precios, tasas, expectativas, márgenes, cantidades reales. Se calcula con las cuatro operaciones (principio 4).
- **Conversión:** `toMicro(x) = Math.round(x × 10⁶)`. Es determinista: `Math.round` es exacta según el estándar. Todo flujo calculado en `double` (interés, salario × trabajadores, impuesto) pasa por `toMicro` una sola vez, en el momento de registrarlo.
- **Repartos proporcionales** (dividendos a 8.000 hogares, liquidez de una empresa quebrada entre sus acreedores, quitas): método de restos mayores, con desempate por id. La suma de las partes es exactamente el total.
- **Última cuota de un préstamo:** paga el saldo que quede, para que el préstamo cierre en cero. Es una adaptación documentada: en JMAB el redondeo de `double` deja residuos que `cleanSM` borra en silencio. (Acá decía que la condonación de los préstamos iniciales se reproducía aparte; esa condonación no existe, ver sec. 1.)

### 2.2 Contratos

```ts
type ContractKind = 'cash' | 'deposit' | 'loan' | 'bond' | 'reserves' | 'advance';

interface Contract {
  id: number;            // correlativo del estado (determinista)
  kind: ContractKind;
  holder: AgentId;       // activo
  issuer: AgentId;       // pasivo
  amount: Micro;         // saldo; ver 2.4 para el signo
  age: number;
  rate: number;          // depósito, préstamo, adelanto, bono
  // préstamos y adelantos
  length?: number;
  amortization?: 'fixedCapital' | 'onlyInterest';
  initialAmount?: Micro;
  // bonos
  quantity?: number;
  price?: number;
  maturity?: number;
}
```

- **Almacenamiento:** `state.contracts` (arreglo de objetos planos, serializable) y, por agente, `assets[kind]` y `liabilities[kind]` como listas de ids **en el orden de JMAB** (orden de inserción; la limpieza conserva el orden).
- **Ids:** contador en el estado. Nunca se itera un `Map` ni un objeto con claves no enteras.
- **Bienes reales** (inventarios, añadas de capital): **no van en el ledger** (no tienen contraparte). Van en un módulo propio de P3, con su valor contable. Sus flujos (venta, inversión, amortización, ganancias de capital en inventarios) sí se registran en la matriz de flujos (2.5).
- **Emisión de bonos sin vender:** no es un contrato. Es una cantidad ofrecida en el estado del gobierno (no es un activo ni un pasivo de nadie). Se documenta como diferencia de forma con JMAB, sin efecto en los saldos.

### 2.3 Operaciones (la única forma de modificar el ledger)

Cada operación recibe la **categoría de flujo** (fila de la matriz de transacciones, 2.5) y la registra.

| Operación | Efecto | Uso en Caiani |
|---|---|---|
| `open(kind, holder, issuer, amount, terms, flow)` | Crea el contrato al final de las dos listas | préstamo nuevo, depósito nuevo, compra de bonos, adelanto |
| `pay(from, to, amount, flow)` | Baja el contrato `from` y sube `to`. Si los emisores difieren, liquida con reservas (abajo) | salarios, consumo, inversión, impuestos, dividendos, seguro de desempleo |
| `accrue(contract, amount, flow)` | Sube el saldo: el emisor le paga al tenedor sin movimiento de dinero | interés de los depósitos |
| `amortize(loan, principal, interest, from, flow)` | Paga interés y capital desde la cuenta `from` (con liquidación si el banco es otro) | servicio de la deuda, adelantos, bonos al vencer |
| `writeDown(contract, amount, flow)` | Baja el saldo sin contrapartida: pérdida del tenedor, ganancia del emisor | quiebras, quita a los depositantes en el rescate, préstamos que vencen con saldo (no debería pasar en la corrida base) |
| `cleanup(agent)` | `age += 1` y cierre de contratos vencidos o en cero, como `cleanSM` | fin del tick |

**Liquidación de `pay`** (sigue a `AbstractBank.transfer` y `CentralBank.transfer`):
- **Mismo emisor:** solo se mueven los dos saldos.
- **Bancos distintos:** además, reservas del banco del pagador → reservas del banco del cobrador.
- **El pagador es la cuenta del gobierno en el BC:** sube el depósito del cobrador y las reservas de su banco.
- **El cobrador es la cuenta del gobierno en el BC** (impuestos): baja el depósito del pagador y las reservas de su banco.
- **Efectivo ↔ depósito:** el efectivo del banco cambia en espejo, como `getCounterpartItem`.

### 2.4 Signos y sobregiros

- Depósitos, préstamos, bonos, efectivo y adelantos: **saldo ≥ 0 siempre**. Si una operación lo dejaría negativo, el motor tira un error: es un bug del port, no una situación del modelo, porque las reglas de Caiani chequean liquidez antes de pagar.
- Reservas (bancos y cuenta del gobierno): **pueden quedar negativas durante el tick**, porque JMAB no chequea al liquidar entre bancos. **A verificar en P3 con el oráculo:** en qué etapas queda una reserva negativa y si después del mercado de adelantos vuelve a ser ≥ 0. Si en el `.jar` nunca pasa, se ajusta el chequeo.

### 2.5 Invariantes

**Estructural** (`checkLedger`, desde cero):
- índices de las listas consistentes con los contratos;
- saldos enteros seguros;
- signos según 2.4;
- tenedor y emisor permitidos para cada tipo.

Como cada contrato tiene un solo saldo, las filas de la matriz de balances suman cero por construcción. El chequeo verifica que no se rompió la estructura.

**De flujos (nuevo; en Caiani, `TFMComputer`):** cada operación registra (categoría, sector y cuenta del pagador, sector y cuenta del cobrador, monto). Al final del tick se verifica:
1. **Filas:** cada categoría suma cero entre sectores. Las filas son las del cuadro 2 del paper: consumo, salarios, seguro de desempleo, ganancias de capital en inventarios, inversión, amortización del capital, impuestos, intereses de depósitos, bonos, préstamos y adelantos, ganancias, ganancias del BC, más las de variación de stocks (Δ depósitos, Δ adelantos, Δ reservas, Δ bonos, Δ préstamos, Δ efectivo).
2. **Stocks contra flujos:** para cada tipo de contrato y cada sector, saldo al final − saldo al principio = flujo neto registrado (aperturas + pagos + capitalizaciones − amortizaciones − quitas).
3. **Columnas:** para cada agente, la variación de su patrimonio financiero = sus ingresos − sus gastos + las quitas a su favor − las quitas en su contra.

Se corre en cada tick en los tests y en modo debug, igual que el chequeo SFC actual.

### 2.6 Determinismo y oráculo (V3)

- El ledger no usa azar. El orden de todo recorrido es el de las listas (2.2).
- **El oráculo da valores, no uniformes** (confirmado el 2026-11-12):
  - `FoldedNormalDistribution.nextDouble()` del oráculo devuelve `Draws.foldedNormal(Math.abs(delegate.nextDouble()))`: se registra **el valor |N| ya generado por Colt**, por ejemplo `fn  AdaptiveMarkUpOnAC.computePrice  0.008718299545512441`.
  - En modo oráculo, el `Rng` semántico del port (`foldedNormal(σ)`, `bernoulli(p)`, `sample(…)`, `shuffle(…)`, `uniform01()`) **devuelve el valor registrado** y verifica que el tipo, el lugar y el parámetro coincidan. El método con el que Colt generó la normal (y cuántos uniformes consumió) no importa.
  - El valor se registra con `Double.toString` de Java, que siempre identifica un único `double`, y `parseFloat` de JS lo lee igual. Lo va a verificar un test del arnés.
- **Consecuencia de la escala en µ para V3 (propuesta, a decidir):** el plan pide una tolerancia relativa de 1e-9 para los `double`. Con saldos redondeados a 10⁻⁶ eso no se puede cumplir: un ingreso disponible de ~30 redondeado a µ tiene un error relativo de ~2e-8, y el consumo hereda ese error.
  - **Propuesta:** montos con tolerancia absoluta de k µ (k = cantidad de redondeos que tocaron esa cuenta en el tick); `double` derivados de montos, tolerancia relativa de 1e-6; `double` que no dependen de montos (expectativas de precios, márgenes), 1e-9.
  - Una decisión discreta que se da vuelta (umbral, elección del más barato) con una diferencia dentro de la tolerancia se informa aparte, no como falla.

### 2.7 Qué pasa con lo que hay

- `packages/engine/src/ledger.ts` y `money.ts` quedan para la Fase 0 y el tramo 1a (registro) hasta P6.
- El port vive en un módulo nuevo, `packages/engine/src/caiani/`: `money.ts` (µ), `ledger.ts` (contratos y operaciones), `flows.ts` (matriz de transacciones e invariantes), `normal.ts` (normal plegada) y `rng.ts` (interfaz semántica: modo PRNG y modo oráculo).
- Se reutilizan `rng.ts` (xoshiro) como fuente de uniformes, `detmath.ts`, `hash.ts` y el test de que no se usa `Math.random` ni funciones trascendentales (cubre el módulo nuevo sin cambios).

### 2.8 Tests de P1

- **Ledger:** cada operación con un caso calculado a mano (patrón de `rules-by-hand.test.ts`):
  - pago entre clientes del mismo banco y de bancos distintos;
  - pagos desde y hacia la cuenta del gobierno;
  - préstamo nuevo en un banco donde el deudor no tenía cuenta;
  - amortización con última cuota;
  - quita;
  - limpieza conservando el orden.
- **Propiedades:** secuencias aleatorias de operaciones (con semilla) que mantienen las tres invariantes de 2.5; una operación que viola un signo tira error y no deja el estado a medio modificar.
- **Repartos:** la suma exacta y el desempate por id.
- **Normal plegada:** media σ√(2/π) y varianza σ²(1 − 2/π) con 10⁶ sorteos; Kolmogorov–Smirnov contra la normal; misma semilla, mismos valores; monótona en u.
- **Rng en modo oráculo:** lee un `draws.tsv` real del oráculo, devuelve los valores en orden y falla con un mensaje claro si el tipo o el lugar no coinciden.

## 3. Decisiones (Nico, 2026-11-13)

1. **Tolerancias de V3 en tres niveles** (2.6): OK. Además, **contar y reportar cuántas decisiones discretas se dan vuelta** por diferencias dentro de la tolerancia. Escrito en `plan-port-caiani.md`, sec. 4 (V3); el contador va en el arnés de V3 (P3).
2. **Reservas negativas durante el tick, como en JMAB** (2.4): OK, **con un contador de cuántas veces ocurre**.
3. **Última cuota que cierra en cero** (2.1): OK, documentada como diferencia con JMAB (sec. 4).

## 4. Implementación (2026-11-13)

Módulo `packages/engine/src/caiani/`: `money.ts`, `ledger.ts` (lleva el encabezado de código portado), `flows.ts`, `normal.ts`, `rng.ts` e `index.ts`. Todavía no se exporta desde `src/index.ts`: convive con el motor viejo hasta P6.

**Cambios respecto del diseño de la sec. 2** (de forma, salvo que se diga):
- **Operaciones.** `accrue` pasó a ser `credit`, que sube un saldo con el emisor como contraparte: sirve para el interés capitalizado y también para acreditar un préstamo o una compra de bonos del BC. Se sumó `debit`, la inversa: baja un saldo pagándole al emisor con un pasivo del propio emisor (amortización, interés de un adelanto pagado con reservas). `writeDown` es un `debit` con categoría `writeOff`. `amortize` quedó partida en `payTo` (pago a un banco o al BC desde una cuenta, con liquidación si el banco de la cuenta es otro, como `CapitalFirm.payInterests`) y `serviceLoan`, que la usa.
- **Cuota de capital (decisión 3).** La cuota de la edad a es redondeo(A·a/L) − redondeo(A·(a − 1)/L), con A = initialAmount y L = length. Cada cuota difiere de A/L (lo que paga JMAB) en menos de 1 µ y las cuotas de las edades 1 a L suman exactamente A, así que el préstamo cierra en cero sin un caso especial para la última. Los préstamos iniciales, que arrancan con edad j + 1, se abren con saldo A − redondeo(A·j/L) (P2), así que también cierran en cero.
- **Condonación al vencer.** La limpieza (`cleanup`) condona con un `writeOff` explícito el saldo de un préstamo o adelanto que se cierra con saldo (lo que JMAB borra sin registrar), y lo cuenta en `writtenOffAtExpiry`. En la corrida base no debería pasar nunca (los préstamos iniciales cierran en cero, sec. 1); si pasa, es una señal para investigar. Un bono que vence sin rescatar es un error del port.
- **Contadores de reservas negativas (decisión 2).** Hay dos: `negativeReservesBank` y `negativeReservesGovernment`. Cuentan las veces que una operación lleva un saldo de ≥ 0 a < 0. Se separan porque **la cuenta del gobierno en el BC queda negativa por diseño**: `Government.emitBonds` lee el déficit como el saldo negativo de esa cuenta y emite bonos por ese monto. Lo de los bancos es lo que hay que verificar en P3.
- **Categorías de flujo** (`FLOW_CATEGORIES`). Corrientes, que cambian el patrimonio financiero: consumo, salarios, seguro de desempleo, inversión, impuestos, intereses de depósitos, de bonos, de préstamos y de adelantos, dividendos, ganancias del BC y `writeOff`. Financieras, que solo cambian la composición del balance: préstamos, adelantos, bonos y depósitos (movimientos entre cuentas propias y entre efectivo y depósitos). La invariante de columnas usa esa clasificación, así que un pago corriente mal clasificado como financiero se detecta (hay un test). Las ganancias de capital en inventarios y la amortización del capital son flujos sin dinero y entran en P3 con los bienes reales.
- **Movimientos** por (tipo, sector del tenedor, sector del emisor) en un arreglo plano, y no en un objeto con claves de texto (sec. 2.2).

**Normal plegada.** Paso de la tabla h = 1/256 en z (1.665 nodos, se arma en milisegundos al cargar el módulo). Comparada con `statistics.NormalDist` de Python en 20.000 uniformes más la cola hasta u = 1 − 2⁻³², el error máximo es 9,5·10⁻¹⁰ en z (relativo 1,5·10⁻¹⁰), en la cola extrema. Con h = 1/32 era 3·10⁻⁶. F se calcula por la serie de Marsaglia para z < 3 y por la fracción continua de la razón de Mills para z ≥ 3; en el empalme coinciden en 10⁻¹⁵.

**Rng semántico.**
- Interfaz `CaianiRng`: `foldedNormal`, `bernoulli`, `shuffle`, `shuffleEmployees`, `sample` y `uniform01`. Cada pedido lleva el lugar de JMAB (`Clase.método`).
- Modo PRNG: xoshiro de `rng.ts`, un uniforme por normal; la Bernoulli con p ≤ 0 o p ≥ 1 no consume azar, igual que JMAB.
- Modo oráculo: verifica el tipo, el lugar, el tick (si se fija) y los agentes de cada lista. El σ de la normal no se registra, así que no se puede verificar. La p de la Bernoulli se compara con tolerancia relativa de 10⁻⁶ y las diferencias se anotan en `pDiffs`.
- Los ids son los de JMAB: el arnés de V3 pasa la correspondencia.
- **Verificado con el registro real** de la corrida "a" del oráculo (212.680 sorteos, ticks 1 a 6): el test los relee en orden y comprueba que cada valor llega exacto. Por separado, los dígitos de los 109.998 valores `double` registrados por Java coinciden con la representación más corta (la de JS), así que `parseFloat` recupera el mismo `double`.

**Tests** (`packages/engine/test/caiani-*.test.ts`, 49 en total; corren en `pnpm test`):
- casos a mano de cada operación: pagos en el mismo banco y entre bancos, desde y hacia la cuenta del gobierno, efectivo, préstamo en un banco nuevo, cuotas, condonación de un préstamo que vence con saldo, adelantos, bonos, intereses, quitas y limpieza;
- propiedades: 6.000 operaciones al azar con 5 semillas, con las invariantes en cada tick y la atomicidad de las operaciones que fallan;
- repartos por restos mayores;
- normal plegada: cuantiles, momentos, Kolmogorov–Smirnov, monotonía y determinismo;
- `Rng` en los dos modos. El test con el registro real se saltea si falta `reference/`.

**Para P3, visto en el código de JMAB:**
- `Households.payTaxes`, cuando el depósito no alcanza y el hogar tiene efectivo, deja el depósito en negativo: primero lo pone en `taxes` y después en `depValue − taxes`, con el valor viejo. Hay que ver si en la corrida base los hogares llegan a tener efectivo. Si no tienen, no importa.
- Los pagos de impuestos e intereses de JMAB modifican los saldos directamente, sin pasar por `transfer`, pero las cuentas que tocan son las mismas que cubre `pay`/`payTo`.
