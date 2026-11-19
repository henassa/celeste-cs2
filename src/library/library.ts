// Bibliothèque locale : un résumé par match (stats calculées, pas les positions), stocké en IndexedDB.
// Permet l'import par lots de dossiers de démos sans rien garder de lourd, et sert de base
// à l'analyse multi-démos et à l'étalonnage des ratings.

import type { MatchData } from '../data/types';
import { computeStats, type PlayerStats } from '../stats/compute';
import { demoId } from '../scrim/storage';
import { idbAll, idbDelete, idbGet, idbPut, STORES } from '../lib/idb';
import { buildSpatial, SPATIAL_MIN_VERSION, SPATIAL_VERSION, type MatchSpatial } from './spatial';
import { tt } from '../i18n';

export type RefKind = 'faceit' | 'hltv3';

/** Version du calcul des stats : une entrée plus ancienne doit être réimportée pour l'étalonnage. */
export const STATS_VERSION = 2;

export const REF_LABEL: Record<RefKind, string> = { faceit: tt('FACEIT Rating'), hltv3: tt('HLTV Rating 3.0') };

export interface LibraryMatch {
  id: string;
  statsVersion?: number;
  fileName: string;
  map: string;
  /** Date du fichier démo (ms) : approximation de la date du match. */
  date: number;
  importedAt: number;
  source: 'faceit' | 'valve' | 'other';
  teams: [string, string];
  score: [number, number];
  rounds: number;
  players: { steamid: string; name: string; team: 0 | 1 }[];
  stats: { all: PlayerStats[]; ct: PlayerStats[]; t: PlayerStats[] };
  /** Résumé spatial (analyse multi-démos, heatmaps). Absent des entrées d'anciennes versions. */
  spatial?: MatchSpatial;
  /** Ratings de référence saisis par l'utilisateur, par SteamID. */
  refs: Partial<Record<RefKind, Record<string, number>>>;
  /** Stats d'aim et de duel par SteamID (calculées à la demande depuis la vue Stats). */
  aim?: Record<string, AimRecord>;
}

/** Stats d'aim conservées par joueur et par match (valeurs + échantillons pour les moyennes pondérées). */
export interface AimRecord {
  accuracy: number | null; stoppedPct: number | null; ttkMs: number | null; oneTapPct: number | null;
  firstHitWin: number | null; hitFirstWin: number | null; reactionMs: number | null; crosshairDeg: number | null;
  shots: number; duels: number; measured: number;
}

function guessSource(m: MatchData): LibraryMatch['source'] {
  const s = `${m.header.server} ${m.source.fileName}`.toLowerCase();
  if (s.includes('faceit')) return 'faceit';
  if (s.includes('valve') || m.source.fileName.startsWith('match730_')) return 'valve';
  return 'other';
}

export function summarize(m: MatchData, fileDate: number): LibraryMatch {
  const last = m.rounds[m.rounds.length - 1];
  return {
    id: demoId(m),
    statsVersion: STATS_VERSION,
    fileName: m.source.fileName,
    map: m.header.map,
    date: fileDate,
    importedAt: Date.now(),
    source: guessSource(m),
    teams: [m.teams[0].name, m.teams[1].name],
    score: last ? [last.scoreAfter[0], last.scoreAfter[1]] : [0, 0],
    rounds: m.rounds.length,
    players: m.players.map((p) => ({ steamid: p.steamid, name: p.name, team: p.team })),
    stats: { all: computeStats(m, 'all'), ct: computeStats(m, 'ct'), t: computeStats(m, 't') },
    spatial: buildSpatial(m),
    refs: {},
  };
}

/** Entrée trop ancienne : stats ou résumé spatial inutilisables, la démo doit être réimportée. */
export const isOutdated = (m: LibraryMatch) => (m.statsVersion ?? 1) < STATS_VERSION || (m.spatial?.version ?? 0) < SPATIAL_MIN_VERSION;
/** Entrée utilisable mais sans les derniers ajouts (callouts...) : réimporter la démo la complète. */
export const canRefresh = (m: LibraryMatch) => !isOutdated(m) && (m.spatial?.version ?? 0) < SPATIAL_VERSION;
export const hasSpatial = (m: LibraryMatch) => (m.spatial?.version ?? 0) >= SPATIAL_MIN_VERSION;

/** Ajoute ou met à jour un match, en conservant les ratings de référence déjà saisis. */
export async function saveMatch(entry: LibraryMatch): Promise<void> {
  try {
    const prev = await idbGet<LibraryMatch>(STORES.matches, entry.id);
    await idbPut(STORES.matches, entry.id, { ...entry, refs: prev?.refs ?? entry.refs, aim: entry.aim ?? prev?.aim, importedAt: prev?.importedAt ?? entry.importedAt });
  } catch { /* stockage indisponible : la bibliothèque reste vide */ }
}

const isReadable = (m: LibraryMatch) =>
  !!m && Array.isArray(m.teams) && Array.isArray(m.score) && Array.isArray(m.players) && !!m.stats && Array.isArray(m.stats.all);

/** Nombre d'entrées présentes mais illisibles (pour ne rien faire disparaître en silence). */
export async function countUnreadable(): Promise<number> {
  try { return (await idbAll<LibraryMatch>(STORES.matches)).filter((m) => !isReadable(m)).length; } catch { return 0; }
}

/** Sauvegarde complète de la bibliothèque (matchs, stats, ratings de référence). */
export async function exportLibrary(): Promise<string> {
  const all = await idbAll<LibraryMatch>(STORES.matches);
  return JSON.stringify({ app: 'scrimview', kind: 'library', version: 1, exportedAt: new Date().toISOString(), matches: all.filter(isReadable) });
}

/** Restaure une sauvegarde : ajoute les matchs absents, complète les ratings de référence des matchs présents. */
export async function importLibrary(text: string): Promise<number> {
  const d = JSON.parse(text);
  if (d?.app !== 'scrimview' || d?.kind !== 'library' || !Array.isArray(d.matches)) throw new Error('Not a Celeste library backup.');
  let n = 0;
  for (const m of d.matches as LibraryMatch[]) {
    if (!isReadable(m) || typeof m.id !== 'string') continue;
    const prev = await idbGet<LibraryMatch>(STORES.matches, m.id);
    const keep = prev && isReadable(prev) && (prev.statsVersion ?? 1) >= (m.statsVersion ?? 1) ? prev : m;
    await idbPut(STORES.matches, m.id, { ...keep, refs: { ...m.refs, ...prev?.refs } });
    n++;
  }
  return n;
}

export async function listMatches(): Promise<LibraryMatch[]> {
  try {
    const all = await idbAll<LibraryMatch>(STORES.matches);
    // Entrées d'anciennes versions ou incomplètes : ignorées (réimporter la démo les met à jour)
    return all
      .filter(isReadable)
      .map((m) => ({ ...m, refs: m.refs ?? {} }))
      .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  } catch {
    return [];
  }
}

export async function setRefs(id: string, kind: RefKind, values: Record<string, number>): Promise<void> {
  const m = await idbGet<LibraryMatch>(STORES.matches, id);
  if (!m) return;
  const refs = { ...m.refs };
  if (Object.keys(values).length) refs[kind] = values; else delete refs[kind];
  await idbPut(STORES.matches, id, { ...m, refs });
}

/** Enregistre les stats d'aim d'un match (en gardant le reste de l'entrée). */
export async function setAim(id: string, aim: Record<string, AimRecord>): Promise<void> {
  try {
    const m = await idbGet<LibraryMatch>(STORES.matches, id);
    if (m) await idbPut(STORES.matches, id, { ...m, aim });
  } catch { /* stockage indisponible */ }
}

export async function deleteMatch(id: string): Promise<void> {
  await idbDelete(STORES.matches, id);
}
