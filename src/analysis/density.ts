// Champ de densité pour les heatmaps : points répartis sur une grille, flou gaussien séparable
// (trois flous en boîte), normalisation robuste (percentile, pas le maximum : un seul point chaud
// n'écrase plus le reste), échelle linéaire / racine / log, et lignes de niveau.

export interface DensitySettings {
  /** Rayon du noyau, en pixels de radar (sur 1024). */
  radius: number;
  /** Gain appliqué avant écrêtage (1 = le percentile 98 touche le haut de la rampe). */
  intensity: number;
  /** En dessous (0..1), rien n'est dessiné. */
  threshold: number;
  opacity: number;
  scale: 'linear' | 'sqrt' | 'log';
  contours: boolean;
}

export const DEFAULT_DENSITY: DensitySettings = { radius: 14, intensity: 1, threshold: 0.06, opacity: 0.85, scale: 'sqrt', contours: true };

/** Flou en boîte horizontal puis vertical, rayon r (en cellules), sur place via un tampon. */
function boxBlur(src: Float32Array, tmp: Float32Array, n: number, r: number): void {
  if (r < 1) return;
  const w = 2 * r + 1;
  for (let y = 0; y < n; y++) {
    const row = y * n;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(n - 1, Math.max(0, x))];
    for (let x = 0; x < n; x++) {
      tmp[row + x] = acc / w;
      acc += src[row + Math.min(n - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < n; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(n - 1, Math.max(0, y)) * n + x];
    for (let y = 0; y < n; y++) {
      src[y * n + x] = acc / w;
      acc += tmp[Math.min(n - 1, y + r + 1) * n + x] - tmp[Math.max(0, y - r) * n + x];
    }
  }
}

/** Rayons de 3 boîtes qui approchent une gaussienne d'écart-type sigma (W. Jarosz). */
function boxesForGauss(sigma: number): number[] {
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => ((i < m ? wl : wu) - 1) / 2);
}

/**
 * Densité normalisée 0..1 sur une grille n×n couvrant le radar (coordonnées radar 0..1024).
 * `weights` optionnel (même longueur que pts).
 */
export function densityField(pts: [number, number][], n: number, s: DensitySettings, radarSize = 1024): Float32Array {
  const grid = new Float32Array(n * n);
  const k = n / radarSize;
  for (const [x, y] of pts) {
    // Répartition bilinéaire : pas d'effet de grille
    const gx = x * k - 0.5, gy = y * k - 0.5;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
    for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]] as const) {
      const xx = x0 + dx, yy = y0 + dy;
      if (xx >= 0 && yy >= 0 && xx < n && yy < n) grid[yy * n + xx] += w;
    }
  }
  const tmp = new Float32Array(n * n);
  for (const r of boxesForGauss(Math.max(0.6, s.radius * k))) boxBlur(grid, tmp, n, Math.round(r));
  // Normalisation sur le percentile 98 des cellules non nulles
  const nz: number[] = [];
  let max = 0;
  for (const v of grid) if (v > 1e-6) { nz.push(v); if (v > max) max = v; }
  if (!nz.length) return grid;
  nz.sort((a, b) => a - b);
  const ref = Math.max(nz[Math.floor(nz.length * 0.98)] ?? max, max * 0.05);
  const f = s.scale === 'log' ? (v: number) => Math.log1p(1000 * v) / Math.log1p(1000) : s.scale === 'sqrt' ? Math.sqrt : (v: number) => v;
  for (let i = 0; i < grid.length; i++) grid[i] = Math.min(1, f(Math.min(1, (grid[i] / ref) * s.intensity)));
  return grid;
}

/** Lignes de niveau (marching squares) : segments [x1,y1,x2,y2] en cellules, pour chaque niveau. */
export function contourSegments(field: Float32Array, n: number, level: number): number[] {
  const out: number[] = [];
  const at = (x: number, y: number) => field[y * n + x];
  const lerp = (a: number, b: number) => (level - a) / (b - a || 1e-9);
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const a = at(x, y), b = at(x + 1, y), c = at(x + 1, y + 1), d = at(x, y + 1);
      const idx = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const top: [number, number] = [x + lerp(a, b), y];
      const right: [number, number] = [x + 1, y + lerp(b, c)];
      const bottom: [number, number] = [x + lerp(d, c), y + 1];
      const left: [number, number] = [x, y + lerp(a, d)];
      const seg = (p: [number, number], q: [number, number]) => out.push(p[0], p[1], q[0], q[1]);
      switch (idx) {
        case 1: case 14: seg(left, bottom); break;
        case 2: case 13: seg(bottom, right); break;
        case 3: case 12: seg(left, right); break;
        case 4: case 11: seg(top, right); break;
        case 5: seg(left, top); seg(bottom, right); break;
        case 6: case 9: seg(top, bottom); break;
        case 7: case 8: seg(left, top); break;
        case 10: seg(top, right); seg(left, bottom); break;
      }
    }
  }
  return out;
}

const KEY = 'scrimview.density';
export function loadDensity(): DensitySettings {
  try { return { ...DEFAULT_DENSITY, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return DEFAULT_DENSITY; }
}
export function saveDensity(s: DensitySettings): void { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignoré */ } }
