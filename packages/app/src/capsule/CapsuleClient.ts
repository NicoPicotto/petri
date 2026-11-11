/** Envuelve el worker de una cápsula: cada pedido devuelve una promesa con su respuesta. */

import type { BatchMessage, MainToWorker, RunMessage, WorkerToMain } from '../worker/protocol';

type Request = MainToWorker extends infer M ? (M extends { requestId: number } ? Omit<M, 'requestId'> : never) : never;

export class CapsuleClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (m: WorkerToMain) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('../worker/capsule.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
      const msg = event.data;
      const entry = this.pending.get(msg.requestId);
      if (!entry) return;
      this.pending.delete(msg.requestId);
      if (msg.type === 'error') entry.reject(new Error(msg.message));
      else entry.resolve(msg);
    };
  }

  private request(msg: Request): Promise<WorkerToMain> {
    const requestId = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({ ...msg, requestId } as MainToWorker);
    });
  }

  async batch(msg: Exclude<Request, { type: 'getRun' }>): Promise<BatchMessage> {
    const res = await this.request(msg);
    if (res.type !== 'batch') throw new Error(`Respuesta inesperada del worker: ${res.type}`);
    return res;
  }

  async getRun(): Promise<RunMessage> {
    const res = await this.request({ type: 'getRun' });
    if (res.type !== 'run') throw new Error(`Respuesta inesperada del worker: ${res.type}`);
    return res;
  }

  terminate(): void {
    this.worker.terminate();
    for (const { reject } of this.pending.values()) reject(new Error('Worker terminado'));
    this.pending.clear();
  }
}
