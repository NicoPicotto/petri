# Pendientes

> **2026-11-12: cambio de enfoque.** El modelo base pasa a ser Caiani et al. (2016) (ver [cambio-de-enfoque.md](cambio-de-enfoque.md)). Los pendientes sobre reglas del enfoque anterior (R1–R13) quedan como antecedente; las extensiones argentinas y los pendientes de calibración y validación siguen valiendo. Las preguntas del port ya están decididas: ver [plan-port-caiani.md](plan-port-caiani.md).

## Port de Caiani (plan en [plan-port-caiani.md](plan-port-caiani.md))

- [x] **Licencia del proyecto:** GPL-3.0-or-later (Nico, 2026-11-12). `LICENSE` y `NOTICE` agregados; encabezado de los archivos portados en `arquitectura.md`.
- [x] **Objetivo de V4:** la distribución del `.jar` (Nico, 2026-11-12). Las 25 réplicas (y después las 100) confirmaron que la tabla publicada no sale del `.jar`; la diferencia está documentada en [caiani-referencia.md](caiani-referencia.md).
- [x] **Criterio de V4** (Nico, 2026-11-12): Welch + Holm al 1% + tamaño < 0,5 desvíos, también para la dispersión y los momentos del ciclo. Escrito en `plan-port-caiani.md` (sec. 4) e implementado en `reference/tools/v4_compare.py`. **P0 cerrado.**
- [x] **Réplicas para V4:** 100 por lado (Nico, 2026-11-12). Las 100 del `.jar` terminaron el 2026-11-13, sin caídas; `resumen-100.json` es la referencia y la tabla de V4 del plan está actualizada. Con 100, los nueve indicadores publicados quedan fuera de la distribución del `.jar`.
- [x] **Ledger de contratos** (P1; decisiones de Nico del 2026-11-13): tolerancias de V3 en tres niveles, con un contador de decisiones discretas que se dan vuelta dentro de la tolerancia; reservas negativas durante el tick como en JMAB, con contador; última cuota que cierra en cero, documentada como diferencia. **Implementado** en `packages/engine/src/caiani/` ([ledger-contratos.md](ledger-contratos.md), sec. 4).
- [ ] **P3, a verificar con el oráculo:** en qué etapas quedan reservas negativas (bancos y cuenta del gobierno) y si después del mercado de adelantos vuelven a ser ≥ 0 (contadores `negativeReservesBank` y `negativeReservesGovernment` del ledger).
- [ ] **P3, arnés de V3:** contador de decisiones discretas que se dan vuelta dentro de la tolerancia (decisión de Nico, 2026-11-13); el `Rng` en modo oráculo ya anota las Bernoulli con p distinta (`pDiffs`).
- [x] **P2, inicialización (V1 cumplido, 2026-11-13):** `caiani/init.ts`, verificado contra el volcado del oráculo agente por agente ([inicializacion.md](inicializacion.md)). Corrige lo anotado en P1: los préstamos iniciales **no** se condonan, cierran en cero a la edad 20.
- [x] **Algoritmo de las mezclas en modo PRNG** (Nico, 2026-11-13): el de JMAB por defecto, defecto reproducido a propósito, con un interruptor `'uniform'`. Ver [inicializacion.md](inicializacion.md), sec. 3.
- [ ] **Medir cuánto influye el sesgo de las mezclas** (interruptor `shuffle: 'uniform'`), cuando el port corra entero (P4).
- [x] **Empleo público inicial** (pedido de Nico): el gobierno arranca con 0 y contrata 1.360 en el tick 1; al final del tick 1 el estado es el del paper (u₀ = 8%). Ver [inicializacion.md](inicializacion.md), sec. 6.
- [ ] **P3, evento por evento** ([reglas-caiani.md](reglas-caiani.md)): evento 0 hecho; siguen 1 (precios de capital) y 2 (precios de consumo).
- [ ] **P3, impuestos:** portar la rama de `Households.payTaxes` con efectivo o rechazarla con un error (nunca se ejecuta en la corrida base).
- [ ] **P3: valor contable de los bienes reales** en `double` (como JMAB, hoy) o en µ; se decide cuando entren sus flujos.
- [x] **Efectivo de los hogares** (rama rara de `Households.payTaxes`): nadie arranca con efectivo y `DepositMechanism` lo mantiene en 0 (`shareDeposits = 1`). Verificado con el oráculo: ningún efectivo distinto de cero en 400 trimestres ([inicializacion.md](inicializacion.md), sec. 5).
- [ ] **(Opcional) Origen de la tabla publicada:** no se sabe qué versión o configuración la generó. No bloquea el port.
- [x] **Escala monetaria del ledger** (P1; **aprobada por Nico el 2026-11-12**):
  - **Propuesta:** saldos enteros con 1 unidad de Caiani = 10⁶ unidades del ledger.
  - **Techo:** el saldo agregado más grande en 25 réplicas × 400 trimestres del `.jar` es 1,25 × 10⁶ unidades de Caiani, o sea 1,25 × 10¹² en el ledger. `MAX_SAFE_INTEGER` ≈ 9 × 10¹⁵, así que queda un margen de ~7.000×.
  - **Resolución:** 10⁻⁶ de un salario de 5, un error despreciable frente a la tolerancia de V3.
  - **Repartos proporcionales** (dividendos, quita de quiebras): restos mayores, desempate por id. Así la suma es exacta.
  - **Límite a futuro:** con inflación argentina alta, el margen de ~7.000× son ~13 duplicaciones de precios (13 años al 100% anual). Para los escenarios históricos va a hacer falta una redenominación dentro de la corrida o `bigint`; `money.ts` ya está pensado para migrar.
- [x] **Normal plegada determinista** (P1; **aprobada por Nico el 2026-11-12**; en modo oráculo se consume el valor |N| registrado, no un uniforme):
  - **Propuesta:** inversa de la distribución, |N(0, σ)| = σ·Φ⁻¹((1 + u)/2), con una tabla de nodos que se genera al cargar el módulo con las cuatro operaciones y `expNeg`, más interpolación cúbica de Hermite (la derivada de Φ⁻¹ es 1/φ). Se corta en u = 1 − 2⁻³², ~6,2σ.
  - **Por qué:**
    - un uniforme por sorteo (el registro de V3 queda alineado);
    - es monótona en u (números aleatorios comunes entre cápsulas);
    - no usa `log` ni `sqrt`.
  - **Tests:** momentos (media σ√(2/π), varianza σ²(1 − 2/π)) y Kolmogorov–Smirnov contra la normal.
  - **Es una adaptación documentada:** Colt usa otro algoritmo. Para V3 da igual, porque se reproducen los resultados registrados, no el algoritmo.

Estado al 2026-11-11. Lista consolidada de lo que quedó abierto al terminar la Fase 0. Cada ítem dice de dónde viene. Ninguno se resuelve sin consultar a Nico (ver "Reglas de trabajo" en `CLAUDE.md`).

## Para cerrar la Fase 0

- [ ] **Verificar en Safari un archivo de corrida v2** (exportado en Chrome, importado en Safari, tiene que decir "Reproducción verificada ✓"). La v1 ya se verificó; la v2 agregó el calentamiento.
- [ ] **Que Nico dé la Fase 0 por cerrada.** El criterio de salida se cumple (ver "Resultados" en [fase0-reglas.md](fase0-reglas.md)).

## Abierto en la Fase 1 (plan en [fase1-reglas.md](fase1-reglas.md))

- [x] **Defecto de R1 (encontrado y corregido el 2026-11-11, paso 1a.0).**
  - *Qué pasaba:* la producción deseada se ajustaba sobre sí misma y crecía sin límite (a miles de millones de puestos). Desde el mes ~120, todas las empresas contrataban todo lo que podían pagar.
  - *Por qué afecta a R7:* el colchón es "1 mes de masa salarial deseada", así que creció con la meta y R7 dejó de pagar dividendos (semilla 1: ninguno desde el mes 137).
  - *Corrección:* la cantidad se ajusta sobre la producción efectiva del mes anterior (fuente confirmada: Dawid, Delli Gatti, Fierro & Poledna, 2024, ec. 14).
  - **Impacto:**
    1. El criterio de la Fase 0 se sigue cumpliendo (A 0,21–0,55%, B 1,87–2,83%, B > A en 20/20).
    2. El margen precio/costo pasa de ~1,19 a ~1,7.
    3. La descripción del mecanismo y el análisis del calentamiento de `fase0-reglas.md` estaban basados en corridas con el defecto; se corrigieron.
    4. Cambian los hashes: los archivos de corrida exportados antes no verifican.
    5. Con G = 0 desde la creación, el desempleo pasa de 67% a 100%.
- [x] **Calentamiento de 420 meses**, con un test por promedios de 5 años (decisión de Nico, 2026-11-11). Verificado con 500 y con 2.000 hogares.
- [x] **Colchón de R7 eliminado** (decisión de Nico, 2026-11-11). Su razón de ser era el defecto de R1.
- [ ] **Crédito al sector privado en Argentina:** es muy bajo en relación con el PBI comparado con otros países. Revisarlo en la Fase 3, al calibrar R9 y R13 (pedido de Nico, 2026-11-11).
- [ ] **El margen precio/costo** era ~1,78 después de corregir R1 (alto contra la evidencia). Con la R7 revisada, el régimen de la Fase 1 da ~1,20. Revisarlo igual en la Fase 3 (validación).
- [ ] **Magnitud del efecto de la emisión** (pedido de Nico, 2026-11-11): seguirla en cada punto de control.
  - *Trayectoria de la inflación de B (s = 0,5):* ~3,3% anual en la Fase 0 original → **2,4%** con R1 corregida → **1,6%** con las reglas de la Fase 1 (protocolo correcto).
  - *Por qué:* con las reglas de la Fase 1, ~45% de la emisión extra queda como saldos reales (la velocidad cae 1,1% por año). Hipótesis a verificar: se concentra en los dueños, por R7 anual.
  - *Error mío:* el "0,7–1,5%" y el "18/20" anteriores venían de calentar B con s = 0,5. Ver `fase1-reglas.md`.
- R8 (base de pleno empleo) **sigue siendo necesaria**: sin ella, A termina con 64–67% de desempleo.
- [x] Paso 1a.2: balance del banco y flujos del crédito (solo contabilidad).
- [ ] **Paso 1a.3:** R9 y R13 implementadas (versión corregida de Dosi, límite por capital del banco, λ = 3). **Con R9 y R13 solas, la economía colapsa**: el crédito saca el freno de liquidez, R2 sube los salarios sin parar y R1 (fiel a CATS) no traslada costos a precios. Ver `fase1-reglas.md`, "Paso 1a.3: implementación y hallazgo". Espera la decisión de Nico.
- [ ] **Candidato a perilla de teoría (Fase 3): traslado de costos a precios.** CATS: nulo. CANVAS y K+S: total (Dawid et al., 2024).
- [ ] **Punto de control 1a:** medir en A y B el crédito total, la tasa real y la proporción de empresas endeudadas (pedido de Nico).
- [x] **Paso 1a.4 (fusionado con el 1a.3):** R12 implementada. Test contra zombis: ninguna empresa activa termina un mes con 3 o más cuotas impagas.
- [ ] **El banco se funde y no hay regla de recapitalización**: el crédito se congela para siempre. Espera la decisión de Nico.
- [ ] **Espiral salarial con crédito**: R2 sube salarios sin techo cuando la demanda de trabajo supera a los hogares, y R1 no traslada costos. Medida con dos variantes experimentales: es real, pero secundaria. Ver `fase1-reglas.md`, "Decisión de Nico y mediciones del 2026-11-11".
- [x] **Condiciones iniciales calibradas** con el régimen (`PHASE1_INITIAL`): el transitorio macro desaparece, pero la ola de quiebras no.
- [x] **R6 con fidelidad al proveedor** (CATS, β = 1): la volatilidad de las ventas baja a la mitad y las quiebras pasan de ~17% a 13,5% anual (el empírico es 5–10%). El banco sigue insolvente (año 25).
- [x] **R13 revisada** (tasa según el riesgo, Assenza et al., 2015; racionamiento por umbral, Stiglitz & Weiss, 1981): banco solvente en 20/20, quiebras de 6,2% anual en régimen, la mitad de las empresas con deuda. Ver la tabla en `fase1-reglas.md`.
- [ ] **Punto de control 1a:**
  - mirar la semilla con 19% de desempleo en los últimos 10 años (R13 base);
  - verificar por qué la inflación de B sube con el crédito (de 1,60% a 2,35%);
  - tasa real ~9%: compararla con datos argentinos en la Fase 3.
- [ ] **Punto de control 1a:** verificar la hipótesis de la velocidad. Medir en A y B cómo se reparten los depósitos entre dueños (de empresas y del banco) y trabajadores, y si la acumulación en los dueños explica la caída de V en B (pedido de Nico, 2026-11-11).
- [ ] **Tramo 1c:** decidir si las perillas de gasto son **nominales, indexadas a precios o un % del PBI** (pedido de Nico, 2026-11-11). Con gasto nominal, la inflación lo licúa. Es un fenómeno real, pero tiene que ser una elección explícita; puede ser perilla de teoría o de política. Hoy es nominal (decisión de la Fase 0, R8). El error de protocolo del 2026-11-11 mostró cuánto pesa: con 35 años de emisión previa, el mismo gasto nominal es un déficit mucho menor.
- [ ] **Fase 3, calibración de β (R6):** hipótesis de **volatilidad en forma de U según la tasa de cambios de proveedor** (pedido de Nico, 2026-11-11).
  - *Con muy pocos cambios (β bajo):* la clientela queda muy despareja entre empresas (coef. var. 0,71 con β = 0,3) y no sigue a las que crecen, así que hay más volatilidad y quiebras.
  - *Sin memoria (la R6 vieja):* la clientela se rearma al azar todos los meses, también con mucha volatilidad.
  - *Mínimo:* en algún punto intermedio; con β = 1 y β = 3 la volatilidad es parecida.
  - Verificarlo antes de calibrar β.
- [ ] **β:** la dirección está verificada (más β ⇒ más cambios). Con β = 0,3 hay más volatilidad y quiebras, y la hipótesis es que los clientes quedan muy desparejos entre empresas (coef. var. 0,71 contra 0,46 con β = 3). Verificarlo antes de calibrar β (Fase 3).
- [ ] **Fase 3:** verificar el dato de cierre de empresas del OEDE (~3–3,7%) en la fuente original, no en la nota de prensa: si es anual o trimestral, y qué cubre (empresas con al menos un empleo registrado). Pedido de Nico, 2026-11-11.
- [ ] **Ola de quiebras al prender el crédito** (problema principal): 87 de 120 empresas quiebran en 5 años. Hipótesis verificada: R7 drena el patrimonio, porque reparte el 90% de los meses buenos y absorbe el 100% de los malos. Orden acordado: R7 → medir → R13 → medir → R12 si hace falta. **R7 implementada y medida**: la economía real mejora mucho (desempleo 2,2%, criterio de la Fase 0 20/20), pero el banco sigue quedando insolvente en 20/20 (castigos ~4 veces los intereses). Siguiente: proponer R13.
- [ ] **Variantes experimentales en el código** (`Phase1Experiments`: `costPassThrough`, `wageCutWithUnemployment`): apagadas por defecto, no aprobadas. Borrarlas o convertirlas en reglas cuando se decida.
- [x] Valuación del capital: **opción A aprobada** (costo histórico depreciado), con venta forzosa con descuento d y amortización dentro del piso de R1 (Nico, 2026-11-11). Ver `fase1-reglas.md`.
- [ ] **Fase 2/3: ajuste por inflación contable.** Con costo histórico e inflación alta:
  - el capital queda subvaluado y se adelantan las quiebras;
  - la amortización queda subvaluada y **la ganancia contable se infla**;
  - cuando entre Ganancias (tramo 1c), eso implica **impuesto sobre ganancias ficticias**.
  
  La opción C (reexpresión: RT 6 FACPCE, NIC 29, Ley 27.468) debe ser una **perilla**: con o sin ajuste por inflación contable (pedido de Nico, 2026-11-11).
- [ ] **Fase 2/3: recupero de la venta forzosa (R11/R12).** Ramey & Shapiro (2001) miden el recupero (28 centavos) sobre el **costo de reposición**; nosotros aplicamos r_K sobre el **valor libro** (costo histórico). Con inflación alta, el valor libro queda por debajo del de reposición y el recupero queda subestimado. Revisarlo junto con la opción C (pedido de Nico, 2026-11-11).
- [x] **Paso 1a.5: R11 implementada y medida** (2026-11-11): capital, depreciación según el uso, 20 empresas de capital, venta forzosa. Criterio de la Fase 0 20/20, banco solvente, empleo del sector de capital 8,1%. Ver "Medición de R11" en `fase1-reglas.md`.
- [ ] **Después de R11, las quiebras casi desaparecen** (0,1% anual contra 5–10% empírico). Hipótesis no verificadas: el colchón del valor libro de la planta y/o el tope de capacidad, que protege a las empresas. Medir de nuevo con R10. Si sigue, revisar R12 con Nico (la ley argentina dispara la quiebra por cesación de pagos, no por patrimonio negativo).
- [ ] **Después de R11, el desempleo sube a 7,3%** (hasta 18% en algunas semillas). Hipótesis: falta capital (61% de las empresas al tope de capacidad, sin inversión neta), y R1 no sube el precio al tope de capacidad. Medir de nuevo con R10.
- [ ] **Magnitud del efecto de la emisión:** con R11, la inflación de B baja de 2,35% a 1,34% (B > A en 20/20).
- [ ] **Punto de control 1a:** verificar que el calentamiento de 420 meses sigue alcanzando con R11 y R10. El test lento actual mide las reglas de la Fase 0.
- [ ] **Candidato a perilla de teoría (Fase 3): inflación por restricción de capacidad.** En CATS (Assenza et al., 2015, ec. 5.1–5.2, verificado), una empresa al tope de su capacidad con exceso de demanda y precio ≥ promedio no sube el precio: el exceso de demanda queda como ahorro forzoso. Medido con una variante experimental (2026-11-11): explica menos del 10% del achicamiento del efecto de la emisión, y sube mucho el desempleo.
- [x] **R13 con racionamiento por pérdida esperada** (2026-11-11): las empresas paradas bajan de 13 a 5 y el desempleo de A de 7,3% a 5,2%; criterio de la Fase 0 20/20; banco solvente. La trampa persiste por el estado absorbente de R9. Propuesta de R9 con ventas esperadas escrita, espera el OK.
- [x] **R9 con ventas esperadas** (2026-11-11): empresas paradas 5 → 1, desempleo de A 2,9%, criterio de la Fase 0 20/20. Queda la trampa de las empresas nuevas (5 de 199 en 20 semillas). Propuesta de Sᵉ inicial escrita, espera el OK.
- [ ] **Zombis con R9 suave:** ~5 de 100 empresas con deuda 24 meses seguidos, ventas en baja y sin quebrar. Las quiebras bajan a 0,1% anual (empírico 5–10%). Seguirlo en el punto de control 1a.
- [ ] **Punto de control 1a: el patrimonio del banco se duplica en 50 años** (×2,2–2,3, castigos ≈ 0). Revisar si su margen es razonable (pedido de Nico, 2026-11-11). Comparar el margen financiero y el ROE con datos del BCRA en la Fase 3.
- [ ] **Empresas nuevas sin clientes:** con la fidelidad de R6 (β = 1) y el precio promedio, la que entra no vende el primer mes. En K+S las que entran son más chicas que las que ya están. Revisar en la calibración (Fase 3).
- [ ] **Trampa sin caja (problema principal antes de R10):** entre 7 y 20 de las 100 empresas de consumo quedan activas sin producir durante 50 años. La cadena es R7 → racionamiento por φ → ventas 0 → límite de R9 en 0, y no quiebran. Opciones: (a) salida por cuota de mercado ~0, como en K+S; (b) racionar por φ·LGD; (c) límite de R9 con ventas esperadas; (d) depósitos precautorios de Caiani. Espera la decisión de Nico. Ver `fase1-reglas.md`.
- [ ] **El tope de capacidad hoy frena la espiral salarial:** sin él (variante experimental), la espiral del paso 1a.3 vuelve y la economía colapsa. Con R10, la capacidad crece: revisar si la espiral reaparece.
- [ ] **Ahorro forzoso con R11:** 17% del gasto deseado en A y 33% en B. Medirlo de nuevo con R10.
- [ ] **Venta forzosa pagada entre todos = impuesto implícito a los depositantes** (no pasa por el Tesoro). Se cuenta en `credit.fireSalesPooled`. Revisar si se vuelve frecuente.
- [ ] **Variantes experimentales nuevas** (`priceUpAtCapacity`, `noCapacityLimit`): apagadas, solo para medir. Borrarlas o convertirlas cuando se decida.
- [x] **Sᵉ inicial = plan × precio** (2026-11-11): la trampa sin caja queda resuelta (0 empresas paradas); criterio de la Fase 0 20/20.
- [ ] **R10 implementada, pero la economía colapsa** (desempleo 84%, criterio de la Fase 0 0/20). Causa: la regla de cantidad de las empresas de capital en R11 se apartó de Assenza (ec. 6.2): paso al azar sobre ventas censuradas, en vez de ρ·(demanda insatisfecha). Propuesta de corrección escrita, espera el OK. **Hasta corregirla, el estado del código no cumple el criterio de la Fase 0.**
- [ ] **Diferencia entre versiones de CATS:** la R1 de las empresas de consumo (Gaffeo et al., 2008) usa un paso de cantidad al azar; Assenza et al. (2015) usa ρ·(−Δ). Revisar en el punto de control 1a o en la Fase 3.
- [ ] **Regla de cantidad de las empresas de capital** (Assenza ec. 6.2) implementada con un interruptor: con 1 (Assenza) la economía se desestabiliza incluso sin R10 (desempleo 54%, criterio de la Fase 0 0/20). Por defecto está en 0 (la regla original, que se aparta de la fuente). Espera la decisión de Nico. El doble conteo es despreciable (0,99).
- [x] **R10 apagada por defecto** (`CAPITAL.netInvestment = 0`), decisión de Nico.
- [ ] **Métrica de zombis:** con préstamos de inversión a 60 meses (activos aunque R10 esté apagada) deja de servir. Redefinirla para el punto de control 1a.
- [ ] **Revisión de reglas contra fuentes (2026-11-11), diferencias para decidir:** R2 sin ecuación verificada (prioridad); dividendos del banco 0,9 contra 0,6 de Caiani; paso de precio de R1 0,05 contra 0,1 de Assenza; el piso de R1 sin costo financiero; R5 es SIMEX (corregir la documentación); R10 techo contra piso con arrastre. Ver "Revisión de las reglas contra sus fuentes" en `fase1-reglas.md`.
- [ ] **Proceso (pedido de Nico, 2026-11-11):** cada regla nueva lleva su ecuación de la fuente al lado de la implementación, término por término, y un test calculado a mano en `test/rules-by-hand.test.ts`.
- [ ] Tramo 1b: al repartir empresas por sector, reportar cuántas quedan en cada uno y si alguno queda con muy pocas (pedido de Nico).
- [ ] La app sigue con `PHASE0_CONFIG` (500 hogares). Pasa a `PHASE1_CONFIG` en el paso 1c.6, escalando el gasto y las perillas.
- [x] **Paso 1a.1 (escala):** tamaño de la Fase 1 = 2.000 hogares y 120 empresas (`PHASE1_CONFIG`, decisión de Nico).
  - *Hallazgo:* el ruido mes a mes cae como 1/√N, pero las oscilaciones lentas (el nivel de desempleo, la inflación de 5 años) no bajan con el tamaño: son ciclos agregados.
  - *Pendiente:* definir con datos qué volatilidad es "plausible" (Fase 3).
- El contrafáctico G = 0 ya se volvió a correr (paso 1a.0). Después de corregir R1: 100% de desempleo desde la creación y 6–12% si se pasa a G = 0 después del calentamiento.

## Obligatorios de la Fase 1 (criterio de salida en `CLAUDE.md`)

- **Con G = 0 la economía privada se sostiene sola**, sin colapso de empleo. Hoy el gasto público es la única demanda autónoma (propiedad del SIM). Con G = 0 desde la creación, el desempleo llega a 100% (después de corregir R1). Requiere inversión y crédito.
- **Volatilidad**: verificar que con más agentes la volatilidad mensual del desempleo y la inflación baja a niveles plausibles (ver "Limitaciones conocidas" en [fase0-reglas.md](fase0-reglas.md)). Medido en el paso 1a.1: el ruido mes a mes sí baja; las oscilaciones lentas no.
- Lo que ya estaba en el roadmap: sectores (agro, industria, servicios, comercio), formalidad e informalidad, estratos con necesidades y nivel de vida, todas las perillas fiscales y de regulación, indicadores sociales con metodología INDEC.

## Diferido explícitamente a la Fase 1

- **Crédito bancario, quiebras y entrada de empresas** (decisión de la Fase 0). Hoy el banco es pasivo: no presta ni cobra interés.
- **Revisar R7 (colchón de liquidez antes de los dividendos)** cuando entre el crédito. Es provisorio y no tiene fuente: existe porque, sin crédito, las empresas se quedaban sin capital de trabajo.

## Supuestos simplificadores de la Fase 0 que la Fase 1 probablemente toque

Están documentados en [fase0-reglas.md](fase0-reglas.md). Cambiarlos es una decisión de diseño: proponer con fuente y esperar el OK.

- Un solo bien, perecedero. Producción solo con trabajo (sin capital).
- No se usa efectivo (`cash` existe en el ledger pero no circula).
- Un salario por empresa. Los ocupados no buscan otro trabajo. No hay salario de reserva.
- Consumo nominal (forma de SIM). La versión real con expectativas de precios (Caiani et al., 2016) quedó para cuando haya expectativas.
- Un dueño por empresa, elegido al azar.
- El gasto público es solo transferencias universales; el impuesto es uno solo, proporcional sobre salarios y dividendos.
- El gasto es nominal y no se indexa.
- **Pobreza**: canasta provisional (6 unidades del bien, sin adulto equivalente). La Fase 1 pide metodología INDEC (CBA/CBT).
- Margen precio/costo de equilibrio ~1,78 (ver arriba): alto contra la evidencia, revisar en la Fase 3.
- Parámetros sin calibrar: α1 = 0,9 y α2 = 0,05 (consumo), topes de ajuste de precio, cantidad y salario (5%), tamaños de búsqueda (3 y 4), canasta.

## Más adelante (no Fase 1)

- **Indexación e inercia salarial como perilla de teoría** (anotado en R2). Encaja con las perillas de teoría de la Fase 3.
- **Déficit cíclico financiado con bonos** en vez de emisión automática, cuando haya deuda (Fase 2). Hoy, incluso con s = 0, hay algo de emisión en las recesiones.

## Opcionales

- **Calibrar las condiciones iniciales** (margen ~1,2, más depósitos) para acortar el calentamiento de 240 meses. Nico decidió no hacerlo por ahora.

## A tener en cuenta al cambiar reglas

- **Los tests del criterio de la Fase 0 van a moverse.** `test/phase0-criteria.test.ts` fija umbrales (A < 1% anual, B > A en 20 semillas, calentamiento sin tendencia) medidos con las reglas de la Fase 0 y `PHASE0_CONFIG`. Si una regla nueva los rompe, no reajustar los umbrales en silencio: mostrar el reporte y consultar.
- **Cambiar `SimState` cambia el hash** y obliga a subir la versión del archivo de corrida (ver [arquitectura.md](arquitectura.md)).
- **El contrafáctico G = 0** de la sección de resultados se corrió antes del calentamiento. Si se cita en la Fase 1, conviene volver a correrlo.
