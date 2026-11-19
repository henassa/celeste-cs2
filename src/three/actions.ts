// Actions des joueurs pour la vue 3D : sauts, sortie d'arme, rechargement, tirs (traçantes).
// Tout est calculé à partir des données de la démo, à un tick donné (lecture avant / arrière possible).

import { SAMPLE_STEP, type MatchData } from '@/data/types';
import { playerState } from '@/viewer/sample';
import type { ShotVisual } from './actors';

/** Armes dont le tir ne laisse pas de traçante. */
const NO_TRACER = /knife|bayonet|grenade|flash|smoke|molotov|incgrenade|decoy|c4|taser|zeus|healthshot/i;

export interface ActionIndex {
  /** Ticks de tir par joueur (triés). */
  shots: number[][];
  /** Index (dans m.shots) des tirs, même ordre que shots. */
  shotIds: number[][];
  reloads: number[][];
}

export function buildActionIndex(m: MatchData): ActionIndex {
  const n = m.players.length;
  const shots: number[][] = Array.from({ length: n }, () => []);
  const shotIds: number[][] = Array.from({ length: n }, () => []);
  const reloads: number[][] = Array.from({ length: n }, () => []);
  m.shots.forEach((s, k) => { if (s.player < n) { shots[s.player].push(s.tick); shotIds[s.player].push(k); } });
  for (const r of m.reloads ?? []) if (r.player < n) reloads[r.player].push(r.tick);
  for (let i = 0; i < n; i++) {
    const order = shots[i].map((_, k) => k).sort((a, b) => shots[i][a] - shots[i][b]);
    shots[i] = order.map((k) => shots[i][k]);
    shotIds[i] = order.map((k) => shotIds[i][k]);
    reloads[i].sort((a, b) => a - b);
  }
  return { shots, shotIds, reloads };
}

/** Indice du dernier élément ≤ tick (ou -1). */
function lastAtOrBefore(arr: number[], tick: number): number {
  let lo = 0, hi = arr.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= tick) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  return best;
}

/** En l'air ? La trajectoire d'un saut est une parabole (gravité ≈ 800 u/s²), un escalier non. */
export function airState(m: MatchData, i: number, tick: number): 'rise' | 'fall' | undefined {
  const h = 2 * SAMPLE_STEP; // 1/8 s à 64 ticks
  const a = playerState(m, i, tick - h), b = playerState(m, i, tick), c = playerState(m, i, tick + h);
  if (!a.alive || !b.alive || !c.alive) return undefined;
  const dt = h / m.tickrate;
  const acc = (c.z - 2 * b.z + a.z) / (dt * dt);
  const vz = (c.z - a.z) / (2 * dt);
  if (acc > -350) return undefined;
  return vz > 0 ? 'rise' : 'fall';
}

/** Âge (s) du dernier changement d'arme en main, s'il date de moins de maxAge secondes. */
export function weaponChangeAge(m: MatchData, i: number, tick: number, maxAge = 1.5): number | undefined {
  const P = m.players.length, fr = m.frames;
  const f = Math.max(0, Math.min(fr.count - 1, Math.floor(tick / SAMPLE_STEP)));
  const w = fr.weapon[f * P + i];
  const steps = Math.ceil((maxAge * m.tickrate) / SAMPLE_STEP);
  for (let k = 1; k <= steps && f - k >= 0; k++) {
    const j = (f - k) * P + i;
    if (!(fr.present[j] && fr.weapon[j] >= 0)) return undefined;
    if (fr.weapon[j] !== w) return (tick - (f - k + 1) * SAMPLE_STEP) / m.tickrate;
  }
  return undefined;
}

export type Overlay = { kind: 'draw' | 'reload' | 'shoot'; age: number };

/** Action du haut du corps la plus récente : tir (0,4 s), rechargement (3 s), sortie d'arme (1,2 s). */
export function overlayAt(m: MatchData, idx: ActionIndex, i: number, tick: number): Overlay | null {
  const cands: Overlay[] = [];
  const s = lastAtOrBefore(idx.shots[i], tick);
  if (s >= 0) { const age = (tick - idx.shots[i][s]) / m.tickrate; if (age < 0.4 && !NO_TRACER.test(m.shots[idx.shotIds[i][s]].weapon)) cands.push({ kind: 'shoot', age }); }
  const r = lastAtOrBefore(idx.reloads[i], tick);
  if (r >= 0) { const age = (tick - idx.reloads[i][r]) / m.tickrate; if (age < 3) cands.push({ kind: 'reload', age }); }
  const d = weaponChangeAge(m, i, tick, 1.2);
  if (d !== undefined) cands.push({ kind: 'draw', age: d });
  if (!cands.length) return null;
  return cands.reduce((a, b) => (b.age < a.age ? b : a));
}

/** Point d'arrivée d'un tir : la victime touchée par ce tir, sinon le premier obstacle dans l'axe de visée. */
export type Ray = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxD: number) => number;

const TRACER_LIFE = 0.2; // s

/** Tirs visibles à ce tick (traçantes récentes), avec cache des cibles par tir. */
export function shotsAt(m: MatchData, idx: ActionIndex, tick: number, ray: Ray, cache: Map<number, ShotVisual>): ShotVisual[] {
  const out: ShotVisual[] = [];
  const life = TRACER_LIFE * m.tickrate;
  for (let i = 0; i < m.players.length; i++) {
    const arr = idx.shots[i];
    for (let k = lastAtOrBefore(arr, tick); k >= 0 && tick - arr[k] <= life; k--) {
      const id = idx.shotIds[i][k];
      const shot = m.shots[id];
      if (NO_TRACER.test(shot.weapon)) continue;
      let v = cache.get(id);
      if (!v) {
        const st = playerState(m, i, shot.tick);
        if (!st.alive) continue;
        const P = m.players.length;
        const f = Math.max(0, Math.min(m.frames.count - 1, Math.round(shot.tick / SAMPLE_STEP)));
        const pitch = (m.frames.pitch[f * P + i] * Math.PI) / 180, yaw = (st.yaw * Math.PI) / 180;
        const dx = Math.cos(pitch) * Math.cos(yaw), dy = Math.cos(pitch) * Math.sin(yaw), dz = -Math.sin(pitch);
        const eye = st.z + ((m.frames.flags[f * P + i] & 128) ? 46 : 64);
        // Départ au canon (un peu devant, sous les yeux, à droite)
        const from: [number, number, number] = [st.x + dx * 26 + Math.sin(yaw) * 5, st.y + dy * 26 - Math.cos(yaw) * 5, eye - 8 + dz * 26];
        let to: [number, number, number] | null = null;
        const hit = m.hurts.find((h) => h.attacker === i && h.tick >= shot.tick && h.tick <= shot.tick + 6 && h.weapon && shot.weapon.includes(h.weapon));
        if (hit) {
          const vs = playerState(m, hit.victim, hit.tick);
          const hz = hit.hitgroup === 'head' ? 62 : /leg/.test(hit.hitgroup) ? 22 : 44;
          to = [vs.x, vs.y, vs.z + hz];
        }
        if (!to) {
          const d = ray(st.x, st.y, eye, dx, dy, dz, 3000);
          to = [st.x + dx * d, st.y + dy * d, eye + dz * d];
        }
        v = { id, from, to, age: 0 };
        if (cache.size > 4000) cache.clear();
        cache.set(id, v);
      }
      out.push({ ...v, age: (tick - shot.tick) / m.tickrate });
    }
  }
  return out;
}
