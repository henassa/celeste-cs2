// Stats d'aim et de duel.
// Calculées directement : précision, tirs à l'arrêt, temps pour tuer, duels gagnés en touchant le
// premier. À la demande (seconde passe sur la démo, angles au tick près autour de chaque duel) :
// temps de réaction (de « repéré » au premier dégât) et placement du viseur au moment où
// l'adversaire devient visible (flag « spotted by » du serveur, approximatif).

import { FLAG_ALIVE, SAMPLE_STEP, type MatchData } from '../data/types';

export interface AimBasic {
  player: number;
  shots: number;
  hits: number;
  /** Tirs (fusils, SMG, pistolets) faits à moins de 80 u/s. */
  stoppedShots: number;
  ttk: number[];
  /** Kills en une seule touche (premier dégât = kill). */
  oneTaps: number;
  kills: number;
  /** Duels où le joueur touche le premier : gagnés / joués ; et quand il est touché le premier. */
  firstHit: { won: number; played: number };
  hitFirst: { won: number; played: number };
}

export interface AimAdvanced {
  player: number;
  /** Temps de réaction (ms) et placement du viseur (degrés) par duel mesurable. */
  reaction: number[];
  crosshair: number[];
}

export interface AimSummary {
  player: number;
  accuracy: number | null;
  stoppedPct: number | null;
  ttkMs: number | null;
  oneTapPct: number | null;
  firstHitWin: number | null;
  hitFirstWin: number | null;
  reactionMs: number | null;
  crosshairDeg: number | null;
  samples: { shots: number; duels: number; measured: number };
}

/** Arme à feu (hors fusils à pompe) : noms « weapon_ak47 » (tirs) ou « ak47 » (dégâts). */
const NOT_GUN = /knife|bayonet|grenade|flashbang|molotov|incgrenade|inferno|decoy|c4|taser|world|nova|xm1014|mag7|sawedoff/;
export const isGun = (w: string) => !!w && !NOT_GUN.test(w.replace(/^weapon_/, ''));
export const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const k = Math.floor(s.length / 2); return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

/** Vitesse horizontale (u/s) d'un joueur autour d'un tick, d'après les positions échantillonnées. */
function speedAt(m: MatchData, p: number, tick: number): number {
  const P = m.players.length, f = Math.round(tick / SAMPLE_STEP);
  const a = Math.max(0, f - 1), b = Math.min(m.frames.count - 1, f + 1);
  const ja = a * P + p, jb = b * P + p;
  if (!m.frames.present[ja] || !m.frames.present[jb]) return 0;
  const dx = m.frames.pos[jb * 3] - m.frames.pos[ja * 3], dy = m.frames.pos[jb * 3 + 1] - m.frames.pos[ja * 3 + 1];
  const dt = ((b - a) * SAMPLE_STEP) / m.tickrate;
  return dt > 0 ? Math.hypot(dx, dy) / dt : 0;
}

/** Premier dégât de A sur V dans chaque round : un « duel ». */
export interface Engagement { round: number; a: number; v: number; tick: number }

export function engagements(m: MatchData): Engagement[] {
  const seen = new Set<string>();
  const out: Engagement[] = [];
  for (const h of m.hurts) {
    if (h.attacker < 0 || h.attacker === h.victim || !isGun(h.weapon)) continue;
    if (m.players[h.attacker]?.team === m.players[h.victim]?.team) continue;
    const key = `${h.round}:${h.attacker}:${h.victim}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ round: h.round, a: h.attacker, v: h.victim, tick: h.tick });
  }
  return out;
}

export function aimBasic(m: MatchData): Map<number, AimBasic> {
  const out = new Map<number, AimBasic>();
  const get = (p: number) => { let a = out.get(p); if (!a) out.set(p, (a = { player: p, shots: 0, hits: 0, stoppedShots: 0, ttk: [], oneTaps: 0, kills: 0, firstHit: { won: 0, played: 0 }, hitFirst: { won: 0, played: 0 } })); return a; };
  for (const s of m.shots) {
    if (!isGun(s.weapon) || s.player < 0) continue;
    const a = get(s.player);
    a.shots++;
    if (speedAt(m, s.player, s.tick) < 80) a.stoppedShots++;
  }
  for (const h of m.hurts) if (h.attacker >= 0 && h.attacker !== h.victim && isGun(h.weapon) && m.players[h.attacker]?.team !== m.players[h.victim]?.team) get(h.attacker).hits++;
  // Duels : la première touche entre deux joueurs, puis qui tue l'autre en premier
  const firstContact = new Map<string, Engagement>();
  for (const e of engagements(m)) {
    const pair = `${e.round}:${Math.min(e.a, e.v)}:${Math.max(e.a, e.v)}`;
    if (!firstContact.has(pair)) firstContact.set(pair, e);
  }
  const killsByRound = new Map<number, typeof m.kills>();
  for (const k of m.kills) { const l = killsByRound.get(k.round) ?? []; l.push(k); killsByRound.set(k.round, l); }
  for (const e of firstContact.values()) {
    const k = (killsByRound.get(e.round) ?? []).find((x) => x.tick >= e.tick && ((x.killer === e.a && x.victim === e.v) || (x.killer === e.v && x.victim === e.a)));
    if (!k) continue;
    const aWon = k.killer === e.a;
    get(e.a).firstHit.played++; if (aWon) get(e.a).firstHit.won++;
    get(e.v).hitFirst.played++; if (!aWon) get(e.v).hitFirst.won++;
  }
  // Temps pour tuer : premier dégât de A sur V -> mort de V tuée par A (moins de 5 s)
  for (const e of engagements(m)) {
    const k = (killsByRound.get(e.round) ?? []).find((x) => x.killer === e.a && x.victim === e.v && x.tick >= e.tick);
    if (!k || k.tick - e.tick >= 5 * m.tickrate) continue;
    const a = get(e.a);
    a.kills++;
    // Une seule touche : le premier dégât est le kill (TTK nul, compté à part)
    if (k.tick === e.tick) a.oneTaps++; else a.ttk.push(((k.tick - e.tick) / m.tickrate) * 1000);
  }
  return out;
}

/** Ticks à lire au tick près pour la seconde passe : 1,5 s avant chaque duel, un tick sur deux. */
export function aimWindowTicks(m: MatchData): Int32Array {
  const set = new Set<number>();
  const w = Math.round(1.5 * m.tickrate);
  for (const e of engagements(m)) for (let t = e.tick - w; t <= e.tick; t += 2) if (t > 0) set.add(t);
  return Int32Array.from([...set].sort((a, b) => a - b));
}

/** Lignes de la seconde passe (une par joueur et par tick). */
export interface AimRows {
  ticks: Int32Array;
  steamids: string[];
  x: Float32Array; y: Float32Array; z: Float32Array;
  pitch: Float32Array; yaw: Float32Array;
  /** SteamID des joueurs qui voient ce joueur, séparés par des virgules. */
  spottedBy: string[];
}

const EYE = 64;

/** Angle (degrés) entre la vue de A et la direction vers la tête de V. */
export function aimError(ax: number, ay: number, az: number, pitch: number, yaw: number, vx: number, vy: number, vz: number): number {
  const p = (pitch * Math.PI) / 180, w = (yaw * Math.PI) / 180;
  const view = [Math.cos(p) * Math.cos(w), Math.cos(p) * Math.sin(w), -Math.sin(p)];
  const d = [vx - ax, vy - ay, vz + EYE - (az + EYE)];
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  const dot = (view[0] * d[0] + view[1] * d[1] + view[2] * d[2]) / n;
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

export function aimAdvanced(m: MatchData, rows: AimRows): Map<number, AimAdvanced> {
  const out = new Map<number, AimAdvanced>();
  const idx = new Map(m.players.map((p, i) => [p.steamid, i]));
  // Index : tick -> joueur -> ligne
  const at = new Map<number, Map<number, number>>();
  for (let i = 0; i < rows.ticks.length; i++) {
    const p = idx.get(rows.steamids[i]);
    if (p === undefined) continue;
    let mp = at.get(rows.ticks[i]);
    if (!mp) at.set(rows.ticks[i], (mp = new Map()));
    mp.set(p, i);
  }
  const w = Math.round(1.5 * m.tickrate);
  for (const e of engagements(m)) {
    const aSid = m.players[e.a].steamid;
    let prevSeen: boolean | null = null, spotTick = -1;
    for (let t = e.tick - w; t <= e.tick; t += 2) {
      const vi = at.get(t)?.get(e.v);
      if (vi === undefined) continue;
      const seen = rows.spottedBy[vi].split(',').includes(aSid);
      if (prevSeen === false && seen) { spotTick = t; break; }
      prevSeen = seen;
    }
    // Repéré dès le début de la fenêtre (ou jamais) : pas mesurable
    if (spotTick < 0) continue;
    const ai = at.get(spotTick)?.get(e.a), vi = at.get(spotTick)?.get(e.v);
    if (ai === undefined || vi === undefined) continue;
    const f = Math.round(spotTick / SAMPLE_STEP) * m.players.length;
    if (!(m.frames.flags[f + e.a] & FLAG_ALIVE)) continue;
    let a = out.get(e.a);
    if (!a) out.set(e.a, (a = { player: e.a, reaction: [], crosshair: [] }));
    a.reaction.push(((e.tick - spotTick) / m.tickrate) * 1000);
    a.crosshair.push(aimError(rows.x[ai], rows.y[ai], rows.z[ai], rows.pitch[ai], rows.yaw[ai], rows.x[vi], rows.y[vi], rows.z[vi]));
  }
  return out;
}

export function summarizeAim(m: MatchData, basic: Map<number, AimBasic>, adv: Map<number, AimAdvanced> | null): AimSummary[] {
  return m.players.map((_, p) => {
    const b = basic.get(p), a = adv?.get(p);
    const ratio = (r?: { won: number; played: number }) => (r && r.played ? (r.won / r.played) * 100 : null);
    return {
      player: p,
      accuracy: b && b.shots ? (b.hits / b.shots) * 100 : null,
      stoppedPct: b && b.shots ? (b.stoppedShots / b.shots) * 100 : null,
      ttkMs: median(b?.ttk ?? []),
      oneTapPct: b && b.kills ? (b.oneTaps / b.kills) * 100 : null,
      firstHitWin: ratio(b?.firstHit),
      hitFirstWin: ratio(b?.hitFirst),
      reactionMs: median(a?.reaction ?? []),
      crosshairDeg: median(a?.crosshair ?? []),
      samples: { shots: b?.shots ?? 0, duels: (b?.firstHit.played ?? 0) + (b?.hitFirst.played ?? 0), measured: a?.reaction.length ?? 0 },
    };
  });
}

/** Convertit la sortie colonnes de parseTicks (Map ou objet) en AimRows. */
export function aimRowsFromTicks(raw: unknown): AimRows {
  const o = (raw instanceof Map ? Object.fromEntries(raw) : raw ?? {}) as Record<string, unknown[]>;
  const n = o.tick?.length ?? 0;
  const f32 = (k: string) => Float32Array.from({ length: n }, (_, i) => Number(o[k]?.[i]) || 0);
  return {
    ticks: Int32Array.from({ length: n }, (_, i) => Number(o.tick[i]) || 0),
    steamids: Array.from({ length: n }, (_, i) => String(o.steamid?.[i] ?? '')),
    x: f32('X'), y: f32('Y'), z: f32('Z'), pitch: f32('pitch'), yaw: f32('yaw'),
    spottedBy: Array.from({ length: n }, (_, i) => {
      const v = o.approximate_spotted_by?.[i];
      return Array.isArray(v) ? v.map(String).join(',') : '';
    }),
  };
}
