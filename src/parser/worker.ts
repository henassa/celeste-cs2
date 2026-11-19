// Web Worker : décompression + parsing de la démo hors du thread principal.
// Rien ne quitte la machine : le fichier est lu localement et traité en WASM.

import init, { parseHeader, parseEvents, parseTicks, parseGrenades, parseVoice } from './wasm/demoparser2.js';
import { voiceTransferables, type VoiceData } from '../voice/types';
import { aimRowsFromTicks, type AimRows } from '../stats/aim';
import wasmUrl from './wasm/demoparser2_bg.wasm?url';
import { decompress as zstdDecompress } from 'fzstd';
import { parseRaw, type DemoParserModule } from './parse-demo';
import { buildMatch } from './build-match';
import { matchTransferables } from '../data/types';

export type WorkerRequest = { type: 'parse'; file: File } | { type: 'voice'; file: File } | { type: 'aim'; file: File; ticks: Int32Array };
export type WorkerResponse =
  | { type: 'progress'; step: string; ratio: number }
  | { type: 'done'; match: import('../data/types').MatchData }
  | { type: 'voice'; voice: VoiceData }
  | { type: 'aim'; rows: AimRows }
  | { type: 'error'; message: string };

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

let ready: Promise<unknown> | null = null;

async function readDemoBytes(file: File): Promise<Uint8Array> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.gz')) {
    const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  // .zst (FACEIT) : détecté par l'extension ou la signature zstd 28 B5 2F FD
  if (name.endsWith('.zst') || (buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd)) {
    return zstdDecompress(buf);
  }
  if (name.endsWith('.bz2')) throw new Error('.bz2 demos are not supported yet. Extract the .dem first.');
  return buf;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  if (e.data.type === 'voice') {
    // Seconde passe, à la demande : uniquement les paquets de voix
    try {
      ready ??= init({ module_or_path: wasmUrl });
      const [bytes] = await Promise.all([readDemoBytes(e.data.file), ready]);
      const voice = parseVoice(bytes) as VoiceData;
      post({ type: 'voice', voice }, voiceTransferables(voice));
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (e.data.type === 'aim') {
    // Seconde passe, à la demande : positions et angles au tick près autour des duels
    try {
      ready ??= init({ module_or_path: wasmUrl });
      const [bytes] = await Promise.all([readDemoBytes(e.data.file), ready]);
      const raw = parseTicks(bytes, ['X', 'Y', 'Z', 'pitch', 'yaw', 'approximate_spotted_by'], e.data.ticks, null, true);
      const rows = aimRowsFromTicks(raw);
      post({ type: 'aim', rows }, [rows.ticks, rows.x, rows.y, rows.z, rows.pitch, rows.yaw].map((a) => a.buffer as ArrayBuffer));
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (e.data.type !== 'parse') return;
  try {
    const file = e.data.file;
    post({ type: 'progress', step: 'loading', ratio: 0 });
    ready ??= init({ module_or_path: wasmUrl });
    const [bytes] = await Promise.all([readDemoBytes(file), ready]);
    const magic = String.fromCharCode(...bytes.subarray(0, 7));
    if (magic !== 'PBDEMS2') {
      throw new Error(magic.startsWith('HL2DEMO') ? 'This is a CS:GO demo. Only CS2 demos are supported.' : 'Not a CS2 demo file.');
    }
    const mod = { parseHeader, parseEvents, parseTicks, parseGrenades } as unknown as DemoParserModule;
    const raw = parseRaw(mod, bytes, { fileName: file.name, fileSize: file.size },
      (step, ratio) => post({ type: 'progress', step, ratio }));
    const match = buildMatch(raw);
    post({ type: 'done', match }, matchTransferables(match));
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
