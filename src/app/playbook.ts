// Playbook : les stratégies de l'équipe par map (defaults, executes, retakes…), chacune avec ses rôles,
// ses utilitaires (setpos), ses boards et des moments de démos où elle a été jouée.

import { scopedKey } from './profiles';
import { createLocalStore, newLocalId } from './local-store';
import { tt } from '../i18n';

export type PlayType = 'default' | 'execute' | 'retake' | 'setup' | 'pistol' | 'anti-eco' | 'other';
export const PLAY_TYPE: Record<PlayType, string> = { default: tt('Default'), execute: tt('Execute'), retake: tt('Retake'), setup: tt('Setup / hold'), pistol: tt('Pistol'), 'anti-eco': tt('Anti-eco'), other: tt('Other') };

export interface PlayClip { id: string; demoId: string; fileName: string; round: number; tick: number; label: string }
export interface Play {
  id: string;
  map: string;
  side: 'ct' | 't';
  type: PlayType;
  name: string;
  /** Le call, le timing, les variantes. */
  description: string;
  /** Rôle de chaque joueur (5 lignes). */
  roles: string[];
  utility: { id: string; label: string; setpos: string }[];
  boardIds: string[];
  clips: PlayClip[];
  /** Anti-strat : l'équipe adverse visée (vide = strat générale). */
  opponent?: string;
  updatedAt: number;
}

export const playbookStore = createLocalStore<Play[]>(scopedKey('scrimview.playbook'), [], Array.isArray);

export function newPlay(map: string, side: 'ct' | 't' = 't'): Play {
  return { id: newLocalId(), map, side, type: 'execute', name: '', description: '', roles: ['', '', '', '', ''], utility: [], boardIds: [], clips: [], updatedAt: Date.now() };
}
export function savePlay(p: Play): void {
  const next = { ...p, updatedAt: Date.now() };
  playbookStore.set((all) => (all.some((x) => x.id === p.id) ? all.map((x) => (x.id === p.id ? next : x)) : [...all, next]));
}
export function addClip(playId: string, clip: Omit<PlayClip, 'id'>): void {
  playbookStore.set((all) => all.map((p) => (p.id === playId ? { ...p, clips: [...p.clips, { ...clip, id: newLocalId() }], updatedAt: Date.now() } : p)));
}

/** Strat à sélectionner à la prochaine ouverture du playbook (créée depuis une autre page). */
let pendingId: string | null = null;
export const selectPlayLater = (id: string) => { pendingId = id; };
export const takePendingPlay = () => { const id = pendingId; pendingId = null; return id; };

/** Fichier de playbook à partager avec l'équipe. */
export const exportPlaybook = (plays: Play[]) => JSON.stringify({ app: 'scrimview', kind: 'playbook', version: 1, exportedAt: new Date().toISOString(), plays }, null, 1);
/** Ajoute les stratégies d'un fichier (remplace celles de même identifiant). Renvoie le nombre importé. */
export function importPlaybook(text: string): number {
  const d = JSON.parse(text);
  if (d?.app !== 'scrimview' || d?.kind !== 'playbook' || !Array.isArray(d.plays)) throw new Error('Not a Celeste playbook file.');
  const plays = (d.plays as Play[]).filter((p) => p && typeof p.id === 'string' && typeof p.map === 'string');
  playbookStore.set((all) => [...all.filter((x) => !plays.some((p) => p.id === x.id)), ...plays.map((p) => ({ ...newPlay(p.map), ...p }))]);
  return plays.length;
}
