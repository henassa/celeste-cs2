// Onglet Séries : BO3 / BO5 retrouvés dans la bibliothèque, score par carte et stats cumulées.

import { useMemo, useState } from 'react';
import { Crown, Play } from 'lucide-react';
import type { LibraryMatch } from '@/library/library';
import type { RatingModel } from '@/calib/model';
import { detectSeries, seriesTeamMatches, type Series } from '@/analysis/series';
import { aggregatePlayers, type PlayerAgg } from '@/analysis/players';
import type { TeamIdx } from '@/library/spatial';
import { mapDisplayName } from '@/maps/maps';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { locale, tt } from '@/i18n';

const rating = (a: PlayerAgg) => a.rating3 ?? a.rating2;

/** Rounds gagnés par l'équipe A d'une carte, côté CT et côté T. */
function halves(m: LibraryMatch, teamA: TeamIdx) {
  const out = { ct: [0, 0], t: [0, 0] };
  for (const r of m.spatial?.rounds ?? []) {
    const side = r.ctTeam === teamA ? out.ct : out.t;
    side[1]++;
    if (r.winner === teamA) side[0]++;
  }
  return out;
}

export function SeriesTab({ matches, model3, onOpenRound }: { matches: LibraryMatch[]; model3?: RatingModel; onOpenRound: (m: LibraryMatch, round: number) => void }) {
  const series = useMemo(() => detectSeries(matches), [matches]);
  const [sel, setSel] = useState<string | null>(null);
  const s: Series | undefined = series.find((x) => x.id === sel) ?? series[0];
  const players = useMemo(() => {
    if (!s) return null;
    const a = aggregatePlayers(seriesTeamMatches(s, 0), {}, model3).filter((p) => p.rounds > 0);
    const b = aggregatePlayers(seriesTeamMatches(s, 1), {}, model3).filter((p) => p.rounds > 0);
    return { a, b, mvp: [...a, ...b].sort((x, y) => rating(y) - rating(x))[0]?.steamid };
  }, [s, model3]);

  if (!series.length) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        {tt('No series found yet. A series is 2 to 5 maps between the same two rosters (3+ shared players), played within a few hours or named like “…-m1”, “…-m2”. Add every map of a BO3 / BO5 to the library.')}
      </div>
    );
  }

  const table = (list: PlayerAgg[], name: string) => (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="px-4 py-3 text-sm font-medium">{name}</div>
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent">
          <TableHead className="pl-4">{tt('Player')}</TableHead><TableHead className="text-right">{tt('Maps')}</TableHead><TableHead className="text-right">K–D</TableHead>
          <TableHead className="text-right">{tt('ADR')}</TableHead><TableHead className="text-right">{tt('KAST')}</TableHead><TableHead className="text-right">{tt('Opening')}</TableHead>
          <TableHead className="text-right">{tt('Swing')}</TableHead><TableHead className="pr-4 text-right">{model3 ? '3.0≈' : '2.0≈'}</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {[...list].sort((x, y) => rating(y) - rating(x)).map((p) => (
            <TableRow key={p.steamid}>
              <TableCell className="pl-4 font-medium">
                {p.name}{p.steamid === players?.mvp && <Crown className="ml-1.5 inline size-3.5 text-muted-foreground" aria-label={tt('Series MVP')} />}
              </TableCell>
              <TableCell className="num text-right">{p.matches}</TableCell>
              <TableCell className="num text-right">{p.kills}–{p.deaths}</TableCell>
              <TableCell className="num text-right">{p.adr.toFixed(1)}</TableCell>
              <TableCell className="num text-right">{p.kast.toFixed(0)}%</TableCell>
              <TableCell className="num text-right">{p.entryKills}–{p.entryDeaths}</TableCell>
              <TableCell className="num text-right">{p.swing > 0 ? '+' : ''}{p.swing.toFixed(1)}%</TableCell>
              <TableCell className="num pr-4 text-right font-medium">{rating(p).toFixed(2)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 auto-rows-max overflow-y-auto md:auto-rows-auto md:overflow-visible md:grid-cols-[280px_1fr] gap-2">
      <div className="min-h-0 overflow-y-auto rounded-xl border bg-card p-2">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">{series.length} {tt('series found')}</div>
        {series.map((x) => (
          <button key={x.id} onClick={() => setSel(x.id)} className={cn('w-full rounded-md px-2 py-1.5 text-left hover:bg-accent', s?.id === x.id && 'bg-accent')}>
            <div className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{x.teams[0]} <span className="text-muted-foreground">{tt('vs')}</span> {x.teams[1]}</span>
              <span className="num font-medium">{x.score[0]}–{x.score[1]}</span>
            </div>
            <div className="text-[11px] text-muted-foreground">{x.format} · {x.maps.map((m) => mapDisplayName(m.match.map)).join(', ')} · {new Date(x.date).toLocaleDateString(locale)}</div>
          </button>
        ))}
      </div>
      {s && players && (
        <div className="min-h-0 space-y-2 overflow-y-auto">
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-baseline gap-3">
              <span className="text-base font-semibold">{s.teams[0]}</span>
              <span className="num text-2xl font-semibold">{s.score[0]}–{s.score[1]}</span>
              <span className="text-base font-semibold">{s.teams[1]}</span>
              <span className="text-xs text-muted-foreground">{s.format}</span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-5">
              {s.maps.map((x, i) => {
                const h = halves(x.match, x.teamA);
                const aWon = x.scoreA > x.scoreB;
                return (
                  <div key={x.match.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{tt('Map') + ' '}{i + 1} · {mapDisplayName(x.match.map)}</span>
                      <Button size="icon-xs" variant="ghost" aria-label={tt('Open in the replay')} onClick={() => onOpenRound(x.match, 0)}><Play /></Button>
                    </div>
                    <div className="num mt-0.5 text-lg font-semibold">
                      <span className={aWon ? '' : 'text-muted-foreground'}>{x.scoreA}</span>–<span className={!aWon ? '' : 'text-muted-foreground'}>{x.scoreB}</span>
                    </div>
                    <div className="num text-[11px] text-muted-foreground">{s.teams[0]}{tt(': CT') + ' '}{h.ct[0]}/{h.ct[1]} · T {h.t[0]}/{h.t[1]}</div>
                  </div>
                );
              })}
            </div>
          </div>
          {table(players.a, s.teams[0])}
          {table(players.b, s.teams[1])}
        </div>
      )}
    </div>
  );
}
