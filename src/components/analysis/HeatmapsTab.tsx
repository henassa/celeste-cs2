// Onglet Heatmaps : densité sur le radar. Le sujet et les filtres de rounds viennent de la page
// (partagés avec l'onglet Rounds) ; ici on choisit la carte, l'événement et la plage de temps.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { hasNav } from '@/three/nav-maps';

const HeatmapScene = lazy(() => import('@/components/three/HeatmapScene'));
import { ImageDown } from 'lucide-react';
import type { LibraryMatch } from '@/library/library';
import { heatPoints, mapsWithSpatial, timingGrid, TIME_RANGES, type HeatEvent, type Subject, type TimeRange } from '@/analysis/heatmap';
import { RAMPS, rampCss, type RampId } from '@/analysis/ramps';
import { TimingGridView } from './TimingGridView';
import { Heatmap3D } from './Heatmap3D';
import { isDefaultFilter, keptRounds, type RoundFilter, type RoundView } from '@/analysis/rounds';
import { POS_TIMES } from '@/library/spatial';
import type { GrenadeKind } from '@/data/types';
import { getMap, mapDisplayName } from '@/maps/maps';
import { downloadBlob, safeName } from '@/lib/download';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { HeatmapCanvas } from './HeatmapCanvas';
import { useZones } from '@/app/zones';
import { ZonesChip } from '@/components/ZonesChip';
import { DEFAULT_DENSITY, loadDensity, saveDensity, type DensitySettings } from '@/analysis/density';
import { Slider } from '@/components/ui/slider';
import { tt } from '@/i18n';

interface Props {
  matches: LibraryMatch[];
  map?: string;
  onMapChange: (map: string) => void;
  subject: Subject;
  filter: RoundFilter;
  /** Rounds retenus par les filtres (même sujet). */
  views: RoundView[];
  filterPanel: React.ReactNode;
}

type ShowId = HeatEvent | 'timing';
const EVENT_LABEL: Record<ShowId, string> = { kills: tt('Kills'), deaths: tt('Deaths'), pos: tt('Positions'), nades: tt('Nades'), timing: tt('Timing') };

export function HeatmapsTab({ matches, map: mapProp, onMapChange, subject, filter, views, filterPanel }: Props) {
  const maps = useMemo(() => mapsWithSpatial(matches), [matches]);
  const map = mapProp && maps.includes(mapProp) ? mapProp : maps[0] ?? '';
  const [show, setShow] = useState<ShowId>('deaths');
  const event: HeatEvent = show === 'timing' ? 'deaths' : show;
  const [ramp, setRamp] = useState<RampId>('mono');
  const [posTime, setPosTime] = useState<number>(20);
  const [time, setTime] = useState<TimeRange>('all');
  const [nadeKind, setNadeKind] = useState<GrenadeKind | 'all'>('smoke');
  const [layer, setLayer] = useState<'upper' | 'lower'>('upper');
  const [mode, setMode] = useState<'heat' | 'dots' | '3d'>('heat');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Zones du coach sur une autre carte : on y bascule
  const zones = useZones();
  useEffect(() => { if (zones && zones.map !== map && maps.includes(zones.map)) onMapChange(zones.map); }, [zones]); // eslint-disable-line react-hooks/exhaustive-deps
  const [visible, setVisible] = useState(0);
  const [density, setDensityState] = useState<DensitySettings>(loadDensity);
  const setDensity = (patch: Partial<DensitySettings>) => setDensityState((d) => { const n = { ...d, ...patch }; saveDensity(n); return n; });

  // Le côté est appliqué directement ; les autres filtres passent par la liste des rounds retenus
  const restricted = !isDefaultFilter({ ...filter, side: 'all' });
  const rounds = useMemo(() => (restricted ? keptRounds(views) : undefined), [restricted, views]);
  const { points, matches: used } = useMemo(
    () => (map ? heatPoints(matches, { map, subject, side: filter.side, event, posTime, nadeKind, time, rounds }) : { points: [], matches: 0 }),
    [matches, map, subject, filter.side, event, posTime, nadeKind, time, rounds],
  );
  const grid = useMemo(() => (show === 'timing' && map ? timingGrid(matches, { map, subject, side: filter.side, rounds }) : null), [show, matches, map, subject, filter.side, rounds]);
  const cal = getMap(map);
  useEffect(() => { if (mode === '3d' || show === 'timing') setVisible(points.length); }, [mode, show, points.length]);

  if (!maps.length) return <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">{tt('No heatmap data yet: add demos to the library (demos added before this version must be added again).')}</div>;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 auto-rows-max overflow-y-auto md:auto-rows-auto md:overflow-visible md:grid-cols-[300px_1fr] gap-2">
      <div className="min-h-0 space-y-4 overflow-y-auto rounded-xl border bg-card p-4">
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">{tt('Map')}</div>
          <Select value={map} onValueChange={onMapChange}>
            <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{maps.map((m) => <SelectItem key={m} value={m}>{mapDisplayName(m)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">{tt('Show')}</div>
          <ToggleGroup type="single" variant="outline" size="sm" value={show} onValueChange={(v) => v && setShow(v as ShowId)} className="w-full">
            {(Object.keys(EVENT_LABEL) as ShowId[]).map((e) => <ToggleGroupItem key={e} value={e} className="flex-1 px-1 text-[11px]">{EVENT_LABEL[e]}</ToggleGroupItem>)}
          </ToggleGroup>
          {show === 'timing' ? null : event === 'pos' ? (
            <ToggleGroup type="single" variant="outline" size="sm" value={String(posTime)} onValueChange={(v) => v && setPosTime(Number(v))} className="w-full">
              {POS_TIMES.map((t) => <ToggleGroupItem key={t} value={String(t)} className="flex-1 px-1 text-xs">{t}s</ToggleGroupItem>)}
            </ToggleGroup>
          ) : (
            <ToggleGroup type="single" variant="outline" size="sm" value={time} onValueChange={(v) => v && setTime(v as TimeRange)} className="w-full">
              {TIME_RANGES.map((t) => <ToggleGroupItem key={t.id} value={t.id} title={t.hint} className="flex-1 px-1 text-[11px]">{t.label}</ToggleGroupItem>)}
            </ToggleGroup>
          )}
          {show === 'nades' && (
            <ToggleGroup type="single" variant="outline" size="sm" value={nadeKind} onValueChange={(v) => v && setNadeKind(v as typeof nadeKind)} className="w-full">
              {(['smoke', 'flash', 'molotov', 'he', 'all'] as const).map((k) => <ToggleGroupItem key={k} value={k} className="flex-1 px-1 text-xs capitalize">{k === 'he' ? 'HE' : k}</ToggleGroupItem>)}
            </ToggleGroup>
          )}
          <p className="text-[11px] text-muted-foreground">
            {show === 'kills' && tt('Where the selected players stood when they got a kill.')}
            {show === 'deaths' && tt('Where the selected players died.')}
            {show === 'pos' && tt('Where the selected players were {0} s after the freeze time (default setups).', [posTime])}
            {show === 'nades' && tt('Where the selected players’ grenades landed.')}
            {show === 'timing' && tt('When each callout sees fights during the round.')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {show !== 'timing' && (
            <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && setMode(v as typeof mode)}>
              <ToggleGroupItem value="heat" className="px-3 text-xs">{tt('Density')}</ToggleGroupItem>
              <ToggleGroupItem value="dots" className="px-3 text-xs">{tt('Dots')}</ToggleGroupItem>
              <ToggleGroupItem value="3d" className="px-3 text-xs">3D</ToggleGroupItem>
            </ToggleGroup>
          )}
          {cal?.hasLower && show !== 'timing' && mode !== '3d' && (
            <ToggleGroup type="single" variant="outline" size="sm" value={layer} onValueChange={(v) => v && setLayer(v as typeof layer)}>
              <ToggleGroupItem value="upper" className="px-3 text-xs">{tt('Upper')}</ToggleGroupItem>
              <ToggleGroupItem value="lower" className="px-3 text-xs">{tt('Lower')}</ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">{tt('Color')}</div>
          <div className="flex gap-1">
            {(Object.keys(RAMPS) as RampId[]).map((r) => (
              <button key={r} onClick={() => setRamp(r)} aria-label={`${RAMPS[r].label} colors`}
                className={`flex flex-1 flex-col items-center gap-1 rounded-md border px-1 py-1 text-[11px] ${ramp === r ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}>
                <span className="h-1.5 w-full rounded-full" style={{ background: rampCss(r) }} />{RAMPS[r].label}
              </button>
            ))}
          </div>
        </div>
        {show !== 'timing' && (mode !== '3d' || hasNav(map)) && (
          <div className="space-y-2.5 border-t pt-3" data-testid="heat-controls">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{tt('Rendering')}</span>
              <button type="button" className="text-[11px] underline-offset-2 hover:text-foreground hover:underline" onClick={() => setDensity(DEFAULT_DENSITY)}>{tt('Reset')}</button>
            </div>
            <Slider label={mode === 'dots' ? tt('Dot size') : tt('Radius')} value={density.radius} min={4} max={48} onChange={(v) => setDensity({ radius: v })} format={(v) => `${v} px`} />
            {mode !== 'dots' && <Slider label={tt('Intensity')} value={density.intensity} min={0.25} max={4} step={0.05} onChange={(v) => setDensity({ intensity: v })} format={(v) => `×${v.toFixed(2)}`} />}
            {mode !== 'dots' && <Slider label={tt('Hide below')} value={density.threshold} min={0} max={0.6} step={0.01} onChange={(v) => setDensity({ threshold: v })} format={(v) => `${Math.round(v * 100)}%`} />}
            <Slider label={tt('Opacity')} value={density.opacity} min={0.2} max={1} step={0.05} onChange={(v) => setDensity({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
            {mode !== 'dots' && (
              <div className="flex items-center gap-2">
                <ToggleGroup type="single" variant="outline" size="sm" value={density.scale} onValueChange={(v) => v && setDensity({ scale: v as DensitySettings['scale'] })} className="flex-1">
                  <ToggleGroupItem value="linear" className="flex-1 text-[11px]" title={tt('Proportional: hotspots stand out')}>{tt('Linear')}</ToggleGroupItem>
                  <ToggleGroupItem value="sqrt" className="flex-1 text-[11px]" title={tt('Balanced')}>√</ToggleGroupItem>
                  <ToggleGroupItem value="log" className="flex-1 text-[11px]" title={tt('Shows rare spots too')}>{tt('Log')}</ToggleGroupItem>
                </ToggleGroup>
                <Toggle size="sm" variant="outline" pressed={density.contours} onPressedChange={(v) => setDensity({ contours: v })} className="text-[11px]">{tt('Contours')}</Toggle>
              </div>
            )}
          </div>
        )}
        <div className="space-y-2 border-t pt-3 text-xs text-muted-foreground">
          <div>
            <span className="num text-foreground">{visible}</span>{visible !== points.length ? ` of ${points.length}` : ''} {tt('events from') + ' '}<span className="num text-foreground">{used}</span> {tt('map')}{used === 1 ? '' : 's'}
            {restricted && <> {tt('· filtered rounds only')}</>}
          </div>
          <Button size="sm" variant="outline" className="w-full" onClick={() => canvasRef.current?.toBlob((b) => b && downloadBlob(b, `${safeName(`${map}_${event}_${filter.side}`)}.png`))}>
            <ImageDown /> {tt('Save as PNG')}
          </Button>
        </div>
        <div className="space-y-4 border-t pt-3">{filterPanel}</div>
      </div>
      <div className="relative min-h-0 overflow-hidden rounded-xl border bg-card p-3">
        {map && <ZonesChip map={map} className="absolute top-14 left-5 z-10" />}
        {map && show === 'timing' && grid && <TimingGridView grid={grid} ramp={ramp} />}
        {map && show !== 'timing' && mode === '3d' && (hasNav(map)
          ? <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-muted-foreground">{tt('Loading 3D…')}</div>}><HeatmapScene map={map} points={points} ramp={ramp} density={density} canvasRef={canvasRef} /></Suspense>
          : <Heatmap3D map={map} points={points} ramp={ramp} canvasRef={canvasRef} />)}
        {map && show !== 'timing' && mode !== '3d' && <HeatmapCanvas map={map} points={points} layer={layer} mode={mode} ramp={ramp} density={density} canvasRef={canvasRef} onVisibleCount={setVisible} />}
      </div>
    </div>
  );
}
