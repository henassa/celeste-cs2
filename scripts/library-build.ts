// Bibliothèque en masse : analyse un dossier entier de démos (.dem, .dem.gz, .dem.zst et archives .rar
// comme celles d'HLTV) sur plusieurs cœurs, et écrit un fichier de bibliothèque à importer dans l'app
// (Library → Restore). Relancé sur le même fichier, il reprend là où il s'était arrêté.
//
//   npm run library:build -- "D:/demos/hltv"                     (écrit celeste-library.json)
//   npm run library:build -- "D:/demos/hltv" --out=pro.json --workers=4
//
// Les démos ne sont ni copiées ni envoyées : seul le résumé de chaque match (stats, positions,
// grenades…) va dans le fichier, quelques centaines de Ko par match au lieu de centaines de Mo.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEMO = /\.dem(\.gz|\.zst)?$/i;

interface Job { file: string; inner?: string; size: number; mtime: number }
type Reply = { ok: true; key: string; match: unknown } | { ok: false; key: string; error: string };

if (isMainThread) await main(); else await worker();

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
  if (!dir || !fs.existsSync(dir)) { console.error('usage: npm run library:build -- "<folder of demos>" [--out=celeste-library.json] [--workers=N]'); process.exit(1); }
  const out = path.resolve(opt.out ?? 'celeste-library.json');
  // Une analyse peut prendre 1 à 2 Go de mémoire : pas plus de 4 en parallèle par défaut
  const workers = Math.max(1, Number(opt.workers ?? Math.min(4, Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1))));

  // Reprise : matchs déjà dans le fichier, et fichiers déjà traités
  const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  const matches = new Map<string, { id: string }>((prev?.matches ?? []).map((m: { id: string }) => [m.id, m]));
  const done = new Set<string>(prev?.sources ?? []);

  // Démos et archives du dossier (sous-dossiers compris)
  const jobs: Job[] = [];
  const unrar = await import('node-unrar-js');
  const wasmBinary = fs.readFileSync(path.join(here, '../node_modules/node-unrar-js/esm/js/unrar.wasm')).buffer as ArrayBuffer;
  for (const rel of fs.readdirSync(dir, { recursive: true }).map(String)) {
    const file = path.join(dir, rel);
    let st: fs.Stats; try { st = fs.statSync(file); } catch { continue; }
    if (!st.isFile()) continue;
    if (DEMO.test(file)) jobs.push({ file, size: st.size, mtime: st.mtimeMs });
    else if (/\.rar$/i.test(file)) {
      try {
        const ex = await unrar.createExtractorFromFile({ wasmBinary, filepath: file });
        for (const h of ex.getFileList().fileHeaders) if (!h.flags.directory && DEMO.test(h.name)) jobs.push({ file, inner: h.name, size: h.unpSize, mtime: st.mtimeMs });
      } catch (e) { console.log(`skipped ${rel}: ${e instanceof Error ? e.message : e}`); }
    }
  }
  const key = (j: Job) => `${path.relative(dir, j.file)}${j.inner ? `#${j.inner}` : ''}`;
  const todo = jobs.filter((j) => !done.has(key(j)));
  console.log(`${jobs.length} demos found, ${jobs.length - todo.length} already in ${path.basename(out)}, ${todo.length} to analyse with ${workers} worker${workers === 1 ? '' : 's'}`);
  if (!todo.length) return;

  let next = 0, finished = 0, failed = 0;
  const t0 = Date.now();
  const save = () => fs.writeFileSync(out, JSON.stringify({ app: 'scrimview', kind: 'library', version: 1, exportedAt: new Date().toISOString(), sources: [...done], matches: [...matches.values()] }));
  let lastSave = Date.now();
  await Promise.all(Array.from({ length: Math.min(workers, todo.length) }, () => new Promise<void>((resolve) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { tmp: path.join(os.tmpdir(), 'scrimview-rar') }, execArgv: process.execArgv, resourceLimits: { maxOldGenerationSizeMb: 4096 } });
    const pump = () => {
      if (next >= todo.length) { w.terminate(); resolve(); return; }
      const j = todo[next++];
      w.postMessage({ ...j, key: key(j) });
    };
    w.on('message', (r: Reply) => {
      finished++;
      done.add(r.key);
      if (r.ok) matches.set((r.match as { id: string }).id, r.match as { id: string }); else { failed++; console.log(`  failed ${r.key}: ${r.error}`); }
      const rate = finished / ((Date.now() - t0) / 1000);
      process.stdout.write(`\r  ${finished}/${todo.length} · ${matches.size} matches · ${(rate * 60).toFixed(1)} demos/min · ~${Math.round((todo.length - finished) / Math.max(rate, 1e-6) / 60)} min left   `);
      if (Date.now() - lastSave > 30_000) { save(); lastSave = Date.now(); } // reprise possible en cas d'arrêt
      pump();
    });
    w.on('error', (e) => { console.log(`\n  worker error: ${e.message}`); failed++; resolve(); });
    pump();
  })));
  save();
  console.log(`\ndone: ${matches.size} matches in ${out} (${failed} failed). Import it in Celeste: Library → Restore a backup.`);
}

async function worker() {
  const { initSync, parseHeader, parseEvents, parseTicks, parseGrenades } = await import('../src/parser/wasm/demoparser2.js');
  const { parseRaw } = await import('../src/parser/parse-demo');
  const { buildMatch } = await import('../src/parser/build-match');
  const { summarize } = await import('../src/library/library');
  const { decompress } = await import('fzstd');
  initSync({ module: fs.readFileSync(path.join(here, '../src/parser/wasm/demoparser2_bg.wasm')) });
  const mod = { parseHeader, parseEvents, parseTicks, parseGrenades } as unknown as Parameters<typeof parseRaw>[0];
  const unrar = await import('node-unrar-js');
  const wasmBinary = fs.readFileSync(path.join(here, '../node_modules/node-unrar-js/esm/js/unrar.wasm')).buffer as ArrayBuffer;
  const tmp = (workerData as { tmp: string }).tmp;

  parentPort!.on('message', async (j: Job & { key: string }) => {
    let extracted: string | null = null;
    try {
      let file = j.file;
      // Archive : on n'en extrait que cette démo, dans un dossier temporaire
      if (j.inner) {
        const dest = path.join(tmp, `${process.pid}-${Math.random().toString(36).slice(2)}`);
        fs.mkdirSync(dest, { recursive: true });
        const ex = await unrar.createExtractorFromFile({ wasmBinary, filepath: j.file, targetPath: dest });
        [...ex.extract({ files: [j.inner] }).files];
        file = path.join(dest, j.inner);
        extracted = dest;
      }
      let bytes: Uint8Array = fs.readFileSync(file);
      if (/\.gz$/i.test(file)) bytes = zlib.gunzipSync(bytes);
      else if (/\.zst$/i.test(file)) bytes = decompress(bytes);
      const name = path.basename(j.inner ?? j.file).replace(/\.(gz|zst)$/i, '');
      const raw = parseRaw(mod, bytes, { fileName: name, fileSize: bytes.length });
      const m = buildMatch(raw);
      parentPort!.postMessage({ ok: true, key: j.key, match: summarize(m, j.mtime) } satisfies Reply);
    } catch (e) {
      parentPort!.postMessage({ ok: false, key: j.key, error: e instanceof Error ? e.message.split('\n')[0] : String(e) } satisfies Reply);
    } finally {
      if (extracted) fs.rmSync(extracted, { recursive: true, force: true });
    }
  });
}
