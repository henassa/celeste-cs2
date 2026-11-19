// Statistiques par joueur sur un match (ou un seul côté) et ratings.
// Fonction pure, testée contre le scoreboard du jeu présent dans les démos.

import { FLAG_ALIVE, SAMPLE_STEP, SIDE_CT, SIDE_T, type GrenadeKind, type MatchData, type Side } from '../data/types';
import { winProbabilityT } from './win-probability';

export type SideFilter = 'all' | 'ct' | 't';

/** Fenêtre de trade (HLTV et la plupart des outils : 5 secondes). */
export const TRADE_WINDOW_SEC = 5;
/** Flash comptée comme « ennemi flashé » au-delà de cette durée (seuil calé sur le compteur du jeu, 2 démos). */
export const FLASH_MIN_SEC = 1.5;

const UTILITY_WEAPONS = new Set(['hegrenade', 'inferno', 'molotov', 'incgrenade']);

export interface PlayerStats {
  player: number;
  name: string;
  team: 0 | 1;
  rounds: number;
  kills: number;
  deaths: number;
  assists: number;
  flashAssists: number;
  headshots: number;
  teamKills: number;
  damage: number;
  utilityDamage: number;
  survived: number;
  kastRounds: number;
  entryKills: number;
  entryDeaths: number;
  tradeKills: number;
  tradedDeaths: number;
  /** clutches[n] = { attempts, wins } en 1vN (n = 1..5). */
  clutches: { attempts: number; wins: number }[];
  /** multi[n] = nombre de rounds à n kills (n = 1..5). */
  multi: number[];
  enemiesFlashed: number;
  blindTime: number;
  teamFlashed: number;
  thrown: Record<GrenadeKind, number>;
  /** Somme des variations de probabilité de victoire (0..1 par round). */
  swingSum: number;
  /** Kills et dégâts pondérés par l'écart d'équipement (ajustement éco, principe de HLTV 3.0). */
  ecoKills: number;
  ecoDamage: number;
  // Dérivés
  adr: number;
  kast: number;
  hsPct: number;
  kpr: number;
  dpr: number;
  apr: number;
  /** Round Swing moyen, en points de % par round. */
  swing: number;
  ecoKpr: number;
  ecoAdr: number;
  impact: number;
  rating1: number;
  rating2: number;
}

function emptyStats(m: MatchData, p: number): PlayerStats {
  return {
    player: p, name: m.players[p].name, team: m.players[p].team, rounds: 0,
    kills: 0, deaths: 0, assists: 0, flashAssists: 0, headshots: 0, teamKills: 0, damage: 0, utilityDamage: 0,
    survived: 0, kastRounds: 0, entryKills: 0, entryDeaths: 0, tradeKills: 0, tradedDeaths: 0,
    clutches: Array.from({ length: 6 }, () => ({ attempts: 0, wins: 0 })), multi: [0, 0, 0, 0, 0, 0],
    enemiesFlashed: 0, blindTime: 0, teamFlashed: 0,
    thrown: { smoke: 0, flash: 0, he: 0, molotov: 0, decoy: 0 }, swingSum: 0, ecoKills: 0, ecoDamage: 0,
    adr: 0, kast: 0, hsPct: 0, kpr: 0, dpr: 0, apr: 0, swing: 0, ecoKpr: 0, ecoAdr: 0, impact: 0, rating1: 0, rating2: 0,
  };
}

/**
 * HLTV Rating 1.0 (formule publique, 2010) :
 * (KillRating + 0,7 × SurvivalRating + MultiKillRating) / 2,7
 * avec des moyennes de référence KPR 0,679, survie 0,317, multi-kill 1,277.
 */
export function hltvRating1(s: Pick<PlayerStats, 'rounds' | 'kills' | 'deaths' | 'multi'>): number {
  if (!s.rounds) return 0;
  const killRating = s.kills / s.rounds / 0.679;
  const survivalRating = (s.rounds - s.deaths) / s.rounds / 0.317;
  const mk = s.multi[1] + 4 * s.multi[2] + 9 * s.multi[3] + 16 * s.multi[4] + 25 * s.multi[5];
  const multiRating = mk / s.rounds / 1.277;
  return (killRating + 0.7 * survivalRating + multiRating) / 2.7;
}

/**
 * HLTV Rating 2.0 : formule non publiée par HLTV. Approximation communautaire (régression,
 * reprise notamment par awpy) : 0,0073·KAST + 0,3591·KPR − 0,5329·DPR + 0,2372·Impact + 0,0032·ADR + 0,1587,
 * avec Impact ≈ 2,13·KPR + 0,42·APR − 0,41.
 */
export function hltvImpact(kpr: number, apr: number): number {
  return 2.13 * kpr + 0.42 * apr - 0.41;
}
export function hltvRating2(kastPct: number, kpr: number, dpr: number, impact: number, adr: number): number {
  return 0.0073 * kastPct + 0.3591 * kpr - 0.5329 * dpr + 0.2372 * impact + 0.0032 * adr + 0.1587;
}

/**
 * Ajustement éco : un kill (ou des dégâts) contre un adversaire mieux équipé vaut plus,
 * contre un adversaire moins équipé vaut moins. Racine du rapport d'équipement, bornée.
 */
export function ecoWeight(victimEquip: number, attackerEquip: number): number {
  const w = Math.sqrt((victimEquip + 400) / (attackerEquip + 400));
  return Math.max(0.5, Math.min(1.6, w));
}

export function computeStats(m: MatchData, filter: SideFilter = 'all'): PlayerStats[] {
  const P = m.players.length;
  const stats = Array.from({ length: P }, (_, p) => emptyStats(m, p));
  const tr = m.tickrate;
  const tradeTicks = TRADE_WINDOW_SEC * tr;
  const fr = m.frames;
  const frameAt = (tick: number) => Math.max(0, Math.min(fr.count - 1, Math.round(tick / SAMPLE_STEP)));

  // Index des événements par round
  const byRound = <T extends { round: number }>(list: T[]) => {
    const out: T[][] = m.rounds.map(() => []);
    for (const e of list) if (e.round >= 0 && out[e.round]) out[e.round].push(e);
    return out;
  };
  const killsByRound = byRound(m.kills);
  const hurtsByRound = byRound(m.hurts);
  const grenadesByRound = byRound(m.grenades);

  for (const r of m.rounds) {
    const ri = r.index;
    const sideOfTeam = (team: 0 | 1): Side => (team === r.ctTeam ? SIDE_CT : SIDE_T);
    const sideOf = (p: number): Side => sideOfTeam(m.players[p].team);
    const counts = (p: number) => filter === 'all' || (filter === 'ct' ? sideOf(p) === SIDE_CT : sideOf(p) === SIDE_T);

    // Effectif : joueurs présents dans une équipe à la fin du freeze time
    const f0 = frameAt(r.freezeEndTick + 32);
    const roster: number[] = [];
    const alive = new Set<number>();
    for (let p = 0; p < P; p++) {
      const j = f0 * P + p;
      const side = fr.side[j];
      if (!fr.present[j] || (side !== SIDE_T && side !== SIDE_CT)) continue;
      roster.push(p);
      if (fr.flags[j] & FLAG_ALIVE) alive.add(p);
    }
    for (const p of roster) if (counts(p)) stats[p].rounds++;

    // Après la fin officielle du dernier round (fin du match), plus rien ne compte (suicides post-match...)
    const isLast = ri === m.rounds.length - 1;
    const kills = killsByRound[ri].filter((k) => !isLast || k.tick <= r.officialEndTick);
    const roundKills = new Map<number, number>();
    const didKill = new Set<number>(), didAssist = new Set<number>(), died = new Set<number>(), traded = new Set<number>();
    const deathTick = new Map<number, number>();

    const equipOf = (p: number, tick: number) => fr.equip[frameAt(tick - SAMPLE_STEP) * P + p];
    const state = (tick: number, planted: boolean) => {
      let aliveT = 0, aliveCT = 0, equipT = 0, equipCT = 0;
      for (const p of alive) {
        if (sideOf(p) === SIDE_T) { aliveT++; equipT += equipOf(p, tick); } else { aliveCT++; equipCT += equipOf(p, tick); }
      }
      const timeLeft = 115 - (tick - r.freezeEndTick) / tr;
      return { aliveT, aliveCT, equipT, equipCT, bombPlanted: planted, timeLeft };
    };
    const pTeam = (pT: number, side: Side) => (side === SIDE_T ? pT : 1 - pT);
    const plantTick = r.plant?.tick ?? Infinity;
    const addSwing = (p: number, v: number) => { if (p >= 0 && counts(p)) stats[p].swingSum += v; };

    let entryDone = false;
    const clutchOf = new Map<0 | 1, { player: number; vs: number }>();
    let plantSwingDone = false;

    const checkClutch = () => {
      for (const team of [0, 1] as const) {
        if (clutchOf.has(team)) continue;
        const mine = [...alive].filter((p) => m.players[p].team === team);
        const theirs = [...alive].filter((p) => m.players[p].team !== team);
        if (mine.length === 1 && theirs.length >= 1) clutchOf.set(team, { player: mine[0], vs: Math.min(5, theirs.length) });
      }
    };

    for (let i = 0; i < kills.length; i++) {
      const k = kills[i];
      // Swing de la bombe posée avant ce kill
      if (!plantSwingDone && r.plant && plantTick <= k.tick) {
        const before = winProbabilityT(state(plantTick, false));
        const after = winProbabilityT(state(plantTick, true));
        addSwing(r.plant.player, after - before);
        plantSwingDone = true;
      }
      if (k.tick <= r.freezeEndTick + 32) {
        // Mort pendant le freeze time : comptée, mais le joueur peut réapparaître (vivant à la fin du freeze)
        if (counts(k.victim)) stats[k.victim].deaths++;
        if (!alive.has(k.victim)) { died.add(k.victim); deathTick.set(k.victim, k.tick); }
        continue;
      }
      const planted = plantTick <= k.tick;
      // Prise de contrôle d'un bot : un joueur déjà mort dans ce round qui tue ou meurt agit en tant que bot.
      // Le scoreboard du jeu crédite le bot, pas le joueur : on fait pareil.
      const victimIsBot = died.has(k.victim);
      // (une grenade peut tuer après la mort de son lanceur : ce n'est pas un bot)
      const killerIsBot = k.killer >= 0 && died.has(k.killer) && !UTILITY_WEAPONS.has(k.weapon);
      const validKill = k.killer >= 0 && !killerIsBot && k.killer !== k.victim && m.players[k.killer]?.team !== m.players[k.victim]?.team;
      const pBefore = winProbabilityT(state(k.tick, planted));
      const wasAlive = alive.has(k.victim);
      alive.delete(k.victim);
      const pAfter = winProbabilityT(state(k.tick, planted));
      const victimSide = sideOf(k.victim);
      // Swing : le tueur gagne ce que l'équipe de la victime perd (partagé avec l'assistant)
      const delta = pTeam(pBefore, victimSide) - pTeam(pAfter, victimSide);
      if (wasAlive) {
        addSwing(k.victim, -delta);
        if (validKill) {
          const share = k.assister >= 0 ? 0.8 : 1;
          addSwing(k.killer, delta * share);
          if (k.assister >= 0) addSwing(k.assister, delta * (1 - share));
        }
      }

      if (!victimIsBot) {
        died.add(k.victim);
        deathTick.set(k.victim, k.tick);
        if (counts(k.victim)) stats[k.victim].deaths++;
      }
      if (k.killer >= 0 && k.killer !== k.victim && !validKill && counts(k.killer)) stats[k.killer].teamKills++;
      if (validKill) {
        didKill.add(k.killer);
        roundKills.set(k.killer, (roundKills.get(k.killer) ?? 0) + 1);
        if (counts(k.killer)) {
          stats[k.killer].kills++;
          stats[k.killer].ecoKills += ecoWeight(equipOf(k.victim, k.tick), equipOf(k.killer, k.tick));
          if (k.headshot) stats[k.killer].headshots++;
        }
        if (!entryDone) {
          entryDone = true;
          if (counts(k.killer)) stats[k.killer].entryKills++;
          if (counts(k.victim)) stats[k.victim].entryDeaths++;
        }
        // Trade : la victime avait tué un coéquipier du tueur dans les 5 s
        for (let j = i - 1; j >= 0; j--) {
          const e = kills[j];
          if (k.tick - e.tick > tradeTicks) break;
          if (e.killer === k.victim && m.players[e.victim]?.team === m.players[k.killer].team) {
            if (counts(k.killer)) stats[k.killer].tradeKills++;
            if (!traded.has(e.victim)) { traded.add(e.victim); if (counts(e.victim)) stats[e.victim].tradedDeaths++; }
            break;
          }
        }
      }
      if (k.assister >= 0 && k.assister !== k.victim && m.players[k.assister]?.team !== m.players[k.victim]?.team) {
        didAssist.add(k.assister);
        if (counts(k.assister)) {
          stats[k.assister].assists++;
          if (k.flashAssist) stats[k.assister].flashAssists++;
        }
      }
      checkClutch();
    }
    if (!plantSwingDone && r.plant) {
      const before = winProbabilityT(state(plantTick, false));
      addSwing(r.plant.player, winProbabilityT(state(plantTick, true)) - before);
    }
    // Défuse : le défuseur récupère la probabilité restante des T
    if (r.defuseTick) {
      const defuser = m.bombEvents.find((b) => b.type === 'defuse' && b.tick === r.defuseTick)?.player ?? -1;
      addSwing(defuser, winProbabilityT(state(r.defuseTick, true)));
    }

    // Clutchs
    for (const [team, c] of clutchOf) {
      if (!counts(c.player)) continue;
      stats[c.player].clutches[c.vs].attempts++;
      if (r.winnerTeam === team) stats[c.player].clutches[c.vs].wins++;
    }

    // Survie, KAST, multi-kills
    for (const p of roster) {
      if (!counts(p)) continue;
      const survived = !died.has(p);
      if (survived) stats[p].survived++;
      if (didKill.has(p) || didAssist.has(p) || survived || traded.has(p)) stats[p].kastRounds++;
      const n = Math.min(5, roundKills.get(p) ?? 0);
      if (n > 0) stats[p].multi[n]++;
    }

    // Dégâts (plafonnés aux PV restants de la victime, comme le scoreboard du jeu)
    const hp = new Map<number, number>();
    const roundDamage = new Map<number, number>();
    for (const h of hurtsByRound[ri]) {
      if (isLast && h.tick > r.officialEndTick) continue;
      // Victime déjà morte = bot contrôlé par ce joueur : nouvelle vie (PV pleins)
      let prev = hp.get(h.victim) ?? 100;
      if (prev <= 0) prev = 100;
      const dealt = Math.max(0, Math.min(h.dmgHealth, prev));
      hp.set(h.victim, h.healthAfter);
      if (h.attacker < 0 || h.attacker === h.victim) continue;
      // Attaquant mort avant ce tir = c'est le bot qu'il contrôle qui tire
      if ((deathTick.get(h.attacker) ?? Infinity) < h.tick && !UTILITY_WEAPONS.has(h.weapon)) continue;
      if (m.players[h.attacker]?.team === m.players[h.victim]?.team) continue;
      roundDamage.set(h.attacker, (roundDamage.get(h.attacker) ?? 0) + dealt);
      if (!counts(h.attacker)) continue;
      stats[h.attacker].damage += dealt;
      stats[h.attacker].ecoDamage += dealt * ecoWeight(equipOf(h.victim, h.tick), equipOf(h.attacker, h.tick));
      if (UTILITY_WEAPONS.has(h.weapon)) stats[h.attacker].utilityDamage += dealt;
    }

    // Fin de round : la part de victoire restante (ou perdue) est répartie dans chaque équipe
    // selon la contribution (dégâts du round), comme le fait HLTV pour Round Swing.
    {
      const planted = r.plant != null && (r.explodeTick != null || r.defuseTick != null || plantTick <= r.endTick);
      const pFinalT = r.defuseTick ? 0 : winProbabilityT(state(r.endTick, planted));
      for (const team of [0, 1] as const) {
        const side = sideOfTeam(team);
        const residual = (r.winnerTeam === team ? 1 : 0) - pTeam(pFinalT, side);
        const members = roster.filter((p) => m.players[p].team === team);
        const weights = members.map((p) => (roundDamage.get(p) ?? 0) + 25);
        const total = weights.reduce((a, b) => a + b, 0) || 1;
        members.forEach((p, i) => addSwing(p, (residual * weights[i]) / total));
      }
    }

    // Utilitaires lancés
    for (const g of grenadesByRound[ri]) if (g.thrower >= 0 && counts(g.thrower)) stats[g.thrower].thrown[g.kind]++;
  }

  // Flashs (événements hors index de round : on filtre par tick)
  for (const b of m.blinds) {
    if (b.attacker < 0 || b.attacker === b.victim) continue;
    const ri = m.rounds.findIndex((r) => b.tick >= r.startTick && b.tick <= r.officialEndTick);
    if (ri < 0) continue;
    const r = m.rounds[ri];
    const side = m.players[b.attacker].team === r.ctTeam ? SIDE_CT : SIDE_T;
    if (filter !== 'all' && (filter === 'ct') !== (side === SIDE_CT)) continue;
    const s = stats[b.attacker];
    if (m.players[b.attacker].team === m.players[b.victim]?.team) { s.teamFlashed++; continue; }
    if (b.duration > FLASH_MIN_SEC) { s.enemiesFlashed++; s.blindTime += b.duration; }
  }

  for (const s of stats) {
    const R = s.rounds || 1;
    s.adr = s.damage / R;
    s.kast = (s.kastRounds / R) * 100;
    s.hsPct = s.kills ? (s.headshots / s.kills) * 100 : 0;
    s.kpr = s.kills / R;
    s.dpr = s.deaths / R;
    s.apr = s.assists / R;
    s.swing = (s.swingSum / R) * 100;
    s.ecoKpr = s.ecoKills / R;
    s.ecoAdr = s.ecoDamage / R;
    s.impact = hltvImpact(s.kpr, s.apr);
    s.rating1 = hltvRating1(s);
    s.rating2 = s.rounds ? hltvRating2(s.kast, s.kpr, s.dpr, s.impact, s.adr) : 0;
  }
  return stats.filter((s) => s.rounds > 0);
}
