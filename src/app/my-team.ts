// Mon équipe : nom, logo et joueurs (par SteamID), déclarés une fois. Sert au tableau de bord,
// au menu latéral et à tout ce qui oppose « nous » à « eux ». Gardé dans ce navigateur.

import { useSyncExternalStore } from 'react';
import type { LibraryMatch } from '@/library/library';
import { activeProfile, subscribeProfiles, updateActiveProfile } from './profiles';

export interface MyTeam {
  name: string;
  /** Logo en data URL (redimensionné à 128 px). */
  logo: string | null;
  players: { steamid: string; name: string }[];
}

// Mon équipe = le profil d'équipe actif (voir profiles.ts)
let snapshot: MyTeam | null = null;
const snap = (): MyTeam => {
  const p = activeProfile();
  if (!snapshot || snapshot.name !== p.name || snapshot.logo !== p.logo || snapshot.players !== p.players) snapshot = { name: p.name, logo: p.logo, players: p.players };
  return snapshot;
};
export const getMyTeam = () => snap();
export function setMyTeam(patch: Partial<MyTeam>): void { updateActiveProfile(patch); }
export const useMyTeam = () => useSyncExternalStore(subscribeProfiles, snap);
export const hasTeam = (t: MyTeam) => t.players.length > 0;

/**
 * Notre côté dans un match : l'équipe (0 ou 1) qui compte au moins 3 de nos joueurs
 * (ou la majorité s'il en reste moins de 3 de déclarés). null : nous ne jouons pas ce match.
 */
export function ourSide(m: LibraryMatch, team: MyTeam): 0 | 1 | null {
  if (!team.players.length) return null;
  const ids = new Set(team.players.map((p) => p.steamid));
  const n = [0, 0];
  for (const p of m.players) if (ids.has(p.steamid)) n[p.team]++;
  const need = Math.min(3, team.players.length);
  if (n[0] >= need && n[0] >= n[1]) return 0;
  if (n[1] >= need) return 1;
  return null;
}

/** Image -> data URL carrée de 128 px (logo). */
export function resizeLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d')!;
      const k = Math.min(128 / img.width, 128 / img.height);
      const w = img.width * k, h = img.height * k;
      ctx.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
