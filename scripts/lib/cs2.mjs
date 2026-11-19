// Outils communs : trouver CS2 (bibliothèques Steam), télécharger Source2Viewer-CLI, le lancer.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import zlib from 'node:zlib';

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
export const argv = process.argv.slice(2);
export const opt = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
export const log = (m) => console.log(`[cs2] ${m}`);
/** Avancement lisible par l'app de bureau (une ligne JSON préfixée). */
export const progress = (done, total, label) => console.log(`@@progress ${JSON.stringify({ done, total, label })}`);

// Dossiers : ceux du dépôt par défaut ; l'app de bureau les place dans le dossier de l'utilisateur.
/** Fichiers servis à l'app : geo/ (maps 3D), anim/ (joueurs), maps/ (radars et calibrations ajoutés). */
export const assetsDir = path.resolve(process.env.SCRIMVIEW_ASSETS ?? path.join(root, 'public'));
/** Exports bruts du jeu (plusieurs Go). */
export const workDir = path.resolve(process.env.SCRIMVIEW_WORK ?? path.join(root, 'map-sources'));
/** Outils téléchargés (Source2Viewer-CLI). */
export const toolsDir = path.resolve(process.env.SCRIMVIEW_TOOLS ?? path.join(root, 'tools'));

/** Dossiers de bibliothèques Steam (libraryfolders.vdf), pour trouver CS2 même hors du disque principal. */
export function steamLibraries() {
  const roots = process.platform === 'win32'
    ? ['C:/Program Files (x86)/Steam', 'C:/Program Files/Steam']
    : process.platform === 'darwin' ? [path.join(os.homedir(), 'Library/Application Support/Steam')]
      : [path.join(os.homedir(), '.steam/steam'), path.join(os.homedir(), '.local/share/Steam')];
  // Windows : dossier de Steam enregistré (installation hors de C:)
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m = /SteamPath\s+REG_SZ\s+(.+)/.exec(out);
      if (m) roots.unshift(m[1].trim().replace(/\\/g, '/'));
    } catch { /* pas de registre */ }
  }
  const libs = new Set();
  for (const r of roots) {
    libs.add(r);
    const vdf = path.join(r, 'steamapps/libraryfolders.vdf');
    if (fs.existsSync(vdf)) for (const m of fs.readFileSync(vdf, 'utf8').matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '/'));
  }
  return [...libs];
}

export function findCs2() {
  if (opt.cs2) return opt.cs2;
  if (process.env.SCRIMVIEW_CS2) return process.env.SCRIMVIEW_CS2;
  for (const lib of steamLibraries()) {
    const p = path.join(lib, 'steamapps/common/Counter-Strike Global Offensive');
    if (fs.existsSync(path.join(p, 'game/csgo/pak01_dir.vpk'))) return p;
  }
  return null;
}

export async function findS2v() {
  if (opt.s2v) return opt.s2v;
  const tools = toolsDir;
  const exe = path.join(tools, process.platform === 'win32' ? 'Source2Viewer-CLI.exe' : 'Source2Viewer-CLI');
  if (fs.existsSync(exe)) return exe;
  const asset = process.platform === 'win32' ? 'cli-windows-x64.zip' : process.platform === 'darwin' ? (os.arch() === 'arm64' ? 'cli-macos-arm64.zip' : 'cli-macos-x64.zip') : 'cli-linux-x64.zip';
  const url = `https://github.com/ValveResourceFormat/ValveResourceFormat/releases/latest/download/${asset}`;
  log(`downloading Source2Viewer-CLI (${asset})…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}): get it from https://github.com/ValveResourceFormat/ValveResourceFormat/releases and pass --s2v=<path>`);
  fs.mkdirSync(tools, { recursive: true });
  const zip = path.join(tools, asset);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  unzip(zip, tools);
  fs.rmSync(zip);
  if (process.platform !== 'win32') fs.chmodSync(exe, 0o755);
  return exe;
}

export function run(exe, args) {
  const r = spawnSync(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || '').split('\n').slice(-5).join('\n'));
}

/** Fichiers produits sous un dossier, par extension. */
export const walk = (dir, re) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, String(f))).filter((f) => re.test(f) && fs.statSync(f).isFile()) : []);

/** Décompresse une archive .zip (sans outil externe : le tar de Linux ne lit pas les .zip). */
export function unzip(file, dest) {
  const buf = fs.readFileSync(file);
  // Fin du répertoire central
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('bad zip directory');
    const method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28), xlen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nlen);
    off += 46 + nlen + xlen + clen;
    const target = path.resolve(dest, name);
    if (!target.startsWith(path.resolve(dest))) continue; // chemins hors du dossier : ignorés
    if (name.endsWith('/')) { fs.mkdirSync(target, { recursive: true }); continue; }
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, method === 8 ? zlib.inflateRawSync(data) : data);
  }
}

/** Dépendances de la préparation (devDependencies) : message clair si `npm install` n'a pas été relancé. */
export async function checkDeps(deps) {
  for (const dep of deps) {
    try { await import(dep); } catch { console.error(`Missing package "${dep}": run "npm install" in this folder first, then run the command again.`); process.exit(1); }
  }
}

/** Taille d'un paquet de map, archives découpées (_000.vpk, _001.vpk…) comprises : sert à estimer la place nécessaire. */
function vpkSize(file) {
  let total = 0;
  try { total = fs.statSync(file).size; } catch { return 0; }
  const base = file.replace(/(_dir)?\.vpk$/i, '');
  for (let i = 0; i < 100; i++) { const part = `${base}_${String(i).padStart(3, '0')}.vpk`; if (!fs.existsSync(part)) break; total += fs.statSync(part).size; }
  return total;
}

/** Maps installées : celles du jeu (game/csgo/maps/*.vpk) et celles du workshop (steamapps/workshop/content/730). */
export function listInstalledMaps(cs2) {
  const out = [];
  const dir = path.join(cs2, 'game/csgo/maps');
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      const m = /^((?:de|cs|ar)_[a-z0-9_]+)\.vpk$/i.exec(f);
      if (m && !/_vanity|_skybox|_dir$|_\d{3}$/.test(m[1])) out.push({ name: m[1].toLowerCase(), vpk: path.join(dir, f), source: 'game', size: vpkSize(path.join(dir, f)) });
    }
  }
  // Workshop : chaque objet est un dossier numéroté contenant le .vpk de la map
  const lib = path.resolve(cs2, '../..');
  const ws = path.join(lib, 'workshop/content/730');
  if (fs.existsSync(ws)) {
    for (const id of fs.readdirSync(ws)) {
      const d = path.join(ws, id);
      let files = [];
      try { files = fs.readdirSync(d).filter((f) => f.toLowerCase().endsWith('.vpk') && !/_\d{3}\.vpk$/i.test(f)); } catch { continue; }
      for (const f of files) out.push({ name: f.replace(/(_dir)?\.vpk$/i, '').toLowerCase(), vpk: path.join(d, f), source: 'workshop', id, size: vpkSize(path.join(d, f)) });
    }
  }
  return out;
}

/** Calibration d'un fichier d'aperçu Source (resource/overviews/<map>.txt) : pos_x, pos_y, scale. */
export function parseOverview(text) {
  const num = (k) => { const m = new RegExp(`"${k}"\\s+"(-?[\\d.]+)"`, 'i').exec(text); return m ? Number(m[1]) : null; };
  const posX = num('pos_x'), posY = num('pos_y'), scale = num('scale');
  if (posX === null || posY === null || !scale) return null;
  // Niveaux (Nuke, Vertigo) : altitude de séparation si présente
  const lower = /"verticalsections"[\s\S]*?"altitudemax"\s+"(-?[\d.]+)"[\s\S]*?"altitudemin"\s+"(-?[\d.]+)"[\s\S]*?"altitudemax"\s+"(-?[\d.]+)"/i.exec(text);
  return { posX, posY, scale, lowerThresholdZ: lower ? Number(lower[2]) : null, hasLower: !!lower };
}

/** Calibrations : celles livrées avec l'app, plus celles ajoutées par l'utilisateur (maps du workshop). */
export function loadCalibrations() {
  const base = JSON.parse(fs.readFileSync(path.join(root, 'src/maps/maps.json'), 'utf8'));
  const extra = path.join(assetsDir, 'maps', 'maps.json');
  return { ...base, ...(fs.existsSync(extra) ? JSON.parse(fs.readFileSync(extra, 'utf8')) : {}) };
}
export function saveUserCalibration(name, cal) {
  const file = path.join(assetsDir, 'maps', 'maps.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const cur = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  cur[name] = cal;
  fs.writeFileSync(file, JSON.stringify(cur, null, 1));
}
