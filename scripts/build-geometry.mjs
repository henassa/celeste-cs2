// Prépare les modèles 3D des cartes. Deux sources possibles, par carte :
//   - <map>.gltf / <map>.glb (ou <map>/*.gltf) : export de la carte par Source 2 Viewer depuis ton
//     installation de CS2 (géométrie visible réelle, accessoires, couleur moyenne de chaque matériau).
//     Voir scripts/extract-maps.mjs. C'est la source fidèle.
//   - <map>.mesh : maillage de collision d'awpy-data (sans couleurs, déjà décimé par awpy).
// Étapes : orientation et échelle détectées (le modèle doit tomber sur le radar), découpe aux zones
// jouables du radar, soudure, simplification qui préserve la forme (meshoptimizer), séparation
// sols / murs, quantification 16 bits, gzip. Sortie : public/geo/<map>.bin.gz
//   'GEO3' | nVerts u32 | nFloor u32 | nWall u32 | flags u32 (1 = couleurs) | min xyz f32 | max xyz f32
//   positions nVerts × 3 × u16 | [couleurs nVerts × 3 × u8, complété à 4 octets] | indices sols puis murs, u32
// Usage : node --max-old-space-size=8192 scripts/build-geometry.mjs <dossier sources> <dossier radars .png> [cartes...]
//   options : --tris=650000 (budget), --error=0.0003 (erreur relative tolérée),
//             --full (décors autour de la carte, feuillages et grillages, 1,5 M triangles)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PNG } from 'pngjs';
import { MeshoptSimplifier } from 'meshoptimizer';
import { loadGltfTriangles } from './lib/gltf.mjs';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
// Calibrations livrées + maps ajoutées par l'utilisateur (workshop), dans le dossier des fichiers servis
const assets = path.resolve(process.env.SCRIMVIEW_ASSETS ?? path.join(here, '../public'));
const userCal = path.join(assets, 'maps', 'maps.json');
const maps = { ...JSON.parse(fs.readFileSync(path.join(here, '../src/maps/maps.json'), 'utf8')), ...(fs.existsSync(userCal) ? JSON.parse(fs.readFileSync(userCal, 'utf8')) : {}) };
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
// --cle=valeur, ou --drapeau seul (vaut 'true')
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || 'true']; }));
const [src, radars, ...only] = args;
if (!src || !radars) { console.error('usage: node scripts/build-geometry.mjs <sources dir> <radar png dir> [maps] [--tris=N] [--error=E]'); process.exit(1); }
const outDir = path.join(assets, 'geo');
fs.mkdirSync(outDir, { recursive: true });

// Budget de triangles : plus élevé pour la géométrie visible (plus détaillée) que pour la collision
// --full : carte complète (décors autour des zones jouables, feuillages, grillages), plus de triangles
const COMPLETE = opt.complete === 'true' || opt.complete === '';
// --complete : absolument tous les polygones (aucune simplification, aucun tri par zones jouables ;
// seul le ciel 3D, une maquette réduite placée loin de la carte, est retiré)
const FULL = COMPLETE || opt.full === 'true' || opt.full === '';
// Standard : toutes les pièces visibles des zones jouables et leurs abords ; Full : tout le décor autour
const TRIS_VISUAL = Number(opt.tris ?? (COMPLETE ? Infinity : FULL ? 2_500_000 : 1_200_000)), TRIS_COLLISION = Number(opt.tris ?? 200_000);
/** Parties translucides (grillages, rambardes, feuillages, vitres) : budget à part, rarement atteint. */
const TRIS_ALPHA = COMPLETE ? Infinity : FULL ? 800_000 : 400_000;
// Monochrome par défaut (direction artistique) : les couleurs des matériaux seulement avec --colors
const KEEP_COLORS = opt.colors === 'true' || opt.colors === '';
const MAX_ERROR = Number(opt.error ?? (FULL ? 0.0001 : 0.0002)); // relative à la taille de la carte (~0,0003 ≈ 1,5 unité)
// Cartes jouées en hauteur : on retire la façade jusqu'au sol (Vertigo, sur le toit d'une tour)
const Z_MIN = { de_vertigo: 11000 };
// Triangles démesurés (plans de clip, ciel) : retirés
const MAX_EDGE = 1800;
await MeshoptSimplifier.ready;

/** Masque jouable (radar opaque), dilaté de `grow` pixels ; union des niveaux. */
function playableMask(name, grow = 6) {
  const mask = new Uint8Array(1024 * 1024);
  for (const f of [`${name}.png`, `${name}_lower.png`, `${name}_radar_psd.png`, `${name}_lower_radar_psd.png`]) {
    const file = path.join(radars, f);
    if (!fs.existsSync(file)) continue;
    const png = PNG.sync.read(fs.readFileSync(file));
    const k = png.width / 1024;
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) if (png.data[((Math.floor(y * k) * png.width) + Math.floor(x * k)) * 4 + 3] > 40) mask[y * 1024 + x] = 1;
  }
  let cur = mask;
  for (let g = 0; g < grow; g++) {
    const nxt = cur.slice();
    for (let y = 1; y < 1023; y++) for (let x = 1; x < 1023; x++) if (!cur[y * 1024 + x] && (cur[y * 1024 + x - 1] || cur[y * 1024 + x + 1] || cur[(y - 1) * 1024 + x] || cur[(y + 1) * 1024 + x])) nxt[y * 1024 + x] = 1;
    cur = nxt;
  }
  return cur;
}

function readAwmh(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'AWMH') throw new Error(`${file}: not AWMH`);
  const nv = b.readUInt32LE(8), nt = b.readUInt32LE(12);
  const verts = new Float32Array(b.buffer.slice(b.byteOffset + 16, b.byteOffset + 16 + nv * 12));
  const tris = new Uint32Array(b.buffer.slice(b.byteOffset + 16 + nv * 12, b.byteOffset + 16 + nv * 12 + nt * 12));
  const pos = new Float32Array(nt * 9);
  for (let i = 0; i < tris.length; i++) pos.set(verts.subarray(tris[i] * 3, tris[i] * 3 + 3), i * 3);
  return { pos, col: null };
}

/**
 * Repère et échelle de l'export. L'axe vertical se déduit de la géométrie (les sols, terrains et toits
 * ouverts vers le haut dominent en surface) ; les deux axes horizontaux et l'échelle se choisissent en
 * gardant la variante qui tombe le mieux sur les zones jouables du radar (repère direct uniquement :
 * pas de carte en miroir ni à l'envers).
 */
function orient(pos, cal, mask) {
  const nt = pos.length / 9;
  const abs = [0, 0, 0], signed = [0, 0, 0];
  const stepT = Math.max(1, Math.floor(nt / 400000));
  for (let t = 0; t < nt; t += stepT) {
    const o = t * 9;
    const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
    const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; // longueur = 2 × aire
    for (let j = 0; j < 3; j++) { abs[j] += Math.abs(n[j]); signed[j] += n[j]; }
  }
  const up = abs.indexOf(Math.max(...abs));
  const upSign = signed[up] >= 0 ? 1 : -1;
  const [a, b] = [0, 1, 2].filter((j) => j !== up);
  // Candidats : (X, Y) = (±a, ±b) ou (±b, ±a), Z = upSign × up ; on ne garde que les repères directs
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const axisRow = (j, sg) => [0, 1, 2].map((k) => (k === j ? sg : 0));
  const cands = [];
  for (const [ax, ay] of [[a, b], [b, a]]) for (const sx of [1, -1]) for (const sy of [1, -1]) {
    const m = [axisRow(ax, sx), axisRow(ay, sy), axisRow(up, upSign)];
    if (det(m) > 0) cands.push(m);
  }
  const n = pos.length / 3, step = Math.max(1, Math.floor(n / 40000));
  // Cases jouables du radar (grille 64×64) : on note une variante sur deux critères à la fois,
  // la part des sommets au-dessus du jouable ET la part du jouable recouverte par le modèle.
  // (Avec le premier seul, un modèle réduit à un point posé sur une zone jouable gagnait.)
  const G = 64, playable = new Uint8Array(G * G);
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) if (mask[y * 1024 + x]) playable[(y >> 4) * G + (x >> 4)] = 1;
  const nPlayable = playable.reduce((a, b) => a + b, 0) || 1;
  // Échelle ajustée : étendue du jouable / étendue du modèle (percentiles, insensible aux débords)
  const fitted = (m) => {
    const xs = [], ys = [];
    for (let i = 0; i < n; i += step) { xs.push(m[0][0] * pos[i * 3] + m[0][1] * pos[i * 3 + 1] + m[0][2] * pos[i * 3 + 2]); ys.push(m[1][0] * pos[i * 3] + m[1][1] * pos[i * 3 + 1] + m[1][2] * pos[i * 3 + 2]); }
    const span = (a) => { a.sort((p, q) => p - q); return a[Math.floor(a.length * 0.98)] - a[Math.floor(a.length * 0.02)]; };
    let minX = 1024, maxX = 0, minY = 1024, maxY = 0;
    for (let y = 0; y < 1024; y += 4) for (let x = 0; x < 1024; x += 4) if (mask[y * 1024 + x]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const world = Math.max(maxX - minX, maxY - minY) * cal.scale, model = Math.max(span(xs), span(ys));
    return model > 0 ? world / model : 1;
  };
  let best = null;
  for (const m of cands) {
    const scales = [1, 1 / 0.0254, 0.0254, 100, 0.01];
    const f = fitted(m);
    // L'échelle ajustée est arrondie à une échelle connue si elle en est proche
    const near = scales.find((x) => Math.abs(Math.log(f / x)) < 0.15);
    if (!near) scales.push(f);
    for (const s of scales) {
      let hit = 0, tot = 0;
      const covered = new Uint8Array(G * G);
      for (let i = 0; i < n; i += step) {
        const x = (m[0][0] * pos[i * 3] + m[0][1] * pos[i * 3 + 1] + m[0][2] * pos[i * 3 + 2]) * s;
        const y = (m[1][0] * pos[i * 3] + m[1][1] * pos[i * 3 + 1] + m[1][2] * pos[i * 3 + 2]) * s;
        const px = Math.floor((x - cal.posX) / cal.scale), py = Math.floor((cal.posY - y) / cal.scale);
        tot++;
        if (px >= 0 && py >= 0 && px < 1024 && py < 1024 && mask[py * 1024 + px]) { hit++; covered[(py >> 4) * G + (px >> 4)] = 1; }
      }
      const inside = hit / tot, coverage = covered.reduce((a, b) => a + b, 0) / nPlayable;
      const score = inside * coverage;
      if (!best || score > best.score) best = { m, s, score, inside, coverage };
    }
  }
  const { m, s: sc } = best;
  // Décalage éventuel (export avec une origine déplacée) : recherche sur ±128 px de radar
  const sample = [];
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 6000))) sample.push((m[0][0] * pos[i * 3] + m[0][1] * pos[i * 3 + 1] + m[0][2] * pos[i * 3 + 2]) * sc, (m[1][0] * pos[i * 3] + m[1][1] * pos[i * 3 + 1] + m[1][2] * pos[i * 3 + 2]) * sc);
  const scoreAt = (dx, dy) => {
    let hit = 0;
    const covered = new Uint8Array(G * G);
    for (let k = 0; k < sample.length; k += 2) {
      const px = Math.floor((sample[k] - cal.posX) / cal.scale) + dx, py = Math.floor((cal.posY - sample[k + 1]) / cal.scale) + dy;
      if (px >= 0 && py >= 0 && px < 1024 && py < 1024 && mask[py * 1024 + px]) { hit++; covered[(py >> 4) * G + (px >> 4)] = 1; }
    }
    return (hit / (sample.length / 2)) * (covered.reduce((a, b) => a + b, 0) / nPlayable);
  };
  let off = [0, 0], offScore = scoreAt(0, 0);
  for (let dy = -128; dy <= 128; dy += 8) for (let dx = -128; dx <= 128; dx += 8) { const v = scoreAt(dx, dy); if (v > offScore * 1.4) { offScore = v; off = [dx, dy]; } }
  const tx = off[0] * cal.scale, ty = -off[1] * cal.scale;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    for (let r = 0; r < 3; r++) pos[i * 3 + r] = (m[r][0] * x + m[r][1] * y + m[r][2] * z) * sc;
    pos[i * 3] += tx; pos[i * 3 + 1] += ty;
  }
  if (off[0] || off[1]) console.log(`  shifted by (${tx.toFixed(0)}, ${ty.toFixed(0)}) units to match the radar`);
  const axes = 'xyz';
  const label = m.map((row) => { const j = row.findIndex((v) => v !== 0); return `${row[j] < 0 ? '-' : ''}${axes[j]}`; }).join(', ');
  return { name: `(X, Y, Z) = (${label})`, s: sc, score: best.inside, coverage: best.coverage };
}

/** Soudure des sommets identiques (même position à 0,25 unité près, même couleur) -> maillage indexé. */
function weld(pos, col) {
  const map = new Map(), idx = new Uint32Array(pos.length / 3);
  const vbuf = new Float32Array(pos.length), cbuf = col ? new Uint8Array(col.length) : null;
  let nv = 0;
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const k = `${Math.round(x * 4)},${Math.round(y * 4)},${Math.round(z * 4)}${col ? `,${col[i * 3]},${col[i * 3 + 1]},${col[i * 3 + 2]}` : ''}`;
    let v = map.get(k);
    if (v === undefined) { v = nv++; map.set(k, v); vbuf[v * 3] = x; vbuf[v * 3 + 1] = y; vbuf[v * 3 + 2] = z; if (cbuf) { cbuf[v * 3] = col[i * 3]; cbuf[v * 3 + 1] = col[i * 3 + 1]; cbuf[v * 3 + 2] = col[i * 3 + 2]; } }
    idx[i] = v;
  }
  // Triangles dégénérés retirés
  const t = new Uint32Array(idx.length);
  let nt = 0;
  for (let i = 0; i < idx.length; i += 3) if (idx[i] !== idx[i + 1] && idx[i + 1] !== idx[i + 2] && idx[i] !== idx[i + 2]) { t[nt++] = idx[i]; t[nt++] = idx[i + 1]; t[nt++] = idx[i + 2]; }
  return { verts: vbuf.slice(0, nv * 3), colors: cbuf ? cbuf.slice(0, nv * 3) : null, tris: t.slice(0, nt) };
}

function findSource(name) {
  const c = [`${name}.gltf`, `${name}.glb`, `${name}.mesh`].map((f) => path.join(src, f)).find((f) => fs.existsSync(f));
  if (c) return c;
  const dir = path.join(src, name);
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, String(f))).filter((f) => /\.(gltf|glb)$/i.test(f) && !/[\\/]_placed[\\/]/.test(f));
    if (files.length) return files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
  }
  return null;
}

const names = only.length ? only : Object.keys(maps).filter((m) => findSource(m));
for (const name of names) {
  const cal = maps[name];
  const file = findSource(name);
  if (!cal || !file) { console.log(name, 'skipped (no source or calibration)'); continue; }
  const visual = !file.endsWith('.mesh');
  // Géométrie visible : marge plus large (murs extérieurs, toits qui débordent du radar)
  // Marge autour des zones jouables : façades, toits, rambardes qui débordent du radar (40 px ≈ 200 unités)
  const mask = playableMask(name, visual ? (FULL ? 140 : 40) : 6);
  // Calage : sur les zones jouables seules (le masque élargi du mode complet le rendrait flou)
  const fitMask = FULL ? playableMask(name, 6) : mask;
  if (!mask.some((v) => v)) { console.log(name, 'skipped: no radar png in', radars); continue; }
  let { pos, col, alpha: alphaFlags } = visual ? loadGltfTriangles(file, console.log, { keepAlpha: true }) : { ...readAwmh(file), alpha: null };
  if (!KEEP_COLORS) col = null;
  if (visual) {
    const o = orient(pos, cal, fitMask);
    console.log(`  ${name}: frame ${o.name}, scale ${o.s.toFixed(3)}, ${(o.score * 100).toFixed(0)}% of the vertices over playable areas, ${(o.coverage * 100).toFixed(0)}% of the playable areas covered`);
    if (o.score < 0.5 || o.coverage < 0.4) console.log(`  ${name}: WARNING the model does not line up with the radar well, check the map and radar files`);
  }
  // Découpe : au-dessus d'une zone jouable, pas de façade sous Vertigo, pas de plans géants
  const nt = pos.length / 9;
  const keepPos = new Float32Array(pos.length), keepCol = col ? new Uint8Array(col.length) : null;
  let kept = 0;
  // Parties translucides mises de côté : ni simplifiées avec le reste, ni comptées comme sols ou murs
  const nAlpha = alphaFlags ? alphaFlags.reduce((a, b) => a + b, 0) : 0;
  const aPos = new Float32Array(nAlpha * 9), aCol = col ? new Uint8Array(nAlpha * 9) : null;
  let aKept = 0;
  const keepTri = (t, o) => {
    if (alphaFlags && alphaFlags[t]) { aPos.set(pos.subarray(o, o + 9), aKept * 9); if (aCol) aCol.set(col.subarray(o, o + 9), aKept * 9); aKept++; return; }
    keepPos.set(pos.subarray(o, o + 9), kept * 9);
    if (col) keepCol.set(col.subarray(o, o + 9), kept * 9);
    kept++;
  };
  for (let t = 0; t < nt; t++) {
    const o = t * 9;
    // Gardé si son centre ou un de ses sommets est au-dessus d'une zone jouable (les grands triangles
    // de sol dont le centre tombe hors du radar ne laissent plus de trous)
    if (COMPLETE && visual) {
      // Rectangle du radar élargi d'une demi-carte de chaque côté
      const ext = 1024 * cal.scale, x0 = cal.posX - ext / 2, x1 = cal.posX + ext * 1.5, y1 = cal.posY + ext / 2, y0 = cal.posY - ext * 1.5;
      const cx = (pos[o] + pos[o + 3] + pos[o + 6]) / 3, cy = (pos[o + 1] + pos[o + 4] + pos[o + 7]) / 3;
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
      if (Z_MIN[name] !== undefined && (pos[o + 2] < Z_MIN[name] || pos[o + 5] < Z_MIN[name] || pos[o + 8] < Z_MIN[name])) continue;
      keepTri(t, o);
      continue;
    }
    const inside = (x, y) => { const px = Math.floor((x - cal.posX) / cal.scale), py = Math.floor((cal.posY - y) / cal.scale); return px >= 0 && py >= 0 && px < 1024 && py < 1024 && mask[py * 1024 + px] === 1; };
    const cx = (pos[o] + pos[o + 3] + pos[o + 6]) / 3, cy = (pos[o + 1] + pos[o + 4] + pos[o + 7]) / 3;
    if (!(inside(cx, cy) || (visual && (inside(pos[o], pos[o + 1]) || inside(pos[o + 3], pos[o + 4]) || inside(pos[o + 6], pos[o + 7]))))) continue;
    if (Z_MIN[name] !== undefined && (pos[o + 2] < Z_MIN[name] || pos[o + 5] < Z_MIN[name] || pos[o + 8] < Z_MIN[name])) continue;
    // Plans géants (clip, ciel) : seulement pour la collision ; la géométrie visible a de vrais grands sols
    if (!visual) {
      let long = false;
      for (let j = 0; j < 3; j++) { const a = o + j * 3, b = o + ((j + 1) % 3) * 3; if (Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]) > MAX_EDGE) long = true; }
      if (long) continue;
    }
    keepTri(t, o);
  }
  const before = kept;
  let { verts, colors, tris } = weld(keepPos.subarray(0, kept * 9), keepCol ? keepCol.subarray(0, kept * 9) : null);
  const aw = aKept ? weld(aPos.subarray(0, aKept * 9), aCol ? aCol.subarray(0, aKept * 9) : null) : null;
  if (aw && aw.tris.length / 3 > TRIS_ALPHA) {
    const [out] = MeshoptSimplifier.simplify(aw.tris, aw.verts, 3, TRIS_ALPHA * 3, MAX_ERROR * 2, []);
    aw.tris = Uint32Array.from(out);
  }
  pos = col = null;
  const target = visual ? TRIS_VISUAL : TRIS_COLLISION;
  if (!(COMPLETE && visual) && tris.length / 3 > target) {
    // Bords verrouillés : les pièces ouvertes (murs, terrain) ne se rétractent pas en pointes ni en trous
    let [out, err] = MeshoptSimplifier.simplify(tris, verts, 3, target * 3, MAX_ERROR, ['LockBorder']);
    if (out.length > target * 3 * 1.6) [out, err] = MeshoptSimplifier.simplify(tris, verts, 3, target * 3, MAX_ERROR, []);
    tris = Uint32Array.from(out);
    console.log(`  ${name}: simplified, error ${(err * MeshoptSimplifier.getScale(verts, 3)).toFixed(1)} units`);
  }
  // Sols (normale vers le haut) / murs
  const floor = [], wall = [];
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i] * 3, b = tris[i + 1] * 3, c = tris[i + 2] * 3;
    const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
    const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    (Math.abs(nz / len) > 0.7 ? floor : wall).push(tris[i], tris[i + 1], tris[i + 2]);
  }
  // Sommets inutilisés retirés
  const remap = new Int32Array(verts.length / 3).fill(-1), used = [];
  for (const t of [floor, wall]) for (let i = 0; i < t.length; i++) { let r = remap[t[i]]; if (r < 0) { r = remap[t[i]] = used.length; used.push(t[i]); } t[i] = r; }
  // Sommets des parties translucides, à la suite
  const alphaTris = [];
  const aRemap = aw ? new Int32Array(aw.verts.length / 3).fill(-1) : null, aUsed = [];
  if (aw) for (let i = 0; i < aw.tris.length; i++) { let r = aRemap[aw.tris[i]]; if (r < 0) { r = aRemap[aw.tris[i]] = used.length + aUsed.length; aUsed.push(aw.tris[i]); } alphaTris.push(r); }
  const nv = used.length + aUsed.length;
  const v2 = new Float32Array(nv * 3), c2 = colors ? new Uint8Array(nv * 3) : null;
  used.forEach((v, i) => { v2.set(verts.subarray(v * 3, v * 3 + 3), i * 3); if (c2) c2.set(colors.subarray(v * 3, v * 3 + 3), i * 3); });
  aUsed.forEach((v, k) => { const i = used.length + k; v2.set(aw.verts.subarray(v * 3, v * 3 + 3), i * 3); if (c2 && aw.colors) c2.set(aw.colors.subarray(v * 3, v * 3 + 3), i * 3); });
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) for (let j = 0; j < 3; j++) { min[j] = Math.min(min[j], v2[i * 3 + j]); max[j] = Math.max(max[j], v2[i * 3 + j]); }
  // GEO4 : comme GEO3, plus le nombre de triangles translucides (rangés après les sols et les murs)
  const head = Buffer.alloc(48);
  head.write('GEO4', 0, 'ascii');
  head.writeUInt32LE(nv, 4); head.writeUInt32LE(floor.length / 3, 8); head.writeUInt32LE(wall.length / 3, 12); head.writeUInt32LE(alphaTris.length / 3, 16); head.writeUInt32LE(c2 ? 1 : 0, 20);
  for (let j = 0; j < 3; j++) { head.writeFloatLE(min[j], 24 + j * 4); head.writeFloatLE(max[j], 36 + j * 4); }
  const q = new Uint16Array(nv * 3);
  for (let i = 0; i < nv; i++) for (let j = 0; j < 3; j++) q[i * 3 + j] = Math.round(((v2[i * 3 + j] - min[j]) / Math.max(1e-6, max[j] - min[j])) * 65535);
  const parts = [head, Buffer.from(q.buffer)];
  if (c2) { const pad = (4 - ((nv * 3) % 4)) % 4; parts.push(Buffer.from(c2.buffer), Buffer.alloc(pad)); }
  const idx = new Uint32Array(floor.length + wall.length + alphaTris.length);
  idx.set(floor, 0); idx.set(wall, floor.length); idx.set(alphaTris, floor.length + wall.length);
  parts.push(Buffer.from(idx.buffer));
  const gz = zlib.gzipSync(Buffer.concat(parts), { level: 9 });
  fs.writeFileSync(path.join(outDir, `${name}.bin.gz`), gz);
  console.log(name, `${visual ? 'visual' : 'collision'}: ${before} → ${(floor.length + wall.length) / 3} tris (${floor.length / 3} floor${alphaTris.length ? `, ${alphaTris.length / 3} see-through` : ''}), ${nv} verts${c2 ? ', colors' : ''}, ${(gz.length / 1024).toFixed(0)} KB`);
}
