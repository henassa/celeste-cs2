// Tableaux tactiques enregistrés dans le navigateur (IndexedDB). Rien n'est envoyé.

import { idbDelete, idbEntries, idbPut, STORES } from '../lib/idb';
import { inActiveScope, scopedIdbKey } from '../app/profiles';
import type { Board } from './types';

export async function saveBoard(b: Board): Promise<boolean> {
  try { await idbPut(STORES.boards, scopedIdbKey(b.id), b); return true; } catch { return false; }
}

export async function listBoards(): Promise<Board[]> {
  try { return (await idbEntries<Board>(STORES.boards)).filter(([k]) => inActiveScope(k)).map(([, b]) => b).filter((b) => b && Array.isArray(b.steps)).sort((a, b) => b.updatedAt - a.updatedAt); } catch { return []; }
}

export async function deleteBoard(id: string): Promise<void> {
  try { await idbDelete(STORES.boards, scopedIdbKey(id)); } catch { /* stockage indisponible */ }
}
