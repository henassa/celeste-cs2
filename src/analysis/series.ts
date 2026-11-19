// Séries BO3 / BO5 : regroupe les cartes jouées entre les deux mêmes effectifs (3 joueurs communs
// ou plus de chaque côté), à quelques heures d'intervalle ou nommées « ...-m1 », « ...-m2 ».

import type { LibraryMatch } from '../library/library';
import type { TeamIdx } from '../library/spatial';

export interface SeriesMap {
  match: LibraryMatch;
  /** Index, dans ce match, de l'équipe A de la série. */
  teamA: TeamIdx;
  scoreA: number;
  scoreB: number;
}

export interface Series {
  id: string;
  teams: [string, string];
  maps: SeriesMap[];
  /** Cartes gagnées par A et par B. */
  score: [number, number];
  date: number;
  /** BO3 / BO5 selon le nombre de cartes et le score. */
  format: 'BO2' | 'BO3' | 'BO5';
}

const WINDOW_MS = 8 * 3600 * 1000;
const roster = (m: LibraryMatch, t: TeamIdx) => new Set(m.stats.all.filter((s) => m.players[s.player]?.team === t && s.rounds >= 5).map((s) => m.players[s.player].steamid));
const overlap = (a: Set<string>, b: Set<string>) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };
/** Préfixe de série dans le nom de fichier : « spirit-vs-mouz-m2-ancient.dem » -> « spirit-vs-mouz ». */
const seriesPrefix = (name: string) => name.toLowerCase().match(/^(.+?)[-_ ]m(?:ap)?[1-5]\b/)?.[1] ?? null;

/** Orientation d'un match par rapport à un autre : quelle équipe correspond à l'équipe 0 du premier. */
function align(a: LibraryMatch, b: LibraryMatch): TeamIdx | null {
  const a0 = roster(a, 0), a1 = roster(a, 1), b0 = roster(b, 0), b1 = roster(b, 1);
  if (overlap(a0, b0) >= 3 && overlap(a1, b1) >= 3) return 0;
  if (overlap(a0, b1) >= 3 && overlap(a1, b0) >= 3) return 1;
  return null;
}

export function detectSeries(matches: LibraryMatch[]): Series[] {
  const sorted = [...matches].sort((a, b) => a.date - b.date || a.fileName.localeCompare(b.fileName));
  const used = new Set<string>();
  const out: Series[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const first = sorted[i];
    if (used.has(first.id)) continue;
    const maps: SeriesMap[] = [{ match: first, teamA: 0, scoreA: first.score[0], scoreB: first.score[1] }];
    const prefix = seriesPrefix(first.fileName);
    for (let j = i + 1; j < sorted.length; j++) {
      const m = sorted[j];
      if (used.has(m.id) || maps.some((x) => x.match.map === m.map)) continue;
      const near = Math.abs(m.date - maps[maps.length - 1].match.date) < WINDOW_MS;
      const samePrefix = prefix !== null && seriesPrefix(m.fileName) === prefix;
      if (!near && !samePrefix) continue;
      const a = align(first, m);
      if (a === null) continue;
      maps.push({ match: m, teamA: a, scoreA: m.score[a], scoreB: m.score[1 - a] });
      if (maps.length === 5) break;
    }
    if (maps.length < 2) continue;
    for (const x of maps) used.add(x.match.id);
    // Ordre des cartes : numéro m1/m2 du fichier s'il existe, sinon date
    const num = (x: SeriesMap) => Number(x.match.fileName.toLowerCase().match(/[-_ ]m(?:ap)?([1-5])\b/)?.[1] ?? 0);
    maps.sort((a, b) => (num(a) && num(b) ? num(a) - num(b) : a.match.date - b.match.date));
    const score: [number, number] = [0, 0];
    for (const x of maps) { if (x.scoreA > x.scoreB) score[0]++; else if (x.scoreB > x.scoreA) score[1]++; }
    const best = Math.max(...score);
    const format = maps.length >= 4 || best >= 3 ? 'BO5' : maps.length === 2 && score[0] === 1 && score[1] === 1 ? 'BO2' : 'BO3';
    out.push({ id: maps.map((x) => x.match.id).join('+'), teams: [first.teams[0], first.teams[1]], maps, score, date: maps[0].match.date, format });
  }
  return out.sort((a, b) => b.date - a.date);
}

/** Matchs d'une série avec, pour chacun, les stats limitées à une équipe (A = 0, B = 1). */
export function seriesTeamMatches(s: Series, side: TeamIdx): LibraryMatch[] {
  return s.maps.map((x) => {
    const team = (side === 0 ? x.teamA : 1 - x.teamA) as TeamIdx;
    const keep = (list: LibraryMatch['stats']['all']) => list.filter((st) => x.match.players[st.player]?.team === team);
    return { ...x.match, stats: { all: keep(x.match.stats.all), ct: keep(x.match.stats.ct), t: keep(x.match.stats.t) } };
  });
}
