// Onglet Rounds : rounds de toute la bibliothèque retenus par les filtres, avec un résumé
// et la liste des rounds. Chaque round peut être rouvert dans le lecteur.

import { useMemo, useState } from 'react';
import { Play, TriangleAlert } from 'lucide-react';
import type { LibraryMatch } from '@/library/library';
import { SMALL_SAMPLE, summarizeRounds, tendencies, type RoundView, type Trend, type TrendLevel } from '@/analysis/rounds';
import { mapDisplayName } from '@/maps/maps';
import { placeLabel } from '@/viewer/places';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Tile } from './TeamsTab';
import { locale, tt } from '@/i18n';

const PAGE = 200;
const pct = (won: number, played: number) => (played ? `${((won / played) * 100).toFixed(0)}%` : '—');
const BUY_LABEL = { pistol: 'Pistol', eco: 'Eco', force: 'Force', full: 'Full' } as const;

const LEVEL: Record<TrendLevel, { label: string; cls: string; hint: string }> = {
  habit: { label: tt('Habit'), cls: 'bg-primary text-primary-foreground', hint: tt('Seen on at least half of the maps (3+ maps)') },
  recurring: { label: tt('Recurring'), cls: 'border text-foreground', hint: tt('Seen on 2 maps or more') },
  oneoff: { label: tt('One-off'), cls: 'text-muted-foreground', hint: tt('Seen on a single map: not a habit yet') },
};

function TrendList({ title, items, label, empty }: { title: string; items: Trend[]; label: (k: string) => string; empty: string }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">{title}</div>
      {items.length === 0 ? <p className="text-xs text-muted-foreground">{empty}</p> : items.slice(0, 5).map((t) => (
        <div key={t.key} className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate">{label(t.key)}</span>
            <span className="num text-muted-foreground" title={tt('Won {0} of these {1} rounds', [t.won, t.rounds])}>{t.rounds}/{t.of} · {t.maps}/{t.totalMaps} {tt('maps')}</span>
            <span className={cn('rounded-sm px-1.5 py-px text-[10px]', LEVEL[t.level].cls)} title={LEVEL[t.level].hint}>{LEVEL[t.level].label}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground/60" style={{ width: `${(t.rounds / Math.max(1, t.of)) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

/** Score [nous, eux] avant le round. */
function scoreBefore(v: RoundView): [number, number] {
  let us = 0, them = 0;
  for (const r of v.match.spatial!.rounds) {
    if (r.i >= v.round.i) break;
    if (r.winner === v.team) us++; else if (r.winner !== null) them++;
  }
  return [us, them];
}

interface Props {
  views: RoundView[];
  /** Nombre total de rounds avant filtres. */
  total: number;
  perspective: boolean;
  /** Ouvre un round ; `queue` = rounds filtrés du même match, à enchaîner. */
  onOpenRound: (m: LibraryMatch, round: number, queue?: number[]) => void;
}

export function RoundsTab({ views, total, perspective, onOpenRound }: Props) {
  const [limit, setLimit] = useState(PAGE);
  const s = useMemo(() => summarizeRounds(views), [views]);
  const sorted = useMemo(
    () => [...views].sort((a, b) => (b.match.date - a.match.date) || a.match.id.localeCompare(b.match.id) || (a.round.i - b.round.i) || (a.team - b.team)),
    [views],
  );
  const tend = useMemo(() => tendencies(views), [views]);
  const queueOf = (m: LibraryMatch) => [...new Set(views.filter((v) => v.match.id === m.id).map((v) => v.round.i))].sort((a, b) => a - b);
  const plants = s.plants.A + s.plants.B;
  const small = s.rounds > 0 && s.rounds < SMALL_SAMPLE;

  return (
    <div className="min-h-0 space-y-2 overflow-y-auto">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="num text-base font-semibold">{s.rounds}</span>
          <span className="text-sm text-muted-foreground">{tt('of') + ' '}{total} {tt('rounds ·') + ' '}{s.maps} {tt('map')}{s.maps === 1 ? '' : 's'}</span>
          {!perspective && <span className="text-xs text-muted-foreground">{tt('· each round counted once per team')}</span>}
        </div>
        {small && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="size-3.5" /> {tt('Small sample: fewer than') + ' '}{SMALL_SAMPLE} {tt('rounds, read these numbers as one-offs rather than habits.')}
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Tile label={tt('Rounds won')} value={pct(s.won, s.rounds)} sub={`${s.won}/${s.rounds}`} />
          <Tile label={tt('Opening duels won')} value={pct(s.openingWon, s.openingPlayed)} sub={`${s.openingWon}/${s.openingPlayed}`} />
          <Tile label={tt('Won after opening kill')} value={pct(s.winWithOpening.won, s.winWithOpening.played)} sub={`${s.winWithOpening.won}/${s.winWithOpening.played}`} />
          <Tile label={tt('Won after opening death')} value={pct(s.winWithoutOpening.won, s.winWithoutOpening.played)} sub={`${s.winWithoutOpening.won}/${s.winWithoutOpening.played}`} />
          <Tile label={tt('Plants (T rounds)')} value={pct(plants, s.tRounds)} sub={plants ? `A ${s.plants.A} · B ${s.plants.B}` : tt('{0} T rounds', [s.tRounds])} />
          <Tile label={tt('Average plant time')} value={s.avgPlantT != null ? `${s.avgPlantT.toFixed(0)} s` : '—'} sub="after freeze time" />
        </div>
      </div>

      {s.rounds > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-sm font-medium">{tt('Tendencies')}</span>
            <span className="text-xs text-muted-foreground">{tt('habit = seen on most maps, one-off = a single map')}</span>
          </div>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            <TrendList title={tt('Opening duels at')} items={tend.openings} label={placeLabel} empty="No callout data (add demos again)." />
            <TrendList title={tt('Plants (T rounds)')} items={tend.plants} label={(k) => `Site ${k}`} empty="No T round with a plant." />
            <TrendList title={tt('CT setup at 20 s')} items={tend.setups.ct} label={placeLabel} empty="No CT round or no callout data." />
            <TrendList title={tt('T positions at 20 s')} items={tend.setups.t} label={placeLabel} empty="No T round or no callout data." />
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-card">
        {sorted.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">{tt('No round matches these filters.')}</div>
        ) : (
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">{tt('Map')}</TableHead>
              <TableHead>{tt('Round')}</TableHead>
              <TableHead>{perspective ? tt('Side') : tt('Team')}</TableHead>
              <TableHead className="text-right">{tt('Score')}</TableHead>
              <TableHead>{tt('Buys')}</TableHead>
              <TableHead>{tt('Opening duel')}</TableHead>
              <TableHead>{tt('Bomb')}</TableHead>
              <TableHead>{tt('Result')}</TableHead>
              <TableHead className="w-10 pr-4" />
            </TableRow></TableHeader>
            <TableBody>
              {sorted.slice(0, limit).map((v) => {
                const m = v.match;
                const sc = scoreBefore(v);
                const ok = v.openingKill;
                return (
                  <TableRow key={`${m.id}:${v.round.i}:${v.team}`} className="cursor-pointer" onClick={() => onOpenRound(m, v.round.i, queueOf(m))}>
                    <TableCell className="pl-4">
                      <div className="font-medium">{mapDisplayName(m.map)}</div>
                      <div className="text-[11px] text-muted-foreground">{new Date(m.date).toLocaleDateString(locale)}</div>
                    </TableCell>
                    <TableCell className="num">{v.round.i + 1}</TableCell>
                    <TableCell>
                      <span className={cn('rounded-sm px-1.5 py-0.5 text-[11px]', v.side === 'ct' ? 'badge-ct' : 'badge-t')}>{v.side.toUpperCase()}</span>
                      {!perspective && <span className="ml-2 text-xs text-muted-foreground">{m.teams[v.team]}</span>}
                    </TableCell>
                    <TableCell className="num text-right">{sc[0]}–{sc[1]}</TableCell>
                    <TableCell className="text-xs">{BUY_LABEL[v.ourBuy]} <span className="text-muted-foreground">{tt('vs')}</span> {BUY_LABEL[v.theirBuy]}</TableCell>
                    <TableCell className="text-xs">
                      {ok ? (
                        <span>
                          <span className={v.opening ? 'text-foreground' : 'text-muted-foreground'}>{m.players[ok.k]?.name ?? '?'}</span>
                          <span className="text-muted-foreground"> → </span>
                          <span className={v.opening ? 'text-muted-foreground' : 'text-foreground'}>{m.players[ok.v]?.name ?? '?'}</span>
                          {v.openingPlace && <span className="text-muted-foreground"> · {placeLabel(v.openingPlace)}</span>}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs">{v.round.plantSite ? `${v.round.plantSite}${v.round.plantT != null ? ` · ${v.round.plantT.toFixed(0)} s` : ''}` : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className={cn('text-xs', v.won ? 'font-medium' : 'text-muted-foreground')}>{v.won ? tt('Won') : tt('Lost')}</TableCell>
                    <TableCell className="pr-4">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="icon-xs" variant="ghost" aria-label={tt('Open in the replay')} onClick={(e) => { e.stopPropagation(); onOpenRound(m, v.round.i, queueOf(m)); }}><Play /></Button>
                        </TooltipTrigger>
                        <TooltipContent>{tt('Open in the replay, then play the other filtered rounds of this map in a row (asks for') + ' '}{m.fileName})</TooltipContent>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {sorted.length > limit && (
          <div className="border-t p-2 text-center">
            <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>{tt('Show') + ' '}{Math.min(PAGE, sorted.length - limit)} {tt('more')}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
