// File de lecture : enchaîne des passages (playlist, ou rounds retenus par les filtres de l'analyse).
// Quand la lecture dépasse la fin d'un passage, on saute au début du suivant.

import type { Playback } from './playback';

export interface QueueItem {
  round: number;
  fromTick: number;
  toTick: number;
  label: string;
}

export interface QueueState {
  title: string;
  items: QueueItem[];
  index: number;
}

/**
 * Surveille la lecture. Renvoie une fonction de désabonnement.
 * `onIndex` est appelé quand on passe au passage suivant ; `onLeave` quand l'utilisateur sort
 * du round du passage en cours (la file s'arrête alors pour ne pas le ramener de force).
 */
export function watchQueue(pb: Playback, q: QueueState, onIndex: (i: number) => void, onLeave: () => void): () => void {
  const m = pb.match;
  // Index local : le saut au passage suivant redéclenche l'écouteur avant que React n'ait mis à jour l'état
  let index = q.index;
  return pb.subscribe(() => {
    const item = q.items[index];
    if (!item) return;
    const s = pb.get();
    const r = m.rounds[item.round];
    if (r && (s.tick < r.startTick - 2 * m.tickrate || s.tick > r.officialEndTick + 2 * m.tickrate)) { onLeave(); return; }
    if (!s.playing || s.tick < item.toTick) return;
    const next = q.items[index + 1];
    if (next) {
      index++;
      onIndex(index);
      pb.set({ tick: next.fromTick, playing: true });
    } else {
      pb.set({ playing: false });
    }
  });
}

/** Passages d'une liste de rounds : de 3 s avant la fin du freeze à 2 s après la fin du round. */
export function roundsQueue(m: Playback['match'], rounds: number[]): QueueItem[] {
  return rounds.map((ri) => {
    const r = m.rounds[ri];
    return { round: ri, fromTick: r.freezeEndTick - 3 * m.tickrate, toTick: r.endTick + 2 * m.tickrate, label: `Round ${r.number}` };
  });
}
