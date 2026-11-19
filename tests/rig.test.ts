// Paquet d'animations : construction depuis des exports glTF (synthétiques ici), choix des clips, rig animé.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildRig, chooseClip, makeAnimatedFigure, animateFigure, weaponClass, type RigPack } from '../src/three/rig';

/** GLB minimal : nœuds (squelette) et une animation de rotation sur un os, avec avancée du bassin. */
function glb(withAnim: boolean): Buffer {
  const times = new Float32Array([0, 1]);
  const rot = new Float32Array([0, 0, 0, 1, 0, 0, Math.sin(0.4), Math.cos(0.4)]);
  const pos = new Float32Array([0, 40, 0, 50, 42, 0]); // le bassin avance de 50 en 1 s
  const bin = Buffer.concat([Buffer.from(times.buffer), Buffer.from(rot.buffer), Buffer.from(pos.buffer)]);
  const json: Record<string, unknown> = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'root', children: [1] }, { name: 'pelvis', translation: [0, 40, 0], children: [2, 3] }, { name: 'spine_0', translation: [0, 10, 0], children: [4] }, { name: 'thigh_l', translation: [0, -2, 4], children: [5] }, { name: 'head_0', translation: [0, 20, 0] }, { name: 'ankle_l', translation: [0, -36, 0], children: [6] }, { name: 'ball_l', translation: [6, -3, 0] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }, { buffer: 0, byteOffset: 8, byteLength: 32 }, { buffer: 0, byteOffset: 40, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] }, { bufferView: 1, componentType: 5126, count: 2, type: 'VEC4' }, { bufferView: 2, componentType: 5126, count: 2, type: 'VEC3' }],
  };
  if (withAnim) json.animations = [{ name: 'x', channels: [{ sampler: 0, target: { node: 2, path: 'rotation' } }, { sampler: 1, target: { node: 1, path: 'translation' } }], samplers: [{ input: 0, output: 1 }, { input: 0, output: 2 }] }];
  const js = Buffer.from(JSON.stringify(json)); const jp = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const bp = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jp.length + 8 + bp.length, 8);
  const ch = (len: number, type: string) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.write(type, 4, 'ascii'); return b; };
  return Buffer.concat([head, ch(jp.length, 'JSON'), jp, ch(bp.length, 'BIN\0'), bp]);
}

describe('animations des joueurs', () => {
  it('construit le paquet, retire l\'avancée, anime un mannequin', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anims-'));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-'));
    fs.writeFileSync(path.join(dir, 'skeleton.glb'), glb(false));
    for (const n of ['idle_rifle', 'run_n_rifle', 'walk_s_rifle', 'crouch_e_rifle', 'idle_pistol']) fs.writeFileSync(path.join(dir, `clip_${n}.glb`), glb(true));
    const log = execFileSync(process.execPath, ['scripts/build-anims.mjs', dir, `--out=${out}`], { encoding: 'utf8' });
    expect(log).toMatch(/5 clips/);
    const pack = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(out, 'players.json.gz'))).toString()) as RigPack;
    const run = pack.clips.find((c) => (c as { name: string }).name === 'run_n_rifle') as { tracks: { name: string; values: number[] }[] };
    const p = run.tracks.find((t) => t.name === 'pelvis.position')!;
    expect(Math.abs(p.values[p.values.length - 3] - p.values[0])).toBeLessThan(0.01); // plus d'avancée
    expect(p.values[1]).toBeCloseTo(40, 3);                                                   // hauteur de départ conservée
    globalThis.ProgressEvent ??= class extends Event {} as unknown as typeof ProgressEvent;
    const b = fs.readFileSync(path.join(out, 'skeleton.glb'));
    const skel = await new Promise<THREE.Object3D>((res, rej) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), '', (g) => res(g.scene), rej));
    const rig = buildRig(pack, skel);
    expect(rig.yawOffset).toBeCloseTo(0, 3); // orteils vers +X
    expect(chooseClip(rig, { speed: 0, pitch: 0, duck: false, busy: false, time: 0 }, 'AK-47').name).toBe('idle_rifle');
    expect(chooseClip(rig, { speed: 240, pitch: 0, duck: false, busy: false, time: 0, moveYaw: 90, yaw: 90 }, 'AK-47').name).toBe('run_n_rifle');
    expect(chooseClip(rig, { speed: 100, pitch: 0, duck: false, busy: false, time: 0, moveYaw: 270, yaw: 90 }, 'AK-47').name).toBe('walk_s_rifle');
    expect(chooseClip(rig, { speed: 80, pitch: 0, duck: true, busy: false, time: 0, moveYaw: 0, yaw: 90 }, 'AK-47').name).toBe('crouch_e_rifle');
    expect(weaponClass('Glock-18')).toBe('pistol');
    expect(weaponClass('knife_karambit')).toBe('knife');
    const f = makeAnimatedFigure(rig, true);
    animateFigure(rig, f, { name: 'run_n_rifle', speed: 1 }, 'AK-47', 0.5);
    let spine: THREE.Object3D | null = null;
    f.model.traverse((o) => { if (o.name === 'spine_0') spine = o; });
    expect((spine as unknown as THREE.Object3D).quaternion.z).toBeGreaterThan(0.05); // l'os tourne
    let meshes = 0; f.model.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) meshes++; });
    expect(meshes).toBeGreaterThan(3); // mannequin posé sur les os
  });
});
