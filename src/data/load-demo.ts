// Lance le parsing d'une démo dans un worker dédié (un worker par démo, libéré à la fin
// pour rendre la mémoire WASM au système).

import type { MatchData } from './types';
import type { WorkerResponse } from '../parser/worker';

export function loadDemo(file: File, onProgress: (step: string, ratio: number) => void): Promise<MatchData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../parser/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') onProgress(msg.step, msg.ratio);
      else if (msg.type === 'done') { worker.terminate(); resolve(msg.match); }
      else if (msg.type === 'error') { worker.terminate(); reject(new Error(msg.message)); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'Parser crashed (out of memory?)')); };
    worker.postMessage({ type: 'parse', file });
  });
}

/** Extrait la voix de la démo (seconde passe à la demande, dans un worker). */
export function loadVoice(file: File): Promise<import('../voice/types').VoiceData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../parser/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'voice') { worker.terminate(); resolve(msg.voice); }
      else if (msg.type === 'error') { worker.terminate(); reject(new Error(msg.message)); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'Parser crashed')); };
    worker.postMessage({ type: 'voice', file });
  });
}

/** Seconde passe pour les stats d'aim : positions et angles au tick près aux ticks demandés. */
export function loadAimRows(file: File, ticks: Int32Array): Promise<import('../stats/aim').AimRows> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../parser/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'aim') { worker.terminate(); resolve(msg.rows); }
      else if (msg.type === 'error') { worker.terminate(); reject(new Error(msg.message)); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'Parser crashed')); };
    worker.postMessage({ type: 'aim', file, ticks });
  });
}
