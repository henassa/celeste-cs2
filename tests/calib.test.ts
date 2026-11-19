// Tests du parseur de collage et de l'étalonnage (régression ridge + validation croisée).

import { describe, expect, it } from 'vitest';
import { parseReferencePaste } from '../src/calib/paste';
import { fitModel, predictStats } from '../src/calib/model';
import type { LibraryMatch } from '../src/library/library';
import type { PlayerStats } from '../src/stats/compute';

const players = [
  { steamid: '1', name: 'Vitality ZywOo' },
  { steamid: '2', name: 'apEX' },
  { steamid: '3', name: 'ropz' },
  { steamid: '4', name: 'flameZ' },
];

describe('parseReferencePaste', () => {
  it('lit un tableau HLTV (une ligne par joueur, rating en dernier)', () => {
    const text = `Player\tK-D\t+/-\tADR\tKAST\tSwing\tRating 3.0
ZywOo\t25-14\t+11\t98.2\t80.0%\t+4.10%\t1.45
apEX\t12-18\t-6\t61.4\t66.7%\t-1.20%\t0.82
ropz 20-15 +5 85.0 75.0% +2.30% 1.21`;
    const r = parseReferencePaste(text, players);
    expect(r.find((x) => x.steamid === '1')?.value).toBe(1.45);
    expect(r.find((x) => x.steamid === '2')?.value).toBe(0.82);
    expect(r.find((x) => x.steamid === '3')?.value).toBe(1.21);
    expect(r.find((x) => x.steamid === '4')?.value).toBeNull();
  });

  it('lit un tableau copié cellule par cellule (une valeur par ligne)', () => {
    const text = ['flameZ', '18', '16', '4', '79.5', '72%', '1,08', 'apEX', '10', '19', '0,74'].join('\n');
    const r = parseReferencePaste(text, players);
    expect(r.find((x) => x.steamid === '4')?.value).toBe(1.08);
    expect(r.find((x) => x.steamid === '2')?.value).toBe(0.74);
  });

  it('ignore pourcentages et valeurs signées', () => {
    const r = parseReferencePaste('ropz +1.25 12.50% 0.97', players);
    expect(r.find((x) => x.steamid === '3')?.value).toBe(0.97);
  });
});

function fakeStats(i: number, kpr: number, dpr: number): PlayerStats {
  const rounds = 24;
  return {
    player: i, name: `p${i}`, team: (i % 2) as 0 | 1, rounds,
    kills: Math.round(kpr * rounds), deaths: Math.round(dpr * rounds), assists: 3, flashAssists: 0, headshots: 5, teamKills: 0,
    damage: kpr * rounds * 110, utilityDamage: 50, survived: rounds - Math.round(dpr * rounds), kastRounds: 17,
    entryKills: 2, entryDeaths: 2, tradeKills: 2, tradedDeaths: 1,
    clutches: Array.from({ length: 6 }, () => ({ attempts: 0, wins: 0 })), multi: [0, 8, 3, 1, 0, 0],
    enemiesFlashed: 3, blindTime: 5, teamFlashed: 0, thrown: { smoke: 5, flash: 5, he: 3, molotov: 3, decoy: 0 }, swingSum: (kpr - dpr) * 2, ecoKills: kpr * rounds, ecoDamage: kpr * rounds * 110,
    adr: kpr * 110, kast: 70, hsPct: 40, kpr, dpr, apr: 3 / rounds, swing: ((kpr - dpr) * 2 / rounds) * 100, ecoKpr: kpr, ecoAdr: kpr * 110, impact: 1, rating1: 1, rating2: 1,
  };
}

describe('fitModel', () => {
  it('retrouve une relation linéaire simple et mesure une erreur faible', () => {
    const matches: LibraryMatch[] = [];
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let m = 0; m < 4; m++) {
      const stats: PlayerStats[] = [];
      const refs: Record<string, number> = {};
      for (let i = 0; i < 10; i++) {
        const kpr = 0.4 + rnd() * 0.6, dpr = 0.45 + rnd() * 0.4;
        stats.push(fakeStats(i, kpr, dpr));
        refs[`s${m}-${i}`] = 1 + 1.2 * (kpr - 0.7) - 0.9 * (dpr - 0.65); // « vrai » rating de référence
      }
      matches.push({
        id: `m${m}`, statsVersion: 2, fileName: '', map: 'de_mirage', date: 0, importedAt: 0, source: 'faceit', teams: ['A', 'B'], score: [13, 10], rounds: 24,
        players: stats.map((_, i) => ({ steamid: `s${m}-${i}`, name: `p${i}`, team: (i % 2) as 0 | 1 })),
        stats: { all: stats, ct: [], t: [] }, refs: { faceit: refs },
      });
    }
    const model = fitModel('faceit', matches, 0.5)!;
    expect(model).not.toBeNull();
    expect(model.matches).toBe(4);
    expect(model.cvMae).toBeLessThan(0.05);
    const s = fakeStats(0, 0.9, 0.5);
    expect(predictStats(model, s)).toBeCloseTo(1 + 1.2 * 0.2 - 0.9 * -0.15, 1);
  });

  it('refuse d’étalonner avec trop peu de données', () => {
    expect(fitModel('hltv3', [])).toBeNull();
  });
});

describe('robustesse', () => {
  it('ignore les matchs analysés par une ancienne version (stats incomplètes)', () => {
    const old = { id: 'old', fileName: '', map: 'x', date: 0, importedAt: 0, source: 'other', teams: ['A', 'B'], score: [0, 0], rounds: 24,
      players: [{ steamid: 'a', name: 'a', team: 0 }], stats: { all: [{ player: 0, rounds: 24, kpr: 1 } as unknown as PlayerStats], ct: [], t: [] },
      refs: { hltv3: { a: 1.1 } } } as LibraryMatch;
    expect(fitModel('hltv3', [old, { ...old, id: 'old2' }])).toBeNull();
  });
});
