// Lecture de l'état du match à un tick donné (interpolation entre frames échantillonnées).

import {
  FLAG_ALIVE, NADE_SHIFT, SAMPLE_STEP,
  type BombEvent, type GrenadeKind, type MatchData, type RoundInfo,
} from '../data/types';

export interface PlayerState {
  index: number;
  present: boolean;
  alive: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  armor: number;
  money: number;
  side: number;
  flags: number;
  flash: number; // secondes restantes
  weapon: string;
  mainWeapon: string | null;
  nades: Record<GrenadeKind, number>;
}

const lerpAngle = (a: number, b: number, t: number): number => {
  let d = ((b - a + 540) % 360) - 180;
  return a + d * t;
};

export function playerState(m: MatchData, p: number, tick: number): PlayerState {
  const P = m.players.length;
  const fr = m.frames;
  const fPos = Math.max(0, Math.min(fr.count - 1, tick / SAMPLE_STEP));
  const f0 = Math.floor(fPos);
  const f1 = Math.min(fr.count - 1, f0 + 1);
  const t = fPos - f0;
  const j0 = f0 * P + p;
  const j1 = f1 * P + p;
  const flags = fr.flags[j0];
  const alive = (flags & FLAG_ALIVE) !== 0;
  let x = fr.pos[j0 * 3], y = fr.pos[j0 * 3 + 1], z = fr.pos[j0 * 3 + 2];
  let yaw = fr.yaw[j0];
  // Interpolation seulement si les deux frames sont valides et proches (pas de respawn / téléport)
  if (t > 0 && fr.present[j1] && (fr.flags[j1] & FLAG_ALIVE) && alive) {
    const x1 = fr.pos[j1 * 3], y1 = fr.pos[j1 * 3 + 1], z1 = fr.pos[j1 * 3 + 2];
    if (Math.abs(x1 - x) + Math.abs(y1 - y) < 300) {
      x += (x1 - x) * t; y += (y1 - y) * t; z += (z1 - z) * t;
      yaw = lerpAngle(yaw, fr.yaw[j1], t);
    }
  }
  const n = fr.nades[j0];
  const w = fr.weapon[j0];
  const mw = fr.mainWeapon[j0];
  return {
    index: p,
    present: fr.present[j0] === 1,
    alive,
    x, y, z, yaw,
    hp: fr.hp[j0],
    armor: fr.armor[j0],
    money: fr.money[j0],
    side: fr.side[j0],
    flags,
    flash: fr.flash[j0] / 10,
    weapon: w === 255 ? '' : m.weaponNames[w],
    mainWeapon: mw === 255 ? null : m.weaponNames[mw],
    nades: {
      smoke: (n >> NADE_SHIFT.smoke) & 7,
      flash: (n >> NADE_SHIFT.flash) & 7,
      he: (n >> NADE_SHIFT.he) & 7,
      molotov: (n >> NADE_SHIFT.molotov) & 7,
      decoy: (n >> NADE_SHIFT.decoy) & 7,
    },
  };
}

/** Index du round affiché à ce tick (le round courant, ou le dernier commencé). */
export function roundIndexAt(m: MatchData, tick: number): number {
  let ans = 0;
  for (let i = 0; i < m.rounds.length; i++) if (m.rounds[i].startTick <= tick) ans = i;
  return ans;
}

export type RoundPhase = 'freeze' | 'live' | 'planted' | 'over';

export interface RoundClock {
  phase: RoundPhase;
  /** Secondes restantes dans la phase (freeze, round, bombe). */
  remaining: number;
}

const ROUND_TIME = 115; // 1:55 en compétitif
const BOMB_TIME = 40;

export function roundClock(m: MatchData, r: RoundInfo, tick: number): RoundClock {
  const tr = m.tickrate;
  if (tick >= r.endTick) return { phase: 'over', remaining: Math.max(0, (r.officialEndTick - tick) / tr) };
  if (r.plant && tick >= r.plant.tick) return { phase: 'planted', remaining: Math.max(0, BOMB_TIME - (tick - r.plant.tick) / tr) };
  if (tick < r.freezeEndTick) return { phase: 'freeze', remaining: (r.freezeEndTick - tick) / tr };
  return { phase: 'live', remaining: Math.max(0, ROUND_TIME - (tick - r.freezeEndTick) / tr) };
}

export function formatClock(sec: number): string {
  const s = Math.ceil(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type BombState =
  | { kind: 'hidden' }
  | { kind: 'carried'; player: number }
  | { kind: 'dropped' | 'planted' | 'defused' | 'exploded'; x: number; y: number; z: number; since: number };

/** État de la bombe à un tick, d'après les événements du round. */
export function bombState(m: MatchData, r: RoundInfo, tick: number, carrierFromFlags: number): BombState {
  let state: BombState = carrierFromFlags >= 0 ? { kind: 'carried', player: carrierFromFlags } : { kind: 'hidden' };
  let plantPos: BombEvent | null = null;
  for (const b of m.bombEvents) {
    if (b.tick < r.startTick) continue;
    if (b.tick > tick || b.tick > r.officialEndTick) break;
    switch (b.type) {
      case 'pickup': state = { kind: 'carried', player: b.player }; break;
      case 'drop': state = { kind: 'dropped', x: b.x, y: b.y, z: b.z, since: b.tick }; break;
      case 'plant': plantPos = b; state = { kind: 'planted', x: b.x, y: b.y, z: b.z, since: b.tick }; break;
      case 'defuse': if (plantPos) state = { kind: 'defused', x: plantPos.x, y: plantPos.y, z: plantPos.z, since: b.tick }; break;
      case 'explode': if (plantPos) state = { kind: 'exploded', x: plantPos.x, y: plantPos.y, z: plantPos.z, since: b.tick }; break;
    }
  }
  // Le porteur réel (inventaire) prime sur les événements pour l'état "porté"
  if (state.kind === 'carried' && carrierFromFlags >= 0) state = { kind: 'carried', player: carrierFromFlags };
  return state;
}
