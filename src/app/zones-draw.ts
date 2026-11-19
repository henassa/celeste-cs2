// Dessin des zones du coach sur un canvas 2D (radar du replay, heatmaps, texture des sols en 3D).

import { getMap, worldToRadar } from '@/maps/maps';
import { ZONE_COLOR, type ZoneSet } from './zones';

/** `toScreen` : coordonnées radar (0..1024) -> pixels ; `scale` : pixels par unité radar. */
export function drawZones(ctx: CanvasRenderingContext2D, set: ZoneSet, toScreen: (rx: number, ry: number) => [number, number], scale: number, uiScale = 1, labels = true): void {
  const cal = getMap(set.map);
  if (!cal) return;
  ctx.save();
  for (const z of set.zones) {
    const [rx, ry] = worldToRadar(cal, z.x, z.y);
    const [x, y] = toScreen(rx, ry);
    const r = (z.r / cal.scale) * scale;
    const c = ZONE_COLOR[z.kind];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = c;
    ctx.fill();
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 2 * uiScale;
    ctx.setLineDash(z.kind === 'weak' ? [6 * uiScale, 4 * uiScale] : []);
    ctx.strokeStyle = c;
    ctx.stroke();
    ctx.setLineDash([]);
    if (labels) {
      ctx.font = `600 ${Math.round(12 * uiScale)}px "Geist Variable", system-ui, sans-serif`;
      const w = ctx.measureText(z.label).width + 10 * uiScale, h = 18 * uiScale;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = 'rgba(10,10,10,0.85)';
      ctx.beginPath(); ctx.roundRect(x - w / 2, y - r - h - 4 * uiScale, w, h, 4 * uiScale); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = c;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(z.label, x, y - r - h / 2 - 4 * uiScale);
    }
  }
  ctx.restore();
}
