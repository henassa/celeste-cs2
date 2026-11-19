// Audit de la préparation de match : lit un dossier de démos (ou un export de bibliothèque) et affiche
// les constats de chaque équipe sur chaque carte, pour relire leur pertinence.
// PREP_AUDIT=<dossier de .dem ou export .json> npx vitest run tests/prep-audit.test.ts
import { describe, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initSync, parseHeader, parseEvents, parseTicks, parseGrenades } from '../src/parser/wasm/demoparser2.js';
import { parseRaw, type DemoParserModule } from '../src/parser/parse-demo';
import { buildMatch } from '../src/parser/build-match';
import { summarize, type LibraryMatch } from '../src/library/library';
import { detectTeams } from '../src/analysis/teams';
import { buildMapPrep } from '../src/analysis/prep';
import { subjectMaps } from '../src/analysis/brief';

const src = process.env.PREP_AUDIT;
describe.skipIf(!src)('audit de la préparation', () => {
  it('constats par équipe et par carte', () => {
    let lib: LibraryMatch[];
    if (src!.endsWith('.json')) lib = JSON.parse(fs.readFileSync(src!, 'utf8')).matches;
    else {
      initSync({ module: fs.readFileSync(path.join(__dirname, '../src/parser/wasm/demoparser2_bg.wasm')) });
      const mod = { parseHeader, parseEvents, parseTicks, parseGrenades } as unknown as DemoParserModule;
      lib = fs.readdirSync(src!).filter((f) => f.endsWith('.dem')).map((f) => {
        const bytes = new Uint8Array(fs.readFileSync(path.join(src!, f)));
        return summarize(buildMatch(parseRaw(mod, bytes, { fileName: f, fileSize: bytes.length })), 0);
      });
    }
    // Même démo sous deux noms : une seule fois (la bibliothèque de l'app est déjà indexée par identifiant)
    lib = [...new Map(lib.filter((m) => m.spatial).map((m) => [m.id, m])).values()];
    const out: string[] = [`${lib.length} maps: ${lib.map((m) => m.map).join(', ')}`];
    for (const t of detectTeams(lib)) for (const map of subjectMaps(lib, { kind: 'team', group: t })) {
      const p = buildMapPrep(lib, map, t);
      if (!p) continue;
      out.push('', `== ${t.name} on ${map} (${p.matches} maps)`);
      for (const f of p.findings) out.push(`  ${f.score.toFixed(1).padStart(4)} [${f.side}]${f.isNew ? ' NEW' : ''} ${f.text} | ${f.sample}${f.baseline ? ` | vs ${f.baseline}` : ''} | ${f.rounds.length} rounds`);
      out.push(`  eco T: ${p.economy.t.map((r) => `${r.buy} ${r.won}/${r.rounds}`).join(', ')}`);
    }
    fs.writeFileSync(process.env.PREP_AUDIT_OUT ?? '/tmp/prep-audit.txt', out.join('\n'));
  }, 1_800_000);
});
