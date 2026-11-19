// Tests du store de scrim (sans navigateur : IndexedDB absent -> travail en mémoire).

import { describe, expect, it } from 'vitest';
import { ScrimStore, distanceToAnnotation } from '../src/scrim/store';
import { parseScrimFile } from '../src/scrim/storage';

const demo = { id: 'de_mirage-test', fileName: 'test.dem', map: 'de_mirage', rounds: 24 };

describe('ScrimStore', () => {
  it('dessine, efface, annule et rétablit', () => {
    const s = new ScrimStore(demo);
    s.beginStroke('arrow', 100, 100, 1000, 0, 5000, 'upper');
    s.extendStroke(200, 150);
    s.endStroke();
    expect(s.doc.annotations).toHaveLength(1);
    expect(s.doc.annotations[0].points).toEqual([[100, 100], [200, 150]]);
    // Visible pendant le round, sur le bon niveau seulement
    expect(s.visible(1200, 'upper')).toHaveLength(1);
    expect(s.visible(1200, 'lower')).toHaveLength(0);
    expect(s.visible(900, 'upper')).toHaveLength(0);
    // Gomme près du trait
    s.eraseAt(150, 126, 1200, 'upper', 5);
    expect(s.doc.annotations).toHaveLength(0);
    s.undo();
    expect(s.doc.annotations).toHaveLength(1);
    s.redo();
    expect(s.doc.annotations).toHaveLength(0);
  });

  it('ignore un clic sans tracé et respecte la visibilité 5 s', () => {
    const s = new ScrimStore(demo);
    s.beginStroke('rect', 10, 10, 1000, 0, 9000, 'upper');
    s.endStroke();
    expect(s.doc.annotations).toHaveLength(0);
    s.setVisibility('5s');
    s.beginStroke('circle', 10, 10, 1000, 0, 9000, 'upper');
    s.extendStroke(40, 10);
    s.endStroke();
    expect(s.doc.annotations[0].toTick).toBe(1000 + 5 * 64);
    expect(distanceToAnnotation(s.doc.annotations[0], 10, 40)).toBeCloseTo(0);
  });

  it('gère texte, marqueurs et notes', () => {
    const s = new ScrimStore(demo);
    s.requestText({ sx: 0, sy: 0, rx: 50, ry: 60, tick: 2000, round: 1, layer: 'upper' }, 6000);
    s.commitText('  stack B  ');
    expect(s.doc.annotations[0].text).toBe('stack B');
    const mk = s.addMarker(2100.4, 1);
    expect(mk.tick).toBe(2100);
    s.renameMarker(mk.id, 'Late rotate');
    expect(s.doc.markers[0].label).toBe('Late rotate');
    s.setRoundNote(2, 'Too slow on A');
    expect(s.roundHasContent(1)).toBe(true);
    expect(s.roundHasContent(5)).toBe(false);
    s.setRoundNote(2, '   ');
    expect(s.doc.roundNotes[2]).toBeUndefined();
  });

  it('exporte, réimporte et fusionne un fichier .scrim', () => {
    const a = new ScrimStore(demo);
    a.addMarker(500, 0);
    a.setRoundNote(1, 'note A');
    const file = JSON.stringify(a.doc);

    const b = new ScrimStore(demo);
    b.setRoundNote(1, 'note B');
    b.importDoc(parseScrimFile(file), 'merge');
    expect(b.doc.markers).toHaveLength(1);
    expect(b.doc.roundNotes[1]).toBe('note B\n\nnote A');
    b.importDoc(parseScrimFile(file), 'merge');
    expect(b.doc.markers).toHaveLength(1); // pas de doublon
    b.importDoc(parseScrimFile(file), 'replace');
    expect(b.doc.roundNotes[1]).toBe('note A');
  });

  it('refuse un fichier invalide', () => {
    expect(() => parseScrimFile('{"hello":1}')).toThrow();
    expect(() => parseScrimFile('not json')).toThrow();
  });
});

describe('playlist dans le fichier .scrim', () => {
  it('relit la playlist et accepte les anciens fichiers sans playlist', () => {
    const demo = { id: 'x', fileName: 'a.dem', map: 'de_nuke', rounds: 24 };
    const withList = parseScrimFile(JSON.stringify({ version: 1, demo, annotations: [], markers: [], roundNotes: {},
      playlist: [{ id: 'c1', round: 3, fromTick: 100, toTick: 900, label: 'Round 4' }, { bad: true }] }));
    expect(withList.playlist).toHaveLength(1);
    expect(withList.playlist![0].label).toBe('Round 4');
    const old = parseScrimFile(JSON.stringify({ version: 1, demo, annotations: [], markers: [], roundNotes: {} }));
    expect(old.playlist).toEqual([]);
  });
  it('ajoute, déplace et retire des extraits', () => {
    const s = new ScrimStore({ id: 'y', fileName: 'b.dem', map: 'de_nuke', rounds: 24 });
    const a = s.addClip(1, 10, 20, 'A');
    const b = s.addClip(2, 30, 40, 'B');
    s.moveClip(b.id, -1);
    expect(s.playlist.map((c) => c.label)).toEqual(['B', 'A']);
    s.undo();
    expect(s.playlist.map((c) => c.label)).toEqual(['A', 'B']);
    s.removeClip(a.id);
    expect(s.playlist.map((c) => c.label)).toEqual(['B']);
  });
});
