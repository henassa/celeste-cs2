// Agrégats par joueur sur toute la bibliothèque (identité = SteamID), pondérés par les rounds joués.

import type { LibraryMatch } from '../library/library';
import type { PlayerStats, SideFilter } from '../stats/compute';
import { extrasForMatch, predictStats, type RatingModel } from '../calib/model';

export interface MatchLine {
  matchId: string;
  date: number;
  map: string;
  opponent: string;
  won: boolean | null;
  rounds: number;
  kills: number;
  deaths: number;
  adr: number;
  kast: number;
  rating2: number;
  rating3: number | null;
}

export interface PlayerAgg {
  steamid: string;
  name: string;
  matches: number;
  rounds: number;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  headshots: number;
  kastRounds: number;
  entryKills: number;
  entryDeaths: number;
  tradeKills: number;
  clutchWins: number;
  clutchAttempts: number;
  multi: number[];
  utilityDamage: number;
  flashAssists: number;
  enemiesFlashed: number;
  swingSum: number;
  r1Sum: number;
  r2Sum: number;
  r3Sum: number;
  r3Rounds: number;
  lines: MatchLine[];
  // Dérivés
  kd: number;
  adr: number;
  kast: number;
  hsPct: number;
  kpr: number;
  swing: number;
  rating1: number;
  rating2: number;
  rating3: number | null;
}

export interface PlayerFilter {
  map?: string;
  side?: SideFilter;
}

function empty(steamid: string, name: string): PlayerAgg {
  return {
    steamid, name, matches: 0, rounds: 0, kills: 0, deaths: 0, assists: 0, damage: 0, headshots: 0, kastRounds: 0,
    entryKills: 0, entryDeaths: 0, tradeKills: 0, clutchWins: 0, clutchAttempts: 0, multi: [0, 0, 0, 0, 0, 0],
    utilityDamage: 0, flashAssists: 0, enemiesFlashed: 0, swingSum: 0, r1Sum: 0, r2Sum: 0, r3Sum: 0, r3Rounds: 0, lines: [],
    kd: 0, adr: 0, kast: 0, hsPct: 0, kpr: 0, swing: 0, rating1: 0, rating2: 0, rating3: null,
  };
}

export function aggregatePlayers(matches: LibraryMatch[], filter: PlayerFilter = {}, model3?: RatingModel): PlayerAgg[] {
  const byId = new Map<string, PlayerAgg>();
  const side = filter.side ?? 'all';
  const sorted = [...matches].sort((a, b) => a.date - b.date);
  for (const m of sorted) {
    if (filter.map && m.map !== filter.map) continue;
    const list: PlayerStats[] = m.stats[side] ?? [];
    const allRounds = new Map(m.stats.all.map((x) => [x.player, x.rounds]));
    const extras = side === 'all' ? extrasForMatch(model3, m.spatial, (p) => allRounds.get(p) ?? 0) : new Map();
    for (const s of list) {
      const info = m.players[s.player];
      if (!info || !info.steamid || info.steamid === '0' || s.rounds <= 0) continue;
      let a = byId.get(info.steamid);
      if (!a) byId.set(info.steamid, (a = empty(info.steamid, info.name)));
      a.name = info.name; // dernier pseudo connu
      a.matches++;
      a.rounds += s.rounds;
      a.kills += s.kills; a.deaths += s.deaths; a.assists += s.assists; a.damage += s.damage; a.headshots += s.headshots;
      a.kastRounds += s.kastRounds; a.entryKills += s.entryKills; a.entryDeaths += s.entryDeaths; a.tradeKills += s.tradeKills;
      a.clutchWins += s.clutches.reduce((x, c) => x + c.wins, 0);
      a.clutchAttempts += s.clutches.reduce((x, c) => x + c.attempts, 0);
      s.multi.forEach((v, i) => { a.multi[i] += v; });
      a.utilityDamage += s.utilityDamage; a.flashAssists += s.flashAssists; a.enemiesFlashed += s.enemiesFlashed;
      a.swingSum += s.swingSum ?? 0;
      a.r1Sum += s.rating1 * s.rounds;
      a.r2Sum += s.rating2 * s.rounds;
      const r3 = model3 && Number.isFinite(s.ecoKpr) ? predictStats(model3, s, extras.get(s.player)) : null;
      if (r3 !== null && Number.isFinite(r3)) { a.r3Sum += r3 * s.rounds; a.r3Rounds += s.rounds; }
      const team = info.team;
      a.lines.push({
        matchId: m.id, date: m.date, map: m.map, opponent: m.teams[1 - team] ?? '',
        won: m.score[team] === m.score[1 - team] ? null : m.score[team] > m.score[1 - team],
        rounds: s.rounds, kills: s.kills, deaths: s.deaths, adr: s.adr, kast: s.kast, rating2: s.rating2, rating3: r3,
      });
    }
  }
  for (const a of byId.values()) {
    const R = a.rounds || 1;
    a.kd = a.deaths ? a.kills / a.deaths : a.kills;
    a.adr = a.damage / R;
    a.kast = (a.kastRounds / R) * 100;
    a.hsPct = a.kills ? (a.headshots / a.kills) * 100 : 0;
    a.kpr = a.kills / R;
    a.swing = (a.swingSum / R) * 100;
    a.rating1 = a.r1Sum / R;
    a.rating2 = a.r2Sum / R;
    a.rating3 = a.r3Rounds ? a.r3Sum / a.r3Rounds : null;
  }
  return [...byId.values()].sort((x, y) => y.rounds - x.rounds);
}
