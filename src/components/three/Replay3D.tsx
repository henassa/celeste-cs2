// Replay en 3D : joueurs (silhouette et arme en main), grenades, dessins du scrim et zones du coach
// sur la carte modélisée, synchronisés avec la lecture. On peut dessiner directement en 3D.

import { useEffect, useRef, useState } from 'react';
import { LocateFixed, Map as MapIcon, RotateCcw, ScanEye, Scissors } from 'lucide-react';
import { CutControl } from './CutControl';
import { quality3dStore } from '@/app/quality';
import { MapScene, type Player3D } from '@/three/map-scene';
import { loadRig } from '@/three/rig';
import { airState, buildActionIndex, overlayAt, shotsAt } from '@/three/actions';
import type { ShotVisual } from '@/three/actors';
import type { NadeVisual } from '@/three/actors';
import type { Playback } from '@/viewer/playback';
import { playerState, roundIndexAt } from '@/viewer/sample';
import { FLAG_DEFUSING, FLAG_DUCKING, FLAG_PLANTING, SAMPLE_STEP, SIDE_CT, type MatchData } from '@/data/types';
import { getMap, isLower, worldToRadar } from '@/maps/maps';
import type { ScrimStore } from '@/scrim/store';
import { useScrim } from '@/scrim/store';
import type { DrawTool } from '@/scrim/types';
import { drawAnnotations } from '@/scrim/draw';
import { getZones } from '@/app/zones';
import { drawZones } from '@/app/zones-draw';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

const DECAL = 2048; // résolution du calque des dessins (espace radar 1024 × 2)

/** Grenades visibles à ce tick : trajectoire jusqu'ici, puis effet. */
function nadesAt(m: MatchData, tick: number): NadeVisual[] {
  const tr = m.tickrate, out: NadeVisual[] = [];
  const pt = m.grenadePathTicks, xyz = m.grenadePathXYZ;
  for (const g of m.grenades) {
    const flashLike = g.kind === 'flash' || g.kind === 'he' || g.kind === 'decoy';
    const end = flashLike ? g.detonateTick + 0.6 * tr : Math.max(g.effectEndTick, g.detonateTick + 1.5 * tr);
    if (tick < g.throwTick || tick > end) continue;
    const path: number[] = [];
    if (tick <= g.detonateTick + 1.5 * tr) for (let k = g.pathStart; k < g.pathStart + g.pathLen; k++) { if (pt[k] > tick) break; path.push(xyz[k * 3], xyz[k * 3 + 1], xyz[k * 3 + 2]); }
    let effect: NadeVisual['effect'] = null;
    if (tick >= g.detonateTick) {
      const t = flashLike ? (tick - g.detonateTick) / (0.6 * tr) : (tick - g.detonateTick) / Math.max(1, g.effectEndTick - g.detonateTick);
      if (t <= 1) effect = { x: g.effectPos[0], y: g.effectPos[1], z: g.effectPos[2], t, elapsed: (tick - g.detonateTick) / tr, remaining: Math.max(0, ((flashLike ? g.detonateTick + 0.6 * tr : g.effectEndTick) - tick) / tr) };
    }
    out.push({ id: g.id, kind: g.kind, path, effect });
  }
  return out;
}

export default function Replay3D({ pb, follow, scrim, className }: { pb: Playback; tick?: number; follow: number; scrim?: ScrimStore; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const m = pb.match;
  const [scene, setScene] = useState<MapScene | null>(null);
  const [ready, setReady] = useState(false);
  const [track, setTrack] = useState(true);
  const lastFollow = useRef(-1);
  const [cut, setCut] = useState<number | null>(null);
  const [autoCut, setAutoCut] = useState(true);
  // Radar en gris plaqué sur les sols (par défaut) ou sols unis ; choix gardé sur ce navigateur
  const [radarFloors, setRadarFloorsState] = useState(() => { try { return localStorage.getItem('scrimview.3d.radarFloors') !== '0'; } catch { return true; } });
  const setRadarFloors = (v: boolean) => { setRadarFloorsState(v); try { localStorage.setItem('scrimview.3d.radarFloors', v ? '1' : '0'); } catch { /* */ } };
  useEffect(() => { if (scene && ready) scene.setRadarFloors(radarFloors); }, [scene, ready, radarFloors]);
  // Paquet des vrais modèles de joueurs absent (généré sur la machine : npm run anims:extract)
  const [rigMissing, setRigMissing] = useState(false);
  const [rigHintClosed, setRigHintClosed] = useState(() => { try { return sessionStorage.getItem('scrimview.rigHint') === '1'; } catch { return false; } });
  const cal = getMap(m.header.map);
  const scrimVersion = useScrim(scrim ?? DUMMY);
  const drawing = !!scrim && scrim.tool !== 'select';

  useEffect(() => {
    const s = new MapScene(host.current!);
    (window as unknown as { __scene3d?: MapScene }).__scene3d = s; // débogage local et tests
    setScene(s);
    // Vraies animations des joueurs si le paquet a été préparé (sinon silhouettes)
    loadRig().then((rig) => { s.setRig(rig); setRigMissing(!rig); });
    s.load(m.header.map).then((ok) => {
      if (ok) s.setQuality(quality3dStore.get());
      setReady(ok);
      if (!ok) return;
      // Hauteurs jouées (échantillon des positions) pour proposer une coupe
      const zs: number[] = [];
      const pos = m.frames.pos;
      for (let i = 2; i < pos.length; i += 3 * 97) if (pos[i] !== 0) zs.push(pos[i]);
      setCut(s.suggestCut(zs));
    });
    return () => s.dispose();
  }, [m]);

  // Réglages lus par la boucle sans la relancer
  const showShots = useRef(true);
  const opts = useRef({ track, autoCut, cut });
  opts.current = { track, autoCut, cut };
  const dirty = useRef(true);
  useEffect(() => { dirty.current = true; }, [follow, track, autoCut, cut, scrimVersion]);
  useEffect(() => { scene?.setDrawing(drawing); }, [scene, drawing]);
  useEffect(() => (scene && ready ? quality3dStore.subscribe(() => scene.setQuality(quality3dStore.get())) : undefined), [scene, ready]);

  // Boucle propre à la vue 3D : elle fait avancer la lecture (le radar 2D, qui le fait d'habitude,
  // n'est pas affiché ici) et met à jour joueurs, grenades et dessins.
  useEffect(() => {
    if (!scene || !ready) return;
    let raf = 0, prev = performance.now(), lastTick = -1, decalKey = '';
    const actions = buildActionIndex(m);
    const shotCache = new Map<number, ShotVisual>();
    const ray = scene.ray.bind(scene);
    const canvases = { upper: document.createElement('canvas'), lower: document.createElement('canvas') };
    canvases.upper.width = canvases.upper.height = canvases.lower.width = canvases.lower.height = DECAL;
    const frame = (now: number) => {
      const dt = Math.min(0.25, (now - prev) / 1000); // temps réel même si l'image est lente
      prev = now;
      pb.advance(dt);
      const { tick, follow: fol } = pb.get();
      if (tick !== lastTick || dirty.current) {
        lastTick = tick;
        dirty.current = false;
        const list: Player3D[] = [];
        // Joueurs en train de lancer une grenade (de 0,15 s avant à 0,35 s après le lâcher)
        const throwers = new Set<number>();
        for (const g of m.grenades) { const t0 = g.throw?.tick ?? g.throwTick; if (tick >= t0 - 0.35 * m.tickrate && tick <= t0 + 0.15 * m.tickrate) throwers.add(g.thrower); }
        m.players.forEach((pl, i) => {
          const st = playerState(m, i, tick);
          if (!st.present || (st.side !== 2 && st.side !== SIDE_CT)) return;
          // Vitesse sur un huitième de seconde (indépendante de la cadence d'affichage)
          const back = playerState(m, i, Math.max(0, tick - m.tickrate / 8));
          const speed = back.alive ? Math.hypot(st.x - back.x, st.y - back.y) * 8 : 0;
          const fi = Math.max(0, Math.min(m.frames.count - 1, Math.round(tick / SAMPLE_STEP))) * m.players.length + i;
          const pose = { speed: speed > 900 ? 0 : speed, pitch: m.frames.pitch[fi], duck: (st.flags & FLAG_DUCKING) !== 0, busy: (st.flags & (FLAG_PLANTING | FLAG_DEFUSING)) !== 0, time: tick / m.tickrate, moveYaw: (Math.atan2(st.y - back.y, st.x - back.x) * 180) / Math.PI, planting: (st.flags & FLAG_PLANTING) !== 0, defusing: (st.flags & FLAG_DEFUSING) !== 0, throwing: throwers.has(i), air: st.alive ? airState(m, i, tick) : undefined, overlay: st.alive ? overlayAt(m, actions, i, tick) : null };
          list.push({ id: i, x: st.x, y: st.y, z: st.z, yaw: st.yaw, ct: st.side === SIDE_CT, alive: st.alive, name: pl.name, followed: i === fol, weapon: st.weapon, pose });
        });
        scene.setPlayers(list);
        scene.setNades(nadesAt(m, tick));
        scene.setShots(showShots.current ? shotsAt(m, actions, tick, ray, shotCache) : []);
        const f = list.find((p) => p.id === fol);
        const o = opts.current;
        if (o.track && f) { scene.follow(f.x, f.y, f.z, lastFollow.current !== fol); lastFollow.current = fol; }
        if (!f) lastFollow.current = -1;
        // Coupe automatique au-dessus du joueur suivi (on voit à l'intérieur des bâtiments)
        scene.setCut(o.autoCut && f ? f.z + 190 : o.cut);
        // Calque : dessins visibles à ce tick + zones du coach (redessiné seulement s'il change)
        const zones = getZones();
        const up = scrim ? scrim.visible(tick, 'upper') : [], lo = scrim ? scrim.visible(tick, 'lower') : [];
        const draft = scrim?.draft;
        const key = `${up.map((a) => a.id).join()}|${lo.map((a) => a.id).join()}|${draft ? `${draft.layer}${draft.points.length}${draft.points.at(-1)}` : ''}|${zones ? `${zones.map}${zones.zones.length}${zones.title}` : ''}|${scrimVersion}`;
        if (key !== decalKey) {
          decalKey = key;
          const toS = (rx: number, ry: number): [number, number] => [rx * 2, ry * 2];
          const paint = (c: HTMLCanvasElement, anns: typeof up, layer: 'upper' | 'lower') => {
            const ctx = c.getContext('2d')!;
            ctx.clearRect(0, 0, DECAL, DECAL);
            const all = draft && draft.layer === layer ? [...anns, draft] : anns;
            if (all.length) drawAnnotations(ctx, all, toS, 2, 2.5, 'rgba(10,10,10,0.75)');
            if (zones && zones.map === m.header.map && layer === 'upper') drawZones(ctx, zones, toS, 2, 2.5);
            return all.length > 0 || (layer === 'upper' && !!zones && zones.map === m.header.map);
          };
          const hasUp = paint(canvases.upper, up, 'upper'), hasLo = cal?.hasLower ? paint(canvases.lower, lo, 'lower') : false;
          scene.setDecal(hasUp ? canvases.upper : null, hasLo ? canvases.lower : null);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [scene, ready, pb, m, scrim, cal, scrimVersion]);

  // Dessin en 3D : le point du sol sous le pointeur devient un point du radar (mêmes annotations qu'en 2D)
  useEffect(() => {
    const el = host.current;
    if (!scene || !ready || !scrim || !el || !cal) return;
    let active = false;
    const at = (ev: PointerEvent) => {
      const p = scene.pickFloor(ev.clientX, ev.clientY);
      if (!p) return null;
      const [rx, ry] = worldToRadar(cal, p.x, p.y);
      return { rx, ry, layer: (isLower(cal, p.z) ? 'lower' : 'upper') as 'upper' | 'lower' };
    };
    const down = (ev: PointerEvent) => {
      // Clic droit pendant un tracé : on l'abandonne
      if (ev.button === 2 && active) { active = false; scrim.cancelStroke(); dirty.current = true; return; }
      if (ev.button !== 0 || scrim.tool === 'select') return;
      const p = at(ev);
      if (!p) return;
      ev.preventDefault();
      const st = pb.get();
      if (st.playing) pb.set({ playing: false });
      const r = m.rounds[roundIndexAt(m, st.tick)];
      if (!r) return;
      const tick = Math.round(st.tick);
      if (scrim.tool === 'eraser') { scrim.eraseAt(p.rx, p.ry, tick, p.layer, 12); active = true; }
      else if (scrim.tool === 'text') {
        const rect = el.getBoundingClientRect();
        scrim.requestText({ sx: ev.clientX - rect.left, sy: ev.clientY - rect.top, rx: p.rx, ry: p.ry, tick, round: r.index, layer: p.layer }, r.officialEndTick);
      } else { scrim.beginStroke(scrim.tool as DrawTool, p.rx, p.ry, tick, r.index, r.officialEndTick, p.layer); active = true; }
      el.setPointerCapture(ev.pointerId);
    };
    const move = (ev: PointerEvent) => {
      if (!active) return;
      const p = at(ev);
      if (!p) return;
      if (scrim.tool === 'eraser') scrim.eraseAt(p.rx, p.ry, Math.round(pb.get().tick), p.layer, 12);
      else { scrim.extendStroke(p.rx, p.ry, ev.shiftKey); dirty.current = true; }
    };
    const up = (ev: PointerEvent) => { if (ev.button === 2 || !active) return; active = false; if (scrim.tool !== 'eraser') scrim.endStroke(); dirty.current = true; };
    const menu = (ev: MouseEvent) => { if (scrim.tool !== 'select') ev.preventDefault(); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('contextmenu', menu);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('contextmenu', menu); };
  }, [scene, ready, scrim, cal, pb, m]);

  return (
    <div className={cn('absolute inset-0', className)} data-testid="replay-3d">
      <div ref={host} className="absolute inset-0" />
      {!ready && <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">{tt('Loading the 3D map…')}</div>}
      <div className="absolute top-12 right-2 flex max-w-[70%] flex-wrap justify-end gap-1">
        <Toggle size="sm" variant="outline" className="bg-overlay backdrop-blur-sm" pressed={track} onPressedChange={setTrack} aria-label={tt('Camera follows the selected player')}><LocateFixed /> {tt('Track')}</Toggle>
        <Toggle size="sm" variant="outline" className="bg-overlay backdrop-blur-sm" pressed={autoCut} onPressedChange={setAutoCut} aria-label={tt('Hide roofs above the followed player')}><Scissors /> {tt('Auto cut')}</Toggle>
        <Toggle size="sm" variant="outline" className="bg-overlay backdrop-blur-sm" pressed={radarFloors} onPressedChange={setRadarFloors} aria-label={tt('Radar image on the floors')}><MapIcon /> {tt('Radar')}</Toggle>
        <Button size="sm" variant="outline" className="bg-overlay backdrop-blur-sm" onClick={() => scene?.topDown()}><ScanEye /> {tt('Top')}</Button>
        <Button size="sm" variant="outline" className="bg-overlay backdrop-blur-sm" onClick={() => scene?.reset()}><RotateCcw /> {tt('Reset')}</Button>
      </div>
      {ready && rigMissing && !rigHintClosed && (
        <div className="absolute top-24 right-2 flex max-w-72 items-start gap-2 rounded-md border bg-overlay px-2.5 py-2 text-[11px] text-muted-foreground backdrop-blur-sm" data-testid="rig-missing">
          <span>{tt('Real player models are not installed in this folder. Run') + ' '}<code className="font-mono text-foreground">{tt('npm run anims:extract')}</code> {tt('(or') + ' '}<code className="font-mono text-foreground">{tt('npm run assets:import -- "&lt;old folder&gt;"')}</code>{tt('), then rebuild.')}</span>
          <button className="text-foreground" aria-label={tt('Hide')} onClick={() => { setRigHintClosed(true); try { sessionStorage.setItem('scrimview.rigHint', '1'); } catch { /* */ } }}>×</button>
        </div>
      )}
      {ready && !(autoCut && follow >= 0) && <div className="absolute bottom-10 left-2"><CutControl scene={scene} value={cut} onChange={setCut} /></div>}
      {!drawing && (
        <p className="pointer-events-none absolute bottom-2 left-2 rounded-md border bg-overlay px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
          {tt('Drag to rotate · right-drag to pan · wheel to zoom · 1–0 to follow a player')}
        </p>
      )}
    </div>
  );
}

// useScrim exige un store : celui-ci ne change jamais (vue 3D sans scrim)
const DUMMY = { subscribe: () => () => {}, getVersion: () => 0 } as unknown as ScrimStore;
