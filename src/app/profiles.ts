// Profils d'équipe : chaque profil a son nom, son logo, son roster, et ses propres données d'équipe
// (playbook, calendrier, reviews, VODs, boards, notes de prépa). La bibliothèque de démos, les réglages
// d'affichage et les clés d'API restent communs.
//
// Le profil d'origine (« default ») garde les clés de stockage historiques : rien n'est migré ni perdu.
// Les autres profils suffixent leurs clés (`clé@id` dans localStorage, `p:id:clé` dans IndexedDB).
// Changer de profil recharge l'application, pour que chaque magasin relise ses propres clés.

export interface TeamProfile {
  id: string;
  name: string;
  /** Logo en data URL (redimensionné à 128 px). */
  logo: string | null;
  players: { steamid: string; name: string }[];
}
interface ProfilesState { active: string; list: TeamProfile[] }

const KEY = 'scrimview.profiles';
const LEGACY_TEAM = 'scrimview.myTeam';
export const DEFAULT_PROFILE = 'default';

function load(): ProfilesState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && Array.isArray(v.list) && v.list.length && typeof v.active === 'string') {
      return { active: v.list.some((p: TeamProfile) => p.id === v.active) ? v.active : v.list[0].id, list: v.list };
    }
  } catch { /* */ }
  // Première fois : le profil d'origine reprend l'équipe déjà déclarée
  let legacy: Partial<TeamProfile> = {};
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_TEAM) ?? '{}') ?? {}; } catch { /* */ }
  return { active: DEFAULT_PROFILE, list: [{ id: DEFAULT_PROFILE, name: legacy.name ?? '', logo: legacy.logo ?? null, players: Array.isArray(legacy.players) ? legacy.players : [] }] };
}

let state = load();
const listeners = new Set<() => void>();

function persist(): void {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* stockage plein (logo trop lourd) */ }
  // Compatibilité : l'ancienne clé suit le profil d'origine
  const d = state.list.find((p) => p.id === DEFAULT_PROFILE);
  if (d) try { localStorage.setItem(LEGACY_TEAM, JSON.stringify({ name: d.name, logo: d.logo, players: d.players })); } catch { /* */ }
  for (const l of listeners) l();
}

export const subscribeProfiles = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const getProfiles = () => state;
export const activeProfile = (): TeamProfile => state.list.find((p) => p.id === state.active) ?? state.list[0];

/** Clé localStorage du profil actif. */
export const scopedKey = (key: string, id = state.active) => (id === DEFAULT_PROFILE ? key : `${key}@${id}`);
/** Clé IndexedDB du profil actif. */
export const scopedIdbKey = (key: string, id = state.active) => (id === DEFAULT_PROFILE ? key : `p:${id}:${key}`);
/** La clé IndexedDB appartient-elle au profil actif ? */
export function inActiveScope(key: string): boolean {
  if (state.active === DEFAULT_PROFILE) return !key.startsWith('p:');
  return key.startsWith(`p:${state.active}:`);
}

export function updateActiveProfile(patch: Partial<Omit<TeamProfile, 'id'>>): void {
  state = { ...state, list: state.list.map((p) => (p.id === state.active ? { ...p, ...patch } : p)) };
  persist();
}

/** Bascule sur un profil (rechargement : chaque magasin relit ses clés). */
export function switchProfile(id: string): void {
  if (id === state.active || !state.list.some((p) => p.id === id)) return;
  state = { ...state, active: id };
  persist();
  location.reload();
}

export function createProfile(name: string): string {
  const id = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  state = { ...state, list: [...state.list, { id, name: name.trim().slice(0, 40), logo: null, players: [] }] };
  persist();
  return id;
}

/** Supprime un profil et ses données locales (pas celles d'IndexedDB des autres profils). */
export async function deleteProfile(id: string): Promise<void> {
  if (state.list.length < 2) return;
  for (const k of Object.keys(localStorage)) if (k.endsWith(`@${id}`)) localStorage.removeItem(k);
  if (id === DEFAULT_PROFILE) for (const k of PROFILE_KEYS) localStorage.removeItem(k);
  try {
    const { idbDeleteWhere } = await import('../lib/idb');
    await idbDeleteWhere((key) => (id === DEFAULT_PROFILE ? !key.startsWith('p:') : key.startsWith(`p:${id}:`)), ['scrims', 'boards']);
  } catch { /* IndexedDB indisponible */ }
  const wasActive = state.active === id;
  const list = state.list.filter((p) => p.id !== id);
  state = { active: wasActive ? list[0].id : state.active, list };
  persist();
  if (wasActive) location.reload();
}

/** Clés localStorage propres à un profil (pour la suppression du profil d'origine). */
export const PROFILE_KEYS = ['scrimview.playbook', 'scrimview.calendar', 'scrimview.prep', 'scrimview.vods'];
