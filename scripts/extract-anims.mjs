// Extrait de TON installation de CS2 le squelette des joueurs et leurs animations (Animgraph 2) :
// repos, marche, course, accroupi (fusil, pistolet, couteau), pose de la bombe, défuse, mort.
// Puis prépare le paquet utilisé par la vue 3D (scripts/build-anims.mjs). Rien n'est envoyé.
//
//   npm run anims:extract
//   npm run anims:extract -- --cs2="D:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive"

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkDeps, findCs2, findS2v, log, opt, progress, root, run, walk, workDir } from './lib/cs2.mjs';

await checkDeps(['meshoptimizer']);
const out = path.resolve(opt.out ?? path.join(workDir, 'anims'));
const W = 'animation/anims/world';
const CLASSES = ['rifle', 'pistol', 'knife'];
const DIRS = ['n', 's', 'e', 'w'];
const clips = [];
for (const c of CLASSES) {
  const d = `${W}/${c}/_default_${c}`;
  clips.push(`${d}/idle_${c}`, `${d}/idle_crouch_${c}`);
  for (const dir of DIRS) clips.push(`${d}/walk_${dir}_${c}`, `${d}/run_${dir}_${c}`, `${d}/crouch_${dir}_${c}`);
  clips.push(`${d}/jump_stand_${c}`, `${d}/inair_stand_${c}`, `${d}/inair_n_${c}`);
  clips.push(`${W}/shared/defuse/defuse_loop_${c}`, `${W}/shared/defuse/defuse_crouch_loop_${c}`);
}
// Grenades : tenue (versions non additives) et lancer
const G = `${W}/grenade/_default_grenade`;
clips.push([`${G}/idle_grenade.vnmclip+non_additive`, 'idle_grenade'], [`${G}/idle_crouch_grenade.vnmclip+non_additive`, 'idle_crouch_grenade'], `${G}/throw_overhand_grenade`, `${G}/throw_underhand_grenade`, `${G}/pullpin_grenade`);
clips.push(`${W}/equipment/c4/planting`, `${W}/equipment/c4/planting_crouch`, `${W}/shared/death_chest_a`, `${W}/shared/death_poses_body`, `${W}/shared/flashed`);

const cs2 = findCs2();
if (!cs2) { console.error('CS2 not found. Pass --cs2="<folder that contains game/csgo>".'); process.exit(1); }
log(`CS2: ${cs2}`);
const s2v = await findS2v();
const pak = path.join(cs2, 'game/csgo/pak01_dir.vpk');
fs.mkdirSync(out, { recursive: true });

/** Exporte un fichier du jeu en .glb dans out/<nom>.glb (déjà fait : réutilisé). */
function exportGlb(internal, name, extra = []) {
  const dst = path.join(out, `${name}.glb`);
  if (fs.existsSync(dst) && !opt.force) return true;
  const tmp = path.join(out, '_tmp');
  fs.rmSync(tmp, { recursive: true, force: true });
  try { run(s2v, ['-i', pak, '-f', internal, '-o', tmp, '--gltf_export_format', 'glb', ...extra]); } catch (e) { log(`${name}: failed — ${String(e).split('\n')[0]}`); return false; }
  const glb = walk(tmp, /\.glb$/i).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
  if (glb) fs.copyFileSync(glb, dst);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!glb) log(`${name}: nothing produced`);
  return !!glb;
}

// Liste complète du jeu : animations propres à chaque arme (sortie, rechargement, tir) et corps des agents
const list = spawnSync(s2v, ['-i', pak, '--vpk_list'], { encoding: 'utf8', maxBuffer: 1 << 30 }).stdout ?? '';
const files = new Set(list.split(/\r?\n/).map((l) => l.split(' ')[0]));
for (const f of files) {
  const m = /^animation\/anims\/world\/(rifle|pistol)\/((?:rifle|pistol)_[a-z0-9_]+)\/(draw|reload|shoot)_[a-z0-9_]+?(\.vnmclip\+non_additive)?\.vnmclip_c$/.exec(f);
  if (!m || /crouch|silent|empty/.test(f)) continue;
  if (m[3] === 'shoot' && !m[4]) continue; // le tir : version non additive seulement
  const name = `${m[3]}_${m[2]}`;
  if (!clips.some((c) => Array.isArray(c) && c[1] === name)) clips.push([f.replace(/\.vnmclip_c$/, ''), name]);
}

exportGlb('animation/skeletons/characters/worldmodel.vnmskel_c', 'skeleton');
let ok = 0;
for (const [i, entry] of clips.entries()) {
  const [c, name] = Array.isArray(entry) ? entry : [entry, entry.split('/').pop()];
  if (i % 10 === 0) progress(i, clips.length + 4, 'animations');
  if (exportGlb(`${c}.vnmclip_c`, `clip_${name}`, ['--gltf_export_animations', '--gltf_keep_all_keyframes'])) ok++;
}
log(`${ok}/${clips.length} animations exported`);

// Corps des agents : les fichiers .vmdl des agents ne sont que des renvois ; on cherche le vrai maillage
const bodies = {};
for (const [side, re] of [['ct', /^(\S*ctm_sas\S*\.(?:vmdl_c|vmesh_c))\s.*size:(\d+)/gm], ['t', /^(\S*tm_phoenix\S*\.(?:vmdl_c|vmesh_c))\s.*size:(\d+)/gm]]) {
  const cands = [...list.matchAll(re)].map((x) => ({ file: x[1], size: Number(x[2]) })).filter((x) => x.size > 100_000 && !/sleeve|arms|glove|viewmodel/i.test(x.file)).sort((a, b) => b.size - a.size);
  fs.writeFileSync(path.join(out, `body_${side}_candidates.txt`), cands.map((x) => `${x.file} ${x.size}`).join('\n'));
  if (cands[0] && exportGlb(cands[0].file, `body_${side}`, ['--gltf_export_animations'])) bodies[side] = cands[0].file;
}
log(Object.keys(bodies).length ? `agent bodies: ${Object.entries(bodies).map(([k, v]) => `${k}=${v}`).join(', ')}` : 'no agent body mesh found: the 3D view will use a mannequin on the real skeleton');

log('building the animation pack…');
const r = spawnSync(process.execPath, ['--max-old-space-size=4096', path.join(root, 'scripts/build-anims.mjs'), out], { stdio: 'inherit' });
if (r.status === 0) { progress(1, 1, 'done'); log('done: player models and animations updated. Rebuild the app (npm run build) when running from the source folder.'); }
process.exit(r.status ?? 1);
