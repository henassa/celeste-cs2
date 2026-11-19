// Routines d'entraînement : points faibles d'un joueur sur toute la bibliothèque (seuils fixes et
// comparaison avec les autres joueurs), chacun avec sa preuve et des exercices concrets. Les
// exercices s'appuient sur ses propres données : lineups à apprendre, morts à revoir.

import type { LibraryMatch } from '../library/library';
import { aggregatePlayers, type PlayerAgg } from './players';
import { clusterLineups, collectThrows, techLabel, type Lineup } from './lineups';
import { setposCommand, placeLabel } from '../viewer/places';
import { tt } from '../i18n';

export interface Drill { name: string; minutes: number; how: string }

export interface Weakness {
  id: string;
  title: string;
  evidence: string;
  /** Gravité 0..1 : sert à choisir les priorités du jour. */
  severity: number;
  drills: Drill[];
}

export interface RewatchRound { match: LibraryMatch; round: number; why: string }

export interface TrainingPlan {
  player: PlayerAgg;
  maps: number;
  aim: AimAgg | null;
  /** Ce qui manque pour juger certains points (échantillons trop petits). */
  notes: string[];
  weaknesses: Weakness[];
  strengths: string[];
  /** Programme du jour : échauffement + exercices des 2-3 priorités. */
  daily: { block: string; minutes: number; detail: string }[];
  lineups: { map: string; lineup: Lineup; setpos: string }[];
  rewatch: RewatchRound[];
  mainMap: string | null;
}

export interface AimAgg { accuracy: number | null; stoppedPct: number | null; reactionMs: number | null; crosshairDeg: number | null; firstHitWin: number | null; matches: number; measured: number }

function aggregateAim(matches: LibraryMatch[], sid: string): AimAgg | null {
  let n = 0, measured = 0;
  const sums = { accuracy: [0, 0], stoppedPct: [0, 0], reactionMs: [0, 0], crosshairDeg: [0, 0], firstHitWin: [0, 0] };
  for (const m of matches) {
    const a = m.aim?.[sid];
    if (!a) continue;
    n++;
    measured += a.measured;
    const add = (k: keyof typeof sums, v: number | null, w: number) => { if (v !== null && w > 0) { sums[k][0] += v * w; sums[k][1] += w; } };
    add('accuracy', a.accuracy, a.shots);
    add('stoppedPct', a.stoppedPct, a.shots);
    add('reactionMs', a.reactionMs, a.measured);
    add('crosshairDeg', a.crosshairDeg, a.measured);
    add('firstHitWin', a.firstHitWin, a.duels);
  }
  if (!n) return null;
  const v = (k: keyof typeof sums) => (sums[k][1] ? sums[k][0] / sums[k][1] : null);
  return { accuracy: v('accuracy'), stoppedPct: v('stoppedPct'), reactionMs: v('reactionMs'), crosshairDeg: v('crosshairDeg'), firstHitWin: v('firstHitWin'), matches: n, measured };
}

/** Rang du joueur parmi les autres (0 = le moins bon, 1 = le meilleur). */
function percentile(all: PlayerAgg[], value: number, of: (p: PlayerAgg) => number, higherIsBetter = true): number | null {
  const vals = all.map(of).filter(Number.isFinite);
  if (vals.length < 8) return null;
  const below = vals.filter((x) => (higherIsBetter ? x < value : x > value)).length;
  return below / vals.length;
}

export function buildTraining(matches: LibraryMatch[], steamid: string): TrainingPlan | null {
  const own = matches.filter((m) => m.players.some((p) => p.steamid === steamid));
  if (!own.length) return null;
  const all = aggregatePlayers(matches).filter((p) => p.rounds >= 40);
  const me = aggregatePlayers(own).find((p) => p.steamid === steamid);
  if (!me) return null;
  const aim = aggregateAim(own, steamid);
  const R = Math.max(1, me.rounds);
  const mapCount = new Map<string, number>();
  for (const m of own) mapCount.set(m.map, (mapCount.get(m.map) ?? 0) + 1);
  const mainMap = [...mapCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const mainName = mainMap ? mainMap.replace(/^de_/, '').replace(/^./, (c) => c.toUpperCase()) : tt('your main map');

  const weaknesses: Weakness[] = [];
  const strengths: string[] = [];
  const pc = (v: number, of: (p: PlayerAgg) => number, high = true) => percentile(all, v, of, high);

  // Aim (stats mesurées depuis la vue Stats), seulement avec assez d'échantillons
  const shots = own.reduce((a, m) => a + (m.aim?.[steamid]?.shots ?? 0), 0);
  const enoughDuels = (aim?.measured ?? 0) >= 8;
  const enoughShots = shots >= 100;
  if (aim) {
    if (enoughDuels && aim.crosshairDeg !== null && aim.crosshairDeg > 3.2) {
      weaknesses.push({ id: 'crosshair', title: tt('Crosshair placement'), severity: Math.min(1, (aim.crosshairDeg - 2.5) / 4), evidence: tt('crosshair {0}° from the enemy\'s head when he appears (median, {1} duels)', [aim.crosshairDeg.toFixed(1), aim.measured]), drills: [
        { name: tt('Prefire map for {0}', [mainName]), minutes: 10, how: 'Walk the common angles with the crosshair at head height, stop before each corner. Workshop: search “prefire” + the map name.' },
        { name: tt('Deathmatch, headshots only'), minutes: 10, how: 'Do not move the mouse vertically: only strafe and adjust left / right.' },
      ] });
    } else if (enoughDuels && aim.crosshairDeg !== null && aim.crosshairDeg < 2) strengths.push(tt('clean crosshair placement ({0}°)', [aim.crosshairDeg.toFixed(1)]));
    if (enoughDuels && aim.reactionMs !== null && aim.reactionMs > 330) {
      weaknesses.push({ id: 'reaction', title: tt('Slow first shot'), severity: Math.min(1, (aim.reactionMs - 280) / 250), evidence: tt('{0} ms from seeing the enemy to the first damage (median)', [Math.round(aim.reactionMs)]), drills: [
        { name: tt('Reflex / flick training'), minutes: 8, how: 'Aim Botz or a reflex map: short sessions at full focus, react to each bot as it appears.' },
        { name: tt('Pre-aim the next angle'), minutes: 5, how: 'In deathmatch, before peeking say out loud where the enemy will be and park the crosshair there.' },
      ] });
    } else if (enoughDuels && aim.reactionMs !== null && aim.reactionMs < 250) strengths.push(tt('fast first shot ({0} ms)', [Math.round(aim.reactionMs)]));
    if (enoughShots && aim.stoppedPct !== null && aim.stoppedPct < 78) {
      weaknesses.push({ id: 'strafe', title: tt('Shooting while moving'), severity: Math.min(1, (80 - aim.stoppedPct) / 25), evidence: tt('only {0}% of shots fired while stopped', [Math.round(aim.stoppedPct)]), drills: [
        { name: tt('Counter-strafe drill'), minutes: 8, how: 'Aim Botz: strafe A / D, tap the opposite key to stop, shoot one bullet, repeat. Speed comes after the stop is clean.' },
      ] });
    }
    if (enoughShots && aim.accuracy !== null && aim.accuracy < 18) {
      weaknesses.push({ id: 'spray', title: tt('Accuracy / spray'), severity: Math.min(1, (20 - aim.accuracy) / 10), evidence: tt('{0}% of bullets hit (guns)', [Math.round(aim.accuracy)]), drills: [
        { name: tt('Recoil practice'), minutes: 8, how: 'Recoil map or a wall: AK and M4 sprays at 10 m, then 5-bullet bursts at 20 m.' },
      ] });
    }
  }

  // Duels d'ouverture
  const openings = me.entryKills + me.entryDeaths;
  if (openings >= 10) {
    const win = me.entryKills / openings;
    if (win < 0.45) {
      weaknesses.push({ id: 'opening', title: tt('Opening duels'), severity: Math.min(1, (0.5 - win) * 3), evidence: tt('{0}–{1} in opening duels ({2}%)', [me.entryKills, me.entryDeaths, Math.round(win * 100)]), drills: [
        { name: tt('Rewatch your opening deaths'), minutes: 10, how: 'Listed below: for each one, note whether you peeked alone, without utility or into a known angle.' },
        { name: tt('Prefire {0}', [mainName]), minutes: 5, how: 'Focus on the spots where you die first (see the list of rounds to rewatch).' },
      ] });
    } else if (win > 0.58) strengths.push(tt('wins opening duels ({0}–{1})', [me.entryKills, me.entryDeaths]));
  }

  // Utilitaires : dégâts et flashs par rapport aux autres
  const udr = me.utilityDamage / R;
  const udrRank = pc(udr, (p) => p.utilityDamage / Math.max(1, p.rounds));
  if (udrRank !== null && udrRank < 0.25) {
    weaknesses.push({ id: 'utility', title: tt('Utility'), severity: 0.5 + (0.25 - udrRank), evidence: tt('{0} utility damage per round, lower than {1}% of the players in your library', [udr.toFixed(1), Math.round((1 - udrRank) * 100)]), drills: [
      { name: tt('Learn {0} lineups', [mainName]), minutes: 10, how: 'Throw the lineups listed below (setpos copied in the console with sv_cheats 1) until each lands first try.' },
      { name: tt('Molly and HE timing'), minutes: 5, how: 'Practice post-plant mollies and stacking HEs with a teammate on common holds.' },
    ] });
  }

  // KAST et survie
  if (me.kast < 66 && me.rounds >= 60) {
    weaknesses.push({ id: 'kast', title: tt('Impact per round'), severity: Math.min(1, (70 - me.kast) / 15), evidence: tt('KAST {0}%: too many rounds without a kill, assist, survival or trade', [me.kast.toFixed(0)]), drills: [
      { name: tt('Play for trades'), minutes: 0, how: 'In your next matches, stay within trade distance of a teammate and avoid dry peeks after the first contact.' },
    ] });
  }
  if (me.rating2 > 1.15) strengths.push(tt('strong overall rating ({0})', [me.rating2.toFixed(2)]));

  weaknesses.sort((a, b) => b.severity - a.severity);

  // Programme du jour : échauffement + les exercices des 3 premières priorités
  const daily: TrainingPlan['daily'] = [{ block: 'Warm-up', minutes: 8, detail: tt('Aim Botz: 100 kills standing, 100 with counter-strafe.') }];
  for (const w of weaknesses.slice(0, 3)) for (const d of w.drills.filter((x) => x.minutes > 0).slice(0, 1)) daily.push({ block: d.name, minutes: d.minutes, detail: `${w.title}: ${d.how}` });
  daily.push({ block: 'Deathmatch', minutes: 10, detail: weaknesses[0] ? tt('Apply the focus of the day: {0}.', [weaknesses[0].title.toLowerCase()]) : tt('Keep the crosshair at head height.') });

  // Lineups du joueur (lancés 2+ fois) et, à défaut, ceux de ses coéquipiers sur sa carte principale
  const lineups: TrainingPlan['lineups'] = [];
  for (const map of mapCount.keys()) {
    const mine = clusterLineups(collectThrows(own, { map, subject: { kind: 'player', steamid }, side: 'all', kind: 'all' })).filter((l) => l.throws.length >= 2 && l.kind !== 'flash');
    for (const l of mine.slice(0, 4)) { const t = l.rep.nade.th!; lineups.push({ map, lineup: l, setpos: setposCommand(t.x, t.y, t.z, t.pitch, t.yaw) }); }
  }

  // Rounds à revoir : morts en duel d'ouverture (les plus récentes d'abord)
  const rewatch: RewatchRound[] = [];
  for (const m of [...own].sort((a, b) => b.date - a.date)) {
    const sp = m.spatial;
    const p = m.players.findIndex((x) => x.steamid === steamid);
    if (!sp || p < 0) continue;
    for (const r of sp.rounds) {
      const first = sp.kills.filter((k) => k.r === r.i && k.kt >= 0 && k.kt !== k.vt).sort((a, b) => a.t - b.t)[0];
      if (first && first.v === p) {
        const place = first.vp != null && first.vp >= 0 ? sp.places?.[first.vp] ?? '' : '';
        rewatch.push({ match: m, round: r.i, why: tt('died first{0} to {1} ({2})', [place ? ` at ${placeLabel(place)}` : '', m.players[first.k]?.name ?? '?', first.w.replace(/^weapon_/, '')]) });
      }
    }
    if (rewatch.length >= 12) break;
  }

  const notes: string[] = [];
  if (aim && !enoughDuels) notes.push(tt('Reaction and crosshair need 8+ measured duels ({0} so far): measure aim on more of this player\'s matches.', [aim.measured]));
  if (aim && !enoughShots) notes.push(tt('Accuracy needs 100+ shots ({0} so far).', [shots]));
  return { player: me, maps: own.length, aim, notes, weaknesses, strengths, daily, lineups, rewatch: rewatch.slice(0, 12), mainMap };
}

export function trainingMarkdown(t: TrainingPlan): string {
  const L: string[] = [tt('# Training plan · {0}', [t.player.name]), '', tt('From {0} map{1} in scrimview.', [t.maps, t.maps === 1 ? '' : 's']), ''];
  if (t.strengths.length) L.push(tt('**Strengths:** {0}.', [t.strengths.join(', ')]), '');
  L.push('## Today', '');
  for (const d of t.daily) L.push(tt('- **{0}** ({1} min): {2}', [d.block, d.minutes, d.detail]));
  L.push('', '## Priorities', '');
  if (!t.weaknesses.length) L.push('- Nothing stands out: keep the routine and add more demos.');
  for (const w of t.weaknesses) {
    L.push(`### ${w.title}`, '', `_${w.evidence}_`, '');
    for (const d of w.drills) L.push(`- ${d.name}${d.minutes ? tt(' ({0} min)', [d.minutes]) : ''}: ${d.how}`);
    L.push('');
  }
  if (t.lineups.length) {
    L.push('## Your lineups', '');
    for (const l of t.lineups) L.push(`- ${l.map.replace(/^de_/, '')} · ${l.lineup.kind} ${placeLabel(l.lineup.toPlace) || '?'} from ${placeLabel(l.lineup.fromPlace) || '?'} (${techLabel(l.lineup.tech).toLowerCase()}) · \`${l.setpos}\``);
    L.push('');
  }
  return L.join('\n');
}
