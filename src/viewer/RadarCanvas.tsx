// Canvas du radar : boucle d'animation, zoom (molette), déplacement (glisser), clic pour suivre un joueur.

import { getZones } from '@/app/zones';
import { drawZones } from '@/app/zones-draw';
import { useEffect, useRef } from 'react';
import { getMap, radarUrl, RADAR_SIZE } from '../maps/maps';
import type { Playback } from './playback';
import { baseScale, render, RenderCache, type RenderOutput, type ViewTransform } from './render';
import { playerState } from './sample';
import { worldToRadar } from '../maps/maps';
import { readRenderTheme } from './theme';
import type { ScrimStore } from '../scrim/store';
import { drawAnnotations } from '../scrim/draw';
import type { DrawTool } from '../scrim/types';
import { roundIndexAt } from './sample';

interface Props {
  pb: Playback;
  scrim: ScrimStore;
  onLayerChange?: (layer: 'upper' | 'lower') => void;
  /** Accès au canvas (export d'image). */
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
  /** Joueurs qui parlent à un tick donné (comms vocales chargées). */
  speaking?: React.RefObject<((tick: number) => Set<number>) | null>;
}

export function RadarCanvas({ pb, scrim, onLayerChange, canvasRef: externalRef, speaking }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    if (externalRef) externalRef.current = canvas;
    const ctx = canvas.getContext('2d')!;
    const m = pb.match;
    const map = getMap(m.header.map);
    const cache = new RenderCache(m);
    const view: ViewTransform = { zoom: 1, cx: RADAR_SIZE / 2, cy: RADAR_SIZE / 2 };
    const radar: { upper: HTMLImageElement | null; lower: HTMLImageElement | null } = { upper: null, lower: null };
    if (map) {
      radar.upper = new Image();
      radar.upper.src = radarUrl(m.header.map);
      if (map.hasLower) { radar.lower = new Image(); radar.lower.src = radarUrl(m.header.map, true); }
    }

    let width = 0, height = 0, dpr = 1;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      width = rect.width; height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    let hover = -1;
    let last: RenderOutput = { hits: [], layer: 'upper' };
    let lastLayer: 'upper' | 'lower' = 'upper';
    let raf = 0;
    let prev = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      pb.advance(dt);
      const state = pb.get();
      // Caméra : centrée sur le joueur suivi quand on a zoomé
      if (map && state.follow >= 0 && view.zoom > 1.05) {
        const st = playerState(m, state.follow, state.tick);
        if (st.alive) {
          const [rx, ry] = worldToRadar(map, st.x, st.y);
          view.cx += (rx - view.cx) * Math.min(1, dt * 8);
          view.cy += (ry - view.cy) * Math.min(1, dt * 8);
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (map) {
        last = render({
          ctx, width, height, match: m, map, state, view, radar, cache, hover, theme: readRenderTheme(), hud: state.hud,
          speaking: speaking?.current?.(state.tick),
          overlay: (c, toScreen, scale, uiScale, layer) => {
            const list = scrim.visible(state.tick, layer);
            const all = scrim.draft && scrim.draft.layer === layer ? [...list, scrim.draft] : list;
            if (all.length) drawAnnotations(c, all, toScreen, scale, uiScale, 'rgba(10,10,10,0.75)');
            const zs = getZones();
            if (zs && zs.map === m.header.map && layer === 'upper') drawZones(c, zs, toScreen, scale, uiScale);
          },
        });
        if (last.layer !== lastLayer) { lastLayer = last.layer; onLayerChange?.(last.layer); }
      } else {
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = readRenderTheme().label;
        ctx.font = '14px "Inter Variable", system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(`No radar calibration for ${m.header.map} yet`, width / 2, height / 2);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // --- Interactions ---
    const pick = (ev: MouseEvent): number => {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      let best = -1, bd = Infinity;
      for (const h of last.hits) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d <= h.r + 2 && d < bd) { best = h.player; bd = d; }
      }
      return best;
    };
    const toRadar = (ev: MouseEvent): [number, number, number, number] => {
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      const s = baseScale(width, height) * view.zoom;
      return [view.cx + (mx - width / 2) / s, view.cy + (my - height / 2) / s, mx, my];
    };
    let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
    let drawing = false;
    const onDown = (ev: MouseEvent) => {
      // Clic droit pendant un tracé : on l'abandonne
      if (ev.button === 2 && drawing) { drawing = false; scrim.cancelStroke(); ev.preventDefault(); return; }
      if (ev.button !== 0) return;
      const tool = scrim.tool;
      if (tool !== 'select') {
        // Mode dessin : on met la lecture en pause et on dessine en coordonnées radar
        ev.preventDefault();
        const st = pb.get();
        if (st.playing) pb.set({ playing: false });
        const [rx, ry, mx, my] = toRadar(ev);
        const r = m.rounds[roundIndexAt(m, st.tick)];
        if (!r) return;
        const tick = Math.round(st.tick);
        if (tool === 'eraser') {
          const s = baseScale(width, height) * view.zoom;
          scrim.eraseAt(rx, ry, tick, last.layer, 10 / s);
          drawing = true;
        } else if (tool === 'text') {
          scrim.requestText({ sx: mx, sy: my, rx, ry, tick, round: r.index, layer: last.layer }, r.officialEndTick);
        } else {
          scrim.beginStroke(tool as DrawTool, rx, ry, tick, r.index, r.officialEndTick, last.layer);
          drawing = true;
        }
        return;
      }
      drag = { x: ev.clientX, y: ev.clientY, cx: view.cx, cy: view.cy, moved: false };
    };
    const onMove = (ev: MouseEvent) => {
      if (scrim.tool !== 'select') {
        canvas.style.cursor = scrim.tool === 'text' ? 'text' : 'crosshair';
        if (drawing && (ev.buttons & 1)) {
          const [rx, ry] = toRadar(ev);
          if (scrim.tool === 'eraser') {
            const s = baseScale(width, height) * view.zoom;
            scrim.eraseAt(rx, ry, Math.round(pb.get().tick), last.layer, 10 / s);
          } else scrim.extendStroke(rx, ry, ev.shiftKey);
        }
        return;
      }
      if (drag) {
        const s = baseScale(width, height) * view.zoom;
        const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) {
          view.cx = drag.cx - dx / s;
          view.cy = drag.cy - dy / s;
          if (pb.get().follow >= 0) pb.set({ follow: -1 });
        }
      }
      const h = pick(ev);
      hover = h;
      canvas.style.cursor = drag?.moved ? 'grabbing' : h >= 0 ? 'pointer' : 'default';
    };
    const onUp = (ev: MouseEvent) => {
      if (ev.button === 2) return;
      if (drawing) { drawing = false; scrim.endStroke(); return; }
      if (drag && !drag.moved) {
        const p = pick(ev);
        pb.set({ follow: p === pb.get().follow ? -1 : p });
      }
      drag = null;
    };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      const s0 = baseScale(width, height) * view.zoom;
      // Point radar sous la souris, conservé pendant le zoom
      const rx = view.cx + (mx - width / 2) / s0;
      const ry = view.cy + (my - height / 2) / s0;
      view.zoom = Math.max(1, Math.min(4, view.zoom * Math.exp(-ev.deltaY * 0.0015)));
      const s1 = baseScale(width, height) * view.zoom;
      view.cx = rx - (mx - width / 2) / s1;
      view.cy = ry - (my - height / 2) / s1;
      if (view.zoom === 1) { view.cx = RADAR_SIZE / 2; view.cy = RADAR_SIZE / 2; }
    };
    const onDbl = () => { view.zoom = 1; view.cx = RADAR_SIZE / 2; view.cy = RADAR_SIZE / 2; };
    const onMenu = (ev: MouseEvent) => { if (scrim.tool !== 'select') ev.preventDefault(); };
    canvas.addEventListener('contextmenu', onMenu);
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDbl);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('contextmenu', onMenu);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDbl);
    };
  }, [pb, scrim, onLayerChange, externalRef]);

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
