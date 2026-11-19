// Nade finder : mode demandé depuis la barre latérale ou la palette, lu par l'onglet Lineups.

import { useSyncExternalStore } from 'react';

export type FinderMode = 'off' | 'to' | 'from';
let mode: FinderMode = 'off';
const listeners = new Set<() => void>();
export const getFinderMode = () => mode;
export function setFinderMode(m: FinderMode): void { mode = m; for (const l of listeners) l(); }
export const useFinderMode = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, getFinderMode);
