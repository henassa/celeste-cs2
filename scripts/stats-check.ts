// Compare nos stats au scoreboard du jeu (dernier tick) pour une démo.
import fs from 'node:fs';
import path from 'node:path';
import { initSync, parseHeader, parseEvents, parseTicks, parseGrenades } from '../src/parser/wasm/demoparser2.js';
import { parseRaw, type DemoParserModule } from '../src/parser/parse-demo';
import { buildMatch } from '../src/parser/build-match';
import { computeStats } from '../src/stats/compute';

initSync({ module: fs.readFileSync(path.join(import.meta.dirname, '../src/parser/wasm/demoparser2_bg.wasm')) });
const mod = { parseHeader, parseEvents, parseTicks, parseGrenades } as unknown as DemoParserModule;
const bytes = new Uint8Array(fs.readFileSync(process.argv[2]));
const m = buildMatch(parseRaw(mod, bytes, { fileName: 'x', fileSize: 0 }));
const last = m.rounds[m.rounds.length - 1].officialEndTick - 8;
const props = ['kills_total', 'deaths_total', 'assists_total', 'headshot_kills_total', 'damage_total', 'utility_damage_total', 'enemies_flashed_total'];
const sb = parseTicks(bytes, props, new Int32Array([last]), null, true) as Map<string, unknown[]>;
const col = (k: string) => (sb instanceof Map ? sb.get(k) : (sb as any)[k]) as any[];
const ids = col('steamid');
const st = computeStats(m);
console.log('player'.padEnd(18), 'K', 'D', 'A', 'HS', 'DMG', 'UTIL', 'FL', '| ADR KAST 1.0 2.0 swing');
for (const s of st) {
  const i = ids.findIndex((x) => String(x) === m.players[s.player].steamid);
  const g = (k: string) => (i >= 0 ? col(k)[i] : '?');
  const pair = (a: number, b: unknown) => (a === b ? `${a}` : `${a}≠${b}`);
  console.log(s.name.slice(0, 17).padEnd(18), pair(s.kills, g('kills_total')), pair(s.deaths, g('deaths_total')), pair(s.assists, g('assists_total')),
    pair(s.headshots, g('headshot_kills_total')), pair(s.damage, g('damage_total')), pair(s.utilityDamage, g('utility_damage_total')),
    pair(s.enemiesFlashed, g('enemies_flashed_total')), '|', s.adr.toFixed(1), s.kast.toFixed(0), s.rating1.toFixed(2), s.rating2.toFixed(2), s.swing.toFixed(2));
}
