// Écran étroit (téléphone, petite fenêtre) : menu en tiroir au lieu de la colonne latérale.

import { useSyncExternalStore } from 'react';

const Q = '(max-width: 767px), (max-height: 500px)';
const mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(Q) : null;
export const useNarrow = () => useSyncExternalStore((l) => { mql?.addEventListener('change', l); return () => mql?.removeEventListener('change', l); }, () => !!mql?.matches);

/** Écran peu haut (téléphone en paysage) : on retire ce qui prend de la hauteur. */
const short = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-height: 500px)') : null;
export const useShort = () => useSyncExternalStore((l) => { short?.addEventListener('change', l); return () => short?.removeEventListener('change', l); }, () => !!short?.matches);
