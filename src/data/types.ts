// Format de données compact d'un match, produit par le worker de parsing.
// Toutes les données par tick sont stockées dans des tableaux typés (frame-major :
// index = frame * nbJoueurs + joueur) pour rester légères et transférables sans copie.

export const MATCH_FORMAT_VERSION = 1;

/** Échantillonnage des positions : 1 frame tous les SAMPLE_STEP ticks (64 tick -> 16 Hz). */
export const SAMPLE_STEP = 4;

/** Côté CS2 tel que codé dans la démo : 2 = T, 3 = CT. */
export type Side = 2 | 3;
export const SIDE_T: Side = 2;
export const SIDE_CT: Side = 3;

export type TeamIndex = 0 | 1;

export interface PlayerInfo {
  steamid: string;
  name: string;
  team: TeamIndex;
  /** Numéro 1..5 dans l'équipe (ordre stable), affiché sur le radar. */
  slot: number;
  /** Couleur de joueur CS2 (blue, green, yellow, orange, purple) si présente. */
  color: string | null;
}

export interface TeamInfo {
  name: string;
  /** Côté au premier round. */
  startSide: Side;
}

export interface BombPlant {
  tick: number;
  site: 'A' | 'B' | null;
  x: number;
  y: number;
  z: number;
  player: number;
}

export interface RoundInfo {
  index: number;
  number: number;
  startTick: number;
  freezeEndTick: number;
  endTick: number;
  /** Fin officielle (après le délai de fin de round) : limite de lecture du round. */
  officialEndTick: number;
  winnerSide: Side | null;
  winnerTeam: TeamIndex | null;
  reason: string;
  /** Score [équipe 0, équipe 1] après ce round. */
  scoreAfter: [number, number];
  /** Équipe côté CT pendant ce round. */
  ctTeam: TeamIndex;
  plant: BombPlant | null;
  defuseTick: number | null;
  explodeTick: number | null;
}

export interface KillEvent {
  tick: number;
  round: number;
  killer: number; // -1 = monde / suicide
  victim: number;
  assister: number;
  flashAssist: boolean;
  weapon: string;
  headshot: boolean;
  penetrated: boolean;
  thruSmoke: boolean;
  noScope: boolean;
  attackerBlind: boolean;
  killerPos: [number, number, number] | null;
  victimPos: [number, number, number];
  /** Callout (last_place_name) du tueur et de la victime, '' si inconnu. */
  killerPlace: string;
  victimPlace: string;
}

export interface HurtEvent {
  tick: number;
  round: number;
  attacker: number;
  victim: number;
  dmgHealth: number;
  dmgArmor: number;
  healthAfter: number;
  weapon: string;
  hitgroup: string;
}

export interface BlindEvent {
  tick: number;
  victim: number;
  attacker: number;
  duration: number;
}

export interface ShotEvent {
  tick: number;
  player: number;
  weapon: string;
}

export type GrenadeKind = 'smoke' | 'flash' | 'he' | 'molotov' | 'decoy';

/** Façon de lancer : déplacement au moment du lancer, saut, accroupi. */
export interface ThrowTechnique {
  move: 'stand' | 'walk' | 'run';
  jump: boolean;
  crouch: boolean;
}

/** Position et angle exacts du lanceur au tick du lancer (événement weapon_fire). */
export interface GrenadeThrow {
  tick: number;
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  tech: ThrowTechnique;
  /** Callout du lanceur. */
  place: string;
}

export interface GrenadeInfo {
  id: number;
  kind: GrenadeKind;
  thrower: number;
  round: number;
  throwTick: number;
  /** Tick d'explosion / d'éclatement (fin de trajectoire). */
  detonateTick: number;
  /** Fin de l'effet (fumée dissipée, feu éteint). Égal à detonateTick pour flash / HE. */
  effectEndTick: number;
  /** Position de l'effet (centre de la fumée ou du feu). */
  effectPos: [number, number, number];
  /** Trajectoire : tranche [pathStart, pathStart + pathLen) de grenadePath*. */
  pathStart: number;
  pathLen: number;
  /** Lancer exact (absent si l'événement de tir n'a pas été retrouvé). */
  throw: GrenadeThrow | null;
  /** Callout de la zone d'arrivée (déduit des positions des joueurs), '' si inconnu. */
  landPlace: string;
}

export type BombEventType = 'pickup' | 'drop' | 'beginplant' | 'plant' | 'begindefuse' | 'defuse' | 'explode';

export interface BombEvent {
  tick: number;
  type: BombEventType;
  player: number;
  x: number;
  y: number;
  z: number;
}

/** Bits du tableau frames.flags. */
export const FLAG_ALIVE = 1;
export const FLAG_HELMET = 2;
export const FLAG_DEFUSER = 4;
export const FLAG_SCOPED = 8;
export const FLAG_DEFUSING = 16;
export const FLAG_PLANTING = 32;
export const FLAG_HAS_BOMB = 64;
/** Accroupi (duck_amount > 0,5). */
export const FLAG_DUCKING = 128;

/** Utilitaires en inventaire, packés sur 16 bits : 3 bits par type. */
export const NADE_SHIFT = { smoke: 0, flash: 3, he: 6, molotov: 9, decoy: 12 } as const;

export interface Frames {
  count: number;
  /** Tick de la frame f = f * SAMPLE_STEP (stocké pour clarté et pour les tests). */
  ticks: Int32Array;
  /** Frame présente dans la démo pour ce joueur (0 = joueur absent / pas encore connecté). */
  present: Uint8Array;
  pos: Float32Array; // x, y, z
  yaw: Float32Array;
  /** Angle vertical de la vue (degrés, négatif = vers le haut). */
  pitch: Float32Array;
  hp: Uint8Array;
  armor: Uint8Array;
  money: Uint16Array;
  side: Uint8Array;
  flags: Uint8Array;
  /** Durée de flash restante × 10 (dixièmes de seconde). */
  flash: Uint8Array;
  /** Index dans weaponNames de l'arme active. */
  weapon: Uint8Array;
  /** Arme principale (primaire, ou secondaire à défaut) dans weaponNames, 255 = aucune. */
  mainWeapon: Uint8Array;
  nades: Uint16Array;
  /** Valeur de l'équipement porté ($). */
  equip: Uint16Array;
  /** Zone de bombe où se trouve le joueur : 0 aucune, 1 = A, 2 = B. */
  zone: Uint8Array;
  /** Index dans placeNames du callout courant (last_place_name), 255 = inconnu. */
  place: Uint8Array;
}

export interface MatchData {
  version: number;
  source: { fileName: string; fileSize: number };
  header: { map: string; server: string; patch: string; client: string };
  tickrate: number;
  firstTick: number;
  lastTick: number;
  matchStartTick: number;
  players: PlayerInfo[];
  teams: [TeamInfo, TeamInfo];
  rounds: RoundInfo[];
  kills: KillEvent[];
  hurts: HurtEvent[];
  blinds: BlindEvent[];
  shots: ShotEvent[];
  /** Rechargements (événement weapon_reload). Absent des données d'anciennes versions. */
  reloads?: { tick: number; player: number }[];
  grenades: GrenadeInfo[];
  grenadePathTicks: Int32Array;
  grenadePathXYZ: Float32Array;
  bombEvents: BombEvent[];
  weaponNames: string[];
  /** Noms de callouts tels qu'écrits dans la démo (ex. "TopofMid"). */
  placeNames: string[];
  frames: Frames;
  /** Temps de parsing par étape (ms), pour le suivi des performances. */
  timings: Record<string, number>;
}

/** Liste des buffers à transférer (postMessage) sans copie. */
export function matchTransferables(m: MatchData): ArrayBuffer[] {
  const f = m.frames;
  return [
    f.ticks, f.present, f.pos, f.yaw, f.hp, f.armor, f.money, f.side, f.flags, f.flash,
    f.weapon, f.mainWeapon, f.nades, f.equip, f.zone, f.pitch, f.place, m.grenadePathTicks, m.grenadePathXYZ,
  ].map((a) => a.buffer as ArrayBuffer);
}
