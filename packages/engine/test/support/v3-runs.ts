/**
 * Corridas de referencia del V3 (semilla 12345 salvo las indicadas): volcados al principio del tick y después de los eventos
 * 0–37 (y 74, 75), el registro de sorteos y de decisiones del oráculo, y los CSV de los reportes del .jar (`data/`). Las usan
 * caiani-v3.test.ts y caiani-reports-v3.test.ts. Movidas acá desde caiani-v3.test.ts el 2026-11-17 (sin cambios).
 */
/** Corridas de referencia: volcados al principio del tick y después de los eventos 0–37 (semilla 12345 salvo la 293). */
export const ALL_RUNS: { run: string; tick: number; only?: readonly number[] }[] = [
  { run: 'p3-t1', tick: 1 },
  { run: 'p3-t50', tick: 50 },
  // Una quiebra por deuda en el evento 20 (empresa 8168) y cuatro por salarios en el 21.
  { run: 'p3-t81', tick: 81 },
  // Quiebras con dos depósitos: 8164 y 8182 en el evento 20; 8159 en el 21 (aporte de los dueños = toda la pérdida).
  // Ejercita el techo sobre el neto (evento 19: depósito que cobra y paga todo) y el aporte negativo (evento 20:
  // la pérdida total de 8164 cruza 0 en el último hogar). reglas-caiani.md, sec. 18 y 19.
  { run: 'p3-t108', tick: 108 },
  // Semilla 102: el único adelanto del BC con saldo en el tick 292 (banco 8256, 994,90) se paga en el evento 23.
  // Evento 10: la empresa 8204 pide 6,6·10⁻¹⁴ de crédito (residuo de JMAB); en µ es 0 y el port la desactiva: decisión
  // frágil dada vuelta, informada y no falla; el encadenado se corta ahí (reglas-caiani.md, sec. 22).
  { run: 'p3-s102-t293', tick: 293 },
  // Primer episodio del depósito de una quiebra que la empresa sigue usando: 8164 quiebra con dos depósitos en el
  // evento 21 y en el 27 elige el banco del segundo, que quedó fuera de la lista del banco (reglas-caiani.md, sec. 19).
  { run: 'p3-t128', tick: 128 },
  // Quiebra de un banco (evento 28): 8259, con préstamos (reglas-caiani.md, sec. 27).
  { run: 'p3-t133', tick: 133 },
  // Semilla 102, en la racha de 8258 (ticks 297–314): quiebra todos los trimestres sin préstamos y el rescate la deja en
  // patrimonio 0 (reglas-caiani.md, sec. 27).
  { run: 'p3-s102-t300', tick: 300 },
  // Quiebra de un banco con el encadenado completo hasta el evento 28 (candidatas, 2026-11-14): 8255 en el 146 y 8253
  // en el 161 (semilla 12345).
  { run: 'p3-t146', tick: 146 },
  { run: 'p3-t161', tick: 161 },
  // Semilla 102, tick 292: el único tick conocido con un pedido de adelantos de Basilea positivo (banco 8256, 994,90,
  // evento 36) y el mercado del evento 37 abierto (reglas-caiani.md, sec. 29 y 35). Volcados 0–37, 74 y 75 y el
  // principio del tick 293 (para la V3 que cruza ticks). El encadenado se corta en el evento 10 (8204 pide un crédito
  // residual, como en los ticks 293 y 300): el 36 y el 37 con el mercado abierto quedan verificados solo en el suelto.
  { run: 'p3-s102-t292', tick: 292 },
  // Semilla 104, tick 103 (2026-11-16): hogares con cantidad entera 0 en el evento 75 (uno con bienes truncados a 0 y tres
  // sin bienes; vigilancia `p3-hh0-s*`, reglas-caiani.md, sec. 39).
  // En el evento 19 hay una decisión frágil dada vuelta respecto de JMAB (8202: "depósito < monto" a distancia 0, como en
  // el tick 133) que arrastraba a otros agentes del mismo evento; hasta d1 corría solo los bloques del 75. Con d1 (el
  // registro de decisiones del oráculo) se toma la rama de JMAB y el tick corre entero (paso 6, 2026-11-17).
  { run: 'p3-s104-t103', tick: 103 },
];
