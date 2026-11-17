/*
 * Petri — Copyright (C) 2026 Nicolas Picotto
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Arnés del V3 con el registro de decisiones del oráculo (opción (d) con d1, paso 4; docs/inventario-decisiones.md y
 * reglas-caiani.md, sec. 40):
 * - `readOracleDecisions`: lee `decisions.tsv(.gz)` de una corrida del oráculo (`oracle.Decisions`) y lo agrupa por evento;
 * - `nanFields`: control de NaN en el estado del port después de cada evento (R4; lista de NaN documentados en
 *   reglas-caiani.md, sec. 1);
 * - `formatForced`: informe de las decisiones forzadas de un evento (frágiles, R2), con la distancia corregida por el error
 *   de entrada y la cruda.
 */
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { contractIds, contractOf, type CaianiState, type ForcedDecision, type OracleDecision } from '../../src/caiani';

function loansOf(s: CaianiState, id: number): number {
  let t = 0;
  for (const c of contractIds(s.ledger, id, 'assets', 'loan')) t += contractOf(s.ledger, c).amount;
  return t;
}

/** Archivo del registro de decisiones de una corrida (`.tsv` o `.tsv.gz`), o `undefined` si la corrida no lo tiene. */
export function decisionsFile(runDir: string): string | undefined {
  const base = `${runDir}/decisions.tsv`;
  if (existsSync(base)) return base;
  if (existsSync(base + '.gz')) return base + '.gz';
  return undefined;
}

/**
 * Decisiones de JMAB de un tick, por evento: seq, tick, evento, lugar, agente, resultado, a, b (`oracle.Decisions`).
 * Los operandos de JMAB vienen en sus unidades; `decide` pasa a µ los de clase `amount`.
 */
export function readOracleDecisions(file: string, tick: number): Map<number, OracleDecision[]> {
  const text = file.endsWith('.gz') ? gunzipSync(readFileSync(file)).toString('utf8') : readFileSync(file, 'utf8');
  const out = new Map<number, OracleDecision[]>();
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
    if (!line) continue;
    const f = line.split('\t');
    if (Number(f[1]) !== tick) continue;
    const ev = Number(f[2]);
    let list = out.get(ev);
    if (!list) out.set(ev, (list = []));
    list.push({ site: f[3]!, agent: Number(f[4]), outcome: Number(f[5]), a: Number(f[6]), b: Number(f[7]) });
  }
  return out;
}

/** Campos con NaN de un objeto (rutas sin índices), recorrido acotado. */
function walk(x: unknown, path: string, out: Set<string>, depth: number): void {
  if (depth > 6 || x === null || x === undefined) return;
  if (typeof x === 'number') {
    if (Number.isNaN(x)) out.add(path);
    return;
  }
  if (typeof x !== 'object') return;
  if (Array.isArray(x)) {
    for (const v of x) walk(v, path + '[]', out, depth + 1);
    return;
  }
  if (x instanceof Map) {
    for (const [k, v] of x) walk(v, `${path}.${String(k)}`, out, depth + 1);
    return;
  }
  for (const k in x as Record<string, unknown>) walk((x as Record<string, unknown>)[k], path ? `${path}.${k}` : k, out, depth + 1);
}

/**
 * R4 (aprobado por Nico, 2026-11-16): NaN en el estado del port que no están en la lista de documentados
 * (reglas-caiani.md, sec. 1). Devuelve "tipo id: campo". Documentado: el ratio de capital de un banco con préstamos en
 * 0 µ (cociente indeterminado). `toJ` traduce los ids para el mensaje.
 */
export function nanFields(s: CaianiState, toJ: (id: number) => number): string[] {
  const out: string[] = [];
  const groups: [string, readonly { id: number }[]][] = [
    ['hogar', s.households],
    ['consumo', s.consumptionFirms],
    ['capital', s.capitalFirms],
    ['banco', s.banks],
    ['gobierno', [s.government]],
    ['BC', [s.centralBank]],
  ];
  for (const [kind, list] of groups) {
    for (const a of list) {
      const paths = new Set<string>();
      walk(a, '', paths, 0);
      for (const p of paths) {
        if (kind === 'banco' && p === 'capitalRatio' && loansOf(s, a.id) === 0) continue;
        out.push(`${kind} ${toJ(a.id)}: ${p}`);
      }
    }
  }
  return out;
}

/** Una línea por forzada: lugar, agente, tipo, resultados, distancias corregida y cruda (µ en montos), y la alarma. */
export function formatForced(list: readonly ForcedDecision[], toJ: (id: number) => number): string[] {
  return list.map((f) => {
    const corr = f.distancePort.toPrecision(3);
    const raw = f.distancePortRaw === f.distancePort ? '' : ` (cruda ${f.distancePortRaw.toPrecision(3)})`;
    const agent = f.agent === undefined ? '' : `, agente ${toJ(f.agent)}`;
    return `${f.kind}${f.alarm ? ' [ALARMA]' : ''}: "${f.site}" #${f.index}${agent}: port ${f.port} → JMAB ${f.jmab}; distancia del port ${corr}${raw}, de JMAB ${f.distanceJmab.toPrecision(3)}`;
  });
}
