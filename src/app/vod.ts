// VOD (YouTube / Twitch) liée à une démo : adresse et décalage (temps VOD = temps démo + décalage).

import { scopedKey } from './profiles';
import { createLocalStore } from './local-store';

export interface VodLink { url: string; offset: number }
export const vodStore = createLocalStore<Record<string, VodLink>>(scopedKey('scrimview.vods'), {}, (v) => typeof v === 'object' && v !== null);

export type VodSource = { kind: 'youtube'; id: string } | { kind: 'twitch'; id: string };
export function parseVod(url: string): VodSource | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^(www|m)\./, '');
    if (host === 'youtu.be') return { kind: 'youtube', id: u.pathname.slice(1).split('/')[0] };
    if (host === 'youtube.com') {
      const v = u.searchParams.get('v') ?? (/^\/(live|embed|shorts)\/([\w-]+)/.exec(u.pathname)?.[2] ?? null);
      return v ? { kind: 'youtube', id: v } : null;
    }
    if (host === 'twitch.tv') { const m = /^\/videos\/(\d+)/.exec(u.pathname); return m ? { kind: 'twitch', id: m[1] } : null; }
  } catch { /* adresse invalide */ }
  return null;
}

/** "1:02:33", "62:33", "3753" -> secondes ; null si illisible. */
export function parseClock(s: string): number | null {
  const parts = s.trim().split(':').map((x) => x.trim());
  if (!parts.length || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
