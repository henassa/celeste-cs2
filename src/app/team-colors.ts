// Couleurs des joueurs : par camp (CT / T, par défaut le monochrome de l'appli) ou par équipe
// (chaque équipe garde sa couleur après le changement de côté). Appliquées en réécrivant les
// variables CSS des camps : radar 2D, vue 3D, panneaux, kill feed suivent sans autre changement.

import { useSyncExternalStore } from 'react';
import type { MatchData } from '@/data/types';
import { invalidateRenderTheme } from '@/viewer/theme';

export interface TeamColors {
  by: 'side' | 'team';
  /** Camp CT ou équipe 1 (gauche) ; null : couleur par défaut. */
  a: string | null;
  /** Camp T ou équipe 2 (droite) ; null : couleur par défaut. */
  b: string | null;
}

export const COLOR_SWATCHES = ['#fafafa', '#737373', '#404040', '#60a5fa', '#f59e0b', '#ef4444', '#22c55e', '#a855f7', '#facc15', '#ec4899', '#2dd4bf'] as const;
/** Teintes par défaut (celles du thème) : clair pour CT / équipe 1, sombre pour T / équipe 2. */
export const DEFAULT_A = '#fafafa', DEFAULT_B = '#404040';

const KEY = 'scrimview.teamColors';
const listeners = new Set<() => void>();
let current: TeamColors = (() => {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (v && (v.by === 'side' || v.by === 'team')) return v; } catch { /* stockage indisponible */ }
  return { by: 'side', a: null, b: null };
})();

export const getTeamColors = () => current;
export function setTeamColors(patch: Partial<TeamColors>): void {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* */ }
  for (const l of listeners) l();
}
export const subscribeTeamColors = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useTeamColors = () => useSyncExternalStore(subscribeTeamColors, getTeamColors);

/** Luminance relative (0 sombre .. 1 clair) d'une couleur #rrggbb. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** Mélange vers le blanc (texte lisible sur fond sombre). */
function lighten(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const m = (v: number) => Math.round(v + (255 - v) * k).toString(16).padStart(2, '0');
  return `#${m((n >> 16) & 255)}${m((n >> 8) & 255)}${m(n & 255)}`;
}

const VARS = (side: 'ct' | 't') => [`--${side}`, `--${side}-ink`, `--${side}-ring`, `--${side}-bar`, `--${side}-text`];

function paintSide(side: 'ct' | 't', hex: string | null): void {
  const st = document.documentElement.style;
  if (!hex) { for (const v of VARS(side)) st.removeProperty(v); return; }
  const light = luminance(hex) > 0.35;
  st.setProperty(`--${side}`, hex);
  st.setProperty(`--${side}-ink`, light ? '#0a0a0a' : '#fafafa');
  st.setProperty(`--${side}-ring`, light ? '#0a0a0a' : '#e5e5e5');
  st.setProperty(`--${side}-bar`, luminance(hex) < 0.08 ? lighten(hex, 0.45) : hex);
  st.setProperty(`--${side}-text`, luminance(hex) < 0.2 ? lighten(hex, 0.55) : hex);
}

let applied = '';
/** Couleurs CT / T effectivement affichées. */
export function applySideColors(ct: string | null, t: string | null): void {
  if (typeof document === 'undefined') return;
  const key = `${ct}|${t}`;
  if (key === applied) return;
  applied = key;
  paintSide('ct', ct);
  paintSide('t', t);
  invalidateRenderTheme();
}

/**
 * Applique le réglage au round affiché : par équipe, l'équipe côté CT ce round-là donne sa couleur au camp CT.
 * Sans match (bibliothèque, analyse) : couleurs par camp seulement.
 */
export function syncTeamColors(match?: MatchData, roundIndex = 0): void {
  const s = current;
  if (s.by === 'side' || !match) { applySideColors(s.by === 'side' ? s.a : null, s.by === 'side' ? s.b : null); return; }
  const a = s.a ?? DEFAULT_A, b = s.b ?? DEFAULT_B;
  const ctTeam = match.rounds[Math.max(0, Math.min(match.rounds.length - 1, roundIndex))]?.ctTeam ?? 0;
  applySideColors(ctTeam === 0 ? a : b, ctTeam === 0 ? b : a);
}

// Au démarrage : le réglage par camp s'applique partout
syncTeamColors();
