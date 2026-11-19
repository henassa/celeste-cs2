// Équipes détectées automatiquement (effectifs qui partagent au moins 3 joueurs) et leurs tendances.

import type { GrenadeKind } from '../data/types';
import { hasSpatial, type LibraryMatch } from '../library/library';
import type { BuyType, TeamIdx } from '../library/spatial';

export interface TeamGroup {
  id: string;
  name: string;
  /** Joueurs, du plus présent au moins présent. */
  players: { steamid: string; name: string; matches: number }[];
  /** Matchs de l'équipe et son index (0/1) dans chacun. */
  entries: { matchId: string; team: TeamIdx }[];
}

const GENERIC = /^(team ?[ab12]?|team_.*|terrorists?|counter-terrorists?|ct|t)$/i;

export function detectTeams(matches: LibraryMatch[]): TeamGroup[] {
  interface Roster { matchId: string; team: TeamIdx; ids: Set<string>; name: string }
  const rosters: Roster[] = [];
  for (const m of matches) {
    for (const team of [0, 1] as TeamIdx[]) {
      const ids = new Set(m.stats.all.filter((s) => m.players[s.player]?.team === team && s.rounds >= 5).map((s) => m.players[s.player].steamid).filter((x) => x && x !== '0'));
      if (ids.size >= 3) rosters.push({ matchId: m.id, team, ids, name: m.teams[team] });
    }
  }
  // Union-find : deux effectifs avec ≥ 3 joueurs en commun = même équipe
  const parent = rosters.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < rosters.length; i++) {
    for (let j = i + 1; j < rosters.length; j++) {
      if (rosters[i].matchId === rosters[j].matchId) continue;
      let common = 0;
      for (const id of rosters[i].ids) if (rosters[j].ids.has(id)) common++;
      if (common >= 3) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Roster[]>();
  rosters.forEach((r, i) => { const k = find(i); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); });

  const names = new Map<string, string>();
  for (const m of matches) for (const p of m.players) names.set(p.steamid, p.name);

  const out: TeamGroup[] = [];
  for (const rs of groups.values()) {
    const count = new Map<string, number>();
    for (const r of rs) for (const id of r.ids) count.set(id, (count.get(id) ?? 0) + 1);
    const players = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([steamid, n]) => ({ steamid, name: names.get(steamid) ?? steamid, matches: n }));
    const nameVotes = new Map<string, number>();
    for (const r of rs) if (r.name && !GENERIC.test(r.name.trim())) nameVotes.set(r.name, (nameVotes.get(r.name) ?? 0) + 1);
    const best = [...nameVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const name = best ?? players.slice(0, 3).map((p) => p.name).join(', ');
    out.push({ id: players.slice(0, 5).map((p) => p.steamid).sort().join('-'), name, players, entries: rs.map((r) => ({ matchId: r.matchId, team: r.team })) });
  }
  return out.sort((a, b) => b.entries.length - a.entries.length || a.name.localeCompare(b.name));
}

export interface Ratio { won: number; played: number }
const ratio = (): Ratio => ({ won: 0, played: 0 });
export const pct = (r: Ratio) => (r.played ? (r.won / r.played) * 100 : null);

export interface TeamReport {
  matches: number;
  record: { won: number; lost: number; tied: number };
  maps: { map: string; matches: number; won: number; rounds: Ratio; ct: Ratio; t: Ratio }[];
  rounds: Ratio;
  ct: Ratio;
  t: Ratio;
  pistol: Ratio;
  buys: Record<BuyType, Ratio>;
  /** Rounds où l'équipe fait le premier kill / le subit. */
  openingKill: Ratio;
  openingDeath: Ratio;
  /** Côté T : plants et répartition des sites. */
  tRounds: number;
  plants: number;
  sites: { A: number; B: number };
  postPlant: Ratio;
  /** Côté CT : bombe posée par l'adversaire, round sauvé quand même. */
  retakes: Ratio;
  /** Utilitaires lancés par round, par type. */
  utility: Record<GrenadeKind, number>;
  /** Matchs sans résumé spatial (à réimporter). */
  skipped: number;
}

export function teamReport(group: TeamGroup, matches: LibraryMatch[], mapFilter?: string): TeamReport {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const rep: TeamReport = {
    matches: 0, record: { won: 0, lost: 0, tied: 0 }, maps: [], rounds: ratio(), ct: ratio(), t: ratio(), pistol: ratio(),
    buys: { pistol: ratio(), eco: ratio(), force: ratio(), full: ratio() }, openingKill: ratio(), openingDeath: ratio(),
    tRounds: 0, plants: 0, sites: { A: 0, B: 0 }, postPlant: ratio(), retakes: ratio(),
    utility: { smoke: 0, flash: 0, he: 0, molotov: 0, decoy: 0 }, skipped: 0,
  };
  const maps = new Map<string, TeamReport['maps'][number]>();
  let roundsPlayed = 0;
  for (const e of group.entries) {
    const m = byId.get(e.matchId);
    if (!m || (mapFilter && m.map !== mapFilter)) continue;
    if (!hasSpatial(m)) { rep.skipped++; continue; }
    const sp = m.spatial!;
    const me = e.team, them = (1 - me) as TeamIdx;
    rep.matches++;
    if (m.score[me] > m.score[them]) rep.record.won++; else if (m.score[me] < m.score[them]) rep.record.lost++; else rep.record.tied++;
    let mm = maps.get(m.map);
    if (!mm) maps.set(m.map, (mm = { map: m.map, matches: 0, won: 0, rounds: ratio(), ct: ratio(), t: ratio() }));
    mm.matches++;
    if (m.score[me] > m.score[them]) mm.won++;
    for (const r of sp.rounds) {
      const won = r.winner === me ? 1 : 0;
      const isCt = r.ctTeam === me;
      roundsPlayed++;
      for (const x of [rep.rounds, mm.rounds, isCt ? rep.ct : rep.t, isCt ? mm.ct : mm.t]) { x.played++; x.won += won; }
      const b = r.buy[me];
      rep.buys[b].played++; rep.buys[b].won += won;
      if (b === 'pistol') { rep.pistol.played++; rep.pistol.won += won; }
      if (r.firstKill === me) { rep.openingKill.played++; rep.openingKill.won += won; }
      else if (r.firstKill === them) { rep.openingDeath.played++; rep.openingDeath.won += won; }
      if (!isCt) {
        rep.tRounds++;
        if (r.plantSite) { rep.plants++; rep.sites[r.plantSite]++; rep.postPlant.played++; rep.postPlant.won += won; }
      } else if (r.plantSite) { rep.retakes.played++; rep.retakes.won += won; }
    }
    for (const n of sp.nades) if (n.team === me) rep.utility[n.kind]++;
  }
  for (const k of Object.keys(rep.utility) as GrenadeKind[]) rep.utility[k] = roundsPlayed ? rep.utility[k] / roundsPlayed : 0;
  rep.maps = [...maps.values()].sort((a, b) => b.matches - a.matches);
  return rep;
}
