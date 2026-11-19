// Récupère les fichiers générés sur ta machine depuis le dossier d'une ancienne version de scrimview
// (après avoir dézippé une nouvelle version ailleurs) : modèles et animations des joueurs, maps 3D,
// exports du jeu et outils déjà téléchargés. Rien n'est réexporté, tout est copié.
//
//   npm run assets:import -- "C:/chemin/vers/scrimview-v0.27.0"

import fs from 'node:fs';
import path from 'node:path';
import { argv, log, root } from './lib/cs2.mjs';

const from = argv.find((a) => !a.startsWith('--'));
if (!from || !fs.existsSync(from)) { console.error('usage: npm run assets:import -- "<folder of an older scrimview version>"'); process.exit(1); }
const src = path.resolve(from);
if (src === root) { console.error('That is this folder.'); process.exit(1); }

// public/anim : animations et corps des agents ; public/geo : maps 3D construites ;
// map-sources : exports du jeu (évite de tout réexporter) ; tools : Source2Viewer-CLI
const ITEMS = ['public/anim', 'public/geo', 'map-sources', 'tools'];
let copied = 0;
for (const item of ITEMS) {
  const a = path.join(src, item), b = path.join(root, item);
  if (!fs.existsSync(a)) { log(`${item}: not in the old folder`); continue; }
  fs.cpSync(a, b, { recursive: true, force: true, errorOnExist: false });
  const n = fs.statSync(a).isDirectory() ? fs.readdirSync(a, { recursive: true }).length : 1;
  log(`${item}: ${n} files copied`);
  copied++;
}
log(copied ? 'done. Rebuild the app (npm run build).' : 'nothing to copy.');
