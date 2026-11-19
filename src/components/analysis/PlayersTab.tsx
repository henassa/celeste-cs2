// Onglet Joueurs : stats cumulées sur la bibliothèque, profil avec progression, comparaison.

import { useMemo, useState } from 'react';
import { ArrowDown, X } from 'lucide-react';
import type { LibraryMatch } from '@/library/library';
import { aggregatePlayers, type PlayerAgg } from '@/analysis/players';
import type { SideFilter } from '@/stats/compute';
import type { RatingModel } from '@/calib/model';
import { mapDisplayName } from '@/maps/maps';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { LineChart } from './LineChart';
import { cn } from '@/lib/utils';
import { locale, tt } from '@/i18n';

interface Col { id: string; label: string; value: (a: PlayerAgg) => number; format: (a: PlayerAgg) => string }
const f2 = (v: number | null) => (v === null || !Number.isFinite(v) ? '—' : v.toFixed(2));

const COLS: Col[] = [
  { id: 'maps', label: tt('Maps'), value: (a) => a.matches, format: (a) => `${a.matches}` },
  { id: 'rounds', label: tt('Rounds'), value: (a) => a.rounds, format: (a) => `${a.rounds}` },
  { id: 'kd', label: 'K/D', value: (a) => a.kd, format: (a) => a.kd.toFixed(2) },
  { id: 'adr', label: 'ADR', value: (a) => a.adr, format: (a) => a.adr.toFixed(1) },
  { id: 'kast', label: 'KAST', value: (a) => a.kast, format: (a) => `${a.kast.toFixed(0)}%` },
  { id: 'hs', label: tt('HS%'), value: (a) => a.hsPct, format: (a) => `${a.hsPct.toFixed(0)}%` },
  { id: 'fk', label: tt('FK–FD'), value: (a) => a.entryKills - a.entryDeaths, format: (a) => `${a.entryKills}–${a.entryDeaths}` },
  { id: 'cl', label: tt('Clutch'), value: (a) => a.clutchWins, format: (a) => `${a.clutchWins}/${a.clutchAttempts}` },
  { id: 'sw', label: tt('Swing'), value: (a) => a.swing, format: (a) => `${a.swing > 0 ? '+' : ''}${a.swing.toFixed(1)}%` },
  { id: 'r2', label: '2.0≈', value: (a) => a.rating2, format: (a) => f2(a.rating2) },
  { id: 'r3', label: '3.0≈', value: (a) => a.rating3 ?? -1, format: (a) => f2(a.rating3) },
];

type Metric = 'rating3' | 'rating2' | 'adr' | 'kast';
const METRICS: { id: Metric; label: string; fmt: (v: number) => string }[] = [
  { id: 'rating3', label: '3.0≈', fmt: (v) => v.toFixed(2) },
  { id: 'rating2', label: '2.0≈', fmt: (v) => v.toFixed(2) },
  { id: 'adr', label: 'ADR', fmt: (v) => v.toFixed(0) },
  { id: 'kast', label: 'KAST', fmt: (v) => `${v.toFixed(0)}%` },
];

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="num mt-0.5 text-lg font-semibold">{value}</div>
    </div>
  );
}

export function PlayersTab({ matches, map, model3 }: { matches: LibraryMatch[]; map?: string; model3?: RatingModel }) {
  const [side, setSide] = useState<SideFilter>('all');
  const [sort, setSort] = useState('r3');
  const [selected, setSelected] = useState<string | null>(null);
  const [compare, setCompare] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>(model3 ? 'rating3' : 'rating2');
  const players = useMemo(() => aggregatePlayers(matches, { map, side }, model3), [matches, map, side, model3]);
  const col = COLS.find((c) => c.id === sort) ?? COLS[0];
  const rows = [...players].sort((a, b) => col.value(b) - col.value(a));
  const sel = players.find((p) => p.steamid === selected) ?? null;
  const cmp = players.find((p) => p.steamid === compare) ?? null;

  // Axe commun : tous les matchs des deux joueurs, par date
  const chart = useMemo(() => {
    if (!sel) return null;
    const lines = [...sel.lines, ...(cmp?.lines ?? [])].sort((a, b) => a.date - b.date);
    const keys = [...new Map(lines.map((l) => [l.matchId, l])).values()];
    const val = (p: PlayerAgg, id: string) => {
      const l = p.lines.find((x) => x.matchId === id);
      if (!l) return null;
      return metric === 'rating3' ? l.rating3 : metric === 'rating2' ? l.rating2 : metric === 'adr' ? l.adr : l.kast;
    };
    return {
      labels: keys.map((l) => `${new Date(l.date).toLocaleDateString(locale)} · ${mapDisplayName(l.map)}`),
      series: [
        { name: sel.name, values: keys.map((l) => val(sel, l.matchId)) },
        ...(cmp ? [{ name: cmp.name, values: keys.map((l) => val(cmp, l.matchId)), dashed: true }] : []),
      ],
    };
  }, [sel, cmp, metric]);

  const perMap = useMemo(() => {
    if (!sel) return [];
    const g = new Map<string, { map: string; n: number; won: number; r: number; w2: number }>();
    for (const l of sel.lines) {
      const e = g.get(l.map) ?? { map: l.map, n: 0, won: 0, r: 0, w2: 0 };
      e.n++; if (l.won) e.won++; e.r += l.rounds; e.w2 += (l.rating3 ?? l.rating2) * l.rounds;
      g.set(l.map, e);
    }
    return [...g.values()].sort((a, b) => b.n - a.n);
  }, [sel]);

  return (
    <div className={cn('grid min-h-0 flex-1 gap-2', sel ? 'grid-cols-1 auto-rows-max overflow-y-auto md:auto-rows-auto md:overflow-visible md:grid-cols-[1fr_440px]' : 'grid-cols-1')}>
      <div className="min-h-0 overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="text-sm font-medium">{tt('Players')}</span>
          <span className="text-xs text-muted-foreground">{players.length} {tt('players · weighted by rounds')}</span>
          <span className="flex-1" />
          <ToggleGroup type="single" variant="outline" size="sm" value={side} onValueChange={(v) => v && setSide(v as SideFilter)}>
            <ToggleGroupItem value="all" className="px-3 text-xs">{tt('Both sides')}</ToggleGroupItem>
            <ToggleGroupItem value="ct" className="px-3 text-xs">{tt('CT')}</ToggleGroupItem>
            <ToggleGroupItem value="t" className="px-3 text-xs">T</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="max-h-[calc(100vh-180px)] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">{tt('Player')}</TableHead>
                {COLS.map((c) => (
                  <TableHead key={c.id} className="px-2 text-right">
                    <button onClick={() => setSort(c.id)} className={cn('inline-flex items-center gap-0.5 hover:text-foreground', sort === c.id && 'text-foreground')}>
                      {sort === c.id && <ArrowDown className="size-3" />}{c.label}
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.steamid} data-state={a.steamid === selected ? 'selected' : undefined} className="cursor-pointer" onClick={() => setSelected(a.steamid)}>
                  <TableCell className="max-w-44 truncate pl-4 font-medium">{a.name}</TableCell>
                  {COLS.map((c) => (
                    <TableCell key={c.id} className={cn('num px-2 text-right text-muted-foreground', (c.id === sort || c.id === 'r3') && 'text-foreground')}>{c.format(a)}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {sel && (
        <div className="min-h-0 space-y-3 overflow-y-auto rounded-xl border bg-card p-4">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold">{sel.name}</div>
              <div className="text-xs text-muted-foreground">{sel.matches} {tt('maps ·') + ' '}{sel.rounds} {tt('rounds')}</div>
            </div>
            <Button size="icon-xs" variant="ghost" onClick={() => { setSelected(null); setCompare(null); }} aria-label={tt('Close profile')}><X /></Button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Tile label="3.0≈" value={f2(sel.rating3)} />
            <Tile label="2.0≈" value={f2(sel.rating2)} />
            <Tile label="ADR" value={sel.adr.toFixed(1)} />
            <Tile label="KAST" value={`${sel.kast.toFixed(0)}%`} />
            <Tile label="K/D" value={sel.kd.toFixed(2)} />
            <Tile label={tt('HS%')} value={`${sel.hsPct.toFixed(0)}%`} />
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{tt('Progression')}</span>
              <span className="flex-1" />
              <ToggleGroup type="single" variant="outline" size="sm" value={metric} onValueChange={(v) => v && setMetric(v as Metric)}>
                {METRICS.map((m) => <ToggleGroupItem key={m.id} value={m.id} className="px-2 text-xs" disabled={m.id === 'rating3' && !model3}>{m.label}</ToggleGroupItem>)}
              </ToggleGroup>
            </div>
            <Select value={compare ?? 'none'} onValueChange={(v) => setCompare(v === 'none' ? null : v)}>
              <SelectTrigger size="sm" className="w-full"><SelectValue placeholder={tt('Compare with…')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{tt('No comparison')}</SelectItem>
                {players.filter((p) => p.steamid !== sel.steamid).map((p) => <SelectItem key={p.steamid} value={p.steamid}>{tt('Compare with') + ' '}{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {chart && <LineChart labels={chart.labels} series={chart.series} format={METRICS.find((m) => m.id === metric)!.fmt} />}
          </div>
          {cmp && (
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead /><TableHead className="text-right">{sel.name}</TableHead><TableHead className="text-right">{cmp.name}</TableHead></TableRow></TableHeader>
              <TableBody>
                {COLS.filter((c) => c.id !== 'rounds').map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-muted-foreground">{c.label}</TableCell>
                    <TableCell className={cn('num text-right', c.value(sel) > c.value(cmp) && 'font-semibold')}>{c.format(sel)}</TableCell>
                    <TableCell className={cn('num text-right', c.value(cmp) > c.value(sel) && 'font-semibold')}>{c.format(cmp)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div>
            <div className="mb-1 text-sm font-medium">{tt('By map')}</div>
            <Table>
              <TableBody>
                {perMap.map((e) => (
                  <TableRow key={e.map}>
                    <TableCell>{mapDisplayName(e.map)}</TableCell>
                    <TableCell className="num text-right text-muted-foreground">{e.won}/{e.n} {tt('won')}</TableCell>
                    <TableCell className="num text-right">{(e.w2 / Math.max(1, e.r)).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
