// Propagation des fumées et des feux dans la géométrie de Mirage (modèle livré dans public/geo).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decodeGeometry } from '../src/three/map-scene';
import { fireSpread, smokeVolume, TriIndex } from '../src/three/volumes';

describe('fumées et feux', () => {
  const raw = zlib.gunzipSync(fs.readFileSync('public/geo/de_mirage.bin.gz'));
  const g = decodeGeometry(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
  const index = new TriIndex(g.pos, g.floor, g.wall);
  it('une fumée remplit un volume borné par les murs', () => {
    const t0 = performance.now();
    // Fumée « jungle » de Mirage (A site) : point au sol
    const v = smokeVolume(index, -1200, -1180, -167);
    const ms = performance.now() - t0;
    expect(v.length).toBeGreaterThan(3000);
    expect(v.length).toBeLessThanOrEqual(7000);
    const ext = (k: 'x' | 'y' | 'z') => Math.max(...v.map((p) => p[k])) - Math.min(...v.map((p) => p[k]));
    expect(ext('x')).toBeLessThan(720);
    expect(ext('z')).toBeLessThan(260);
    expect(v.filter((p) => p.surface).length).toBeLessThan(v.length);
    expect(ms).toBeLessThan(3000);
  });
  it('un feu s\'étale sur le sol', () => {
    const f = fireSpread(index, -300, -1600, -168);
    expect(f.length).toBeGreaterThan(50);
    for (const c of f) expect(Math.abs(c.z - (-168))).toBeLessThan(150);
  });
});

import { raycast } from '../src/three/volumes';
describe('tirs', () => {
  it('un rayon vers le bas touche le sol', () => {
    const raw = zlib.gunzipSync(fs.readFileSync('public/geo/de_mirage.bin.gz'));
    const g = decodeGeometry(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
    const index = new TriIndex(g.pos, g.floor, g.wall);
    const d = raycast(index, -300, -1600, 0, 0, 0, -1, 1000);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(300);
  });
});
