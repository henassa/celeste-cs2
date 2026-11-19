// Tests sur de vraies démos. Les démos ne sont pas dans le repo (trop lourdes, données privées) :
// placer des .dem dans tests/demos/ (ou définir SCRIMVIEW_DEMOS=dossier) pour lancer ces tests.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initSync, parseHeader, parseEvents, parseTicks, parseGrenades, parseVoice } from '../src/parser/wasm/demoparser2.js';
import { parseRaw, type DemoParserModule } from '../src/parser/parse-demo';
import { buildMatch } from '../src/parser/build-match';
import { playerState } from '../src/viewer/sample';
import { airState, buildActionIndex, overlayAt, shotsAt } from '../src/three/actions';
import { FLAG_ALIVE, FLAG_DUCKING, SAMPLE_STEP } from '../src/data/types';
import { computeStats } from '../src/stats/compute';
import { buildSpatial } from '../src/library/spatial';
import { matchContext } from '../src/coach/context';
import { libraryTools, matchTools } from '../src/coach/tools';
import { getZones } from '../src/app/zones';
import { duelMatrix, economy, utility, weapons } from '../src/stats/details';
import { detectMoments } from '../src/stats/moments';
import { wpSeries } from '../src/stats/wp-model';
import { aimAdvanced, aimBasic, aimRowsFromTicks, aimWindowTicks, summarizeAim } from '../src/stats/aim';

const dir = process.env.SCRIMVIEW_DEMOS ?? path.join(__dirname, 'demos');
const demos = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.dem')) : [];

initSync({ module: fs.readFileSync(path.join(__dirname, '../src/parser/wasm/demoparser2_bg.wasm')) });
const mod = { parseHeader, parseEvents, parseTicks, parseGrenades } as unknown as DemoParserModule;

describe.skipIf(demos.length === 0)('vraies démos', () => {
  for (const file of demos) {
    it(`parse ${file}`, () => {
      const bytes = new Uint8Array(fs.readFileSync(path.join(dir, file)));
      const raw = parseRaw(mod, bytes, { fileName: file, fileSize: bytes.length });
      const m = buildMatch(raw);
      const expectFile = path.join(dir, file.replace(/\.dem$/, '.expect.json'));

      // Actions pour la vue 3D : rechargements, sauts, sorties d'arme, traçantes
      {
        expect(m.reloads?.length ?? 0).toBeGreaterThan(10);
        const idx = buildActionIndex(m);
        let air = 0, draws = 0, shootPoses = 0, samples = 0;
        for (let t = m.rounds[1].freezeEndTick; t < m.rounds[1].endTick; t += 16) for (let i = 0; i < m.players.length; i++) {
          const st = playerState(m, i, t);
          if (!st.alive) continue;
          samples++;
          if (airState(m, i, t)) air++;
          const o = overlayAt(m, idx, i, t);
          if (o?.kind === 'draw') draws++;
          if (o?.kind === 'shoot') shootPoses++;
        }
        expect(air).toBeGreaterThan(0);
        expect(air / samples).toBeLessThan(0.15);
        expect(draws).toBeGreaterThan(0);
        expect(shootPoses).toBeGreaterThan(0);
        // Les tirs qui touchent finissent sur la victime
        const s0 = m.shots.find((s) => m.hurts.some((h) => h.attacker === s.player && h.tick >= s.tick && h.tick <= s.tick + 6 && s.weapon.includes(h.weapon) && !/knife|grenade/.test(h.weapon)))!;
        const vis = shotsAt(m, idx, s0.tick + 1, () => 500, new Map());
        expect(vis.length).toBeGreaterThan(0);
        for (const v of vis) expect(Math.hypot(v.to[0] - v.from[0], v.to[1] - v.from[1])).toBeLessThan(5000);
      }

      // Cohérence générale
      expect(m.players.length).toBeGreaterThanOrEqual(2);
      expect(m.rounds.length).toBeGreaterThan(0);
      const last = m.rounds[m.rounds.length - 1];
      expect(last.scoreAfter[0] + last.scoreAfter[1]).toBe(m.rounds.length);
      for (const r of m.rounds) {
        expect(r.freezeEndTick).toBeGreaterThanOrEqual(r.startTick);
        expect(r.endTick).toBeGreaterThan(r.freezeEndTick);
        expect(r.officialEndTick).toBeGreaterThanOrEqual(r.endTick);
      }
      // Juste après le freeze time, tous les joueurs dans une équipe (T/CT) sont vivants.
      // (On ne suppose pas 10 joueurs : déconnexions et 4v5 existent, ex. faceit1 round 11.)
      const P = m.players.length;
      for (const r of m.rounds) {
        const f = Math.round((r.freezeEndTick + 32) / SAMPLE_STEP);
        // Les morts pendant le freeze time existent (suicide, dégâts du monde) : on les exclut.
        const deadEarly = new Set(m.kills.filter((k) => k.tick >= r.startTick && k.tick <= f * SAMPLE_STEP).map((k) => k.victim));
        let alive = 0, inTeam = 0;
        for (let p = 0; p < P; p++) {
          if (deadEarly.has(p)) continue;
          const s = m.frames.side[f * P + p];
          if (m.frames.present[f * P + p] && (s === 2 || s === 3)) inTeam++;
          if (m.frames.flags[f * P + p] & FLAG_ALIVE) alive++;
        }
        expect(alive, `round ${r.number}`).toBe(inTeam);
        expect(inTeam, `round ${r.number}`).toBeGreaterThanOrEqual(Math.min(8, P - 2));
      }
      // Accroupi lu (duck_amount) : présent mais minoritaire
      let ducked = 0, present = 0;
      for (let i = 0; i < m.frames.flags.length; i++) if (m.frames.present[i]) { present++; if (m.frames.flags[i] & FLAG_DUCKING) ducked++; }
      expect(ducked / present).toBeGreaterThan(0.002);
      expect(ducked / present).toBeLessThan(0.5);
      // Chaque plant a un site A/B
      for (const r of m.rounds) if (r.plant) expect(r.plant.site, `round ${r.number} plant site`).not.toBeNull();
      // Chaque kill tombe dans un round, chaque grenade a une trajectoire
      for (const k of m.kills) expect(k.round).toBeGreaterThanOrEqual(0);
      for (const g of m.grenades) expect(g.pathLen).toBeGreaterThan(0);
      const smokes = m.grenades.filter((g) => g.kind === 'smoke');
      expect(smokes.filter((g) => g.effectEndTick > g.detonateTick).length / Math.max(1, smokes.length)).toBeGreaterThan(0.8);

      // Callouts : présents sur les frames et sur la quasi-totalité des kills
      expect(m.placeNames.length).toBeGreaterThan(5);
      expect(m.kills.filter((k) => k.victimPlace).length / m.kills.length).toBeGreaterThan(0.95);
      expect(m.frames.pitch.some((v) => v !== 0)).toBe(true);

      // Grenades : lancer exact retrouvé pour presque toutes, callout d'arrivée connu
      const thrown = m.grenades.filter((g) => g.throw);
      expect(thrown.length / m.grenades.length).toBeGreaterThan(0.95);
      expect(m.grenades.filter((g) => g.landPlace).length / m.grenades.length).toBeGreaterThan(0.9);
      // Le lanceur est près du début de la trajectoire
      for (const g of thrown) {
        const d = Math.hypot(m.grenadePathXYZ[g.pathStart * 3] - g.throw!.x, m.grenadePathXYZ[g.pathStart * 3 + 1] - g.throw!.y);
        expect(d, `grenade ${g.id}`).toBeLessThan(200);
      }

      // Voix : si présente, chaque orateur est un joueur du match et les paquets sont en Opus
      const voice = parseVoice(bytes) as { ticks: Int32Array; steamids: string[]; formats: Int32Array; lengths: Uint32Array; bytes: Uint8Array };
      if (voice.ticks.length) {
        const ids = new Set(m.players.map((p) => p.steamid));
        expect([...new Set(voice.steamids)].every((s) => ids.has(s))).toBe(true);
        expect(Array.from(voice.formats).every((f) => f === 2)).toBe(true);
        expect(voice.lengths.reduce((a, b) => a + b, 0)).toBe(voice.bytes.length);
      }
      console.log(file, 'voice packets', voice.ticks.length);

      // Moments clés : dans leur round ; courbe de probabilité cohérente avec le vainqueur
      const sp = buildSpatial(m);
      const moments = detectMoments(m, null, sp);
      expect(moments.length).toBeGreaterThan(3);
      for (const x of moments) {
        const r = m.rounds[x.round];
        expect(x.tick, x.title).toBeGreaterThanOrEqual(r.startTick);
        expect(x.tick, x.title).toBeLessThanOrEqual(r.officialEndTick);
      }
      for (const r of m.rounds) {
        const ser = wpSeries(sp, r.index, null, 0);
        expect(ser.every((q) => q.p >= 0 && q.p <= 1)).toBe(true);
        if (r.winnerTeam !== null) expect(ser[ser.length - 1].p).toBe(r.winnerTeam === 0 ? 1 : 0);
      }

      // Aim : seconde passe autour des duels, valeurs plausibles
      const aimRows = aimRowsFromTicks(parseTicks(bytes, ['X', 'Y', 'Z', 'pitch', 'yaw', 'approximate_spotted_by'], aimWindowTicks(m), null, true));
      const aim = summarizeAim(m, aimBasic(m), aimAdvanced(m, aimRows));
      for (const a of aim) {
        if (a.accuracy !== null) expect(a.accuracy).toBeLessThan(80);
        if (a.reactionMs !== null) { expect(a.reactionMs).toBeGreaterThan(0); expect(a.reactionMs).toBeLessThanOrEqual(1500); }
        if (a.crosshairDeg !== null) expect(a.crosshairDeg).toBeLessThan(90);
      }
      expect(aim.filter((a) => a.reactionMs !== null).length).toBeGreaterThanOrEqual(6);

      // Contexte du coach : chaque round présent, aucune valeur manquante affichée en NaN
      const ctx = matchContext(m, { round: 2, notes: { 3: 'late rotate' } });
      expect(ctx).not.toMatch(/NaN|undefined/);
      for (const r of m.rounds) expect(ctx).toContain(`R${r.number}:`);
      expect(ctx).toContain('Round 3 in detail');
      expect(ctx).toContain('late rotate');
      expect(ctx.length).toBeLessThan(20000);

      // Détails : économie, armes, grenades, duels cohérents
      const eco = economy(m, buildSpatial(m));
      expect(eco.length).toBe(m.rounds.length);
      expect(eco[0].buy).toEqual(['pistol', 'pistol']);
      const dmx = duelMatrix(m);
      const totalKills = dmx.kills.flat().reduce((a, b) => a + b, 0) + dmx.killsBack.flat().reduce((a, b) => a + b, 0);
      expect(totalKills).toBeGreaterThan(m.rounds.length * 3);
      for (const u of utility(m)) { expect(u.enemiesBlinded).toBeGreaterThanOrEqual(0); expect(u.flashKills).toBeLessThanOrEqual(u.enemiesBlinded); }
      const wps = weapons(m);
      for (const h of wps.hitgroups) expect(h.hits.head).toBeLessThanOrEqual(h.total);
      for (const r of wps.rows) if (r.kills >= 3) expect(r.damage, r.weapon).toBeGreaterThan(0);
      expect(wps.rows.some((r) => r.weapon === 'ak47' || r.weapon === 'm4a1/m4a4')).toBe(true);

      // Outils du coach : chacun répond sans NaN/undefined, en taille raisonnable
      const tools = matchTools(m, { 3: 'late rotate' });
      const pname = m.players[0].name, tname = m.teams[0].name;
      const argsFor: Record<string, Record<string, unknown>> = { round_detail: { round: 3 }, player_report: { name: pname }, team_report: { team: tname }, compare_players: { a: pname, b: m.players[1].name }, list_rounds: { team: tname, side: 't' } };
      for (const t of tools) {
        const out = t.run(argsFor[t.name] ?? {});
        expect(out, t.name).not.toMatch(/NaN|undefined|\[object/);
        expect(out.length, t.name).toBeGreaterThan(20);
        expect(out.length, t.name).toBeLessThan(12000);
      }
      expect(tools.find((t) => t.name === 'round_detail')!.run({ round: 3 })).toContain('late rotate');
      // Positions et zones sur la carte
      const ps = tools.find((t) => t.name === 'position_strength')!.run({ side: 'all' });
      const callout = /\(([A-Za-z]+)\): \d+–\d+/.exec(ps)?.[1];
      expect(callout, ps).toBeTruthy();
      const shown = tools.find((t) => t.name === 'show_on_map')!.run({ zones: [{ callout, label: 'test', kind: 'strong' }, { callout: 'nowhere_xyz' }] });
      expect(shown).toMatch(/Shown on the/);
      expect(getZones()?.zones.length).toBe(1);
      expect(getZones()?.map).toBe(m.header.map);
      expect(tools.find((t) => t.name === 'round_detail')!.run({ round: 99 })).toMatch(/No round/);
      expect(tools.find((t) => t.name === 'player_report')!.run({ name: pname.slice(0, 3).toUpperCase() })).toContain(pname);
      const lib = libraryTools([summarize(m, 0)]);
      for (const t of lib) {
        const out = t.run({ name: pname, team: pname, us: pname, them: m.players.find((p) => p.team !== m.players[0].team)!.name });
        expect(out, t.name).not.toMatch(/NaN|undefined|\[object/);
      }

      // Valeurs attendues vérifiées à la main (score final, nombre de kills...)
      if (fs.existsSync(expectFile)) {
        const exp = JSON.parse(fs.readFileSync(expectFile, 'utf8'));
        if (exp.map) expect(m.header.map).toBe(exp.map);
        if (exp.rounds) expect(m.rounds.length).toBe(exp.rounds);
        if (exp.finalScore) expect([...last.scoreAfter].sort()).toEqual([...exp.finalScore].sort());
        if (exp.kills) expect(m.kills.length).toBe(exp.kills);
      }

      // Stats comparées au scoreboard du jeu enregistré dans la démo (référence indépendante)
      const lastTick = last.officialEndTick - 8;
      const props = ['kills_total', 'deaths_total', 'assists_total', 'headshot_kills_total', 'damage_total', 'utility_damage_total', 'enemies_flashed_total'];
      const sbRaw = parseTicks(bytes, props, new Int32Array([lastTick]), null, true) as unknown;
      const sb = (sbRaw instanceof Map ? Object.fromEntries(sbRaw) : sbRaw) as Record<string, unknown[]>;
      const stats = computeStats(m);
      for (const st of stats) {
        const i = sb.steamid.findIndex((x) => String(x) === m.players[st.player].steamid);
        if (i < 0) continue;
        const g = (k: string) => Number(sb[k][i]);
        const who = `${file} ${st.name}`;
        expect(st.kills, `${who} kills`).toBe(g('kills_total'));
        expect(st.deaths, `${who} deaths`).toBe(g('deaths_total'));
        expect(st.headshots, `${who} HS`).toBe(g('headshot_kills_total'));
        expect(Math.abs(st.assists - g('assists_total')), `${who} assists`).toBeLessThanOrEqual(1);
        expect(Math.abs(st.damage - g('damage_total')) / Math.max(1, g('damage_total')), `${who} damage`).toBeLessThan(0.02);
        expect(Math.abs(st.utilityDamage - g('utility_damage_total')), `${who} util`).toBeLessThanOrEqual(Math.max(10, g('utility_damage_total') * 0.1));
        // Le compteur du jeu n'a pas de règle publique : proche, pas identique (écart jusqu'à 5 sur Train)
        expect(Math.abs(st.enemiesFlashed - g('enemies_flashed_total')), `${who} flashed`).toBeLessThanOrEqual(5);
      }
      // Cohérence des côtés : CT + T = total
      const ct = computeStats(m, 'ct'), t = computeStats(m, 't');
      for (const st of stats) {
        const a = ct.find((x) => x.player === st.player), b = t.find((x) => x.player === st.player);
        expect((a?.kills ?? 0) + (b?.kills ?? 0)).toBe(st.kills);
        expect((a?.rounds ?? 0) + (b?.rounds ?? 0)).toBe(st.rounds);
      }

      console.log(file, JSON.stringify({
        map: m.header.map, rounds: m.rounds.length, score: last.scoreAfter, teams: m.teams.map((t) => t.name),
        players: m.players.map((p) => `${p.name}(${p.team}/${p.slot})`), kills: m.kills.length,
        grenades: m.grenades.length, timings: m.timings, places: m.placeNames,
      }, null, 1));
    }, 600_000);
  }
});

import { summarize } from '../src/library/library';
import { aggregatePlayers } from '../src/analysis/players';
import { detectTeams, teamReport } from '../src/analysis/teams';
import { heatPoints } from '../src/analysis/heatmap';
import { clusterLineups, collectThrows } from '../src/analysis/lineups';
import { briefMarkdown, buildBrief } from '../src/analysis/brief';
import { detectStrategies } from '../src/analysis/strategies';
import { buildTraining, trainingMarkdown } from '../src/analysis/training';
import { fitWpModel, wpaByPlayer } from '../src/stats/wp-model';
import { fitModel } from '../src/calib/model';
import { allRoundViews, DEFAULT_FILTER, filterRounds, keptRounds, openingPlaces, type RoundFilter } from '../src/analysis/rounds';

describe.skipIf(demos.length < 2)('analyse multi-démos', () => {
  it('agrège les joueurs, détecte les équipes et produit les heatmaps', () => {
    const lib = demos.map((file) => {
      const bytes = new Uint8Array(fs.readFileSync(path.join(dir, file)));
      return summarize(buildMatch(parseRaw(mod, bytes, { fileName: file, fileSize: bytes.length })), 0);
    });
    const players = aggregatePlayers(lib);
    const totalRounds = lib.reduce((a, m) => a + m.stats.all.reduce((b, s) => b + s.rounds, 0), 0);
    expect(players.reduce((a, p) => a + p.rounds, 0)).toBe(totalRounds);
    expect(players.reduce((a, p) => a + p.kills, 0)).toBe(lib.reduce((a, m) => a + m.stats.all.reduce((b, s) => b + s.kills, 0), 0));
    // Chaque équipe d'un match apparaît dans exactement un groupe
    const teams = detectTeams(lib);
    const entries = teams.flatMap((t) => t.entries.map((e) => `${e.matchId}:${e.team}`));
    expect(new Set(entries).size).toBe(entries.length);
    expect(entries.length).toBe(lib.length * 2);
    for (const t of teams) {
      const rep = teamReport(t, lib);
      expect(rep.ct.played + rep.t.played).toBe(rep.rounds.played);
      expect(rep.sites.A + rep.sites.B).toBe(rep.plants);
      const played = rep.buys.pistol.played + rep.buys.eco.played + rep.buys.force.played + rep.buys.full.played;
      expect(played).toBe(rep.rounds.played);
    }
    // Heatmap : toutes les morts d'une carte = nombre de kills de cette carte
    for (const m of lib) {
      const { points } = heatPoints(lib, { map: m.map, subject: { kind: 'all' }, side: 'all', event: 'deaths', posTime: 20, nadeKind: 'all' });
      const expected = lib.filter((x) => x.map === m.map).reduce((a, x) => a + x.spatial!.kills.length, 0);
      expect(points.length).toBe(expected);
    }
    // Filtres de rounds : chaque round compté une fois par équipe, partitions cohérentes
    const totalRoundsLib = lib.reduce((a, m) => a + m.rounds, 0);
    const base = allRoundViews(lib, { subject: { kind: 'all' } });
    expect(base.length).toBe(totalRoundsLib * 2);
    const count = (f: Partial<RoundFilter>) => filterRounds(base, { ...DEFAULT_FILTER, ...f }).length;
    expect(count({ result: 'won' })).toBe(totalRoundsLib);
    expect(count({ side: 'ct' }) + count({ side: 't' })).toBe(base.length);
    expect(count({ opening: 'won' })).toBe(count({ opening: 'lost' }));
    expect(count({ bomb: 'A' }) + count({ bomb: 'B' }) + count({ bomb: 'none' })).toBe(base.length);
    expect(count({ situation: 'second' })).toBe(lib.length * 2 * 2);
    // Avantage numérique pour l'un = désavantage pour l'autre, sur le même round
    expect(count({ situation: 'advantage' })).toBe(count({ situation: 'disadvantage' }));
    const places = openingPlaces(base);
    expect(places.length).toBeGreaterThan(3);
    expect(places.reduce((a, p) => a + p.count, 0)).toBeGreaterThan(base.length * 0.8);
    // Heatmap restreinte : gagnés + perdus = tout
    const m0 = lib[0];
    const deaths = (rounds?: Map<string, Set<0 | 1>>) =>
      heatPoints(lib, { map: m0.map, subject: { kind: 'all' }, side: 'all', event: 'deaths', posTime: 20, nadeKind: 'all', rounds }).points.length;
    const won = keptRounds(filterRounds(base, { ...DEFAULT_FILTER, result: 'won' }));
    const lost = keptRounds(filterRounds(base, { ...DEFAULT_FILTER, result: 'lost' }));
    expect(deaths(won) + deaths(lost)).toBe(deaths());
    expect(deaths(keptRounds(base))).toBe(deaths());

    // Lineups : chaque lancer connu est dans exactement un groupe
    const throws = collectThrows(lib, { map: m0.map, subject: { kind: 'all' }, side: 'all', kind: 'all' });
    expect(throws.length).toBe(m0.spatial!.nades.filter((n) => n.th && n.kind !== 'decoy').length);
    const groups = clusterLineups(throws);
    expect(groups.reduce((a, g) => a + g.throws.length, 0)).toBe(throws.length);
    expect(groups.some((g) => g.throws.length >= 2)).toBe(true);
    for (const g of groups) expect(g.throws).toContain(g.rep);

    // Fiche anti-strat : cohérente pour chaque équipe détectée
    for (const t of teams) {
      const m = lib.find((x) => x.id === t.entries[0].matchId)!;
      const b = buildBrief(lib, m.map, { kind: 'team', group: t })!;
      expect(b).not.toBeNull();
      expect(b.ct.played + b.t.played).toBe(b.rounds);
      expect(b.pistol.played).toBeLessThanOrEqual(b.maps * 2);
      expect(b.players.length).toBeGreaterThanOrEqual(4);
      const md = briefMarkdown(b, m.map);
      expect(md).toContain('## Key points');
      expect(md).toContain('| Player |');
      console.log(md.split('\n').slice(0, 14).join('\n'));
    }
    expect(buildBrief(lib, lib[0].map, { kind: 'all' })).toBeNull();

    // Stratégies : chaque round dans un seul groupe, groupes d'au moins 2 rounds du bon côté
    for (const side of ['t', 'ct'] as const) {
      const st = detectStrategies(base.filter((v) => v.match.id === lib[0].id && v.team === 0), side);
      const keys = st.flatMap((x) => x.rounds.map((r) => `${r.match.id}:${r.round.i}`));
      expect(new Set(keys).size).toBe(keys.length);
      for (const x of st) { expect(x.rounds.length).toBeGreaterThanOrEqual(2); expect(x.rounds.every((r) => r.side === side)).toBe(true); expect(x.rounds).toContain(x.medoid); }
    }

    // Plan d'entraînement : construit pour chaque joueur, programme du jour non vide
    for (const p of players.slice(0, 4)) {
      const plan = buildTraining(lib, p.steamid)!;
      expect(plan).not.toBeNull();
      expect(plan.daily.length).toBeGreaterThanOrEqual(2);
      expect(trainingMarkdown(plan)).toContain(p.name);
    }

    // Modèle de victoire appris + WPA
    const wp = fitWpModel(lib, 20)!;
    expect(wp).not.toBeNull();
    expect(wp.coef[0]).toBeGreaterThan(0); // un joueur de plus en vie = plus de chances
    expect(Number.isFinite(wp.logloss)).toBe(true);
    for (const m of lib) {
      const rounds = new Map(m.stats.all.map((x) => [x.player, x.rounds]));
      const w = wpaByPlayer(m.spatial!, wp, (p) => rounds.get(p) ?? 0);
      // Presque à somme nulle : un tueur gagne ce que sa victime perd (plants, défuses et suicides mis à part)
      const total = [...w.entries()].reduce((a, [p, v]) => a + v * (rounds.get(p) ?? 0), 0);
      const selfDeaths = m.spatial!.kills.filter((k) => k.kt < 0 || k.kt === k.vt).length;
      const bombActs = m.spatial!.rounds.filter((r) => r.plantSite).length + m.spatial!.rounds.filter((r) => r.defuseT != null).length;
      expect(Math.abs(total)).toBeLessThan(0.25 * (selfDeaths + 1) + 0.6 * bombActs);
      // Les meilleurs joueurs (kills − morts) ont une WPA plus haute
      const st = [...m.stats.all].filter((x) => x.rounds > 5).sort((a, b) => (b.kills - b.deaths) - (a.kills - a.deaths));
      expect(w.get(st[0].player)!).toBeGreaterThan(w.get(st[st.length - 1].player)!);
    }
    // Étalonnage avec la variante WPA (références fictives = 2.0≈ + bruit) : le modèle reste valide
    const fake = lib.map((m) => ({ ...m, refs: { hltv3: Object.fromEntries(m.stats.all.map((x, i) => [m.players[x.player].steamid, x.rating2 + ((i % 3) - 1) * 0.03])) } }));
    const cal = fitModel('hltv3', fake, 3, 20)!;
    expect(cal).not.toBeNull();
    expect(cal.cvMaeWithout).toBeDefined();
    expect(cal.wpInfo).toBeDefined();
    expect(cal.coef.length).toBe(cal.features.length);
    console.log('wp', JSON.stringify({ coef: wp.coef.map((c) => c.toFixed(2)), ll: wp.logloss.toFixed(3), base: wp.baselineLogloss.toFixed(3), cv: cal.cvMae.toFixed(3), without: cal.cvMaeWithout!.toFixed(3), kept: cal.wpInfo!.kept }));

    console.log('players', players.length, 'teams', teams.map((t) => `${t.name} (${t.entries.length})`).join(', '));
  }, 600_000);
});

import { buildMapPrep, buildOverview, prepMarkdown, teamGroupFromRoster } from '../src/analysis/prep';
describe.skipIf(!demos.includes('faceit1.dem'))('préparation de match', () => {
  it('map pool, veto, constats avec rounds à revoir, économie, joueurs', () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(dir, 'faceit1.dem')));
    const base = summarize(buildMatch(parseRaw(mod, bytes, { fileName: 'faceit1.dem', fileSize: bytes.length })), 0);
    // Le même adversaire sur 4 cartes (dates et identifiants différents)
    const lib = [0, 1, 2, 3].map((i) => ({ ...base, id: `${base.id}-${i}`, date: Date.UTC(2026, 9, 1 + i * 7) }));
    const teams = detectTeams(lib);
    expect(teams.length).toBe(2);
    const them = teams[0];
    const us = teamGroupFromRoster(lib, 'Us', teams[1].players.map((p) => p.steamid))!;
    expect(us.entries).toHaveLength(4);
    const ov = buildOverview(lib, them, us, ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_train']);
    expect(ov.maps.find((r) => r.map === 'de_mirage')?.them?.matches).toBe(4);
    expect(ov.veto!.bo3.filter((s) => s.action === 'decider')).toHaveLength(1);
    expect(ov.form).toHaveLength(4);
    const prep = buildMapPrep(lib, 'de_mirage', them)!;
    expect(prep.matches).toBe(4);
    expect(prep.findings.length).toBeGreaterThan(0);
    for (const f of prep.findings) {
      expect(f.counter.length).toBeGreaterThan(10);
      for (const r of f.rounds) { expect(lib.some((m) => m.id === r.matchId)).toBe(true); expect(r.round).toBeLessThan(base.rounds); }
    }
    const tRounds = prep.brief.t.played;
    expect(prep.economy.t.reduce((a, r) => a + r.rounds, 0)).toBe(tRounds);
    expect(prep.players.length).toBeGreaterThanOrEqual(4);
    expect(prep.players.some((p) => p.spots.t.length > 0)).toBe(true);
    const md = prepMarkdown(ov, [prep], { de_mirage: 'Stack B' }, (m) => m.replace('de_', ''));
    expect(md).toContain(`Match prep: ${them.name}`);
    expect(md).toContain('Stack B');
    // Référence = l'autre équipe (4 cartes, hors adversaire) : annoncée comme moyenne de la bibliothèque
    expect(prep.findings.filter((f) => f.baseline).every((f) => f.baseline!.includes('in your library'))).toBe(true);
    // Une seule carte de référence : valeurs typiques
    const solo = buildMapPrep([lib[0]], 'de_mirage', them)!;
    expect(solo.findings.filter((f) => f.baseline).every((f) => f.baseline!.includes('typical'))).toBe(true);
  }, 120000);
});
