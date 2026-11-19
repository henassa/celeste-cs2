// État d'un tableau tactique : étape courante, outil, sélection, annuler / rétablir, sauvegarde auto.

import { useSyncExternalStore } from 'react';
import { BOARD_COLORS, emptyStep, newBoardId, type Board, type BoardTool, type Step, type Stroke, type Token, type TokenKind } from './types';
import { saveBoard } from './storage';

export class BoardStore {
  board: Board;
  step = 0;
  tool: BoardTool = 'select';
  color: string = BOARD_COLORS[0];
  selected: string | null = null;
  draft: Stroke | null = null;
  saved = false;

  private undoStack: Step[][] = [];
  private redoStack: Step[][] = [];
  private listeners = new Set<() => void>();
  private version = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(board: Board) { this.board = board; }

  subscribe = (l: () => void) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  getVersion = () => this.version;
  private emit() { this.version++; this.listeners.forEach((l) => l()); }

  get current(): Step { return this.board.steps[this.step]; }

  private commit(steps: Step[], undoable = true) {
    if (undoable) { this.undoStack.push(this.board.steps); this.redoStack = []; if (this.undoStack.length > 200) this.undoStack.shift(); }
    this.board = { ...this.board, steps, updatedAt: Date.now() };
    this.step = Math.min(this.step, steps.length - 1);
    this.scheduleSave();
    this.emit();
  }
  private updateStep(fn: (s: Step) => Step, undoable = true) {
    this.commit(this.board.steps.map((s, i) => (i === this.step ? fn(s) : s)), undoable);
  }
  private scheduleSave() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => { this.saved = await saveBoard(this.board); this.emit(); }, 400);
  }
  undo() { const p = this.undoStack.pop(); if (!p) return; this.redoStack.push(this.board.steps); this.board = { ...this.board, steps: p }; this.step = Math.min(this.step, p.length - 1); this.scheduleSave(); this.emit(); }
  redo() { const n = this.redoStack.pop(); if (!n) return; this.undoStack.push(this.board.steps); this.board = { ...this.board, steps: n }; this.step = Math.min(this.step, n.length - 1); this.scheduleSave(); this.emit(); }

  // --- Réglages ---
  setTool(t: BoardTool) { this.tool = t; this.draft = null; if (t !== 'select') this.selected = null; this.emit(); }
  setColor(c: string) { this.color = c; this.emit(); }
  setStep(i: number) { this.step = Math.max(0, Math.min(this.board.steps.length - 1, i)); this.selected = null; this.emit(); }
  select(id: string | null) { this.selected = id; this.emit(); }
  rename(name: string) { this.board = { ...this.board, name: name.slice(0, 80), updatedAt: Date.now() }; this.scheduleSave(); this.emit(); }
  setLayer(layer: 'upper' | 'lower') { this.board = { ...this.board, layer }; this.scheduleSave(); this.emit(); }

  // --- Étapes ---
  /** Nouvelle étape : copie des jetons de l'étape courante (mêmes id, pour l'animation), sans les traits. */
  addStep() {
    const cur = this.current;
    const s: Step = { ...emptyStep(`Step ${this.board.steps.length + 1}`), tokens: cur.tokens.map((t) => ({ ...t })) };
    const steps = [...this.board.steps];
    steps.splice(this.step + 1, 0, s);
    this.commit(steps);
    this.step++;
    this.emit();
  }
  removeStep(i: number) {
    if (this.board.steps.length <= 1) return;
    this.commit(this.board.steps.filter((_, k) => k !== i));
  }
  moveStep(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= this.board.steps.length) return;
    const steps = [...this.board.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    this.commit(steps);
    this.step = j;
    this.emit();
  }
  renameStep(i: number, name: string) { this.commit(this.board.steps.map((s, k) => (k === i ? { ...s, name: name.slice(0, 60) } : s)), false); }
  setNote(note: string) { this.updateStep((s) => ({ ...s, note }), false); }

  // --- Jetons ---
  /** Prochain numéro libre pour un joueur du camp (1..5, puis au-delà). */
  private nextLabel(kind: TokenKind): string | undefined {
    if (kind !== 'ct' && kind !== 't') return undefined;
    const used = new Set(this.current.tokens.filter((t) => t.kind === kind).map((t) => t.label));
    for (let n = 1; n < 20; n++) if (!used.has(String(n))) return String(n);
    return undefined;
  }
  addToken(kind: TokenKind, x: number, y: number): Token {
    const t: Token = { id: newBoardId(), kind, x, y, label: this.nextLabel(kind) };
    // Un seul jeton bombe par étape
    this.updateStep((s) => ({ ...s, tokens: [...(kind === 'bomb' ? s.tokens.filter((o) => o.kind !== 'bomb') : s.tokens), t] }));
    return t;
  }
  /** Déplacement en direct (sans historique) puis validation à la fin du glisser. */
  moveTokenLive(id: string, x: number, y: number) {
    this.board = { ...this.board, steps: this.board.steps.map((s, i) => (i === this.step ? { ...s, tokens: s.tokens.map((t) => (t.id === id ? { ...t, x, y } : t)) } : s)) };
    this.emit();
  }
  beginMove() { this.undoStack.push(this.board.steps); this.redoStack = []; }
  endMove() { this.scheduleSave(); this.emit(); }
  relabel(id: string, label: string) { this.updateStep((s) => ({ ...s, tokens: s.tokens.map((t) => (t.id === id ? { ...t, label: label.slice(0, 10) } : t)) }), false); }
  removeSelected() {
    const id = this.selected;
    if (!id) return;
    this.updateStep((s) => ({ ...s, tokens: s.tokens.filter((t) => t.id !== id), strokes: s.strokes.filter((t) => t.id !== id) }));
    this.selected = null;
    this.emit();
  }

  // --- Traits ---
  beginStroke(x: number, y: number) {
    if (this.tool !== 'arrow' && this.tool !== 'line' && this.tool !== 'pen') return;
    this.draft = { id: newBoardId(), tool: this.tool, points: [[x, y], [x, y]], color: this.color };
    this.emit();
  }
  extendStroke(x: number, y: number) {
    const d = this.draft;
    if (!d) return;
    if (d.tool === 'pen') d.points.push([x, y]); else d.points[1] = [x, y];
    this.emit();
  }
  endStroke() {
    const d = this.draft;
    this.draft = null;
    if (!d) return;
    const [a, b] = [d.points[0], d.points[d.points.length - 1]];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 6 && d.points.length < 4) { this.emit(); return; }
    this.updateStep((s) => ({ ...s, strokes: [...s.strokes, d] }));
  }
  /** Gomme : retire le jeton ou le trait le plus proche. */
  eraseAt(x: number, y: number, tol: number) {
    const s = this.current;
    let best: string | null = null, bd = tol;
    for (const t of s.tokens) { const d = Math.hypot(t.x - x, t.y - y); if (d < bd) { bd = d; best = t.id; } }
    for (const st of s.strokes) {
      for (let i = 1; i < st.points.length; i++) {
        const d = distSeg(x, y, st.points[i - 1], st.points[i]);
        if (d < bd) { bd = d; best = st.id; }
      }
    }
    if (!best) return;
    const id = best;
    this.updateStep((st) => ({ ...st, tokens: st.tokens.filter((t) => t.id !== id), strokes: st.strokes.filter((t) => t.id !== id) }));
  }
  clearStep() { this.updateStep((s) => ({ ...s, tokens: [], strokes: [] })); }
}

export function distSeg(px: number, py: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

export function useBoard(store: BoardStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion);
}
