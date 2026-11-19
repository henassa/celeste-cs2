// Moments clés détectés automatiquement : clutchs, multi-kills, kills décisifs, rounds perdus en
// supériorité numérique, rounds gagnés en infériorité économique, tirs alliés, défuses sous pression.
// Chaque moment pointe vers un tick : un clic relance le replay quelques secondes avant.

import { FLAG_ALIVE, SAMPLE_STEP, type MatchData, type TeamIndex } from '../data/types';
import { buildSpatial, type BuyType, type MatchSpatial } from '../library/spatial';
import { roundSwings, type WpModel } from './wp-model';
import { tt } from '../i18n';

export type MomentKind = 'clutch' | 'multikill' | 'swing' | 'collapse' | 'eco' | 'teamkill' | 'defuse';

export interface Moment {
  kind: MomentKind;
  round: number;
  tick: number;
  title: string;
  /** Joueurs concernés (index). */
  players: number[];
  team: TeamIndex | null;
  /** Importance (0..1) pour le tri et le filtre. */
  weight: number;
}

export const MOMENT_LABEL: Record<MomentKind, string> = {
  clutch: tt('Clutch'), multikill: tt('Multi-kill'), swing: tt('Big swing'), collapse: tt('Lost advantage'),
  eco: tt('Eco win'), teamkill: tt('Team kill'), defuse: tt('Defuse'),
};

const STRONG: Record<BuyType, number> = { pistol: 1, eco: 0, force: 1, full: 2 };

export function detectMoments(m: MatchData, wp: Pick<WpModel, 'coef' | 'intercept'> | null, sp: MatchSpatial = buildSpatial(m)): Moment[] {
  const out: Moment[] = [];
  const swings: Moment[] = [];
  const tr = m.tickrate;
  const name = (p: number) => m.players[p]?.name ?? '?';
  const teamName = (t: number) => m.teams[t]?.name ?? '?';
  for (const r of sp.rounds) {
    const info = m.rounds[r.i];
    if (!info) continue;
    const tickAt = (t: number) => Math.round(info.freezeEndTick + t * tr);
    const kills = sp.kills.filter((k) => k.r === r.i && k.t >= 0 && (r.endT == null || k.t <= r.endT)).sort((a, b) => a.t - b.t);
    const alive: [number, number] = r.alive ? [r.alive[0], r.alive[1]] : [5, 5];
    let clutch: { team: TeamIndex; vs: number; t: number; player: number } | null = null;
    let bestLead: { team: TeamIndex; lead: number; t: number } | null = null;
    for (const k of kills) {
      alive[k.vt] = Math.max(0, alive[k.vt] - 1);
      for (const team of [0, 1] as TeamIndex[]) {
        const other = (1 - team) as TeamIndex;
        if (!clutch && alive[team] === 1 && alive[other] >= 2) {
          // Dernier joueur en vie de l'équipe, lu dans les frames juste après le kill
          const f = Math.min(m.frames.count - 1, Math.round((tickAt(k.t) + 8) / SAMPLE_STEP));
          const P = m.players.length;
          const last = m.players.findIndex((p, i) => p.team === team && m.frames.present[f * P + i] === 1 && (m.frames.flags[f * P + i] & FLAG_ALIVE) !== 0);
          clutch = { team, vs: alive[other], t: k.t, player: last };
        }
        const lead = alive[team] - alive[other];
        if (alive[other] > 0 && lead >= 2 && (!bestLead || lead > bestLead.lead)) bestLead = { team, lead, t: k.t };
      }
      if (k.kt >= 0 && k.kt === k.vt && k.k !== k.v) {
        out.push({ kind: 'teamkill', round: r.i, tick: tickAt(k.t), title: `${name(k.k)} killed teammate ${name(k.v)}`, players: [k.k, k.v], team: k.kt as TeamIndex, weight: 0.4 });
      }
    }
    if (clutch && r.winner === clutch.team && clutch.player >= 0) {
      out.push({ kind: 'clutch', round: r.i, tick: tickAt(clutch.t), title: `1v${clutch.vs} clutch won by ${name(clutch.player)}`, players: [clutch.player], team: clutch.team, weight: 0.6 + 0.1 * clutch.vs });
    }
    if (bestLead && r.winner !== null && r.winner !== bestLead.team) {
      const lead = bestLead.lead;
      out.push({ kind: 'collapse', round: r.i, tick: tickAt(bestLead.t), title: `${teamName(bestLead.team)} lost the round after being ${lead} players up`, players: [], team: bestLead.team, weight: 0.45 + 0.1 * lead });
    }
    // Multi-kills : 4K et as
    const byKiller = new Map<number, number[]>();
    for (const k of kills) if (k.kt >= 0 && k.kt !== k.vt) { const a = byKiller.get(k.k) ?? []; a.push(k.t); byKiller.set(k.k, a); }
    for (const [p, ts] of byKiller) {
      if (ts.length >= 4) out.push({ kind: 'multikill', round: r.i, tick: tickAt(ts[0]), title: `${ts.length === 5 ? tt('Ace') : '4K'} by ${name(p)}${ts[ts.length - 1] - ts[0] < 10 ? ` in ${Math.max(1, Math.round(ts[ts.length - 1] - ts[0]))} s` : ''}`, players: [p], team: m.players[p]?.team ?? null, weight: ts.length === 5 ? 0.95 : 0.7 });
    }
    // Victoire avec un achat plus faible (hors pistols)
    if (r.winner !== null && r.buy[0] !== 'pistol') {
      const w = r.winner, l = (1 - w) as TeamIndex;
      if (STRONG[r.buy[w]] < STRONG[r.buy[l]]) out.push({ kind: 'eco', round: r.i, tick: info.freezeEndTick, title: `${teamName(w)} won on a ${r.buy[w]} against a ${r.buy[l]} buy`, players: [], team: w, weight: 0.5 });
    }
    // Défuse avec des T encore en vie
    if (r.defuseT != null && r.defuser != null && r.defuser >= 0) {
      const tTeam = 1 - r.ctTeam;
      const tAlive = (r.alive?.[tTeam] ?? 5) - kills.filter((k) => k.vt === tTeam && k.t <= r.defuseT!).length;
      if (tAlive > 0) out.push({ kind: 'defuse', round: r.i, tick: tickAt(Math.max(0, r.defuseT - 6)), title: tt('{0} defused with {1} T alive', [name(r.defuser), tAlive]), players: [r.defuser], team: m.players[r.defuser]?.team ?? null, weight: 0.5 + 0.05 * tAlive });
    }
    // Le kill le plus décisif du round, s'il fait bouger la probabilité d'au moins 30 points
    let best: Moment | null = null, bestGain = 0;
    for (const s of roundSwings(sp, r.i, wp)) {
      if (!s.kill || s.kill.kt < 0 || s.kill.kt === s.kill.vt) continue;
      const gain = s.kill.kt === 1 - r.ctTeam ? s.dT : -s.dT;
      if (gain >= 0.3 && gain > bestGain) {
        bestGain = gain;
        best = { kind: 'swing', round: r.i, tick: tickAt(s.kill.t), title: tt('{0} kills {1}: +{2}% for {3}', [name(s.kill.k), name(s.kill.v), Math.round(gain * 100), teamName(s.kill.kt)]), players: [s.kill.k], team: s.kill.kt as TeamIndex, weight: Math.min(0.9, gain * 1.5) };
      }
    }
    if (best) swings.push(best);
  }
  // Au plus 10 kills décisifs par match, les plus forts
  out.push(...swings.sort((a, b) => b.weight - a.weight).slice(0, 10));
  return out.sort((a, b) => a.round - b.round || a.tick - b.tick);
}
