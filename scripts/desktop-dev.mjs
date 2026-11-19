// Développement de l'app de bureau : serveur Vite (rechargement à chaud) + Electron qui l'affiche.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { root } from './lib/cs2.mjs';

const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--port', '5173', '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
let started = false;
vite.stdout.on('data', async (d) => {
  process.stdout.write(d);
  if (started || !/localhost:5173/.test(String(d))) return;
  started = true;
  const electron = (await import('electron')).default;
  const app = spawn(electron, ['.'], { cwd: root, stdio: 'inherit', env: { ...process.env, SCRIMVIEW_DEV_URL: 'http://localhost:5173/' } });
  app.on('close', () => { vite.kill(); process.exit(0); });
});
