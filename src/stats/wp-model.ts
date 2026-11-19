// Modèle de probabilité de victoire appris sur les rounds de la bibliothèque (régression logistique).
// Remplace l'heuristique de win-probability.ts quand il y a assez de rounds, et sert à calculer
// la « probabilité de victoire ajoutée » (WPA) de chaque joueur : ce que ses kills et ses morts
// ont fait gagner ou perdre à son équipe. Six variables, lisibles, entraînées localement.

import type { LibraryMatch } from '../library/library';
import type { MatchSpatial, SpatialKill, SpatialRound, TeamIdx } from '../library/spatial';
import { winProbabilityT } from './win-probability';

export const WP_FEATURES = ['alive diff', 'alive total', 'bomb planted', 'planted × diff', 'time elapsed', 'equipment ratio'] as const;

export interface WpModel {
  coef: number[];
  intercept: number;
  /** États (instants) et rounds utilisés. */
  samples: number;
  rounds: number;
  /** Perte logarithmique en validation croisée, et celle de l'heuristique de départ. */
  logloss: number;
  baselineLogloss: number;
}

export const MIN_WP_ROUNDS = 150;

export interface WpState { aliveT: number; aliveCT: number; planted: boolean; t: number; equipT: number; equipCT: number }

function features(s: WpState): number[] {
  const d = s.aliveT - s.aliveCT;
  return [
    d,
    s.aliveT + s.aliveCT,
    s.planted ? 1 : 0,
    s.planted ? d : 0,
    s.planted ? 0 : Math.min(1, s.t / 115),
    Math.log((s.equipT + 1500) / (s.equipCT + 1500)),
  ];
}

export function wpPredict(m: Pick<WpModel, 'coef' | 'intercept'> | null, s: WpState): number {
  if (s.aliveCT <= 0) return 1;
  if (s.aliveT <= 0 && !s.planted) return 0;
  if (!m) {
    return winProbabilityT({ aliveT: s.aliveT, aliveCT: s.aliveCT, equipT: s.equipT, equipCT: s.equipCT, bombPlanted: s.planted, timeLeft: 115 - s.t });
  }
  const x = features(s);
  const z = m.intercept + x.reduce((a, v, j) => a + m.coef[j] * v, 0);
  return 1 / (1 + Math.exp(-z));
}

/** Un instant d'un round, avec l'action qui y mène (kill, plant ; null pour l'état de départ). */
interface Step { state: WpState; before: WpState | null; kill: SpatialKill | null; plant?: boolean }

/** Les états successifs d'un round : départ, après chaque kill, au plant. */
function roundSteps(r: SpatialRound, kills: SpatialKill[]): Step[] {
  const tTeam = (1 - r.ctTeam) as TeamIdx;
  const a0: [number, number] = r.alive ? [r.alive[0], r.alive[1]] : [5, 5];
  const alive: [number, number] = [a0[0], a0[1]];
  const eq = (team: TeamIdx) => (a0[team] ? (r.equip[team] * alive[team]) / a0[team] : 0);
  const stateAt = (t: number): WpState => ({
    aliveT: alive[tTeam], aliveCT: alive[r.ctTeam], planted: r.plantT != null && t >= r.plantT, t,
    equipT: eq(tTeam), equipCT: eq(r.ctTeam),
  });
  const steps: Step[] = [{ state: stateAt(0), before: null, kill: null }];
  // Le plant : même état juste avant (bombe pas encore posée) et juste après
  const plantStep = (t: number): Step => ({ state: stateAt(t), before: { ...stateAt(t), planted: false }, kill: null, plant: true });
  let plantDone = r.plantT == null;
  for (const k of kills) {
    if (k.t < 0) continue;
    if (r.endT != null && k.t > r.endT) break;
    if (!plantDone && k.t >= r.plantT!) { steps.push(plantStep(r.plantT!)); plantDone = true; }
    const before = stateAt(k.t);
    alive[k.vt] = Math.max(0, alive[k.vt] - 1);
    steps.push({ state: stateAt(k.t), before, kill: k });
  }
  if (!plantDone) steps.push(plantStep(r.plantT!));
  return steps;
}

function killsByRound(sp: MatchSpatial): Map<number, SpatialKill[]> {
  const out = new Map<number, SpatialKill[]>();
  for (const k of sp.kills) { let a = out.get(k.r); if (!a) out.set(k.r, (a = [])); a.push(k); }
  for (const a of out.values()) a.sort((x, y) => x.t - y.t);
  return out;
}

interface WpSample { x: number[]; y: number; match: string; state: WpState }

function wpSamples(matches: LibraryMatch[]): WpSample[] {
  const out: WpSample[] = [];
  for (const m of matches) {
    const sp = m.spatial;
    if (!sp) continue;
    const byRound = killsByRound(sp);
    for (const r of sp.rounds) {
      if (r.winner === null || r.buy[0] === undefined) continue;
      const y = r.winner === 1 - r.ctTeam ? 1 : 0;
      for (const st of roundSteps(r, byRound.get(r.i) ?? [])) {
        const s = st.state;
        if (s.aliveCT <= 0 || (s.aliveT <= 0 && !s.planted)) continue; // états terminaux : pas d'information
        out.push({ x: features(s), y, match: m.id, state: s });
      }
    }
  }
  return out;
}

/** Régression logistique L2 par Newton (IRLS). */
function fitLogistic(samples: WpSample[], lambda = 1): { coef: number[]; intercept: number } {
  const p = WP_FEATURES.length + 1; // + constante
  let w: number[] = Array.from({ length: p }, () => 0);
  for (let it = 0; it < 25; it++) {
    const H = Array.from({ length: p }, () => Array.from({ length: p }, () => 0));
    const g: number[] = Array.from({ length: p }, () => 0);
    for (const s of samples) {
      const x = [1, ...s.x];
      const z = x.reduce((a, v, j) => a + w[j] * v, 0);
      const pr = 1 / (1 + Math.exp(-z));
      const r = pr * (1 - pr);
      for (let i = 0; i < p; i++) {
        g[i] += (pr - s.y) * x[i];
        for (let j = i; j < p; j++) H[i][j] += r * x[i] * x[j];
      }
    }
    for (let i = 0; i < p; i++) { for (let j = 0; j < i; j++) H[i][j] = H[j][i]; if (i > 0) { H[i][i] += lambda; g[i] += lambda * w[i]; } }
    const step = solve(H, g);
    w = w.map((v, i) => v - step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-6) break;
  }
  return { intercept: w[0], coef: w.slice(1) };
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

const ll = (p: number, y: number) => -(y * Math.log(Math.max(1e-6, p)) + (1 - y) * Math.log(Math.max(1e-6, 1 - p)));

/** Coefficients seuls (sans validation croisée), pour l'étalonnage. */
export function fitWpCoef(matches: LibraryMatch[], minRounds = MIN_WP_ROUNDS): { coef: number[]; intercept: number } | null {
  const rounds = matches.reduce((a, m) => a + (m.spatial?.rounds.length ?? 0), 0);
  if (rounds < minRounds) return null;
  const fit = fitLogistic(wpSamples(matches));
  return [...fit.coef, fit.intercept].every(Number.isFinite) ? fit : null;
}

/** Entraîne le modèle sur la bibliothèque ; null si trop peu de rounds. Erreur mesurée match par match. */
export function fitWpModel(matches: LibraryMatch[], minRounds = MIN_WP_ROUNDS): WpModel | null {
  const samples = wpSamples(matches);
  const rounds = matches.reduce((a, m) => a + (m.spatial?.rounds.length ?? 0), 0);
  if (rounds < minRounds) return null;
  const ids = [...new Set(samples.map((s) => s.match))];
  let loss = 0, base = 0;
  for (const id of ids) {
    const fit = fitLogistic(samples.filter((s) => s.match !== id));
    for (const s of samples) if (s.match === id) { loss += ll(wpPredict(fit, s.state), s.y); base += ll(wpPredict(null, s.state), s.y); }
  }
  const full = fitLogistic(samples);
  if (![...full.coef, full.intercept].every(Number.isFinite)) return null;
  return { ...full, samples: samples.length, rounds, logloss: loss / samples.length, baselineLogloss: base / samples.length };
}

/**
 * Probabilité de victoire ajoutée par joueur (par round joué) : chaque kill rapporte au tueur la
 * hausse de probabilité de son équipe, chaque mort coûte à la victime la baisse de la sienne.
 * Clé = index du joueur dans le match.
 */
export function wpaByPlayer(sp: MatchSpatial, wp: Pick<WpModel, 'coef' | 'intercept'> | null, roundsPlayed: (p: number) => number): Map<number, number> {
  const sum = new Map<number, number>();
  const add = (p: number, v: number) => sum.set(p, (sum.get(p) ?? 0) + v);
  const byRound = killsByRound(sp);
  for (const r of sp.rounds) {
    const tTeam = 1 - r.ctTeam;
    let last: WpState | null = null;
    for (const st of roundSteps(r, byRound.get(r.i) ?? [])) {
      last = st.state;
      if (!st.before) continue;
      const dT = wpPredict(wp, st.state) - wpPredict(wp, st.before);
      const forTeam = (team: number) => (team === tTeam ? dT : -dT);
      if (st.plant) { if (r.planter != null && r.planter >= 0) add(r.planter, dT); continue; }
      const k = st.kill;
      if (!k) continue;
      if (k.kt >= 0 && k.kt !== k.vt) {
        // Kill aidé : 80 % au tueur, 20 % au passeur de la même équipe
        const assisted = k.a != null && k.a >= 0 && k.a !== k.k;
        add(k.k, forTeam(k.kt) * (assisted ? 0.8 : 1));
        if (assisted) add(k.a!, forTeam(k.kt) * 0.2);
      }
      add(k.v, forTeam(k.vt));
    }
    // Défuse : la probabilité CT passe de (1 − P_T) à 1, tout le gain va au défuseur
    if (r.defuser != null && r.defuser >= 0 && last) add(r.defuser, wpPredict(wp, last));
  }
  const out = new Map<number, number>();
  for (const [p, v] of sum) { const n = roundsPlayed(p); if (n > 0) out.set(p, v / n); }
  return out;
}

/** Probabilité que l'équipe `team` gagne le round, échantillonnée dans le temps (secondes après le freeze). */
export function wpSeries(sp: MatchSpatial, ri: number, wp: Pick<WpModel, 'coef' | 'intercept'> | null, team: TeamIdx, step = 1): { t: number; p: number }[] {
  const r = sp.rounds[ri];
  if (!r) return [];
  const kills = killsByRound(sp).get(ri) ?? [];
  const steps = roundSteps(r, kills);
  const end = r.endT ?? (kills.length ? kills[kills.length - 1].t + 3 : 115);
  const isT = team !== r.ctTeam;
  const out: { t: number; p: number }[] = [];
  let si = 0;
  const at = (t: number) => {
    while (si + 1 < steps.length && steps[si + 1].state.t <= t) si++;
    const s = { ...steps[si].state, t, planted: steps[si].state.planted || (r.plantT != null && t >= r.plantT) };
    const pT = wpPredict(wp, s);
    return isT ? pT : 1 - pT;
  };
  const times = new Set<number>();
  for (let t = 0; t <= end; t += step) times.add(Math.round(t * 10) / 10);
  for (const st of steps) times.add(st.state.t);
  times.add(end);
  for (const t of [...times].sort((a, b) => a - b)) out.push({ t, p: at(t) });
  // Fin du round : 0 ou 1 selon le vainqueur
  if (r.winner !== null) out.push({ t: end + 0.01, p: r.winner === team ? 1 : 0 });
  return out;
}

/** Variation de probabilité (côté T) provoquée par chaque kill et par le plant d'un round. */
export function roundSwings(sp: MatchSpatial, ri: number, wp: Pick<WpModel, 'coef' | 'intercept'> | null): { t: number; kill: SpatialKill | null; plant: boolean; dT: number; after: WpState }[] {
  const r = sp.rounds[ri];
  if (!r) return [];
  const out: { t: number; kill: SpatialKill | null; plant: boolean; dT: number; after: WpState }[] = [];
  for (const st of roundSteps(r, killsByRound(sp).get(ri) ?? [])) {
    if (!st.before) continue;
    out.push({ t: st.state.t, kill: st.kill, plant: !!st.plant, dT: wpPredict(wp, st.state) - wpPredict(wp, st.before), after: st.state });
  }
  return out;
}
