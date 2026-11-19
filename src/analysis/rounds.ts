// Filtres de rounds sur toute la bibliothèque : chaque round est vu du point de vue d'une équipe
// (l'équipe choisie, l'équipe du joueur choisi, ou les deux équipes pour « tout le monde »).
// Sert à l'onglet Rounds et restreint les heatmaps aux rounds retenus.

import { hasSpatial, type LibraryMatch } from '../library/library';
import type { BuyType, SpatialKill, SpatialRound, TeamIdx } from '../library/spatial';
import type { Subject } from './heatmap';

export type Situation = 'any' | 'second' | 'antieco' | 'advantage' | 'disadvantage' | 'clutch';

export interface RoundFilter {
  side: 'all' | 'ct' | 't';
  result: 'all' | 'won' | 'lost';
  ourBuy: BuyType | 'all';
  theirBuy: BuyType | 'all';
  bomb: 'all' | 'A' | 'B' | 'none';
  opening: 'all' | 'won' | 'lost';
  situation: Situation;
  /** Callout où a eu lieu le premier duel (place de la victime), '' = partout. */
  openingPlace: string;
}

export const DEFAULT_FILTER: RoundFilter = {
  side: 'all', result: 'all', ourBuy: 'all', theirBuy: 'all', bomb: 'all', opening: 'all', situation: 'any', openingPlace: '',
};

export const isDefaultFilter = (f: RoundFilter) => (Object.keys(DEFAULT_FILTER) as (keyof RoundFilter)[]).every((k) => f[k] === DEFAULT_FILTER[k]);

export interface RoundView {
  match: LibraryMatch;
  round: SpatialRound;
  /** Équipe dont on prend le point de vue. */
  team: TeamIdx;
  side: 'ct' | 't';
  won: boolean;
  ourBuy: BuyType;
  theirBuy: BuyType;
  /** Premier kill : true = pour nous, false = contre nous, null = aucun. */
  opening: boolean | null;
  openingKill: SpatialKill | null;
  openingPlace: string;
  /** Plus grand écart de joueurs en vie, en notre faveur (>0) ou contre nous (<0). */
  maxLead: number;
  maxDeficit: number;
  /** On s'est retrouvé seul en vie face à au moins un adversaire. */
  clutch: boolean;
}

export const roundKey = (matchId: string, round: number) => `${matchId}:${round}`;

/** Équipe du sujet dans un match (null = sujet absent ; 'both' = tout le monde). */
function subjectTeam(m: LibraryMatch, subject: Subject): TeamIdx | 'both' | null {
  if (subject.kind === 'all') return 'both';
  if (subject.kind === 'team') return subject.group.entries.find((e) => e.matchId === m.id)?.team ?? null;
  const p = m.players.find((x) => x.steamid === subject.steamid);
  return p ? p.team : null;
}

/** Évolution des joueurs en vie dans un round, du point de vue de `team`. */
function aliveSwing(r: SpatialRound, kills: SpatialKill[], team: TeamIdx) {
  const alive: [number, number] = r.alive ? [r.alive[0], r.alive[1]] : [5, 5];
  let lead = 0, deficit = 0, clutch = false;
  const other = (1 - team) as TeamIdx;
  for (const k of kills) {
    if (r.endT != null && k.t > r.endT) break; // kills après la fin du round : sans effet sur le round
    alive[k.vt] = Math.max(0, alive[k.vt] - 1);
    const d = alive[team] - alive[other];
    if (alive[team] > 0 && alive[other] > 0) {
      lead = Math.max(lead, d);
      deficit = Math.min(deficit, d);
      if (alive[team] === 1) clutch = true;
    }
  }
  return { lead, deficit, clutch };
}

function viewsOf(m: LibraryMatch, team: TeamIdx): RoundView[] {
  const sp = m.spatial!;
  const byRound = new Map<number, SpatialKill[]>();
  for (const k of sp.kills) {
    let a = byRound.get(k.r);
    if (!a) byRound.set(k.r, (a = []));
    a.push(k);
  }
  const places = sp.places ?? [];
  return sp.rounds.map((r) => {
    const kills = (byRound.get(r.i) ?? []).filter((k) => k.t >= 0);
    const openingKill = kills.find((k) => k.kt >= 0 && k.kt !== k.vt) ?? null;
    const sw = aliveSwing(r, kills, team);
    return {
      match: m,
      round: r,
      team,
      side: r.ctTeam === team ? 'ct' : 't',
      won: r.winner === team,
      ourBuy: r.buy[team],
      theirBuy: r.buy[1 - team],
      opening: openingKill ? openingKill.kt === team : null,
      openingKill,
      openingPlace: openingKill && openingKill.vp != null && openingKill.vp >= 0 ? places[openingKill.vp] ?? '' : '',
      maxLead: sw.lead,
      maxDeficit: sw.deficit,
      clutch: sw.clutch,
    };
  });
}

function matchesFilter(v: RoundView, f: RoundFilter): boolean {
  if (f.side !== 'all' && v.side !== f.side) return false;
  if (f.result !== 'all' && v.won !== (f.result === 'won')) return false;
  if (f.ourBuy !== 'all' && v.ourBuy !== f.ourBuy) return false;
  if (f.theirBuy !== 'all' && v.theirBuy !== f.theirBuy) return false;
  if (f.bomb !== 'all' && (f.bomb === 'none' ? v.round.plantSite !== null : v.round.plantSite !== f.bomb)) return false;
  if (f.opening !== 'all' && v.opening !== (f.opening === 'won')) return false;
  if (f.openingPlace && v.openingPlace !== f.openingPlace) return false;
  switch (f.situation) {
    case 'second': return v.round.i === 1 || v.round.i === 13;
    case 'antieco': return v.ourBuy === 'full' && (v.theirBuy === 'eco' || v.theirBuy === 'pistol');
    case 'advantage': return v.maxLead >= 1;
    case 'disadvantage': return v.maxDeficit <= -1;
    case 'clutch': return v.clutch;
    default: return true;
  }
}

export interface RoundQuery { map?: string; subject: Subject }

/** Tous les rounds visibles pour le sujet (avant filtres), utile pour les listes de callouts. */
export function allRoundViews(matches: LibraryMatch[], q: RoundQuery): RoundView[] {
  const out: RoundView[] = [];
  for (const m of matches) {
    if (!hasSpatial(m) || (q.map && m.map !== q.map)) continue;
    const t = subjectTeam(m, q.subject);
    if (t === null) continue;
    for (const team of t === 'both' ? ([0, 1] as TeamIdx[]) : [t]) out.push(...viewsOf(m, team));
  }
  return out;
}

export function filterRounds(views: RoundView[], f: RoundFilter): RoundView[] {
  return views.filter((v) => matchesFilter(v, f));
}

export interface RoundSummary {
  rounds: number;
  maps: number;
  won: number;
  openingWon: number;
  openingPlayed: number;
  /** Rounds gagnés avec / sans le premier kill. */
  winWithOpening: { won: number; played: number };
  winWithoutOpening: { won: number; played: number };
  plants: { A: number; B: number };
  /** Plants faits par nous (côté T). */
  tRounds: number;
  avgPlantT: number | null;
}

export function summarizeRounds(views: RoundView[]): RoundSummary {
  const s: RoundSummary = {
    rounds: views.length, maps: new Set(views.map((v) => v.match.id)).size, won: 0, openingWon: 0, openingPlayed: 0,
    winWithOpening: { won: 0, played: 0 }, winWithoutOpening: { won: 0, played: 0 }, plants: { A: 0, B: 0 }, tRounds: 0, avgPlantT: null,
  };
  let plantSum = 0, plantN = 0;
  for (const v of views) {
    if (v.won) s.won++;
    if (v.opening !== null) {
      s.openingPlayed++;
      const bucket = v.opening ? s.winWithOpening : s.winWithoutOpening;
      bucket.played++;
      if (v.won) bucket.won++;
      if (v.opening) s.openingWon++;
    }
    if (v.side === 't') {
      s.tRounds++;
      if (v.round.plantSite) s.plants[v.round.plantSite]++;
      if (v.round.plantT != null) { plantSum += v.round.plantT; plantN++; }
    }
  }
  s.avgPlantT = plantN ? plantSum / plantN : null;
  return s;
}

/** Callouts des premiers duels parmi les rounds donnés, du plus fréquent au moins fréquent. */
export function openingPlaces(views: RoundView[]): { place: string; count: number }[] {
  const c = new Map<string, number>();
  for (const v of views) if (v.openingPlace) c.set(v.openingPlace, (c.get(v.openingPlace) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([place, count]) => ({ place, count }));
}

/** Petit échantillon : en dessous, une tendance n'est pas fiable. */
export const SMALL_SAMPLE = 8;

/** Rounds retenus, par clé roundKey, avec les équipes dont le point de vue passe les filtres. */
export function keptRounds(views: RoundView[]): Map<string, Set<TeamIdx>> {
  const out = new Map<string, Set<TeamIdx>>();
  for (const v of views) {
    const k = roundKey(v.match.id, v.round.i);
    let s = out.get(k);
    if (!s) out.set(k, (s = new Set()));
    s.add(v.team);
  }
  return out;
}

// --- Tendances : habitude ou coup isolé ---

export type TrendLevel = 'habit' | 'recurring' | 'oneoff';

export interface Trend {
  key: string;
  rounds: number;
  /** Rounds où l'événement aurait pu se produire (dénominateur). */
  of: number;
  maps: number;
  totalMaps: number;
  /** Rounds gagnés quand la tendance se produit. */
  won: number;
  level: TrendLevel;
}

/** Habitude = revient sur la majorité des cartes ; coup isolé = une seule carte. */
export function trendLevel(maps: number, totalMaps: number, rounds: number): TrendLevel {
  if (maps >= 3 && maps / totalMaps >= 0.5 && rounds >= 4) return 'habit';
  if (maps >= 2) return 'recurring';
  return 'oneoff';
}

function collect(views: RoundView[], keysOf: (v: RoundView) => string[]): Trend[] {
  const totalMaps = new Set(views.map((v) => v.match.id)).size;
  const acc = new Map<string, { rounds: number; maps: Set<string>; won: number }>();
  for (const v of views) {
    for (const k of new Set(keysOf(v))) {
      let a = acc.get(k);
      if (!a) acc.set(k, (a = { rounds: 0, maps: new Set(), won: 0 }));
      a.rounds++;
      a.maps.add(v.match.id);
      if (v.won) a.won++;
    }
  }
  return [...acc.entries()]
    .map(([key, a]) => ({ key, rounds: a.rounds, of: views.length, maps: a.maps.size, totalMaps, won: a.won, level: trendLevel(a.maps.size, totalMaps, a.rounds) }))
    .sort((a, b) => b.rounds - a.rounds);
}

export interface Tendencies {
  /** Où a lieu le premier duel (callout de la victime). */
  openings: Trend[];
  /** Site de plant (rounds T). */
  plants: Trend[];
  /** Callouts occupés par l'équipe 20 s après le freeze (setups par défaut). */
  setups: { ct: Trend[]; t: Trend[] };
}

export function tendencies(views: RoundView[]): Tendencies {
  const tViews = views.filter((v) => v.side === 't');
  const setupKeys = (v: RoundView) => {
    const sp = v.match.spatial!;
    const places = sp.places ?? [];
    return sp.pos.filter((p) => p.r === v.round.i && p.team === v.team && p.s === 20 && p.pl != null && p.pl >= 0).map((p) => places[p.pl!]);
  };
  return {
    openings: collect(views.filter((v) => v.openingPlace), (v) => [v.openingPlace]),
    plants: collect(tViews, (v) => (v.round.plantSite ? [v.round.plantSite] : [])),
    setups: { ct: collect(views.filter((v) => v.side === 'ct'), setupKeys), t: collect(tViews, setupKeys) },
  };
}
