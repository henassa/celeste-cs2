// Fiche anti-strat : tout ce qu'il faut savoir sur une équipe sur une carte, avant de la jouer.
// Chaque constat est accompagné de son échantillon (rounds, cartes) pour séparer habitude et hasard.
// Les « points clés » sont des règles simples et lisibles, pas un modèle opaque.

import type { LibraryMatch } from '../library/library';
import type { RatingModel } from '../calib/model';
import type { BuyType, TeamIdx } from '../library/spatial';
import type { Subject } from './heatmap';
import { aggregatePlayers, type PlayerAgg } from './players';
import { allRoundViews, summarizeRounds, tendencies, SMALL_SAMPLE, type RoundSummary, type RoundView, type Tendencies } from './rounds';
import { clusterLineups, collectThrows, type Lineup } from './lineups';
import { placeLabel as label } from '../viewer/places';
import { playerRoles, type RoleHint } from './roles';
import { tt } from '../i18n';

export interface Ratio { won: number; played: number }
const r0 = (): Ratio => ({ won: 0, played: 0 });

export interface BriefPlayer {
  agg: PlayerAgg;
  /** Rôles déduits, avec leur preuve. */
  hints: RoleHint[];
  /** Part des duels d'ouverture de l'équipe pris par ce joueur (%). */
  openingShare: number;
  /** Part de ses kills à l'AWP (%). */
  awpShare: number;
  role: string;
}

export interface Brief {
  map: string;
  teamName: string;
  maps: number;
  rounds: number;
  dates: [number, number] | null;
  record: { won: number; lost: number; tied: number };
  ct: Ratio;
  t: Ratio;
  pistol: Ratio;
  /** Round 2 (et 14) après un pistol gagné. */
  afterPistolWin: Ratio;
  /** Achat au round 2 après un pistol perdu, et rounds gagnés. */
  afterPistolLoss: { buys: Record<BuyType, number>; result: Ratio };
  /** Rounds CT avec bombe posée par l'adversaire, et rounds T après avoir posé. */
  retakes: Ratio;
  postPlant: Ratio;
  summary: { all: RoundSummary; t: RoundSummary; ct: RoundSummary };
  trends: Tendencies;
  lineups: { t: Lineup[]; ct: Lineup[] };
  players: BriefPlayer[];
  takeaways: string[];
  small: boolean;
}

const pctOf = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const clockAt = (sec: number) => { const l = Math.max(0, Math.ceil(115 - sec)); return `${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}`; };

/** Équipe du sujet dans un match. */
export function teamIn(m: LibraryMatch, s: Subject): TeamIdx | null {
  if (s.kind === 'team') return s.group.entries.find((e) => e.matchId === m.id)?.team ?? null;
  if (s.kind === 'player') { const p = m.players.find((x) => x.steamid === s.steamid); return p ? p.team : null; }
  return null;
}

export function buildBrief(matches: LibraryMatch[], map: string, subject: Subject, model3?: RatingModel): Brief | null {
  if (subject.kind === 'all') return null;
  const own = matches.filter((m) => m.map === map && teamIn(m, subject) !== null);
  if (!own.length) return null;
  const views = allRoundViews(own, { map, subject });
  const tViews = views.filter((v) => v.side === 't');
  const ctViews = views.filter((v) => v.side === 'ct');

  // Résultats et économie autour des pistols
  const record = { won: 0, lost: 0, tied: 0 };
  const ct = r0(), t = r0(), pistol = r0(), afterPistolWin = r0();
  const afterPistolLoss = { buys: { pistol: 0, eco: 0, force: 0, full: 0 } as Record<BuyType, number>, result: r0() };
  const byMatch = new Map<string, RoundView[]>();
  for (const v of views) { let a = byMatch.get(v.match.id); if (!a) byMatch.set(v.match.id, (a = [])); a.push(v); }
  for (const m of own) {
    const me = teamIn(m, subject)!;
    const them = 1 - me;
    if (m.score[me] > m.score[them]) record.won++; else if (m.score[me] < m.score[them]) record.lost++; else record.tied++;
    const vs = (byMatch.get(m.id) ?? []).sort((a, b) => a.round.i - b.round.i);
    for (const v of vs) {
      (v.side === 'ct' ? ct : t).played++;
      if (v.won) (v.side === 'ct' ? ct : t).won++;
    }
    for (const p of [0, 12]) {
      const pv = vs.find((v) => v.round.i === p), next = vs.find((v) => v.round.i === p + 1);
      if (!pv) continue;
      pistol.played++;
      if (pv.won) pistol.won++;
      if (!next) continue;
      if (pv.won) { afterPistolWin.played++; if (next.won) afterPistolWin.won++; }
      else { afterPistolLoss.buys[next.ourBuy]++; afterPistolLoss.result.played++; if (next.won) afterPistolLoss.result.won++; }
    }
  }

  // Joueurs de l'équipe : stats restreintes à leurs matchs dans cette équipe
  const teamOnly = own.map((m) => {
    const me = teamIn(m, subject)!;
    const keep = (list: typeof m.stats.all) => list.filter((s) => m.players[s.player]?.team === me);
    return { ...m, stats: { all: keep(m.stats.all), ct: keep(m.stats.ct), t: keep(m.stats.t) } };
  });
  const aggs = aggregatePlayers(teamOnly, { map }, model3).filter((a) => a.rounds >= Math.min(10, views.length / 3));
  const teamOpenings = aggs.reduce((s, a) => s + a.entryKills + a.entryDeaths, 0);
  const awpKills = new Map<string, number>();
  for (const m of own) {
    const me = teamIn(m, subject)!;
    for (const k of m.spatial?.kills ?? []) {
      if (k.kt !== me || !k.w.includes('awp')) continue;
      const sid = m.players[k.k]?.steamid;
      if (sid) awpKills.set(sid, (awpKills.get(sid) ?? 0) + 1);
    }
  }
  const roleMap = playerRoles(own, (m) => teamIn(m, subject));
  const players: BriefPlayer[] = aggs.map((agg) => {
    const openingShare = pctOf(agg.entryKills + agg.entryDeaths, teamOpenings);
    const awpShare = pctOf(awpKills.get(agg.steamid) ?? 0, agg.kills);
    const hints = roleMap.get(agg.steamid) ?? [];
    return { agg, openingShare, awpShare, hints, role: hints.slice(0, 2).map((h) => h.role).join(' · ') || '—' };
  }).sort((a, b) => (b.agg.rating3 ?? b.agg.rating2) - (a.agg.rating3 ?? a.agg.rating2));

  const trends = tendencies(views);
  const lineupsFor = (side: 'ct' | 't') => clusterLineups(collectThrows(own, { map, subject, side, kind: 'all' }))
    .filter((l) => l.throws.length >= 2 && (l.kind === 'smoke' || l.kind === 'molotov' || l.kind === 'flash')).slice(0, 6);
  const dates = own.length ? [Math.min(...own.map((m) => m.date)), Math.max(...own.map((m) => m.date))] as [number, number] : null;
  const teamName = subject.kind === 'team' ? subject.group.name : tt('{0}\'s team', [own[0].players.find((p) => p.steamid === subject.steamid)?.name ?? 'Player']);

  const withPlant = (vs: RoundView[]): Ratio => { const p = vs.filter((v) => v.round.plantSite); return { played: p.length, won: p.filter((v) => v.won).length }; };
  const brief: Brief = {
    map, teamName, maps: own.length, rounds: views.length, dates, record, ct, t, pistol, afterPistolWin, afterPistolLoss,
    retakes: withPlant(ctViews), postPlant: withPlant(tViews),
    summary: { all: summarizeRounds(views), t: summarizeRounds(tViews), ct: summarizeRounds(ctViews) },
    trends, lineups: { t: lineupsFor('t'), ct: lineupsFor('ct') }, players, takeaways: [],
    small: views.length < SMALL_SAMPLE * 3 || own.length < 2,
  };
  brief.takeaways = takeaways(brief);
  return brief;
}

/**
 * Constats automatiques, chacun avec son échantillon. Seuils volontairement prudents et éloignés
 * des moyennes habituelles (environ 70 % de victoire après le premier kill, 30 % après la première mort).
 */
function takeaways(b: Brief): string[] {
  const out: string[] = [];
  const T = b.summary.t;
  const plants = T.plants.A + T.plants.B;
  if (plants >= 4) {
    const site = T.plants.A >= T.plants.B ? 'A' : 'B';
    const share = pctOf(T.plants[site], plants);
    if (share >= 65) out.push(tt('T side: plants {0} in {1}% of planted rounds ({2}/{3}).', [site, share, T.plants[site], plants]));
  }
  if (T.avgPlantT != null && plants >= 4) {
    if (T.avgPlantT < 40) out.push(tt('T side: hits fast, average plant at {0} on the round clock.', [clockAt(T.avgPlantT)]));
    else if (T.avgPlantT > 65) out.push(tt('T side: plays slow, average plant at {0} on the round clock.', [clockAt(T.avgPlantT)]));
  }
  const habitOpen = b.trends.openings.find((x) => x.level !== 'oneoff');
  if (habitOpen && habitOpen.rounds >= 4) out.push(tt('First contact most often at {0} ({1}/{2} rounds, {3}/{4} maps).', [label(habitOpen.key), habitOpen.rounds, habitOpen.of, habitOpen.maps, habitOpen.totalMaps]));
  const all = b.summary.all;
  if (all.winWithoutOpening.played >= 6 && pctOf(all.winWithoutOpening.won, all.winWithoutOpening.played) <= 18) {
    out.push(tt('Struggles after losing the opening duel: wins {0}% of those rounds ({1}/{2}).', [pctOf(all.winWithoutOpening.won, all.winWithoutOpening.played), all.winWithoutOpening.won, all.winWithoutOpening.played]));
  }
  if (all.winWithOpening.played >= 6 && pctOf(all.winWithOpening.won, all.winWithOpening.played) >= 85) {
    out.push(tt('Converts the opening kill: wins {0}% after getting it ({1}/{2}).', [pctOf(all.winWithOpening.won, all.winWithOpening.played), all.winWithOpening.won, all.winWithOpening.played]));
  }
  const entry = [...b.players].sort((x, y) => y.openingShare - x.openingShare)[0];
  if (entry && entry.openingShare >= 30 && entry.agg.entryKills + entry.agg.entryDeaths >= 5) {
    out.push(tt('{0} takes {1}% of the team\'s opening duels ({2}–{3}).', [entry.agg.name, entry.openingShare, entry.agg.entryKills, entry.agg.entryDeaths]));
  }
  const awp = [...b.players].sort((x, y) => y.awpShare - x.awpShare)[0];
  if (awp && awp.awpShare >= 25 && awp.agg.kills >= 10) out.push(tt('{0} is the AWPer: {1}% of his kills.', [awp.agg.name, awp.awpShare]));
  for (const pl of b.players) {
    const lurk = pl.hints.find((h) => h.role === 'Lurk');
    if (lurk) out.push(`${pl.agg.name} lurks: ${lurk.evidence}.`);
    const anchor = pl.hints.find((h) => h.role === 'Anchor');
    if (anchor && anchor.score >= 0.7) out.push(`${pl.agg.name} anchors: ${anchor.evidence}.`);
  }
  const lost = b.afterPistolLoss;
  if (lost.result.played >= 2) {
    const force = lost.buys.force + lost.buys.full;
    if (force / lost.result.played >= 0.6) out.push(tt('Force-buys after a lost pistol ({0}/{1}).', [force, lost.result.played]));
    else if (lost.buys.eco / lost.result.played >= 0.6) out.push(tt('Saves after a lost pistol ({0}/{1}).', [lost.buys.eco, lost.result.played]));
  }
  const ctSpot = b.trends.setups.ct.find((x) => x.level !== 'oneoff' && x.rounds / Math.max(1, x.of) >= 0.7);
  if (ctSpot) out.push(tt('CT side: someone at {0} at 20 s in {1}% of rounds.', [label(ctSpot.key), pctOf(ctSpot.rounds, ctSpot.of)]));
  if (b.retakes.played >= 5 && pctOf(b.retakes.won, b.retakes.played) <= 20) {
    out.push(tt('CT side: rarely wins once the bomb is down ({0}/{1} retakes).', [b.retakes.won, b.retakes.played]));
  }
  if (b.postPlant.played >= 5 && pctOf(b.postPlant.won, b.postPlant.played) >= 80) {
    out.push(tt('T side: strong post-plants, wins {0}% after planting ({1}/{2}).', [pctOf(b.postPlant.won, b.postPlant.played), b.postPlant.won, b.postPlant.played]));
  }
  const lu = b.lineups.t[0];
  if (lu && lu.throws.length >= 3) out.push(tt('Recurring T {0}: {1} from {2}, thrown {3} times on {4} map{5}.', [lu.kind, label(lu.toPlace) || 'unknown spot', label(lu.fromPlace) || 'unknown', lu.throws.length, lu.maps, lu.maps === 1 ? '' : 's']));
  return out;
}


/** Fiche au format Markdown (à coller dans Discord, Notion, un doc...). */
export function briefMarkdown(b: Brief, mapName: string): string {
  const p = (r: Ratio) => (r.played ? `${pctOf(r.won, r.played)}% (${r.won}/${r.played})` : '—');
  const lines: string[] = [];
  lines.push(`# ${b.teamName} on ${mapName}`);
  lines.push('');
  lines.push(tt('{0} map{1}, {2} rounds{3}. Record {4}–{5}{6}.', [b.maps, b.maps === 1 ? '' : 's', b.rounds, b.dates ? `, ${new Date(b.dates[0]).toLocaleDateString()} – ${new Date(b.dates[1]).toLocaleDateString()}` : '', b.record.won, b.record.lost, b.record.tied ? `–${b.record.tied}` : '']));
  if (b.small) lines.push('', '> Small sample: treat these as hints, not habits.');
  lines.push('', '## Key points', '');
  if (b.takeaways.length) for (const t of b.takeaways) lines.push(`- ${t}`); else lines.push('- Nothing stands out yet with this sample.');
  lines.push('', '## Results', '');
  lines.push(tt('- CT rounds: {0}', [p(b.ct)]), tt('- T rounds: {0}', [p(b.t)]), tt('- Pistol rounds: {0}', [p(b.pistol)]));
  lines.push(tt('- Round after a won pistol: {0}', [p(b.afterPistolWin)]));
  const l = b.afterPistolLoss;
  lines.push(tt('- Round after a lost pistol: {0} · buys: eco {1}, force {2}, full {3}', [p(l.result), l.buys.eco, l.buys.force, l.buys.full]));
  const T = b.summary.t, all = b.summary.all;
  lines.push(tt('- Opening duels won: {0}', [p({ won: all.openingWon, played: all.openingPlayed })]));
  lines.push(tt('- Won after opening kill: {0} · after opening death: {1}', [p(all.winWithOpening), p(all.winWithoutOpening)]));
  lines.push('', tt('## T side'), '');
  lines.push(tt('- Plants: A {0}, B {1} in {2} T rounds{3}', [T.plants.A, T.plants.B, T.tRounds, T.avgPlantT != null ? tt(' · average plant at {0}', [clockAt(T.avgPlantT)]) : '']));
  lines.push(tt('- Won after planting: {0}', [p(b.postPlant)]));
  const list = (title: string, items: { key: string; rounds: number; of: number; maps: number; totalMaps: number; level: string }[]) => {
    if (!items.length) return;
    lines.push(`- ${title}: ${items.slice(0, 4).map((x) => `${label(x.key)} ${x.rounds}/${x.of} (${x.level === 'habit' ? tt('habit') : x.level === 'recurring' ? tt('recurring') : tt('one-off')})`).join(', ')}`);
  };
  list(tt('Opening duels at'), b.trends.openings);
  list(tt('Positions at 20 s'), b.trends.setups.t);
  for (const lu of b.lineups.t) lines.push(tt('- {0} {1} from {2} · {3}× on {4} map{5} · {6}', [lu.kind, label(lu.toPlace) || '?', label(lu.fromPlace) || '?', lu.throws.length, lu.maps, lu.maps === 1 ? '' : 's', `\`${setpos(lu)}\``]));
  lines.push('', tt('## CT side'), '');
  lines.push(tt('- Retakes won (bomb planted): {0}', [p(b.retakes)]));
  list(tt('Setup at 20 s'), b.trends.setups.ct);
  for (const lu of b.lineups.ct) lines.push(tt('- {0} {1} from {2} · {3}× on {4} map{5} · {6}', [lu.kind, label(lu.toPlace) || '?', label(lu.fromPlace) || '?', lu.throws.length, lu.maps, lu.maps === 1 ? '' : 's', `\`${setpos(lu)}\``]));
  lines.push('', tt('## Players'), '');
  lines.push(tt('| Player | Role | Rating | ADR | KAST | Opening K–D | AWP kills |'), '|---|---|---|---|---|---|---|');
  for (const pl of b.players) {
    const a = pl.agg;
    lines.push(`| ${a.name} | ${pl.hints.slice(0, 2).map((h) => `${h.role} (${h.evidence})`).join('; ') || '—'} | ${(a.rating3 ?? a.rating2).toFixed(2)} | ${a.adr.toFixed(0)} | ${a.kast.toFixed(0)}% | ${a.entryKills}–${a.entryDeaths} | ${pl.awpShare}% |`);
  }
  lines.push('', tt('_Made with Celeste CS2 from local demos._'));
  return lines.join('\n');
}

function setpos(l: Lineup): string {
  const t = l.rep.nade.th!;
  const f = (v: number) => v.toFixed(2);
  return tt('setpos {0} {1} {2};setang {3} {4} 0.00', [f(t.x), f(t.y), f(t.z), f(t.pitch), f(t.yaw)]);
}

/** Cartes jouées par le sujet, de la plus jouée à la moins jouée. */
export function subjectMaps(matches: LibraryMatch[], subject: Subject): string[] {
  const c = new Map<string, number>();
  for (const m of matches) if (m.spatial && (subject.kind === 'all' || teamIn(m, subject) !== null)) c.set(m.map, (c.get(m.map) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}
