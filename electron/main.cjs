// Application de bureau Celeste (Electron) : la même interface que la version web, plus ce que le
// navigateur ne peut pas faire : trouver CS2, extraire les maps 3D et les modèles des joueurs depuis
// le jeu installé (scripts/), et les servir à l'interface. Tout reste sur la machine.

const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// --- Dossiers ---
const ROOT = path.join(__dirname, '..'); // dist/, scripts/, src/maps/maps.json
const DIST = path.join(ROOT, 'dist');
// Données de l'utilisateur dans %APPDATA%/Celeste ; celles de l'ancien nom (scrimview) sont reprises
// telles quelles (maps 3D, modèles, bibliothèque et réglages de l'interface).
// Nom interne inchangé : il fixe le dossier de données (%APPDATA%/Celeste)
app.setName('Celeste');
{
  const appData = app.getPath('appData');
  const oldDir = path.join(appData, 'scrimview'), newDir = path.join(appData, 'Celeste');
  app.setPath('userData', newDir);
  if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) { try { fs.renameSync(oldDir, newDir); } catch { app.setPath('userData', oldDir); } }
}
const USER = app.getPath('userData');
const CONFIG_FILE = path.join(USER, 'config.json');
const readConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } };
const writeConfig = (c) => { fs.mkdirSync(USER, { recursive: true }); fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 1)); };
const paths = () => {
  const c = readConfig();
  return {
    assets: path.join(USER, 'assets'),
    // Exports bruts du jeu : plusieurs Go, déplaçables sur un autre disque
    work: c.workDir || path.join(USER, 'map-sources'),
    tools: path.join(USER, 'tools'),
    cs2: c.cs2 || null,
  };
};
const scriptEnv = () => {
  const p = paths();
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1', SCRIMVIEW_ASSETS: p.assets, SCRIMVIEW_WORK: p.work, SCRIMVIEW_TOOLS: p.tools, ...(p.cs2 ? { SCRIMVIEW_CS2: p.cs2 } : {}) };
};

// --- Performances : rendu GPU même sur les cartes graphiques mises de côté par Chromium ---
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// --- Protocole app:// : l'interface (dist/) et les fichiers générés sur cette machine (maps, modèles) ---
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.gz': 'application/octet-stream', '.bin': 'application/octet-stream' };
function serve(request) {
  const url = new URL(request.url);
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!rel) rel = 'index.html';
  if (rel.includes('..')) return new Response('forbidden', { status: 403 });
  // Fichiers générés (geo/, anim/, maps/) d'abord, puis l'application
  const candidates = /^(geo|anim|maps)\//.test(rel) ? [path.join(paths().assets, rel), path.join(DIST, rel)] : [path.join(DIST, rel)];
  const file = candidates.find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  if (!file) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  return net.fetch(pathToFileURL(file).toString()).then((r) => new Response(r.body, { status: 200, headers: { 'content-type': type, 'cache-control': /^(geo|anim|maps)\//.test(rel) ? 'no-cache' : 'max-age=3600' } }));
}

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1100, minHeight: 700,
    backgroundColor: '#0a0a0a', autoHideMenuBar: true, title: 'Celeste CS2', show: false,
    // Barre de titre intégrée à l'interface : seuls les boutons de la fenêtre restent natifs
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 12, y: 11 } } : { titleBarOverlay: { color: '#0a0a0a', symbolColor: '#a3a3a3', height: 36 } }),
    icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  // Liens externes (GitHub, FACEIT…) : dans le navigateur de l'utilisateur
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://') && !url.startsWith(process.env.SCRIMVIEW_DEV_URL ?? '\0')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.loadURL((process.env.SCRIMVIEW_DEV_URL ?? 'app://scrimview/index.html') + (process.env.SCRIMVIEW_SMOKE_HASH ?? ''));
  // Vérification automatique (tests) : capture puis fermeture
  if (process.env.SCRIMVIEW_SMOKE) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const r = await win.webContents.executeJavaScript(`(async () => ({ title: document.title, desktop: !!window.scrimviewDesktop, info: window.scrimviewDesktop ? await window.scrimviewDesktop.info() : null, maps: window.scrimviewDesktop ? await window.scrimviewDesktop.listMaps() : null, geo: (await fetch('geo/de_mirage.bin.gz')).status, text: document.body.innerText.slice(0, 300), hash: location.href }))()`);
      console.log('SMOKE', JSON.stringify(r));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.SCRIMVIEW_SMOKE, img.toPNG());
      app.quit();
    }, Number(process.env.SCRIMVIEW_SMOKE_WAIT ?? 4000)));
  }
}

// --- Tâches d'extraction (une à la fois), journal envoyé à l'interface ---
let job = null;
function runScript(script, args) {
  if (job) throw new Error('A task is already running');
  fs.mkdirSync(paths().work, { recursive: true });
  // Dossier de travail : celui des exports (Source2Viewer y écrit ses rapports), jamais le dossier d'installation
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { env: scriptEnv(), cwd: paths().work, windowsHide: true, detached: process.platform !== 'win32' });
  job = { child, script };
  const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
  send('job:start', { script, args });
  const onData = (stream) => {
    let buf = '';
    child[stream].on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const line of lines) {
        if (line.startsWith('@@progress ')) { try { send('job:progress', JSON.parse(line.slice(11))); } catch { /* */ } }
        else if (line.trim()) send('job:line', { stream, line });
      }
    });
  };
  onData('stdout'); onData('stderr');
  child.on('close', (code) => { job = null; send('job:end', { script, code }); });
  child.on('error', (e) => { job = null; send('job:end', { script, code: -1, error: String(e) }); });
  return true;
}
function cancelJob() {
  if (!job) return false;
  const pid = job.child.pid;
  // Arrête aussi Source2Viewer lancé par le script
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => {});
  else try { process.kill(-pid, 'SIGTERM'); } catch { job.child.kill('SIGTERM'); }
  return true;
}
/** Lance un script et renvoie sa sortie (petites requêtes : liste des maps). */
function scriptOutput(script, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { env: scriptEnv(), cwd: USER, windowsHide: true, maxBuffer: 1 << 24 }, (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr: stderr || (err ? String(err.message) : '') }));
  });
}

function dirSize(dir) {
  let total = 0;
  try { for (const f of fs.readdirSync(dir, { recursive: true })) { try { const s = fs.statSync(path.join(dir, String(f))); if (s.isFile()) total += s.size; } catch { /* */ } } } catch { /* */ }
  return total;
}

// --- VOD (YouTube / Twitch) dans sa propre fenêtre, pilotée depuis le replay ---
let vodWin = null;
const VOD_URL = /^https:\/\/((www|m)\.)?(youtube\.com|youtu\.be|twitch\.tv)\//i;
function vodJs(cmd) {
  const v = "document.querySelector('video')";
  const t = Number(cmd.t), r = Number(cmd.rate);
  switch (cmd.type) {
    case 'seek': return Number.isFinite(t) ? `(()=>{const v=${v}; if(!v) return null; v.currentTime=${Math.max(0, t)}; return v.currentTime})()` : 'null';
    case 'play': return `(()=>{const v=${v}; if(!v) return null; ${cmd.on ? 'v.play().catch(()=>{})' : 'v.pause()'}; return true})()`;
    case 'rate': return Number.isFinite(r) ? `(()=>{const v=${v}; if(!v) return null; v.playbackRate=${Math.min(16, Math.max(0.1, r))}; return true})()` : 'null';
    default: return `(()=>{const v=${v}; return v ? v.currentTime : null})()`;
  }
}

function registerIpc() {
  ipcMain.handle('vod:open', (_e, url) => {
    if (typeof url !== 'string' || !VOD_URL.test(url)) return false;
    if (!vodWin || vodWin.isDestroyed()) {
      vodWin = new BrowserWindow({ width: 1000, height: 600, title: 'VOD — Celeste', autoHideMenuBar: true, backgroundColor: '#000', webPreferences: { contextIsolation: true, sandbox: true } });
      vodWin.on('closed', () => { vodWin = null; });
    }
    vodWin.loadURL(url);
    vodWin.show();
    return true;
  });
  ipcMain.handle('vod:cmd', (_e, cmd) => (vodWin && !vodWin.isDestroyed() ? vodWin.webContents.executeJavaScript(vodJs(cmd || {}), true).catch(() => null) : null));
  ipcMain.handle('vod:close', () => { if (vodWin && !vodWin.isDestroyed()) vodWin.close(); return true; });
  ipcMain.handle('desktop:info', () => {
    const p = paths();
    const anim = fs.existsSync(path.join(p.assets, 'anim', 'players.json.gz'));
    const geo = fs.existsSync(path.join(p.assets, 'geo')) ? fs.readdirSync(path.join(p.assets, 'geo')).filter((f) => f.endsWith('.bin.gz')).map((f) => f.slice(0, -7)) : [];
    return { version: app.getVersion(), platform: process.platform, paths: p, anim, geo, setupDone: !!readConfig().setupDone, job: job ? job.script : null };
  });
  ipcMain.handle('desktop:listMaps', async () => {
    const r = await scriptOutput('extract-maps.mjs', ['--list']);
    if (!r.ok) return { ok: false, error: (r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ') };
    try { return { ok: true, ...JSON.parse(r.stdout.trim().split('\n').pop()) }; } catch { return { ok: false, error: 'could not read the map list' }; }
  });
  ipcMain.handle('desktop:pickCs2', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Folder of Counter-Strike 2 (contains game/csgo)', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const dir = r.filePaths[0];
    if (!fs.existsSync(path.join(dir, 'game/csgo/pak01_dir.vpk'))) return { error: 'This folder does not contain game/csgo/pak01_dir.vpk' };
    writeConfig({ ...readConfig(), cs2: dir });
    return { cs2: dir };
  });
  ipcMain.handle('desktop:pickWorkDir', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Folder for the game exports (several GB)', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    writeConfig({ ...readConfig(), workDir: r.filePaths[0] });
    return { workDir: r.filePaths[0] };
  });
  ipcMain.handle('desktop:extractMaps', (_e, specs, quality) => runScript('extract-maps.mjs', [...specs, ...(quality === 'complete' ? ['--complete'] : quality === 'full' ? ['--full'] : [])]));
  ipcMain.handle('desktop:extractModels', () => runScript('extract-anims.mjs', []));
  ipcMain.handle('desktop:cancel', () => cancelJob());
  ipcMain.handle('desktop:setupDone', (_e, done) => { writeConfig({ ...readConfig(), setupDone: !!done }); return true; });
  ipcMain.handle('desktop:open', (_e, which) => { const p = paths(); const dir = which === 'work' ? p.work : p.assets; fs.mkdirSync(dir, { recursive: true }); return shell.openPath(dir); });
  ipcMain.handle('desktop:disk', () => {
    const p = paths();
    // Place libre sur le disque des exports (le plus gros besoin pendant l'extraction)
    let free = null;
    try { fs.mkdirSync(p.work, { recursive: true }); const st = fs.statfsSync(p.work); free = st.bavail * st.bsize; } catch { /* inconnu */ }
    return { assets: dirSize(p.assets), work: dirSize(p.work), free };
  });
  ipcMain.handle('desktop:cleanWork', () => { if (job) return false; fs.rmSync(paths().work, { recursive: true, force: true }); return true; });
  ipcMain.handle('desktop:removeMap', (_e, name) => {
    if (!/^[a-z0-9_]+$/i.test(name)) return false;
    fs.rmSync(path.join(paths().assets, 'geo', `${name}.bin.gz`), { force: true });
    return true;
  });
}

// Une seule fenêtre : un deuxième lancement ramène la première
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    protocol.handle('app', serve);
    registerIpc();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { cancelJob(); if (process.platform !== 'darwin') app.quit(); });
}
