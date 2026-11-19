// Calendrier, playbook et VOD : fonctions pures (le stockage local est simulé).
import { describe, expect, it, beforeAll } from 'vitest';

beforeAll(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, length: 0 } as Storage;
});

describe('calendrier', () => {
  it('prochains événements dans l\'ordre, à partir d\'aujourd\'hui', async () => {
    const { upcoming, dayKey } = await import('../src/app/calendar');
    const now = new Date(2026, 10, 19, 12);
    const ev = (day: string, time: string) => ({ id: day + time, day, time, kind: 'scrim' as const, opponent: '', map: '', notes: '' });
    const list = upcoming([ev('2026-11-25', '20:00'), ev('2026-11-18', '20:00'), ev('2026-11-19', '21:00'), ev('2026-11-19', '18:00')], now);
    expect(list.map((e) => e.id)).toEqual(['2026-11-1918:00', '2026-11-1921:00', '2026-11-2520:00']);
    expect(dayKey(now)).toBe('2026-11-19');
  });
});

describe('playbook', () => {
  it('ajoute des moments, exporte et réimporte', async () => {
    const { newPlay, savePlay, addClip, playbookStore, exportPlaybook, importPlaybook } = await import('../src/app/playbook');
    const p = { ...newPlay('de_mirage', 't'), name: 'A split' };
    savePlay(p);
    addClip(p.id, { demoId: 'de_mirage-1', fileName: 'x.dem', round: 4, tick: 1000, label: 'clean' });
    expect(playbookStore.get()[0].clips).toHaveLength(1);
    const file = exportPlaybook(playbookStore.get());
    playbookStore.set([]);
    expect(importPlaybook(file)).toBe(1);
    expect(playbookStore.get()[0]).toMatchObject({ name: 'A split', map: 'de_mirage', side: 't' });
    expect(() => importPlaybook('{"app":"other"}')).toThrow();
  });
});

describe('VOD', () => {
  it('reconnaît YouTube et Twitch, lit les temps', async () => {
    const { parseVod, parseClock, formatClock } = await import('../src/app/vod');
    expect(parseVod('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toEqual({ kind: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(parseVod('https://youtu.be/abc123')).toEqual({ kind: 'youtube', id: 'abc123' });
    expect(parseVod('https://www.youtube.com/live/xyz')).toEqual({ kind: 'youtube', id: 'xyz' });
    expect(parseVod('https://www.twitch.tv/videos/2299887766')).toEqual({ kind: 'twitch', id: '2299887766' });
    expect(parseVod('https://example.com/v')).toBeNull();
    expect(parseClock('1:02:33')).toBe(3753);
    expect(parseClock('62:33')).toBe(3753);
    expect(parseClock('abc')).toBeNull();
    expect(formatClock(3753)).toBe('1:02:33');
    expect(formatClock(75)).toBe('1:15');
  });
});
