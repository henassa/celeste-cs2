// Dessin d'une étape du tableau (ou d'une transition animée entre deux étapes) sur un canvas carré.

import { getMap } from '../maps/maps';
import type { RenderTheme } from '../viewer/theme';
import type { Board, Step, Stroke, Token } from './types';

/** Rayon des jetons joueurs en unités radar (sur 1024). */
export const PLAYER_R = 15;

interface DrawOpts {
  size: number;
  board: Board;
  step: number;
  /** Progression vers l'étape suivante (0 = étape courante, 1 = suivante). */
  progress?: number;
  selected?: string | null;
  draft?: Stroke | null;
  radar: HTMLImageElement | null;
  theme: RenderTheme;
}

function lerpTokens(a: Step, b: Step | undefined, p: number): { token: Token; alpha: number }[] {
  if (!b || p <= 0) return a.tokens.map((token) => ({ token, alpha: 1 }));
  const ease = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
  const out: { token: Token; alpha: number }[] = [];
  const inB = new Map(b.tokens.map((t) => [t.id, t]));
  for (const t of a.tokens) {
    const n = inB.get(t.id);
    if (n) out.push({ token: { ...n, x: t.x + (n.x - t.x) * ease, y: t.y + (n.y - t.y) * ease }, alpha: 1 });
    else out.push({ token: t, alpha: 1 - p });
  }
  const inA = new Set(a.tokens.map((t) => t.id));
  for (const t of b.tokens) if (!inA.has(t.id)) out.push({ token: t, alpha: p });
  return out;
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, k: number, alpha: number) {
  if (s.points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = 3 * k;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(s.points[0][0] * k, s.points[0][1] * k);
  for (const [x, y] of s.points.slice(1)) ctx.lineTo(x * k, y * k);
  ctx.stroke();
  if (s.tool === 'arrow') {
    const [x1, y1] = s.points[s.points.length - 1];
    const [x0, y0] = s.points[s.points.length - 2];
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const h = 14 * k;
    ctx.beginPath();
    ctx.moveTo(x1 * k, y1 * k);
    ctx.lineTo(x1 * k - h * Math.cos(ang - 0.45), y1 * k - h * Math.sin(ang - 0.45));
    ctx.lineTo(x1 * k - h * Math.cos(ang + 0.45), y1 * k - h * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawToken(ctx: CanvasRenderingContext2D, t: Token, k: number, alpha: number, th: RenderTheme, scale: number, selected: boolean) {
  const x = t.x * k, y = t.y * k;
  ctx.save();
  ctx.globalAlpha = alpha;
  switch (t.kind) {
    case 'smoke':
    case 'molotov': {
      const r = ((t.kind === 'smoke' ? 144 : 125) / scale) * k;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = t.kind === 'smoke' ? th.smoke : th.fire;
      ctx.fill();
      ctx.lineWidth = 1.5 * k;
      ctx.strokeStyle = t.kind === 'smoke' ? th.smokeEdge : th.fireEdge;
      ctx.stroke();
      break;
    }
    case 'flash':
    case 'he': {
      const r = 8 * k;
      ctx.beginPath();
      if (t.kind === 'flash') {
        // Étoile à 4 branches
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4, rr = i % 2 ? r * 0.4 : r;
          ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
        }
        ctx.closePath();
        ctx.fillStyle = '#fafafa';
        ctx.fill();
      } else {
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(250,250,250,0.25)';
        ctx.fill();
        ctx.lineWidth = 2 * k;
        ctx.strokeStyle = '#fafafa';
        ctx.stroke();
      }
      break;
    }
    case 'bomb': {
      const r = 8 * k;
      ctx.fillStyle = th.bomb;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.lineWidth = 1.5 * k;
      ctx.strokeStyle = th.outline;
      ctx.strokeRect(x - r, y - r, r * 2, r * 2);
      break;
    }
    default: {
      const paint = t.kind === 'ct' ? th.ct : th.t;
      const r = PLAYER_R * k;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = paint.fill;
      ctx.fill();
      ctx.lineWidth = 2 * k;
      ctx.strokeStyle = paint.ring;
      ctx.stroke();
      if (t.label) {
        ctx.fillStyle = paint.ink;
        ctx.font = `600 ${Math.round((t.label.length > 2 ? 9 : 12) * k)}px "Geist Mono Variable", ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.label, x, y + 0.5 * k);
      }
    }
  }
  if (selected) {
    ctx.globalAlpha = 1;
    ctx.setLineDash([4 * k, 3 * k]);
    ctx.lineWidth = 1.5 * k;
    ctx.strokeStyle = '#fafafa';
    ctx.beginPath();
    ctx.arc(x, y, (t.kind === 'smoke' || t.kind === 'molotov' ? (144 / scale) : PLAYER_R + 5) * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawBoard(ctx: CanvasRenderingContext2D, o: DrawOpts): void {
  const { size, board, theme: th } = o;
  const k = size / 1024;
  const cal = getMap(board.map);
  const scale = cal?.scale ?? 5;
  ctx.fillStyle = th.background;
  ctx.fillRect(0, 0, size, size);
  if (o.radar?.complete && o.radar.naturalWidth) {
    ctx.filter = 'grayscale(1) brightness(0.7) contrast(1.1)';
    ctx.drawImage(o.radar, 0, 0, size, size);
    ctx.filter = 'none';
  }
  const a = board.steps[o.step];
  if (!a) return;
  const b = board.steps[o.step + 1];
  const p = o.progress ?? 0;
  for (const s of a.strokes) drawStroke(ctx, s, k, b && p > 0 ? 1 - p : 1);
  if (b && p > 0) for (const s of b.strokes) drawStroke(ctx, s, k, p);
  if (o.draft) drawStroke(ctx, o.draft, k, 1);
  // Utilitaires d'abord (sous les joueurs)
  const toks = lerpTokens(a, b, p).sort((x, y) => Number(x.token.kind === 'ct' || x.token.kind === 't') - Number(y.token.kind === 'ct' || y.token.kind === 't'));
  for (const { token, alpha } of toks) drawToken(ctx, token, k, alpha, th, scale, token.id === o.selected && p === 0);
}

/** Jeton sous un point (coordonnées radar), le plus au-dessus d'abord. */
export function tokenAt(step: Step, x: number, y: number, scale: number): Token | null {
  const order = [...step.tokens].sort((a, b) => Number(b.kind === 'ct' || b.kind === 't') - Number(a.kind === 'ct' || a.kind === 't'));
  for (const t of order) {
    const r = t.kind === 'smoke' ? 144 / scale : t.kind === 'molotov' ? 125 / scale : t.kind === 'ct' || t.kind === 't' ? PLAYER_R + 3 : 11;
    if (Math.hypot(t.x - x, t.y - y) <= r) return t;
  }
  return null;
}
