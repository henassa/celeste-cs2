// Outil de debug : parse une démo et écrit un résumé JSON (+ cache du MatchData brut).
import fs from 'node:fs';
import path from 'node:path';
import { initSync, parseHeader, parseEvents, parseTicks, parseGrenades } from '../src/parser/wasm/demoparser2.js';
import { parseRaw, type DemoParserModule } from '../src/parser/parse-demo';
import { buildMatch } from '../src/parser/build-match';
import { SAMPLE_STEP } from '../src/data/types';

const file = process.argv[2];
initSync({ module: fs.readFileSync(path.join(import.meta.dirname, '../src/parser/wasm/demoparser2_bg.wasm')) });
const mod = { parseHeader, parseEvents, parseTicks, parseGrenades } as unknown as DemoParserModule;
const bytes = new Uint8Array(fs.readFileSync(file));
const m = buildMatch(parseRaw(mod, bytes, { fileName: path.basename(file), fileSize: bytes.length }));
const P = m.players.length;
const r = m.rounds[Number(process.argv[3] ?? 10)];
const f = Math.round((r.freezeEndTick + 32) / SAMPLE_STEP);
console.log('round', r);
m.players.forEach((p, i) => console.log(i, p.name, p.team, 'present', m.frames.present[f*P+i], 'side', m.frames.side[f*P+i], 'flags', m.frames.flags[f*P+i], 'hp', m.frames.hp[f*P+i]));
console.log(m.kills.filter(k => k.round === r.index - 1 || k.round === r.index).map(k => `${k.round} ${k.tick} ${m.players[k.killer]?.name} -> ${m.players[k.victim].name} ${k.weapon}`).join('\n'));
