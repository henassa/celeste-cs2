// Onglet Lineups : grenades regroupées par point de lancer et point d'arrivée sur toute la
// bibliothèque. Le sujet et les filtres de rounds viennent de la page.

import { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import type { LibraryMatch } from '@/library/library';
import type { GrenadeKind } from '@/data/types';
import type { Subject } from '@/analysis/heatmap';
import { mapsWithSpatial } from '@/analysis/heatmap';
import { clusterLineups, collectThrows, techLabel, type Lineup } from '@/analysis/lineups';
import { isDefaultFilter, keptRounds, trendLevel, type RoundFilter, type RoundView, type TrendLevel } from '@/analysis/rounds';
import { getMap, mapDisplayName } from '@/maps/maps';
import { placeLabel, setposCommand } from '@/viewer/places';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CopySetpos } from '../CopySetpos';
import { roundClockAt } from '../GrenadesView';
import { NadeCanvas, type FinderTarget, type NadeItem } from '../NadeCanvas';
import { Slider } from '@/components/ui/slider';
import { setFinderMode, useFinderMode, type FinderMode } from '@/app/finder';
import { locale, tt } from '@/i18n';

const KINDS: { id: GrenadeKind | 'all'; label: string }[] = [
  { id: 'smoke', label: tt('Smoke') }, { id: 'flash', label: tt('Flash') }, { id: 'molotov', label: tt('Molly') }, { id: 'he', label: 'HE' }, { id: 'all', label: tt('All') },
];
const KIND_LABEL: Record<GrenadeKind, string> = { smoke: tt('Smoke'), flash: tt('Flash'), molotov: tt('Molotov'), he: 'HE', decoy: tt('Decoy') };
const LEVEL: Record<TrendLevel, { label: string; cls: string }> = {
  habit: { label: tt('Habit'), cls: 'bg-primary text-primary-foreground' },
  recurring: { label: tt('Recurring'), cls: 'border text-foreground' },
  oneoff: { label: tt('One-off'), cls: 'text-muted-foreground' },
};

const repSetpos = (l: Lineup) => { const t = l.rep.nade.th!; return setposCommand(t.x, t.y, t.z, t.pitch, t.yaw); };

interface Props {
  matches: LibraryMatch[];
  map?: string;
  onMapChange: (map: string) => void;
  subject: Subject;
  filter: RoundFilter;
  views: RoundView[];
  filterPanel: React.ReactNode;
  onOpenRound: (m: LibraryMatch, round: number) => void;
}

export function LineupsTab({ matches, map: mapProp, onMapChange, subject, filter, views, filterPanel, onOpenRound }: Props) {
  const maps = useMemo(() => mapsWithSpatial(matches), [matches]);
  const map = mapProp && maps.includes(mapProp) ? mapProp : maps[0] ?? '';
  const [kind, setKind] = useState<GrenadeKind | 'all'>('smoke');
  const [minCount, setMinCount] = useState<'1' | '2'>('2');
  const [selected, setSelected] = useState<string | null>(null);
  const [layer, setLayer] = useState<'upper' | 'lower'>('upper');
  const cal = getMap(map);

  const restricted = !isDefaultFilter({ ...filter, side: 'all' });
  const rounds = useMemo(() => (restricted ? keptRounds(views) : undefined), [restricted, views]);
  const throws = useMemo(() => (map ? collectThrows(matches, { map, subject, side: filter.side, kind, rounds }) : []), [matches, map, subject, filter.side, kind, rounds]);
  const all = useMemo(() => clusterLineups(throws), [throws]);
  // Nade finder : grenades qui arrivent (ou partent) près du point cliqué sur la carte
  const finder = useFinderMode();
  const [point, setPoint] = useState<[number, number] | null>(null);
  const [radius, setRadius] = useState(220);
  const finding = finder !== 'off';
  const target: FinderTarget | null = finding && point ? { x: point[0], y: point[1], radius, mode: finder } : null;
  const near = (l: Lineup) => { if (!target) return 0; const p = target.mode === 'to' ? l.to : l.from; return Math.hypot(p[0] - target.x, p[1] - target.y); };
  const lineups = finding
    ? (target ? all.filter((l) => near(l) <= radius).sort((a, b) => near(a) - near(b) || b.throws.length - a.throws.length) : [])
    : all.filter((l) => l.throws.length >= Number(minCount));
  const totalMaps = new Set(throws.map((t) => t.match.id)).size;
  const sel = lineups.find((l) => l.id === selected) ?? null;
  const withoutThrow = useMemo(() => matches.filter((m) => m.map === map && m.spatial && (m.spatial.version ?? 0) < 3).length, [matches, map]);

  // Nade finder sans point : toutes les arrivées (ou tous les départs) en repère, pour savoir où cliquer
  const items: NadeItem[] = (finding && !point ? all : lineups).map((l) => ({ id: l.id, kind: l.kind, from: finding && !point && finder === 'to' ? null : l.from, to: finding && !point && finder === 'from' ? l.from : l.to, count: l.throws.length }));

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 auto-rows-max overflow-y-auto md:auto-rows-auto md:overflow-visible md:grid-cols-[300px_1fr_380px] gap-2">
      <div className="min-h-0 space-y-4 overflow-y-auto rounded-xl border bg-card p-4">
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">{tt('Map')}</div>
          <Select value={map} onValueChange={(v) => { onMapChange(v); setSelected(null); }}>
            <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{maps.map((m) => <SelectItem key={m} value={m}>{mapDisplayName(m)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2 rounded-lg border p-2.5" data-testid="nade-finder">
          <div className="text-xs font-medium">{tt('Nade finder')}</div>
          <ToggleGroup type="single" variant="outline" size="sm" value={finder} onValueChange={(v) => { if (v) { setFinderMode(v as FinderMode); setSelected(null); } }} className="w-full">
            <ToggleGroupItem value="off" className="flex-1 px-1 text-xs">{tt('Browse')}</ToggleGroupItem>
            <ToggleGroupItem value="to" className="flex-1 px-1 text-xs">{tt('Lands at')}</ToggleGroupItem>
            <ToggleGroupItem value="from" className="flex-1 px-1 text-xs">{tt('Thrown from')}</ToggleGroupItem>
          </ToggleGroup>
          {finding && (
            <>
              <p className="text-[11px] text-muted-foreground">
                {finder === 'to' ? tt('Click the map where you want the grenade to land: every throw of your demos that lands there shows up, closest first.') : tt('Click where you stand: every grenade thrown from there shows up, with where it lands.')}
              </p>
              <Slider label={tt('Search radius')} min={60} max={700} step={10} value={radius} onChange={setRadius} format={(v) => `${(v / 52.5).toFixed(1)} m`} />
              {point && <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => { setPoint(null); setSelected(null); }}>{tt('Clear the point')}</button>}
            </>
          )}
        </div>
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">{tt('Grenade')}</div>
          <ToggleGroup type="single" variant="outline" size="sm" value={kind} onValueChange={(v) => { if (v) { setKind(v as typeof kind); setSelected(null); } }} className="w-full">
            {KINDS.map((k) => <ToggleGroupItem key={k.id} value={k.id} className="flex-1 px-1 text-xs">{k.label}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        <div className={cn('space-y-1.5', finding && 'hidden')}>
          <div className="text-xs text-muted-foreground">{tt('Show')}</div>
          <ToggleGroup type="single" variant="outline" size="sm" value={minCount} onValueChange={(v) => v && setMinCount(v as typeof minCount)} className="w-full">
            <ToggleGroupItem value="2" className="flex-1 text-xs">{tt('Thrown 2+ times')}</ToggleGroupItem>
            <ToggleGroupItem value="1" className="flex-1 text-xs">{tt('Every throw')}</ToggleGroupItem>
          </ToggleGroup>
          <p className="text-[11px] text-muted-foreground">{tt('Throws are grouped when they start within ~1 m and land within ~1.5 m of each other.')}</p>
        </div>
        {cal?.hasLower && (
          <ToggleGroup type="single" variant="outline" size="sm" value={layer} onValueChange={(v) => v && setLayer(v as typeof layer)}>
            <ToggleGroupItem value="upper" className="px-3 text-xs">{tt('Upper')}</ToggleGroupItem>
            <ToggleGroupItem value="lower" className="px-3 text-xs">{tt('Lower')}</ToggleGroupItem>
          </ToggleGroup>
        )}
        {withoutThrow > 0 && <p className="text-[11px] text-muted-foreground">{withoutThrow} {tt('map')}{withoutThrow === 1 ? '' : 's'} {tt('added with an older version: add these demos again to include their grenades.')}</p>}
        <div className="space-y-4 border-t pt-3">{filterPanel}</div>
      </div>

      <div className="relative min-h-0 overflow-hidden rounded-xl border bg-card p-3">
        {map && <NadeCanvas map={map} items={items} selected={selected} onSelect={setSelected} layer={layer} target={target} onPick={finding ? (x, y) => { setPoint([x, y]); setSelected(null); } : undefined} />}
        {finding && !point && <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-full border bg-overlay px-3 py-1 text-xs text-muted-foreground backdrop-blur-sm">{finder === 'to' ? tt('Click where the grenade should land') : tt('Click where you stand')}</div>}
      </div>

      <div className="flex min-h-0 flex-col gap-2">
        {sel && (
          <div className="space-y-2 rounded-xl border bg-card p-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">{KIND_LABEL[sel.kind]} · {placeLabel(sel.toPlace) || 'unknown'}</span>
              <span className={cn('rounded-sm px-1.5 py-px text-[10px]', LEVEL[trendLevel(sel.maps, totalMaps, sel.throws.length)].cls)}>{LEVEL[trendLevel(sel.maps, totalMaps, sel.throws.length)].label}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {tt('From') + ' '}{placeLabel(sel.fromPlace) || 'unknown'} · {techLabel(sel.tech)} {tt('· usually at') + ' '}{roundClockAt(sel.avgT)} {tt('on the round clock')}
            </div>
            <code className="block truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground" title={repSetpos(sel)}>{repSetpos(sel)}</code>
            <div className="flex items-center gap-1 text-xs text-muted-foreground"><CopySetpos get={() => repSetpos(sel)} /> {tt('Copy setpos of the most typical throw')}</div>
            <div className="max-h-48 space-y-0.5 overflow-y-auto border-t pt-2">
              {sel.throws.map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{new Date(t.match.date).toLocaleDateString(locale)}</span>
                  <span className="num text-muted-foreground">R{t.nade.r + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{t.match.players[t.nade.p]?.name ?? '?'}</span>
                  <span className="text-muted-foreground">{techLabel(t.nade.th!.tech)}</span>
                  <Button size="icon-xs" variant="ghost" aria-label={tt('Open in the replay')} onClick={() => onOpenRound(t.match, t.nade.r)}><Play /></Button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border bg-card p-2">
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {finding
              ? (point ? (finder === 'to' ? tt(lineups.length === 1 ? '{0} way to get a grenade there, closest first' : '{0} ways to get a grenade there, closest first', [lineups.length]) : tt(lineups.length === 1 ? '{0} way to use this spot, closest first' : '{0} ways to use this spot, closest first', [lineups.length])) : tt('Pick a point on the map'))
              : tt('{0} lineup{1} from {2} throws on {3} map{4}', [lineups.length, lineups.length === 1 ? '' : 's', throws.length, totalMaps, totalMaps === 1 ? '' : 's'])}
          </div>
          {lineups.map((l) => {
            const lv = trendLevel(l.maps, totalMaps, l.throws.length);
            return (
              <button key={l.id} onClick={() => setSelected(l.id === selected ? null : l.id)}
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent', l.id === selected && 'bg-accent')}>
                <span className="num w-6 text-right font-medium">{l.throws.length}×</span>
                <span className="min-w-0 flex-1 truncate">
                  {kind === 'all' && <span className="text-muted-foreground">{KIND_LABEL[l.kind]} · </span>}
                  {placeLabel(l.toPlace) || '—'} <span className="text-muted-foreground">{tt('from') + ' '}{placeLabel(l.fromPlace) || '—'}</span>
                </span>
                {l.tech.includes('jump') && <span className="rounded-sm border px-1 text-[10px] text-muted-foreground">{tt('Jump')}</span>}
                {finding && target ? <span className="num text-muted-foreground" title={tt('Distance to your point')}>{(near(l) / 52.5).toFixed(1)} m</span> : <span className="num text-muted-foreground" title={tt('Maps where it was thrown')}>{l.maps}/{totalMaps}</span>}
                <span className={cn('rounded-sm px-1.5 py-px text-[10px]', LEVEL[lv].cls)}>{LEVEL[lv].label}</span>
              </button>
            );
          })}
          {lineups.length === 0 && (!finding || point) && <p className="px-2 py-1 text-xs text-muted-foreground">{finding ? tt('Nothing within this radius: widen it, or pick another grenade type (or All).') : tt('No lineup for these filters{0}.', [minCount === '2' ? ': try “Every throw”' : ''])}</p>}
        </div>
      </div>
    </div>
  );
}
