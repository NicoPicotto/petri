# Contabilidad stock-flujo consistente (SFC)

Referencia: Godley & Lavoie (2007), *Monetary Economics*, cap. 2.

## Matriz de balances

Filas = instrumentos financieros. Columnas = sectores. **Cada fila suma cero**: todo activo financiero es pasivo de otro.

Convención de signos en el código (`Agent.positions`): **+ = activo, − = pasivo**.

| Instrumento       | Hogares | Empresas | Banco | Tesoro | BCRA | Σ |
|-------------------|:-------:|:--------:|:-----:|:------:|:----:|:-:|
| `cash`            |   +     |    +     |       |        |  −   | 0 |
| `deposits`        |   +     |    +     |   −   |        |      | 0 |
| `loans`           |   −     |    −     |   +   |        |      | 0 |
| `reserves`        |         |          |   +   |        |  −   | 0 |
| `treasuryAccount` |         |          |       |   +    |  −   | 0 |
| `bonds`           |         |          |   +   |   −    |  +   | 0 |
| `advances`        |         |          |       |   −    |  +   | 0 |
| `centralBankCredit` |       |          |   −   |        |  +   | 0 |
| **Patrimonio financiero neto** | | | | | | **0** |

Los activos reales (capital, inventarios) no tienen contraparte y quedan fuera de esta matriz.

`centralBankCredit` (agregado en el paso 1a.2 de la Fase 1) es el financiamiento del BCRA al banco, del tipo pases o redescuentos. Como el banco presta creando depósitos, puede quedarse sin reservas cuando sus clientes le pagan al Tesoro. En ese caso, `ensureBankReserves` le presta la diferencia. En la Fase 1 no cobra interés todavía: la tasa base es un parámetro fijo que entra con R13 (paso 1a.3).

`advances` (adelantos transitorios) es la vía por la que el BCRA financia al Tesoro con emisión. Separar Tesoro y BCRA permite que el financiamiento monetario del déficit sea un movimiento contable explícito y no una regla.

## Cómo se garantiza

El estado financiero solo se modifica con tres primitivas ([ledger.ts](../packages/engine/src/ledger.ts)):

- `transfer(instr, from, to, monto)`: mueve un activo existente entre tenedores (ej.: un pago con depósitos).
- `issue(instr, tenedor, emisor, monto)`: crea las dos puntas a la vez (ej.: el banco presta → `loans` y `deposits` nacen juntos).
- `redeem(instr, tenedor, emisor, monto)`: cancela las dos puntas.

Las tres validan que el sector pueda tener ese instrumento del lado correspondiente y que los montos sean enteros positivos.

## Cómo se verifica

`checkSfc(state)` suma todo desde cero, sin confiar en las primitivas, y devuelve la lista de violaciones:

1. `not-integer`: una posición no es un entero seguro de centavos.
2. `forbidden-position`: un sector tiene un instrumento con un signo que no le corresponde (ej.: un hogar con reservas).
3. `nonzero-row`: un instrumento no suma cero.

`step` llama a `checkSfc` al final de cada tick (desactivable con `checkInvariants: false`) y corta con error si algo falla.

## Unidad

Centavos enteros (`Cents`). Las sumas son exactas y el invariante se chequea sin tolerancia. Toda la aritmética pasa por [money.ts](../packages/engine/src/money.ts), así que si en algún momento hace falta `bigint` (alta inflación sostenida), el cambio queda aislado ahí.

## Flujos del crédito (paso 1a.2 de la Fase 1)

Están en [flows.ts](../packages/engine/src/flows.ts). Todos se arman con las tres primitivas, así que respetan el invariante por construcción. Cada uno tiene un test en `test/bank.test.ts`.

| Flujo | Movimientos | Efecto en el patrimonio |
|---|---|---|
| `lend(deudor, x)` | nacen `loans` (banco +, deudor −) y `deposits` (deudor +, banco −) | ninguno: los préstamos crean depósitos (McLeay, Radia & Thomas, 2014) |
| `repayLoan(deudor, x)` | se cancelan `deposits` y `loans` | ninguno |
| `payToBank(pagador, x)` (intereses) | se cancela `deposits` del pagador | banco +x, pagador −x |
| `payFromBank(cobrador, x)` (dividendos del banco) | nace `deposits` del cobrador | banco −x, cobrador +x |
| `writeOffLoan(deudor, x)` (castigo) | se cancela `loans` sin pago | banco −x, deudor +x |
| `ensureBankReserves(x)` | nacen `centralBankCredit` y `reserves` por lo que falte | ninguno |
| `repayCentralBankCredit(x)` | se cancelan `reserves` y `centralBankCredit` | ninguno |

`netFinancialWorth(agente)` es la suma de sus posiciones financieras. Para el banco es su patrimonio: préstamos + reservas − depósitos − financiamiento del BCRA. La suma sobre todos los agentes es siempre cero.

## Capital e inventarios (R11, paso 1a.5 de la Fase 1)

El capital físico y el inventario de bienes de capital son **activos reales**: quedan **fuera de la matriz financiera** y el invariante SFC no cambia.
- `firmNetWorth(empresa)` = `netFinancialWorth` + valor libro del capital (costo histórico depreciado) + inventario valuado al costo unitario corriente.
- Por eso, la suma del patrimonio neto de todos los agentes es igual al valor de los activos reales, como en Caiani et al. (2016).
- **Comprar capital** es una transferencia de depósitos: el comprador cambia depósitos por capital al mismo valor, así que su patrimonio no cambia.
- **Amortización y revaluación del inventario:** no son flujos entre agentes. Mueven el patrimonio y entran en la ganancia de R7.
- **Test de consistencia:** patrimonio neto − resultado acumulado es constante en la vida de cada empresa (`test/phase1-capital.test.ts`).
- **Venta forzosa:** los hogares pagan con depósitos (`payDeposits`) a la empresa quebrada, que cancela deuda con el banco. Todo con flujos existentes.
