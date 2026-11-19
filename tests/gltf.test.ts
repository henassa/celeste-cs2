// Lecture d'un export glTF (Source 2 Viewer) : transformations, instances, couleurs, matériaux écartés.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
// @ts-expect-error module JS des scripts de build
import { loadGltfTriangles } from '../scripts/lib/gltf.mjs';

describe('import glTF des cartes', () => {
  it('applique les nœuds, garde la couleur des textures et écarte les outils', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gltf-'));
    const png = new PNG({ width: 4, height: 4 });
    for (let i = 0; i < 16; i++) png.data.set([200, 40, 20, 255], i * 4);
    fs.writeFileSync(path.join(dir, 'red.png'), PNG.sync.write(png));
    // Un triangle (3 sommets float) + indices
    const pos = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
    const idx = new Uint16Array([0, 1, 2, 0]);
    const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
    fs.writeFileSync(path.join(dir, 'm.bin'), bin);
    const gltf = {
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
      nodes: [{ children: [1, 2], translation: [100, 0, 0] }, { mesh: 0, scale: [2, 2, 2] }, { mesh: 1 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }, { primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 1 }] }],
      materials: [{ name: 'materials/de_test/wall.vmat', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }, { name: 'materials/tools/toolsclip.vmat' }],
      textures: [{ source: 0 }], images: [{ uri: 'red.png' }],
      buffers: [{ uri: 'm.bin', byteLength: bin.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }],
    };
    fs.writeFileSync(path.join(dir, 'map.gltf'), JSON.stringify(gltf));
    const out = loadGltfTriangles(path.join(dir, 'map.gltf'));
    expect(out.pos.length).toBe(9); // un seul triangle : celui de l'outil est écarté
    expect([...out.pos]).toEqual([100, 0, 0, 120, 0, 0, 100, 20, 0]); // échelle 2 puis translation 100
    expect(Array.from(out.col.slice(0, 3))).toEqual([200, 40, 20]);
    expect([...out.dropped.keys()]).toEqual(['materials/tools/toolsclip.vmat']);
    expect([...out.alpha]).toEqual([0]);
  });

  it('garde les grillages et feuillages (matériaux à transparence), marqués à part', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gltf-'));
    const pos = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
    const idx = new Uint16Array([0, 1, 2, 0]);
    const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
    fs.writeFileSync(path.join(dir, 'm.bin'), bin);
    const gltf = {
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1, 2] }],
      nodes: [{ mesh: 0 }, { mesh: 1 }, { mesh: 2 }],
      meshes: [0, 1, 2].map((m) => ({ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: m }] })),
      materials: [{ name: 'materials/de_test/wall.vmat' }, { name: 'materials/de_test/chainlink_fence.vmat', alphaMode: 'MASK' }, { name: 'materials/decals/stain_decal.vmat', alphaMode: 'BLEND' }],
      buffers: [{ uri: 'm.bin', byteLength: bin.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }],
    };
    fs.writeFileSync(path.join(dir, 'map.gltf'), JSON.stringify(gltf));
    const out = loadGltfTriangles(path.join(dir, 'map.gltf'));
    // Le mur et le grillage sont gardés (le grillage marqué translucide), le décalque est écarté
    expect(out.pos.length).toBe(18);
    expect([...out.alpha]).toEqual([0, 1]);
  });
});

import { decodeGeometry } from '../src/three/map-scene';
describe('format GEO4', () => {
  it('lit les triangles translucides après les sols et les murs', () => {
    const nv = 3;
    const head = Buffer.alloc(48);
    head.write('GEO4', 0, 'ascii'); head.writeUInt32LE(nv, 4); head.writeUInt32LE(1, 8); head.writeUInt32LE(0, 12); head.writeUInt32LE(1, 16); head.writeUInt32LE(0, 20);
    for (let j = 0; j < 3; j++) { head.writeFloatLE(0, 24 + j * 4); head.writeFloatLE(100, 36 + j * 4); }
    const q = Buffer.from(new Uint16Array([0, 0, 0, 65535, 0, 0, 0, 65535, 0]).buffer);
    const idx = Buffer.from(new Uint32Array([0, 1, 2, 2, 1, 0]).buffer);
    const buf = Buffer.concat([head, q, idx]);
    const g = decodeGeometry(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    expect([...g.floor]).toEqual([0, 1, 2]);
    expect(g.wall.length).toBe(0);
    expect([...g.alpha]).toEqual([2, 1, 0]);
    expect(g.pos[3]).toBeCloseTo(100);
  });
});

describe('format GEO3', () => {
  it('lit positions, couleurs (avec bourrage) et indices', () => {
    const nv = 3, head = Buffer.alloc(44);
    head.write('GEO3', 0, 'ascii'); head.writeUInt32LE(nv, 4); head.writeUInt32LE(1, 8); head.writeUInt32LE(0, 12); head.writeUInt32LE(1, 16);
    [0, 0, 0].forEach((v, j) => head.writeFloatLE(v, 20 + j * 4)); [10, 10, 10].forEach((v, j) => head.writeFloatLE(v, 32 + j * 4));
    const q = Buffer.from(new Uint16Array([0, 0, 0, 65535, 0, 0, 0, 65535, 65535]).buffer);
    const col = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]), pad = Buffer.alloc(3);
    const idx = Buffer.from(new Uint32Array([0, 1, 2]).buffer);
    const raw = Buffer.concat([head, q, col, pad, idx]);
    const g = decodeGeometry(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
    expect([...g.pos]).toEqual([0, 0, 0, 10, 0, 0, 0, 10, 10]);
    expect([...g.col!]).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    expect([...g.floor]).toEqual([0, 1, 2]);
  });
});
