// Détails du match repris des outils d'analyse courants : économie par round, armes et zones
// touchées, efficacité des grenades, matrice de dégâts entre joueurs.

import { FLAG_ALIVE, SAMPLE_STEP, type MatchData } from '../data/types';
import type { BuyType, MatchSpatial } from '../library/spatial';

const UTILITY = new Set(['hegrenade', 'inferno', 'molotov', 'incgrenade', 'flashbang', 'smokegrenade', 'decoy', 'world', 'planted_c4', '']);
// Les dégâts ne distinguent pas certaines variantes (M4A1-S / M4A4, USP-S / P2000) : on les regroupe
const ALIAS: Record<string, string> = { m4a1_silencer: 'm4a1/m4a4', m4a1: 'm4a1/m4a4', m4a4: 'm4a1/m4a4', usp_silencer: 'usp/p2000', hkp2000: 'usp/p2000' };
const clean = (w: string) => { const x = w.replace(/^weapon_/, ''); return ALIAS[x] ?? (x.startsWith('knife') || x === 'bayonet' ? 'knife' : x); };
const isUtility = (w: string) => UTILITY.has(clean(w));
/** Dégâts réels de chaque événement (plafonnés aux PV restants, comme le scoreboard). */
function dealtDamage(m: MatchData): number[] {
  const hp = new Map<string, number>();
  return m.hurts.map((h) => {
    const k = `${h.round}|${h.victim}`;
    let prev = hp.get(k) ?? 100;
    if (prev <= 0) prev = 100;
    hp.set(k, h.healthAfter);
    return Math.max(0, Math.min(h.dmgHealth, prev));
  });
}
const enemy = (m: MatchData, a: number, v: number) => a >= 0 && a !== v && m.players[a] && m.players[v] && m.players[a].team !== m.players[v].team;

// --- Économie ---

export interface EconomyRound {
  round: number;
  ctTeam: 0 | 1;
  winner: 0 | 1 | null;
  /** Par équipe : valeur de l'équipement, type d'achat, argent en banque après les achats. */
  equip: [number, number];
  buy: [BuyType, BuyType];
  bank: [number, number];
  /** Argent dépensé pendant le freeze (estimation : banque au début du freeze − banque après achats). */
  spent: [number, number];
}

export function economy(m: MatchData, sp: MatchSpatial): EconomyRound[] {
  const P = m.players.length, fr = m.frames;
  const frameAt = (tick: number) => Math.max(0, Math.min(fr.count - 1, Math.round(tick / SAMPLE_STEP)));
  return m.rounds.map((r, i) => {
    const sum = (tick: number) => {
      const f = frameAt(tick);
      const out: [number, number] = [0, 0];
      for (let p = 0; p < P; p++) {
        const j = f * P + p;
        if (fr.present[j] && (fr.flags[j] & FLAG_ALIVE) && (fr.side[j] === 2 || fr.side[j] === 3)) out[m.players[p].team as 0 | 1] += fr.money[j];
      }
      return out;
    };
    const start = sum(r.startTick + 8), after = sum(r.freezeEndTick + 5 * m.tickrate);
    return {
      round: i, ctTeam: r.ctTeam, winner: r.winnerTeam,
      equip: sp.rounds[i].equip, buy: sp.rounds[i].buy,
      bank: after, spent: [Math.max(0, start[0] - after[0]), Math.max(0, start[1] - after[1])],
    };
  });
}

/** Bilan des achats par équipe : rounds joués et gagnés par type d'achat, et contre quel achat. */
export function buySummary(rows: EconomyRound[], team: 0 | 1): { buy: BuyType; played: number; won: number; vsFull: number; vsFullWon: number }[] {
  const order: BuyType[] = ['pistol', 'eco', 'force', 'full'];
  return order.map((b) => {
    const rs = rows.filter((r) => r.buy[team] === b);
    const vf = rs.filter((r) => r.buy[1 - team] === 'full');
    return { buy: b, played: rs.length, won: rs.filter((r) => r.winner === team).length, vsFull: vf.length, vsFullWon: vf.filter((r) => r.winner === team).length };
  }).filter((x) => x.played);
}

// --- Armes et zones touchées ---

export const HITGROUPS = ['head', 'chest', 'stomach', 'arms', 'legs'] as const;
export type Hitgroup = (typeof HITGROUPS)[number];
function hitgroupOf(h: string): Hitgroup | null {
  const s = h.toLowerCase();
  if (s.includes('head') || s.includes('neck')) return 'head';
  if (s.includes('chest')) return 'chest';
  if (s.includes('stomach')) return 'stomach';
  if (s.includes('arm')) return 'arms';
  if (s.includes('leg')) return 'legs';
  return null;
}

export interface WeaponRow { player: number; weapon: string; kills: number; hs: number; damage: number; hits: number; shots: number }
export interface HitRow { player: number; hits: Record<Hitgroup, number>; total: number }

export function weapons(m: MatchData): { rows: WeaponRow[]; hitgroups: HitRow[] } {
  const map = new Map<string, WeaponRow>();
  const get = (p: number, w: string) => {
    const k = `${p}|${w}`;
    let r = map.get(k);
    if (!r) { r = { player: p, weapon: w, kills: 0, hs: 0, damage: 0, hits: 0, shots: 0 }; map.set(k, r); }
    return r;
  };
  for (const k of m.kills) if (enemy(m, k.killer, k.victim) && !isUtility(k.weapon)) { const r = get(k.killer, clean(k.weapon)); r.kills++; if (k.headshot) r.hs++; }
  const hg = new Map<number, HitRow>();
  const dealt = dealtDamage(m);
  for (const [i, h] of m.hurts.entries()) {
    if (!enemy(m, h.attacker, h.victim) || isUtility(h.weapon)) continue;
    const r = get(h.attacker, clean(h.weapon)); r.damage += dealt[i]; r.hits++;
    const g = hitgroupOf(h.hitgroup);
    if (!g) continue;
    let row = hg.get(h.attacker);
    if (!row) { row = { player: h.attacker, hits: { head: 0, chest: 0, stomach: 0, arms: 0, legs: 0 }, total: 0 }; hg.set(h.attacker, row); }
    row.hits[g]++; row.total++;
  }
  for (const s of m.shots) if (!isUtility(s.weapon)) { const k = `${s.player}|${clean(s.weapon)}`; const r = map.get(k); if (r) r.shots++; }
  return { rows: [...map.values()].filter((r) => r.kills || r.damage >= 50).sort((a, b) => b.kills - a.kills || b.damage - a.damage), hitgroups: [...hg.values()] };
}

// --- Grenades ---

export interface UtilityRow {
  player: number;
  thrown: { smoke: number; flash: number; he: number; molotov: number };
  /** Ennemis aveuglés ≥ 1,1 s, temps total d'aveuglement infligé aux ennemis (s). */
  enemiesBlinded: number; blindTime: number;
  /** Coéquipiers aveuglés ≥ 1,1 s. */
  teamBlinded: number;
  flashAssists: number;
  /** Ennemis tués par un coéquipier pendant qu'ils étaient aveuglés par ce joueur. */
  flashKills: number;
  heDamage: number; fireDamage: number;
  /** Dégâts moyens par HE / molotov lancée. */
  perHe: number | null; perFire: number | null;
}

export function utility(m: MatchData): UtilityRow[] {
  const dealt = dealtDamage(m);
  return m.players.map((pl, p) => {
    if (pl.team !== 0 && pl.team !== 1) return null;
    const g = m.grenades.filter((x) => x.thrower === p);
    const thrown = { smoke: 0, flash: 0, he: 0, molotov: 0 };
    for (const x of g) if (x.kind !== 'decoy') thrown[x.kind]++;
    const bl = m.blinds.filter((b) => b.attacker === p && b.duration >= 1.1 && b.victim !== p);
    const enemies = bl.filter((b) => enemy(m, p, b.victim));
    let flashKills = 0;
    for (const b of enemies) {
      const end = b.tick + b.duration * m.tickrate;
      if (m.kills.some((k) => k.victim === b.victim && k.tick >= b.tick && k.tick <= end && k.killer >= 0 && m.players[k.killer]?.team === pl.team)) flashKills++;
    }
    let he = 0, fire = 0;
    for (const [i, h] of m.hurts.entries()) {
      if (h.attacker !== p || !enemy(m, p, h.victim)) continue;
      const w = clean(h.weapon);
      if (w === 'hegrenade') he += dealt[i];
      else if (w === 'inferno' || w === 'molotov' || w === 'incgrenade') fire += dealt[i];
    }
    return {
      player: p, thrown,
      enemiesBlinded: enemies.length, blindTime: Math.round(enemies.reduce((a, b) => a + b.duration, 0) * 10) / 10,
      teamBlinded: bl.filter((b) => !enemy(m, p, b.victim)).length,
      flashAssists: m.kills.filter((k) => k.flashAssist && k.assister === p).length,
      flashKills, heDamage: he, fireDamage: fire,
      perHe: thrown.he ? Math.round(he / thrown.he) : null, perFire: thrown.molotov ? Math.round(fire / thrown.molotov) : null,
    };
  }).filter((x): x is UtilityRow => x !== null);
}

// --- Matrice de dégâts / kills ---

export interface DuelMatrix { left: number[]; right: number[]; damage: number[][]; kills: number[][] }

/** damage[i][j] : dégâts de left[i] sur right[j] ; la transposée (j sur i) est dans damageBack. */
export function duelMatrix(m: MatchData): DuelMatrix & { damageBack: number[][]; killsBack: number[][] } {
  const left = m.players.map((p, i) => (p.team === 0 ? i : -1)).filter((i) => i >= 0);
  const right = m.players.map((p, i) => (p.team === 1 ? i : -1)).filter((i) => i >= 0);
  const z = () => left.map(() => right.map(() => 0));
  const damage = z(), damageBack = z(), kills = z(), killsBack = z();
  const li = new Map(left.map((p, i) => [p, i])), ri = new Map(right.map((p, i) => [p, i]));
  const dealt = dealtDamage(m);
  for (const [i, h] of m.hurts.entries()) {
    if (li.has(h.attacker) && ri.has(h.victim)) damage[li.get(h.attacker)!][ri.get(h.victim)!] += dealt[i];
    else if (ri.has(h.attacker) && li.has(h.victim)) damageBack[li.get(h.victim)!][ri.get(h.attacker)!] += dealt[i];
  }
  for (const k of m.kills) {
    if (li.has(k.killer) && ri.has(k.victim)) kills[li.get(k.killer)!][ri.get(k.victim)!]++;
    else if (ri.has(k.killer) && li.has(k.victim)) killsBack[li.get(k.victim)!][ri.get(k.killer)!]++;
  }
  return { left, right, damage, damageBack, kills, killsBack };
}
