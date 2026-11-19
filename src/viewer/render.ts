// Rendu du radar 2D sur canvas. Pur dessin : lit le MatchData et l'état de lecture,
// ne modifie rien. Appelé à chaque frame d'animation.

import {
  FLAG_DEFUSING, FLAG_HAS_BOMB, FLAG_PLANTING, SIDE_CT,
  type GrenadeInfo, type GrenadeKind, type KillEvent, type MatchData, type ShotEvent,
} from '../data/types';
import { isLower, worldToRadar, RADAR_SIZE, type MapCalibration } from '../maps/maps';
import type { PlaybackState } from './playback';
import { bombState, formatClock, playerState, roundClock, roundIndexAt, type PlayerState } from './sample';
import { killfeedWeapon } from '../parser/weapons';
import { scaleFont, type RenderTheme } from './theme';

// Couleurs fixes (les couleurs de thème viennent de RenderTheme)
export const COLORS = {
  flash: '#ffffff',
  he: '#ff5a4e',
  decoy: '#9aa3ad',
  bomb: '#ff4b3e',
  defused: '#4fd18b',
};



/** Rayons d'effet en unités monde (approximations visuelles). */
const RADIUS = { smoke: 144, molotov: 125, he: 220, flash: 110 };

export interface ViewTransform {
  zoom: number;
  /** Centre de la vue en coordonnées radar (0..1024). */
  cx: number;
  cy: number;
}

/** Index précalculés par round pour ne parcourir que l'utile à chaque frame. */
export class RenderCache {
  grenadesByRound: GrenadeInfo[][];
  killsByRound: KillEvent[][];
  shotsByRound: ShotEvent[][];
  constructor(m: MatchData) {
    const n = m.rounds.length;
    this.grenadesByRound = Array.from({ length: n }, () => []);
    this.killsByRound = Array.from({ length: n }, () => []);
    this.shotsByRound = Array.from({ length: n }, () => []);
    for (const g of m.grenades) this.grenadesByRound[g.round]?.push(g);
    for (const k of m.kills) this.killsByRound[k.round]?.push(k);
    for (const s of m.shots) {
      const r = roundIndexAt(m, s.tick);
      this.shotsByRound[r]?.push(s);
    }
  }
}

export interface RenderInput {
  ctx: CanvasRenderingContext2D;
  width: number; // pixels CSS
  height: number;
  match: MatchData;
  map: MapCalibration;
  state: PlaybackState;
  view: ViewTransform;
  radar: { upper: HTMLImageElement | null; lower: HTMLImageElement | null };
  cache: RenderCache;
  hover: number;
  theme: RenderTheme;
  /** Dessin par-dessus le radar (annotations du scrim), en coordonnées radar. */
  overlay?: (ctx: CanvasRenderingContext2D, toScreen: (rx: number, ry: number) => [number, number], scale: number, uiScale: number, layer: 'upper' | 'lower') => void;
  /** HUD incrusté (score, round, chrono, kills) pour les exports image / vidéo. */
  hud?: boolean;
  /** Joueurs qui parlent (comms vocales) : petites ondes à côté du jeton. */
  speaking?: Set<number>;
}

export interface RenderOutput {
  /** Positions écran des joueurs dessinés (pour le clic / survol). */
  hits: { player: number; x: number; y: number; r: number }[];
  layer: 'upper' | 'lower';
}

export function baseScale(width: number, height: number): number {
  return Math.min(width, height) / RADAR_SIZE;
}

export function render(inp: RenderInput): RenderOutput {
  const { ctx, width, height, match: m, map, state, view, radar, cache, theme: th } = inp;
  const paint = (side: number) => (side === SIDE_CT ? th.ct : th.t);
  // Grenades : neutres, sauf le feu et la HE (rouge « destructive », comme la bombe)
  const NADE_COLOR: Record<GrenadeKind, string> = { smoke: th.label, flash: th.label, decoy: th.label, he: th.fireEdge, molotov: th.fireEdge };
  /** Couleur d'accent du camp (cône, croix, lignes) : lisible sur le radar. */
  const sideColor = (side: number): string => paint(side).accent;
  const tick = state.tick;
  const tr = m.tickrate;
  const s = baseScale(width, height) * view.zoom;
  const ox = width / 2 - view.cx * s;
  const oy = height / 2 - view.cy * s;
  const toScreen = (x: number, y: number): [number, number] => {
    const [rx, ry] = worldToRadar(map, x, y);
    return [ox + rx * s, oy + ry * s];
  };
  const worldLen = (units: number) => (units / map.scale) * s;

  const ri = roundIndexAt(m, tick);
  const round = m.rounds[ri];
  const P = m.players.length;
  const states: PlayerState[] = [];
  for (let p = 0; p < P; p++) states.push(playerState(m, p, tick));

  // Niveau affiché : suit le joueur suivi sur les cartes à deux étages
  let layer = state.layer;
  if (map.hasLower && state.follow >= 0 && states[state.follow]?.alive) {
    layer = isLower(map, states[state.follow].z) ? 'lower' : 'upper';
  }
  const onLayer = (z: number) => !map.hasLower || (isLower(map, z) ? 'lower' : 'upper') === layer;

  ctx.fillStyle = th.background;
  ctx.fillRect(0, 0, width, height);
  const img = layer === 'lower' ? radar.lower : radar.upper;
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = th.radarFilter;
    ctx.drawImage(img, ox, oy, RADAR_SIZE * s, RADAR_SIZE * s);
    ctx.filter = 'none';
  }
  if (!round) return { hits: [], layer };

  const uiScale = Math.min(1.7, Math.max(0.85, Math.sqrt(view.zoom)));
  const grenades = cache.grenadesByRound[ri] ?? [];

  // --- Effets au sol : fumées et feux ---
  for (const g of grenades) {
    if (tick < g.detonateTick || tick > g.effectEndTick) continue;
    if (g.kind !== 'smoke' && g.kind !== 'molotov') continue;
    const [x, y] = toScreen(g.effectPos[0], g.effectPos[1]);
    const alpha = onLayer(g.effectPos[2]) ? 1 : 0.25;
    const rad = worldLen(g.kind === 'smoke' ? RADIUS.smoke : RADIUS.molotov);
    const grow = Math.min(1, (tick - g.detonateTick) / (tr * 0.6));
    const fadeOut = Math.min(1, (g.effectEndTick - tick) / (tr * 1.2));
    ctx.globalAlpha = alpha * Math.max(0.15, fadeOut);
    ctx.beginPath();
    ctx.arc(x, y, rad * (0.55 + 0.45 * grow), 0, Math.PI * 2);
    ctx.fillStyle = g.kind === 'smoke' ? th.smoke : th.fire;
    ctx.fill();
    // Anneau du temps restant
    const total = g.effectEndTick - g.detonateTick;
    const left = (g.effectEndTick - tick) / total;
    ctx.beginPath();
    ctx.arc(x, y, rad * (0.55 + 0.45 * grow), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    ctx.strokeStyle = g.kind === 'smoke' ? th.smokeEdge : th.fireEdge;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // --- Trajectoires et grenades en vol ---
  for (const g of grenades) {
    const trailEnd = g.detonateTick + (state.showTrails ? tr * 1.5 : 0);
    if (tick < g.throwTick || tick > trailEnd || g.pathLen === 0) continue;
    const pt = m.grenadePathTicks, xyz = m.grenadePathXYZ;
    const fade = tick > g.detonateTick ? 1 - (tick - g.detonateTick) / (tr * 1.5) : 1;
    const color = NADE_COLOR[g.kind];
    ctx.globalAlpha = Math.max(0, fade) * (onLayer(xyz[g.pathStart * 3 + 2]) ? 0.9 : 0.25);
    ctx.beginPath();
    let lastX = 0, lastY = 0, started = false;
    for (let k = g.pathStart; k < g.pathStart + g.pathLen; k++) {
      if (pt[k] > tick) break;
      const [x, y] = toScreen(xyz[k * 3], xyz[k * 3 + 1]);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      lastX = x; lastY = y;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (started && tick <= g.detonateTick) {
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3.2 * uiScale, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = th.outline;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // --- Éclats : flash et HE ---
  for (const g of grenades) {
    if (g.kind !== 'flash' && g.kind !== 'he') continue;
    const dt = (tick - g.detonateTick) / tr;
    if (dt < 0 || dt > 0.6) continue;
    const [x, y] = toScreen(g.effectPos[0], g.effectPos[1]);
    const k = dt / 0.6;
    ctx.globalAlpha = (1 - k) * (onLayer(g.effectPos[2]) ? 1 : 0.3);
    ctx.beginPath();
    ctx.arc(x, y, worldLen(g.kind === 'he' ? RADIUS.he : RADIUS.flash) * (0.3 + 0.7 * k), 0, Math.PI * 2);
    if (g.kind === 'flash') { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill(); }
    ctx.strokeStyle = NADE_COLOR[g.kind];
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // --- Bombe ---
  let carrier = -1;
  for (const st of states) if (st.alive && (st.flags & FLAG_HAS_BOMB)) carrier = st.index;
  const bomb = bombState(m, round, tick, carrier);
  if (bomb.kind !== 'hidden' && bomb.kind !== 'carried') {
    const [x, y] = toScreen(bomb.x, bomb.y);
    const r = 5 * uiScale;
    ctx.globalAlpha = onLayer(bomb.z) ? 1 : 0.35;
    if (bomb.kind === 'planted') {
      const pulse = (tick - bomb.since) / tr;
      const beat = 0.5 + 0.5 * Math.sin(pulse * Math.PI * 2 * (1 + pulse / 20));
      ctx.beginPath();
      ctx.arc(x, y, r * (2 + beat * 1.5), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 75, 62, ${0.15 + beat * 0.2})`;
      ctx.fill();
    }
    if (bomb.kind === 'exploded' && (tick - bomb.since) / tr < 1.5) {
      const k = (tick - bomb.since) / tr / 1.5;
      ctx.beginPath();
      ctx.arc(x, y, worldLen(500) * k, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 90, 60, ${1 - k})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    drawBombIcon(ctx, x, y, r, bomb.kind === 'defused' ? COLORS.defused : th.bomb, th.outline);
    ctx.globalAlpha = 1;
  }

  // --- Morts du round : croix à l'emplacement du kill ---
  const kills = cache.killsByRound[ri] ?? [];
  for (const k of kills) {
    if (k.tick > tick) break;
    const victim = m.players[k.victim];
    if (!victim) continue;
    const [x, y] = toScreen(k.victimPos[0], k.victimPos[1]);
    const side = states[k.victim]?.side || (victim.team === round.ctTeam ? SIDE_CT : 2);
    ctx.globalAlpha = onLayer(k.victimPos[2]) ? 0.75 : 0.2;
    drawCross(ctx, x, y, 4.5 * uiScale, sideColor(side), th.outline);
    ctx.globalAlpha = 1;
  }

  // --- Lignes de kill récentes ---
  for (const k of kills) {
    const dt = (tick - k.tick) / tr;
    if (dt < 0) break;
    if (dt > 1.2 || !k.killerPos) continue;
    const [x1, y1] = toScreen(k.killerPos[0], k.killerPos[1]);
    const [x2, y2] = toScreen(k.victimPos[0], k.victimPos[1]);
    ctx.globalAlpha = 1 - dt / 1.2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = sideColor(states[k.killer]?.side ?? 2);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // --- Tirs : petit trait dans l'axe du regard ---
  const shots = cache.shotsByRound[ri] ?? [];
  const shotWindow = Math.max(5, 2 * state.speed);
  for (const sh of shots) {
    if (sh.tick > tick) break;
    if (tick - sh.tick > shotWindow) continue;
    const st = states[sh.player];
    if (!st?.alive || sh.weapon.includes('grenade') || sh.weapon.includes('molotov') || sh.weapon.includes('flashbang') || sh.weapon.includes('decoy')) continue;
    const [x, y] = toScreen(st.x, st.y);
    const a = (-st.yaw * Math.PI) / 180;
    const len = 26 * uiScale;
    ctx.globalAlpha = onLayer(st.z) ? 0.9 : 0.25;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 9 * uiScale, y + Math.sin(a) * 9 * uiScale);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.strokeStyle = '#fff3c4';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // --- Joueurs ---
  const hits: RenderOutput['hits'] = [];
  const order = states.filter((st) => st.alive && st.present).sort((a, b) =>
    Number(a.index === state.follow) - Number(b.index === state.follow));
  for (const st of order) {
    const pl = m.players[st.index];
    const [x, y] = toScreen(st.x, st.y);
    const r = 7.5 * uiScale;
    const color = sideColor(st.side);
    const pp = paint(st.side);
    const visible = onLayer(st.z);
    const highlighted = st.index === state.follow || st.index === inp.hover;
    ctx.globalAlpha = visible ? 1 : 0.3;

    // Cône de vision
    const a = (-st.yaw * Math.PI) / 180;
    const fov = (42 * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r * 3.6, a - fov / 2, a + fov / 2);
    ctx.closePath();
    const grad = ctx.createRadialGradient(x, y, r, x, y, r * 3.6);
    grad.addColorStop(0, hexA(color, highlighted ? th.coneAlpha + 0.15 : th.coneAlpha));
    grad.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = grad;
    ctx.fill();

    // Flash : halo blanc
    if (st.flash > 0.1) {
      ctx.beginPath();
      ctx.arc(x, y, r + 3 + Math.min(6, st.flash * 2), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, st.flash / 3)})`;
      ctx.fill();
    }

    // Parole : deux arcs à droite du jeton
    if (inp.speaking?.has(st.index)) {
      ctx.save();
      ctx.strokeStyle = th.label;
      ctx.lineCap = 'round';
      for (const [k, alpha] of [[4.5, 0.9], [8, 0.5]] as const) {
        ctx.globalAlpha = (visible ? 1 : 0.3) * alpha;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r + k * uiScale, -Math.PI / 4, Math.PI / 4);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (highlighted) {
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = th.label;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Corps
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = pp.fill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = pp.ring;
    ctx.stroke();

    // Vie : arc sombre sur la partie perdue
    if (st.hp < 100) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r - 0.75, -Math.PI / 2 + (Math.PI * 2 * st.hp) / 100, Math.PI * 1.5);
      ctx.closePath();
      ctx.globalAlpha *= 0.5;
      ctx.fillStyle = pp.ink;
      ctx.fill();
      ctx.globalAlpha = visible ? 1 : 0.3;
    }

    // Numéro
    ctx.fillStyle = pp.ink;
    ctx.font = scaleFont(th.fontNumber, uiScale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(pl.slot), x, y + 0.5);

    // Bombe portée / action en cours
    if (st.flags & FLAG_HAS_BOMB) drawBombIcon(ctx, x + r * 0.9, y + r * 0.9, 3.4 * uiScale, th.bomb, th.outline);
    if (st.flags & (FLAG_DEFUSING | FLAG_PLANTING)) {
      ctx.beginPath();
      ctx.arc(x, y, r + 7, 0, Math.PI * 2);
      ctx.strokeStyle = st.flags & FLAG_DEFUSING ? COLORS.defused : th.bomb;
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (state.showNames || highlighted) {
      ctx.font = scaleFont(th.fontLabel, Math.min(uiScale, 1.3));
      ctx.textBaseline = 'top';
      const label = pl.name.length > 14 ? pl.name.slice(0, 13) + '…' : pl.name;
      ctx.lineWidth = 3;
      ctx.strokeStyle = th.labelHalo;
      ctx.strokeText(label, x, y + r + 3);
      ctx.fillStyle = th.label;
      ctx.fillText(label, x, y + r + 3);
    }
    ctx.globalAlpha = 1;
    hits.push({ player: st.index, x, y, r: r + 4 });
  }

  if (inp.overlay) {
    inp.overlay(ctx, (rx, ry) => [ox + rx * s, oy + ry * s], s, uiScale, layer);
  }
  if (inp.hud) drawHud(ctx, m, ri, tick, width, th);

  return { hits, layer };
}

/** Applique une opacité à une couleur #rrggbb ou rgb(a)(...). */
function hexA(color: string, a: number): string {
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1, 7), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const m = color.match(/[\d.]+/g);
  return m && m.length >= 3 ? `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${a})` : color;
}

function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, outline: string) {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
  ctx.strokeStyle = outline;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function drawBombIcon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, outline = '#07090c') {
  ctx.beginPath();
  ctx.roundRect(x - r, y - r * 0.75, r * 2, r * 1.5, r * 0.3);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

/** HUD des exports : bandeau score / round / chrono en haut à gauche, derniers kills en haut à droite. */
function drawHud(ctx: CanvasRenderingContext2D, m: MatchData, ri: number, tick: number, width: number, th: RenderTheme) {
  const r = m.rounds[ri];
  if (!r) return;
  const before: [number, number] = ri > 0 ? m.rounds[ri - 1].scoreAfter : [0, 0];
  const score = tick >= r.endTick ? r.scoreAfter : before;
  const clock = roundClock(m, r, tick);
  const font = (w: number, px: number, mono = false) =>
    `${w} ${px}px ${mono ? '"Geist Mono Variable", monospace' : '"Geist Variable", system-ui, sans-serif'}`;
  ctx.save();
  ctx.textBaseline = 'middle';
  const pad = 12, h = 34;
  const parts: { text: string; font: string; color: string }[] = [
    { text: m.teams[0].name, font: font(500, 13), color: '#fafafa' },
    { text: `${score[0]} – ${score[1]}`, font: font(600, 14, true), color: '#fafafa' },
    { text: m.teams[1].name, font: font(500, 13), color: '#fafafa' },
    { text: `Round ${r.number}`, font: font(400, 12), color: '#a3a3a3' },
    { text: formatClock(clock.remaining), font: font(500, 13, true), color: clock.phase === 'planted' ? th.bomb : '#fafafa' },
  ];
  let w = pad;
  const widths = parts.map((p) => { ctx.font = p.font; return ctx.measureText(p.text).width; });
  w += widths.reduce((a, b) => a + b, 0) + 16 * (parts.length - 1) + pad;
  ctx.fillStyle = 'rgba(10, 10, 10, 0.82)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.beginPath();
  ctx.roundRect(12, 12, w, h, 8);
  ctx.fill();
  ctx.stroke();
  let x = 12 + pad;
  parts.forEach((p, i) => {
    ctx.font = p.font;
    ctx.fillStyle = p.color;
    ctx.textAlign = 'left';
    ctx.fillText(p.text, x, 12 + h / 2);
    x += widths[i] + 16;
  });
  // Derniers kills (6 s)
  const kills = m.kills.filter((k) => k.round === ri && k.tick <= tick && tick - k.tick < 6 * m.tickrate).slice(-5);
  let y = 12;
  for (const k of kills) {
    const text = `${m.players[k.killer]?.name ?? 'World'}  ${killfeedWeapon(k.weapon)}${k.headshot ? ' HS' : ''}  ${m.players[k.victim].name}`;
    ctx.font = font(500, 12);
    const tw = ctx.measureText(text).width + 20;
    ctx.fillStyle = 'rgba(10, 10, 10, 0.82)';
    ctx.beginPath();
    ctx.roundRect(width - 12 - tw, y, tw, 26, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fafafa';
    ctx.textAlign = 'right';
    ctx.fillText(text, width - 22, y + 13);
    y += 30;
  }
  ctx.restore();
}
