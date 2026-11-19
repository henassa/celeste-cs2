// Onglet Équipes : équipes détectées et leurs tendances sur la bibliothèque.

import { useMemo, useState } from 'react';
import { Flame } from 'lucide-react';
import type { LibraryMatch } from '@/library/library';
import { detectTeams, pct, teamReport, type Ratio, type TeamGroup } from '@/analysis/teams';
import { mapDisplayName } from '@/maps/maps';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

export const p0 = (r: Ratio) => { const v = pct(r); return v === null ? '—' : `${v.toFixed(0)}%`; };

export function Bar({ label, r, hint }: { label: string; r: Ratio; hint?: string }) {
  const v = pct(r);
  return (
    <div className="space-y-1" title={hint}>
      <div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="num">{p0(r)} <span className="text-muted-foreground">({r.won}/{r.played})</span></span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${v ?? 0}%` }} /></div>
    </div>
  );
}

export function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="num mt-0.5 text-lg font-semibold">{value}</div>
      {sub && <div className="num text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function TeamsTab({ matches, map, onHeatmap }: { matches: LibraryMatch[]; map?: string; onHeatmap: (g: TeamGroup) => void }) {
  const teams = useMemo(() => detectTeams(matches), [matches]);
  const [sel, setSel] = useState<string | null>(null);
  const group = teams.find((t) => t.id === sel) ?? teams[0] ?? null;
  const rep = useMemo(() => (group ? teamReport(group, matches, map) : null), [group, matches, map]);

  if (!teams.length) return <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">{tt('No team found yet: add more demos to the library.')}</div>;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 auto-rows-max overflow-y-auto md:auto-rows-auto md:overflow-visible md:grid-cols-[260px_1fr] gap-2">
      <div className="min-h-0 overflow-y-auto rounded-xl border bg-card p-2">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">{tt('Teams found by roster (3+ shared players)')}</div>
        {teams.map((t) => (
          <button key={t.id} onClick={() => setSel(t.id)}
            className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent', group?.id === t.id && 'bg-accent')}>
            <span className="min-w-0 flex-1 truncate">{t.name}</span>
            <span className="num text-xs text-muted-foreground">{t.entries.length}</span>
          </button>
        ))}
      </div>

      {group && rep && (
        <div className="min-h-0 space-y-2 overflow-y-auto">
          <div className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold">{group.name}</span>
              <span className="text-xs text-muted-foreground">{group.players.slice(0, 7).map((p) => p.name).join(' · ')}</span>
              <span className="flex-1" />
              <Button size="sm" variant="outline" onClick={() => onHeatmap(group)}><Flame /> {tt('Heatmaps')}</Button>
            </div>
            {rep.skipped > 0 && <p className="mt-1 text-xs text-destructive">{rep.skipped} {tt('map')}{rep.skipped === 1 ? '' : 's'} {tt('skipped: add these demos again to include them.')}</p>}
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
              <Tile label={tt('Maps')} value={`${rep.record.won}–${rep.record.lost}${rep.record.tied ? `–${rep.record.tied}` : ''}`} sub={tt('{0} played', [rep.matches])} />
              <Tile label={tt('Rounds won')} value={p0(rep.rounds)} sub={`${rep.rounds.won}/${rep.rounds.played}`} />
              <Tile label={tt('CT rounds')} value={p0(rep.ct)} sub={`${rep.ct.won}/${rep.ct.played}`} />
              <Tile label={tt('T rounds')} value={p0(rep.t)} sub={`${rep.t.won}/${rep.t.played}`} />
              <Tile label={tt('Pistol rounds')} value={p0(rep.pistol)} sub={`${rep.pistol.won}/${rep.pistol.played}`} />
            </div>
          </div>

          <div className="grid gap-2 lg:grid-cols-2">
            <div className="space-y-3 rounded-xl border bg-card p-4">
              <div className="text-sm font-medium">{tt('Economy and openings')}</div>
              <Bar label={tt('Full buy')} r={rep.buys.full} />
              <Bar label={tt('Force / half buy')} r={rep.buys.force} />
              <Bar label={tt('Eco')} r={rep.buys.eco} />
              <Bar label={tt('After the opening kill')} r={rep.openingKill} hint={tt('Rounds won when the team gets the first kill')} />
              <Bar label={tt('After the opening death')} r={rep.openingDeath} hint={tt('Rounds won when the team loses the first duel')} />
              <div className="text-xs text-muted-foreground">
                {tt('Opening duels won:') + ' '}<span className="num text-foreground">{p0({ won: rep.openingKill.played, played: rep.openingKill.played + rep.openingDeath.played })}</span>
              </div>
            </div>
            <div className="space-y-3 rounded-xl border bg-card p-4">
              <div className="text-sm font-medium">{tt('Bomb')}</div>
              <div className="text-xs text-muted-foreground">
                {tt('T side: plants in') + ' '}<span className="num text-foreground">{rep.tRounds ? ((rep.plants / rep.tRounds) * 100).toFixed(0) : '—'}%</span> {tt('of rounds')}
              </div>
              <div className="flex h-6 overflow-hidden rounded-md border text-[11px]">
                {rep.plants > 0 ? (['A', 'B'] as const).map((s) => rep.sites[s] > 0 && (
                  <div key={s} className={cn('flex items-center justify-center', s === 'A' ? 'bg-primary text-primary-foreground' : 'bg-muted')}
                    style={{ width: `${(rep.sites[s] / rep.plants) * 100}%` }}>
                    {s} · {((rep.sites[s] / rep.plants) * 100).toFixed(0)}%
                  </div>
                )) : <div className="flex flex-1 items-center justify-center text-muted-foreground">{tt('No plant')}</div>}
              </div>
              <Bar label={tt('Rounds won after planting (T)')} r={rep.postPlant} />
              <Bar label={tt('Retakes won (CT, bomb planted)')} r={rep.retakes} />
              <div className="pt-1 text-sm font-medium">{tt('Utility per round')}</div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                {(['smoke', 'flash', 'he', 'molotov'] as const).map((k) => (
                  <div key={k} className="rounded-md border px-2 py-1.5">
                    <div className="text-muted-foreground capitalize">{k === 'he' ? 'HE' : k}</div>
                    <div className="num text-sm">{rep.utility[k].toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="px-4 py-3 text-sm font-medium">{tt('By map')}</div>
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">{tt('Map')}</TableHead><TableHead className="text-right">{tt('Maps won')}</TableHead>
                <TableHead className="text-right">{tt('Rounds')}</TableHead><TableHead className="text-right">{tt('CT')}</TableHead><TableHead className="pr-4 text-right">T</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rep.maps.map((m) => (
                  <TableRow key={m.map}>
                    <TableCell className="pl-4 font-medium">{mapDisplayName(m.map)}</TableCell>
                    <TableCell className="num text-right">{m.won}/{m.matches}</TableCell>
                    <TableCell className="num text-right">{p0(m.rounds)}</TableCell>
                    <TableCell className="num text-right">{p0(m.ct)}</TableCell>
                    <TableCell className="num pr-4 text-right">{p0(m.t)}</TableCell>
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
