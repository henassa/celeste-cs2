// Points des heatmaps (coordonnées monde) selon les filtres : carte, sujet, côté, événement.

import type { GrenadeKind } from '../data/types';
import { hasSpatial, type LibraryMatch } from '../library/library';
import type { TeamIdx } from '../library/spatial';
import type { TeamGroup } from './teams';
import { roundKey } from './rounds';

export type HeatEvent = 'kills' | 'deaths' | 'pos' | 'nades';
export type Subject = { kind: 'all' } | { kind: 'team'; group: TeamGroup } | { kind: 'player'; steamid: string };

export interface HeatOptions {
  map: string;
  subject: Subject;
  side: 'all' | 'ct' | 't';
  event: HeatEvent;
  /** Pour 'pos' : secondes après le freeze. */
  posTime: number;
  /** Pour 'nades' : type de grenade, ou toutes. */
  nadeKind: GrenadeKind | 'all';
  /** Plage de temps (kills, morts, grenades) : secondes après le freeze, ou après le plant. */
  time?: TimeRange;
  /** Restreint aux rounds retenus par les filtres (clés roundKey), et au point de vue de l'équipe filtrée. */
  rounds?: Map<string, Set<TeamIdx>>;
}

export type TimeRange = 'all' | 'early' | 'mid' | 'late' | 'postplant';
export const TIME_RANGES: { id: TimeRange; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Whole round' },
  { id: 'early', label: '0–20s', hint: 'First 20 s after the freeze time' },
  { id: 'mid', label: '20–45s', hint: '20 to 45 s after the freeze time' },
  { id: 'late', label: '45s+', hint: 'From 45 s after the freeze time' },
  { id: 'postplant', label: 'Post-plant', hint: 'After the bomb plant' },
];

function inRange(range: TimeRange | undefined, t: number, plantT: number | null): boolean {
  switch (range) {
    case 'early': return t < 20;
    case 'mid': return t >= 20 && t < 45;
    case 'late': return t >= 45;
    case 'postplant': return plantT != null && t >= plantT;
    default: return true;
  }
}

export interface HeatPoint { x: number; y: number; z: number }

export function heatPoints(matches: LibraryMatch[], o: HeatOptions): { points: HeatPoint[]; matches: number } {
  const points: HeatPoint[] = [];
  let used = 0;
  for (const m of matches) {
    if (m.map !== o.map || !hasSpatial(m)) continue;
    const sp = m.spatial!;
    // Filtres de rounds : on garde les rounds retenus et l'équipe du point de vue
    const kept = o.rounds;
    if (kept && ![...sp.rounds].some((r) => kept.has(roundKey(m.id, r.i)))) continue;
    const roundOk = (round: number, team: TeamIdx | -1) => {
      if (!kept) return true;
      return team >= 0 && !!kept.get(roundKey(m.id, round))?.has(team as TeamIdx);
    };
    const timeOk = (round: number, t: number) => inRange(o.time, t, sp.rounds[round]?.plantT ?? null);
    // Qui compte comme « sujet » dans ce match
    let teamIdx: TeamIdx | null = null;
    let playerIdx = -1;
    if (o.subject.kind === 'team') {
      const e = o.subject.group.entries.find((x) => x.matchId === m.id);
      if (!e) continue;
      teamIdx = e.team;
    } else if (o.subject.kind === 'player') {
      const sid = o.subject.steamid;
      playerIdx = m.players.findIndex((p) => p.steamid === sid);
      if (playerIdx < 0) continue;
    }
    used++;
    const match = (p: number, team: TeamIdx | -1) =>
      o.subject.kind === 'all' || (o.subject.kind === 'team' ? team === teamIdx : p === playerIdx);
    const sideOk = (round: number, team: TeamIdx | -1) => {
      if (o.side === 'all') return true;
      const r = sp.rounds[round];
      if (!r || team < 0) return false;
      return (r.ctTeam === team) === (o.side === 'ct');
    };
    if (o.event === 'kills') {
      for (const k of sp.kills) if (k.kt >= 0 && match(k.k, k.kt) && sideOk(k.r, k.kt) && roundOk(k.r, k.kt) && timeOk(k.r, k.t)) points.push({ x: k.kx, y: k.ky, z: k.kz });
    } else if (o.event === 'deaths') {
      for (const k of sp.kills) if (match(k.v, k.vt) && sideOk(k.r, k.vt) && roundOk(k.r, k.vt) && timeOk(k.r, k.t)) points.push({ x: k.vx, y: k.vy, z: k.vz });
    } else if (o.event === 'pos') {
      for (const p of sp.pos) if (p.s === o.posTime && match(p.p, p.team) && sideOk(p.r, p.team) && roundOk(p.r, p.team)) points.push({ x: p.x, y: p.y, z: p.z });
    } else {
      for (const n of sp.nades) {
        if ((o.nadeKind === 'all' || n.kind === o.nadeKind) && match(n.p, n.team) && sideOk(n.r, n.team) && roundOk(n.r, n.team) && timeOk(n.r, n.t)) points.push({ x: n.x, y: n.y, z: n.z });
      }
    }
  }
  return { points, matches: used };
}

/** Cartes présentes dans la bibliothèque (avec résumé spatial), de la plus jouée à la moins jouée. */
export function mapsWithSpatial(matches: LibraryMatch[]): string[] {
  const c = new Map<string, number>();
  for (const m of matches) if (hasSpatial(m)) c.set(m.map, (c.get(m.map) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

export interface TimingGrid {
  places: string[];
  /** Largeur d'une colonne (s) et nombre de colonnes. */
  bucket: number;
  columns: number;
  counts: number[][];
  max: number;
  total: number;
}

/**
 * Timing heatmap : à quel moment du round chaque callout voit des combats (kills et morts du sujet,
 * placés au callout du joueur concerné), par tranches de 5 s après le freeze.
 */
export function timingGrid(matches: LibraryMatch[], o: Omit<HeatOptions, 'event' | 'posTime' | 'nadeKind' | 'time'>, bucket = 5, maxPlaces = 14): TimingGrid {
  const columns = Math.ceil(115 / bucket) + 1;
  const byPlace = new Map<string, number[]>();
  let total = 0;
  const add = (place: string, t: number) => {
    if (!place || t < 0) return;
    let row = byPlace.get(place);
    if (!row) byPlace.set(place, (row = Array.from({ length: columns }, () => 0)));
    row[Math.min(columns - 1, Math.floor(t / bucket))]++;
    total++;
  };
  for (const m of matches) {
    if (m.map !== o.map || !hasSpatial(m) || !m.spatial!.places) continue;
    const sp = m.spatial!;
    let teamIdx: TeamIdx | null = null, playerIdx = -1;
    if (o.subject.kind === 'team') {
      const e = o.subject.group.entries.find((x) => x.matchId === m.id);
      if (!e) continue;
      teamIdx = e.team;
    } else if (o.subject.kind === 'player') {
      const sid = o.subject.steamid;
      playerIdx = m.players.findIndex((p) => p.steamid === sid);
      if (playerIdx < 0) continue;
    }
    const mine = (p: number, team: TeamIdx | -1) => o.subject.kind === 'all' || (o.subject.kind === 'team' ? team === teamIdx : p === playerIdx);
    const sideOk = (round: number, team: TeamIdx | -1) => {
      if (o.side === 'all') return true;
      const r = sp.rounds[round];
      return !!r && team >= 0 && (r.ctTeam === team) === (o.side === 'ct');
    };
    const roundOk = (round: number, team: TeamIdx | -1) => !o.rounds || (team >= 0 && !!o.rounds.get(roundKey(m.id, round))?.has(team as TeamIdx));
    const place = (i: number | undefined) => (i != null && i >= 0 ? sp.places![i] ?? '' : '');
    for (const k of sp.kills) {
      if (k.kt >= 0 && k.kt !== k.vt && mine(k.k, k.kt) && sideOk(k.r, k.kt) && roundOk(k.r, k.kt)) add(place(k.kp), k.t);
      if (mine(k.v, k.vt) && sideOk(k.r, k.vt) && roundOk(k.r, k.vt)) add(place(k.vp), k.t);
    }
  }
  const rows = [...byPlace.entries()].sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0)).slice(0, maxPlaces);
  const counts = rows.map(([, r]) => r);
  return { places: rows.map(([p]) => p), bucket, columns, counts, max: Math.max(1, ...counts.flat()), total };
}
