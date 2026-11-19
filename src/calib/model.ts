// Étalonnage des ratings ≈3.0 et ≈FACEIT : régression ridge sur nos stats, à partir des ratings
// de référence saisis dans la bibliothèque. Erreur mesurée par validation croisée « un match exclu ».
// Tout est calculé localement ; le modèle (quelques coefficients) est exportable.

import type { PlayerStats } from '../stats/compute';
import type { LibraryMatch, RefKind } from '../library/library';
import type { MatchSpatial } from '../library/spatial';
import { fitWpCoef, fitWpModel, wpaByPlayer } from '../stats/wp-model';
import defaults from './default-models.json';

export const FEATURES: { id: string; label: string; of: (s: PlayerStats) => number }[] = [
  { id: 'kpr', label: 'Kills / round', of: (s) => s.kpr },
  { id: 'dpr', label: 'Deaths / round', of: (s) => s.dpr },
  { id: 'apr', label: 'Assists / round', of: (s) => s.apr },
  { id: 'adr', label: 'ADR / 100', of: (s) => s.adr / 100 },
  { id: 'kast', label: 'KAST', of: (s) => s.kast / 100 },
  { id: 'swing', label: 'Swing / round', of: (s) => s.swing / 100 },
  { id: 'ecokpr', label: 'Eco-adjusted kills / round', of: (s) => s.ecoKpr },
  { id: 'ecoadr', label: 'Eco-adjusted ADR / 100', of: (s) => s.ecoAdr / 100 },
  { id: 'mk', label: 'Multi-kill rating', of: (s) => (s.multi[2] * 4 + s.multi[3] * 9 + s.multi[4] * 16 + s.multi[5] * 25 + s.multi[1]) / Math.max(1, s.rounds) },
  { id: 'entry', label: 'Opening kills − deaths / round', of: (s) => (s.entryKills - s.entryDeaths) / Math.max(1, s.rounds) },
  { id: 'trade', label: 'Trade kills / round', of: (s) => s.tradeKills / Math.max(1, s.rounds) },
  { id: 'clutch', label: 'Clutches won / round', of: (s) => s.clutches.reduce((a, c) => a + c.wins, 0) / Math.max(1, s.rounds) },
  { id: 'util', label: 'Utility damage / round / 100', of: (s) => s.utilityDamage / Math.max(1, s.rounds) / 100 },
];

export interface RatingModel {
  kind: RefKind;
  version: 2;
  features: string[];
  mean: number[];
  std: number[];
  coef: number[];
  intercept: number;
  /** Étalonnage livré avec scrimview (et non calculé sur la bibliothèque de l'utilisateur). */
  builtIn?: boolean;
  /** Erreur absolue moyenne en validation croisée (un match exclu à chaque fois). */
  cvMae: number;
  /** Même mesure pour notre 2.0≈ face à la référence (point de comparaison). */
  baselineMae: number;
  samples: number;
  matches: number;
  fittedAt: number;
  /** Variables en plus de FEATURES (ex. 'wpa'), dans l'ordre des coefficients. */
  extra?: string[];
  /** Modèle de probabilité de victoire appris sur la bibliothèque (pour calculer la WPA). */
  wp?: { coef: number[]; intercept: number };
  /** Diagnostic : erreur sans la WPA, et qualité du modèle de victoire. */
  cvMaeWithout?: number;
  wpInfo?: { rounds: number; logloss: number; baselineLogloss: number; kept: boolean };
}

export type Extras = { wpa?: number };

interface Sample { x: number[]; y: number; match: string; baseline: number; sid: string; player: number; rounds: number }

export function samplesFor(kind: RefKind, matches: LibraryMatch[]): Sample[] {
  const out: Sample[] = [];
  for (const m of matches) {
    const refs = m.refs[kind];
    if (!refs) continue;
    if ((m.statsVersion ?? 1) < 2) continue; // stats d'une ancienne version : à réimporter
    for (const s of m.stats.all) {
      const sid = m.players[s.player]?.steamid ?? '';
      const y = refs[sid];
      if (typeof y !== 'number' || !Number.isFinite(y) || s.rounds < 5) continue;
      const x = FEATURES.map((f) => f.of(s));
      if (!x.every(Number.isFinite) || !Number.isFinite(s.rating2)) continue;
      out.push({ x, y, match: m.id, baseline: s.rating2, sid, player: s.player, rounds: s.rounds });
    }
  }
  return out;
}

/** Résout A·x = b (Gauss avec pivot partiel). */
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

function fitRaw(samples: Sample[], lambda: number) {
  const p = samples[0].x.length, n = samples.length;
  const mean = Array.from({ length: p }, (_, j) => samples.reduce((a, s) => a + s.x[j], 0) / n);
  const std = Array.from({ length: p }, (_, j) => Math.sqrt(samples.reduce((a, s) => a + (s.x[j] - mean[j]) ** 2, 0) / n) || 1);
  const ym = samples.reduce((a, s) => a + s.y, 0) / n;
  const Z = samples.map((s) => s.x.map((v, j) => (v - mean[j]) / std[j]));
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => Z.reduce((a, z) => a + z[i] * z[j], 0) + (i === j ? lambda : 0)));
  const b = Array.from({ length: p }, (_, i) => Z.reduce((a, z, k) => a + z[i] * (samples[k].y - ym), 0));
  const coef = solve(A, b);
  return { mean, std, coef, intercept: ym };
}

export function predict(model: Pick<RatingModel, 'mean' | 'std' | 'coef' | 'intercept'>, x: number[]): number {
  return model.intercept + x.reduce((a, v, j) => a + model.coef[j] * ((v - model.mean[j]) / model.std[j]), 0);
}

export function predictStats(model: RatingModel, s: PlayerStats, extras: Extras = {}): number {
  const x = FEATURES.map((f) => f.of(s));
  (model.extra ?? []).forEach((id, i) => {
    const v = id === 'wpa' ? extras.wpa : undefined;
    // Variable absente (ancienne démo...) : valeur moyenne, donc sans effet sur l'estimation
    x.push(v !== undefined && Number.isFinite(v) ? v : model.mean[FEATURES.length + i]);
  });
  return predict(model, x);
}

/** WPA par joueur d'un match (si le modèle l'utilise). */
export function extrasForMatch(model: RatingModel | undefined, sp: MatchSpatial | undefined, roundsOf: (p: number) => number): Map<number, Extras> {
  const out = new Map<number, Extras>();
  if (!model?.extra?.includes('wpa') || !model.wp || !sp) return out;
  for (const [p, v] of wpaByPlayer(sp, model.wp, roundsOf)) out.set(p, { wpa: v });
  return out;
}

/** Ajoute la WPA (calculée avec le modèle de victoire donné) aux échantillons. */
function withWpa(samples: Sample[], matches: Map<string, LibraryMatch>, wp: { coef: number[]; intercept: number }): Sample[] {
  const cache = new Map<string, Map<number, number>>();
  return samples.map((s) => {
    let w = cache.get(s.match);
    if (!w) {
      const m = matches.get(s.match)!;
      const rounds = new Map(m.stats.all.map((x) => [x.player, x.rounds]));
      w = m.spatial ? wpaByPlayer(m.spatial, wp, (p) => rounds.get(p) ?? 0) : new Map();
      cache.set(s.match, w);
    }
    return { ...s, x: [...s.x, w.get(s.player) ?? 0] };
  });
}

function crossValidate(ids: string[], samplesFor: (excluded: string | null) => Sample[], lambda: number) {
  let err = 0, base = 0, n = 0;
  for (const id of ids) {
    const all = samplesFor(id);
    const train = all.filter((s) => s.match !== id);
    const test = all.filter((s) => s.match === id);
    const m = fitRaw(train, lambda);
    for (const t of test) { err += Math.abs(predict(m, t.x) - t.y); base += Math.abs(t.baseline - t.y); n++; }
  }
  return { mae: err / Math.max(1, n), base: base / Math.max(1, n) };
}

export const MIN_MATCHES = 2;
export const MIN_SAMPLES = 15;

/** Gain minimal (erreur moyenne) pour garder la WPA : en dessous, c'est du bruit. */
export const WPA_MIN_GAIN = 0.002;

export function fitModel(kind: RefKind, matches: LibraryMatch[], lambda = 3, minWpRounds?: number): RatingModel | null {
  const samples = samplesFor(kind, matches);
  const ids = [...new Set(samples.map((s) => s.match))];
  if (ids.length < MIN_MATCHES || samples.length < MIN_SAMPLES) return null;
  // Validation croisée : on réentraîne sans chaque match et on mesure l'erreur sur ce match
  const plain = crossValidate(ids, () => samples, lambda);

  // Variante avec la WPA : le modèle de victoire est lui aussi réentraîné sans le match testé
  const byId = new Map(matches.map((m) => [m.id, m]));
  const spatialMatches = matches.filter((m) => m.spatial);
  const wpFull = fitWpCoef(spatialMatches, minWpRounds);
  let withW: { mae: number; base: number } | null = null;
  if (wpFull) {
    withW = crossValidate(ids, (excluded) => {
      const wp = fitWpCoef(spatialMatches.filter((m) => m.id !== excluded), minWpRounds);
      return wp ? withWpa(samples, byId, wp) : withWpa(samples, byId, wpFull);
    }, lambda);
  }
  const keep = !!withW && withW.mae < plain.mae - WPA_MIN_GAIN;
  const finalSamples = keep && wpFull ? withWpa(samples, byId, wpFull) : samples;
  const full = fitRaw(finalSamples, lambda);
  const cv = keep && withW ? withW : plain;
  if (![...full.coef, full.intercept, cv.mae, cv.base].every(Number.isFinite)) return null;
  const info = wpFull ? fitWpModel(spatialMatches, minWpRounds) : null;
  return {
    kind, version: 2, features: [...FEATURES.map((f) => f.id), ...(keep ? ['wpa'] : [])], ...full,
    cvMae: cv.mae, baselineMae: cv.base,
    samples: samples.length, matches: ids.length, fittedAt: Date.now(),
    ...(keep && wpFull ? { extra: ['wpa'], wp: wpFull } : {}),
    cvMaeWithout: plain.mae,
    ...(info ? { wpInfo: { rounds: info.rounds, logloss: info.logloss, baselineLogloss: info.baselineLogloss, kept: keep } } : {}),
  };
}

// --- Persistance locale des modèles ---
const KEY = 'scrimview.models';

/**
 * Étalonnages par défaut livrés avec l'app (HLTV 3.0 : 22 cartes pro, 217 joueurs, nov. 2026).
 * Un étalonnage fait par l'utilisateur sur sa bibliothèque les remplace.
 */
export function builtInModels(): Partial<Record<RefKind, RatingModel>> {
  const out: Partial<Record<RefKind, RatingModel>> = {};
  for (const k of ['faceit', 'hltv3'] as RefKind[]) {
    const m = (defaults as Record<string, RatingModel | undefined>)[k];
    if (isValidModel(m)) out[k] = { ...m, builtIn: true };
  }
  return out;
}

export function loadModels(): Partial<Record<RefKind, RatingModel>> {
  return { ...builtInModels(), ...loadUserModels() };
}

function loadUserModels(): Partial<Record<RefKind, RatingModel>> {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!d || typeof d !== 'object') return {};
    // On ne garde que les modèles compatibles avec la version actuelle des stats
    const out: Partial<Record<RefKind, RatingModel>> = {};
    for (const k of ['faceit', 'hltv3'] as RefKind[]) {
      const m = d[k];
      if (isValidModel(m)) out[k] = m;
    }
    return out;
  } catch { return {}; }
}

export function saveModels(models: Partial<Record<RefKind, RatingModel>>): void {
  try { localStorage.setItem(KEY, JSON.stringify(models)); } catch { /* ignoré */ }
  window.dispatchEvent(new Event('scrimview:models'));
}

const KNOWN_EXTRA = new Set(['wpa']);

function isValidModel(m: RatingModel | undefined): m is RatingModel {
  if (!m || m.version !== 2 || !Array.isArray(m.coef)) return false;
  const extra = m.extra ?? [];
  if (!extra.every((e) => KNOWN_EXTRA.has(e))) return false;
  if (extra.includes('wpa') && !(m.wp && Array.isArray(m.wp.coef) && [...m.wp.coef, m.wp.intercept].every(Number.isFinite))) return false;
  const p = FEATURES.length + extra.length;
  return m.coef.length === p && m.mean.length === p && m.std.length === p
    && [...m.coef, ...m.mean, ...m.std, m.intercept, m.cvMae, m.baselineMae].every((v) => typeof v === 'number' && Number.isFinite(v));
}

/** Vérifie un fichier calibration.json importé. */
export function parseModelsFile(text: string): Partial<Record<RefKind, RatingModel>> {
  const d = JSON.parse(text);
  const out: Partial<Record<RefKind, RatingModel>> = {};
  for (const kind of ['faceit', 'hltv3'] as RefKind[]) {
    const m = d?.[kind];
    if (!m) continue;
    if (!isValidModel(m) || m.features?.join(',') !== [...FEATURES.map((f) => f.id), ...(m.extra ?? [])].join(',')) throw new Error(`Incompatible ${kind} model in this file (made with an older version: calibrate again).`);
    out[kind] = m;
  }
  if (!Object.keys(out).length) throw new Error('No rating model in this file.');
  return out;
}

/** Données d'étalonnage exportables (stats + rating de référence par joueur), pour analyse hors ligne. */
export function calibrationData(matches: LibraryMatch[]) {
  const out: Record<string, unknown[]> = {};
  for (const kind of ['faceit', 'hltv3'] as RefKind[]) {
    const rows: unknown[] = [];
    for (const m of matches) {
      const refs = m.refs[kind];
      if (!refs) continue;
      for (const s of m.stats.all) {
        const sid = m.players[s.player]?.steamid ?? '';
        if (typeof refs[sid] !== 'number') continue;
        rows.push({
          match: m.id, file: m.fileName, map: m.map, rounds: s.rounds, player: s.name, steamid: sid, ref: refs[sid],
          features: Object.fromEntries(FEATURES.map((f) => [f.id, Number(f.of(s).toFixed(5))])),
          rating1: Number(s.rating1.toFixed(4)), rating2: Number(s.rating2.toFixed(4)),
          kills: s.kills, deaths: s.deaths, assists: s.assists, adr: Number(s.adr.toFixed(2)), kast: Number(s.kast.toFixed(2)),
        });
      }
    }
    if (rows.length) out[kind] = rows;
  }
  return { version: 2, exportedAt: new Date().toISOString(), ...out };
}
