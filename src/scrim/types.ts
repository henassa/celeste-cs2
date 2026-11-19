// Données de scrim attachées à une démo : dessins, marqueurs, notes par round.
// Stockées localement (IndexedDB) et exportables en fichier .scrim (JSON) pour l'équipe.

export const SCRIM_FORMAT_VERSION = 1;

export type DrawTool = 'pen' | 'arrow' | 'line' | 'circle' | 'rect' | 'text';
export type Tool = 'select' | DrawTool | 'eraser';

/** Palette des annotations (contenu utilisateur : la couleur y a un sens). */
export const ANNOTATION_COLORS = ['#fafafa', '#a3a3a3', '#ef4444', '#f59e0b', '#38bdf8'] as const;

export interface Annotation {
  id: string;
  round: number;
  /** Visible de fromTick à toTick (par défaut : jusqu'à la fin du round). */
  fromTick: number;
  toTick: number;
  layer: 'upper' | 'lower';
  tool: DrawTool;
  /** Points en coordonnées radar (0..1024), indépendants du zoom. */
  points: [number, number][];
  color: string;
  width: number;
  text?: string;
}

export interface Marker {
  id: string;
  tick: number;
  round: number;
  label: string;
}

/** Extrait d'une playlist : un passage d'un round, lu à la suite des autres. */
export interface Clip {
  id: string;
  round: number;
  fromTick: number;
  toTick: number;
  label: string;
}

export interface ScrimDoc {
  version: number;
  demo: { id: string; fileName: string; map: string; rounds: number };
  annotations: Annotation[];
  markers: Marker[];
  /** Notes par numéro de round (1-based), texte libre. */
  roundNotes: Record<number, string>;
  /** Playlist de passages à revoir à la suite (absente des anciens fichiers). */
  playlist?: Clip[];
  updatedAt: number;
}

export function emptyScrim(demo: ScrimDoc['demo']): ScrimDoc {
  return { version: SCRIM_FORMAT_VERSION, demo, annotations: [], markers: [], roundNotes: {}, playlist: [], updatedAt: Date.now() };
}

export const newId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
