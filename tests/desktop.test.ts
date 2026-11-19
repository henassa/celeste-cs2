// Mise en place de l'app de bureau : maps installées (jeu + workshop), calibration des maps ajoutées,
// décompression de l'outil d'extraction, et « notre côté » d'un match (mon équipe).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
// @ts-expect-error module JS des scripts
import { listInstalledMaps, parseOverview, unzip } from '../scripts/lib/cs2.mjs';
import { ourSide } from '../src/app/my-team';
import type { LibraryMatch } from '../src/library/library';

describe('app de bureau', () => {
  it('liste les maps du jeu et du workshop', () => {
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-'));
    const cs2 = path.join(lib, 'steamapps/common/Counter-Strike Global Offensive');
    fs.mkdirSync(path.join(cs2, 'game/csgo/maps'), { recursive: true });
    for (const f of ['de_mirage.vpk', 'de_dust2_vanity.vpk', 'cs_office.vpk', 'lobby_mapveto.vpk']) fs.writeFileSync(path.join(cs2, 'game/csgo/maps', f), '');
    fs.mkdirSync(path.join(lib, 'steamapps/workshop/content/730/123'), { recursive: true });
    fs.writeFileSync(path.join(lib, 'steamapps/workshop/content/730/123/de_cbble_classic.vpk'), '');
    const maps = listInstalledMaps(cs2) as { name: string; source: string; id?: string }[];
    expect(maps.map((m) => m.name).sort()).toEqual(['cs_office', 'de_cbble_classic', 'de_mirage']);
    expect(maps.find((m) => m.name === 'de_cbble_classic')).toMatchObject({ source: 'workshop', id: '123' });
  });

  it('lit la calibration d\'un aperçu de map', () => {
    const txt = `"de_cbble"\n{\n\t"material" "overviews/de_cbble"\n\t"pos_x" "-3840"\n\t"pos_y" "3072"\n\t"scale" "6"\n}`;
    expect(parseOverview(txt)).toEqual({ posX: -3840, posY: 3072, scale: 6, lowerThresholdZ: null, hasLower: false });
    expect(parseOverview('"x" { "pos_x" "1" }')).toBeNull();
  });

  it('décompresse un .zip sans outil externe', () => {
    // Petit zip construit à la main : un fichier compressé (deflate)
    const data = Buffer.from('hello scrimview '.repeat(20));
    const comp = zlib.deflateRawSync(data);
    const name = Buffer.from('dir/a.txt');
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
    const cdOff = local.length + name.length + comp.length;
    const cd = Buffer.concat([central, name]);
    const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(cdOff, 16);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
    fs.writeFileSync(path.join(dir, 'x.zip'), Buffer.concat([local, name, comp, cd, eocd]));
    unzip(path.join(dir, 'x.zip'), path.join(dir, 'out'));
    expect(fs.readFileSync(path.join(dir, 'out/dir/a.txt'), 'utf8')).toBe(data.toString());
  });

  it('trouve notre côté dans un match', () => {
    const players = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ steamid: `s${i}`, name: `p${i}`, team: (i < 5 ? 0 : 1) as 0 | 1 }));
    const m = { players, score: [13, 9] } as unknown as LibraryMatch;
    const team = (ids: string[]) => ({ name: 'x', logo: null, players: ids.map((s) => ({ steamid: s, name: s })) });
    expect(ourSide(m, team(['s6', 's7', 's8', 'other']))).toBe(1);
    expect(ourSide(m, team(['s0', 's1']))).toBe(0);
    expect(ourSide(m, team(['s0', 's6', 'zz']))).toBeNull();
    expect(ourSide(m, team([]))).toBeNull();
  });
});
