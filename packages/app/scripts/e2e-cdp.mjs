/**
 * Prueba de punta a punta de la interfaz, en Chrome headless, vía el protocolo DevTools.
 * Sin dependencias: solo Node ≥ 22 (WebSocket y fetch globales) y Chrome instalado.
 *
 * Qué hace:
 *   1. Abre la app, pone velocidad 24 y Play.
 *   2. Mueve la perilla "déficit estructural financiado con emisión" de B a 50%.
 *   3. Sube la velocidad a 120, espera, y exporta la corrida.
 *   4. Reset, importa el archivo exportado y lee el cartel de verificación.
 *   5. (Opcional) Importa otro archivo y muestra el diálogo que aparezca (ej.: un v1 rechazado).
 *
 * Uso (con `pnpm dev` corriendo en otra terminal):
 *   node packages/app/scripts/e2e-cdp.mjs [--url http://localhost:5173] [--chrome <ruta>] [--extra-import <archivo.json>]
 *
 * Sale con código 1 si la reproducción no queda verificada o hubo errores en la consola.
 * Las capturas y el archivo exportado quedan en una carpeta temporal (se imprime la ruta).
 *
 * Nota: no usar `--virtual-time-budget`; la app pide cuadros sin parar y Chrome nunca termina.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []),
);
const URL_APP = args.url ?? 'http://localhost:5173';
const CHROME = args.chrome ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const out = mkdtempSync(join(tmpdir(), 'petri-e2e-'));
const downloads = join(out, 'downloads');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(out, 'profile')}`, '--no-first-run', 'about:blank'],
  { stdio: 'ignore' },
);

let ws;
const problems = [];
try {
  let targets = [];
  for (let i = 0; i < 50 && targets.length === 0; i++) {
    await sleep(200);
    targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json(), () => []);
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('No se pudo conectar con Chrome');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let nextId = 0;
  const pending = new Map();
  const dialogs = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method === 'Page.javascriptDialogOpening') {
      dialogs.push(m.params.message);
      ws.send(JSON.stringify({ id: 1e9, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      problems.push(`excepción: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      problems.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    }
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const id = ++nextId;
      pending.set(id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  };
  const text = () => evaluate('document.body.innerText');
  const month = async () => (await text()).match(/Mes \d+[^\n]*/)?.[0];
  const click = (label) =>
    evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(${JSON.stringify(label)}));
      if (!b) throw new Error('No encontré el botón ' + ${JSON.stringify(label)});
      b.click();
      return true;
    })()`);
  const screenshot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  };
  const importFile = async (path) => {
    const doc = await send('DOM.getDocument');
    const input = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' });
    await send('DOM.setFileInputFiles', { nodeId: input.result.nodeId, files: [path] });
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await send('Emulation.setDeviceMetricsOverride', { width: 1300, height: 1900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_APP });
  await sleep(3000); // incluye el calentamiento de las dos cápsulas

  console.log('inicio:', await month(), '· desempleo A:', (await text()).match(/Desempleo\n([^\n]*)/)?.[1]);
  await click('24');
  await click('Play');
  await sleep(2000);
  await evaluate(`(() => {
    const r = document.querySelectorAll('.capsule-b input[type=range]')[1];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(r, '0.5');
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    return true;
  })()`);
  await sleep(1000);
  await click('120');
  await sleep(5000);
  console.log('corriendo:', await month());
  await screenshot('corriendo');

  await click('Exportar');
  await sleep(1500);
  const exported = readdirSync(downloads).find((f) => f.endsWith('.json'));
  if (!exported) throw new Error('No se descargó el archivo de corrida');
  const exportedPath = join(downloads, exported);
  const run = JSON.parse(readFileSync(exportedPath, 'utf8'));
  const before = await month();
  console.log('exportado:', exported, '· ticks', run.capsules.map((c) => c.ticks), '· hashes', run.capsules.map((c) => c.finalStateHash));
  console.log('log de B:', JSON.stringify(run.capsules[1].log));

  await click('Reset');
  await sleep(1500);
  console.log('tras reset:', await month());
  await importFile(exportedPath);
  await sleep(5000);
  const banner = (await text()).match(/Reproducción[^\n]*/)?.[0];
  console.log('tras importar:', await month(), `(antes de exportar: ${before})`);
  console.log('cartel:', banner ?? '—');
  await screenshot('importado');
  if (!banner?.includes('verificada')) problems.push('la reproducción no quedó verificada');

  if (args['extra-import']) {
    await importFile(args['extra-import']);
    await sleep(2000);
    console.log('import extra, diálogos:', dialogs.length ? dialogs : 'ninguno');
  }
} catch (err) {
  problems.push(err instanceof Error ? err.message : String(err));
} finally {
  ws?.close();
  chrome.kill();
}

console.log(`\nCapturas y archivo exportado en: ${out}`);
if (problems.length > 0) {
  console.log('PROBLEMAS:', problems);
  process.exit(1);
}
console.log('OK');
