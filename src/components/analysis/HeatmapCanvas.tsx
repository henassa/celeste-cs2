// Heatmap sur le radar : densité lissée avec lignes de niveau, ou points.

import { useEffect, useRef } from 'react';
import { getMap, isLower, radarUrl, RADAR_SIZE, worldToRadar } from '@/maps/maps';
import type { HeatPoint } from '@/analysis/heatmap';
import { rampColor, rampCss, type RampId } from '@/analysis/ramps';
import { useZones } from '@/app/zones';
import { drawZones } from '@/app/zones-draw';
import { contourSegments, DEFAULT_DENSITY, densityField, type DensitySettings } from '@/analysis/density';
import { tt } from '@/i18n';

interface Props {
  map: string;
  /** Nombre de points effectivement affichés (étage courant). */
  onVisibleCount?: (n: number) => void;
  points: HeatPoint[];
  layer: 'upper' | 'lower';
  mode: 'heat' | 'dots';
  ramp?: RampId;
  density?: DensitySettings;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}


export function HeatmapCanvas({ map, points, layer, mode, ramp = 'mono', density = DEFAULT_DENSITY, canvasRef: ext, onVisibleCount }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const zones = useZones();

  useEffect(() => {
    const c = canvas.current!;
    if (ext) ext.current = c;
    const ctx = c.getContext('2d')!;
    const cal = getMap(map);
    const img = new Image();
    img.src = radarUrl(map, layer === 'lower');
    let cancelled = false;

    const draw = () => {
      if (cancelled || !wrap.current) return;
      const rect = wrap.current.getBoundingClientRect();
      const size = Math.floor(Math.min(rect.width, rect.height));
      const dpr = window.devicePixelRatio || 1;
      c.width = size * dpr; c.height = size * dpr;
      c.style.width = `${size}px`; c.style.height = `${size}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--card').trim() || '#171717';
      ctx.fillRect(0, 0, size, size);
      const s = size / RADAR_SIZE;
      if (img.complete && img.naturalWidth) {
        ctx.filter = 'grayscale(1) brightness(0.45) contrast(1.1)';
        ctx.drawImage(img, 0, 0, size, size);
        ctx.filter = 'none';
      }
      if (!cal) return;
      const pts = points.filter((p) => !cal.hasLower || isLower(cal, p.z) === (layer === 'lower')).map((p) => worldToRadar(cal, p.x, p.y));
      onVisibleCount?.(pts.length);
      const zs = zones && zones.map === map ? zones : null;
      const drawZ = () => { if (zs) drawZones(ctx, zs, (rx, ry) => [rx * s, ry * s], s, Math.max(0.8, size / 900)); };
      if (mode === 'dots') {
        const [dr, dg, db] = rampColor(ramp, 0.85);
        ctx.fillStyle = `rgba(${dr},${dg},${db},${density.opacity})`;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1;
        const r = Math.max(2, Math.min(6, density.radius / 4)) * (size / 800);
        for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(x * s, y * s, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
        drawZ();
        return;
      }
      // Densité : champ lissé (flou gaussien), normalisé sur le percentile 98, puis rampe à une teinte
      const n = Math.min(512, Math.max(192, Math.round((size * dpr) / 2)));
      const field = densityField(pts, n, density, RADAR_SIZE);
      const off = document.createElement('canvas');
      off.width = off.height = n;
      const octx = off.getContext('2d')!;
      const data = octx.createImageData(n, n);
      const t = density.threshold;
      const lut = Array.from({ length: 256 }, (_, i) => rampColor(ramp, ramp === 'mono' ? 0.35 + 0.65 * (i / 255) : i / 255));
      for (let i = 0; i < field.length; i++) {
        const v = field[i];
        if (v <= t) continue;
        const edge = Math.min(1, (v - t) / 0.12);
        const a = density.opacity * edge * edge * (3 - 2 * edge) * (0.45 + 0.55 * v);
        const [cr, cg, cb] = lut[Math.round(v * 255)];
        data.data[i * 4] = cr; data.data[i * 4 + 1] = cg; data.data[i * 4 + 2] = cb;
        data.data[i * 4 + 3] = Math.round(255 * a);
      }
      octx.putImageData(data, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, size, size);
      if (density.contours) {
        const cs = size / n;
        for (const level of [0.3, 0.55, 0.8]) {
          if (level <= t) continue;
          const seg = contourSegments(field, n, level);
          const [cr, cg, cb] = rampColor(ramp, Math.min(1, level + 0.25));
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.35 + 0.4 * level})`;
          ctx.lineWidth = level > 0.7 ? 1.25 : 0.8;
          ctx.beginPath();
          for (let i = 0; i < seg.length; i += 4) { ctx.moveTo((seg[i] + 0.5) * cs, (seg[i + 1] + 0.5) * cs); ctx.lineTo((seg[i + 2] + 0.5) * cs, (seg[i + 3] + 0.5) * cs); }
          ctx.stroke();
        }
      }
      drawZ();
    };
    img.onload = draw;
    const ro = new ResizeObserver(draw);
    ro.observe(wrap.current!);
    draw();
    return () => { cancelled = true; ro.disconnect(); };
  }, [map, points, layer, mode, ramp, density, ext, onVisibleCount, zones]);

  return (
    <div ref={wrap} className="relative flex h-full w-full items-center justify-center">
      <canvas ref={canvas} className="rounded-lg" />
      {mode === 'heat' && (
        <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-2 rounded-md border bg-overlay px-2 py-1 text-[10px] text-overlay-foreground backdrop-blur-sm">
          {tt('fewer') + ' '}<span className="h-1.5 w-24 rounded-full" style={{ background: rampCss(ramp) }} /> {tt('more')}
        </div>
      )}
    </div>
  );
}
