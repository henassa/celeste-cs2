// Timing heatmap : callouts en lignes, temps du round en colonnes (horloge 1:55 -> 0:00).

import type { TimingGrid } from '@/analysis/heatmap';
import { rampColor, rampCss, type RampId } from '@/analysis/ramps';
import { placeLabel } from '@/viewer/places';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { tt } from '@/i18n';

const clock = (sec: number) => { const l = Math.max(0, Math.ceil(115 - sec)); return `${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}`; };

export function TimingGridView({ grid, ramp }: { grid: TimingGrid; ramp: RampId }) {
  if (!grid.places.length) return <div className="p-6 text-sm text-muted-foreground">{tt('No fight with a known callout for these filters (demos added before callouts need adding again).')}</div>;
  const ticks = [0, 20, 40, 60, 80, 100];
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-2" data-testid="timing-grid">
      <div className="text-xs text-muted-foreground">{tt('Where fights happen over the round: each cell counts kills and deaths at a callout during') + ' '}{grid.bucket} {tt('s. Round clock on top.')}</div>
      <div className="grid gap-px" style={{ gridTemplateColumns: `140px repeat(${grid.columns}, minmax(14px, 1fr))` }}>
        <div />
        {Array.from({ length: grid.columns }, (_, c) => (
          <div key={c} className="num text-center text-[10px] text-muted-foreground">{ticks.includes(c * grid.bucket) ? clock(c * grid.bucket) : ''}</div>
        ))}
        {grid.places.map((p, r) => (
          <div key={p} className="contents">
            <div className="truncate pr-2 text-right text-xs leading-6">{placeLabel(p)}</div>
            {grid.counts[r].map((n, c) => {
              const v = n / grid.max;
              const [cr, cg, cb] = rampColor(ramp, ramp === 'mono' ? 0.25 + 0.75 * v : v);
              return (
                <Tooltip key={c}>
                  <TooltipTrigger asChild>
                    <div className="h-6 rounded-[2px]" style={{ background: n ? `rgb(${cr},${cg},${cb})` : 'var(--muted)', opacity: n ? 0.35 + 0.65 * Math.sqrt(v) : 0.35 }} />
                  </TooltipTrigger>
                  <TooltipContent>{placeLabel(p)} · {clock(c * grid.bucket)}–{clock((c + 1) * grid.bucket)} · {n} {tt('fight event')}{n === 1 ? '' : 's'}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{tt('Fewer')}</span><div className="h-2 w-32 rounded-full" style={{ background: rampCss(ramp) }} /><span>{tt('More')}</span>
        <span className="ml-auto num">{grid.total} {tt('events')}</span>
      </div>
    </div>
  );
}
