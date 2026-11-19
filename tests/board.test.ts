// Tests du tableau tactique (sans navigateur : la sauvegarde échoue en silence).

import { describe, expect, it } from 'vitest';
import { BoardStore } from '../src/board/store';
import { newBoard, parseBoardFile } from '../src/board/types';

describe('BoardStore', () => {
  it('place des joueurs numérotés, copie les jetons à la nouvelle étape, annule', () => {
    const s = new BoardStore(newBoard('de_mirage', 'Test'));
    s.addToken('ct', 100, 100);
    s.addToken('ct', 200, 100);
    s.addToken('t', 300, 300);
    expect(s.current.tokens.map((t) => t.label)).toEqual(['1', '2', '1']);
    s.addToken('bomb', 10, 10);
    s.addToken('bomb', 20, 20);
    expect(s.current.tokens.filter((t) => t.kind === 'bomb')).toHaveLength(1);
    const ids = s.current.tokens.map((t) => t.id);
    s.addStep();
    expect(s.step).toBe(1);
    expect(s.current.tokens.map((t) => t.id)).toEqual(ids); // mêmes id : animation possible
    s.beginMove(); s.moveTokenLive(ids[0], 500, 500); s.endMove();
    expect(s.board.steps[0].tokens[0].x).toBe(100); // l'étape 1 n'est pas touchée
    s.undo();
    expect(s.current.tokens[0].x).toBe(100);
  });
  it('dessine une flèche et la gomme', () => {
    const s = new BoardStore(newBoard('de_nuke', 'Test'));
    s.setTool('arrow');
    s.beginStroke(0, 0); s.extendStroke(100, 0); s.endStroke();
    expect(s.current.strokes).toHaveLength(1);
    s.eraseAt(50, 4, 10);
    expect(s.current.strokes).toHaveLength(0);
  });
  it('relit un fichier .board et refuse le reste', () => {
    const b = newBoard('de_inferno', 'Exec B');
    b.steps[0].tokens.push({ id: 'a', kind: 't', x: 1, y: 2, label: '1' });
    const back = parseBoardFile(JSON.stringify(b));
    expect(back.map).toBe('de_inferno');
    expect(back.steps[0].tokens).toHaveLength(1);
    expect(back.id).not.toBe(b.id); // import = nouvelle copie
    expect(() => parseBoardFile('{"foo":1}')).toThrow();
  });
});
