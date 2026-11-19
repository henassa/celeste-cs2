// Appels à demoparser2 (WASM) et normalisation des sorties.
// Partagé entre le Web Worker (navigateur) et les tests Node.

import type { RawDemo } from './build-match';

export interface DemoParserModule {
  parseHeader(file: Uint8Array): unknown;
  parseEvents(file: Uint8Array, events?: unknown[] | null, playerProps?: unknown[] | null, otherProps?: unknown[] | null): unknown;
  parseTicks(file: Uint8Array, props?: unknown[] | null, ticks?: Int32Array | null, players?: unknown[] | null, soa?: boolean | null): unknown;
  parseGrenades(file: Uint8Array, extra?: unknown[] | null, grenades?: boolean | null, soa?: boolean | null): unknown;
}

export const EVENT_NAMES = [
  'begin_new_match', 'round_start', 'round_freeze_end', 'round_end', 'round_officially_ended',
  'player_death', 'player_hurt', 'player_blind', 'weapon_fire', 'weapon_reload',
  'bomb_pickup', 'bomb_dropped', 'bomb_beginplant', 'bomb_planted', 'bomb_begindefuse', 'bomb_defused', 'bomb_exploded',
  'smokegrenade_detonate', 'smokegrenade_expired', 'inferno_startburn', 'inferno_expire',
  'flashbang_detonate', 'hegrenade_detonate',
];

export const TICK_PROPS = [
  'X', 'Y', 'Z', 'yaw', 'health', 'armor_value', 'is_alive', 'team_num', 'balance',
  'has_helmet', 'has_defuser', 'flash_duration', 'is_scoped', 'is_defusing', 'is_planting',
  'active_weapon_name', 'inventory', 'team_clan_name', 'player_color', 'current_equip_value', 'which_bomb_zone',
  'pitch', 'last_place_name', 'duck_amount',
];

export const SAMPLE_STEP_TICKS = 4;

export type ProgressFn = (step: string, ratio: number) => void;

/** Map JS (serde_wasm_bindgen) -> objet simple. */
function toObject(v: unknown): Record<string, unknown> {
  if (v instanceof Map) return Object.fromEntries(v);
  return (v ?? {}) as Record<string, unknown>;
}

export function parseRaw(
  mod: DemoParserModule,
  bytes: Uint8Array,
  meta: { fileName: string; fileSize: number },
  onProgress: ProgressFn = () => {},
): RawDemo {
  const timings: Record<string, number> = {};
  const time = <T>(name: string, fn: () => T): T => {
    const t = performance.now();
    const r = fn();
    timings[name] = Math.round(performance.now() - t);
    return r;
  };

  onProgress('header', 0.02);
  const header = time('header', () => toObject(mod.parseHeader(bytes))) as Record<string, string>;

  onProgress('events', 0.05);
  const evRaw = time('events', () => mod.parseEvents(bytes, EVENT_NAMES, ['X', 'Y', 'Z', 'last_place_name', 'pitch', 'yaw', 'velocity_X', 'velocity_Y', 'velocity_Z', 'duck_amount'], ['is_warmup_period'])) as unknown[];
  const events = evRaw.map(toObject);
  let lastTick = 0;
  for (const e of events) lastTick = Math.max(lastTick, Number(e.tick) || 0);

  onProgress('grenades', 0.25);
  const grenades = time('grenades', () => toObject(mod.parseGrenades(bytes, null, false, true))) as Record<string, unknown[]>;

  onProgress('players', 0.45);
  const wanted: number[] = [];
  for (let t = 0; t <= lastTick + 64; t += SAMPLE_STEP_TICKS) wanted.push(t);
  const ticks = time('ticks', () =>
    toObject(mod.parseTicks(bytes, TICK_PROPS, new Int32Array(wanted), null, true))) as Record<string, unknown[]>;

  onProgress('building', 0.9);
  return { fileName: meta.fileName, fileSize: meta.fileSize, header, events, ticks, grenades, timings };
}
