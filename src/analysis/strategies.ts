// Détecteur de stratégies : regroupe les rounds d'une équipe qui se ressemblent.
// Côté T (exécutions) : positions à 20 et 30 s, smokes / mollies des 40 premières secondes, site et
// moment du plant. Côté CT (setups) : positions à 20 s et utilitaires. Regroupement hiérarchique
// (lien moyen) sur la similarité cosinus ; chaque groupe reçoit un nom lisible tiré de ses données.

import type { RoundView } from './rounds';
import { placeLabel } from '../viewer/places';
import { trendLevel, type TrendLevel } from './rounds';
import { tt } from '../i18n';

export interface Strategy {
  id: string;
  name: string;
  /** Détails du nom : callouts tenus, utilitaires, timing. */
  details: string[];
  rounds: RoundView[];
  won: number;
  maps: number;
  level: TrendLevel;
  /** Round le plus représentatif (le plus proche des autres). */
  medoid: RoundView;
  site: 'A' | 'B' | null;
  avgPlantT: number | null;
}

type Vec = Map<string, number>;

function roundVector(v: RoundView, side: 'ct' | 't'): Vec {
  const sp = v.match.spatial!;
  const places = sp.places ?? [];
  const out: Vec = new Map();
  const add = (k: string, w: number) => out.set(k, (out.get(k) ?? 0) + w);
  for (const p of sp.pos) {
    if (p.r !== v.round.i || p.team !== v.team || p.pl == null || p.pl < 0) continue;
    if (side === 't' ? p.s === 20 || p.s === 30 : p.s === 20) add(`pos:${places[p.pl]}`, p.s === 30 ? 1.2 : 1);
  }
  for (const n of sp.nades) {
    if (n.r !== v.round.i || n.team !== v.team || n.t > 40 || (n.kind !== 'smoke' && n.kind !== 'molotov')) continue;
    const lp = n.lp != null && n.lp >= 0 ? places[n.lp] : '';
    if (lp) add(`${n.kind}:${lp}`, 1.5);
  }
  if (side === 't') {
    if (v.round.plantSite) {
      add(`site:${v.round.plantSite}`, 3);
      const t = v.round.plantT ?? 60;
      add(t < 35 ? 'tempo:fast' : t < 65 ? 'tempo:mid' : 'tempo:late', 1.5);
    } else add('site:none', 2);
  }
  return out;
}

function cosine(a: Vec, b: Vec): number {
  let dot = 0, na = 0, nb = 0;
  for (const [k, x] of a) { na += x * x; const y = b.get(k); if (y) dot += x * y; }
  for (const y of b.values()) nb += y * y;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const top = (counts: Map<string, number>, prefix: string, n: number, min: number) =>
  [...counts.entries()].filter(([k, c]) => k.startsWith(prefix) && c >= min).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k.slice(prefix.length));

/** Regroupe les rounds (déjà filtrés : une équipe, un côté, une carte). */
export function detectStrategies(views: RoundView[], side: 'ct' | 't', threshold = 0.5): Strategy[] {
  const vs = views.filter((v) => v.side === side && v.match.spatial?.places);
  if (vs.length < 2) return [];
  const vecs = vs.map((v) => roundVector(v, side));
  const n = vs.length;
  const sim: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) sim[i][j] = sim[j][i] = cosine(vecs[i], vecs[j]);

  // Regroupement hiérarchique, lien moyen, jusqu'à ce que la similarité moyenne passe sous le seuil
  let clusters: number[][] = vs.map((_, i) => [i]);
  for (;;) {
    let best = -1, bi = -1, bj = -1;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        let s = 0;
        for (const a of clusters[i]) for (const b of clusters[j]) s += sim[a][b];
        s /= clusters[i].length * clusters[j].length;
        if (s > best) { best = s; bi = i; bj = j; }
      }
    }
    if (best < threshold || bi < 0) break;
    clusters = [...clusters.filter((_, k) => k !== bi && k !== bj), [...clusters[bi], ...clusters[bj]]];
  }

  const totalMaps = new Set(vs.map((v) => v.match.id)).size;
  return clusters.filter((c) => c.length >= 2).map((c, ci): Strategy => {
    const rounds = c.map((i) => vs[i]);
    // Agrégat : nombre de rounds où chaque élément apparaît
    const counts = new Map<string, number>();
    for (const i of c) for (const k of vecs[i].keys()) counts.set(k, (counts.get(k) ?? 0) + 1);
    const half = Math.max(1, Math.ceil(c.length / 2));
    const medoidIdx = c.reduce((best, i) => (c.reduce((s, j) => s + sim[i][j], 0) > c.reduce((s, j) => s + sim[best][j], 0) ? i : best), c[0]);
    const sites = rounds.map((r) => r.round.plantSite);
    const aN = sites.filter((s) => s === 'A').length, bN = sites.filter((s) => s === 'B').length;
    const site: 'A' | 'B' | null = aN + bN >= half ? (aN >= bN ? 'A' : 'B') : null;
    const plants = rounds.map((r) => r.round.plantT).filter((t): t is number => t != null);
    const avgPlantT = plants.length ? plants.reduce((a, b) => a + b, 0) / plants.length : null;
    const held = top(counts, 'pos:', 3, half).map(placeLabel);
    const smokes = top(counts, 'smoke:', 3, half).map(placeLabel);
    const mollies = top(counts, 'molotov:', 2, half).map(placeLabel);
    let name: string;
    if (side === 't') {
      const tempo = avgPlantT == null ? '' : avgPlantT < 35 ? tt('Rush') : avgPlantT < 65 ? tt('Execute') : tt('Late hit');
      name = site ? `${site} ${tempo.toLowerCase() || 'hit'}` : tt('Default, no plant');
      if (site && tempo === 'Rush') name = `${site} rush`;
    } else {
      name = held.length ? tt('Setup: {0}', [held.slice(0, 2).join(' + ')]) : tt('Setup');
    }
    const details: string[] = [];
    if (held.length) details.push(`${side === 't' ? 'players at' : 'holds'} ${held.join(', ')}`);
    if (smokes.length) details.push(`smokes ${smokes.join(', ')}`);
    if (mollies.length) details.push(`mollies ${mollies.join(', ')}`);
    if (side === 't' && avgPlantT != null) {
      const left = Math.max(0, Math.ceil(115 - avgPlantT));
      details.push(`plant around ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
    }
    const maps = new Set(rounds.map((r) => r.match.id)).size;
    return {
      id: `${side}-${ci}`, name, details, rounds, won: rounds.filter((r) => r.won).length, maps,
      level: trendLevel(maps, totalMaps, rounds.length), medoid: vs[medoidIdx], site, avgPlantT,
    };
  }).sort((a, b) => b.rounds.length - a.rounds.length);
}
