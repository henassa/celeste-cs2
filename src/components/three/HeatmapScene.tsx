// Heatmap sur la carte en vraie 3D (chargé à la demande : three.js n'est téléchargé qu'ici).

import { useEffect, useRef, useState } from 'react';
import { Box, Crosshair, RotateCcw, ScanEye } from 'lucide-react';
import { quality3dStore } from '@/app/quality';
import { MapScene } from '@/three/map-scene';
import type { HeatPoint } from '@/analysis/heatmap';
import type { RampId } from '@/analysis/ramps';
import type { DensitySettings } from '@/analysis/density';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { CutControl } from './CutControl';
import { useZones } from '@/app/zones';
import { drawZones } from '@/app/zones-draw';
import { tt } from '@/i18n';

interface Props {
  map: string;
  points: HeatPoint[];
  ramp: RampId;
  density: DensitySettings;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

export default function HeatmapScene({ map, points, ramp, density, canvasRef }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<MapScene | null>(null);
  const [ready, setReady] = useState(false);
  const [dots, setDots] = useState(true);
  const [cut, setCut] = useState<number | null>(null);
  useEffect(() => { scene?.setCut(cut); }, [scene, cut]);

  useEffect(() => {
    const s = new MapScene(host.current!);
    (window as unknown as { __scene3d?: MapScene }).__scene3d = s; // débogage local et tests
    if (canvasRef) canvasRef.current = s.renderer.domElement;
    setScene(s);
    setReady(false);
    setCut(null);
    s.load(map).then((ok) => { if (ok) s.setQuality(quality3dStore.get()); setReady(ok); });
    return () => s.dispose();
  }, [map, canvasRef]);
  // Reconstruction de la densité différée pendant qu'on bouge un curseur (évite les à-coups)
  useEffect(() => {
    if (!scene || !ready) return;
    const t = setTimeout(() => scene.setHeat(points, ramp, density, dots), 120);
    return () => clearTimeout(t);
  }, [scene, ready, points, ramp, density, dots]);
  // Zones du coach posées sur les sols
  const zones = useZones();
  useEffect(() => {
    if (!scene || !ready) return;
    if (!zones || zones.map !== map) { scene.setDecal(null, null); return; }
    const c = document.createElement('canvas');
    c.width = c.height = 2048;
    drawZones(c.getContext('2d')!, zones, (rx, ry) => [rx * 2, ry * 2], 2, 2.5);
    scene.setDecal(c, null);
  }, [scene, ready, zones, map]);
  // Coupe proposée une fois la carte chargée (ex. Vertigo : la tour au-dessus de la zone de jeu)
  useEffect(() => { if (scene && ready) setCut(scene.suggestCut(points.map((p) => p.z))); }, [scene, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative h-full w-full" data-testid="heatmap-3d">
      <div ref={host} className="absolute inset-0 overflow-hidden rounded-lg" />
      {!ready && <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">{tt('Loading the 3D map…')}</div>}
      <div className="absolute top-2 right-2 flex gap-1">
        <Toggle size="sm" variant="outline" className="bg-overlay backdrop-blur-sm" pressed={dots} onPressedChange={setDots} aria-label={tt('Show events at their height')}><Box /> {tt('Events')}</Toggle>
        <Button size="sm" variant="outline" className="bg-overlay backdrop-blur-sm" onClick={() => scene?.topDown()}><ScanEye /> {tt('Top')}</Button>
        <Button size="sm" variant="outline" className="bg-overlay backdrop-blur-sm" onClick={() => scene?.reset()}><RotateCcw /> {tt('Reset')}</Button>
      </div>
      {ready && <div className="absolute top-2 left-2"><CutControl scene={scene} value={cut} onChange={setCut} /></div>}
      <p className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md border bg-overlay px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
        <Crosshair className="size-3" /> {tt('Drag to rotate · right-drag to pan · wheel to zoom')}
      </p>
    </div>
  );
}
