// Dessin des annotations sur le canvas du radar (coordonnées radar -> écran).

import type { Annotation } from './types';

export type RadarToScreen = (rx: number, ry: number) => [number, number];

export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  list: readonly Annotation[],
  toScreen: RadarToScreen,
  scale: number,
  uiScale: number,
  halo: string,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const a of list) drawOne(ctx, a, toScreen, scale, uiScale, halo);
  ctx.restore();
}

function strokeWithHalo(ctx: CanvasRenderingContext2D, color: string, width: number, halo: string) {
  ctx.strokeStyle = halo;
  ctx.lineWidth = width + 3;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawOne(ctx: CanvasRenderingContext2D, a: Annotation, toScreen: RadarToScreen, scale: number, uiScale: number, halo: string) {
  const w = a.width * uiScale;
  const pts = a.points.map(([x, y]) => toScreen(x, y));
  ctx.beginPath();
  switch (a.tool) {
    case 'pen': {
      if (pts.length === 1 || (pts.length === 2 && pts[0][0] === pts[1][0] && pts[0][1] === pts[1][1])) {
        ctx.arc(pts[0][0], pts[0][1], w, 0, Math.PI * 2);
        ctx.fillStyle = a.color;
        ctx.fill();
        return;
      }
      // Lissage : courbes quadratiques entre les milieux des segments
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last[0], last[1]);
      strokeWithHalo(ctx, a.color, w, halo);
      return;
    }
    case 'line':
    case 'arrow': {
      const [p0, p1] = [pts[0], pts[pts.length - 1]];
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      strokeWithHalo(ctx, a.color, w, halo);
      if (a.tool === 'arrow') {
        const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
        const head = Math.max(10, w * 3.5);
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p1[0] - head * Math.cos(ang - 0.45), p1[1] - head * Math.sin(ang - 0.45));
        ctx.lineTo(p1[0] - head * Math.cos(ang + 0.45), p1[1] - head * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.strokeStyle = halo;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = a.color;
        ctx.fill();
      }
      return;
    }
    case 'circle': {
      const r = Math.hypot(a.points[1][0] - a.points[0][0], a.points[1][1] - a.points[0][1]) * scale;
      ctx.arc(pts[0][0], pts[0][1], r, 0, Math.PI * 2);
      strokeWithHalo(ctx, a.color, w, halo);
      return;
    }
    case 'rect': {
      const [p0, p1] = [pts[0], pts[1]];
      ctx.rect(Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.abs(p1[0] - p0[0]), Math.abs(p1[1] - p0[1]));
      strokeWithHalo(ctx, a.color, w, halo);
      return;
    }
    case 'text': {
      const size = Math.round((11 + a.width * 1.5) * uiScale);
      ctx.font = `600 ${size}px "Geist Variable", system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = halo;
      ctx.strokeText(a.text ?? '', pts[0][0], pts[0][1]);
      ctx.fillStyle = a.color;
      ctx.fillText(a.text ?? '', pts[0][0], pts[0][1]);
      return;
    }
  }
}
