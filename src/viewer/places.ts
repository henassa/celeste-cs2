// Callouts (last_place_name) et commandes setpos pour reproduire une position en jeu.

import { SAMPLE_STEP, type MatchData } from '@/data/types';

/** "TopofMid" -> "Top of Mid", "CTSpawn" -> "CT Spawn", "BombsiteA" -> "Bombsite A". */
export function placeLabel(name: string): string {
  if (!name) return '';
  return name
    .replace(/of(?=[A-Z])/g, ' of ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Callout d'un joueur à une frame donnée ('' si inconnu). */
export function placeAt(m: MatchData, frame: number, player: number): string {
  const i = m.frames.place[frame * m.players.length + player];
  return i === 255 || i === undefined ? '' : m.placeNames[i] ?? '';
}

const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

/** Commande console CS2 pour se placer à une position avec un angle de vue. */
export function setposCommand(x: number, y: number, z: number, pitch: number, yaw: number): string {
  return `setpos ${f2(x)} ${f2(y)} ${f2(z)};setang ${f2(pitch)} ${f2(yaw)} 0.00`;
}

/** setpos d'un joueur à la frame la plus proche d'un tick. */
export function playerSetpos(m: MatchData, tick: number, player: number): string | null {
  const P = m.players.length;
  const f = Math.max(0, Math.min(m.frames.count - 1, Math.round(tick / SAMPLE_STEP)));
  const j = f * P + player;
  if (!m.frames.present[j]) return null;
  const p = m.frames.pos;
  return setposCommand(p[j * 3], p[j * 3 + 1], p[j * 3 + 2], m.frames.pitch[j], m.frames.yaw[j]);
}
