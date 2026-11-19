// Construit un MatchData compact à partir des sorties brutes de demoparser2.
// Fonction pure (sans DOM ni WASM) : testable en Node sur de vraies démos.

import {
  FLAG_ALIVE, FLAG_DEFUSER, FLAG_DEFUSING, FLAG_DUCKING, FLAG_HAS_BOMB, FLAG_HELMET, FLAG_PLANTING, FLAG_SCOPED,
  MATCH_FORMAT_VERSION, NADE_SHIFT, SAMPLE_STEP, SIDE_CT, SIDE_T,
  type BlindEvent, type BombEvent, type BombEventType, type Frames, type GrenadeInfo, type GrenadeKind,
  type HurtEvent, type KillEvent, type MatchData, type PlayerInfo, type RoundInfo, type ShotEvent,
  type Side, type TeamIndex, type ThrowTechnique,
} from '../data/types';
import { BOMB_ITEM, NADE_BY_ITEM, mainWeaponOf } from './weapons';

type Row = Record<string, unknown>;
type Columns = Record<string, unknown[]>;

export interface RawDemo {
  fileName: string;
  fileSize: number;
  header: Record<string, string>;
  events: Row[];
  ticks: Columns;
  grenades: Columns;
  timings: Record<string, number>;
}

const TICKRATE = 64;

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const bool = (v: unknown): boolean => v === true || v === 1;

/** Clé d'identité d'un joueur : SteamID64, ou nom pour les bots (SteamID 0). */
function playerKey(steamid: unknown, name: unknown): string {
  const s = str(steamid);
  return s && s !== '0' ? s : `bot:${str(name)}`;
}

export function buildMatch(raw: RawDemo): MatchData {
  const t0 = performance.now();
  const events = raw.events;
  const byName = new Map<string, Row[]>();
  let maxEventTick = 0;
  for (const e of events) {
    const n = str(e.event_name);
    let list = byName.get(n);
    if (!list) byName.set(n, (list = []));
    list.push(e);
    maxEventTick = Math.max(maxEventTick, num(e.tick));
  }
  const ev = (n: string): Row[] => byName.get(n) ?? [];

  // --- Début du match : dernier begin_new_match (fin du warmup) ---
  const starts = ev('begin_new_match').map((e) => num(e.tick));
  const matchStartTick = starts.length ? Math.max(...starts) : 0;

  // --- Joueurs : identités vues dans les ticks, sur T ou CT après le début du match ---
  const tk = raw.ticks;
  const tTick = tk.tick ?? [];
  const nRows = tTick.length;
  const keyOfRow: string[] = Array.from({ length: nRows }, () => "");
  const playerOrder: string[] = [];
  const seen = new Map<string, { name: string; activeFrames: number }>();
  for (let i = 0; i < nRows; i++) {
    const k = playerKey(tk.steamid?.[i], tk.name?.[i]);
    keyOfRow[i] = k;
    let s = seen.get(k);
    if (!s) { seen.set(k, (s = { name: str(tk.name?.[i]), activeFrames: 0 })); playerOrder.push(k); }
    const side = num(tk.team_num?.[i]);
    if ((side === SIDE_T || side === SIDE_CT) && num(tTick[i]) >= matchStartTick) s.activeFrames++;
    const nm = str(tk.name?.[i]);
    if (nm) s.name = nm;
  }
  const keys = playerOrder.filter((k) => (seen.get(k)?.activeFrames ?? 0) > 0);
  const pIndex = new Map(keys.map((k, i) => [k, i]));
  const P = keys.length;
  const idx = (steamid: unknown, name?: unknown): number => {
    if (steamid == null || steamid === '') return -1;
    return pIndex.get(playerKey(steamid, name)) ?? -1;
  };

  // --- Frames (positions échantillonnées) ---
  const lastTick = Math.max(maxEventTick, nRows ? num(tTick[nRows - 1]) : 0);
  const F = Math.floor(lastTick / SAMPLE_STEP) + 1;
  const frames: Frames = {
    count: F,
    ticks: new Int32Array(F),
    present: new Uint8Array(F * P),
    pos: new Float32Array(F * P * 3),
    yaw: new Float32Array(F * P),
    pitch: new Float32Array(F * P),
    hp: new Uint8Array(F * P),
    armor: new Uint8Array(F * P),
    money: new Uint16Array(F * P),
    side: new Uint8Array(F * P),
    flags: new Uint8Array(F * P),
    flash: new Uint8Array(F * P),
    weapon: new Uint8Array(F * P).fill(255),
    mainWeapon: new Uint8Array(F * P).fill(255),
    nades: new Uint16Array(F * P),
    equip: new Uint16Array(F * P),
    zone: new Uint8Array(F * P),
    place: new Uint8Array(F * P).fill(255),
  };
  for (let f = 0; f < F; f++) frames.ticks[f] = f * SAMPLE_STEP;

  const weaponNames: string[] = [];
  const weaponIdx = new Map<string, number>();
  const wIndex = (w: string): number => {
    if (!w) return 255;
    let i = weaponIdx.get(w);
    if (i === undefined) {
      i = weaponNames.length;
      if (i >= 255) return 255; // sécurité : 255 = inconnu
      weaponNames.push(w);
      weaponIdx.set(w, i);
    }
    return i;
  };

  const placeNames: string[] = [];
  const placeIdx = new Map<string, number>();
  const plIndex = (n: string): number => {
    if (!n) return 255;
    let i = placeIdx.get(n);
    if (i === undefined) {
      if (placeNames.length >= 255) return 255;
      i = placeNames.length;
      placeNames.push(n);
      placeIdx.set(n, i);
    }
    return i;
  };

  const colorVotes: Map<string, number>[] = Array.from({ length: P }, () => new Map());
  const clanVotes: Map<string, number>[] = Array.from({ length: P }, () => new Map());
  const c = tk;
  for (let i = 0; i < nRows; i++) {
    const p = pIndex.get(keyOfRow[i]);
    if (p === undefined) continue;
    const f = Math.round(num(tTick[i]) / SAMPLE_STEP);
    if (f < 0 || f >= F) continue;
    const j = f * P + p;
    frames.present[j] = 1;
    frames.pos[j * 3] = num(c.X?.[i]);
    frames.pos[j * 3 + 1] = num(c.Y?.[i]);
    frames.pos[j * 3 + 2] = num(c.Z?.[i]);
    frames.yaw[j] = num(c.yaw?.[i]);
    frames.pitch[j] = num(c.pitch?.[i]);
    frames.place[j] = plIndex(str(c.last_place_name?.[i]));
    frames.hp[j] = Math.min(255, Math.max(0, num(c.health?.[i])));
    frames.armor[j] = Math.min(255, Math.max(0, num(c.armor_value?.[i])));
    frames.money[j] = Math.min(65535, Math.max(0, num(c.balance?.[i])));
    frames.equip[j] = Math.min(65535, Math.max(0, num(c.current_equip_value?.[i])));
    frames.zone[j] = Math.min(255, Math.max(0, num(c.which_bomb_zone?.[i])));
    frames.side[j] = num(c.team_num?.[i]);
    frames.flash[j] = Math.min(255, Math.round(num(c.flash_duration?.[i]) * 10));
    frames.weapon[j] = wIndex(str(c.active_weapon_name?.[i]));
    let fl = 0;
    if (bool(c.is_alive?.[i])) fl |= FLAG_ALIVE;
    if (bool(c.has_helmet?.[i])) fl |= FLAG_HELMET;
    if (bool(c.has_defuser?.[i])) fl |= FLAG_DEFUSER;
    if (bool(c.is_scoped?.[i])) fl |= FLAG_SCOPED;
    if (bool(c.is_defusing?.[i])) fl |= FLAG_DEFUSING;
    if (bool(c.is_planting?.[i])) fl |= FLAG_PLANTING;
    if (num(c.duck_amount?.[i]) > 0.5) fl |= FLAG_DUCKING;
    const inv = c.inventory?.[i];
    if (Array.isArray(inv)) {
      let nades = 0;
      for (const it of inv as string[]) {
        const kind = NADE_BY_ITEM[it];
        if (kind) {
          const sh = NADE_SHIFT[kind];
          const cur = (nades >> sh) & 7;
          nades = (nades & ~(7 << sh)) | (Math.min(7, cur + 1) << sh);
        } else if (it === BOMB_ITEM) fl |= FLAG_HAS_BOMB;
      }
      frames.nades[j] = nades;
      const mw = mainWeaponOf(inv as string[]);
      frames.mainWeapon[j] = mw ? wIndex(mw) : 255;
    }
    frames.flags[j] = fl;
    if (f % 64 === 0) {
      const col = str(c.player_color?.[i]);
      if (col) colorVotes[p].set(col, (colorVotes[p].get(col) ?? 0) + 1);
      const clan = str(c.team_clan_name?.[i]);
      if (clan) clanVotes[p].set(clan, (clanVotes[p].get(clan) ?? 0) + 1);
    }
  }
  const tFrames = performance.now();

  // --- Rounds ---
  const roundStarts = ev('round_start').map((e) => num(e.tick)).sort((a, b) => a - b);
  const freezeEnds = ev('round_freeze_end').map((e) => num(e.tick)).sort((a, b) => a - b);
  const officialEnds = ev('round_officially_ended').map((e) => num(e.tick)).sort((a, b) => a - b);
  const roundEnds = ev('round_end')
    .filter((e) => num(e.tick) > matchStartTick && (str(e.winner) === 'T' || str(e.winner) === 'CT'))
    .sort((a, b) => num(a.tick) - num(b.tick));

  const lastBefore = (arr: number[], lo: number, hi: number): number | null => {
    let r: number | null = null;
    for (const t of arr) if (t > lo && t <= hi) r = t;
    return r;
  };
  const firstAfter = (arr: number[], lo: number, hi: number): number | null => {
    for (const t of arr) if (t > lo && t <= hi) return t;
    return null;
  };

  const rounds: RoundInfo[] = [];
  let prevEnd = matchStartTick;
  for (let r = 0; r < roundEnds.length; r++) {
    const endTick = num(roundEnds[r].tick);
    const startTick = lastBefore(roundStarts, prevEnd - 1, endTick) ?? prevEnd;
    const freezeEndTick = lastBefore(freezeEnds, startTick - 1, endTick) ?? startTick;
    const nextEnd = r + 1 < roundEnds.length ? num(roundEnds[r + 1].tick) : lastTick;
    const officialEndTick = firstAfter(officialEnds, endTick, nextEnd)
      ?? Math.min(lastTick, endTick + 7 * TICKRATE);
    const winnerSide: Side = str(roundEnds[r].winner) === 'CT' ? SIDE_CT : SIDE_T;
    rounds.push({
      index: r,
      number: r + 1,
      startTick,
      freezeEndTick,
      endTick,
      officialEndTick,
      winnerSide,
      winnerTeam: null,
      reason: str(roundEnds[r].reason),
      scoreAfter: [0, 0],
      ctTeam: 0,
      plant: null,
      defuseTick: null,
      explodeTick: null,
    });
    prevEnd = officialEndTick;
  }

  const roundAt = (tick: number): number => {
    // Round contenant le tick (de son début jusqu'au début du round suivant)
    let lo = 0, hi = rounds.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rounds[mid].startTick <= tick) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (ans === -1) return -1;
    const next = rounds[ans + 1];
    if (!next && tick > rounds[ans].officialEndTick + 10 * TICKRATE) return -1;
    return ans;
  };

  // --- Équipes : sides au freeze end de chaque round, avec détection des changements de côté ---
  const sideAt = (tick: number, p: number): number => {
    const f = Math.min(F - 1, Math.max(0, Math.round(tick / SAMPLE_STEP)));
    return frames.present[f * P + p] ? frames.side[f * P + p] : 0;
  };
  const roundSides: number[][] = rounds.map((rd) => {
    const t = Math.min(rd.freezeEndTick + TICKRATE, rd.endTick);
    return Array.from({ length: P }, (_, p) => sideAt(t, p));
  });
  const ref = roundSides[0] ?? Array.from({ length: P }, () => 0);
  const swapped = roundSides.map((sides) => {
    let same = 0, diff = 0;
    for (let p = 0; p < P; p++) {
      const a = ref[p], b = sides[p];
      if ((a === SIDE_T || a === SIDE_CT) && (b === SIDE_T || b === SIDE_CT)) {
        if (a === b) same++; else diff++;
      }
    }
    return diff > same;
  });
  // Équipe 0 = côté CT au premier round.
  const teamOf: TeamIndex[] = Array.from({ length: P }, (_, p) => {
    let v0 = 0, v1 = 0;
    roundSides.forEach((sides, r) => {
      const s = sides[p];
      if (s !== SIDE_T && s !== SIDE_CT) return;
      const normalized = swapped[r] ? (s === SIDE_CT ? SIDE_T : SIDE_CT) : s;
      if (normalized === SIDE_CT) v0++; else v1++;
    });
    if (v0 === 0 && v1 === 0) {
      // Jamais vu au freeze end : on prend le premier côté vu après le début du match.
      for (let f = Math.floor(matchStartTick / SAMPLE_STEP); f < F; f++) {
        const s = frames.side[f * P + p];
        if (s === SIDE_T || s === SIDE_CT) {
          const r = Math.max(0, roundAt(f * SAMPLE_STEP));
          const norm = swapped[r] ? (s === SIDE_CT ? SIDE_T : SIDE_CT) : s;
          return norm === SIDE_CT ? 0 : 1;
        }
      }
    }
    return v0 >= v1 ? 0 : 1;
  });

  const mode = (m: Map<string, number>): string | null => {
    let best: string | null = null, bc = 0;
    for (const [k, v] of m) if (v > bc) { best = k; bc = v; }
    return best;
  };
  const COLOR_ORDER = ['blue', 'green', 'yellow', 'orange', 'purple'];
  const players: PlayerInfo[] = keys.map((k, p) => ({
    steamid: k.startsWith('bot:') ? '0' : k,
    name: seen.get(k)?.name ?? k,
    team: teamOf[p],
    slot: 0,
    color: mode(colorVotes[p]),
  }));
  for (const team of [0, 1] as TeamIndex[]) {
    const members = players.map((pl, i) => ({ pl, i })).filter((x) => x.pl.team === team);
    members.sort((a, b) => {
      const ca = COLOR_ORDER.indexOf(a.pl.color ?? ''), cb = COLOR_ORDER.indexOf(b.pl.color ?? '');
      return (ca === -1 ? 99 : ca) - (cb === -1 ? 99 : cb) || a.i - b.i;
    });
    members.forEach((m, n) => { m.pl.slot = n + 1; });
  }
  const teamName = (team: TeamIndex, fallback: string): string => {
    const votes = new Map<string, number>();
    players.forEach((pl, p) => {
      if (pl.team !== team) return;
      for (const [k, v] of clanVotes[p]) votes.set(k, (votes.get(k) ?? 0) + v);
    });
    return mode(votes) ?? fallback;
  };
  const teams: MatchData['teams'] = [
    { name: teamName(0, 'Team A'), startSide: SIDE_CT },
    { name: teamName(1, 'Team B'), startSide: SIDE_T },
  ];

  const score: [number, number] = [0, 0];
  rounds.forEach((rd, r) => {
    rd.ctTeam = swapped[r] ? 1 : 0;
    rd.winnerTeam = rd.winnerSide === SIDE_CT ? rd.ctTeam : ((1 - rd.ctTeam) as TeamIndex);
    score[rd.winnerTeam]++;
    rd.scoreAfter = [score[0], score[1]];
  });

  // --- Événements ---
  const inMatch = (e: Row): boolean => num(e.tick) >= matchStartTick && roundAt(num(e.tick)) >= 0;
  const pos3 = (e: Row, prefix: string): [number, number, number] =>
    [num(e[`${prefix}_X`]), num(e[`${prefix}_Y`]), num(e[`${prefix}_Z`])];

  const kills: KillEvent[] = ev('player_death').filter(inMatch).map((e) => {
    const killer = idx(e.attacker_steamid, e.attacker_name);
    return {
      tick: num(e.tick),
      round: roundAt(num(e.tick)),
      killer,
      victim: idx(e.user_steamid, e.user_name),
      assister: idx(e.assister_steamid, e.assister_name),
      flashAssist: bool(e.assistedflash),
      weapon: str(e.weapon),
      headshot: bool(e.headshot),
      penetrated: num(e.penetrated) > 0,
      thruSmoke: bool(e.thrusmoke),
      noScope: bool(e.noscope),
      attackerBlind: bool(e.attackerblind),
      killerPos: killer >= 0 && e.attacker_X != null ? pos3(e, 'attacker') : null,
      victimPos: pos3(e, 'user'),
      killerPlace: killer >= 0 ? str(e.attacker_last_place_name) : '',
      victimPlace: str(e.user_last_place_name),
    };
  }).filter((k) => k.victim >= 0);

  const hurts: HurtEvent[] = ev('player_hurt').filter(inMatch).map((e) => ({
    tick: num(e.tick),
    round: roundAt(num(e.tick)),
    attacker: idx(e.attacker_steamid, e.attacker_name),
    victim: idx(e.user_steamid, e.user_name),
    dmgHealth: num(e.dmg_health),
    dmgArmor: num(e.dmg_armor),
    healthAfter: num(e.health),
    weapon: str(e.weapon),
    hitgroup: str(e.hitgroup),
  })).filter((h) => h.victim >= 0);

  const blinds: BlindEvent[] = ev('player_blind').filter(inMatch).map((e) => ({
    tick: num(e.tick),
    victim: idx(e.user_steamid, e.user_name),
    attacker: idx(e.attacker_steamid, e.attacker_name),
    duration: num(e.blind_duration),
  })).filter((b) => b.victim >= 0);

  const shots: ShotEvent[] = ev('weapon_fire').filter(inMatch).map((e) => ({
    tick: num(e.tick),
    player: idx(e.user_steamid, e.user_name),
    weapon: str(e.weapon),
  })).filter((s) => s.player >= 0);

  // Rechargements (animation dans la vue 3D)
  const reloads = ev('weapon_reload').filter(inMatch).map((e) => ({ tick: num(e.tick), player: idx(e.user_steamid, e.user_name) })).filter((r) => r.player >= 0);

  const BOMB_TYPES: Record<string, BombEventType> = {
    bomb_pickup: 'pickup', bomb_dropped: 'drop', bomb_beginplant: 'beginplant', bomb_planted: 'plant',
    bomb_begindefuse: 'begindefuse', bomb_defused: 'defuse', bomb_exploded: 'explode',
  };
  const bombEvents: BombEvent[] = [];
  for (const [name, type] of Object.entries(BOMB_TYPES)) {
    for (const e of ev(name)) {
      if (!inMatch(e)) continue;
      const [x, y, z] = pos3(e, 'user');
      bombEvents.push({ tick: num(e.tick), type, player: idx(e.user_steamid, e.user_name), x, y, z });
    }
  }
  bombEvents.sort((a, b) => a.tick - b.tick);
  for (const b of bombEvents) {
    const r = roundAt(b.tick);
    if (r < 0) continue;
    const rd = rounds[r];
    if (b.type === 'plant') {
      // Site : zone de bombe du poseur juste avant le plant (1 = A, 2 = B)
      let site: 'A' | 'B' | null = null;
      if (b.player >= 0) {
        const z = frames.zone[Math.max(0, Math.round(b.tick / SAMPLE_STEP) - 1) * P + b.player];
        site = z === 1 ? 'A' : z === 2 ? 'B' : null;
      }
      rd.plant = { tick: b.tick, site, x: b.x, y: b.y, z: b.z, player: b.player };
    }
    if (b.type === 'defuse') rd.defuseTick = b.tick;
    if (b.type === 'explode') rd.explodeTick = b.tick;
  }

  // Plant en bordure de zone (zone 0) : on prend le site du plant connu le plus proche
  const knownPlants = rounds.map((r) => r.plant).filter((p): p is NonNullable<typeof p> => !!p && p.site !== null);
  for (const r of rounds) {
    if (!r.plant || r.plant.site !== null || !knownPlants.length) continue;
    const pl = r.plant;
    let best = knownPlants[0], bd = Infinity;
    for (const k of knownPlants) { const d = Math.hypot(k.x - pl.x, k.y - pl.y); if (d < bd) { bd = d; best = k; } }
    if (bd < 1500) pl.site = best.site;
  }

  // --- Grenades : trajectoires des projectiles + effets ---
  const { grenades, grenadePathTicks, grenadePathXYZ } = buildGrenades(raw.grenades, ev, idx, roundAt, matchStartTick);
  attachThrows(grenades, ev('weapon_fire'), idx);
  const placeOf = buildPlaceLookup(frames, P, placeNames);
  for (const g of grenades) g.landPlace = placeOf(g.effectPos[0], g.effectPos[1], g.effectPos[2]);

  const tEnd = performance.now();
  return {
    version: MATCH_FORMAT_VERSION,
    source: { fileName: raw.fileName, fileSize: raw.fileSize },
    header: {
      map: str(raw.header.map_name),
      server: str(raw.header.server_name),
      patch: str(raw.header.patch_version),
      client: str(raw.header.client_name),
    },
    tickrate: TICKRATE,
    firstTick: 0,
    lastTick,
    matchStartTick,
    players,
    teams,
    rounds,
    kills,
    hurts,
    blinds,
    shots,
    reloads,
    grenades,
    grenadePathTicks,
    grenadePathXYZ,
    bombEvents,
    weaponNames,
    placeNames,
    frames,
    timings: { ...raw.timings, buildFrames: tFrames - t0, buildRest: tEnd - tFrames },
  };
}

const PROJECTILE_KIND: Record<string, GrenadeKind> = {
  CSmokeGrenadeProjectile: 'smoke',
  CFlashbangProjectile: 'flash',
  CHEGrenadeProjectile: 'he',
  CMolotovProjectile: 'molotov',
  CDecoyProjectile: 'decoy',
};

/** Durées par défaut si l'événement de fin manque (en ticks). */
const DEFAULT_EFFECT = { smoke: 20 * TICKRATE, molotov: 7 * TICKRATE };

function buildGrenades(
  g: Columns,
  ev: (n: string) => Row[],
  idx: (s: unknown, n?: unknown) => number,
  roundAt: (t: number) => number,
  matchStartTick: number,
): { grenades: GrenadeInfo[]; grenadePathTicks: Int32Array; grenadePathXYZ: Float32Array } {
  interface Building { id: number; kind: GrenadeKind; thrower: number; ticks: number[]; xyz: number[]; last: number }
  const n = g.tick?.length ?? 0;
  const open = new Map<string, Building>();
  const done: Building[] = [];
  for (let i = 0; i < n; i++) {
    const x = g.x?.[i];
    if (x == null) continue;
    const kind = PROJECTILE_KIND[str(g.grenade_type?.[i])];
    if (!kind) continue;
    const tick = num(g.tick?.[i]);
    const id = num(g.grenade_entity_id?.[i]);
    const key = `${id}`;
    let b = open.get(key);
    // Les ID d'entité sont réutilisés : une coupure de plus de 2 s ou un autre type = nouvelle grenade.
    if (b && (b.kind !== kind || tick - b.last > 2 * TICKRATE)) { done.push(b); b = undefined; }
    if (!b) {
      b = { id, kind, thrower: idx(g.steamid?.[i], g.name?.[i]), ticks: [], xyz: [], last: tick };
      open.set(key, b);
    }
    b.ticks.push(tick);
    b.xyz.push(num(x), num(g.y?.[i]), num(g.z?.[i]));
    b.last = tick;
  }
  done.push(...open.values());
  done.sort((a, b) => a.ticks[0] - b.ticks[0]);

  // Index des événements d'effet par entityid
  const byEntity = (name: string): Map<number, Row[]> => {
    const m = new Map<number, Row[]>();
    for (const e of ev(name)) {
      const id = num(e.entityid);
      let l = m.get(id);
      if (!l) m.set(id, (l = []));
      l.push(e);
    }
    return m;
  };
  const smokeDet = byEntity('smokegrenade_detonate');
  const smokeExp = byEntity('smokegrenade_expired');
  const flashDet = byEntity('flashbang_detonate');
  const heDet = byEntity('hegrenade_detonate');
  const infernoExp = byEntity('inferno_expire');
  const infernoStarts = ev('inferno_startburn').map((e) => ({
    tick: num(e.tick), id: num(e.entityid), x: num(e.x), y: num(e.y), z: num(e.z), used: false,
  }));
  const findEvt = (m: Map<number, Row[]>, id: number, from: number, to: number): Row | null => {
    for (const e of m.get(id) ?? []) { const t = num(e.tick); if (t >= from && t <= to) return e; }
    return null;
  };

  const grenades: GrenadeInfo[] = [];
  const pathTicks: number[] = [];
  const pathXYZ: number[] = [];
  for (const b of done) {
    const throwTick = b.ticks[0];
    if (throwTick < matchStartTick) continue;
    const round = roundAt(throwTick);
    if (round < 0) continue;
    const lastPt = b.ticks[b.ticks.length - 1];
    let detonateTick = lastPt;
    let effectEndTick = lastPt;
    const li = b.xyz.length - 3;
    let effectPos: [number, number, number] = [b.xyz[li], b.xyz[li + 1], b.xyz[li + 2]];

    if (b.kind === 'smoke') {
      const det = findEvt(smokeDet, b.id, throwTick, lastPt + TICKRATE);
      if (det) {
        detonateTick = num(det.tick);
        effectPos = [num(det.x), num(det.y), num(det.z)];
        const exp = findEvt(smokeExp, b.id, detonateTick, detonateTick + 40 * TICKRATE);
        effectEndTick = exp ? num(exp.tick) : detonateTick + DEFAULT_EFFECT.smoke;
      } else {
        effectEndTick = detonateTick;
      }
    } else if (b.kind === 'flash' || b.kind === 'he') {
      const det = findEvt(b.kind === 'flash' ? flashDet : heDet, b.id, throwTick, lastPt + TICKRATE);
      if (det) { detonateTick = num(det.tick); effectPos = [num(det.x), num(det.y), num(det.z)]; }
      effectEndTick = detonateTick;
    } else if (b.kind === 'molotov') {
      // Le feu est une autre entité : on associe le départ de feu le plus proche dans le temps et l'espace.
      let best: (typeof infernoStarts)[number] | null = null;
      let bestScore = Infinity;
      for (const s of infernoStarts) {
        if (s.used || s.tick < lastPt - 8 || s.tick > lastPt + TICKRATE) continue;
        const d = Math.hypot(s.x - effectPos[0], s.y - effectPos[1]);
        const score = d + Math.abs(s.tick - lastPt) * 4;
        if (d < 400 && score < bestScore) { best = s; bestScore = score; }
      }
      if (best) {
        best.used = true;
        detonateTick = best.tick;
        effectPos = [best.x, best.y, best.z];
        const exp = findEvt(infernoExp, best.id, best.tick, best.tick + 20 * TICKRATE);
        effectEndTick = exp ? num(exp.tick) : best.tick + DEFAULT_EFFECT.molotov;
      }
    }

    // Trajectoire coupée à l'explosion (une smoke reste au sol jusqu'à sa disparition)
    const start = pathTicks.length;
    for (let k = 0; k < b.ticks.length; k++) {
      if (b.ticks[k] > detonateTick) break;
      pathTicks.push(b.ticks[k]);
      pathXYZ.push(b.xyz[k * 3], b.xyz[k * 3 + 1], b.xyz[k * 3 + 2]);
    }
    grenades.push({
      id: grenades.length,
      kind: b.kind,
      thrower: b.thrower,
      round,
      throwTick,
      detonateTick,
      effectEndTick,
      effectPos,
      pathStart: start,
      pathLen: pathTicks.length - start,
      throw: null,
      landPlace: '',
    });
  }
  return { grenades, grenadePathTicks: Int32Array.from(pathTicks), grenadePathXYZ: Float32Array.from(pathXYZ) };
}

const FIRE_KIND: Record<string, GrenadeKind> = {
  weapon_smokegrenade: 'smoke', weapon_flashbang: 'flash', weapon_hegrenade: 'he',
  weapon_molotov: 'molotov', weapon_incgrenade: 'molotov', weapon_decoy: 'decoy',
};

/** Classe la façon de lancer à partir de la vitesse et de l'accroupissement du lanceur. */
export function throwTechnique(vx: number, vy: number, vz: number, duck: number): ThrowTechnique {
  const speed = Math.hypot(vx, vy);
  return {
    move: speed < 10 ? 'stand' : speed < 140 ? 'walk' : 'run',
    jump: Math.abs(vz) > 20,
    crouch: duck > 0.5,
  };
}

/** Associe à chaque grenade l'événement de tir de son lanceur (même type, juste avant le projectile). */
function attachThrows(grenades: GrenadeInfo[], fires: Row[], idx: (s: unknown, n?: unknown) => number): void {
  const byPlayer = new Map<number, { tick: number; kind: GrenadeKind; e: Row; used: boolean }[]>();
  for (const e of fires) {
    const kind = FIRE_KIND[str(e.weapon)];
    if (!kind) continue;
    const p = idx(e.user_steamid, e.user_name);
    if (p < 0) continue;
    let l = byPlayer.get(p);
    if (!l) byPlayer.set(p, (l = []));
    l.push({ tick: num(e.tick), kind, e, used: false });
  }
  for (const g of grenades) {
    const list = byPlayer.get(g.thrower);
    if (!list) continue;
    let best: (typeof list)[number] | null = null;
    for (const f of list) {
      if (f.used || f.kind !== g.kind) continue;
      const d = g.throwTick - f.tick;
      if (d < -4 || d > TICKRATE) continue;
      if (!best || Math.abs(d) < Math.abs(g.throwTick - best.tick)) best = f;
    }
    if (!best) continue;
    best.used = true;
    const e = best.e;
    g.throw = {
      tick: best.tick,
      x: num(e.user_X), y: num(e.user_Y), z: num(e.user_Z),
      pitch: num(e.user_pitch), yaw: num(e.user_yaw),
      tech: throwTechnique(num(e.user_velocity_X), num(e.user_velocity_Y), num(e.user_velocity_Z), num(e.user_duck_amount)),
      place: str(e.user_last_place_name),
    };
  }
}

/**
 * Callout d'un point quelconque de la carte : grille de 128 unités remplie avec les positions
 * des joueurs (et leur callout) vues dans la démo, recherche dans les cases voisines.
 */
function buildPlaceLookup(fr: Frames, P: number, placeNames: string[]): (x: number, y: number, z: number) => string {
  const CELL = 128;
  const votes = new Map<string, Map<number, number>>();
  const key = (cx: number, cy: number, cz: number) => `${cx},${cy},${cz}`;
  const total = fr.count * P;
  // Une frame sur 4 suffit (positions à 4 Hz)
  for (let j = 0; j < total; j += 4 * P) {
    for (let p = 0; p < P; p++) {
      const i = j + p;
      if (i >= total || !fr.present[i] || fr.place[i] === 255) continue;
      const x = fr.pos[i * 3], y = fr.pos[i * 3 + 1], z = fr.pos[i * 3 + 2];
      const k = key(Math.floor(x / CELL), Math.floor(y / CELL), Math.floor(z / (CELL * 2)));
      let v = votes.get(k);
      if (!v) votes.set(k, (v = new Map()));
      v.set(fr.place[i], (v.get(fr.place[i]) ?? 0) + 1);
    }
  }
  const best = new Map<string, number>();
  for (const [k, v] of votes) {
    let bi = -1, bn = 0;
    for (const [pi, n] of v) if (n > bn) { bn = n; bi = pi; }
    best.set(k, bi);
  }
  return (x, y, z) => {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), cz = Math.floor(z / (CELL * 2));
    // Case exacte, puis anneaux de plus en plus larges (la grenade peut tomber hors des chemins)
    for (let r = 0; r <= 3; r++) {
      for (const dz of [0, -1, 1]) {
        let found = -1, foundD = Infinity;
        for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const pi = best.get(key(cx + dx, cy + dy, cz + dz));
          if (pi !== undefined && pi >= 0 && dx * dx + dy * dy < foundD) { found = pi; foundD = dx * dx + dy * dy; }
        }
        if (found >= 0) return placeNames[found] ?? '';
      }
    }
    return '';
  };
}
