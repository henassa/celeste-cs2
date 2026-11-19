// Résumé spatial compact d'un match, gardé dans la bibliothèque pour l'analyse multi-démos :
// rounds (économie, plant, vainqueur), kills et morts avec positions, grenades, positions des
// joueurs à quelques instants fixes du round. Quelques dizaines de Ko par match.

import { FLAG_ALIVE, SAMPLE_STEP, type GrenadeKind, type MatchData, type ThrowTechnique } from '../data/types';

/** 'run+jump', 'stand', 'walk+crouch'... */
export const techCode = (t: ThrowTechnique) => [t.move, t.jump && 'jump', t.crouch && 'crouch'].filter(Boolean).join('+');

export const SPATIAL_VERSION = 4;
/** Version minimale encore exploitable (les champs ajoutés ensuite sont optionnels). */
export const SPATIAL_MIN_VERSION = 1;
/** Instants (secondes après la fin du freeze time) où l'on note la position de chaque joueur. */
export const POS_TIMES = [10, 20, 30, 45, 60] as const;

export type BuyType = 'pistol' | 'eco' | 'force' | 'full';
export type TeamIdx = 0 | 1;

export interface SpatialRound {
  i: number;
  ctTeam: TeamIdx;
  winner: TeamIdx | null;
  reason: string;
  plantSite: 'A' | 'B' | null;
  /** Secondes après le freeze au moment du plant. */
  plantT: number | null;
  buy: [BuyType, BuyType];
  equip: [number, number];
  /** Équipe qui fait le premier kill du round. */
  firstKill: TeamIdx | null;
  /** v2 : joueurs en vie par équipe à la fin du freeze time. */
  alive?: [number, number];
  /** v2 : secondes après le freeze à la fin du round (victoire). */
  endT?: number;
  /** v4 : poseur de la bombe, défuseur et instant du défuse (secondes après le freeze). */
  planter?: number;
  defuser?: number;
  defuseT?: number | null;
}

export interface SpatialKill {
  r: number; t: number; k: number; v: number;
  kt: TeamIdx | -1; vt: TeamIdx;
  kx: number; ky: number; kz: number; vx: number; vy: number; vz: number;
  w: string; hs: 0 | 1;
  /** v2 : index dans places du callout du tueur / de la victime, -1 = inconnu. */
  kp?: number; vp?: number;
  /** v4 : passeur décisif (-1 = aucun). */
  a?: number;
}

export interface SpatialNade {
  r: number; t: number; p: number; team: TeamIdx | -1; kind: GrenadeKind; x: number; y: number; z: number;
  /** v3 : lancer exact (position, angles, technique codée 'run+jump+crouch'), callouts de départ et d'arrivée. */
  th?: { x: number; y: number; z: number; pitch: number; yaw: number; tech: string; t: number };
  fp?: number; lp?: number;
}
export interface SpatialPos { r: number; s: number; p: number; team: TeamIdx; x: number; y: number; z: number; /** v2 : callout */ pl?: number }

export interface MatchSpatial {
  version: number;
  rounds: SpatialRound[];
  kills: SpatialKill[];
  nades: SpatialNade[];
  pos: SpatialPos[];
  /** v2 : noms de callouts référencés par index. */
  places?: string[];
}

/** Type d'achat d'une équipe selon son équipement total en début de round. */
export function buyType(roundIndex: number, teamEquip: number): BuyType {
  if (roundIndex === 0 || roundIndex === 12) return 'pistol';
  if (teamEquip < 7500) return 'eco';
  if (teamEquip < 19000) return 'force';
  return 'full';
}

export function buildSpatial(m: MatchData): MatchSpatial {
  const P = m.players.length;
  const fr = m.frames;
  const tr = m.tickrate;
  const frameAt = (tick: number) => Math.max(0, Math.min(fr.count - 1, Math.round(tick / SAMPLE_STEP)));
  const teamOf = (p: number): TeamIdx | -1 => (p >= 0 && m.players[p] ? m.players[p].team : -1);
  const ri = (v: number) => Math.round(v);
  const t1 = (v: number) => Math.round(v * 10) / 10;

  // Callouts internés : un index par nom pour garder le résumé compact
  const places: string[] = [];
  const placeIdx = new Map<string, number>();
  const pl = (name: string): number => {
    if (!name) return -1;
    let i = placeIdx.get(name);
    if (i === undefined) { i = places.length; places.push(name); placeIdx.set(name, i); }
    return i;
  };

  const rounds: SpatialRound[] = m.rounds.map((r) => {
    // Équipement 5 s après le freeze (achats faits)
    const f = frameAt(r.freezeEndTick + 5 * tr);
    const equip: [number, number] = [0, 0];
    for (let p = 0; p < P; p++) {
      const j = f * P + p;
      if (fr.present[j] && (fr.flags[j] & FLAG_ALIVE)) equip[m.players[p].team] += fr.equip[j];
    }
    // Joueurs en vie juste après le freeze (déconnexions, 4v5)
    const f0 = frameAt(r.freezeEndTick + 8);
    const alive: [number, number] = [0, 0];
    for (let p = 0; p < P; p++) {
      const j = f0 * P + p;
      const side = fr.side[j];
      if (fr.present[j] && (fr.flags[j] & FLAG_ALIVE) && (side === 2 || side === 3)) alive[m.players[p].team]++;
    }
    const first = m.kills.find((k) => k.round === r.index && k.tick > r.freezeEndTick && k.killer >= 0 && k.killer !== k.victim
      && m.players[k.killer]?.team !== m.players[k.victim]?.team);
    return {
      i: r.index,
      ctTeam: r.ctTeam,
      winner: r.winnerTeam,
      reason: r.reason,
      plantSite: r.plant?.site ?? null,
      plantT: r.plant ? t1((r.plant.tick - r.freezeEndTick) / tr) : null,
      buy: [buyType(r.index, equip[0]), buyType(r.index, equip[1])],
      equip,
      firstKill: first ? m.players[first.killer].team : null,
      alive,
      endT: t1((r.endTick - r.freezeEndTick) / tr),
      planter: r.plant?.player ?? -1,
      defuser: r.defuseTick != null ? (m.bombEvents.find((b) => b.type === 'defuse' && b.tick === r.defuseTick)?.player ?? -1) : -1,
      defuseT: r.defuseTick != null ? t1((r.defuseTick - r.freezeEndTick) / tr) : null,
    };
  });

  const kills: SpatialKill[] = m.kills.map((k) => {
    const r = m.rounds[k.round];
    const kp = k.killerPos ?? [0, 0, 0];
    return {
      r: k.round, t: t1((k.tick - r.freezeEndTick) / tr), k: k.killer, v: k.victim,
      kt: k.killer >= 0 && k.killer !== k.victim ? teamOf(k.killer) : -1, vt: m.players[k.victim].team,
      kx: ri(kp[0]), ky: ri(kp[1]), kz: ri(kp[2]), vx: ri(k.victimPos[0]), vy: ri(k.victimPos[1]), vz: ri(k.victimPos[2]),
      w: k.weapon, hs: k.headshot ? 1 : 0,
      kp: pl(k.killerPlace ?? ''), vp: pl(k.victimPlace ?? ''), a: k.assister,
    };
  });

  const a2 = (v: number) => Math.round(v * 100) / 100;
  const nades: SpatialNade[] = m.grenades.map((g) => {
    const r = m.rounds[g.round];
    const th = g.throw;
    return {
      r: g.round, t: t1((g.detonateTick - r.freezeEndTick) / tr), p: g.thrower, team: teamOf(g.thrower), kind: g.kind,
      x: ri(g.effectPos[0]), y: ri(g.effectPos[1]), z: ri(g.effectPos[2]),
      th: th ? {
        x: a2(th.x), y: a2(th.y), z: a2(th.z), pitch: a2(th.pitch), yaw: a2(th.yaw),
        tech: techCode(th.tech), t: t1((th.tick - r.freezeEndTick) / tr),
      } : undefined,
      fp: th ? pl(th.place) : -1,
      lp: pl(g.landPlace ?? ''),
    };
  });

  const pos: SpatialPos[] = [];
  for (const r of m.rounds) {
    for (const s of POS_TIMES) {
      const tick = r.freezeEndTick + s * tr;
      if (tick >= r.endTick) break;
      const f = frameAt(tick);
      for (let p = 0; p < P; p++) {
        const j = f * P + p;
        if (!fr.present[j] || !(fr.flags[j] & FLAG_ALIVE)) continue;
        const pi = fr.place?.[j];
        pos.push({
          r: r.index, s, p, team: m.players[p].team, x: ri(fr.pos[j * 3]), y: ri(fr.pos[j * 3 + 1]), z: ri(fr.pos[j * 3 + 2]),
          pl: pi === undefined || pi === 255 ? -1 : pl(m.placeNames[pi] ?? ''),
        });
      }
    }
  }
  return { version: SPATIAL_VERSION, rounds, kills, nades, pos, places };
}
