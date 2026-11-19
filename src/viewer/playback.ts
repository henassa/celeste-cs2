// État de lecture partagé (hors React pour ne pas re-rendre 60 fois par seconde).
// Le canvas lit l'état à chaque frame ; l'interface React s'abonne à une version ralentie.

import { useSyncExternalStore } from 'react';
import type { MatchData } from '../data/types';

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;

export interface PlaybackState {
  tick: number;
  playing: boolean;
  speed: number;
  /** Joueur suivi (caméra + mise en avant), -1 = aucun. */
  follow: number;
  layer: 'upper' | 'lower';
  showNames: boolean;
  showTrails: boolean;
  /** HUD incrusté sur le canvas (pendant les exports). */
  hud: boolean;
}

type Listener = () => void;

export class Playback {
  readonly match: MatchData;
  private state: PlaybackState;
  private listeners = new Set<Listener>();
  private uiListeners = new Set<Listener>();
  private uiSnapshot: PlaybackState;
  private lastUiEmit = 0;

  constructor(match: MatchData) {
    this.match = match;
    const first = match.rounds[0];
    this.state = {
      tick: first ? first.freezeEndTick - 3 * match.tickrate : 0,
      playing: false,
      speed: 1,
      follow: -1,
      layer: 'upper',
      showNames: true,
      showTrails: true,
      hud: false,
    };
    this.uiSnapshot = this.state;
  }

  get(): PlaybackState { return this.state; }

  set(patch: Partial<PlaybackState>, forceUi = true): void {
    const next = { ...this.state, ...patch };
    const last = this.match.rounds[this.match.rounds.length - 1];
    const maxTick = last ? last.officialEndTick : this.match.lastTick;
    next.tick = Math.max(0, Math.min(maxTick, next.tick));
    if (next.tick >= maxTick) next.playing = false;
    this.state = next;
    this.listeners.forEach((l) => l());
    const now = performance.now();
    if (forceUi || now - this.lastUiEmit > 100) {
      this.lastUiEmit = now;
      this.uiSnapshot = next;
      this.uiListeners.forEach((l) => l());
    }
  }

  /** Avance la lecture de dt secondes (appelé par la boucle de rendu). */
  advance(dt: number): void {
    if (!this.state.playing) return;
    this.set({ tick: this.state.tick + dt * this.match.tickrate * this.state.speed }, false);
  }

  subscribe = (l: Listener): (() => void) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  subscribeUi = (l: Listener): (() => void) => { this.uiListeners.add(l); return () => this.uiListeners.delete(l); };
  getUi = (): PlaybackState => this.uiSnapshot;

  /** Saute `sec` secondes avant un tick (sans remonter avant le début du round) et lance la lecture. */
  jumpBefore(tick: number, sec = 3): void {
    const m = this.match;
    const r = m.rounds.find((rd) => tick >= rd.startTick && tick <= rd.officialEndTick);
    const floor = r ? r.startTick : 0;
    this.set({ tick: Math.max(floor, tick - sec * m.tickrate), playing: true });
  }

  goToRound(index: number): void {
    const r = this.match.rounds[Math.max(0, Math.min(this.match.rounds.length - 1, index))];
    if (r) this.set({ tick: r.freezeEndTick - 3 * this.match.tickrate });
  }
}

/** État de lecture pour l'UI React, rafraîchi au plus ~10 fois par seconde pendant la lecture. */
export function usePlayback(pb: Playback): PlaybackState {
  return useSyncExternalStore(pb.subscribeUi, pb.getUi);
}
