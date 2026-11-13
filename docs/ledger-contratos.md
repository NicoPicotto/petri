# Ledger de contratos (P1): diseño

Estado: **borrador para revisión de Nico** (2026-11-12). Todavía no hay código. Plan general en [plan-port-caiani.md](plan-port-caiani.md), sec. 3. Decisiones ya tomadas que este diseño usa (Nico, 2026-11-12):
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

**Particularidad de las condiciones iniciales** (a verificar con el oráculo en P2):
- El inicializador crea préstamos ya empezados (edad j + 1, saldo = original × (20 − j)/20 / (1 + g)ʲ). Les pone `initialAmount = saldo actual` (lo hace el constructor), así que pagan `saldo/20` por trimestre y no `original/20`.
- Al cumplir `age > 20` se sacan **con saldo pendiente**: es una condonación implícita en los primeros ~20 trimestres.
- Queda fuera de la ventana de V4, pero V1 y V3 la tienen que reproducir.

## 2. Diseño

### 2.1 Dinero

- `Micro`: entero seguro, 1 unidad de Caiani = 10⁶ µ. `money.ts` se generaliza (hoy habla de centavos): mismos helpers, otra unidad. La Fase 0 sigue con centavos hasta P6.
- **Lo que es dinero se guarda en µ:** saldos de contratos y montos de cada flujo.
- **Lo que no es dinero se guarda en `double`:** precios, tasas, expectativas, márgenes, cantidades reales. Se calcula con las cuatro operaciones (principio 4).
- **Conversión:** `toMicro(x) = Math.round(x × 10⁶)`. Es determinista: `Math.round` es exacta según el estándar. Todo flujo calculado en `double` (interés, salario × trabajadores, impuesto) pasa por `toMicro` una sola vez, en el momento de registrarlo.
- **Repartos proporcionales** (dividendos a 8.000 hogares, liquidez de una empresa quebrada entre sus acreedores, quitas): método de restos mayores, con desempate por id. La suma de las partes es exactamente el total.
- **Última cuota de un préstamo:** paga el saldo que quede, para que el préstamo cierre en cero. Es una adaptación documentada: en JMAB el redondeo de `double` deja residuos que `cleanSM` borra en silencio. La condonación de los préstamos iniciales (sec. 1) se reproduce aparte, como flujo explícito.

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
| `writeDown(contract, amount, flow)` | Baja el saldo sin contrapartida: pérdida del tenedor, ganancia del emisor | quiebras, quita a los depositantes en el rescate, condonación de los préstamos iniciales |
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

## 3. Para decidir (Nico)

1. **Tolerancias de V3** (2.6): reemplazar el 1e-9 relativo por la propuesta de tres niveles. Cambia la sec. 4 del plan.
2. **Reservas negativas durante el tick** (2.4): permitirlas como en JMAB y verificar en P3 si el `.jar` las produce. Alternativa: prohibirlas desde ya (más estricto, pero el port podría fallar donde el `.jar` no falla).
3. **Última cuota de los préstamos** (2.1): cerrar con el saldo restante, en vez de dejar residuos que se borran en silencio. Es la única diferencia contable con JMAB de este diseño, sin contar la condonación de los préstamos iniciales, que se reproduce.
