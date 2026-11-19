// Extrait les cartes de TON installation de CS2 pour des modèles 3D fidèles (géométrie visible réelle,
// accessoires, couleur des matériaux), puis lance la préparation (scripts/build-geometry.mjs).
// Rien n'est envoyé : tout se passe sur ta machine. Les fichiers produits restent ceux de Valve.
//
//   npm run maps:extract                         (cartes du pool, CS2 trouvé automatiquement)
//   npm run maps:extract -- --cs2="D:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive"
//   npm run maps:extract -- de_mirage de_nuke --tris=600000
//   npm run maps:extract -- --all                (toutes les maps installées, workshop compris)
//   npm run maps:extract -- --list               (liste des maps disponibles, en JSON)
//   npm run maps:extract -- "surf_x=C:/…/workshop/content/730/123/surf_x.vpk"   (une map du workshop)
//
// Outil utilisé : Source2Viewer-CLI (ValveResourceFormat, licence MIT), téléchargé dans tools/ au
// premier lancement si --s2v n'est pas donné.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { argv, checkDeps, findCs2, findS2v, listInstalledMaps, loadCalibrations, log, opt, parseOverview, progress, root, run, saveUserCalibration, walk, workDir, assetsDir } from './lib/cs2.mjs';

export const POOL = ['de_ancient', 'de_anubis', 'de_cache', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass', 'de_train', 'de_vertigo'];
const out = path.resolve(opt.out ?? workDir);

const cs2 = findCs2();
if (!cs2) { console.error('CS2 not found. Pass --cs2="<folder that contains game/csgo>".'); process.exit(1); }
const installed = listInstalledMaps(cs2);

// Liste pour l'app de bureau : maps installées, pool, déjà construites
if (opt.list) {
  const geo = path.join(assetsDir, 'geo');
  const builtSize = (name) => { try { return fs.statSync(path.join(geo, `${name}.bin.gz`)).size; } catch { return 0; } };
  console.log(JSON.stringify({ cs2, maps: installed.map((m) => ({ ...m, pool: POOL.includes(m.name), built: builtSize(m.name) > 0, builtSize: builtSize(m.name) })) }));
  process.exit(0);
}

await checkDeps(['pngjs', 'meshoptimizer']);
log(`CS2: ${cs2}`);
const s2v = await findS2v();
const pak = path.join(cs2, 'game/csgo/pak01_dir.vpk');
const radars = path.join(out, 'radars');
fs.mkdirSync(radars, { recursive: true });

// Maps demandées : noms (maps du jeu), "nom=chemin.vpk" (workshop), --all, sinon le pool
const specs = argv.filter((a) => !a.startsWith('--'));
const byName = new Map(installed.map((m) => [m.name, m]));
const list = (opt.all ? installed.map((m) => ({ name: m.name, vpk: m.vpk })) : specs.length ? specs.map((sp) => {
  const [name, vpk] = sp.split(/=(.+)/);
  return { name: name.toLowerCase(), vpk: vpk ?? byName.get(name.toLowerCase())?.vpk ?? path.join(cs2, 'game/csgo/maps', `${name}.vpk`) };
}) : POOL.map((name) => ({ name, vpk: path.join(cs2, 'game/csgo/maps', `${name}.vpk`) })));

/** Extrait un fichier d'un paquet vers un dossier temporaire et renvoie son chemin (ou null). */
function extractOne(vpk, internal, decompile) {
  const tmp = path.join(out, '_tmp_one');
  fs.rmSync(tmp, { recursive: true, force: true });
  try { run(s2v, ['-i', vpk, '-f', internal, '-o', tmp, ...(decompile ? ['-d'] : [])]); } catch { return null; }
  const f = walk(tmp, /./).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
  if (!f) return null;
  const keep = path.join(out, `_one_${path.basename(f)}`);
  fs.copyFileSync(f, keep);
  fs.rmSync(tmp, { recursive: true, force: true });
  return keep;
}

const cals = loadCalibrations();
const done = [];
for (const [i, { name: map, vpk }] of list.entries()) {
  progress(i, list.length, map);
  if (!fs.existsSync(vpk)) { log(`${map}: not installed, skipped`); continue; }
  try {
    // Nom réel de la map dans le paquet (les maps du workshop n'ont pas toujours le nom du fichier)
    let inner = map;
    const ls = spawnSync(s2v, ['-i', vpk, '--vpk_list', '-e', 'vmap_c'], { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout ?? '';
    const vmaps = [...ls.matchAll(/^maps\/([^/\s]+)\.vmap_c/gm)].map((m) => m[1]).filter((n) => !/_skybox|_vanity/.test(n));
    if (vmaps.length && !vmaps.includes(map)) inner = vmaps[0];
    // Radars (masque des zones jouables) : dans le paquet de la map, sinon dans pak01
    for (const [suffix, internal] of [['', `panorama/images/overheadmaps/${inner}_radar_psd.vtex_c`], ['_lower', `panorama/images/overheadmaps/${inner}_lower_radar_psd.vtex_c`]]) {
      const png = extractOne(vpk, internal, true) ?? extractOne(pak, internal, true);
      if (!png) continue;
      fs.copyFileSync(png, path.join(radars, `${map}${suffix}.png`));
      // Map absente des calibrations livrées : le radar sert aussi d'image dans l'app
      if (!cals[map]) { fs.mkdirSync(path.join(assetsDir, 'maps'), { recursive: true }); fs.copyFileSync(png, path.join(assetsDir, 'maps', `${map}${suffix}.png`)); }
      fs.rmSync(png);
    }
    // Calibration (workshop, maps récentes) : fichier d'aperçu de la map
    if (!cals[map]) {
      const txt = extractOne(vpk, `resource/overviews/${inner}.txt`, false) ?? extractOne(pak, `resource/overviews/${inner}.txt`, false);
      const cal = txt ? parseOverview(fs.readFileSync(txt, 'utf8')) : null;
      if (txt) fs.rmSync(txt);
      if (!cal) { log(`${map}: no radar calibration (resource/overviews/${inner}.txt) in the map, skipped`); continue; }
      cals[map] = { ...cal, radar: 'png' };
      saveUserCalibration(map, cals[map]);
      log(`${map}: calibration found (pos ${cal.posX}, ${cal.posY}, scale ${cal.scale})`);
    }
    // Carte entière en glTF (géométrie, accessoires, textures pour les couleurs)
    const dst = path.join(out, map);
    if (opt.force || !walk(dst, /\.gltf$/i).length) {
      log(`${map}: exporting the map (a few minutes, several hundred MB)…`);
      fs.rmSync(dst, { recursive: true, force: true });
      run(s2v, ['-i', vpk, '-f', `maps/${inner}.vmap_c`, '-o', dst, '--gltf_export_format', 'gltf', '--gltf_export_materials']);
    }
    if (!walk(dst, /\.gltf$/i).length) throw new Error('no glTF produced');
    done.push(map);
    log(`${map}: ok`);
  } catch (e) {
    log(`${map}: failed — ${e instanceof Error ? e.message : e}`);
  }
}

if (!done.length) process.exit(1);
progress(list.length, list.length + 1, 'building the 3D models');
log('building the 3D models…');
const extra = argv.filter((a) => a.startsWith('--tris=') || a.startsWith('--error=') || a === '--full' || a === '--complete' || a === '--colors');
const r = spawnSync(process.execPath, ['--max-old-space-size=8192', path.join(root, 'scripts/build-geometry.mjs'), out, radars, ...done, ...extra], { stdio: 'inherit', env: process.env });
if (r.status !== 0) process.exit(r.status ?? 1);
progress(1, 1, 'done');
log(`done: 3D maps updated for ${done.join(', ')}.`);
process.exit(0);
