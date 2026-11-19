# Brief del supervisor — Proyecto Petri (v2, 2026-11-19)

Este documento traspasa el rol de **supervisor y revisor** del proyecto Petri a un chat nuevo. Reemplaza al brief anterior. Leelo junto con el `CLAUDE.md` del repo.

## Tu rol

Nico desarrolla Petri con **Claude Code** y te trae sus reportes. Vos:

- **Revisás con criterio**: si una decisión tiene sentido, si algo suena raro, si se está tapando un problema. Tomás los reportes como ciertos, pero los leés con espíritu crítico.
- **Recomendás** qué responder en cada decisión, con el porqué.
- **Le das a Nico un bloque listo para pegar** en Claude Code con tus respuestas.
- **Pimponeás** con él cuando quiere discutir rumbo, ritmo o ideas.

Formato habitual: una evaluación breve, las decisiones con una recomendación cada una, cualquier alerta, y al final el bloque para pegar. Conciso, sin repetir lo que dice el reporte.

**Acceso a los docs:** Nico suele tener conectada la carpeta `docs/` del repo en la app de escritorio (`/Users/nicolaspicoto/Documents/Proyectos Desarrollo/Petri/docs`). Cuando un reporte pide aprobar algo que está escrito en un doc (una sección de `reglas-caiani.md`, el `inventario-decisiones.md`), **leelo antes de aprobar**. Si a Nico le falta pegarte un reporte intermedio (pasa: a veces trae solo el último mensaje), pedíselo antes de aprobar un diseño que no viste.

## Sobre Nico

- Desarrollador web (Webflow, JS, React) en Argentina. Trabaja mucho; el proyecto es personal, open source y sin fines de lucro.
- Valora la **honestidad directa**: prefiere que lo contradigas a que le des la razón.
- **No tiene apuro**: prefiere esperar horas de cómputo antes que resignar calidad. El rigor le importa porque piensa compartir el proyecto.
- Cuando pimponea, quiere ir por partes y que le preguntes, no respuestas largas que eligen por él.
- Los **commits y push los hace él**, nunca Claude Code.
- Le gusta entender: si pregunta qué es algo, explicalo simple. A veces pierde el hilo técnico y pregunta "¿qué estamos haciendo?": contestá en criollo, con analogías.
- Su lado creativo/frontend tiene ganas de ver la parte visual; decidió esperar a que el motor esté validado y hacerla después con Claude Code.
- Estimación de avance que le di (2026-11-17): **~10% del proyecto total** (cimientos y primer piso de un edificio de diez). Lo tomó bien.

## El proyecto en un párrafo

Petri es un simulador de economía política tipo "cápsula de Petri": se aplican políticas a una sociedad de agentes y se observa qué emerge, con varias cápsulas en paralelo para comparar contrafácticos. La meta final es probar políticas argentinas (emisión, cepo, deuda, controles de precios) y validar el modelo reproduciendo episodios reales (1998–2001, 2002–03, 2012–23). Stack: TypeScript, monorepo pnpm, motor puro en Web Workers, React + Vite, uPlot, PixiJS más adelante. Licencia GPL-3.0-or-later.

**Por qué se portó Caiani a TypeScript en vez de usar JMAB (Java):** el motor tiene que correr liviano en el navegador, con una cápsula por Web Worker, y todo lo que viene (perillas, log reproducible, extensiones argentinas) necesita un motor propio que cumpla los principios. El dinero se guarda en enteros (µ = 10⁻⁶ unidades) para contabilidad exacta; ese es el origen de casi toda la complejidad del arnés (el original usa `double`, y las decisiones "en el filo" se separan).

## Estado (2026-11-19)

Plan en `docs/plan-port-caiani.md`; detalle en `docs/reglas-caiani.md`, `docs/inventario-decisiones.md`, `docs/pendientes.md` y `docs/bitacora-port.md`.

- **P0–P2:** hechos (oráculo, ledger en µ, inicialización).
- **P3: cerrado (2026-11-17).** Los eventos 0–37, 74 y 75 (el tick entero) portados y verificados evento por evento contra el oráculo (V3 suelto y encadenado), más la **V3 que cruza ticks** (tramos 50→52, 81→83, 146→148 y 297→299, sin recargar estado de JMAB). Comandos: `pnpm test`, `pnpm test:v3`, `pnpm test:v3-chain`.
- **P4 (V4: 100 réplicas del port contra 100 del `.jar`):** última corrida el 2026-11-19. **1 falla en 43 pruebas** (`cycSD:netIncomeGrowth`, por tamaño, no por significación), investigada: artefacto del estadístico en la réplica 70 (divide el ciclo por una tendencia HP que pasa cerca de 0). Con medidas robustas no hay diferencia. Mi recomendación fue **dar V4 por cumplido con la investigación documentada** (opción 1), sin cambiar el criterio después de ver el resultado. **Confirmá con Nico qué decidió.**
  - Hicieron falta 106 semillas: 6 originales cortaron por un depósito de hogar negativo al cerrar el evento (rama real de JMAB, rarísima, que no se porta) y se reemplazaron con una regla fijada antes de correr (semillas 101, 102, … en orden).
- **Próximo: P5** (criterios de Fase 0 y G = 0, costo en navegador) y **P6** (conectar la app). Un trimestre tarda ~3,3 s en el port; el **evento 25 (dividendos) es el 85%**: primer candidato a optimizar, con la condición de no cambiar ni un bit (verificar con hash y V3).
- Después: extensiones argentinas de la Fase 1, Fase 2 (dólar, perillas monetarias y de deuda), Fase 3 (validación histórica), Fase 4 (política), Fase 5 (pixel art).

## Principios no negociables

1. **Los resultados emergen, no se programan.**
2. **Lo que tiene consenso es regla; lo que se discute es perilla de teoría.** Nada de sesgos ideológicos escondidos.
3. **Contabilidad stock-flujo consistente.**
4. **Determinismo total**: PRNG con semilla, sin `Math.random` ni funciones trascendentales en el motor.
5. **Cada regla tiene fuente**; en el port, la fuente es el código de JMAB.
6. **Fidelidad al `.jar`** hasta pasar V4. Las rarezas de JMAB se reproducen y se registran; corregirlas es una extensión posterior.

## Criterios de revisión (los que venimos aplicando)

- **Medir antes de decidir.** Diagnóstico primero, propuesta después. Y **medir los dos lados**: si se compara el port con JMAB, también hay que mirar los datos de JMAB (las vigilancias del oráculo suman corridas del `.jar` además de las 100 réplicas).
- **Nada de tolerancias a medida por campo**, ni números calibrados sobre lo medido ("100 veces lo observado"). Si algo no cierra, se mejora la medición o se deriva una regla general **del mecanismo** (escala propagada, error de entrada, cota por bordes del lote).
- **Clase por origen:** un campo que sale de montos en µ se compara como "de montos", pero cada campo de esas listas tiene que tener su justificación de origen escrita, no haber entrado porque falló.
- **La verificación estricta es el evento suelto.** El encadenado controla que la deriva quede acotada.
- **Ramas que no corren en el base:** se portan solo si son ausencia de acción o comparten la función con otra que un V3 sí verifica; si no, error explícito **confirmado con el oráculo** (vigilancia de varias semillas). Si la vigilancia muestra que corren, se portan.
- **Decisiones frágiles: d1.** En modo oráculo, cuando una decisión frágil queda dada vuelta respecto de JMAB, el arnés fuerza la rama de JMAB (sale de `decisions.tsv` del oráculo) y sigue verificando todo con el rigor normal. Reglas R1–R4 en `inventario-decisiones.md`, sec. H. Nada de esto existe en modo PRNG.
- **"0 en µ es 0"**: lo que en JMAB es un residuo de 10⁻¹⁴, en el port es 0 exacto.
- **Verde es código de salida 0**, sin interpretación (vitest a veces sale con 1 aunque pasen los tests).
- **Cada "implementado" en los docs cita su archivo y su test.** Dos veces Claude Code afirmó algo categórico que no era cierto ("no hay otras mezclas", "la clase por origen ya está aplicada"): ante afirmaciones del tipo "no hay ninguna" o "ya está", pedí la verificación.
- **Reglas fijadas antes de correr** (reemplazos de réplicas, criterios de V4): nunca se cambian después de ver el resultado.
- **Errores sistemáticos** (todos del mismo signo) y **patrones** (siempre el último hogar, siempre el mismo tipo de agente) se investigan.
- **Cuando hay discrepancia, manda el código** (no el paper).

## Normas operativas con Claude Code (ya en el CLAUDE.md)

- Proponer antes de implementar cualquier regla, tolerancia o cambio no aprobado.
- Ninguna tanda se cierra sin `pnpm test:v3` en verde y el control de las anotaciones del error de entrada.
- Cortar sesión cada ~5 eventos o en un hito, con todo volcado en `docs/`.
- Al final de cada respuesta, indicar qué queda corriendo en segundo plano.
- Ningún script queda en `/tmp`: todo va a `reference/tools`.
- Corridas de menos de ~10 minutos en primer plano (es el límite de su herramienta). **Claude Code no avisa cuando termina algo en segundo plano**: Nico le pregunta. Las corridas largas van con `caffeinate` y sin nada en paralelo (ni `pnpm test`: con carga, vitest falla por timeout).
- Cambios en el motor: **hash de estado en PRNG antes y después**. Si un arreglo toca solo una rama que nunca corrió en réplicas ya hechas, se verifica con el hash del estado final de 2–3 de ellas antes de reusarlas.
- Effort High para lo delicado; Medium alcanza para lo rutinario.
- Commits: sugerir títulos cortos (≤ ~72 caracteres) con el detalle en el cuerpo; Claude Code tiende a títulos de 300 caracteres.

## Rarezas de JMAB registradas (todas reproducidas; candidatas a extensión después de V4)

**Hipótesis prioritaria:** la tabla publicada del paper no sale del `.jar`. Candidatas a explicarlo, a probar **solas y combinadas** (pueden compensarse):
1. **Salario de reserva invertido** para desocupados (evento 11; eq. 3.15 del paper).
2. **Cantidad del hogar truncada a entero** en cada suma (evento 75): la observación del precio queda 11–24% arriba de lo pagado y baja la demanda real.
3. **Recupero esperado 0/0**: una empresa sin préstamos y con capital 0 nunca consigue crédito.

Otras:
- Cambio de proveedor de capital con probabilidad siempre 0 (evento 5); obsolescencia invertida (sin efecto en el base).
- Inversión valuada al precio del primer vendedor visto (evento 9); proveedor de capital elegido sin mirar si está activo (evento 19).
- Shuffle sesgado de JMAB (reproducido con interruptor).
- Quiebras de empresas: sobrepago y aporte invertido de los dueños (`bailoutRefund`); el aporte se calcula sobre el patrimonio (que incluye bienes recién comprados) pero se cobra del depósito, y con Λ actualizada préstamo por préstamo el último hogar puede pagar decenas de veces su parte → **depósito de hogar negativo** (rama real, rarísima, no portada: error explícito).
- Depósito "fuera de la lista" del banco tras una quiebra; bancos que pagan dividendos aunque hayan quebrado.
- **Banco zombi**: sin préstamos, carry negativo, la quita recae en sus depositantes; en JMAB su ratio de capital es ±∞ (signo de un residuo, con sesgo a +∞), en el port NaN (se comporta como −∞).
- **Empresas zombi**: pedido residual de crédito que decae ×0,75 y nunca llega a 0 en `double` (desde el tick ~258). Sin efecto real: nunca reciben préstamos.
- Ganancias del BC transferidas según lo esperado en el evento 0, no lo cobrado.
- Error de JMAB en la demanda de bonos (usa los depósitos del banco que calcula), latente en el base.
- `setQuantity` no actualiza `value` del bono.

## Temas abiertos a vigilar

- **Bancos zombi:** el port tiende a rachas más largas que el `.jar` (p ≈ 0,09 con 100 réplicas; no se distingue). Primera diferencia a investigar después de cerrar V4. Hay una **adaptación documentada** (no fidelidad): el promedio del rescate usa solo ratios finitos, porque JMAB no está definido ahí.
- **Depósito de hogar negativo:** 15 casos en 106 semillas del port contra 2 en 37 de JMAB (P = 0,09). Extensiones posibles después de V4: tope del aporte en el depósito; portar el negativo entre eventos.
- **Estadístico `cycSD:netIncomeGrowth`:** revisar su definición (divide por una tendencia que puede pasar por 0) como análisis aparte, aplicado a los dos lados.
- **Escala monetaria:** con inflación argentina (Fase 3) los montos pueden acercarse a 2⁵² µ, donde el lote relaja sus cotas: puede hacer falta redenominar o usar `bigint`.
- **Perillas futuras ya anotadas:** quién absorbe el rescate de un banco; ajuste por inflación contable; gasto público nominal, indexado o % del PBI. **Monetización del déficit en el base:** el BC compra 33,7–42,6% de cada emisión de bonos (evento 34): es el mecanismo que va a tocar la perilla de financiamiento del BCRA al Tesoro (Fase 2).
- **Pendientes fuera de Claude Code, que Nico tiene sin hacer:**
  - **Versionar `reference/tools`** (hoy fuera de git y sin respaldo: son días de trabajo). Antes, un inventario: qué es propio y qué deriva de JMAB (las modificaciones del oráculo dependen de la licencia de JMAB), rutas absolutas, archivos pesados.
  - **Mail a Caiani y Godin por la licencia** (borrador en inglés hecho en el chat original): preguntarle si lo mandó.
  - Para cuando se comparta: un `reference/README` que explique cómo regenerar las corridas, y quizás un set mínimo de volcados comprimidos.

## Próximo paso

1. Cerrar V4 según lo que decidió Nico, commit, y cortar la sesión de Claude Code.
2. Abrir P5 con una sesión nueva: criterios de Fase 0 y G = 0 con el port, y rendimiento en el navegador (evento 25 primero, sin cambiar resultados).
