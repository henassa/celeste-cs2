// Disposition du replay : panneaux affichés, largeurs, panneau latéral, préréglages.
// Gardée dans ce navigateur ; l'utilisateur peut enregistrer ses propres dispositions.

import { useSyncExternalStore } from 'react';
import { tt } from '../i18n';

export type DockPanel = 'notes' | 'moments' | 'coach' | 'vod';

export interface ReplayLayout {
  left: boolean;
  right: boolean;
  leftW: number;
  rightW: number;
  dock: DockPanel | null;
  dockSide: 'left' | 'right';
  dockW: number;
  killfeed: boolean;
  winCurve: boolean;
  timeline: boolean;
}

// Mode présentation (stream / review en direct) : état de session, non sauvegardé
export interface Presentation { on: boolean; teams: boolean; caption: string; background: 'dark' | 'green' }
let pres: Presentation = { on: false, teams: true, caption: '', background: 'dark' };
const presSubs = new Set<() => void>();
export function setPresentation(patch: Partial<Presentation>): void {
  const was = pres.on;
  pres = { ...pres, ...patch };
  presSubs.forEach((s) => s());
  // Plein écran à l'entrée, sortie du plein écran à la sortie
  try {
    if (pres.on && !was && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    if (!pres.on && was && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  } catch { /* ignoré */ }
}
export const getPresentationBg = () => pres.background;
export const togglePresentation = () => setPresentation({ on: !pres.on });
export function usePresentation(): Presentation {
  return useSyncExternalStore((cb) => { presSubs.add(cb); return () => { presSubs.delete(cb); }; }, () => pres);
}

export const LAYOUT_PRESETS: { id: string; label: string; hint: string; layout: Partial<ReplayLayout> }[] = [
  { id: 'analyst', label: tt('Analyst'), hint: tt('Both teams, radar and notes'), layout: { left: true, right: true, leftW: 260, rightW: 260, dock: 'notes', killfeed: true, winCurve: true, timeline: true } },
  { id: 'caster', label: tt('Caster'), hint: tt('Teams and radar, no side panel'), layout: { left: true, right: true, leftW: 280, rightW: 280, dock: null, killfeed: true, winCurve: true, timeline: true } },
  { id: 'review', label: tt('Review'), hint: tt('Radar with the coach beside it'), layout: { left: false, right: false, dock: 'coach', dockW: 420, killfeed: true, winCurve: true, timeline: true } },
  { id: 'focus', label: tt('Focus'), hint: tt('Radar only (F to toggle)'), layout: { left: false, right: false, dock: null, killfeed: true, winCurve: false, timeline: true } },
];

const KEY = 'scrimview.layout';
const CUSTOM_KEY = 'scrimview.layouts';
const DEFAULT: ReplayLayout = {
  left: true, right: true, leftW: 270, rightW: 270, dock: null, dockSide: 'right', dockW: 320, killfeed: true, winCurve: true, timeline: true,
};

function load(): ReplayLayout {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT, ...JSON.parse(raw) };
  } catch { /* ignoré */ }
  return { ...DEFAULT, dock: window.innerWidth >= 1500 ? 'notes' : null };
}

let state = load();
const subs = new Set<() => void>();

export const clampW = (w: number, min = 200, max = 560) => Math.max(min, Math.min(max, Math.round(w)));

export function setLayout(patch: Partial<ReplayLayout> | ((l: ReplayLayout) => Partial<ReplayLayout>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignoré */ }
  subs.forEach((s) => s());
}
export const getLayout = () => state;
export function useLayout(): ReplayLayout {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => state);
}

/** Ouvre un panneau latéral, ou le ferme s'il est déjà ouvert. */
export const toggleDock = (p: DockPanel) => setLayout((l) => ({ dock: l.dock === p ? null : p }));

// Mode focus : on mémorise la disposition d'avant pour y revenir
let beforeFocus: ReplayLayout | null = null;
export function toggleFocus(): void {
  if (beforeFocus) { setLayout(beforeFocus); beforeFocus = null; return; }
  beforeFocus = state;
  setLayout({ left: false, right: false, dock: null });
}

export interface CustomLayout { name: string; layout: ReplayLayout }
export function loadCustomLayouts(): CustomLayout[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]'); } catch { return []; }
}
export function saveCustomLayout(name: string): CustomLayout[] {
  const list = loadCustomLayouts().filter((x) => x.name !== name);
  list.push({ name, layout: state });
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch { /* ignoré */ }
  return list;
}
export function deleteCustomLayout(name: string): CustomLayout[] {
  const list = loadCustomLayouts().filter((x) => x.name !== name);
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch { /* ignoré */ }
  return list;
}
export const applyPreset = (p: Partial<ReplayLayout>) => { beforeFocus = null; setLayout(p); };
