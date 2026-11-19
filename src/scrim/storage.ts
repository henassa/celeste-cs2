// Stockage local des scrims (IndexedDB, une entrée par démo) et identifiant stable de démo.
// Rien ne quitte le navigateur.

import type { MatchData } from '../data/types';
import { SCRIM_FORMAT_VERSION, type ScrimDoc } from './types';
import { idbGet, idbPut, STORES } from '../lib/idb';
import { scopedIdbKey } from '../app/profiles';

/**
 * Identifiant stable d'une démo, identique pour le .dem et le .dem.zst :
 * carte, durée, joueurs et ticks des kills (pas la taille du fichier).
 */
export function demoId(m: MatchData): string {
  const parts = [
    m.header.map, m.lastTick, m.rounds.length,
    m.players.map((p) => p.steamid).sort().join(','),
    m.kills.slice(0, 40).map((k) => k.tick).join(','),
  ].join('|');
  // FNV-1a 64 bits (deux moitiés 32 bits), suffisant pour distinguer des démos
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < parts.length; i++) {
    const c = parts.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193 + 2) >>> 0;
  }
  return `${m.header.map}-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export async function loadScrim(id: string): Promise<ScrimDoc | null> {
  try {
    return await idbGet<ScrimDoc>(STORES.scrims, scopedIdbKey(id));
  } catch {
    return null; // IndexedDB indisponible (navigation privée stricte...) : on travaille en mémoire
  }
}

export async function saveScrim(doc: ScrimDoc): Promise<boolean> {
  try {
    await idbPut(STORES.scrims, scopedIdbKey(doc.demo.id), doc);
    return true;
  } catch {
    return false;
  }
}

/** Vérifie et normalise un fichier .scrim importé. */
export function parseScrimFile(text: string): ScrimDoc {
  const d = JSON.parse(text) as Partial<ScrimDoc>;
  if (!d || typeof d !== 'object' || !d.demo || !Array.isArray(d.annotations) || !Array.isArray(d.markers)) {
    throw new Error('Not a Celeste notes file.');
  }
  if ((d.version ?? 0) > SCRIM_FORMAT_VERSION) throw new Error('This notes file was made with a newer version of scrimview.');
  return {
    version: SCRIM_FORMAT_VERSION,
    demo: d.demo,
    annotations: d.annotations,
    markers: d.markers,
    roundNotes: d.roundNotes ?? {},
    playlist: Array.isArray(d.playlist) ? d.playlist.filter((c) => c && typeof c.fromTick === 'number' && typeof c.toTick === 'number') : [],
    updatedAt: d.updatedAt ?? Date.now(),
  };
}
