// Intégration FACEIT avec la clé API de l'utilisateur (Data API v4). La clé reste dans ce
// navigateur (localStorage) et n'est envoyée qu'à open.faceit.com. Aucune clé dans le code.
// Les démos FACEIT sont privées : leur téléchargement automatique demande l'accès à la
// Downloads API (sur demande auprès de FACEIT). Sans cet accès, l'app ouvre la salle de match.

const BASE = 'https://open.faceit.com/data/v4';
const DOWNLOAD = 'https://open.faceit.com/download/v2/demos/download';
const KEY = 'scrimview.faceitKey';

export function getFaceitKey(): string { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } }
export function setFaceitKey(k: string): void { try { if (k) localStorage.setItem(KEY, k.trim()); else localStorage.removeItem(KEY); } catch { /* ignoré */ } }

export class FaceitError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

type Fetch = typeof fetch;

async function call<T>(path: string, key: string, f: Fetch = fetch, init?: RequestInit, base = BASE): Promise<T> {
  let res: Response;
  try {
    res = await f(`${base}${path}`, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), Authorization: `Bearer ${key}`, Accept: 'application/json' } });
  } catch {
    // Échec réseau ou blocage CORS : le navigateur ne donne pas plus de détail
    throw new FaceitError('Could not reach FACEIT. Check your connection, and that the key is a client-side key (server-side keys are refused by browsers).', 0);
  }
  if (res.status === 401 || res.status === 403) throw new FaceitError('FACEIT refused the key. Check it in the FACEIT Developer Portal (App Studio → API Keys).', res.status);
  if (res.status === 404) throw new FaceitError('Not found on FACEIT.', 404);
  if (res.status === 429) throw new FaceitError('Too many requests: wait a minute and try again.', 429);
  if (!res.ok) throw new FaceitError(`FACEIT answered ${res.status}.`, res.status);
  return res.json() as Promise<T>;
}

export interface FaceitPlayer {
  player_id: string;
  nickname: string;
  country?: string;
  avatar?: string;
  steam_id_64?: string;
  games?: { cs2?: { faceit_elo?: number; skill_level?: number; game_player_id?: string } };
}

export interface FaceitHistoryItem {
  match_id: string;
  started_at: number;
  finished_at: number;
  competition_name?: string;
  teams: Record<string, { team_id: string; nickname: string; players: { player_id: string; nickname: string }[] }>;
  results?: { winner: string; score: Record<string, number> };
  faceit_url?: string;
}

export interface FaceitMatch {
  match_id: string;
  demo_url?: string[];
  voting?: { map?: { pick?: string[] } };
  results?: { winner: string; score: Record<string, number> };
  faceit_url?: string;
}

export interface FaceitPlayerStats { nickname: string; player_id: string; stats: Record<string, string> }

export const faceit = {
  player: (nickname: string, key: string, f?: Fetch) => call<FaceitPlayer>(`/players?nickname=${encodeURIComponent(nickname)}&game=cs2`, key, f),
  history: (playerId: string, key: string, limit = 20, f?: Fetch) =>
    call<{ items: FaceitHistoryItem[] }>(`/players/${encodeURIComponent(playerId)}/history?game=cs2&offset=0&limit=${limit}`, key, f).then((r) => r.items ?? []),
  match: (matchId: string, key: string, f?: Fetch) => call<FaceitMatch>(`/matches/${encodeURIComponent(matchId)}`, key, f),
  /** Stats FACEIT d'un match : une ligne par joueur (Kills, Deaths, ADR, K/D Ratio, Headshots %...). */
  matchStats: async (matchId: string, key: string, f?: Fetch): Promise<{ map: string; players: FaceitPlayerStats[] }> => {
    const r = await call<{ rounds?: { round_stats?: Record<string, string>; teams?: { players: { player_id: string; nickname: string; player_stats: Record<string, string> }[] }[] }[] }>(`/matches/${encodeURIComponent(matchId)}/stats`, key, f);
    const round = r.rounds?.[0];
    return {
      map: round?.round_stats?.Map ?? '',
      players: (round?.teams ?? []).flatMap((t) => t.players.map((p) => ({ nickname: p.nickname, player_id: p.player_id, stats: p.player_stats ?? {} }))),
    };
  },
  /**
   * Lien de téléchargement signé d'une démo. Nécessite l'accès à la Downloads API (demande auprès
   * de FACEIT). Sans cet accès, FACEIT répond 401 / 403.
   */
  demoDownloadUrl: async (resourceUrl: string, key: string, f?: Fetch): Promise<string> => {
    const r = await call<{ payload?: { download_url?: string } }>('', key, f, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource_url: resourceUrl }),
    }, DOWNLOAD);
    const url = r.payload?.download_url;
    if (!url) throw new FaceitError('FACEIT did not return a download link.', 0);
    return url;
  },
};

/** Salle de match sur faceit.com (téléchargement manuel de la démo : bouton « Watch demo »). */
export const matchRoomUrl = (matchId: string) => `https://www.faceit.com/en/cs2/room/${encodeURIComponent(matchId)}`;

/** Identifiant de match FACEIT dans un nom de fichier de démo (« 1-<uuid>-1-1.dem.zst »). */
export function matchIdFromFileName(name: string): string | null {
  return name.toLowerCase().match(/1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] ?? null;
}

/** Équipe (clé faction1 / faction2) d'un joueur dans un match de l'historique, et résultat. */
export function resultFor(item: FaceitHistoryItem, playerId: string): { won: boolean | null; score: string; mine: string; theirs: string } {
  const entries = Object.entries(item.teams ?? {});
  const mine = entries.find(([, t]) => t.players?.some((p) => p.player_id === playerId));
  const other = entries.find(([k]) => k !== mine?.[0]);
  const sc = item.results?.score ?? {};
  return {
    won: mine && item.results ? item.results.winner === mine[0] : null,
    score: mine && other ? `${sc[mine[0]] ?? '?'}–${sc[other[0]] ?? '?'}` : '',
    mine: mine?.[1].nickname ?? '',
    theirs: other?.[1].nickname ?? '',
  };
}
