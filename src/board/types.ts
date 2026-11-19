// Tableau tactique : une carte, des étapes ; chaque étape place des joueurs et des utilitaires
// et peut porter des flèches et une note. Coordonnées radar (0..1024), indépendantes de l'écran.

export const BOARD_FORMAT_VERSION = 1;

export type TokenKind = 'ct' | 't' | 'smoke' | 'molotov' | 'flash' | 'he' | 'bomb';
export type BoardTool = 'select' | TokenKind | 'arrow' | 'line' | 'pen' | 'eraser';

export interface Token {
  /** Même id d'une étape à l'autre = même joueur / objet (sert à l'animation). */
  id: string;
  kind: TokenKind;
  x: number;
  y: number;
  /** Numéro ou nom court affiché sur le jeton joueur. */
  label?: string;
}

export interface Stroke {
  id: string;
  tool: 'arrow' | 'line' | 'pen';
  points: [number, number][];
  color: string;
}

export interface Step {
  id: string;
  name: string;
  note: string;
  tokens: Token[];
  strokes: Stroke[];
}

export interface Board {
  version: number;
  id: string;
  name: string;
  map: string;
  layer: 'upper' | 'lower';
  steps: Step[];
  createdAt: number;
  updatedAt: number;
}

export const BOARD_COLORS = ['#fafafa', '#a3a3a3', '#ef4444', '#f59e0b', '#38bdf8'] as const;

export const newBoardId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function emptyStep(name: string): Step {
  return { id: newBoardId(), name, note: '', tokens: [], strokes: [] };
}

export function newBoard(map: string, name: string): Board {
  const now = Date.now();
  return { version: BOARD_FORMAT_VERSION, id: newBoardId(), name, map, layer: 'upper', steps: [emptyStep('Setup')], createdAt: now, updatedAt: now };
}

/** Vérifie un fichier .board importé. */
export function parseBoardFile(text: string): Board {
  const d = JSON.parse(text) as Partial<Board>;
  if (!d || typeof d.map !== 'string' || !Array.isArray(d.steps) || !d.steps.length) throw new Error('Not a Celeste board file.');
  if ((d.version ?? 0) > BOARD_FORMAT_VERSION) throw new Error('This board was made with a newer version of scrimview.');
  const steps = d.steps.map((s, i) => ({
    id: typeof s.id === 'string' ? s.id : newBoardId(),
    name: typeof s.name === 'string' ? s.name : `Step ${i + 1}`,
    note: typeof s.note === 'string' ? s.note : '',
    tokens: Array.isArray(s.tokens) ? s.tokens.filter((t) => t && typeof t.x === 'number' && typeof t.y === 'number') : [],
    strokes: Array.isArray(s.strokes) ? s.strokes.filter((t) => t && Array.isArray(t.points)) : [],
  }));
  const now = Date.now();
  return {
    version: BOARD_FORMAT_VERSION, id: newBoardId(), name: typeof d.name === 'string' ? d.name : 'Imported board', map: d.map,
    layer: d.layer === 'lower' ? 'lower' : 'upper', steps, createdAt: now, updatedAt: now,
  };
}
