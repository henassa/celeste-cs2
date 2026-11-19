// Onglet Veto : map pool de deux équipes face à face et veto simulé (BO1 / BO3).

import { useMemo, useState } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import type { LibraryMatch } from '@/library/library';
import type { Subject } from '@/analysis/heatmap';
import type { TeamGroup } from '@/analysis/teams';
import type { PlayerAgg } from '@/analysis/players';
import { compareMaps, mapPool, PRIOR_ROUNDS, simulateVeto, UNPLAYED_STRENGTH, type MapStat, type VetoFormat } from '@/analysis/veto';
import { ACTIVE_DUTY, allMapNames, mapDisplayName } from '@/maps/maps';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { resolveSubject, SubjectSelect, type SubjectKey } from './SubjectSelect';
import { locale, tt } from '@/i18n';

const pct = (won: number, played: number) => (played ? `${Math.round((won / played) * 100)}%` : '—');

function Side({ s }: { s?: MapStat }) {
  if (!s) return <span className="text-xs text-muted-foreground">{tt('Never played')}</span>;
  return (
    <div className="leading-tight">
      <div className="num text-sm">{s.wins}–{s.matches - s.wins - s.ties}{s.ties ? `–${s.ties}` : ''} <span className="text-muted-foreground">{tt('maps')}</span> · {pct(s.rounds.won, s.rounds.played)}</div>
      <div className="num text-[11px] text-muted-foreground">{tt('CT') + ' '}{pct(s.ct.won, s.ct.played)} · T {pct(s.t.won, s.t.played)}{s.lastPlayed ? tt(' · last {0}', [new Date(s.lastPlayed).toLocaleDateString(locale)]) : ''}</div>
    </div>
  );
}

/** Barre divergente centrée : vers la droite = avantage pour nous, vers la gauche = pour eux. */
function EdgeBar({ edge }: { edge: number }) {
  const w = Math.min(50, Math.abs(edge) * 250); // 20 points d'écart = demi-barre pleine
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-32 rounded-full bg-muted">
        <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
        <div className={cn('absolute inset-y-0 rounded-full', edge >= 0 ? 'left-1/2 bg-foreground' : 'right-1/2 bg-muted-foreground')} style={{ width: `${w}%` }} />
      </div>
      <span className={cn('num w-12 text-right text-xs', edge >= 0 ? 'text-foreground' : 'text-muted-foreground')}>{edge >= 0 ? '+' : ''}{(edge * 100).toFixed(0)}</span>
    </div>
  );
}

interface Props {
  matches: LibraryMatch[];
  teams: TeamGroup[];
  players: PlayerAgg[];
  /** Sujet de la page (utilisé comme « nous » par défaut). */
  subjectKey: SubjectKey;
  onSubjectChange: (k: SubjectKey) => void;
}

export function VetoTab({ matches, teams, players, subjectKey, onSubjectChange }: Props) {
  const [themKey, setThemKey] = useState<SubjectKey>('all');
  const [format, setFormat] = useState<VetoFormat>('bo3');
  const [first, setFirst] = useState<'us' | 'them'>('us');
  const [pool, setPool] = useState<string[]>(ACTIVE_DUTY);
  const us: Subject = useMemo(() => resolveSubject(subjectKey, teams), [subjectKey, teams]);
  const them: Subject = useMemo(() => resolveSubject(themKey, teams), [themKey, teams]);
  const usPool = useMemo(() => mapPool(matches, us), [matches, us]);
  const themPool = useMemo(() => mapPool(matches, them), [matches, them]);
  const rows = useMemo(() => compareMaps(pool, usPool, themPool), [pool, usPool, themPool]);
  const steps = useMemo(() => (pool.length >= 2 ? simulateVeto(rows, format, first) : []), [rows, format, first, pool.length]);
  const name = (s: Subject, fallback: string) => (s.kind === 'team' ? s.group.name : s.kind === 'player' ? tt('{0}\'s team', [players.find((p) => p.steamid === s.steamid)?.name ?? tt('Player')]) : fallback);
  const usName = name(us, 'Your team'), themName = name(them, 'Opponent');
  const unreliable = rows.filter((r) => !r.reliable).length;
  const offPool = [...new Set([...usPool.keys(), ...themPool.keys()])].filter((m) => !pool.includes(m));

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 auto-rows-max overflow-y-auto md:auto-rows-auto md:overflow-visible md:grid-cols-[300px_1fr] gap-2">
      <div className="min-h-0 space-y-4 overflow-y-auto rounded-xl border bg-card p-4">
        <div className="space-y-1">
          <div className="text-sm font-medium">{tt('Map pool and veto')}</div>
          <p className="text-xs text-muted-foreground">{tt('Demos don\'t record picks and bans: this compares the maps both teams actually played and simulates a veto from it.')}</p>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">{tt('Your team')}</div>
          <SubjectSelect value={subjectKey} onChange={onSubjectChange} teams={teams} players={players} allLabel="Choose a team…" />
        </div>
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">{tt('Opponent')}</div>
          <SubjectSelect value={themKey} onChange={setThemKey} teams={teams} players={players} allLabel="Unknown opponent" />
          {them.kind === 'all' && <p className="text-[11px] text-muted-foreground">{tt('Without an opponent, every map counts as 50% for them.')}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">{tt('Format')}</div>
            <ToggleGroup type="single" variant="outline" size="sm" value={format} onValueChange={(v) => v && setFormat(v as VetoFormat)} className="w-full">
              <ToggleGroupItem value="bo1" className="flex-1 text-xs">{tt('BO1')}</ToggleGroupItem>
              <ToggleGroupItem value="bo3" className="flex-1 text-xs">{tt('BO3')}</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">{tt('First ban')}</div>
            <ToggleGroup type="single" variant="outline" size="sm" value={first} onValueChange={(v) => v && setFirst(v as 'us' | 'them')} className="w-full">
              <ToggleGroupItem value="us" className="flex-1 text-xs">{tt('Us')}</ToggleGroupItem>
              <ToggleGroupItem value="them" className="flex-1 text-xs">{tt('Them')}</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{tt('Map pool') + ' '}<span className="num text-foreground">{pool.length}</span></span>
            {pool.join() !== ACTIVE_DUTY.join() && <Button size="xs" variant="ghost" onClick={() => setPool(ACTIVE_DUTY)}><RotateCcw /> {tt('Active Duty')}</Button>}
          </div>
          <div className="flex flex-wrap gap-1">
            {allMapNames().filter((m) => m.startsWith('de_')).map((m) => {
              const on = pool.includes(m);
              return (
                <button key={m} onClick={() => setPool((p) => (on ? p.filter((x) => x !== m) : [...p, m]))}
                  className={cn('rounded-md border px-2 py-0.5 text-xs', on ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {mapDisplayName(m)}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">{tt('Default: Active Duty pool set by Valve on 8 July 2026. Adjust it when Valve rotates maps.')}</p>
        </div>
      </div>

      <div className="min-h-0 space-y-2 overflow-y-auto">
        {us.kind === 'all' ? (
          <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">{tt('Choose your team on the left (a detected team, or a player to use the teams they played in).')}</div>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="flex flex-wrap items-baseline gap-2 px-4 py-3">
                <span className="text-sm font-medium">{usName}</span>
                <span className="text-xs text-muted-foreground">{tt('vs')}</span>
                <span className="text-sm font-medium">{themName}</span>
                <span className="flex-1" />
                {unreliable > 0 && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><TriangleAlert className="size-3.5" /> {unreliable} {tt('map')}{unreliable === 1 ? '' : 's'} {tt('with under 30 rounds for one side')}</span>
                )}
              </div>
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">{tt('Map')}</TableHead>
                  <TableHead>{usName}</TableHead>
                  <TableHead>{themName}</TableHead>
                  <TableHead>{tt('Edge (rounds won, points)')}</TableHead>
                  <TableHead className="pr-4">{tt('Read')}</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.map}>
                      <TableCell className="pl-4 font-medium">{mapDisplayName(r.map)}</TableCell>
                      <TableCell><Side s={r.us} /></TableCell>
                      <TableCell><Side s={r.them} /></TableCell>
                      <TableCell><EdgeBar edge={r.edge} /></TableCell>
                      <TableCell className="pr-4 text-xs text-muted-foreground">
                        {!r.us && !r.them ? tt('Unknown for both') : !r.us ? tt('You never play it') : !r.them ? tt('They never play it') : !r.reliable ? tt('Small sample') : r.edge >= 0.05 ? tt('Good for you') : r.edge <= -0.05 ? tt('Good for them') : tt('Even')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {offPool.length > 0 && <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{tt('Also played, outside this pool:') + ' '}{offPool.map(mapDisplayName).join(', ')}.</p>}
            </div>

            <div className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-baseline gap-2">
                <span className="text-sm font-medium">{tt('Simulated veto ·') + ' '}{format.toUpperCase()}</span>
                <span className="text-xs text-muted-foreground">{tt('each side bans its worst map and picks its best, by estimated edge')}</span>
              </div>
              <ol className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                {steps.map((s, i) => (
                  <li key={s.map} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', s.action === 'pick' && 'bg-accent/60', s.action === 'decider' && 'border-foreground/40')}>
                    <span className="num text-xs text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] text-muted-foreground">
                        {s.action === 'decider' ? tt('Decider') : `${s.team === 'us' ? usName : themName} ${s.action}s`}
                      </span>
                      <span className="font-medium">{mapDisplayName(s.map)}</span>
                    </span>
                    <span className={cn('num text-xs', s.edge >= 0 ? 'text-foreground' : 'text-muted-foreground')}>{s.edge >= 0 ? '+' : ''}{(s.edge * 100).toFixed(0)}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[11px] text-muted-foreground">
                {tt('Edge = estimated rounds won % for you minus for them. Small samples are pulled toward 50% (')}{PRIOR_ROUNDS} {tt('neutral rounds added); a map a team never plays counts as') + ' '}{Math.round(UNPLAYED_STRENGTH * 100)}{tt('% for it. Real vetos also depend on recent form and practice, so read this as a starting point.')}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
