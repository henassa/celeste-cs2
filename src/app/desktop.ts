// Pont vers l'application de bureau (Electron, electron/preload.cjs). Absent dans le navigateur.

export interface DesktopInfo {
  version: string;
  platform: string;
  paths: { assets: string; work: string; tools: string; cs2: string | null };
  /** Modèles et animations des joueurs installés. */
  anim: boolean;
  /** Maps 3D construites sur cette machine. */
  geo: string[];
  setupDone: boolean;
  job: string | null;
}
export interface InstalledMap { name: string; vpk: string; source: 'game' | 'workshop'; id?: string; pool: boolean; built: boolean; size?: number; builtSize?: number }
export interface JobProgress { done: number; total: number; label: string }

export interface DesktopBridge {
  platform: string;
  info(): Promise<DesktopInfo>;
  listMaps(): Promise<{ ok: true; cs2: string; maps: InstalledMap[] } | { ok: false; error: string }>;
  pickCs2(): Promise<{ cs2: string } | { error: string } | null>;
  pickWorkDir(): Promise<{ workDir: string } | null>;
  extractMaps(specs: string[], quality: 'normal' | 'full' | 'complete'): Promise<boolean>;
  extractModels(): Promise<boolean>;
  cancel(): Promise<boolean>;
  setupDone(done: boolean): Promise<boolean>;
  open(which: 'assets' | 'work'): Promise<string>;
  disk(): Promise<{ assets: number; work: number; free: number | null }>;
  cleanWork(): Promise<boolean>;
  removeMap(name: string): Promise<boolean>;
  vodOpen(url: string): Promise<boolean>;
  vodCmd(cmd: { type: 'seek'; t: number } | { type: 'play'; on: boolean } | { type: 'rate'; rate: number } | { type: 'time' }): Promise<number | boolean | null>;
  vodClose(): Promise<boolean>;
  onStart(cb: (d: { script: string; args: string[] }) => void): () => void;
  onLine(cb: (d: { stream: string; line: string }) => void): () => void;
  onProgress(cb: (d: JobProgress) => void): () => void;
  onEnd(cb: (d: { script: string; code: number; error?: string }) => void): () => void;
}

export const desktop: DesktopBridge | null = typeof window !== 'undefined' ? ((window as unknown as { scrimviewDesktop?: DesktopBridge }).scrimviewDesktop ?? null) : null;
export const isDesktop = !!desktop;
export const formatBytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${Math.round(n / 1e3)} KB`);

/**
 * Place estimée pour une map : exports temporaires (géométrie + textures décodées, supprimables ensuite)
 * et modèle 3D final. D'après la taille du paquet de la map ; le modèle « Standard » et « Full » est
 * plafonné par son budget de triangles.
 */
export function estimateMap(vpkBytes: number, quality: 'normal' | 'full' | 'complete'): { temp: number; final: number } {
  const v = Math.max(vpkBytes, 50e6);
  const temp = Math.max(150e6, v * 1.6);
  const final = quality === 'normal' ? Math.min(8e6, 1.5e6 + v * 0.012) : quality === 'full' ? Math.min(18e6, 3e6 + v * 0.03) : Math.min(120e6, Math.max(15e6, v * 0.06));
  return { temp, final };
}
/** Modèles et animations des joueurs. */
export const MODELS_ESTIMATE = { temp: 250e6, final: 30e6 };
