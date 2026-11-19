// Onglet Training : plan d'entraînement d'un joueur, tiré de ses démos (points faibles avec preuves,
// programme du jour, ses lineups à travailler, ses morts en ouverture à revoir).

import { useMemo, useState } from 'react';
import { Check, ClipboardCopy, Dumbbell, Play } from 'lucide-react';
import type { LibraryMatch } from '@/library/library';
import type { PlayerAgg } from '@/analysis/players';
import { buildTraining, trainingMarkdown } from '@/analysis/training';
import { techLabel } from '@/analysis/lineups';
import { mapDisplayName } from '@/maps/maps';
import { placeLabel } from '@/viewer/places';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CopySetpos, copyText } from '../CopySetpos';
import { tt } from '@/i18n';

export function TrainingTab({ matches, players, onOpenRound }: { matches: LibraryMatch[]; players: PlayerAgg[]; onOpenRound: (m: LibraryMatch, round: number, queue?: number[]) => void }) {
  const [sid, setSid] = useState<string>(players[0]?.steamid ?? '');
  const plan = useMemo(() => (sid ? buildTraining(matches, sid) : null), [matches, sid]);
  const [copied, setCopied] = useState(false);
  const total = plan?.daily.reduce((a, d) => a + d.minutes, 0) ?? 0;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 auto-rows-max overflow-y-auto md:auto-rows-auto md:overflow-visible md:grid-cols-[300px_1fr] gap-2">
      <div className="min-h-0 space-y-4 overflow-y-auto rounded-xl border bg-card p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium"><Dumbbell className="size-4" /> {tt('Training plan')}</div>
          <p className="text-xs text-muted-foreground">{tt('Weak points found in the player\'s demos, each with its evidence and drills. Aim points need “Measure reaction and crosshair” in a match\'s Stats view.')}</p>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">{tt('Player')}</div>
          <Select value={sid} onValueChange={setSid}>
            <SelectTrigger size="sm" className="w-full"><SelectValue placeholder={tt('Choose a player')} /></SelectTrigger>
            <SelectContent>{players.map((p) => <SelectItem key={p.steamid} value={p.steamid}>{p.name} <span className="text-muted-foreground">· {p.matches}</span></SelectItem>)}</SelectContent>
          </Select>
        </div>
        {plan && (
          <Button size="sm" variant="outline" className="w-full" onClick={async () => { if (await copyText(trainingMarkdown(plan))) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>
            {copied ? <Check /> : <ClipboardCopy />} {copied ? tt('Copied') : tt('Copy as Markdown')}
          </Button>
        )}
        {plan && !plan.aim && <p className="text-[11px] text-muted-foreground">{tt('No aim data yet for this player: open one of their matches, Stats, then “Measure reaction and crosshair”.')}</p>}
      </div>

      {!plan ? (
        <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">{tt('Choose a player.')}</div>
      ) : (
        <div className="min-h-0 space-y-2 overflow-y-auto">
          <div className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-base font-semibold">{plan.player.name}</span>
              <span className="text-xs text-muted-foreground">{plan.maps} {tt('map')}{plan.maps === 1 ? '' : 's'} · {plan.player.rounds} {tt('rounds')}{plan.aim ? tt(' · aim measured on {0} map{1}', [plan.aim.matches, plan.aim.matches === 1 ? '' : 's']) : ''}</span>
            </div>
            {plan.notes.map((n) => <p key={n} className="mt-1 text-xs text-muted-foreground">{n}</p>)}
            {plan.strengths.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{tt('Strengths:') + ' '}<span className="text-foreground">{plan.strengths.join(', ')}</span>.</p>}
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="mb-2 flex items-baseline gap-2"><span className="text-sm font-medium">{tt('Today')}</span><span className="num text-xs text-muted-foreground">{total} {tt('min')}</span></div>
            <ol className="space-y-1.5">
              {plan.daily.map((d, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="num w-12 shrink-0 text-xs leading-5 text-muted-foreground">{d.minutes} {tt('min')}</span>
                  <span><span className="font-medium">{d.block}</span> <span className="text-muted-foreground">· {d.detail}</span></span>
                </li>
              ))}
            </ol>
          </div>

          <div className="grid gap-2 lg:grid-cols-2">
            {plan.weaknesses.length === 0 && <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{tt('No clear weak point with this data. Add more demos and measure aim on a few of them.')}</div>}
            {plan.weaknesses.map((w) => (
              <div key={w.id} className="space-y-2 rounded-xl border bg-card p-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{w.title}</span>
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" title={tt('Priority')}><span className="block h-full rounded-full bg-foreground/70" style={{ width: `${Math.round(w.severity * 100)}%` }} /></span>
                </div>
                <p className="text-xs text-muted-foreground">{w.evidence}</p>
                <ul className="space-y-1 text-xs">
                  {w.drills.map((d) => <li key={d.name}><span className="font-medium">{d.name}</span>{d.minutes ? <span className="num text-muted-foreground"> · {d.minutes} {tt('min')}</span> : ''}<div className="text-muted-foreground">{d.how}</div></li>)}
                </ul>
              </div>
            ))}
          </div>

          <div className="grid gap-2 lg:grid-cols-2">
            <div className="rounded-xl border bg-card p-4">
              <div className="mb-2 text-sm font-medium">{tt('Your lineups')}</div>
              {plan.lineups.length === 0 ? <p className="text-xs text-muted-foreground">{tt('No grenade thrown twice from the same spot yet (needs demos added with this version).')}</p> : (
                <ul className="space-y-1 text-xs">
                  {plan.lineups.map((l) => (
                    <li key={l.lineup.id + l.map} className="flex items-center gap-2">
                      <span className="w-16 text-muted-foreground">{mapDisplayName(l.map)}</span>
                      <span className="min-w-0 flex-1 truncate">{l.lineup.kind === 'molotov' ? tt('Molly') : l.lineup.kind === 'he' ? 'HE' : tt('Smoke')} {placeLabel(l.lineup.toPlace) || '?'} <span className="text-muted-foreground">{tt('from') + ' '}{placeLabel(l.lineup.fromPlace) || '?'} · {techLabel(l.lineup.tech).toLowerCase()} · {l.lineup.throws.length}×</span></span>
                      <CopySetpos get={() => l.setpos} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-medium">{tt('Opening deaths to rewatch')}</span>
                {plan.rewatch.length > 0 && (
                  <Button size="xs" variant="outline" onClick={() => {
                    const first = plan.rewatch[0];
                    const queue = plan.rewatch.filter((r) => r.match.id === first.match.id).map((r) => r.round).sort((a, b) => a - b);
                    onOpenRound(first.match, first.round, queue);
                  }}><Play /> {tt('Watch in a row')}</Button>
                )}
              </div>
              {plan.rewatch.length === 0 ? <p className="text-xs text-muted-foreground">{tt('No opening death found.')}</p> : (
                <ul className="space-y-0.5 text-xs">
                  {plan.rewatch.map((r) => (
                    <li key={r.match.id + r.round}>
                      <button className="flex w-full gap-2 rounded-md px-1 py-0.5 text-left hover:bg-accent" onClick={() => onOpenRound(r.match, r.round, plan.rewatch.filter((x) => x.match.id === r.match.id).map((x) => x.round).sort((a, b) => a - b))}>
                        <span className="w-24 shrink-0 text-muted-foreground">{mapDisplayName(r.match.map)} R{r.round + 1}</span>
                        <span className="min-w-0 flex-1 truncate">{r.why}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
