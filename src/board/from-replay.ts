// Crée un tableau à partir d'un instant du replay : joueurs vivants (numéro de slot), fumées et
// feux actifs, bombe posée ou au sol. Le niveau (Nuke, Vertigo...) suit celui affiché.

import { SIDE_CT, type MatchData } from '../data/types';
import { getMap, isLower, worldToRadar } from '../maps/maps';
import { playerState, roundIndexAt, roundClock, formatClock } from '../viewer/sample';
import { emptyStep, newBoard, newBoardId, type Board, type Token } from './types';

export function boardFromMoment(m: MatchData, tick: number, layer: 'upper' | 'lower'): Board {
  const cal = getMap(m.header.map);
  const ri = roundIndexAt(m, tick);
  const r = m.rounds[ri];
  const clock = r ? formatClock(roundClock(m, r, tick).remaining) : '';
  const b = newBoard(m.header.map, `${m.teams[0].name} vs ${m.teams[1].name} · R${r?.number ?? '?'} ${clock}`);
  b.layer = layer;
  const onLayer = (z: number) => !cal?.hasLower || isLower(cal, z) === (layer === 'lower');
  const pos = (x: number, y: number): [number, number] => (cal ? worldToRadar(cal, x, y) : [512, 512]);
  const tokens: Token[] = [];
  for (let p = 0; p < m.players.length; p++) {
    const st = playerState(m, p, tick);
    if (!st.present || !st.alive || !onLayer(st.z) || (st.side !== 2 && st.side !== 3)) continue;
    const [x, y] = pos(st.x, st.y);
    tokens.push({ id: newBoardId(), kind: st.side === SIDE_CT ? 'ct' : 't', x, y, label: String(m.players[p].slot) });
  }
  for (const g of m.grenades) {
    if (g.round !== ri || (g.kind !== 'smoke' && g.kind !== 'molotov') || tick < g.detonateTick || tick > g.effectEndTick || !onLayer(g.effectPos[2])) continue;
    const [x, y] = pos(g.effectPos[0], g.effectPos[1]);
    tokens.push({ id: newBoardId(), kind: g.kind, x, y });
  }
  if (r?.plant && tick >= r.plant.tick && onLayer(r.plant.z)) {
    const [x, y] = pos(r.plant.x, r.plant.y);
    tokens.push({ id: newBoardId(), kind: 'bomb', x, y });
  }
  b.steps = [{ ...emptyStep(`From replay · ${clock}`), tokens }];
  return b;
}
