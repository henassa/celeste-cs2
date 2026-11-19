// Cartes de résumé d'un match : série la plus longue, joueur le plus décisif, rounds gagnés
// en infériorité économique, pression par site. Tout est calculé en local à partir de la démo.

import type { MatchData, TeamIndex } from '../data/types';
import { buildSpatial, type BuyType } from '../library/spatial';
import type { PlayerStats } from './compute';

export interface Streak { team: TeamIndex; length: number; from: number; to: number }

export interface EcoUpset { round: number; winner: TeamIndex; winnerBuy: BuyType; loserBuy: BuyType }

export interface SitePressure {
  team: TeamIndex;
  tRounds: number;
  plants: { A: number; B: number };
  /** Rounds T gagnés après avoir posé la bombe. */
  postPlantWon: number;
  /** Premier kill en T (prise d'initiative). */
  openingsWon: number;
}

export interface MatchInsights {
  streak: Streak | null;
  /** Retour au score le plus important (écart rattrapé par l'équipe qui menait le moins). */
  comeback: { team: TeamIndex; deficit: number; atRound: number } | null;
  impact: { player: number; swing: number; rating: number; runnerUp: number | null } | null;
  upsets: EcoUpset[];
  sites: [SitePressure, SitePressure];
}

const STRONG: Record<BuyType, number> = { pistol: 1, eco: 0, force: 1, full: 2 };

export function computeInsights(m: MatchData, stats: PlayerStats[]): MatchInsights {
  const sp = buildSpatial(m);

  // Série la plus longue et plus gros retour au score
  let streak: Streak | null = null;
  let cur: Streak | null = null;
  let comeback: MatchInsights['comeback'] = null;
  const maxDeficit: [number, number] = [0, 0];
  for (const r of m.rounds) {
    if (r.winnerTeam === null) { cur = null; continue; }
    if (cur && cur.team === r.winnerTeam) { cur.length++; cur.to = r.number; } else cur = { team: r.winnerTeam, length: 1, from: r.number, to: r.number };
    if (!streak || cur.length > streak.length) streak = { ...cur };
    const [a, b] = r.scoreAfter;
    maxDeficit[0] = Math.max(maxDeficit[0], b - a);
    maxDeficit[1] = Math.max(maxDeficit[1], a - b);
  }
  const last = m.rounds[m.rounds.length - 1];
  if (last) {
    const [a, b] = last.scoreAfter;
    const winner: TeamIndex | null = a > b ? 0 : b > a ? 1 : null;
    if (winner !== null && maxDeficit[winner] >= 3) {
      // Round où l'écart était maximal
      const at = m.rounds.find((r) => (winner === 0 ? r.scoreAfter[1] - r.scoreAfter[0] : r.scoreAfter[0] - r.scoreAfter[1]) === maxDeficit[winner]);
      comeback = { team: winner, deficit: maxDeficit[winner], atRound: at?.number ?? 0 };
    }
  }

  // Joueur le plus décisif : swing moyen par round (puis rating 2.0 en cas d'égalité)
  const ranked = stats.filter((s) => s.rounds >= Math.min(10, m.rounds.length / 2)).sort((a, b) => (b.swing - a.swing) || (b.rating2 - a.rating2));
  const impact = ranked[0] ? { player: ranked[0].player, swing: ranked[0].swing, rating: ranked[0].rating2, runnerUp: ranked[1]?.player ?? null } : null;

  // Rounds gagnés avec un achat plus faible que l'adversaire (hors pistols)
  const upsets: EcoUpset[] = [];
  for (const r of sp.rounds) {
    if (r.winner === null || r.buy[0] === 'pistol') continue;
    const w = r.winner, l = (1 - w) as TeamIndex;
    if (STRONG[r.buy[w]] < STRONG[r.buy[l]]) upsets.push({ round: r.i + 1, winner: w, winnerBuy: r.buy[w], loserBuy: r.buy[l] });
  }

  // Pression par site côté T
  const sites = ([0, 1] as TeamIndex[]).map((team): SitePressure => {
    const s: SitePressure = { team, tRounds: 0, plants: { A: 0, B: 0 }, postPlantWon: 0, openingsWon: 0 };
    for (const r of sp.rounds) {
      if (r.ctTeam === team) continue;
      s.tRounds++;
      if (r.firstKill === team) s.openingsWon++;
      if (r.plantSite) {
        s.plants[r.plantSite]++;
        if (r.winner === team) s.postPlantWon++;
      }
    }
    return s;
  }) as [SitePressure, SitePressure];

  return { streak, comeback, impact, upsets, sites };
}
