// Rôles des joueurs déduits des démos, chacun avec sa preuve chiffrée :
// AWP, entry, lurk (côté T, loin de l'équipe), ancre (côté CT, toujours au même endroit),
// soutien (flashs, passes), trade (venge ses coéquipiers). Indices, pas vérités.

import type { LibraryMatch } from '../library/library';
import type { TeamIdx } from '../library/spatial';
import { placeLabel } from '../viewer/places';
import { tt } from '../i18n';

export interface RoleHint { role: 'AWP' | 'Entry' | 'Lurk' | 'Anchor' | 'Support' | 'Trader'; evidence: string; score: number }

interface Acc {
  name: string; rounds: number; tRounds: number; ctRounds: number;
  kills: number; awpKills: number; openings: number; flashes: number; flashAssists: number; trades: number;
  farAt30: number; tPos30: number; ctPlaces: Map<string, number>; ctPos20: number;
}

/**
 * Rôles par joueur (clé SteamID) pour une équipe : `teamOf(m)` donne l'index de l'équipe dans
 * chaque match (null = match ignoré).
 */
export function playerRoles(matches: LibraryMatch[], teamOf: (m: LibraryMatch) => TeamIdx | null): Map<string, RoleHint[]> {
  const acc = new Map<string, Acc>();
  let teamOpenings = 0;
  const get = (m: LibraryMatch, p: number): Acc | null => {
    const sid = m.players[p]?.steamid;
    if (!sid) return null;
    let a = acc.get(sid);
    if (!a) acc.set(sid, (a = { name: m.players[p].name, rounds: 0, tRounds: 0, ctRounds: 0, kills: 0, awpKills: 0, openings: 0, flashes: 0, flashAssists: 0, trades: 0, farAt30: 0, tPos30: 0, ctPlaces: new Map(), ctPos20: 0 }));
    return a;
  };
  for (const m of matches) {
    const me = teamOf(m);
    const sp = m.spatial;
    if (me === null || !sp) continue;
    for (const s of m.stats.all) {
      if (m.players[s.player]?.team !== me) continue;
      const a = get(m, s.player);
      if (!a) continue;
      a.rounds += s.rounds;
      a.openings += s.entryKills + s.entryDeaths;
      teamOpenings += s.entryKills + s.entryDeaths;
      a.flashAssists += s.flashAssists;
      a.trades += s.tradeKills;
      a.kills += s.kills;
    }
    for (const r of sp.rounds) {
      const isCt = r.ctTeam === me;
      for (const p of m.players.keys()) {
        if (m.players[p].team !== me) continue;
        const a = get(m, p);
        if (a) { if (isCt) a.ctRounds++; else a.tRounds++; }
      }
      // Positions : à 30 s côté T (distance aux coéquipiers), à 20 s côté CT (callout)
      const pos30 = sp.pos.filter((q) => q.r === r.i && q.s === 30 && q.team === me);
      if (!isCt) {
        for (const q of pos30) {
          const others = pos30.filter((o) => o.p !== q.p);
          if (others.length < 2) continue;
          const nearest = Math.min(...others.map((o) => Math.hypot(o.x - q.x, o.y - q.y)));
          const a = get(m, q.p);
          if (!a) continue;
          a.tPos30++;
          if (nearest > 1000) a.farAt30++;
        }
      } else {
        for (const q of sp.pos.filter((x) => x.r === r.i && x.s === 20 && x.team === me)) {
          const place = q.pl != null && q.pl >= 0 ? sp.places?.[q.pl] ?? '' : '';
          const a = get(m, q.p);
          if (!a || !place) continue;
          a.ctPos20++;
          a.ctPlaces.set(place, (a.ctPlaces.get(place) ?? 0) + 1);
        }
      }
    }
    for (const k of sp.kills) if (k.kt === me && k.w.includes('awp')) { const a = get(m, k.k); if (a) a.awpKills++; }
    for (const n of sp.nades) if (n.team === me && n.kind === 'flash') { const a = get(m, n.p); if (a) a.flashes++; }
  }
  const out = new Map<string, RoleHint[]>();
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  for (const [sid, a] of acc) {
    if (a.rounds < 10) continue;
    const hints: RoleHint[] = [];
    const awp = pct(a.awpKills, a.kills);
    if (awp >= 25 && a.awpKills >= 5) hints.push({ role: 'AWP', evidence: tt('{0}% of kills with the AWP', [awp]), score: awp / 100 });
    const open = pct(a.openings, teamOpenings);
    if (open >= 27 && a.openings >= 5) hints.push({ role: 'Entry', evidence: tt('takes {0}% of the team\'s opening duels', [open]), score: open / 100 });
    const far = pct(a.farAt30, a.tPos30);
    if (a.tPos30 >= 6 && far >= 40) hints.push({ role: 'Lurk', evidence: tt('alone (10 m+ from the team) at 30 s in {0}% of T rounds', [far]), score: far / 100 });
    const [topPlace, topN] = [...a.ctPlaces.entries()].sort((x, y) => y[1] - x[1])[0] ?? ['', 0];
    const anchor = pct(topN, a.ctPos20);
    if (a.ctPos20 >= 6 && anchor >= 55) hints.push({ role: 'Anchor', evidence: tt('at {0} at 20 s in {1}% of CT rounds', [placeLabel(topPlace), anchor]), score: anchor / 100 });
    const fpr = a.flashes / Math.max(1, a.rounds);
    if (fpr >= 0.9 && open < 20) hints.push({ role: 'Support', evidence: tt('{0} flashes per round, {1} flash assists', [fpr.toFixed(1), a.flashAssists]), score: Math.min(1, fpr / 1.5) });
    const tpr = a.trades / Math.max(1, a.rounds);
    if (tpr >= 0.22 && a.trades >= 4) hints.push({ role: 'Trader', evidence: tt('{0} trade kills ({1} per round)', [a.trades, tpr.toFixed(2)]), score: Math.min(1, tpr * 5) });
    out.set(sid, hints.sort((x, y) => y.score - x.score));
  }
  return out;
}
