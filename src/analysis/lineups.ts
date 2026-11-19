// Lineups : regroupe les grenades lancées du même endroit vers le même endroit, sur toute la
// bibliothèque, pour retrouver les utilitaires récurrents d'une équipe ou d'un joueur.

import type { GrenadeKind } from '../data/types';
import { hasSpatial, type LibraryMatch } from '../library/library';
import type { SpatialNade, TeamIdx } from '../library/spatial';
import type { Subject } from './heatmap';
import { tt } from '../i18n';

/** 'run+jump' -> 'Running jump throw'. */
export function techLabel(code: string): string {
  if (!code) return '';
  const parts = new Set(code.split('+'));
  const move = parts.has('run') ? tt('Running') : parts.has('walk') ? tt('Walking') : tt('Standing');
  const jump = parts.has('jump');
  let label = jump ? (move === 'Standing' ? tt('Jump throw') : `${move} jump throw`) : `${move} throw`;
  if (parts.has('crouch')) label += ', crouched';
  return label;
}

export interface LineupThrow {
  match: LibraryMatch;
  nade: SpatialNade;
  side: 'ct' | 't';
}

export interface Lineup {
  id: string;
  kind: GrenadeKind;
  throws: LineupThrow[];
  /** Lancer représentatif (le plus proche du centre du groupe) : sert au setpos. */
  rep: LineupThrow;
  from: [number, number, number];
  to: [number, number, number];
  fromPlace: string;
  toPlace: string;
  tech: string;
  maps: number;
  players: string[];
  /** Temps moyen du lancer après le freeze (s). */
  avgT: number;
}

export interface LineupQuery {
  map: string;
  subject: Subject;
  side: 'all' | 'ct' | 't';
  kind: GrenadeKind | 'all';
  /** Restreint aux rounds retenus par les filtres de rounds. */
  rounds?: Map<string, Set<TeamIdx>>;
}

const LAND_R = 160;
const THROW_R = 110;

const mode = <T,>(xs: T[]): T => {
  const c = new Map<T, number>();
  let best = xs[0], n = 0;
  for (const x of xs) { const k = (c.get(x) ?? 0) + 1; c.set(x, k); if (k > n) { n = k; best = x; } }
  return best;
};

/** Toutes les grenades avec lancer connu, selon le sujet, le côté et le type. */
export function collectThrows(matches: LibraryMatch[], q: LineupQuery): LineupThrow[] {
  const out: LineupThrow[] = [];
  for (const m of matches) {
    if (m.map !== q.map || !hasSpatial(m)) continue;
    const sp = m.spatial!;
    let team: TeamIdx | null = null, player = -1;
    if (q.subject.kind === 'team') {
      const e = q.subject.group.entries.find((x) => x.matchId === m.id);
      if (!e) continue;
      team = e.team;
    } else if (q.subject.kind === 'player') {
      const sid = q.subject.steamid;
      player = m.players.findIndex((p) => p.steamid === sid);
      if (player < 0) continue;
    }
    for (const n of sp.nades) {
      if (!n.th || n.team < 0 || n.kind === 'decoy') continue;
      if (q.kind !== 'all' && n.kind !== q.kind) continue;
      if (team !== null && n.team !== team) continue;
      if (player >= 0 && n.p !== player) continue;
      const r = sp.rounds[n.r];
      if (!r) continue;
      const side = r.ctTeam === n.team ? 'ct' : 't';
      if (q.side !== 'all' && side !== q.side) continue;
      if (q.rounds && !q.rounds.get(`${m.id}:${n.r}`)?.has(n.team as TeamIdx)) continue;
      out.push({ match: m, nade: n, side });
    }
  }
  return out;
}

/** Regroupe les lancers : même type, arrivée à moins de 160 unités, départ à moins de 110 unités. */
export function clusterLineups(throws: LineupThrow[]): Lineup[] {
  interface Acc { kind: GrenadeKind; items: LineupThrow[]; fx: number; fy: number; tx: number; ty: number }
  const groups: Acc[] = [];
  for (const t of throws) {
    const n = t.nade, th = n.th!;
    let best: Acc | null = null, bestD = Infinity;
    for (const g of groups) {
      if (g.kind !== n.kind) continue;
      const k = g.items.length;
      const dl = Math.hypot(g.tx / k - n.x, g.ty / k - n.y);
      const dt = Math.hypot(g.fx / k - th.x, g.fy / k - th.y);
      if (dl < LAND_R && dt < THROW_R && dl + dt < bestD) { best = g; bestD = dl + dt; }
    }
    if (!best) groups.push((best = { kind: n.kind, items: [], fx: 0, fy: 0, tx: 0, ty: 0 }));
    best.items.push(t);
    best.fx += th.x; best.fy += th.y; best.tx += n.x; best.ty += n.y;
  }
  return groups.map((g, i): Lineup => {
    const k = g.items.length;
    const cx = g.fx / k, cy = g.fy / k;
    let rep = g.items[0], rd = Infinity;
    for (const it of g.items) { const d = Math.hypot(it.nade.th!.x - cx, it.nade.th!.y - cy); if (d < rd) { rd = d; rep = it; } }
    const placeOf = (t: LineupThrow, idx: number | undefined) => (idx != null && idx >= 0 ? t.match.spatial!.places?.[idx] ?? '' : '');
    const zMean = (f: (t: LineupThrow) => number) => g.items.reduce((a, t) => a + f(t), 0) / k;
    return {
      id: `${g.kind}-${i}`,
      kind: g.kind,
      throws: g.items,
      rep,
      from: [cx, cy, zMean((t) => t.nade.th!.z)],
      to: [g.tx / k, g.ty / k, zMean((t) => t.nade.z)],
      fromPlace: mode(g.items.map((t) => placeOf(t, t.nade.fp))),
      toPlace: mode(g.items.map((t) => placeOf(t, t.nade.lp))),
      tech: mode(g.items.map((t) => t.nade.th!.tech)),
      maps: new Set(g.items.map((t) => t.match.id)).size,
      players: [...new Set(g.items.map((t) => t.match.players[t.nade.p]?.name ?? '?'))],
      avgT: g.items.reduce((a, t) => a + t.nade.th!.t, 0) / k,
    };
  }).sort((a, b) => b.throws.length - a.throws.length || b.maps - a.maps);
}
