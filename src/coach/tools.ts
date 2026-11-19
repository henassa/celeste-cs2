// Outils du coach : le modèle les appelle pour aller chercher les faits dont il a besoin, au lieu
// de deviner. Deux périmètres : un match ouvert dans le replay, ou toute la bibliothèque.
// Chaque outil renvoie du texte compact et factuel, calculé localement.

import type { MatchData } from '../data/types';
import { computeStats, type PlayerStats } from '../stats/compute';
import { computeInsights } from '../stats/insights';
import { detectMoments, MOMENT_LABEL } from '../stats/moments';
import { roundSwings } from '../stats/wp-model';
import { buySummary, duelMatrix, economy, HITGROUPS, utility, weapons } from '../stats/details';
import { aimBasic, summarizeAim } from '../stats/aim';
import { buildSpatial, type MatchSpatial } from '../library/spatial';
import { summarize, type LibraryMatch } from '../library/library';
import { placeLabel } from '../viewer/places';
import { allRoundViews, filterRounds, DEFAULT_FILTER, tendencies, summarizeRounds, type RoundFilter } from '../analysis/rounds';
import { detectStrategies } from '../analysis/strategies';
import { buildBrief, briefMarkdown, subjectMaps } from '../analysis/brief';
import { aggregatePlayers } from '../analysis/players';
import { detectTeams, teamReport, type TeamGroup } from '../analysis/teams';
import { buildTraining, trainingMarkdown } from '../analysis/training';
import { playerRoles } from '../analysis/roles';
import { compareMaps, mapPool, simulateVeto } from '../analysis/veto';
import { buildMapPrep } from '../analysis/prep';
import { prepKey, prepStore } from '../app/prep-store';
import type { Subject } from '../analysis/heatmap';
import { calloutCenters, findCallout, setZones, type Zone, type ZoneKind } from '../app/zones';

export interface ToolDef {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, { type: string; description: string; enum?: string[]; items?: unknown }>; required?: string[] };
  run: (args: Record<string, unknown>) => string;
}

const clock = (sec: number) => { const l = Math.max(0, Math.ceil(115 - sec)); return `${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}`; };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));

/** Retrouve un nom (joueur, équipe) par correspondance souple. */
function findByName<T>(items: T[], name: string, key: (t: T) => string): T | null {
  const n = norm(name);
  if (!n) return null;
  return items.find((t) => norm(key(t)) === n) ?? items.find((t) => norm(key(t)).includes(n) || n.includes(norm(key(t)))) ?? null;
}

const statLine = (s: PlayerStats) => {
  const cl = s.clutches.reduce((a, c) => a + c.wins, 0), ca = s.clutches.reduce((a, c) => a + c.attempts, 0);
  return `${s.kills}-${s.deaths}-${s.assists} K-D-A, ADR ${s.adr.toFixed(0)}, KAST ${s.kast.toFixed(0)}%, HS ${s.hsPct.toFixed(0)}%, rating2 ${s.rating2.toFixed(2)}, swing ${s.swing.toFixed(1)}%/round, opening ${s.entryKills}-${s.entryDeaths}, trade kills ${s.tradeKills}, clutches ${cl}/${ca}, multi-kill rounds ${s.multi[2] + s.multi[3] + s.multi[4] + s.multi[5]}, utility dmg ${s.utilityDamage}, enemies flashed ${s.enemiesFlashed}, flash assists ${s.flashAssists}`;
};

/** Morts « tradées » : un coéquipier tue le tueur dans les 5 s. Mesure clé du jeu d'équipe. */
function tradeStats(m: MatchData): Map<number, { deaths: number; traded: number }> {
  const out = new Map<number, { deaths: number; traded: number }>();
  for (const k of m.kills) {
    if (k.killer < 0 || k.killer === k.victim) continue;
    const team = m.players[k.victim]?.team;
    if (team === undefined || m.players[k.killer]?.team === team) continue;
    const t = out.get(team) ?? { deaths: 0, traded: 0 };
    t.deaths++;
    if (m.kills.some((x) => x.victim === k.killer && x.tick > k.tick && x.tick - k.tick <= 5 * m.tickrate && m.players[x.killer]?.team === team)) t.traded++;
    out.set(team, t);
  }
  return out;
}

/** Constats pré-calculés sur un match, pour les deux équipes (règles lisibles, échantillons). */
export function matchFindings(m: MatchData, sp: MatchSpatial = buildSpatial(m)): string[] {
  const lm = summarize(m, 0);
  const out: string[] = [];
  for (const t of [0, 1] as const) {
    const sid = m.players.find((p) => p.team === t)?.steamid;
    if (!sid) continue;
    const b = buildBrief([lm], m.header.map, { kind: 'player', steamid: sid });
    if (b) for (const x of b.takeaways) out.push(`${m.teams[t].name}: ${x}`);
  }
  for (const [team, s] of tradeStats(m)) if (s.deaths >= 8) out.push(`${m.teams[team].name}: ${Math.round((s.traded / s.deaths) * 100)}% of deaths traded within 5 s (${s.traded}/${s.deaths}); around 20–30% is usual, under 15% means players die alone.`);
  void sp;
  return out;
}

/** Force des positions : kills faits depuis chaque callout et morts à chaque callout, par côté. */
function positionStrength(spatials: { sp: MatchSpatial; team?: number }[], side: 'ct' | 't' | 'all'): string {
  const acc = new Map<string, { k: number; d: number; ok: number; od: number }>();
  const get = (n: string) => { let a = acc.get(n); if (!a) { a = { k: 0, d: 0, ok: 0, od: 0 }; acc.set(n, a); } return a; };
  for (const { sp, team } of spatials) {
    for (const r of sp.rounds) {
      const kills = sp.kills.filter((k) => k.r === r.i && k.kt >= 0 && k.kt !== k.vt).sort((a, b) => a.t - b.t);
      kills.forEach((k, idx) => {
        const sideOf = (t: number) => (t === r.ctTeam ? 'ct' : 't');
        const kp = k.kp != null && k.kp >= 0 ? sp.places?.[k.kp] : '', vp = k.vp != null && k.vp >= 0 ? sp.places?.[k.vp] : '';
        if (kp && (team === undefined || k.kt === team) && (side === 'all' || sideOf(k.kt) === side)) { const a = get(kp); a.k++; if (idx === 0) a.ok++; }
        if (vp && (team === undefined || k.vt === team) && (side === 'all' || sideOf(k.vt) === side)) { const a = get(vp); a.d++; if (idx === 0) a.od++; }
      });
    }
  }
  const rows = [...acc.entries()].filter(([, a]) => a.k + a.d >= 4).sort((x, y) => (y[1].k - y[1].d) - (x[1].k - x[1].d));
  if (!rows.length) return 'Not enough fights with known callouts.';
  return ['Callout: kills made from there – deaths there (opening kills–opening deaths). Strong = positive, weak = negative; small samples are noisy.',
    ...rows.slice(0, 30).map(([n, a]) => `- ${placeLabel(n)} (${n}): ${a.k}–${a.d} (${a.ok}–${a.od})`)].join('\n');
}

/** Pose des zones sur la carte (2D, 3D, heatmaps) à partir de noms de callouts. */
function showZones(map: string, spatials: MatchSpatial[], args: Record<string, unknown>): string {
  const list = Array.isArray(args.zones) ? (args.zones as Record<string, unknown>[]) : [];
  const centers = calloutCenters(spatials);
  const zones: Zone[] = [], missing: string[] = [];
  for (const z of list.slice(0, 12)) {
    const c = findCallout(centers, str(z.callout));
    if (!c) { missing.push(str(z.callout)); continue; }
    const kind = (['strong', 'weak', 'info'].includes(str(z.kind)) ? str(z.kind) : 'info') as ZoneKind;
    zones.push({ x: c.x, y: c.y, z: c.z, r: c.r, label: str(z.label) || placeLabel(c.name), kind, callout: c.name });
  }
  if (!zones.length) return `No zone placed: unknown callouts (${missing.join(', ')}). Known callouts: ${[...centers.values()].map((c) => c.name).join(', ')}.`;
  setZones({ map, title: str(args.title) || 'Coach', zones });
  return `Shown on the ${map} map (replay radar, 3D view and heatmaps): ${zones.map((z) => `${z.label} [${z.kind}]`).join(', ')}.${missing.length ? ` Unknown: ${missing.join(', ')}.` : ''} Tell the user the zones are drawn on the map.`;
}

const ZONES_PARAMS = {
  type: 'object' as const,
  properties: {
    zones: {
      type: 'array', description: 'Zones to draw, callouts as returned by position_strength',
      items: { type: 'object', properties: { callout: { type: 'string', description: 'Callout, e.g. BombsiteA' }, label: { type: 'string', description: 'Short text' }, kind: { type: 'string', enum: ['strong', 'weak', 'info'], description: 'strong, weak or info' } }, required: ['callout'] },
    },
    title: { type: 'string', description: 'Short title' },
  },
  required: ['zones'],
};

export const CS_PRIMER = [
  'CS2 reference points: average ADR is about 75–80, good KAST is 70%+, a traded death is avenged within 5 s,',
  'the team getting the opening kill wins about 70% of rounds, pistol and second rounds swing the economy,',
  'a full buy is roughly $4,000+ per player, forcing after a lost pistol is risky but common,',
  'CT retakes succeed rarely without numbers or utility, post-plant T sides win most rounds with 2+ players alive.',
].join(' ');

// --- Périmètre : un match ---

export function matchTools(m: MatchData, notes: Record<number, string> = {}): ToolDef[] {
  const sp = buildSpatial(m);
  const stats = computeStats(m, 'all'), ct = computeStats(m, 'ct'), t = computeStats(m, 't');
  const lm = summarize(m, 0);
  const name = (p: number) => m.players[p]?.name ?? '?';
  const teamIdx = (n: string) => { const i = [0, 1].find((x) => norm(m.teams[x].name) === norm(n) || norm(m.teams[x].name).includes(norm(n))); return i === undefined ? null : (i as 0 | 1); };
  const place = (i: number | undefined) => (i != null && i >= 0 ? placeLabel(sp.places?.[i] ?? '') : '');
  const playerOf = (n: string) => findByName(m.players.map((p, i) => ({ ...p, i })), n, (p) => p.name);
  const subjectOf = (team: 0 | 1): Subject => ({ kind: 'player', steamid: m.players.find((p) => p.team === team)!.steamid });

  return [
    {
      name: 'match_overview', description: 'Score, halves, player stat lines, summary cards and pre-computed findings for both teams. Call this first.',
      parameters: { type: 'object', properties: {} },
      run: () => {
        const last = m.rounds[m.rounds.length - 1];
        const ins = computeInsights(m, stats);
        const L = [`${m.teams[0].name} ${last?.scoreAfter[0]}–${last?.scoreAfter[1]} ${m.teams[1].name} on ${m.header.map}, ${m.rounds.length} rounds.`];
        for (const team of [0, 1] as const) {
          L.push(`${m.teams[team].name} players:`);
          for (const s of stats.filter((x) => x.team === team).sort((a, b) => b.rating2 - a.rating2)) L.push(`- ${s.name}: ${statLine(s)}`);
        }
        if (ins.streak) L.push(`Longest streak: ${m.teams[ins.streak.team].name} ${ins.streak.length} rounds (R${ins.streak.from}-R${ins.streak.to}).`);
        for (const s of ins.sites) L.push(`${m.teams[s.team].name} on T: ${s.plants.A + s.plants.B}/${s.tRounds} plants (A ${s.plants.A}, B ${s.plants.B}), ${s.postPlantWon} won after plant.`);
        L.push('Findings:', ...matchFindings(m, sp).map((x) => `- ${x}`));
        const n = Object.entries(notes).filter(([, v]) => v?.trim());
        if (n.length) L.push('Team notes:', ...n.map(([k, v]) => `- R${k}: ${v.trim().replace(/\n+/g, ' ')}`));
        return L.join('\n');
      },
    },
    {
      name: 'list_rounds', description: 'Compact list of rounds, optionally filtered by team side, result, buy or plant.',
      parameters: { type: 'object', properties: {
        team: { type: 'string', description: 'Team name for the point of view (optional)' },
        side: { type: 'string', enum: ['ct', 't', 'all'], description: 'Side of that team' },
        result: { type: 'string', enum: ['won', 'lost', 'all'], description: 'Round result for that team' },
        buy: { type: 'string', enum: ['pistol', 'eco', 'force', 'full', 'all'], description: 'Buy of that team' },
        plant: { type: 'string', enum: ['A', 'B', 'none', 'all'], description: 'Bomb plant' },
      } },
      run: (a) => {
        const team = teamIdx(str(a.team));
        const views = allRoundViews([lm], { subject: team === null ? { kind: 'all' } : subjectOf(team) });
        const f: RoundFilter = { ...DEFAULT_FILTER, side: (str(a.side) || 'all') as RoundFilter['side'], result: (str(a.result) || 'all') as RoundFilter['result'], ourBuy: (str(a.buy) || 'all') as RoundFilter['ourBuy'], bomb: (str(a.plant) || 'all') as RoundFilter['bomb'] };
        const list = filterRounds(views, f).filter((v, i, arr) => team !== null || arr.findIndex((x) => x.round.i === v.round.i) === i);
        if (!list.length) return 'No round matches.';
        const s = summarizeRounds(list);
        return [`${list.length} rounds, ${s.won} won${team === null ? ' (by the CT side of each)' : ''}.`, ...list.map((v) => {
          const fk = v.openingKill;
          return `R${v.round.i + 1}: ${m.teams[v.team].name} ${v.side.toUpperCase()} ${v.won ? 'won' : 'lost'} · buys ${v.ourBuy} vs ${v.theirBuy}${fk ? ` · opening ${name(fk.k)}→${name(fk.v)}${v.openingPlace ? ` at ${placeLabel(v.openingPlace)}` : ''}` : ''}${v.round.plantSite ? ` · plant ${v.round.plantSite} ${clock(v.round.plantT ?? 0)}` : ''}`;
        })].join('\n');
      },
    },
    {
      name: 'round_detail', description: 'Everything that happened in one round: kills with times and callouts, win-probability swings, utility, plant, buys, damage, and the team note.',
      parameters: { type: 'object', properties: { round: { type: 'integer', description: 'Round number (1-based)' } }, required: ['round'] },
      run: (a) => {
        const ri = num(a.round) - 1;
        const r = sp.rounds[ri];
        if (!r) return `No round ${a.round}. The match has ${sp.rounds.length} rounds.`;
        const info = m.rounds[ri];
        const L = [`Round ${ri + 1}: CT ${m.teams[r.ctTeam].name}, won by ${r.winner !== null ? m.teams[r.winner].name : '?'} (${info.reason}). Buys ${m.teams[0].name} ${r.buy[0]} ($${r.equip[0]}) vs ${m.teams[1].name} ${r.buy[1]} ($${r.equip[1]}). Score before: ${ri > 0 ? (m.rounds[ri - 1]?.scoreAfter ?? [0, 0]).join('–') : '0–0'}.`];
        const swings = new Map(roundSwings(sp, ri, null).filter((s) => s.kill).map((s) => [s.kill!, s]));
        for (const k of sp.kills.filter((x) => x.r === ri && x.t >= 0).sort((x, y) => x.t - y.t)) {
          const s = swings.get(k);
          const gain = s && k.kt >= 0 ? Math.round((k.kt === 1 - r.ctTeam ? s.dT : -s.dT) * 100) : null;
          L.push(`- ${clock(k.t)} ${k.kt >= 0 ? name(k.k) : 'world'}${place(k.kp) ? ` (${place(k.kp)})` : ''} killed ${name(k.v)}${place(k.vp) ? ` (${place(k.vp)})` : ''}, ${k.w.replace(/^weapon_/, '')}${k.hs ? ' HS' : ''}${k.a != null && k.a >= 0 ? `, assist ${name(k.a)}` : ''}${gain !== null ? `, ${gain >= 0 ? '+' : ''}${gain}% win chance for ${m.teams[k.kt as 0 | 1]?.name ?? "?"}` : ''}`);
        }
        for (const team of [0, 1] as const) {
          const nades = sp.nades.filter((n) => n.r === ri && n.team === team && n.kind !== 'decoy');
          if (nades.length) L.push(`${m.teams[team].name} utility: ${nades.map((n) => `${n.kind}${place(n.lp) ? ` ${place(n.lp)}` : ''} ${clock(n.t)} (${name(n.p)})`).join(', ')}`);
        }
        if (r.plantSite) L.push(`Plant ${r.plantSite} at ${clock(r.plantT ?? 0)} by ${r.planter != null && r.planter >= 0 ? name(r.planter) : '?'}${r.defuseT != null ? `, defused at ${clock(r.defuseT)} by ${r.defuser != null && r.defuser >= 0 ? name(r.defuser) : '?'}` : ''}.`);
        const dmg = new Map<number, number>();
        for (const h of m.hurts) if (h.round === ri && h.attacker >= 0 && m.players[h.attacker]?.team !== m.players[h.victim]?.team) dmg.set(h.attacker, (dmg.get(h.attacker) ?? 0) + h.dmgHealth);
        L.push(`Damage: ${[...dmg.entries()].sort((x, y) => y[1] - x[1]).map(([p, d]) => `${name(p)} ${d}`).join(', ') || 'none'}.`);
        if (notes[ri + 1]?.trim()) L.push(`Team note: ${notes[ri + 1].trim()}`);
        return L.join('\n');
      },
    },
    {
      name: 'player_report', description: 'One player: stats overall / CT / T, aim (accuracy, shots while stopped, duels), likely roles, opening duels, where they die, key moments.',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'Player name' } }, required: ['name'] },
      run: (a) => {
        const p = playerOf(str(a.name));
        if (!p) return `No player named ${a.name}. Players: ${m.players.map((x) => x.name).join(', ')}.`;
        const g = (list: PlayerStats[]) => list.find((s) => s.player === p.i);
        const L = [`${p.name} (${m.teams[p.team].name}).`, `Overall: ${g(stats) ? statLine(g(stats)!) : '—'}`, `CT: ${g(ct) ? statLine(g(ct)!) : '—'}`, `T: ${g(t) ? statLine(g(t)!) : '—'}`];
        const aim = summarizeAim(m, aimBasic(m), null).find((x) => x.player === p.i);
        if (aim) L.push(`Aim: accuracy ${aim.accuracy?.toFixed(0) ?? '—'}%, shots while stopped ${aim.stoppedPct?.toFixed(0) ?? '—'}%, duels won hitting first ${aim.firstHitWin?.toFixed(0) ?? '—'}%, when hit first ${aim.hitFirstWin?.toFixed(0) ?? '—'}%, one-hit kills ${aim.oneTapPct?.toFixed(0) ?? '—'}%.`);
        const roles = playerRoles([lm], () => p.team).get(p.steamid) ?? [];
        if (roles.length) L.push(`Likely roles: ${roles.map((r) => `${r.role} (${r.evidence})`).join('; ')}.`);
        const deaths = sp.kills.filter((k) => k.v === p.i);
        const byPlace = new Map<string, number>();
        for (const k of deaths) { const pl = place(k.vp); if (pl) byPlace.set(pl, (byPlace.get(pl) ?? 0) + 1); }
        L.push(`Deaths by callout: ${[...byPlace.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}.`);
        const openings = sp.rounds.map((r) => sp.kills.filter((k) => k.r === r.i && k.kt >= 0 && k.kt !== k.vt).sort((x, y) => x.t - y.t)[0]).filter((k) => k && (k.k === p.i || k.v === p.i));
        L.push(`Opening duels: ${openings.map((k) => `R${k!.r + 1} ${k!.k === p.i ? 'won vs' : 'lost to'} ${name(k!.k === p.i ? k!.v : k!.k)}${place(k!.vp) ? ` at ${place(k!.vp)}` : ''}`).join('; ') || 'none'}.`);
        const moments = detectMoments(m, null, sp).filter((x) => x.players.includes(p.i));
        if (moments.length) L.push(`Moments: ${moments.map((x) => `R${x.round + 1} ${x.title}`).join('; ')}.`);
        return L.join('\n');
      },
    },
    {
      name: 'team_report', description: 'One team in this match: round tendencies (opening spots, positions, plants), recurring strategies, economy results, trades, post-plant and retakes.',
      parameters: { type: 'object', properties: { team: { type: 'string', description: 'Team name' } }, required: ['team'] },
      run: (a) => {
        const team = teamIdx(str(a.team));
        if (team === null) return `No team named ${a.team}. Teams: ${m.teams.map((x) => x.name).join(', ')}.`;
        const views = allRoundViews([lm], { subject: subjectOf(team) });
        const s = summarizeRounds(views), tr = tendencies(views);
        const L = [`${m.teams[team].name}: ${s.won}/${s.rounds} rounds won, opening duels ${s.openingWon}/${s.openingPlayed}, won ${s.winWithOpening.won}/${s.winWithOpening.played} after the opening kill and ${s.winWithoutOpening.won}/${s.winWithoutOpening.played} after the opening death.`];
        const buys = new Map<string, [number, number]>();
        for (const v of views) { const b = buys.get(v.ourBuy) ?? [0, 0]; b[1]++; if (v.won) b[0]++; buys.set(v.ourBuy, b); }
        L.push(`By buy: ${[...buys.entries()].map(([k, [w, n]]) => `${k} ${w}/${n}`).join(', ')}.`);
        const trade = tradeStats(m).get(team);
        if (trade) L.push(`Deaths traded within 5 s: ${trade.traded}/${trade.deaths}.`);
        const list = (title: string, items: { key: string; rounds: number; of: number }[]) => items.length && L.push(`${title}: ${items.slice(0, 5).map((x) => `${placeLabel(x.key)} ${x.rounds}/${x.of}`).join(', ')}.`);
        list('Opening duels at', tr.openings); list('T positions at 20 s', tr.setups.t); list('CT setup at 20 s', tr.setups.ct);
        L.push(`Plants: A ${tr.plants.find((x) => x.key === 'A')?.rounds ?? 0}, B ${tr.plants.find((x) => x.key === 'B')?.rounds ?? 0}.`);
        for (const side of ['t', 'ct'] as const) for (const st of detectStrategies(views, side)) L.push(`${side === 't' ? 'T strategy' : 'CT setup'} “${st.name}” ×${st.rounds.length} (won ${st.won}): ${st.details.join(', ')}; rounds ${st.rounds.map((r) => `R${r.round.i + 1}`).join(' ')}.`);
        return L.join('\n');
      },
    },
    {
      name: 'compare_players', description: 'Side-by-side stats of two players.',
      parameters: { type: 'object', properties: { a: { type: 'string', description: 'First player' }, b: { type: 'string', description: 'Second player' } }, required: ['a', 'b'] },
      run: (a) => [str(a.a), str(a.b)].map((n) => { const p = playerOf(n); const s = p && stats.find((x) => x.player === p.i); return p && s ? `${p.name}: ${statLine(s)}` : `No player ${n}.`; }).join('\n'),
    },
    {
      name: 'find_moments', description: 'Key moments: clutches, multi-kills, decisive kills, lost advantages, eco wins, team kills, defuses.',
      parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['all', ...Object.keys(MOMENT_LABEL)], description: 'Kind of moment' } } },
      run: (a) => detectMoments(m, null, sp).filter((x) => !a.kind || a.kind === 'all' || x.kind === a.kind).map((x) => `R${x.round + 1} ${MOMENT_LABEL[x.kind]}: ${x.title}`).join('\n') || 'None.',
    },
    {
      name: 'position_strength', description: 'Strong and weak positions: kills made from each callout vs deaths there (and opening duels), optionally for one team and side.',
      parameters: { type: 'object', properties: { team: { type: 'string', description: 'Team name (optional)' }, side: { type: 'string', enum: ['ct', 't', 'all'], description: 'Side' } } },
      run: (a) => { const t = teamIdx(str(a.team)); return positionStrength([{ sp, team: t ?? undefined }], (str(a.side) || 'all') as 'ct' | 't' | 'all'); },
    },
    {
      name: 'show_on_map', description: 'Draw zones on the map for the user (replay radar and 3D view): strong positions, weak spots, setups. Use it whenever positions matter.',
      parameters: ZONES_PARAMS,
      run: (a) => showZones(m.header.map, [sp], a),
    },
    {
      name: 'economy_report', description: 'Round-by-round buys, equipment value and bank of both teams, and win rates by buy type (incl. against full buys).',
      parameters: { type: 'object', properties: {} },
      run: () => {
        const eco = economy(m, sp);
        const L = eco.map((r) => `R${r.round + 1}: ${[0, 1].map((t) => `${m.teams[t].name} ${r.buy[t]} $${r.equip[t]} (bank $${r.bank[t]})`).join(' vs ')} → ${r.winner !== null ? m.teams[r.winner].name : '?'}`);
        for (const t of [0, 1] as const) L.push(`${m.teams[t].name} by buy: ${buySummary(eco, t).map((b) => `${b.buy} ${b.won}/${b.played}${b.vsFull ? ` (vs full ${b.vsFullWon}/${b.vsFull})` : ''}`).join(', ')}.`);
        return L.join('\n');
      },
    },
    {
      name: 'duels_and_weapons', description: 'Who beats whom (kills and damage between each pair of opponents), weapon kills and where each player hits (head/chest/legs).',
      parameters: { type: 'object', properties: {} },
      run: () => {
        const dm = duelMatrix(m);
        const L = ['Duels (row vs column, kills-deaths, damage difference):'];
        dm.left.forEach((p, i) => L.push(`- ${name(p)}: ${dm.right.map((q, j) => `vs ${name(q)} ${dm.kills[i][j]}-${dm.killsBack[i][j]} (${dm.damage[i][j] - dm.damageBack[i][j] >= 0 ? '+' : ''}${dm.damage[i][j] - dm.damageBack[i][j]})`).join(', ')}`));
        const w = weapons(m);
        L.push('Weapons:', ...w.rows.slice(0, 25).map((r) => `- ${name(r.player)} ${r.weapon}: ${r.kills} kills, ${r.hs} HS, ${r.damage} dmg${r.shots ? `, ${Math.round((r.hits / r.shots) * 100)}% hits` : ''}`));
        L.push('Hit zones:', ...w.hitgroups.map((h) => `- ${name(h.player)}: ${HITGROUPS.map((g) => `${g} ${Math.round((h.hits[g] / h.total) * 100)}%`).join(', ')} (${h.total} hits)`));
        return L.join('\n');
      },
    },
    {
      name: 'utility_report', description: 'Utility usage per player: grenades thrown by type, where smokes and mollies land, utility damage, enemies flashed, flash assists.',
      parameters: { type: 'object', properties: { team: { type: 'string', description: 'Team name (optional)' } } },
      run: (a) => {
        const team = teamIdx(str(a.team));
        const L: string[] = [];
        const eff = new Map(utility(m).map((u) => [u.player, u]));
        for (const s of stats.filter((x) => team === null || x.team === team)) {
          const u = eff.get(s.player);
          if (u) L.push(`${s.name} flash effect: ${u.enemiesBlinded} enemies blinded (${u.blindTime} s), ${u.flashKills} blinded enemies then killed by the team, ${u.teamBlinded} teammates flashed; HE ${u.heDamage} dmg, fire ${u.fireDamage} dmg.`);
          const nades = sp.nades.filter((n) => n.p === s.player);
          const kinds = ['smoke', 'flash', 'molotov', 'he'].map((k) => `${k} ${nades.filter((n) => n.kind === k).length}`).join(', ');
          const lands = new Map<string, number>();
          for (const n of nades) if ((n.kind === 'smoke' || n.kind === 'molotov') && place(n.lp)) lands.set(`${n.kind} ${place(n.lp)}`, (lands.get(`${n.kind} ${place(n.lp)}`) ?? 0) + 1);
          L.push(`${s.name}: ${kinds}; utility damage ${s.utilityDamage}, enemies flashed ${s.enemiesFlashed}, flash assists ${s.flashAssists}; often ${[...lands.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${k}×${v}`).join(', ') || '—'}.`);
        }
        return L.join('\n');
      },
    },
  ];
}

// --- Périmètre : la bibliothèque ---

export function libraryTools(matches: LibraryMatch[]): ToolDef[] {
  const teams = detectTeams(matches);
  const players = aggregatePlayers(matches);
  const teamOf = (n: string): TeamGroup | null => findByName(teams, n, (t) => t.name);
  const mapOf = (n: string) => { const maps = [...new Set(matches.map((m) => m.map))]; const k = norm(n).replace(/^de/, ''); return maps.find((m) => norm(m) === norm(n) || norm(m).replace(/^de/, '') === k || norm(m).includes(k)) ?? null; };
  const subjectFor = (n: string): Subject | null => {
    const tg = teamOf(n);
    if (tg) return { kind: 'team', group: tg };
    const p = findByName(players, n, (x) => x.name);
    return p ? { kind: 'player', steamid: p.steamid } : null;
  };
  return [
    {
      name: 'library_overview', description: 'What is in the library: maps, detected teams, most present players.',
      parameters: { type: 'object', properties: {} },
      run: () => {
        const maps = new Map<string, number>();
        for (const m of matches) maps.set(m.map, (maps.get(m.map) ?? 0) + 1);
        return [`${matches.length} maps: ${[...maps.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}.`,
          `Teams (roster-based): ${teams.map((t) => `${t.name} (${t.entries.length} maps)`).join(', ') || 'none'}.`,
          `Players: ${players.slice(0, 20).map((p) => `${p.name} (${p.matches} maps, rating2 ${p.rating2.toFixed(2)})`).join(', ')}.`].join('\n');
      },
    },
    {
      name: 'player_history', description: 'A player across the library: aggregated stats, last matches, and their training plan (weak points with evidence).',
      parameters: { type: 'object', properties: { name: { type: 'string', description: 'Player name' } }, required: ['name'] },
      run: (a) => {
        const p = findByName(players, str(a.name), (x) => x.name);
        if (!p) return `No player ${a.name}.`;
        const L = [`${p.name}: ${p.matches} maps, ${p.rounds} rounds, K/D ${p.kd.toFixed(2)}, ADR ${p.adr.toFixed(0)}, KAST ${p.kast.toFixed(0)}%, HS ${p.hsPct.toFixed(0)}%, rating2 ${p.rating2.toFixed(2)}, opening ${p.entryKills}-${p.entryDeaths}, clutches ${p.clutchWins}/${p.clutchAttempts}.`,
          `Last maps: ${p.lines.slice(-8).map((l) => `${l.map} ${l.won === null ? 'tie' : l.won ? 'W' : 'L'} ${l.kills}-${l.deaths} ADR ${l.adr.toFixed(0)}`).join('; ')}.`];
        const plan = buildTraining(matches, p.steamid);
        if (plan) L.push(trainingMarkdown(plan));
        return L.join('\n');
      },
    },
    {
      name: 'team_history', description: 'A team (or a player\'s teams) across the library: record, CT/T, economy, openings, plants, retakes, per map.',
      parameters: { type: 'object', properties: { team: { type: 'string', description: 'Team or player name' } }, required: ['team'] },
      run: (a) => {
        const tg = teamOf(str(a.team));
        if (!tg) return `No team ${a.team}. Teams: ${teams.map((t) => t.name).join(', ')}.`;
        const r = teamReport(tg, matches);
        const pct = (x: { won: number; played: number }) => (x.played ? `${Math.round((x.won / x.played) * 100)}% (${x.won}/${x.played})` : '—');
        return [`${tg.name}: ${r.record.won}-${r.record.lost} maps, rounds ${pct(r.rounds)}, CT ${pct(r.ct)}, T ${pct(r.t)}, pistols ${pct(r.pistol)}.`,
          `Buys: full ${pct(r.buys.full)}, force ${pct(r.buys.force)}, eco ${pct(r.buys.eco)}. After opening kill ${pct(r.openingKill)}, after opening death ${pct(r.openingDeath)}.`,
          `Plants ${r.plants}/${r.tRounds} (A ${r.sites.A}, B ${r.sites.B}), post-plant ${pct(r.postPlant)}, retakes ${pct(r.retakes)}.`,
          `Per map: ${r.maps.map((x) => `${x.map} ${x.won}/${x.matches} maps, CT ${pct(x.ct)}, T ${pct(x.t)}`).join('; ')}.`].join('\n');
      },
    },
    {
      name: 'anti_strat_brief', description: 'Full anti-strat brief of a team on a map (key points, tendencies, recurring grenades, players and roles).',
      parameters: { type: 'object', properties: { team: { type: 'string', description: 'Team or player name' }, map: { type: 'string', description: 'Map, e.g. de_mirage (optional: most played)' } }, required: ['team'] },
      run: (a) => {
        const s = subjectFor(str(a.team));
        if (!s) return `No team or player ${a.team}.`;
        const maps = subjectMaps(matches, s);
        const map = maps.find((x) => norm(x).includes(norm(str(a.map)))) ?? maps[0];
        const b = map ? buildBrief(matches, map, s) : null;
        return b ? briefMarkdown(b, map) : 'No data for this team.';
      },
    },
    {
      name: 'strategies', description: 'Recurring T executes or CT setups of a team on a map, with frequency and win rate.',
      parameters: { type: 'object', properties: { team: { type: 'string', description: 'Team or player name' }, map: { type: 'string', description: 'Map (optional)' }, side: { type: 'string', enum: ['t', 'ct'], description: 'Side' } }, required: ['team'] },
      run: (a) => {
        const s = subjectFor(str(a.team));
        if (!s) return `No team or player ${a.team}.`;
        const maps = subjectMaps(matches, s);
        const map = maps.find((x) => norm(x).includes(norm(str(a.map)))) ?? maps[0];
        const views = allRoundViews(matches, { map, subject: s });
        const list = detectStrategies(views, str(a.side) === 'ct' ? 'ct' : 't');
        return list.length ? list.map((x) => `“${x.name}” ×${x.rounds.length}/${views.filter((v) => v.side === (str(a.side) === 'ct' ? 'ct' : 't')).length} (won ${x.won}, ${x.maps} maps, ${x.level}): ${x.details.join(', ')}`).join('\n') : 'No recurring pattern.';
      },
    },
    {
      name: 'position_strength', description: 'Strong and weak positions on a map across the library: kills made from each callout vs deaths there, for everyone or one team / player, by side.',
      parameters: { type: 'object', properties: { map: { type: 'string', description: 'Map, e.g. de_dust2' }, team: { type: 'string', description: 'Team or player (optional)' }, side: { type: 'string', enum: ['ct', 't', 'all'], description: 'Side' } }, required: ['map'] },
      run: (a) => {
        const map = mapOf(str(a.map));
        if (!map) return `No demos of ${a.map} in the library.`;
        const s0 = str(a.team) ? subjectFor(str(a.team)) : null;
        const list = matches.filter((m) => m.map === map && m.spatial).map((m) => {
          let team: number | undefined;
          if (s0?.kind === 'team') { const e = s0.group.entries.find((x) => x.matchId === m.id); team = e?.team; if (team === undefined) return null; }
          if (s0?.kind === 'player') { const p = m.players.find((x) => x.steamid === s0.steamid); if (!p) return null; team = p.team; }
          return { sp: m.spatial!, team };
        }).filter((x): x is { sp: MatchSpatial; team: number | undefined } => x !== null);
        return `${map}, ${list.length} maps.\n${positionStrength(list, (str(a.side) || 'all') as 'ct' | 't' | 'all')}`;
      },
    },
    {
      name: 'show_on_map', description: 'Draw zones on a map for the user (shown on the Heatmaps page, 2D and 3D): strong positions, weak spots, setups. Use it whenever positions matter.',
      parameters: { ...ZONES_PARAMS, properties: { ...ZONES_PARAMS.properties, map: { type: 'string', description: 'Map, e.g. de_dust2' } }, required: ['map', 'zones'] },
      run: (a) => {
        const map = mapOf(str(a.map));
        if (!map) return `No demos of ${a.map} in the library.`;
        return showZones(map, matches.filter((m) => m.map === map && m.spatial).map((m) => m.spatial!), a);
      },
    },
    {
      name: 'match_prep', description: 'Full match prep against a team on one map: findings ranked by importance (each with sample size, comparison with the library average or typical values, NEW when it is a recent tendency, and a counter idea), T and CT by economy, timings, detected strats, player cards, and the user\'s own plan notes. Use it to help prepare a match.',
      parameters: { type: 'object', properties: { team: { type: 'string', description: 'Opponent team' }, map: { type: 'string', description: 'Map, e.g. de_mirage' } }, required: ['team', 'map'] },
      run: (a) => {
        const s0 = subjectFor(str(a.team)), map = mapOf(str(a.map));
        if (!s0 || s0.kind !== 'team') return 'Team not found.';
        if (!map) return `No demos of ${a.map} in the library.`;
        const p = buildMapPrep(matches, map, s0.group);
        if (!p) return `No demos of ${s0.group.name} on ${map}.`;
        const eco = (rows: typeof p.economy.t) => rows.map((r) => `${r.buy} ${r.won}/${r.rounds} won${r.plantA + r.plantB ? `, plants A ${r.plantA} B ${r.plantB}` : ''}${r.spots.length ? `, at 20 s: ${r.spots.map((x) => `${x.place} ${x.share}%`).join(', ')}` : ''}`).join('; ');
        const note = prepStore.get()[prepKey(s0.group.name)]?.notes[map];
        return [`${s0.group.name} on ${map}: ${p.matches} maps (${p.recentMatches} counted as recent).`,
          'Findings:', ...p.findings.map((f) => `- [${f.side}]${f.isNew ? ' NEW' : ''} ${f.text}${f.sample ? ` (${f.sample}${f.baseline ? `; ref ${f.baseline}` : ''})` : ''}. Counter idea: ${f.counter}`),
          `T by economy: ${eco(p.economy.t)}`, `CT by economy: ${eco(p.economy.ct)}`,
          `Strats T: ${p.strategies.t.slice(0, 4).map((x) => `${x.name} ×${x.rounds.length}`).join(', ') || 'none'}. CT: ${p.strategies.ct.slice(0, 4).map((x) => `${x.name} ×${x.rounds.length}`).join(', ') || 'none'}.`,
          'Players: ' + p.players.map((x) => `${x.name} (${x.role}, rating ${x.rating.toFixed(2)}, openings ${x.openings[0]}-${x.openings[1]}, AWP ${x.awpShare}%${x.spots.t.length ? `, T ${x.spots.t.join('/')}` : ''}${x.spots.ct.length ? `, CT ${x.spots.ct.join('/')}` : ''})`).join('; '),
          note ? `User's plan notes: ${note}` : 'No plan notes yet.'].join('\n');
      },
    },
    {
      name: 'veto', description: 'Map pool comparison between two teams and a simulated BO3 veto.',
      parameters: { type: 'object', properties: { us: { type: 'string', description: 'Our team' }, them: { type: 'string', description: 'Opponent' } }, required: ['us', 'them'] },
      run: (a) => {
        const us = subjectFor(str(a.us)), them = subjectFor(str(a.them));
        if (!us || !them) return 'Team not found.';
        const rows = compareMaps(['de_ancient', 'de_anubis', 'de_cache', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke'], mapPool(matches, us), mapPool(matches, them));
        return [...rows.map((r) => `${r.map}: edge ${(r.edge * 100).toFixed(0)} points (us ${r.us ? `${r.us.wins}/${r.us.matches} maps` : 'never'}, them ${r.them ? `${r.them.wins}/${r.them.matches}` : 'never'})${r.reliable ? '' : ', small sample'}`),
          'Simulated BO3: ' + simulateVeto(rows, 'bo3', 'us').map((s) => `${s.team ?? 'decider'} ${s.action} ${s.map}`).join(', ')].join('\n');
      },
    },
  ];
}
