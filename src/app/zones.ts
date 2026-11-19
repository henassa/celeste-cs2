// Zones montrées par le coach sur la carte (positions fortes, faibles, repères), en coordonnées monde.
// Affichées sur le radar 2D, la vue 3D et les heatmaps de la carte concernée.

import { useSyncExternalStore } from 'react';
import type { MatchSpatial } from '@/library/spatial';
import { placeLabel } from '@/viewer/places';

export type ZoneKind = 'strong' | 'weak' | 'info';
export interface Zone { x: number; y: number; z: number; r: number; label: string; kind: ZoneKind; callout: string }
export interface ZoneSet { map: string; title: string; zones: Zone[] }

export const ZONE_COLOR: Record<ZoneKind, string> = { strong: '#fafafa', weak: '#ef4444', info: '#38bdf8' };

let current: ZoneSet | null = null;
const subs = new Set<() => void>();
export function setZones(z: ZoneSet | null): void { current = z; subs.forEach((s) => s()); }
export const getZones = () => current;
export function useZones(): ZoneSet | null {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => current);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Centres des callouts d'une carte : positions observées des joueurs (kills, morts, positions à t s). */
export function calloutCenters(spatials: MatchSpatial[]): Map<string, { x: number; y: number; z: number; r: number; name: string }> {
  const acc = new Map<string, { xs: number[]; ys: number[]; zs: number[]; name: string }>();
  const add = (place: string | undefined, x: number, y: number, z: number) => {
    if (!place) return;
    const k = norm(place);
    let a = acc.get(k);
    if (!a) { a = { xs: [], ys: [], zs: [], name: place }; acc.set(k, a); }
    a.xs.push(x); a.ys.push(y); a.zs.push(z);
  };
  for (const sp of spatials) {
    const pl = (i: number | undefined) => (i != null && i >= 0 ? sp.places?.[i] : undefined);
    for (const k of sp.kills) { add(pl(k.kp), k.kx, k.ky, k.kz); add(pl(k.vp), k.vx, k.vy, k.vz); }
    for (const p of sp.pos) if (p.pl != null && p.pl >= 0) add(pl(p.pl), p.x, p.y, p.z);
  }
  const med = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
  const out = new Map<string, { x: number; y: number; z: number; r: number; name: string }>();
  for (const [k, a] of acc) {
    if (a.xs.length < 3) continue;
    const x = med(a.xs), y = med(a.ys), z = med(a.zs);
    const d = a.xs.map((xi, i) => Math.hypot(xi - x, a.ys[i] - y)).sort((p, q) => p - q);
    out.set(k, { x, y, z, r: Math.max(110, Math.min(450, d[Math.floor(d.length * 0.7)] ?? 150)), name: a.name });
  }
  return out;
}

/** Trouve un callout par nom souple (« A site », « BombsiteA », « mid » -> Middle). */
export function findCallout(centers: ReturnType<typeof calloutCenters>, name: string) {
  const n = norm(name).replace(/^bombsite/, '').replace(/site$/, '');
  const direct = centers.get(norm(name)) ?? centers.get(`bombsite${n}`);
  if (direct) return direct;
  for (const [k, c] of centers) if (k.includes(n) || norm(placeLabel(c.name)).includes(n) || (n.length >= 3 && n.includes(k))) return c;
  return null;
}
