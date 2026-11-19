// Onglet Stratégies : rounds similaires regroupés (exécutions T, setups CT), avec leur nom
// automatique, leur fréquence, leur taux de victoire et la densité des positions sur le radar.

import { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import type { LibraryMatch } from '@/library/library';
import type { Subject } from '@/analysis/heatmap';
import type { HeatPoint } from '@/analysis/heatmap';
import { subjectMaps } from '@/analysis/brief';
import { detectStrategies } from '@/analysis/strategies';
import type { RoundView } from '@/analysis/rounds';
import { mapDisplayName } from '@/maps/maps';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HeatmapCanvas } from './HeatmapCanvas';
import { locale, tt } from '@/i18n';

const LEVEL = { habit: { label: tt('Habit'), cls: 'bg-primary text-primary-foreground' }, recurring: { label: tt('Recurring'), cls: 'border text-foreground' }, oneoff: { label: tt('One-off'), cls: 'text-muted-foreground' } } as const;

interface Props {
  matches: LibraryMatch[];
  map?: string;
  onMapChange: (m: string) => void;
  subject: Subject;
  views: RoundView[];
  filterPanel: React.ReactNode;
  onOpenRound: (m: LibraryMatch, round: number, queue?: number[]) => void;
}

export function StrategiesTab({ matches, map: mapProp, onMapChange, subject, views, filterPanel, onOpenRound }: Props) {
  const maps = useMemo(() => subjectMaps(matches, subject), [matches, subject]);
  const map = mapProp && maps.includes(mapProp) ? mapProp : maps[0] ?? '';
  const [side, setSide] = useState<'t' | 'ct'>('t');
  const [threshold, setThreshold] = useState(0.5);
  const [sel, setSel] = useState<string | null>(null);
  const onMap = useMemo(() => views.filter((v) => v.match.map === map), [views, map]);
  const strategies = useMemo(() => detectStrategies(onMap, side, threshold), [onMap, side, threshold]);
  const s = strategies.find((x) => x.id === sel) ?? strategies[0];
  const sideRounds = onMap.filter((v) => v.side === side).length;
  const points: HeatPoint[] = useMemo(() => {
    if (!s) return [];
    const t = side === 't' ? 30 : 20;
    return s.rounds.flatMap((v) => v.match.spatial!.pos.filter((p) => p.r === v.round.i && p.team === v.team && p.s === t).map((p) => ({ x: p.x, y: p.y, z: p.z })));
  }, [s, side]);
  const openQueue = (v: RoundView) => {
    const queue = s ? [...new Set(s.rounds.filter((r) => r.match.id === v.match.id).map((r) => r.round.i))].sort((a, b) => a - b) : undefined;
    onOpenRound(v.match, v.round.i, queue);
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 auto-rows-max overflow-y-auto md:auto-rows-auto md:overflow-visible md:grid-cols-[300px_1fr_1fr] gap-2">
      <div className="min-h-0 space-y-4 overflow-y-auto rounded-xl border bg-card p-4">
        <div className="space-y-1">
          <div className="text-sm font-medium">{tt('Strategy detector')}</div>
          <p className="text-xs text-muted-foreground">{tt('Groups rounds that look alike: where players stand at 20–30 s, where smokes and mollies land in the first 40 s, the site and timing of the plant.')}</p>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">{tt('Map')}</div>
          <Select value={map} onValueChange={(v) => { onMapChange(v); setSel(null); }}>
            <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{maps.map((m) => <SelectItem key={m} value={m}>{mapDisplayName(m)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">{tt('Side')}</div>
          <ToggleGroup type="single" variant="outline" size="sm" value={side} onValueChange={(v) => { if (v) { setSide(v as 't' | 'ct'); setSel(null); } }} className="w-full">
            <ToggleGroupItem value="t" className="flex-1 text-xs">{tt('T executes')}</ToggleGroupItem>
            <ToggleGroupItem value="ct" className="flex-1 text-xs">{tt('CT setups')}</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground"><span>{tt('Grouping')}</span><span>{threshold < 0.45 ? 'loose' : threshold > 0.6 ? 'strict' : 'balanced'}</span></div>
          <input type="range" min={0.3} max={0.75} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="w-full accent-foreground" aria-label={tt('Grouping strictness')} />
        </div>
        <div className="space-y-4 border-t pt-3">{filterPanel}</div>
      </div>

      <div className="min-h-0 space-y-2 overflow-y-auto">
        {subject.kind === 'all' && <div className="rounded-xl border bg-card p-4 text-xs text-muted-foreground">{tt('Tip: pick a team or a player on the left. With “Everyone”, rounds of both teams are mixed.')}</div>}
        {strategies.length === 0 ? (
          <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">{tt('No recurring pattern in these') + ' '}{sideRounds} {tt('rounds. Add more demos, loosen the grouping, or check that the demos were added with callouts.')}</div>
        ) : strategies.map((x) => (
          <button key={x.id} onClick={() => setSel(x.id)} className={cn('w-full rounded-xl border bg-card p-4 text-left transition-colors hover:border-foreground/30', s?.id === x.id && 'border-foreground/40')}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{x.name}</span>
              <span className={cn('rounded-sm px-1.5 py-px text-[10px]', LEVEL[x.level].cls)}>{LEVEL[x.level].label}</span>
              <span className="flex-1" />
              <span className="num text-xs text-muted-foreground">{x.rounds.length}/{sideRounds} {tt('rounds · won') + ' '}{x.won}/{x.rounds.length} · {x.maps} {tt('map')}{x.maps === 1 ? '' : 's'}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{x.details.join(' · ')}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {x.rounds.map((v) => (
                <span key={`${v.match.id}:${v.round.i}`} role="button" tabIndex={0} title={tt('{0} {1} · round {2} · open in the replay', [mapDisplayName(v.match.map), new Date(v.match.date).toLocaleDateString(locale), v.round.i + 1])}
                  onClick={(e) => { e.stopPropagation(); openQueue(v); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); openQueue(v); } }}
                  className={cn('num cursor-pointer rounded-md border px-1.5 py-0.5 text-[11px] hover:border-foreground/40', v.won ? 'text-foreground' : 'text-muted-foreground', v === x.medoid && 'bg-accent')}>
                  R{v.round.i + 1}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-col gap-2">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border bg-card p-3">
          {map && <HeatmapCanvas map={map} points={points} layer="upper" mode="heat" ramp="orange" />}
          {s && <div className="pointer-events-none absolute top-3 left-3 rounded-md border bg-overlay px-2 py-1 text-[11px] text-overlay-foreground">{s.name} {tt('· positions at') + ' '}{side === 't' ? 30 : 20} s</div>}
        </div>
        {s && (
          <Button size="sm" variant="outline" onClick={() => openQueue(s.medoid)}><Play /> {tt('Watch the most typical round, then the others')}</Button>
        )}
      </div>
    </div>
  );
}
