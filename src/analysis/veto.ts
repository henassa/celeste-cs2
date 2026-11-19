// Map pool et vetos : forces de chaque équipe par carte (taux de rounds gagnés, ramené vers 50 %
// quand l'échantillon est petit), comparaison face à un adversaire et simulation d'un veto BO1 / BO3.
// Les démos ne contiennent pas les picks et bans réels : tout part des cartes jouées.

import type { LibraryMatch } from '../library/library';
import type { Subject } from './heatmap';
import { teamIn } from './brief';

export interface Ratio { won: number; played: number }

export interface MapStat {
  map: string;
  /** Cartes jouées et gagnées. */
  matches: number;
  wins: number;
  ties: number;
  rounds: Ratio;
  ct: Ratio;
  t: Ratio;
  lastPlayed: number | null;
  /** Force estimée : taux de rounds gagnés ramené vers 50 % (24 rounds fictifs à 50 %). */
  strength: number;
}

/** Rounds fictifs à 50 % ajoutés pour stabiliser les petits échantillons (≈ une carte). */
export const PRIOR_ROUNDS = 24;
/** Force supposée sur une carte jamais jouée : un peu sous 50 %, une équipe évite ce qu'elle ne joue pas. */
export const UNPLAYED_STRENGTH = 0.45;

export function mapPool(matches: LibraryMatch[], subject: Subject): Map<string, MapStat> {
  const out = new Map<string, MapStat>();
  if (subject.kind === 'all') return out;
  for (const m of matches) {
    const me = teamIn(m, subject);
    if (me === null) continue;
    let s = out.get(m.map);
    if (!s) out.set(m.map, (s = { map: m.map, matches: 0, wins: 0, ties: 0, rounds: { won: 0, played: 0 }, ct: { won: 0, played: 0 }, t: { won: 0, played: 0 }, lastPlayed: null, strength: 0.5 }));
    s.matches++;
    if (m.score[me] > m.score[1 - me]) s.wins++; else if (m.score[me] === m.score[1 - me]) s.ties++;
    s.lastPlayed = Math.max(s.lastPlayed ?? 0, m.date);
    if (m.spatial) {
      for (const r of m.spatial.rounds) {
        const won = r.winner === me ? 1 : 0;
        const side = r.ctTeam === me ? s.ct : s.t;
        side.played++; side.won += won;
        s.rounds.played++; s.rounds.won += won;
      }
    } else {
      // Sans résumé spatial : seulement le score final
      s.rounds.played += m.score[0] + m.score[1];
      s.rounds.won += m.score[me];
    }
  }
  for (const s of out.values()) s.strength = (s.rounds.won + PRIOR_ROUNDS / 2) / (s.rounds.played + PRIOR_ROUNDS);
  return out;
}

export const strengthOf = (s: MapStat | undefined) => (s ? s.strength : UNPLAYED_STRENGTH);

export interface MapRow {
  map: string;
  us?: MapStat;
  them?: MapStat;
  /** Avantage estimé : force(nous) − force(eux), en points de taux de rounds. */
  edge: number;
  /** Les deux équipes ont assez joué la carte pour que l'écart veuille dire quelque chose. */
  reliable: boolean;
}

export function compareMaps(pool: string[], us: Map<string, MapStat>, them: Map<string, MapStat>): MapRow[] {
  return pool.map((map) => {
    const a = us.get(map), b = them.get(map);
    return { map, us: a, them: b, edge: strengthOf(a) - strengthOf(b), reliable: (a?.rounds.played ?? 0) >= 30 && (b?.rounds.played ?? 0) >= 30 };
  }).sort((x, y) => y.edge - x.edge);
}

export type VetoFormat = 'bo1' | 'bo3';
export interface VetoStep { team: 'us' | 'them' | null; action: 'ban' | 'pick' | 'decider'; map: string; edge: number }

/** Ordre standard des vetos (7 cartes). */
const ORDER: Record<VetoFormat, ('ban' | 'pick')[]> = {
  bo1: ['ban', 'ban', 'ban', 'ban', 'ban', 'ban'],
  bo3: ['ban', 'ban', 'pick', 'pick', 'ban', 'ban'],
};

/**
 * Veto simulé : chaque équipe bannit la carte la plus défavorable pour elle et choisit la plus
 * favorable, d'après les forces estimées. La dernière carte restante est le decider.
 */
export function simulateVeto(rows: MapRow[], format: VetoFormat, first: 'us' | 'them'): VetoStep[] {
  const left = new Map(rows.map((r) => [r.map, r]));
  const steps: VetoStep[] = [];
  let team: 'us' | 'them' = first;
  for (const action of ORDER[format]) {
    if (left.size <= 1) break;
    // Pour nous : on bannit le plus petit avantage, on choisit le plus grand. Pour eux : l'inverse.
    // À égalité : on choisit la carte qu'on a le plus jouée, on bannit celle qu'on a le moins jouée.
    const wantHigh = (action === 'pick') === (team === 'us');
    const exp = (r: MapRow) => ((team === 'us' ? r.us : r.them)?.rounds.played ?? 0);
    const better = (a: MapRow, b: MapRow) => {
      if (Math.abs(a.edge - b.edge) > 1e-9) return wantHigh ? a.edge > b.edge : a.edge < b.edge;
      return action === 'pick' ? exp(a) > exp(b) : exp(a) < exp(b);
    };
    const best = [...left.values()].reduce((x, y) => (better(y, x) ? y : x));
    steps.push({ team, action, map: best.map, edge: best.edge });
    left.delete(best.map);
    team = team === 'us' ? 'them' : 'us';
  }
  for (const r of left.values()) steps.push({ team: null, action: 'decider', map: r.map, edge: r.edge });
  return steps;
}
