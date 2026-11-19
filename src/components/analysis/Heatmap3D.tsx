// Vue 3D des points de heatmap : le radar devient un plan incliné, chaque point est placé à sa
// hauteur réelle avec une tige jusqu'au sol. Projection orthographique en canvas 2D (pas de
// bibliothèque 3D) : glisser pour tourner, molette pour zoomer.

import { useEffect, useRef, useState } from 'react';
import type { HeatPoint } from '@/analysis/heatmap';
import { rampColor, type RampId } from '@/analysis/ramps';
import { getMap, isLower, radarUrl, RADAR_SIZE, worldToRadar } from '@/maps/maps';
import { tt } from '@/i18n';

export function Heatmap3D({ map, points, ramp, canvasRef: ext }: { map: string; points: HeatPoint[]; ramp: RampId; canvasRef?: React.RefObject<HTMLCanvasElement | null> }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ yaw: -0.6, pitch: 0.95, zoom: 1 });
  const [imgs, setImgs] = useState<{ upper: HTMLImageElement | null; lower: HTMLImageElement | null }>({ upper: null, lower: null });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const cal = getMap(map);

  useEffect(() => {
    let alive = true;
    const load = (src: string) => new Promise<HTMLImageElement | null>((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
    Promise.all([load(radarUrl(map)), cal?.hasLower ? load(radarUrl(map, true)) : Promise.resolve(null)]).then(([upper, lower]) => alive && setImgs({ upper, lower }));
    return () => { alive = false; };
  }, [map, cal?.hasLower]);
  useEffect(() => {
    const ro = new ResizeObserver(() => { if (!wrap.current) return; const r = wrap.current.getBoundingClientRect(); setSize({ w: Math.floor(r.width), h: Math.floor(r.height) }); });
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !size.w || !cal) return;
    if (ext) ext.current = c;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr; c.height = size.h * dpr;
    c.style.width = `${size.w}px`; c.style.height = `${size.h}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--card').trim() || '#171717';
    ctx.fillRect(0, 0, size.w, size.h);

    // Hauteurs : radar en unités monde, z ramené à la même échelle (exagéré x1.6 pour la lisibilité)
    const zs = points.map((p) => p.z).sort((a, b) => a - b);
    const z0 = zs.length ? zs[Math.floor(zs.length * 0.05)] : 0;
    const zScale = (cal.hasLower ? 3.2 : 1.6) / cal.scale;
    const lowerZ = cal.hasLower && cal.lowerThresholdZ !== null ? zs.filter((z) => z < cal.lowerThresholdZ!) : [];
    const upperZ = cal.hasLower && cal.lowerThresholdZ !== null ? zs.filter((z) => z >= cal.lowerThresholdZ!) : zs;
    const median = (a: number[]) => (a.length ? a[Math.floor(a.length / 2)] : z0);

    const s = (Math.min(size.w, size.h) / RADAR_SIZE) * 0.85 * view.zoom;
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), spitch = Math.sin(view.pitch);
    const proj = (rx: number, ry: number, h: number): [number, number] => {
      const x = rx - RADAR_SIZE / 2, y = ry - RADAR_SIZE / 2;
      const xr = x * cy - y * sy, yr = x * sy + y * cy;
      return [size.w / 2 + xr * s, size.h / 2 + (yr * cp - h * spitch) * s];
    };
    // Plan du radar à une hauteur donnée : transformation affine exacte en projection orthographique
    const drawPlane = (img: HTMLImageElement | null, h: number, alpha: number) => {
      if (!img) return;
      const [ox, oy] = proj(0, 0, h), [ax, ay] = proj(RADAR_SIZE, 0, h), [bx, by] = proj(0, RADAR_SIZE, h);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.setTransform(dpr * (ax - ox) / RADAR_SIZE, dpr * (ay - oy) / RADAR_SIZE, dpr * (bx - ox) / RADAR_SIZE, dpr * (by - oy) / RADAR_SIZE, dpr * ox, dpr * oy);
      ctx.filter = 'grayscale(1) brightness(0.45) contrast(1.1)';
      ctx.drawImage(img, 0, 0, RADAR_SIZE, RADAR_SIZE);
      ctx.restore();
    };
    const hOf = (z: number) => (z - z0) * zScale;
    if (cal.hasLower) drawPlane(imgs.lower, hOf(median(lowerZ)), 0.9);
    drawPlane(imgs.upper, hOf(cal.hasLower ? median(upperZ) : z0), cal.hasLower ? 0.5 : 0.95);

    // Points, du plus lointain au plus proche ; couleur selon la hauteur
    const zMin = zs[0] ?? 0, zMax = zs[zs.length - 1] ?? 1;
    const pts = points.map((p) => {
      const [rx, ry] = worldToRadar(cal, p.x, p.y);
      const base = hOf(cal.hasLower && cal.lowerThresholdZ !== null ? median(isLower(cal, p.z) ? lowerZ : upperZ) : z0);
      return { rx, ry, h: hOf(p.z), base, z: p.z };
    }).sort((a, b) => (a.rx * sy + a.ry * cy) - (b.rx * sy + b.ry * cy));
    for (const p of pts) {
      const [gx, gy] = proj(p.rx, p.ry, p.base);
      const [x, y] = proj(p.rx, p.ry, p.h);
      const [r, g, b] = rampColor(ramp, ramp === 'mono' ? 0.5 + 0.5 * ((p.z - zMin) / Math.max(1, zMax - zMin)) : 0.35 + 0.65 * ((p.z - zMin) / Math.max(1, zMax - zMin)));
      ctx.strokeStyle = `rgba(${r},${g},${b},0.25)`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
      ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
    }
  }, [points, view, imgs, size, cal, ramp, ext]);

  return (
    <div ref={wrap} className="relative h-full w-full" data-testid="heatmap-3d">
      <canvas ref={canvas} className="cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY }; }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
          drag.current = { x: e.clientX, y: e.clientY };
          setView((v) => ({ ...v, yaw: v.yaw + dx * 0.008, pitch: Math.max(0.15, Math.min(1.45, v.pitch + dy * 0.006)) }));
        }}
        onPointerUp={() => { drag.current = null; }}
        onWheel={(e) => setView((v) => ({ ...v, zoom: Math.max(0.5, Math.min(3, v.zoom * (e.deltaY < 0 ? 1.1 : 0.9))) }))} />
      <div className="pointer-events-none absolute bottom-2 left-2 text-[11px] text-muted-foreground">{tt('Drag to rotate · scroll to zoom · color = height')}</div>
    </div>
  );
}
