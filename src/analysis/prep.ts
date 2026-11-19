// Préparation de match contre une équipe : map pool et veto prédit, puis par carte ce qu'elle fait
// selon l'économie, ses timings, ses setups, ses joueurs, et des constats classés par importance —
// comparés à la moyenne de la bibliothèque (référence), marqués « nouveau » quand c'est récent, chacun
// avec les rounds à revoir et une piste de contre.

import type { LibraryMatch } from '../library/library';
import type { RatingModel } from '../calib/model';
import type { BuyType, TeamIdx } from '../library/spatial';
import type { TeamGroup } from './teams';
import { allRoundViews, tendencies, type RoundView } from './rounds';
import { buildBrief, teamIn, type Brief } from './brief';
import { compareMaps, mapPool, simulateVeto, type MapRow, type VetoStep } from './veto';
import { detectStrategies, type Strategy } from './strategies';
import { placeLabel } from '../viewer/places';
import { tt } from '../i18n';

export interface RoundRef { matchId: string; round: number }
export interface PrepFinding {
  id: string;
  side: 'ct' | 't' | 'all';
  text: string;
  /** Échantillon lisible : « 9/12 rounds, 4 maps ». */
  sample: string;
  /** Comparaison à la référence de la bibliothèque, si elle a un sens. */
  baseline?: string;
  /** Importance (écart à la référence × taille de l'échantillon) : sert au classement. */
  score: number;
  /** La tendance vient des derniers matchs (absente ou rare avant). */
  isNew?: boolean;
  /** Piste de contre (le call de l'équipe reste le vôtre). */
  counter: string;
  rounds: RoundRef[];
}
export interface EconomyRow { buy: BuyType; rounds: number; won: number; plantA: number; plantB: number; avgPlantT: number | null; spots: { place: string; share: number }[] }
export interface PlayerCard {
  steamid: string; name: string; role: string; rating: number; adr: number; kast: number;
  openings: [number, number]; openingShare: number; awpShare: number; clutches: [number, number];
  spots: { t: string[]; ct: string[] };
  awpSpots: string[];
}
export interface MapPrep {
  map: string;
  brief: Brief;
  matches: number;
  recentMatches: number;
  economy: { t: EconomyRow[]; ct: EconomyRow[] };
  timings: { tContact: number | null; ctContact: number | null; plant: number | null; base: { tContact: number | null; plant: number | null } };
  strategies: { t: Strategy[]; ct: Strategy[] };
  players: PlayerCard[];
  findings: PrepFinding[];
}
export interface Overview {
  team: TeamGroup;
  maps: MapRow[];
  veto: { bo1: VetoStep[]; bo3: VetoStep[] } | null;
  form: { matchId: string; map: string; date: number; us: number; them: number; opponent: string }[];
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const clock = (sec: number) => { const l = Math.max(0, Math.ceil(115 - sec)); return `${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}`; };
const refs = (vs: RoundView[]): RoundRef[] => vs.map((v) => ({ matchId: v.match.id, round: v.round.i }));
const mapsOf = (vs: RoundView[]) => new Set(vs.map((v) => v.match.id)).size;

/** Écart d'une proportion à la référence, en écarts-types (test simple), plafonné. */
function zScore(k: number, n: number, p0: number): number {
  if (!n) return 0;
  const p0c = Math.min(0.95, Math.max(0.05, p0));
  return Math.max(-6, Math.min(6, (k / n - p0c) / Math.sqrt((p0c * (1 - p0c)) / n)));
}

/** Notre équipe (Mon équipe) en groupe d'équipe : ses matchs et son côté dans chacun. */
export function teamGroupFromRoster(matches: LibraryMatch[], name: string, ids: string[]): TeamGroup | null {
  if (!ids.length) return null;
  const set = new Set(ids), need = Math.min(3, ids.length);
  const entries: TeamGroup['entries'] = [];
  for (const m of matches) {
    const n = [0, 0];
    for (const p of m.players) if (set.has(p.steamid)) n[p.team]++;
    const team: TeamIdx | null = n[0] >= need && n[0] >= n[1] ? 0 : n[1] >= need ? 1 : null;
    if (team !== null) entries.push({ matchId: m.id, team });
  }
  return { id: `me-${ids.slice().sort().join('-')}`, name: name || tt('My team'), players: ids.map((s) => ({ steamid: s, name: s, matches: 0 })), entries };
}

export function buildOverview(matches: LibraryMatch[], them: TeamGroup, us: TeamGroup | null, pool: string[]): Overview {
  const themPool = mapPool(matches, { kind: 'team', group: them });
  const usPool = us ? mapPool(matches, { kind: 'team', group: us }) : new Map();
  const maps = compareMaps(pool, usPool, themPool);
  const veto = us ? { bo1: simulateVeto(maps, 'bo1', 'us'), bo3: simulateVeto(maps, 'bo3', 'us') } : null;
  const form = matches.filter((m) => teamIn(m, { kind: 'team', group: them }) !== null).sort((a, b) => b.date - a.date).slice(0, 8).map((m) => {
    const me = teamIn(m, { kind: 'team', group: them })!;
    return { matchId: m.id, map: m.map, date: m.date, us: m.score[me], them: m.score[1 - me], opponent: m.teams[1 - me] };
  });
  return { team: them, maps, veto, form };
}

/**
 * Référence : les autres équipes de la bibliothèque (hors adversaire) sur cette carte ; avec moins de
 * 3 cartes, sur toutes les cartes de la bibliothèque (sans les comparaisons de callouts, propres à
 * une carte) ; avec moins de 3 matchs en tout, des valeurs typiques.
 */
interface Baseline { scope: 'map' | 'library' | 'typical'; views: RoundView[]; plantA: number; plants: number; plantT: number | null; tContact: number | null; convert: [number, number]; noOpen: [number, number]; retake: [number, number]; postPlant: [number, number]; pistol: [number, number]; forceAfterLoss: [number, number] }
function baselineOf(views: RoundView[], scope: Baseline['scope']): Baseline {
  const t = views.filter((v) => v.side === 't'), ct = views.filter((v) => v.side === 'ct');
  const planted = t.filter((v) => v.round.plantSite);
  const withOpen = views.filter((v) => v.opening === true), noOpen = views.filter((v) => v.opening === false);
  const ctPlant = ct.filter((v) => v.round.plantSite);
  const pistols = views.filter((v) => v.round.i === 0 || v.round.i === 12);
  const lostPistol = new Set(pistols.filter((v) => !v.won).map((v) => `${v.match.id}:${v.team}:${v.round.i}`));
  const afterLoss = views.filter((v) => (v.round.i === 1 || v.round.i === 13) && lostPistol.has(`${v.match.id}:${v.team}:${v.round.i - 1}`));
  return {
    scope, views: scope === 'map' ? views : [],
    plantA: planted.filter((v) => v.round.plantSite === 'A').length, plants: planted.length,
    plantT: avg(planted.map((v) => v.round.plantT!).filter((x) => x != null)),
    tContact: avg(t.map((v) => v.openingKill?.t).filter((x): x is number => x != null)),
    convert: [withOpen.filter((v) => v.won).length, withOpen.length],
    noOpen: [noOpen.filter((v) => v.won).length, noOpen.length],
    retake: [ctPlant.filter((v) => v.won).length, ctPlant.length],
    postPlant: [planted.filter((v) => v.won).length, planted.length],
    pistol: [pistols.filter((v) => v.won).length, pistols.length],
    forceAfterLoss: [afterLoss.filter((v) => v.ourBuy === 'force' || v.ourBuy === 'full').length, afterLoss.length],
  };
}
const TYPICAL: Baseline = { scope: 'typical', views: [], plantA: 50, plants: 100, plantT: 45, tContact: 20, convert: [72, 100], noOpen: [32, 100], retake: [25, 100], postPlant: [72, 100], pistol: [50, 100], forceAfterLoss: [40, 100] };
function baseline(matches: LibraryMatch[], map: string, exclude: Set<string>): Baseline {
  const others = (ms: LibraryMatch[]) => allRoundViews(ms, { subject: { kind: 'all' } }).filter((v) => !exclude.has(`${v.match.id}:${v.team}`));
  const onMap = matches.filter((m) => m.map === map && m.spatial);
  if (onMap.length >= 3) return baselineOf(others(onMap), 'map');
  const all = matches.filter((m) => m.spatial);
  if (all.length >= 3) return { ...baselineOf(others(all), 'library'), plantA: 50, plants: 100 };
  return TYPICAL;
}
const logit = (p: number) => Math.log(p / (1 - p));
const clamp = (p: number) => Math.min(0.92, Math.max(0.08, p));
/** Valeur attendue pour une équipe de ce niveau : la référence décalée de son taux de rounds gagnés. */
const atLevel = (p0: number, teamRate: number) => 1 / (1 + Math.exp(-(logit(clamp(p0)) + logit(clamp(teamRate)))));

function economyRows(views: RoundView[]): EconomyRow[] {
  const order: BuyType[] = ['pistol', 'eco', 'force', 'full'];
  return order.map((buy) => {
    const vs = views.filter((v) => v.ourBuy === buy);
    const spotCount = new Map<string, number>();
    for (const v of vs) {
      const sp = v.match.spatial!, places = sp.places ?? [];
      const seen = new Set<string>();
      for (const p of sp.pos) if (p.r === v.round.i && p.team === v.team && p.s === 20 && p.pl != null && p.pl >= 0) seen.add(places[p.pl]);
      for (const s of seen) spotCount.set(s, (spotCount.get(s) ?? 0) + 1);
    }
    const planted = vs.filter((v) => v.round.plantSite);
    return {
      buy, rounds: vs.length, won: vs.filter((v) => v.won).length,
      plantA: planted.filter((v) => v.round.plantSite === 'A').length, plantB: planted.filter((v) => v.round.plantSite === 'B').length,
      avgPlantT: avg(planted.map((v) => v.round.plantT!).filter((x) => x != null)),
      spots: [...spotCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([place, n]) => ({ place: placeLabel(place), share: pct(n, vs.length) })),
    };
  }).filter((r) => r.rounds > 0);
}

function playerCards(own: LibraryMatch[], team: TeamGroup, brief: Brief): PlayerCard[] {
  return brief.players.map((bp) => {
    const sid = bp.agg.steamid;
    const spots = { t: new Map<string, number>(), ct: new Map<string, number>() };
    const awp = new Map<string, number>();
    for (const m of own) {
      const me = teamIn(m, { kind: 'team', group: team });
      const idx = m.players.findIndex((p) => p.steamid === sid);
      if (me === null || idx < 0 || !m.spatial) continue;
      const places = m.spatial.places ?? [];
      const ctOf = new Map(m.spatial.rounds.map((r) => [r.i, r.ctTeam]));
      for (const p of m.spatial.pos) {
        if (p.p !== idx || p.s !== 20 || p.pl == null || p.pl < 0) continue;
        const side = ctOf.get(p.r) === me ? spots.ct : spots.t;
        side.set(places[p.pl], (side.get(places[p.pl]) ?? 0) + 1);
      }
      for (const k of m.spatial.kills) if (k.k === idx && k.w.includes('awp') && k.kp != null && k.kp >= 0) awp.set(places[k.kp], (awp.get(places[k.kp]) ?? 0) + 1);
    }
    const top = (mp: Map<string, number>, n: number) => [...mp.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => placeLabel(k));
    return {
      steamid: sid, name: bp.agg.name, role: bp.role, rating: bp.agg.rating3 ?? bp.agg.rating2, adr: bp.agg.adr, kast: bp.agg.kast,
      openings: [bp.agg.entryKills, bp.agg.entryDeaths], openingShare: bp.openingShare, awpShare: bp.awpShare,
      clutches: [bp.agg.clutchWins, bp.agg.clutchAttempts], spots: { t: top(spots.t, 2), ct: top(spots.ct, 2) }, awpSpots: bp.awpShare >= 20 ? top(awp, 3) : [],
    };
  });
}

export function buildMapPrep(matches: LibraryMatch[], map: string, team: TeamGroup, model3?: RatingModel): MapPrep | null {
  const subject = { kind: 'team' as const, group: team };
  const brief = buildBrief(matches, map, subject, model3);
  if (!brief) return null;
  const own = matches.filter((m) => m.map === map && teamIn(m, subject) !== null).sort((a, b) => a.date - b.date);
  const views = allRoundViews(own, { map, subject });
  const tv = views.filter((v) => v.side === 't'), cv = views.filter((v) => v.side === 'ct');
  // Récents : les 3 derniers matchs (ou la moitié la plus récente s'il y en a peu)
  const recentIds = new Set(own.slice(-Math.max(1, Math.min(3, Math.floor(own.length / 2) || 1))).map((m) => m.id));
  const isRecent = (v: RoundView) => recentIds.has(v.match.id);
  const hasHistory = own.length - recentIds.size >= 2;
  const exclude = new Set(own.map((m) => `${m.id}:${teamIn(m, subject)}`));
  const base = baseline(matches, map, exclude);
  const ref = base.scope === 'map' ? tt('on average in your library') : base.scope === 'library' ? tt('on average in your library (all maps)') : tt('typical');
  const others = base.views, oT = others.filter((v) => v.side === 't'), oCT = others.filter((v) => v.side === 'ct');
  const findings: PrepFinding[] = [];
  const add = (f: Omit<PrepFinding, 'id'>) => findings.push({ ...f, id: `${f.side}-${findings.length}` });

  // --- Côté T : site de plant (préférence et nouveauté) ---
  const planted = tv.filter((v) => v.round.plantSite);
  if (planted.length >= 6) {
    const a = planted.filter((v) => v.round.plantSite === 'A');
    const site = a.length * 2 >= planted.length ? 'A' : 'B';
    const onSite = planted.filter((v) => v.round.plantSite === site);
    const p0 = base.scope === 'map' && base.plants >= 20 ? (site === 'A' ? base.plantA / base.plants : 1 - base.plantA / base.plants) : 0.5;
    const z = zScore(onSite.length, planted.length, p0);
    const recentShare = pct(onSite.filter(isRecent).length, planted.filter(isRecent).length);
    const oldPlanted = planted.filter((v) => !isRecent(v));
    const oldShare = pct(oldPlanted.filter((v) => v.round.plantSite === site).length, oldPlanted.length);
    if (z >= 1.5 || (pct(onSite.length, planted.length) >= 75 && base.scope !== 'map')) add({
      side: 't', text: tt('Plants {0} in {1}% of planted rounds', [site, pct(onSite.length, planted.length)]), sample: tt('{0}/{1} plants, {2} map{3}', [onSite.length, planted.length, mapsOf(planted), mapsOf(planted) === 1 ? '' : 's']),
      baseline: base.scope === 'map' && base.plants >= 20 ? `${Math.round(p0 * 100)}% ${ref}` : undefined, score: Math.abs(z) + onSite.length / 20,
      isNew: hasHistory && oldPlanted.length >= 3 && recentShare - oldShare >= 25,
      counter: tt('Lean your CT setup toward {0} (extra player or early rotation), and prepare retake utility for {1} rather than a full stack.', [site, site === 'A' ? 'B' : 'A']), rounds: refs(onSite),
    });
  }
  // --- Côté T : rythme (plant) ---
  const plantTs = planted.map((v) => v.round.plantT!).filter((x) => x != null);
  const tPlant = avg(plantTs);
  if (tPlant != null && plantTs.length >= 6 && base.plantT != null) {
    const diff = tPlant - base.plantT;
    if (Math.abs(diff) >= 8) add({
      side: 't', text: diff < 0 ? tt('Hits fast: average plant at {0}', [clock(tPlant)]) : tt('Plays slow: average plant at {0}', [clock(tPlant)]), sample: tt('{0} plants', [plantTs.length]),
      baseline: `${clock(base.plantT)} ${ref}`, score: Math.abs(diff) / 6 + plantTs.length / 25,
      counter: diff < 0 ? tt('Keep your utility for the first 30 seconds and avoid early solo peeks: they come in numbers early.') : tt('Expect late-round contact: take early map control and info with utility, and watch the clock for late executes.'),
      rounds: refs(planted.filter((v) => v.round.plantT != null && (diff < 0 ? v.round.plantT < base.plantT! : v.round.plantT > base.plantT!))),
    });
  }
  // --- Premier contact ---
  const tContacts = tv.map((v) => v.openingKill?.t).filter((x): x is number => x != null);
  const ctContacts = cv.map((v) => v.openingKill?.t).filter((x): x is number => x != null);
  const opens = brief.trends.openings.filter((x) => x.level !== 'oneoff');
  if (opens[0] && opens[0].rounds >= 5) {
    const o = opens[0];
    const share = o.rounds / Math.max(1, o.of);
    const oOpen = others.filter((v) => v.openingPlace);
    const p0 = oOpen.length >= 60 ? oOpen.filter((v) => v.openingPlace === o.key).length / oOpen.length : null;
    const z = p0 != null ? zScore(o.rounds, o.of, p0) : 0;
    const vs = views.filter((v) => v.openingPlace === o.key);
    const recentRate = pct(vs.filter(isRecent).length, views.filter(isRecent).length), oldRate = pct(vs.filter((v) => !isRecent(v)).length, views.filter((v) => !isRecent(v)).length);
    if (p0 != null ? z >= 1.5 && share - p0 >= 0.08 : share >= 0.35) add({
      side: 'all', text: tt('First contact often at {0} ({1}% of their rounds)', [placeLabel(o.key), Math.round(share * 100)]), sample: tt('{0}/{1} rounds, {2}/{3} maps', [o.rounds, o.of, o.maps, o.totalMaps]),
      baseline: p0 != null ? `${Math.round(p0 * 100)}% ${ref}` : undefined,
      score: p0 != null ? z : share * 4, isNew: hasHistory && recentRate - oldRate >= 20,
      counter: tt('Pre-aim and pre-place utility on {0} at round start; a flash for that duel decides many of their rounds.', [placeLabel(o.key)]), rounds: refs(vs),
    });
  }
  // --- Dépendance au premier duel : écart entre rounds avec et sans le premier kill, comparé à la
  // référence (un taux brut refléterait surtout le niveau de l'équipe : une équipe qui perd 13-1 perd tout).
  const S = brief.summary.all;
  const W = S.winWithOpening, L = S.winWithoutOpening;
  if (W.played >= 10 && L.played >= 10 && base.convert[1] >= 30 && base.noOpen[1] >= 30) {
    // Écart en log-odds : comparable entre une équipe qui gagne tout et une équipe moyenne
    const pw = Math.min(0.95, Math.max(0.05, W.won / W.played)), pl = Math.min(0.95, Math.max(0.05, L.won / L.played));
    const gap = W.won / W.played - L.won / L.played, gap0 = base.convert[0] / base.convert[1] - base.noOpen[0] / base.noOpen[1];
    const lg = logit(pw) - logit(pl), lg0 = logit(clamp(base.convert[0] / base.convert[1])) - logit(clamp(base.noOpen[0] / base.noOpen[1]));
    const z = (lg - lg0) / Math.sqrt(1 / (W.played * pw * (1 - pw)) + 1 / (L.played * pl * (1 - pl)));
    if (Math.abs(z) >= 2 && Math.abs(gap - gap0) >= 0.15) add({
      side: 'all', text: z > 0 ? tt('Live and die by the first kill: {0}% with it, {1}% without', [pct(W.won, W.played), pct(L.won, L.played)]) : tt('The opening duel matters less to them: {0}% with it, {1}% without', [pct(W.won, W.played), pct(L.won, L.played)]),
      sample: tt('{0} + {1} rounds', [W.played, L.played]), baseline: tt('gap of {0} points {1}', [Math.round(gap0 * 100), ref]), score: Math.abs(z),
      counter: z > 0 ? tt('Play for the first pick: info plays with a flash, an AWP on their usual first-contact spot. Once they are down a player, they rarely come back.') : tt('Winning the first duel is not enough: they trade and regroup well, so play the man advantage slowly and keep utility for the retake or the post-plant.'),
      rounds: refs(views.filter((v) => (z > 0 ? v.opening === false && !v.won : v.opening === false && v.won))),
    });
  }
  // --- Retakes / post-plant ---
  // Taux de rounds par côté, ramenés vers 50 % (12 rounds fictifs) : sur une ou deux cartes ils sont bruités
  const ctRate = (brief.ct.won + 6) / (brief.ct.played + 12), tRate = (brief.t.won + 6) / (brief.t.played + 12);
  if (brief.retakes.played >= 6 && base.retake[1] >= 20) {
    const exp = atLevel(base.retake[0] / base.retake[1], ctRate);
    const z = zScore(brief.retakes.won, brief.retakes.played, exp);
    if (Math.abs(z) >= 1.5) add({
      side: 'ct', text: z < 0 ? tt('Weak retakes: win {0}% once the bomb is down', [pct(brief.retakes.won, brief.retakes.played)]) : tt('Strong retakes: win {0}% once the bomb is down', [pct(brief.retakes.won, brief.retakes.played)]),
      sample: tt('{0}/{1} rounds', [brief.retakes.won, brief.retakes.played]), baseline: tt('{0}% expected given their CT results ({1}% {2})', [Math.round(exp * 100), pct(base.retake[0], base.retake[1]), ref]), score: Math.abs(z),
      counter: z < 0 ? tt('Get the plant at all costs and play the post-plant from safe crossfires: their retakes fall apart.') : tt('Avoid giving them a retake: take fights before the plant, or plant for the safe angles and save utility for the defuse.'),
      rounds: refs(cv.filter((v) => v.round.plantSite)),
    });
  }
  if (brief.postPlant.played >= 6 && base.postPlant[1] >= 20) {
    const exp = atLevel(base.postPlant[0] / base.postPlant[1], tRate);
    const z = zScore(brief.postPlant.won, brief.postPlant.played, exp);
    if (Math.abs(z) >= 1.5) add({
      side: 't', text: z > 0 ? tt('Strong post-plants: win {0}% after planting', [pct(brief.postPlant.won, brief.postPlant.played)]) : tt('Fragile post-plants: win {0}% after planting', [pct(brief.postPlant.won, brief.postPlant.played)]),
      sample: tt('{0}/{1} rounds', [brief.postPlant.won, brief.postPlant.played]), baseline: tt('{0}% expected given their T results ({1}% {2})', [Math.round(exp * 100), pct(base.postPlant[0], base.postPlant[1]), ref]), score: Math.abs(z),
      counter: z > 0 ? tt('Deny the plant: commit to the site earlier, and retake together with utility rather than one by one.') : tt('If they plant, retake: they give up post-plants more than most teams.'),
      rounds: refs(planted),
    });
  }
  // --- Économie après un pistol perdu ---
  const lost = brief.afterPistolLoss;
  if (lost.result.played >= 3 && base.forceAfterLoss[1] >= 10) {
    const force = lost.buys.force + lost.buys.full;
    const p0 = base.forceAfterLoss[0] / base.forceAfterLoss[1];
    const rate = force / lost.result.played;
    if (rate - p0 >= 0.3 || p0 - rate >= 0.3) add({
      side: 'all', text: rate > p0 ? tt('Force-buys after a lost pistol ({0}/{1})', [force, lost.result.played]) : tt('Saves after a lost pistol ({0}/{1})', [lost.buys.eco, lost.result.played]),
      sample: `${lost.result.played} lost pistols`, baseline: tt('{0}% of teams force ({1})', [Math.round(p0 * 100), ref]), score: Math.abs(rate - p0) * 4,
      counter: rate > p0 ? tt('Expect a force on round 2: armor and close angles, no lone peeks against their SMGs and deagles.') : tt('Round 2 is likely an eco: take space and economy-friendly fights, avoid giving them weapons.'),
      rounds: [],
    });
  }
  // --- Joueurs : AWP, ouvertures, rôles ---
  const cards = playerCards(own, team, brief);
  const awper = [...cards].sort((a, b) => b.awpShare - a.awpShare)[0];
  if (awper && awper.awpShare >= 25) {
    const duels = awper.openings[0] + awper.openings[1];
    add({
      side: 'all', text: tt('{0} {1} ({2}% of his kills){3}', [awper.name, awper.awpShare >= 40 ? tt('is their AWPer') : tt('often takes the AWP'), awper.awpShare, awper.awpSpots.length ? tt(', mostly from {0}', [awper.awpSpots.join(', ')]) : '']),
      sample: duels ? tt('{0}–{1} in opening duels', [awper.openings[0], awper.openings[1]]) : tt('rarely takes the opening duel'),
      score: Math.min(3, awper.awpShare / 20), counter: awper.awpSpots.length ? tt('Smoke or flash {0} before crossing, and punish his re-peeks with a trade setup.', [awper.awpSpots[0]]) : tt('Use utility to blind his angles before crossing.'), rounds: [],
    });
  }
  const entry = [...cards].sort((a, b) => b.openingShare - a.openingShare)[0];
  if (entry && entry.openingShare >= 30 && entry.openings[0] + entry.openings[1] >= 8) add({
    side: 'all', text: tt('{0} takes {1}% of their opening duels ({2}–{3})', [entry.name, entry.openingShare, entry.openings[0], entry.openings[1]]), sample: tt('{0} duels', [entry.openings[0] + entry.openings[1]]),
    score: Math.min(3, entry.openingShare / 15), counter: entry.openings[0] >= entry.openings[1] ? tt('Do not take his first duel dry: utility first, or bait him into a crossfire.') : tt('He loses his entries: hold your angles and trade, the round often opens in your favor.'), rounds: [],
  });
  for (const pl of brief.players) {
    const lurk = pl.hints.find((h) => h.role === 'Lurk');
    if (lurk && lurk.score >= 0.6) add({ side: 't', text: tt('{0} lurks: {1}', [pl.agg.name, lurk.evidence]), sample: '', score: 1 + lurk.score, counter: tt('Keep an eye on his flank late in rounds: a late rotation leaves his side open.'), rounds: [] });
  }
  // --- Côté CT : un setup quasi systématique ---
  if (oCT.length >= 40) {
    const lib = new Map(tendencies(oCT).setups.ct.map((x) => [x.key, x.rounds / Math.max(1, x.of)]));
    const spot = brief.trends.setups.ct
      .filter((x) => x.of >= 8 && x.rounds >= 6)
      .map((x) => ({ x, share: x.rounds / x.of, p0: lib.get(x.key) ?? 0 }))
      .map((o) => ({ ...o, z: zScore(o.x.rounds, o.x.of, Math.max(0.05, o.p0)) }))
      .filter((o) => o.z >= 2 && o.share >= 0.4 && o.share - o.p0 >= 0.25)
      .sort((a, b) => b.z - a.z)[0];
    if (spot) add({
      side: 'ct', text: tt('Someone holds {0} at 20 s in {1}% of CT rounds', [placeLabel(spot.x.key), Math.round(spot.share * 100)]), sample: tt('{0}/{1} rounds', [spot.x.rounds, spot.x.of]),
      baseline: `${Math.round(spot.p0 * 100)}% ${ref}`, score: spot.z,
      counter: tt('Clear {0} with utility (or avoid it) in your executes: they hold it far more than other teams.', [placeLabel(spot.x.key)]), rounds: [],
    });
  }
  // --- Stratégies récentes (nouvelles) ---
  const strategies = { t: detectStrategies(tv, 't'), ct: detectStrategies(cv, 'ct') };
  if (hasHistory) for (const s of strategies.t) {
    const recentRounds = s.rounds.filter(isRecent).length;
    if (s.rounds.length >= 5 && s.site && new Set(s.rounds.filter(isRecent).map((r) => r.match.id)).size >= 2 && recentRounds / s.rounds.length >= 0.8) add({
      side: 't', text: tt('New T plan: {0}', [s.name]), sample: tt('{0} rounds, {1} won', [s.rounds.length, s.won]), score: 1 + s.rounds.length / 5, isNew: true,
      counter: s.site ? tt('Prepare for it on {0}: watch these rounds and agree on who rotates.', [s.site]) : tt('Watch these rounds and agree on how to read it early.'), rounds: refs(s.rounds),
    });
  }
  // Grenades T récurrentes, comptées en rounds distincts (un joueur peut relancer la même grenade dans
  // un round) et comparées aux autres équipes ; les deux plus marquantes parmi leurs 6 plus lancées.
  const seenTo = new Set<string>();
  const nadeFindings: Omit<PrepFinding, 'id'>[] = [];
  for (const lu of brief.lineups.t.filter((l) => l.toPlace).slice(0, 6)) {
    if (seenTo.has(`${lu.kind}:${lu.toPlace}`)) continue;
    seenTo.add(`${lu.kind}:${lu.toPlace}`);
    const rs = [...new Map(lu.throws.map((t) => [`${t.match.id}:${t.nade.r}`, { matchId: t.match.id, round: t.nade.r }])).values()];
    const share = rs.length / Math.max(1, tv.length);
    const to = placeLabel(lu.toPlace), from = placeLabel(lu.fromPlace);
    const kind = lu.kind;
    let p0: number | null = null;
    if (oT.length >= 40) {
      let hit = 0;
      for (const v of oT) {
        const sp = v.match.spatial!, places = sp.places ?? [];
        // même grenade sur le même callout, d'où qu'elle parte : « les autres équipes smokent-elles aussi Connector ? »
        if (sp.nades.some((n) => n.r === v.round.i && n.team === v.team && n.kind === lu.kind && n.lp != null && places[n.lp] === lu.toPlace)) hit++;
      }
      p0 = hit / oT.length;
    }
    if (rs.length >= 4 && (p0 != null ? share - p0 >= 0.25 && share >= 1.8 * p0 && zScore(rs.length, tv.length, Math.max(0.05, p0)) >= 2 : share >= 0.3)) nadeFindings.push({
      side: 't', text: from && from !== to ? tt('Recurring {0} on {1}, thrown from {2}', [kind, to, from]) : tt('Recurring {0} on {1}', [kind, to]),
      sample: tt('{0}/{1} T rounds, {2} map{3}', [rs.length, tv.length, lu.maps, lu.maps === 1 ? '' : 's']), baseline: p0 != null ? tt('{0}% of T rounds for other teams (a {1} on {2} from anywhere)', [Math.round(p0 * 100), kind, to]) : undefined, score: 1 + (share - (p0 ?? 0)) * 4,
      counter: tt('Expect it and play around it: hold another angle when it lands, or punish the thrower{0}.', [from ? tt(' at {0}', [from]) : '']), rounds: rs,
    });
  }
  nadeFindings.sort((x, y) => y.score - x.score).slice(0, 2).forEach(add);

  // Une tendance récente compte un peu plus, sans passer devant un constat bien plus solide
  findings.sort((a, b) => b.score + (b.isNew ? 0.75 : 0) - (a.score + (a.isNew ? 0.75 : 0)));
  return {
    map, brief, matches: own.length, recentMatches: recentIds.size,
    economy: { t: economyRows(tv), ct: economyRows(cv) },
    timings: { tContact: avg(tContacts), ctContact: avg(ctContacts), plant: tPlant, base: { tContact: base.tContact, plant: base.plantT } },
    strategies, players: cards, findings,
  };
}

/** Prépa complète en Markdown (Discord, Notion, document d'équipe). */
export function prepMarkdown(o: Overview, maps: MapPrep[], notes: Record<string, string>, mapName: (m: string) => string): string {
  const L: string[] = [tt('# Match prep: {0}', [o.team.name]), ''];
  if (o.form.length) L.push(tt('**Recent form:** {0}', [o.form.slice(0, 5).map((f) => `${f.us > f.them ? 'W' : f.us < f.them ? 'L' : 'D'} ${f.us}-${f.them} ${mapName(f.map)}`).join(' · ')]), '');
  L.push(tt('## Map pool'), tt('| Map | Them | Us | Edge |'), '|---|---|---|---|');
  for (const r of o.maps) L.push(`| ${mapName(r.map)} | ${r.them ? `${r.them.wins}-${r.them.matches - r.them.wins - r.them.ties}${r.them.ties ? `-${r.them.ties}` : ''} (${Math.round(r.them.strength * 100)}%)` : 'never'} | ${r.us ? `${r.us.wins}-${r.us.matches - r.us.wins - r.us.ties} (${Math.round(r.us.strength * 100)}%)` : '—'} | ${r.edge >= 0 ? '+' : ''}${Math.round(r.edge * 100)} |`);
  if (o.veto) L.push('', tt('**Suggested BO3 veto:** {0}', [o.veto.bo3.map((s) => `${s.team ?? ''} ${s.action} ${mapName(s.map)}`.trim()).join(', ')]));
  for (const p of maps) {
    L.push('', tt('## {0} ({1} map{2})', [mapName(p.map), p.matches, p.matches === 1 ? '' : 's']));
    for (const f of p.findings.slice(0, 10)) L.push(`- ${f.isNew ? '**NEW** ' : ''}${f.text}${f.sample ? ` (${f.sample}${f.baseline ? `; ${f.baseline}` : ''})` : ''}  \n  → ${f.counter}`);
    const t = p.economy.t.find((r) => r.buy === 'full');
    if (t) L.push(tt('- Full buys on T: plants A {0} / B {1}{2}', [t.plantA, t.plantB, t.spots.length ? `, at 20 s: ${t.spots.map((s) => `${s.place} ${s.share}%`).join(', ')}` : '']));
    if (notes[p.map]?.trim()) L.push('', tt('**Our plan:** {0}', [notes[p.map].trim()]));
  }
  L.push('', tt('_Made with Celeste CS2 from local demos._'));
  return L.join('\n');
}
