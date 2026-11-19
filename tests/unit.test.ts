// Tests unitaires sans démo (tournent aussi en CI).

import { describe, expect, it } from 'vitest';
import { formatClock } from '../src/viewer/sample';
import { killfeedWeapon, mainWeaponOf } from '../src/parser/weapons';
import { getMap, isLower, worldToRadar } from '../src/maps/maps';

describe('weapons', () => {
  it('choisit l’arme principale', () => {
    expect(mainWeaponOf(['Butterfly Knife', 'Glock-18', 'AK-47', 'Flashbang'])).toBe('AK-47');
    expect(mainWeaponOf(['knife', 'USP-S', 'Smoke Grenade'])).toBe('USP-S');
    expect(mainWeaponOf(['knife_t', 'C4 Explosive'])).toBeNull();
  });
  it('nomme les armes du kill feed', () => {
    expect(killfeedWeapon('knife_stiletto')).toBe('Knife');
    expect(killfeedWeapon('m4a1_silencer')).toBe('M4A1-S');
    expect(killfeedWeapon('weapon_awp')).toBe('AWP');
  });
});

describe('maps', () => {
  it('convertit monde -> radar', () => {
    const m = getMap('de_mirage')!;
    expect(worldToRadar(m, m.posX, m.posY)).toEqual([0, 0]);
    expect(worldToRadar(m, m.posX + 5 * m.scale, m.posY - 10 * m.scale)).toEqual([5, 10]);
  });
  it('détecte le niveau inférieur', () => {
    const nuke = getMap('de_nuke')!;
    expect(isLower(nuke, -600)).toBe(true);
    expect(isLower(nuke, 0)).toBe(false);
    expect(isLower(getMap('de_mirage')!, -600)).toBe(false);
  });
});

describe('clock', () => {
  it('formate le chrono', () => {
    expect(formatClock(115)).toBe('1:55');
    expect(formatClock(9.2)).toBe('0:10');
  });
});

import { hltvRating1, hltvRating2, hltvImpact } from '../src/stats/compute';
import { winProbabilityT } from '../src/stats/win-probability';

describe('ratings', () => {
  it('HLTV 1.0 vaut 1.00 pour un joueur exactement dans la moyenne de référence', () => {
    // 1000 rounds, KPR 0,679, survie 0,317, multi-kill 1,277 -> 1,00
    const rounds = 1000;
    const r = hltvRating1({ rounds, kills: 679, deaths: rounds - 317, multi: [0, 1277, 0, 0, 0, 0] });
    expect(r).toBeCloseTo(1, 3);
  });
  it('HLTV 2.0≈ reste autour de 1 pour une ligne moyenne', () => {
    const kpr = 0.68, apr = 0.13, dpr = 0.66;
    expect(hltvRating2(72, kpr, dpr, hltvImpact(kpr, apr), 78)).toBeGreaterThan(0.9);
    expect(hltvRating2(72, kpr, dpr, hltvImpact(kpr, apr), 78)).toBeLessThan(1.1);
  });
  it('probabilité de victoire : cohérente et bornée', () => {
    const base = { equipT: 20000, equipCT: 20000, bombPlanted: false, timeLeft: 80 };
    expect(winProbabilityT({ ...base, aliveT: 5, aliveCT: 5 })).toBeCloseTo(0.5, 2);
    const p54 = winProbabilityT({ ...base, aliveT: 5, aliveCT: 4, equipCT: 16000 });
    expect(p54).toBeGreaterThan(0.65);
    expect(p54).toBeLessThan(0.75);
    expect(winProbabilityT({ ...base, aliveT: 2, aliveCT: 2, bombPlanted: true })).toBeGreaterThan(0.6);
    expect(winProbabilityT({ ...base, aliveT: 0, aliveCT: 3 })).toBe(0);
    expect(winProbabilityT({ ...base, aliveT: 3, aliveCT: 0 })).toBe(1);
  });
});

import { placeLabel, setposCommand } from '../src/viewer/places';
describe('callouts et setpos', () => {
  it('rend les callouts lisibles', () => {
    expect(placeLabel('TopofMid')).toBe('Top of Mid');
    expect(placeLabel('CTSpawn')).toBe('CT Spawn');
    expect(placeLabel('BombsiteA')).toBe('Bombsite A');
    expect(placeLabel('SnipersNest')).toBe('Snipers Nest');
    expect(placeLabel('')).toBe('');
  });
  it('formate setpos / setang', () => {
    expect(setposCommand(1.234, -2, 3.5, -10, 90)).toBe('setpos 1.23 -2.00 3.50;setang -10.00 90.00 0.00');
  });
});

import { techLabel } from '../src/analysis/lineups';
describe('technique de lancer', () => {
  it('décrit le lancer', () => {
    expect(techLabel('stand')).toBe('Standing throw');
    expect(techLabel('stand+jump')).toBe('Jump throw');
    expect(techLabel('run+jump')).toBe('Running jump throw');
    expect(techLabel('walk+crouch')).toBe('Walking throw, crouched');
  });
});

import { compareMaps, mapPool, simulateVeto, UNPLAYED_STRENGTH } from '../src/analysis/veto';
import type { LibraryMatch } from '../src/library/library';
describe('map pool et veto', () => {
  const steam = (t: number, i: number) => `${t}${i}`;
  const fake = (id: string, map: string, us: number, them: number): LibraryMatch => ({
    id, map, date: 1, score: [us, them], players: [0, 1, 2, 3, 4].map((i) => ({ steamid: steam(0, i), name: `p${i}`, team: 0 as const })),
    spatial: { version: 3, kills: [], nades: [], pos: [], rounds: Array.from({ length: us + them }, (_, i) => ({ i, ctTeam: (i < 12 ? 0 : 1) as 0 | 1, winner: (i < us ? 0 : 1) as 0 | 1, reason: '', plantSite: null, plantT: null, buy: ['full', 'full'], equip: [0, 0], firstKill: null })) },
  } as unknown as LibraryMatch);
  const subject = { kind: 'player' as const, steamid: '00' };
  it('estime la force par carte et ramène les petits échantillons vers 50 %', () => {
    const pool = mapPool([fake('a', 'de_mirage', 13, 3), fake('b', 'de_nuke', 3, 13)], subject);
    expect(pool.get('de_mirage')!.wins).toBe(1);
    expect(pool.get('de_mirage')!.strength).toBeGreaterThan(0.6);
    expect(pool.get('de_mirage')!.strength).toBeLessThan(13 / 16);
    expect(pool.get('de_nuke')!.strength).toBeLessThan(0.4);
  });
  it('simule un veto BO3 : on bannit notre pire carte, on choisit la meilleure, decider à la fin', () => {
    const us = mapPool([fake('a', 'de_mirage', 13, 3), fake('b', 'de_nuke', 3, 13), fake('c', 'de_inferno', 13, 10)], subject);
    const pool = ['de_ancient', 'de_anubis', 'de_cache', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke'];
    const rows = compareMaps(pool, us, new Map());
    expect(rows[0].map).toBe('de_mirage');
    expect(rows.find((r) => r.map === 'de_ancient')!.edge).toBeCloseTo(0, 5); // jamais jouée des deux côtés
    void UNPLAYED_STRENGTH;
    const steps = simulateVeto(rows, 'bo3', 'us');
    expect(steps).toHaveLength(7);
    expect(steps[0]).toMatchObject({ team: 'us', action: 'ban', map: 'de_nuke' });
    expect(steps[1]).toMatchObject({ team: 'them', action: 'ban', map: 'de_mirage' });
    expect(steps[2]).toMatchObject({ team: 'us', action: 'pick', map: 'de_inferno' });
    expect(steps[6].action).toBe('decider');
    expect(new Set(steps.map((s) => s.map)).size).toBe(7);
  });
});

import { detectSeries } from '../src/analysis/series';
describe('séries', () => {
  const mk = (id: string, map: string, date: number, swap: boolean, score: [number, number], file = `${id}.dem`): LibraryMatch => {
    const a = ['a1', 'a2', 'a3', 'a4', 'a5'], b = ['b1', 'b2', 'b3', 'b4', 'b5'];
    const players = [...(swap ? b : a), ...(swap ? a : b)].map((sid, i) => ({ steamid: sid, name: sid, team: (i < 5 ? 0 : 1) as 0 | 1 }));
    return { id, map, date, fileName: file, score, teams: swap ? ['B', 'A'] : ['A', 'B'], players, stats: { all: players.map((_, i) => ({ player: i, rounds: 20 })), ct: [], t: [] } } as unknown as LibraryMatch;
  };
  it('regroupe un BO3 même quand les équipes changent d\'index', () => {
    const h = 3600e3;
    const lib = [mk('m1', 'de_mirage', 0, false, [13, 9]), mk('m2', 'de_nuke', 1.2 * h, true, [13, 7]), mk('m3', 'de_inferno', 2.5 * h, false, [13, 11]), mk('x', 'de_dust2', 30 * h, false, [13, 2])];
    const s = detectSeries(lib);
    expect(s).toHaveLength(1);
    expect(s[0].maps.map((x) => x.match.id)).toEqual(['m1', 'm2', 'm3']);
    expect(s[0].maps[1].teamA).toBe(1);
    expect(s[0].score).toEqual([2, 1]);
    expect(s[0].format).toBe('BO3');
  });
  it('utilise le nom de fichier ...-m1 / -m2 quand les dates sont éloignées', () => {
    const lib = [mk('p', 'de_ancient', 0, false, [13, 5], 'spirit-vs-mouz-m2-ancient.dem'), mk('q', 'de_mirage', 99e9, false, [10, 13], 'spirit-vs-mouz-m1-mirage.dem')];
    const s = detectSeries(lib);
    expect(s).toHaveLength(1);
    expect(s[0].maps.map((x) => x.match.map)).toEqual(['de_mirage', 'de_ancient']);
  });
});

import { aimError, isGun } from '../src/stats/aim';
describe('aim', () => {
  it('angle nul quand on regarde la tête, 90° quand on regarde à côté', () => {
    expect(aimError(0, 0, 0, 0, 0, 1000, 0, 0)).toBeCloseTo(0, 5);
    expect(aimError(0, 0, 0, 0, 90, 1000, 0, 0)).toBeCloseTo(90, 5);
    // pitch positif = regarder vers le bas (convention Source)
    expect(aimError(0, 0, 0, 45, 0, 1000, 0, -1000)).toBeCloseTo(0, 3);
  });
  it('reconnaît les armes à feu dans les deux formats de nom', () => {
    expect(isGun('weapon_ak47')).toBe(true);
    expect(isGun('ak47')).toBe(true);
    expect(isGun('weapon_knife_karambit')).toBe(false);
    expect(isGun('inferno')).toBe(false);
    expect(isGun('weapon_nova')).toBe(false);
  });
});

import { faceit, matchIdFromFileName, resultFor, FaceitError } from '../src/faceit/api';
describe('FACEIT', () => {
  const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  it('lit le profil et l\'historique avec la clé dans l\'en-tête', async () => {
    let auth = '';
    const f = (async (_url: string, init: RequestInit) => { auth = (init.headers as Record<string, string>).Authorization; return new Response(JSON.stringify({ player_id: 'p1', nickname: 'henassa', games: { cs2: { faceit_elo: 2100, skill_level: 9 } } })); }) as unknown as typeof fetch;
    const p = await faceit.player('henassa', 'KEY', f);
    expect(auth).toBe('Bearer KEY');
    expect(p.games?.cs2?.faceit_elo).toBe(2100);
    const h = await faceit.history('p1', 'KEY', 20, ok({ items: [{ match_id: '1-abc', started_at: 1, finished_at: 2, teams: { faction1: { team_id: 'a', nickname: 'team_me', players: [{ player_id: 'p1', nickname: 'henassa' }] }, faction2: { team_id: 'b', nickname: 'team_x', players: [] } }, results: { winner: 'faction1', score: { faction1: 13, faction2: 9 } } }] }));
    expect(resultFor(h[0], 'p1')).toMatchObject({ won: true, score: '13–9', theirs: 'team_x' });
  });
  it('explique les refus et les blocages réseau', async () => {
    await expect(faceit.player('x', 'BAD', (async () => new Response('', { status: 401 })) as unknown as typeof fetch)).rejects.toThrow(/refused the key/);
    await expect(faceit.player('x', 'K', (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch)).rejects.toBeInstanceOf(FaceitError);
  });
  it('lit les stats d\'un match et retrouve l\'id de match dans un nom de fichier', async () => {
    const st = await faceit.matchStats('m', 'K', ok({ rounds: [{ round_stats: { Map: 'de_mirage' }, teams: [{ players: [{ player_id: 'p1', nickname: 'h', player_stats: { Kills: '24', ADR: '98.1' } }] }] }] }));
    expect(st.map).toBe('de_mirage');
    expect(st.players[0].stats.Kills).toBe('24');
    expect(matchIdFromFileName('1-cb038819-b0d0-4471-b25c-0e7468ab1eb1-1-1.dem.zst')).toBe('1-cb038819-b0d0-4471-b25c-0e7468ab1eb1');
    expect(matchIdFromFileName('faceit1.dem')).toBeNull();
  });
});

import { chat, DEFAULT_SETTINGS, CoachError } from '../src/coach/providers';
describe('coach : fournisseurs', () => {
  const stream = (chunks: string[]) => new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } }), { status: 200 });
  it('lit le flux Ollama (NDJSON) morceau par morceau', async () => {
    const seen: string[] = [];
    const f = (async () => stream(['{"message":{"content":"Bon"}}\n{"message":{"con', 'tent":"jour"}}\n{"done":true}\n'])) as unknown as typeof fetch;
    const out = await chat({ ...DEFAULT_SETTINGS, kind: 'ollama' }, [{ role: 'user', content: 'x' }], (t) => seen.push(t), undefined, f);
    expect(out).toBe('Bonjour');
    expect(seen).toEqual(['Bon', 'Bonjour']);
  });
  it('lit le flux SSE OpenAI et envoie la clé', async () => {
    let auth = '';
    const f = (async (_u: string, init: RequestInit) => { auth = (init.headers as Record<string, string>).Authorization; return stream(['data: {"choices":[{"delta":{"content":"R5"}}]}\n\n', 'data: {"choices":[{"delta":{"content":" lost"}}]}\n\ndata: [DONE]\n\n']); }) as unknown as typeof fetch;
    const out = await chat({ ...DEFAULT_SETTINGS, kind: 'openai', apiKey: 'sk-test' }, [{ role: 'user', content: 'x' }], () => {}, undefined, f);
    expect(out).toBe('R5 lost');
    expect(auth).toBe('Bearer sk-test');
  });
  it('explique les erreurs courantes', async () => {
    await expect(chat({ ...DEFAULT_SETTINGS, kind: 'openai', apiKey: '' }, [], () => {})).rejects.toBeInstanceOf(CoachError);
    await expect(chat({ ...DEFAULT_SETTINGS, kind: 'ollama' }, [], () => {}, undefined, (async () => { throw new TypeError('x'); }) as unknown as typeof fetch)).rejects.toThrow(/OLLAMA_ORIGINS/);
    await expect(chat({ ...DEFAULT_SETTINGS, kind: 'openai', apiKey: 'k' }, [], () => {}, undefined, (async () => new Response('', { status: 429 })) as unknown as typeof fetch)).rejects.toThrow(/quota/);
  });
});

import { contourSegments, DEFAULT_DENSITY, densityField } from '../src/analysis/density';
describe('densité des heatmaps', () => {
  it('champ lissé, normalisé, avec lignes de niveau', () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 200; i++) pts.push([500 + (i % 7), 500 + (i % 5)]);
    pts.push([100, 100]);
    const f = densityField(pts, 128, DEFAULT_DENSITY);
    const at = (x: number, y: number) => f[Math.floor(y / 8) * 128 + Math.floor(x / 8)];
    expect(at(503, 502)).toBeCloseTo(1, 1);
    expect(at(100, 100)).toBeGreaterThan(0);
    expect(at(100, 100)).toBeLessThan(at(503, 502));
    expect(at(900, 900)).toBe(0);
    for (const v of f) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(contourSegments(f, 128, 0.5).length).toBeGreaterThan(8);
    // Échelle log : les zones faibles ressortent davantage
    const g = densityField(pts, 128, { ...DEFAULT_DENSITY, scale: 'log' });
    expect(g[Math.floor(100 / 8) * 128 + Math.floor(100 / 8)]).toBeGreaterThan(at(100, 100));
  });
});

import zlib from 'node:zlib';
import fsMod from 'node:fs';
import { decodeGeometry } from '../src/three/map-scene';
import { NAV_MAPS } from '../src/three/nav-maps';
describe('modèles 3D des cartes', () => {
  it('chaque carte annoncée a un modèle lisible, dans la zone du radar', async () => {
    const maps = (await import('../src/maps/maps.json')).default as Record<string, { posX: number; posY: number; scale: number }>;
    for (const name of NAV_MAPS) {
      const raw = zlib.gunzipSync(fsMod.readFileSync(`public/geo/${name}.bin.gz`));
      const g = decodeGeometry(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
      expect(g.floor.length, name).toBeGreaterThan(10000 * 3);
      expect(g.wall.length, name).toBeGreaterThan(10000 * 3);
      const n = g.pos.length / 3;
      for (const t of [g.floor, g.wall]) for (let i = 0; i < t.length; i += 997) expect(t[i]).toBeLessThan(n);
      const cal = maps[name];
      let inside = 0;
      for (let i = 0; i < n; i += 50) {
        const px = (g.pos[i * 3] - cal.posX) / cal.scale, py = (cal.posY - g.pos[i * 3 + 1]) / cal.scale;
        if (px >= -10 && px <= 1034 && py >= -10 && py <= 1034) inside++;
      }
      expect(inside / Math.ceil(n / 50), name).toBeGreaterThan(0.98);
    }
  });
});

import { ScrimStore as _Scrim } from '../src/scrim/store';
describe('dessin : Maj et annulation', () => {
  it('ligne par pas de 45°, rectangle carré, tracé abandonné', () => {
    const s = new _Scrim();
    s.setTool('line');
    s.beginStroke('line', 100, 100, 0, 0, 1000, 'upper');
    s.extendStroke(200, 112, true);
    expect(s.draft!.points[1][1]).toBeCloseTo(100, 5); // horizontal
    s.extendStroke(200, 190, true);
    const [x, y] = s.draft!.points[1];
    expect(Math.abs(x - 100)).toBeCloseTo(Math.abs(y - 100), 5); // 45°
    expect(s.cancelStroke()).toBe(true);
    expect(s.draft).toBeNull();
    s.beginStroke('rect', 0, 0, 0, 0, 1000, 'upper');
    s.extendStroke(50, 20, true);
    expect(s.draft!.points[1]).toEqual([50, 50]);
    s.endStroke();
    expect(s.doc.annotations).toHaveLength(1);
  });
});
