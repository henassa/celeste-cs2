// Notes de préparation par adversaire et par carte (le plan de jeu), gardées dans ce navigateur.

import { scopedKey } from './profiles';
import { createLocalStore } from './local-store';

export interface PrepNotes { team: string; notes: Record<string, string>; updatedAt: number }

export const prepStore = createLocalStore<Record<string, PrepNotes>>(scopedKey('scrimview.prep'), {}, (v) => !!v && typeof v === 'object' && !Array.isArray(v));

export const prepKey = (teamName: string) => teamName.trim().toLowerCase();

export function setPrepNote(teamName: string, map: string, text: string): void {
  const k = prepKey(teamName);
  prepStore.set((all) => ({ ...all, [k]: { team: teamName, notes: { ...(all[k]?.notes ?? {}), [map]: text }, updatedAt: Date.now() } }));
}

/** Fichier de prépa à partager avec l'équipe : notes, Markdown complet. */
export function exportPrep(teamName: string, markdown: string): string {
  return JSON.stringify({ app: 'celeste', kind: 'match-prep', version: 1, exportedAt: new Date().toISOString(), team: teamName, notes: prepStore.get()[prepKey(teamName)]?.notes ?? {}, markdown }, null, 1);
}

/** Importe un fichier de prépa : ses notes rejoignent celles de l'adversaire (les notes vides ne remplacent rien). */
export function importPrep(text: string): { team: string; maps: number } {
  const v = JSON.parse(text);
  if (!v || v.kind !== 'match-prep' || typeof v.team !== 'string' || typeof v.notes !== 'object') throw new Error('Not a Celeste match prep file.');
  let n = 0;
  for (const [map, note] of Object.entries(v.notes as Record<string, unknown>)) {
    if (typeof note !== 'string' || !note.trim()) continue;
    const cur = prepStore.get()[prepKey(v.team)]?.notes[map]?.trim();
    setPrepNote(v.team, map, cur && cur !== note.trim() ? `${cur}\n\n${note.trim()}` : note.trim());
    n++;
  }
  return { team: v.team, maps: n };
}
