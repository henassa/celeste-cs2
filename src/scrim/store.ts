// État du scrim (dessins, marqueurs, notes) : modifications, annuler / rétablir, sauvegarde auto.
// Hors React comme Playback : le canvas lit l'état à chaque frame, l'UI s'abonne aux changements.

import { useSyncExternalStore } from 'react';
import { ANNOTATION_COLORS, emptyScrim, newId, type Annotation, type Clip, type DrawTool, type Marker, type ScrimDoc, type Tool } from './types';
import { loadScrim, saveScrim } from './storage';

type Content = Pick<ScrimDoc, 'annotations' | 'markers' | 'roundNotes' | 'playlist'>;
export type SaveState = 'idle' | 'saving' | 'saved' | 'memory';

/** Durée de visibilité d'une annotation : jusqu'à la fin du round, ou quelques secondes. */
export type Visibility = 'round' | '5s';

export interface PendingText { sx: number; sy: number; rx: number; ry: number; tick: number; toTick: number; round: number; layer: 'upper' | 'lower' }

export class ScrimStore {
  doc: ScrimDoc;
  tool: Tool = 'select';
  color: string = ANNOTATION_COLORS[2];
  width = 3;
  visibility: Visibility = 'round';
  draft: Annotation | null = null;
  pendingText: PendingText | null = null;
  saveState: SaveState = 'idle';

  private undoStack: Content[] = [];
  private redoStack: Content[] = [];
  private listeners = new Set<() => void>();
  private version = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(demo: ScrimDoc['demo']) {
    this.doc = emptyScrim(demo);
  }

  /** Charge le scrim sauvegardé pour cette démo (s'il existe). */
  async init(): Promise<void> {
    const saved = await loadScrim(this.doc.demo.id);
    if (saved) { this.doc = { ...saved, demo: { ...saved.demo, ...this.doc.demo } }; this.saveState = 'saved'; }
    this.emit();
  }

  // --- Abonnement React ---
  subscribe = (l: () => void) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  getVersion = () => this.version;
  private emit() { this.version++; this.listeners.forEach((l) => l()); }

  // --- Historique ---
  private snapshot(): Content {
    return { annotations: this.doc.annotations, markers: this.doc.markers, roundNotes: this.doc.roundNotes, playlist: this.doc.playlist ?? [] };
  }
  private commit(next: Partial<Content>, undoable = true) {
    if (undoable) { this.undoStack.push(this.snapshot()); this.redoStack = []; if (this.undoStack.length > 200) this.undoStack.shift(); }
    this.doc = { ...this.doc, ...next, updatedAt: Date.now() };
    this.scheduleSave();
    this.emit();
  }
  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.doc = { ...this.doc, ...prev, updatedAt: Date.now() };
    this.scheduleSave(); this.emit();
  }
  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.doc = { ...this.doc, ...next, updatedAt: Date.now() };
    this.scheduleSave(); this.emit();
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  private scheduleSave() {
    this.saveState = 'saving';
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      const ok = await saveScrim(this.doc);
      this.saveState = ok ? 'saved' : 'memory';
      this.emit();
    }, 400);
  }

  // --- Outils ---
  setTool(t: Tool) { this.tool = t; this.draft = null; this.pendingText = null; this.emit(); }
  setColor(c: string) { this.color = c; this.emit(); }
  setWidth(w: number) { this.width = w; this.emit(); }
  setVisibility(v: Visibility) { this.visibility = v; this.emit(); }

  private visibleUntil(tick: number, roundEnd: number): number {
    return this.visibility === '5s' ? Math.min(roundEnd, tick + 5 * 64) : roundEnd;
  }

  beginStroke(tool: DrawTool, rx: number, ry: number, tick: number, round: number, roundEnd: number, layer: 'upper' | 'lower') {
    this.draft = {
      id: newId(), round, fromTick: tick, toTick: this.visibleUntil(tick, roundEnd), layer, tool,
      points: [[rx, ry], [rx, ry]], color: this.color, width: this.width,
    };
    this.emit();
  }
  /** Prolonge le tracé. `straight` (Maj) : ligne et flèche par pas de 45°, rectangle carré, stylo en ligne droite. */
  extendStroke(rx: number, ry: number, straight = false) {
    const d = this.draft;
    if (!d) return;
    const [ax, ay] = d.points[0];
    if (straight && d.tool !== 'circle') {
      const dx = rx - ax, dy = ry - ay;
      if (d.tool === 'rect') { const k = Math.max(Math.abs(dx), Math.abs(dy)); rx = ax + Math.sign(dx || 1) * k; ry = ay + Math.sign(dy || 1) * k; }
      else { const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy); rx = ax + Math.cos(a) * len; ry = ay + Math.sin(a) * len; }
      if (d.tool === 'pen') { d.points = [[ax, ay], [rx, ry]]; this.emit(); return; }
    }
    if (d.tool === 'pen') {
      const [lx, ly] = d.points[d.points.length - 1];
      if (Math.hypot(rx - lx, ry - ly) > 1.5) d.points.push([rx, ry]);
    } else d.points[1] = [rx, ry];
  }
  /** Abandonne le tracé en cours (clic droit, Échap). */
  cancelStroke(): boolean {
    if (!this.draft && !this.pendingText) return false;
    this.draft = null; this.pendingText = null; this.emit();
    return true;
  }
  endStroke() {
    const d = this.draft;
    this.draft = null;
    if (!d) return;
    const [a, b] = [d.points[0], d.points[d.points.length - 1]];
    // Un simple clic sans tracé est ignoré (sauf stylo : point)
    if (d.tool !== 'pen' && Math.hypot(a[0] - b[0], a[1] - b[1]) < 3) { this.emit(); return; }
    this.commit({ annotations: [...this.doc.annotations, d] });
  }

  requestText(p: Omit<PendingText, 'toTick'>, roundEnd: number) {
    this.pendingText = { ...p, toTick: this.visibleUntil(p.tick, roundEnd) };
    this.emit();
  }
  commitText(text: string) {
    const p = this.pendingText;
    this.pendingText = null;
    if (!p || !text.trim()) { this.emit(); return; }
    this.commit({
      annotations: [...this.doc.annotations, {
        id: newId(), round: p.round, fromTick: p.tick, toTick: p.toTick, layer: p.layer, tool: 'text',
        points: [[p.rx, p.ry]], color: this.color, width: this.width, text: text.trim().slice(0, 120),
      }],
    });
  }

  /** Annotations visibles à ce tick sur ce niveau. */
  visible(tick: number, layer: 'upper' | 'lower'): Annotation[] {
    return this.doc.annotations.filter((a) => a.layer === layer && tick >= a.fromTick && tick <= a.toTick);
  }

  /** Gomme : supprime l'annotation visible la plus proche du point (en unités radar). */
  eraseAt(rx: number, ry: number, tick: number, layer: 'upper' | 'lower', tolerance: number) {
    let best: string | null = null, bd = tolerance;
    for (const a of this.visible(tick, layer)) {
      const d = distanceToAnnotation(a, rx, ry);
      if (d < bd) { bd = d; best = a.id; }
    }
    if (best) this.commit({ annotations: this.doc.annotations.filter((a) => a.id !== best) });
  }
  clearRound(round: number) {
    if (!this.doc.annotations.some((a) => a.round === round)) return;
    this.commit({ annotations: this.doc.annotations.filter((a) => a.round !== round) });
  }

  // --- Marqueurs ---
  addMarker(tick: number, round: number): Marker {
    const n = this.doc.markers.filter((m) => m.round === round).length + 1;
    const marker: Marker = { id: newId(), tick: Math.round(tick), round, label: `R${round + 1} · marker ${n}` };
    this.commit({ markers: [...this.doc.markers, marker].sort((a, b) => a.tick - b.tick) });
    return marker;
  }
  renameMarker(id: string, label: string) {
    this.commit({ markers: this.doc.markers.map((m) => (m.id === id ? { ...m, label: label.slice(0, 80) } : m)) }, false);
  }
  removeMarker(id: string) {
    this.commit({ markers: this.doc.markers.filter((m) => m.id !== id) });
  }

  // --- Notes ---
  setRoundNote(roundNumber: number, text: string) {
    const notes = { ...this.doc.roundNotes };
    if (text.trim()) notes[roundNumber] = text.slice(0, 5000); else delete notes[roundNumber];
    this.commit({ roundNotes: notes }, false);
  }

  // --- Playlist ---
  get playlist(): Clip[] { return this.doc.playlist ?? []; }
  addClip(round: number, fromTick: number, toTick: number, label: string): Clip {
    const clip: Clip = { id: newId(), round, fromTick: Math.round(fromTick), toTick: Math.round(toTick), label: label.slice(0, 80) };
    this.commit({ playlist: [...this.playlist, clip] });
    return clip;
  }
  renameClip(id: string, label: string) {
    this.commit({ playlist: this.playlist.map((c) => (c.id === id ? { ...c, label: label.slice(0, 80) } : c)) }, false);
  }
  removeClip(id: string) {
    this.commit({ playlist: this.playlist.filter((c) => c.id !== id) });
  }
  moveClip(id: string, dir: -1 | 1) {
    const list = [...this.playlist];
    const i = list.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.commit({ playlist: list });
  }

  /** Remplace ou fusionne avec un fichier .scrim importé. */
  importDoc(other: ScrimDoc, mode: 'replace' | 'merge') {
    if (mode === 'replace') {
      this.commit({ annotations: other.annotations, markers: other.markers, roundNotes: other.roundNotes, playlist: other.playlist ?? [] });
      return;
    }
    const ids = new Set(this.doc.annotations.map((a) => a.id));
    const mids = new Set(this.doc.markers.map((m) => m.id));
    const cids = new Set(this.playlist.map((c) => c.id));
    const notes = { ...this.doc.roundNotes };
    for (const [k, v] of Object.entries(other.roundNotes)) {
      const n = Number(k);
      notes[n] = notes[n] && notes[n] !== v ? `${notes[n]}\n\n${v}` : v;
    }
    this.commit({
      annotations: [...this.doc.annotations, ...other.annotations.filter((a) => !ids.has(a.id))],
      markers: [...this.doc.markers, ...other.markers.filter((m) => !mids.has(m.id))].sort((a, b) => a.tick - b.tick),
      roundNotes: notes,
      playlist: [...this.playlist, ...(other.playlist ?? []).filter((c) => !cids.has(c.id))],
    });
  }

  /** Le round contient-il des notes, marqueurs ou dessins ? (indicateur sur la timeline) */
  roundHasContent(roundIndex: number): boolean {
    return !!this.doc.roundNotes[roundIndex + 1] || this.doc.markers.some((m) => m.round === roundIndex)
      || this.doc.annotations.some((a) => a.round === roundIndex);
  }
}

function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distanceToAnnotation(a: Annotation, x: number, y: number): number {
  const p = a.points;
  switch (a.tool) {
    case 'text': return Math.hypot(x - p[0][0], y - p[0][1]) - 12;
    case 'circle': {
      const r = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]);
      return Math.abs(Math.hypot(x - p[0][0], y - p[0][1]) - r);
    }
    case 'rect': {
      const [[x0, y0], [x1, y1]] = p;
      return Math.min(distSeg(x, y, x0, y0, x1, y0), distSeg(x, y, x1, y0, x1, y1), distSeg(x, y, x1, y1, x0, y1), distSeg(x, y, x0, y1, x0, y0));
    }
    default: {
      let d = Infinity;
      for (let i = 1; i < p.length; i++) d = Math.min(d, distSeg(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]));
      return p.length === 1 ? Math.hypot(x - p[0][0], y - p[0][1]) : d;
    }
  }
}

export function useScrim(store: ScrimStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion);
}
