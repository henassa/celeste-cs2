// Navigation par l'adresse (#/...) : précédent / suivant du navigateur, liens directs, rechargement.
// Aucun serveur : tout reste dans le hash.

import { useEffect, useState } from 'react';

export const ANALYSIS_TABS = ['players', 'training', 'teams', 'series', 'rounds', 'strategies', 'heatmaps', 'lineups', 'brief', 'veto'] as const;
export type AnalysisTab = (typeof ANALYSIS_TABS)[number];
export const REPLAY_VIEWS = ['replay', '3d', 'overlay', 'grenades', 'stats'] as const;
export type ReplayView = (typeof REPLAY_VIEWS)[number];

export const SETTINGS_SECTIONS = ['team', '3d', 'display', 'about'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type Route =
  | { page: 'home' }
  | { page: 'library' }
  | { page: 'playbook' }
  | { page: 'reviews' }
  | { page: 'calendar' }
  | { page: 'prep'; team?: string }
  | { page: 'settings'; section: SettingsSection }
  | { page: 'replay'; view: ReplayView; round?: number }
  | { page: 'analysis'; tab: AnalysisTab }
  | { page: 'boards' }
  | { page: 'board'; id: string };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b, c] = parts;
  if (a === 'replay') {
    const view = (REPLAY_VIEWS as readonly string[]).includes(b ?? '') ? (b as ReplayView) : 'replay';
    const r = /^r(\d+)$/.exec(c ?? b ?? '');
    return { page: 'replay', view, round: r ? Number(r[1]) - 1 : undefined };
  }
  if (a === 'analysis') return { page: 'analysis', tab: (ANALYSIS_TABS as readonly string[]).includes(b ?? '') ? (b as AnalysisTab) : 'players' };
  if (a === 'boards') return b ? { page: 'board', id: b } : { page: 'boards' };
  if (a === 'library') return { page: 'library' };
  if (a === 'prep') return { page: 'prep', team: b };
  if (a === 'playbook' || a === 'reviews' || a === 'calendar') return { page: a };
  if (a === 'settings') return { page: 'settings', section: (SETTINGS_SECTIONS as readonly string[]).includes(b ?? '') ? (b as SettingsSection) : 'team' };
  return { page: 'home' };
}

export function formatRoute(r: Route): string {
  switch (r.page) {
    case 'home': return '#/';
    case 'library': return '#/library';
    case 'playbook': return '#/playbook';
    case 'reviews': return '#/reviews';
    case 'calendar': return '#/calendar';
    case 'prep': return r.team ? `#/prep/${encodeURIComponent(r.team)}` : '#/prep';
    case 'settings': return `#/settings/${r.section}`;
    case 'replay': return `#/replay/${r.view}${r.round != null ? `/r${r.round + 1}` : ''}`;
    case 'analysis': return `#/analysis/${r.tab}`;
    case 'boards': return '#/boards';
    case 'board': return `#/boards/${encodeURIComponent(r.id)}`;
  }
}

const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => listeners.forEach((l) => l()));

/** Va à une page. `replace` : ne crée pas d'entrée d'historique (ex. changement de round). */
export function navigate(r: Route, replace = false): void {
  const h = formatRoute(r);
  if (location.hash === h) return;
  if (replace) { history.replaceState(null, '', h); listeners.forEach((l) => l()); } else location.hash = h;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => { const l = () => setRoute(parseRoute(location.hash)); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return route;
}

export const sameRoute = (a: Route, b: Route) => formatRoute(a) === formatRoute(b);
