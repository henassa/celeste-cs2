// Lecture d'un export glTF de Source 2 Viewer (.gltf + .bin + textures, ou .glb) : triangles en
// coordonnées monde (transformations des nœuds appliquées, instanciation EXT_mesh_gpu_instancing),
// avec la couleur moyenne de la texture de chaque matériau. Les matériaux d'outils (clip, nodraw,
// skybox, triggers), les cartes alpha (feuillages, grillages) et les décalques sont écartés.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PNG } from 'pngjs';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPED = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
export const DROP_MATERIAL = /tools|clip|nodraw|skybox|sky_|trigger|blocklight|blockbullets|invisible|occluder|decal|overlay|spray|shadow|caulk|hint|areaportal|playerclip|nav_/i;

function readGltf(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) === 'glTF') {
    let off = 12, json = null, bin = null;
    while (off < buf.length) {
      const len = buf.readUInt32LE(off), type = buf.toString('ascii', off + 4, off + 8);
      const chunk = buf.subarray(off + 8, off + 8 + len);
      if (type === 'JSON') json = JSON.parse(chunk.toString('utf8')); else if (type.startsWith('BIN')) bin = chunk;
      off += 8 + len;
    }
    return { json, buffers: [bin], dir: path.dirname(file) };
  }
  const json = JSON.parse(buf.toString('utf8'));
  const dir = path.dirname(file);
  const buffers = (json.buffers ?? []).map((b) => (b.uri?.startsWith('data:') ? Buffer.from(b.uri.split(',')[1], 'base64') : fs.readFileSync(path.join(dir, decodeURIComponent(b.uri)))));
  return { json, buffers, dir };
}

function accessor(g, i) {
  const a = g.json.accessors[i];
  const bv = g.json.bufferViews[a.bufferView];
  const buf = g.buffers[bv.buffer ?? 0];
  const n = COMPONENTS[a.type], T = TYPED[a.componentType];
  const stride = bv.byteStride || n * T.BYTES_PER_ELEMENT;
  const base = buf.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Float64Array(a.count * n);
  const dv = new DataView(buf.buffer);
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
    let v = dv[get](base + k * stride + c * T.BYTES_PER_ELEMENT, true);
    if (a.normalized) v /= a.componentType === 5121 ? 255 : a.componentType === 5123 ? 65535 : a.componentType === 5120 ? 127 : 32767;
    out[k * n + c] = v;
  }
  return out;
}

// --- Matrices 4×4 (ordre colonne, comme glTF) ---
const mul = (a, b) => { const o = new Float64Array(16); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  return Float64Array.from([
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ]);
}
/** Tableau typé extensible (des millions de triangles sans tableaux JS géants). */
class Grow {
  constructor(T) { this.T = T; this.a = new T(1 << 20); this.n = 0; }
  push3(x, y, z) { if (this.n + 3 > this.a.length) { const b = new this.T(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = x; this.a[this.n++] = y; this.a[this.n++] = z; }
  done() { return this.a.slice(0, this.n); }
}
const nodeMatrix = (n) => (n.matrix ? Float64Array.from(n.matrix) : trs(n.translation, n.rotation, n.scale));

/** Couleur moyenne (sRGB 0..255) d'une texture PNG, pixels opaques seulement. */
function meanColor(file) {
  try {
    const png = PNG.sync.read(fs.readFileSync(file));
    let r = 0, g = 0, b = 0, n = 0;
    const step = Math.max(1, Math.floor((png.width * png.height) / 20000));
    for (let i = 0; i < png.width * png.height; i += step) {
      const o = i * 4;
      if (png.data[o + 3] < 128) continue;
      r += png.data[o]; g += png.data[o + 1]; b += png.data[o + 2]; n++;
    }
    return n ? [r / n, g / n, b / n] : null;
  } catch { return null; }
}

/**
 * Triangles monde : { pos: Float64Array (x,y,z par sommet de triangle, non indexé), col: Uint8Array (r,g,b), dropped: Map }.
 * Coordonnées telles qu'exportées ; `orient` (dans build-geometry) les ramène au repère du jeu.
 */
export function loadGltfTriangles(file, log = () => {}, opts = {}) {
  const g = readGltf(file);
  const mats = g.json.materials ?? [];
  const textures = g.json.textures ?? [], images = g.json.images ?? [];
  const matColor = mats.map((m) => {
    const pbr = m.pbrMetallicRoughness ?? {};
    const f = pbr.baseColorFactor ?? [1, 1, 1, 1];
    let c = [200, 200, 200];
    const ti = pbr.baseColorTexture?.index;
    const img = ti !== undefined ? images[textures[ti]?.source] : null;
    if (img?.uri && !img.uri.startsWith('data:')) { const mc = meanColor(path.join(g.dir, decodeURIComponent(img.uri))); if (mc) c = mc; }
    return [c[0] * f[0], c[1] * f[1], c[2] * f[2]];
  });
  // Matériaux écartés : outils et décalques. Les parties à transparence (grillages, rambardes, feuillages :
  // MASK ; vitres : BLEND) sont gardées et marquées, le rendu les dessine translucides.
  const dropMat = mats.map((m) => DROP_MATERIAL.test(m.name ?? '') || (opts.keepAlpha === false && (m.alphaMode === 'MASK' || m.alphaMode === 'BLEND')));
  const alphaMat = mats.map((m) => m.alphaMode === 'MASK' || m.alphaMode === 'BLEND' || /glass|fence|grate|chainlink|foliage|leaf|leaves|bush|wire|railing/i.test(m.name ?? ''));
  const pos = new Grow(Float32Array), col = new Grow(Uint8Array), alpha = new Grow(Uint8Array);
  const dropped = new Map();
  const visit = (ni, parent) => {
    const node = g.json.nodes[ni];
    const world = mul(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      // Instances GPU (accessoires répétés)
      let instances = [world];
      const inst = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
      if (inst) {
        const t = inst.TRANSLATION !== undefined ? accessor(g, inst.TRANSLATION) : null, r = inst.ROTATION !== undefined ? accessor(g, inst.ROTATION) : null, s = inst.SCALE !== undefined ? accessor(g, inst.SCALE) : null;
        const n = (t ?? r ?? s).length / (t ? 3 : r ? 4 : 3);
        instances = Array.from({ length: n }, (_, k) => mul(world, trs(t ? [...t.subarray(k * 3, k * 3 + 3)] : undefined, r ? [...r.subarray(k * 4, k * 4 + 4)] : undefined, s ? [...s.subarray(k * 3, k * 3 + 3)] : undefined)));
      }
      for (const prim of g.json.meshes[node.mesh].primitives) {
        if ((prim.mode ?? 4) !== 4 || prim.attributes.POSITION === undefined) continue;
        const mi = prim.material ?? -1;
        if (mi >= 0 && dropMat[mi]) { const nm = mats[mi].name ?? `#${mi}`; dropped.set(nm, (dropped.get(nm) ?? 0) + 1); continue; }
        const p = accessor(g, prim.attributes.POSITION);
        const idx = prim.indices !== undefined ? accessor(g, prim.indices) : Float64Array.from({ length: p.length / 3 }, (_, i) => i);
        const c = mi >= 0 ? matColor[mi] : [200, 200, 200];
        const isAlpha = mi >= 0 && alphaMat[mi] ? 1 : 0;
        for (const m of instances) {
          for (let k = 0; k < idx.length; k += 3) alpha.push3(isAlpha, 0, 0); // un drapeau par triangle (3 cases : on garde push3)
          for (let k = 0; k < idx.length; k++) {
            const v = idx[k] * 3, x = p[v], y = p[v + 1], z = p[v + 2];
            pos.push3(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
            col.push3(Math.round(c[0]), Math.round(c[1]), Math.round(c[2]));
          }
        }
      }
    }
    for (const ch of node.children ?? []) visit(ch, world);
  };
  const scene = g.json.scenes?.[g.json.scene ?? 0];
  const identity = trs();
  for (const ni of scene?.nodes ?? g.json.nodes.map((_, i) => i)) visit(ni, identity);
  log(`  ${path.basename(file)}: ${pos.n / 9} triangles, ${mats.length} materials, dropped: ${[...dropped.keys()].slice(0, 8).join(', ')}${dropped.size > 8 ? '…' : ''}`);
  // Drapeau par triangle (push3 écrit 3 cases : on garde la première)
  const a3 = alpha.done(), flags = new Uint8Array(a3.length / 3);
  for (let t = 0; t < flags.length; t++) flags[t] = a3[t * 3];
  return { pos: pos.done(), col: col.done(), alpha: flags, dropped };
}

export const gzip = (b) => zlib.gzipSync(b, { level: 9 });
