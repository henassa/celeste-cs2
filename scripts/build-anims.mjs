// Prépare le paquet d'animations des joueurs pour la vue 3D, à partir des exports Source 2 Viewer :
//   <dossier>/skeleton.glb, clip_<nom>.glb (une animation chacun), body_ct.glb / body_t.glb (facultatifs).
// Sortie : public/anim/players.json.gz (clips au format three.js, sans déplacement du personnage :
// la position vient de la démo) + public/anim/skeleton.glb, body_ct.glb, body_t.glb.
// Usage : node scripts/build-anims.mjs <dossier>

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.ProgressEvent ??= class extends Event { constructor(t, o = {}) { super(t); Object.assign(this, o); } };
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const src = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!src) { console.error('usage: node scripts/build-anims.mjs <exports dir>'); process.exit(1); }
const outArg = process.argv.find((a) => a.startsWith('--out='));
const outDir = outArg ? outArg.slice(6) : path.join(path.resolve(process.env.SCRIMVIEW_ASSETS ?? path.join(here, '../public')), 'anim');
fs.mkdirSync(outDir, { recursive: true });

const load = (file) => new Promise((res, rej) => {
  const b = fs.readFileSync(file);
  new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), '', res, rej);
});

/** Nom des os d'un export (os de la peau si présente, sinon tous les nœuds nommés). */
function boneNames(gltf) {
  const names = new Set();
  gltf.scene.traverse((o) => { if (o.isBone || (o.type === 'Object3D' && o.name && o.children.length + 1)) names.add(o.name); });
  return names;
}

/**
 * Retire l'avancée du personnage contenue dans l'animation (la position vient de la démo) :
 * sur les pistes de position, la dérive linéaire entre la première et la dernière image est soustraite.
 * Le balancement (montée / descente pendant la foulée) reste.
 */
function removeRootMotion(clip, rootNames) {
  for (const t of clip.tracks) {
    if (!(t instanceof THREE.VectorKeyframeTrack) || !t.name.endsWith('.position')) continue;
    const bone = t.name.slice(0, -'.position'.length);
    if (!rootNames.has(bone)) continue;
    const v = t.values, n = t.times.length;
    if (n < 2) continue;
    const T = t.times[n - 1] - t.times[0] || 1;
    const d = [v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 1] - v[1], v[(n - 1) * 3 + 2] - v[2]];
    for (let i = 0; i < n; i++) { const k = (t.times[i] - t.times[0]) / T; for (let j = 0; j < 3; j++) v[i * 3 + j] -= d[j] * k; }
  }
}

const files = fs.readdirSync(src);
const skelFile = files.includes('skeleton.glb') ? 'skeleton.glb' : files.find((f) => f.startsWith('clip_'));
if (!skelFile) { console.error('no skeleton.glb nor clip_*.glb in', src); process.exit(1); }
const skel = await load(path.join(src, skelFile));
const bones = boneNames(skel);
// Racines : os sans parent qui soit un os (bassin, racine du squelette)
const roots = new Set();
skel.scene.traverse((o) => { if (bones.has(o.name) && !(o.parent && bones.has(o.parent.name))) roots.add(o.name); });
// Les os juste sous la racine (souvent « pelvis ») portent aussi l'avancée
skel.scene.traverse((o) => { if (o.parent && roots.has(o.parent.name) && bones.has(o.name)) roots.add(o.name); });

const clips = [];
for (const f of files.filter((x) => x.startsWith('clip_') && x.endsWith('.glb')).sort()) {
  try {
    const g = await load(path.join(src, f));
    const clip = g.animations[0];
    if (!clip) { console.log(`  ${f}: no animation`); continue; }
    clip.name = f.slice(5, -4);
    // On ne garde que les pistes des os du squelette commun
    clip.tracks = clip.tracks.filter((t) => bones.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName));
    removeRootMotion(clip, roots);
    clip.optimize();
    clips.push(THREE.AnimationClip.toJSON(clip));
  } catch (e) { console.log(`  ${f}: unreadable (${e?.message ?? e})`); }
}
if (!clips.length) { console.error('no animation could be read'); process.exit(1); }

// Échelle de l'export : hauteur de la tête au repos (mètres -> unités du jeu si besoin)
skel.scene.updateMatrixWorld(true);
let top = 0;
skel.scene.traverse((o) => { if (bones.has(o.name)) top = Math.max(top, new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).y); });
const unitScale = top > 0 && top < 5 ? 1 / 0.0254 : 1;

fs.copyFileSync(path.join(src, skelFile), path.join(outDir, 'skeleton.glb'));
const bodies = [];
for (const side of ['ct', 't']) {
  const f = path.join(src, `body_${side}.glb`);
  if (fs.existsSync(f)) { fs.copyFileSync(f, path.join(outDir, `body_${side}.glb`)); bodies.push(side); }
}
const pack = { version: 1, unitScale, roots: [...roots], bones: [...bones], bodies, clips };
fs.writeFileSync(path.join(outDir, 'players.json.gz'), zlib.gzipSync(JSON.stringify(pack), { level: 9 }));
console.log(`animation pack: ${clips.length} clips, ${bones.size} bones, unit scale ${unitScale.toFixed(2)}, bodies: ${bodies.join(', ') || 'none (mannequin)'}`);
