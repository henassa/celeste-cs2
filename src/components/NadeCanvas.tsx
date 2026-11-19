// Radar des grenades : point de lancer, trajectoire (ou ligne droite), zone d'arrivée.
// Partagé par la vue Grenades du lecteur et l'onglet Lineups de l'analyse.

import { useEffect, useRef, useState } from 'react';
import type { GrenadeKind } from '@/data/types';
import { getMap, isLower, radarToWorld, radarUrl, RADAR_SIZE, worldToRadar } from '@/maps/maps';
import { readRenderTheme } from '@/viewer/theme';
import { cn } from '@/lib/utils';

export interface NadeItem {
  id: string;
  kind: GrenadeKind;
  from: [number, number, number] | null;
  to: [number, number, number];
  /** Trajectoire réelle (x, y monde), sinon ligne droite. */
  path?: [number, number][];
  /** Nombre de lancers regroupés (taille du point). */
  count?: number;
}

/** Rayon d'effet (unités monde). */
const RADIUS: Record<GrenadeKind, number> = { smoke: 144, molotov: 125, he: 60, flash: 50, decoy: 30 };

/** Point cherché par le nade finder (monde) et rayon de recherche. */
export interface FinderTarget { x: number; y: number; radius: number; mode: 'to' | 'from' }

export function NadeCanvas({ map, items, selected, onSelect, layer, target, onPick }: {
  map: string; items: NadeItem[]; selected: string | null; onSelect: (id: string | null) => void; layer: 'upper' | 'lower';
  /** Nade finder : cercle de recherche affiché, et clic hors d'une grenade = nouveau point. */
  target?: FinderTarget | null; onPick?: (x: number, y: number) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(0);
  const [size, setSize] = useState(0);
  const hits = useRef<{ id: string; x: number; y: number }[]>([]);
  const cal = getMap(map);

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImgReady((n) => n + 1);
    i.src = radarUrl(map, layer === 'lower');
    img.current = i;
  }, [map, layer]);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (!wrap.current) return;
      const r = wrap.current.getBoundingClientRect();
      setSize(Math.floor(Math.min(r.width, r.height)));
    });
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !size || !cal) return;
    const th = readRenderTheme();
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr; c.height = size * dpr;
    c.style.width = `${size}px`; c.style.height = `${size}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = th.background;
    ctx.fillRect(0, 0, size, size);
    const s = size / RADAR_SIZE;
    const im = img.current;
    if (im?.complete && im.naturalWidth) {
      ctx.filter = 'grayscale(1) brightness(0.4) contrast(1.1)';
      ctx.drawImage(im, 0, 0, size, size);
      ctx.filter = 'none';
    }
    const onLayer = (z: number) => !cal.hasLower || isLower(cal, z) === (layer === 'lower');
    const px = (x: number, y: number) => { const [rx, ry] = worldToRadar(cal, x, y); return [rx * s, ry * s] as const; };
    hits.current = [];
    const k = Math.max(0.7, Math.min(1.3, size / 800));

    const drawItem = (it: NadeItem, strong: boolean, dim: boolean) => {
      const alpha = strong ? 1 : dim ? 0.18 : 0.55;
      const fill = it.kind === 'molotov' ? `rgba(239,68,68,${0.22 * alpha})` : it.kind === 'smoke' ? `rgba(220,220,220,${0.2 * alpha})` : `rgba(250,250,250,${0.16 * alpha})`;
      const edge = it.kind === 'molotov' ? `rgba(239,68,68,${0.9 * alpha})` : `rgba(250,250,250,${0.75 * alpha})`;
      // Trajectoire
      if (it.from && onLayer(it.from[2])) {
        ctx.beginPath();
        if (it.path && it.path.length > 1) {
          const [x0, y0] = px(it.path[0][0], it.path[0][1]);
          ctx.moveTo(x0, y0);
          for (const [x, y] of it.path.slice(1)) { const [a, b] = px(x, y); ctx.lineTo(a, b); }
        } else {
          const [x0, y0] = px(it.from[0], it.from[1]);
          const [x1, y1] = px(it.to[0], it.to[1]);
          ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
        }
        ctx.setLineDash(it.path ? [] : [4, 4]);
        ctx.strokeStyle = `rgba(250,250,250,${(strong ? 0.85 : 0.3) * (dim ? 0.4 : 1)})`;
        ctx.lineWidth = strong ? 1.75 : 1;
        ctx.stroke();
        ctx.setLineDash([]);
        // Point de lancer
        const [fx, fy] = px(it.from[0], it.from[1]);
        ctx.beginPath();
        ctx.arc(fx, fy, (strong ? 4.5 : 3) * k, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(250,250,250,${alpha})`;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = th.outline;
        ctx.stroke();
        hits.current.push({ id: it.id, x: fx, y: fy });
      }
      // Arrivée
      if (onLayer(it.to[2])) {
        const [tx, ty] = px(it.to[0], it.to[1]);
        const r = Math.max(4 * k, (RADIUS[it.kind] / cal.scale) * s);
        ctx.beginPath();
        ctx.arc(tx, ty, r, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = strong ? 1.75 : 1;
        ctx.strokeStyle = edge;
        ctx.stroke();
        if (it.count && it.count > 1) {
          ctx.fillStyle = `rgba(250,250,250,${Math.max(0.5, alpha)})`;
          ctx.font = `600 ${Math.round(10 * k)}px "Geist Mono Variable", ui-monospace, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(it.count), tx, ty);
        }
        hits.current.push({ id: it.id, x: tx, y: ty });
      }
    };
    // Zone cherchée (nade finder)
    if (target) {
      const [cx, cy] = px(target.x, target.y);
      const r = (target.radius / cal.scale) * s;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(250,250,250,0.06)';
      ctx.fill();
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(250,250,250,0.85)';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6);
      ctx.stroke();
      ctx.font = th.fontLabel;
      ctx.fillStyle = th.label;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(target.mode === 'to' ? 'lands here' : 'thrown from here', cx, cy - r - 4);
    }
    for (const it of items) if (it.id !== selected) drawItem(it, false, selected !== null);
    const sel = items.find((it) => it.id === selected);
    if (sel) drawItem(sel, true, false);
  }, [items, selected, layer, size, imgReady, cal, target]);

  return (
    <div ref={wrap} className="flex h-full w-full items-center justify-center">
      <canvas ref={canvas} className={cn('rounded-lg', onPick ? 'cursor-crosshair' : 'cursor-pointer')} data-testid="nade-canvas" onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        let best: string | null = null, bd = 14;
        for (const h of hits.current) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h.id; } }
        // Nade finder : le premier clic pose le point cherché (même sur un repère) ; ensuite, un clic hors d'une grenade le déplace
        if (onPick && cal && size && (!best || !target)) { const [wx, wy] = radarToWorld(cal, (x / size) * RADAR_SIZE, (y / size) * RADAR_SIZE); onPick(wx, wy); return; }
        onSelect(best);
      }} />
    </div>
  );
}
