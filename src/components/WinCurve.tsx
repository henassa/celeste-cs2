// Courbe de probabilité de victoire du round, au-dessus de la barre de lecture.
// Modèle appris sur la bibliothèque si l'étalonnage l'utilise, sinon le modèle de départ.

import { memo, useMemo } from 'react';
import type { MatchData } from '@/data/types';
import { buildSpatial } from '@/library/spatial';
import { loadModels } from '@/calib/model';
import { wpSeries } from '@/stats/wp-model';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { tt } from '@/i18n';

const H = 26;

export const WinCurve = memo(function WinCurve({ match: m, round: ri, tick }: { match: MatchData; round: number; tick: number }) {
  const sp = useMemo(() => buildSpatial(m), [m]);
  const wp = useMemo(() => loadModels().hltv3?.wp ?? null, []);
  const r = m.rounds[ri];
  const series = useMemo(() => (r ? wpSeries(sp, ri, wp, 0) : []), [sp, ri, wp, r]);
  if (!r || series.length < 2) return null;
  const t0 = r.startTick, t1 = r.officialEndTick;
  const x = (sec: number) => (((r.freezeEndTick + sec * m.tickrate) - t0) / (t1 - t0)) * 1000;
  const y = (p: number) => H - p * H;
  // Courbe en escalier : la probabilité change d'un coup à chaque kill / plant
  let d = `M${x(0)},${y(series[0].p)}`;
  for (let i = 1; i < series.length; i++) d += ` H${x(series[i].t)} V${y(series[i].p)}`;
  const now = (tick - r.freezeEndTick) / m.tickrate;
  let pNow = series[0].p;
  for (const s of series) if (s.t <= now) pNow = s.p;
  const live = tick >= r.freezeEndTick && tick <= r.endTick;

  return (
    <div className="relative mx-4 mt-1" data-testid="win-curve">
      <Tooltip>
        <TooltipTrigger asChild>
          <svg viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" className="block h-[26px] w-full overflow-visible">
            <line x1={0} x2={1000} y1={H / 2} y2={H / 2} stroke="currentColor" className="text-border" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            <path d={`${d} V${H} H${x(0)} Z`} className="fill-foreground/10" />
            <path d={d} fill="none" stroke="currentColor" className="text-foreground/70" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            {live && <line x1={x(now)} x2={x(now)} y1={0} y2={H} stroke="currentColor" className="text-foreground" vectorEffect="non-scaling-stroke" />}
          </svg>
        </TooltipTrigger>
        <TooltipContent>{tt('Chance that') + ' '}{m.teams[0].name} {tt('wins the round (')}{wp ? 'win model trained on your library' : 'default model'})</TooltipContent>
      </Tooltip>
      <span className="num pointer-events-none absolute top-0 right-0 max-w-40 truncate text-[10px] text-muted-foreground" title={m.teams[0].name}>
        {live ? `${Math.round(pNow * 100)}% ${m.teams[0].name}` : ''}
      </span>
    </div>
  );
});
