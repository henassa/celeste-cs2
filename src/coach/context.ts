// Contexte du coach : un résumé compact et factuel du match, construit uniquement à partir des
// données calculées par scrimview (stats, moments, rounds, notes). Le modèle ne voit rien d'autre.

import type { MatchData } from '../data/types';
import { computeStats } from '../stats/compute';
import { computeInsights } from '../stats/insights';
import { detectMoments } from '../stats/moments';
import { buildSpatial } from '../library/spatial';
import { placeLabel } from '../viewer/places';
import type { AimSummary } from '../stats/aim';
import type { ChatMessage } from './providers';
import { CS_PRIMER, matchFindings } from './tools';

const REASONS: Record<string, string> = {
  t_killed: 'elimination', ct_killed: 'elimination', bomb_exploded: 'bomb exploded', bomb_defused: 'bomb defused', target_saved: 'time ran out', ct_win: 'elimination', t_win: 'elimination',
};
const clock = (sec: number) => { const l = Math.max(0, Math.ceil(115 - sec)); return `${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}`; };

export interface ContextOptions {
  /** Round détaillé (index) en plus du résumé. */
  round?: number | null;
  notes?: Record<number, string>;
  aim?: AimSummary[] | null;
}

export function matchContext(m: MatchData, o: ContextOptions = {}): string {
  const sp = buildSpatial(m);
  const stats = computeStats(m, 'all');
  const L: string[] = [];
  const last = m.rounds[m.rounds.length - 1];
  const name = (p: number) => m.players[p]?.name ?? '?';
  L.push(`# Match: ${m.teams[0].name} ${last?.scoreAfter[0] ?? 0}–${last?.scoreAfter[1] ?? 0} ${m.teams[1].name} on ${m.header.map}, ${m.rounds.length} rounds`);
  L.push('', '## Players (whole match)');
  for (const t of [0, 1] as const) {
    L.push(`${m.teams[t].name}:`);
    for (const s of stats.filter((x) => x.team === t).sort((a, b) => b.rating2 - a.rating2)) {
      const cl = s.clutches.reduce((a, c) => a + c.wins, 0), ca = s.clutches.reduce((a, c) => a + c.attempts, 0);
      L.push(`- ${s.name}: ${s.kills}-${s.deaths}-${s.assists}, ADR ${s.adr.toFixed(0)}, KAST ${s.kast.toFixed(0)}%, rating2 ${s.rating2.toFixed(2)}, swing ${s.swing.toFixed(1)}%/round, opening ${s.entryKills}-${s.entryDeaths}, trades ${s.tradeKills}, clutches ${cl}/${ca}, utility dmg ${s.utilityDamage}, flashed ${s.enemiesFlashed}`);
    }
  }
  if (o.aim?.length) {
    L.push('', '## Aim (medians; reaction and crosshair measured on part of the duels)');
    for (const a of o.aim) {
      if (!a.samples.shots) continue;
      const f = (v: number | null, u: string, d = 0) => (v === null ? '—' : `${v.toFixed(d)}${u}`);
      L.push(`- ${name(a.player)}: accuracy ${f(a.accuracy, '%')}, stopped shots ${f(a.stoppedPct, '%')}, reaction ${f(a.reactionMs, ' ms')}, crosshair ${f(a.crosshairDeg, '°', 1)}, duels won hitting first ${f(a.firstHitWin, '%')}`);
    }
  }
  const ins = computeInsights(m, stats);
  const findings = matchFindings(m, sp);
  if (findings.length) L.push('', '## Pre-computed findings', ...findings.map((x) => `- ${x}`));
  L.push('', '## Summary');
  if (ins.streak) L.push(`- Longest streak: ${m.teams[ins.streak.team].name} won ${ins.streak.length} in a row (R${ins.streak.from}-R${ins.streak.to})`);
  if (ins.comeback) L.push(`- ${m.teams[ins.comeback.team].name} came back from ${ins.comeback.deficit} rounds down`);
  for (const s of ins.sites) L.push(`- ${m.teams[s.team].name} on T: ${s.plants.A + s.plants.B}/${s.tRounds} plants (A ${s.plants.A}, B ${s.plants.B}), ${s.postPlantWon} won after planting, ${s.openingsWon} opening kills`);
  L.push('', '## Key moments');
  for (const x of detectMoments(m, null, sp)) L.push(`- R${x.round + 1}: ${x.title}`);
  L.push('', '## Rounds (R#: CT team · winner · reason · buys team0/team1 · opening kill · plant)');
  for (const r of sp.rounds) {
    const info = m.rounds[r.i];
    const first = sp.kills.filter((k) => k.r === r.i && k.kt >= 0 && k.kt !== k.vt).sort((a, b) => a.t - b.t)[0];
    const fp = first?.vp != null && first.vp >= 0 ? sp.places?.[first.vp] ?? '' : '';
    L.push(`R${r.i + 1}: CT ${m.teams[r.ctTeam].name} · won by ${r.winner !== null ? m.teams[r.winner].name : '?'} · ${REASONS[info?.reason ?? ''] ?? info?.reason ?? ''} · ${r.buy[0]}/${r.buy[1]}`
      + (first ? ` · ${name(first.k)} killed ${name(first.v)}${fp ? ` at ${placeLabel(fp)}` : ''} (${clock(first.t)})` : '')
      + (r.plantSite ? ` · plant ${r.plantSite} at ${clock(r.plantT ?? 0)}` : ''));
  }
  if (o.round != null && sp.rounds[o.round]) {
    const r = sp.rounds[o.round];
    L.push('', `## Round ${o.round + 1} in detail (round clock)`);
    for (const k of sp.kills.filter((x) => x.r === r.i && x.t >= 0).sort((a, b) => a.t - b.t)) {
      const kp = k.kp != null && k.kp >= 0 ? placeLabel(sp.places?.[k.kp] ?? '') : '';
      const vp = k.vp != null && k.vp >= 0 ? placeLabel(sp.places?.[k.vp] ?? '') : '';
      L.push(`- ${clock(k.t)} ${k.kt >= 0 ? name(k.k) : 'world'}${kp ? ` (${kp})` : ''} killed ${name(k.v)}${vp ? ` (${vp})` : ''} with ${k.w.replace(/^weapon_/, '')}${k.hs ? ', headshot' : ''}`);
    }
    const nades = sp.nades.filter((n) => n.r === r.i && n.kind !== 'decoy');
    for (const t of [0, 1] as const) {
      const mine = nades.filter((n) => n.team === t);
      if (!mine.length) continue;
      const lands = mine.filter((n) => n.lp != null && n.lp >= 0).map((n) => `${n.kind} ${placeLabel(sp.places?.[n.lp!] ?? '')} ${clock(n.t)}`);
      L.push(`- ${m.teams[t].name} utility: ${lands.slice(0, 12).join(', ') || `${mine.length} grenades`}`);
    }
    if (r.plantSite) L.push(`- Bomb planted on ${r.plantSite} at ${clock(r.plantT ?? 0)}${r.defuseT != null ? `, defused at ${clock(r.defuseT)}` : ''}`);
  }
  const notes = Object.entries(o.notes ?? {}).filter(([, v]) => v?.trim());
  if (notes.length) {
    L.push('', '## Team notes written by the user');
    for (const [k, v] of notes) L.push(`- R${k}: ${v.trim().replace(/\n+/g, ' ')}`);
  }
  return L.join('\n');
}

export type CoachLanguage = 'auto' | 'en' | 'fr';

export function systemPrompt(lang: CoachLanguage, scope: 'match' | 'library' = 'match'): string {
  const language = lang === 'fr' ? 'Always answer in French (CS terms like eco, trade, retake can stay in English).' : lang === 'en' ? 'Answer in English.' : 'Answer in the language of the user\'s last message.';
  return [
    scope === 'match' ? 'You are an experienced Counter-Strike 2 coach reviewing a match with a team.' : 'You are an experienced Counter-Strike 2 coach and analyst working with a team\'s library of demos.',
    'Ground rules: use ONLY facts from the data or tool results; never invent rounds, players, callouts or numbers.',
    'Every claim must point to evidence: round numbers (R#), stats, counts with their sample size.',
    'If the data cannot answer, say exactly what is missing.',
    'Method: 1) gather the facts, 2) find the 2-4 patterns that decided rounds (economy, opening duels, trades, utility, site hits, retakes, individual errors), 3) explain WHY with the evidence, 4) give concrete fixes for practice.',
    'Prefer patterns over single events; separate habits (several rounds) from one-offs.',
    'Format: short headings and bullet points, no filler, no generic advice that does not come from the data.',
    CS_PRIMER,
    language,
  ].join(' ');
}

export function buildMessages(context: string, history: ChatMessage[], question: string, lang: CoachLanguage): ChatMessage[] {
  return [
    { role: 'system', content: `${systemPrompt(lang)}\n\n--- MATCH DATA ---\n${context}` },
    ...history.slice(-6),
    { role: 'user', content: question },
  ];
}

export const QUICK_PROMPTS = {
  verdict: 'Give a match verdict for the team that won fewer rounds if any, otherwise for both: 3 things that worked, 3 things that cost rounds, and 3 priorities for the next practice. Cite rounds and players.',
  round: (n: number) => `Explain how round ${n} was won or lost, step by step, and what the losing side could have done differently. Use the round detail and the notes.`,
  practice: 'Based on the whole match, list the 3 most important things to practice before the next match, with the evidence for each (rounds, stats).',
  player: (name: string) => `Review ${name}'s match: strengths, mistakes that cost rounds (cite rounds), and one concrete thing to work on.`,
};
