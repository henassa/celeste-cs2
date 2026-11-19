// Propagation des fumées et des feux dans la géométrie réelle de la carte.
// Fumée : voxels de 10 unités remplis depuis le point d'éclatement (parcours au plus court, bloqué par
// les murs) jusqu'à un volume fixe, comme les fumées volumétriques de CS2 : dans un couloir elle
// s'étire, en espace ouvert elle s'arrondit. Feu : nappe qui s'étale sur les sols (monte une marche,
// descend les pentes), sur une surface fixe. Calculé une fois par grenade, puis mis en cache.

export interface Tri3 { ax: number; ay: number; az: number; bx: number; by: number; bz: number; cx: number; cy: number; cz: number; floor: boolean }

/** Index spatial (grille 128 u en XY) des triangles de la carte. */
export class TriIndex {
  private cells = new Map<string, number[]>();
  private pos: Float32Array;
  private floor: Uint32Array;
  private wall: Uint32Array;
  constructor(pos: Float32Array, floor: Uint32Array, wall: Uint32Array) {
    this.pos = pos; this.floor = floor; this.wall = wall;
    const add = (tris: Uint32Array, isFloor: boolean, base: number) => {
      for (let i = 0; i < tris.length; i += 3) {
        const a = tris[i] * 3, b = tris[i + 1] * 3, c = tris[i + 2] * 3;
        const x0 = Math.floor(Math.min(pos[a], pos[b], pos[c]) / 128), x1 = Math.floor(Math.max(pos[a], pos[b], pos[c]) / 128);
        const y0 = Math.floor(Math.min(pos[a + 1], pos[b + 1], pos[c + 1]) / 128), y1 = Math.floor(Math.max(pos[a + 1], pos[b + 1], pos[c + 1]) / 128);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) continue; // triangles géants : hors sujet ici
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          const k = `${x},${y}`;
          let l = this.cells.get(k);
          if (!l) { l = []; this.cells.set(k, l); }
          l.push(isFloor ? (base + i) : -(base + i) - 1);
        }
      }
    };
    add(floor, true, 0);
    add(wall, false, 0);
  }
  /** Triangles qui touchent la boîte [x0,x1]×[y0,y1]. */
  query(x0: number, y0: number, x1: number, y1: number): Tri3[] {
    const seen = new Set<number>(), out: Tri3[] = [];
    for (let x = Math.floor(x0 / 128); x <= Math.floor(x1 / 128); x++) for (let y = Math.floor(y0 / 128); y <= Math.floor(y1 / 128); y++) {
      for (const code of this.cells.get(`${x},${y}`) ?? []) {
        if (seen.has(code)) continue;
        seen.add(code);
        const isFloor = code >= 0, i = isFloor ? code : -code - 1, t = isFloor ? this.floor : this.wall, p = this.pos;
        const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
        out.push({ ax: p[a], ay: p[a + 1], az: p[a + 2], bx: p[b], by: p[b + 1], bz: p[b + 2], cx: p[c], cy: p[c + 1], cz: p[c + 2], floor: isFloor });
      }
    }
    return out;
  }
}

/** Points répartis sur un triangle (pas ≤ step), pour marquer les voxels qu'il traverse. */
function sampleTri(t: Tri3, step: number, cb: (x: number, y: number, z: number) => void): void {
  const e = Math.max(Math.hypot(t.bx - t.ax, t.by - t.ay, t.bz - t.az), Math.hypot(t.cx - t.ax, t.cy - t.ay, t.cz - t.az), Math.hypot(t.cx - t.bx, t.cy - t.by, t.cz - t.bz));
  const n = Math.min(400, Math.max(1, Math.ceil(e / step)));
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
    const u = i / n, v = j / n, w = 1 - u - v;
    cb(t.ax * w + t.bx * u + t.cx * v, t.ay * w + t.by * u + t.cy * v, t.az * w + t.bz * u + t.cz * v);
  }
}

export interface Voxel { x: number; y: number; z: number; d: number; surface: boolean }

/** Volume de fumée : voxels libres atteints depuis le centre, par distance de parcours croissante. */
export function smokeVolume(index: TriIndex, cx: number, cy: number, cz: number, opts: { voxel?: number; budget?: number } = {}): Voxel[] {
  const V = opts.voxel ?? 10, budget = opts.budget ?? 7000; // ~ sphère de 120 u de rayon
  const R = 360, H0 = -48, H1 = 200; // étendue maximale autour du point d'éclatement
  const nx = Math.ceil((2 * R) / V), ny = nx, nz = Math.ceil((H1 - H0) / V);
  const ox = cx - R, oy = cy - R, oz = cz + H0;
  const idx = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  const blocked = new Uint8Array(nx * ny * nz);
  for (const t of index.query(ox, oy, ox + 2 * R, oy + 2 * R)) {
    sampleTri(t, V * 0.5, (x, y, z) => {
      const i = Math.floor((x - ox) / V), j = Math.floor((y - oy) / V), k = Math.floor((z - oz) / V);
      if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) blocked[idx(i, j, k)] = 1;
    });
  }
  // Départ : voxel libre le plus proche au-dessus du point (la grenade repose au sol)
  let si = Math.floor((cx - ox) / V), sj = Math.floor((cy - oy) / V), sk = Math.floor((cz + 6 - oz) / V);
  while (sk < nz - 1 && blocked[idx(si, sj, sk)]) sk++;
  si = Math.max(0, Math.min(nx - 1, si)); sj = Math.max(0, Math.min(ny - 1, sj));
  // Dijkstra sur 26 voisins (formes arrondies), file à seaux par distance
  const dist = new Float32Array(nx * ny * nz).fill(Infinity);
  const out: Voxel[] = [];
  const buckets: number[][] = [];
  const push = (c: number, d: number) => { const b = Math.floor(d / V * 2); (buckets[b] ??= []).push(c); dist[c] = d; };
  push(idx(si, sj, sk), 0);
  const done = new Uint8Array(nx * ny * nz);
  const nb: [number, number, number, number][] = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) if (a || b || c) nb.push([a, b, c, Math.hypot(a, b, c) * V * (c > 0 ? 0.85 : c < 0 ? 1.4 : 1)]); // monte plus facilement qu'elle ne descend
  for (let bi = 0; bi < buckets.length && out.length < budget; bi++) {
    for (const cell of buckets[bi] ?? []) {
      if (done[cell] || out.length >= budget) continue;
      done[cell] = 1;
      const i = cell % nx, j = Math.floor(cell / nx) % ny, k = Math.floor(cell / (nx * ny));
      out.push({ x: ox + (i + 0.5) * V, y: oy + (j + 0.5) * V, z: oz + (k + 0.5) * V, d: dist[cell], surface: false });
      for (const [a, b, c, w] of nb) {
        const i2 = i + a, j2 = j + b, k2 = k + c;
        if (i2 < 0 || j2 < 0 || k2 < 0 || i2 >= nx || j2 >= ny || k2 >= nz) continue;
        const n = idx(i2, j2, k2);
        if (blocked[n] || done[n]) continue;
        const d = dist[cell] + w;
        if (d < dist[n]) push(n, d);
      }
    }
  }
  // Voxels de surface (les seuls dessinés : l'intérieur est caché)
  const filled = new Set(out.map((v) => `${Math.round((v.x - ox) / V - 0.5)},${Math.round((v.y - oy) / V - 0.5)},${Math.round((v.z - oz) / V - 0.5)}`));
  for (const v of out) {
    const i = Math.round((v.x - ox) / V - 0.5), j = Math.round((v.y - oy) / V - 0.5), k = Math.round((v.z - oz) / V - 0.5);
    v.surface = !(filled.has(`${i + 1},${j},${k}`) && filled.has(`${i - 1},${j},${k}`) && filled.has(`${i},${j + 1},${k}`) && filled.has(`${i},${j - 1},${k}`) && filled.has(`${i},${j},${k + 1}`) && filled.has(`${i},${j},${k - 1}`));
  }
  return out;
}

export interface FireCell { x: number; y: number; z: number; d: number }

/** Nappe de feu : cases de sol atteintes depuis le point d'impact (marche ≤ 18 u, descente ≤ 80 u). */
export function fireSpread(index: TriIndex, cx: number, cy: number, cz: number, opts: { cell?: number; budget?: number } = {}): FireCell[] {
  const C = opts.cell ?? 14, budget = opts.budget ?? 260; // ~ disque de 130 u de rayon
  const R = 300, n = Math.ceil((2 * R) / C);
  const ox = cx - R, oy = cy - R;
  // Hauteurs de sol par colonne
  const heights: number[][] = Array.from({ length: n * n }, () => []);
  for (const t of index.query(ox, oy, ox + 2 * R, oy + 2 * R)) {
    if (!t.floor) continue;
    sampleTri(t, C * 0.5, (x, y, z) => {
      if (z > cz + 120 || z < cz - 300) return;
      const i = Math.floor((x - ox) / C), j = Math.floor((y - oy) / C);
      if (i < 0 || j < 0 || i >= n || j >= n) return;
      const l = heights[j * n + i];
      if (!l.some((h) => Math.abs(h - z) < 10)) l.push(z);
    });
  }
  const floorAt = (i: number, j: number, near: number, up: number, down: number) => {
    let best: number | null = null;
    for (const h of heights[j * n + i] ?? []) if (h <= near + up && h >= near - down && (best === null || Math.abs(h - near) < Math.abs(best - near))) best = h;
    return best;
  };
  const si = Math.floor((cx - ox) / C), sj = Math.floor((cy - oy) / C);
  const z0 = floorAt(si, sj, cz, 40, 200) ?? cz;
  const out: FireCell[] = [];
  const seen = new Map<number, number>();
  const queue: { i: number; j: number; z: number; d: number }[] = [{ i: si, j: sj, z: z0, d: 0 }];
  seen.set(sj * n + si, 0);
  while (queue.length && out.length < budget) {
    queue.sort((a, b) => a.d - b.d);
    const c = queue.shift()!;
    out.push({ x: ox + (c.i + 0.5) * C, y: oy + (c.j + 0.5) * C, z: c.z, d: c.d });
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const i = c.i + a, j = c.j + b;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const z = floorAt(i, j, c.z, 18, 80);
      if (z === null) continue;
      const d = c.d + Math.hypot(a, b) * C * (z < c.z - 4 ? 0.7 : 1); // le feu coule vers le bas
      const k = j * n + i;
      if ((seen.get(k) ?? Infinity) <= d) continue;
      seen.set(k, d);
      queue.push({ i, j, z, d });
    }
  }
  return out;
}

/** Distance au premier triangle touché par un rayon (monde), ou maxD. Pour les traçantes des tirs. */
export function raycast(index: TriIndex, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxD = 3000): number {
  let best = maxD;
  const tested = new Set<string>();
  // On avance par pas de 96 u en ne testant que les triangles des cases traversées
  for (let d = 0; d < best; d += 96) {
    const x = ox + dx * d, y = oy + dy * d;
    for (const t of index.query(x - 64, y - 64, x + 64, y + 64)) {
      const key = `${t.ax},${t.ay},${t.az},${t.bx},${t.by}`;
      if (tested.has(key)) continue;
      tested.add(key);
      // Möller–Trumbore
      const e1x = t.bx - t.ax, e1y = t.by - t.ay, e1z = t.bz - t.az, e2x = t.cx - t.ax, e2y = t.cy - t.ay, e2z = t.cz - t.az;
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-9) continue;
      const inv = 1 / det, tx = ox - t.ax, ty = oy - t.ay, tz = oz - t.az;
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (dist > 1 && dist < best) best = dist;
    }
  }
  return best;
}
