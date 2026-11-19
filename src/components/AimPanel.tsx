// Stats d'aim et de duel d'un match : précision, tirs à l'arrêt, TTK et duels tout de suite ;
// temps de réaction et placement du viseur après une seconde passe sur la démo (quelques secondes).

import { useMemo, useState } from 'react';
import { Crosshair, Loader2 } from 'lucide-react';
import type { MatchData } from '@/data/types';
import { aimAdvanced, aimBasic, aimWindowTicks, summarizeAim, type AimAdvanced, type AimSummary } from '@/stats/aim';
import { loadAimRows } from '@/data/load-demo';
import { setAim, type AimRecord } from '@/library/library';
import { demoId } from '@/scrim/storage';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { tt } from '@/i18n';

const COLS: { id: keyof AimSummary; label: string; hint: string; fmt: (v: number) => string; better: 'high' | 'low' }[] = [
  { id: 'accuracy', label: tt('Accuracy'), hint: tt('Hits / shots with guns (shotguns excluded)'), fmt: (v) => `${v.toFixed(0)}%`, better: 'high' },
  { id: 'stoppedPct', label: tt('Stopped'), hint: tt('Shots fired while moving under 80 u/s (counter-strafed or standing still)'), fmt: (v) => `${v.toFixed(0)}%`, better: 'high' },
  { id: 'reactionMs', label: tt('Reaction'), hint: tt('Median time from first seeing the enemy (server “spotted” flag) to first damage. Needs the extra pass.'), fmt: (v) => `${Math.round(v)} ms`, better: 'low' },
  { id: 'crosshairDeg', label: tt('Crosshair'), hint: tt('Median angle between the crosshair and the enemy’s head when he becomes visible. Lower is better. Needs the extra pass.'), fmt: (v) => `${v.toFixed(1)}°`, better: 'low' },
  { id: 'ttkMs', label: 'TTK', hint: tt('Median time from first damage to the kill, on kills that took 2+ hits'), fmt: (v) => `${Math.round(v)} ms`, better: 'low' },
  { id: 'oneTapPct', label: '1-hit kills', hint: tt('Kills where the first damage was the kill'), fmt: (v) => `${v.toFixed(0)}%`, better: 'high' },
  { id: 'firstHitWin', label: tt('Duels hitting first'), hint: tt('Duels won when this player deals the first damage'), fmt: (v) => `${v.toFixed(0)}%`, better: 'high' },
  { id: 'hitFirstWin', label: tt('Duels hit first'), hint: tt('Duels won when the enemy deals the first damage'), fmt: (v) => `${v.toFixed(0)}%`, better: 'high' },
];

export function AimPanel({ match: m, file }: { match: MatchData; file: File | null }) {
  const basic = useMemo(() => aimBasic(m), [m]);
  const [adv, setAdv] = useState<Map<number, AimAdvanced> | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');
  const rows = useMemo(() => summarizeAim(m, basic, adv), [m, basic, adv]);

  const compute = async () => {
    if (!file) return;
    setState('loading');
    try {
      const data = await loadAimRows(file, aimWindowTicks(m));
      const a = aimAdvanced(m, data);
      setAdv(a);
      setState('idle');
      // Conservé dans la bibliothèque : moyennes par joueur et routines d'entraînement
      const rec: Record<string, AimRecord> = {};
      for (const s of summarizeAim(m, basic, a)) {
        const sid = m.players[s.player]?.steamid;
        if (!sid) continue;
        const { player: _p, samples, ...vals } = s;
        void _p;
        rec[sid] = { ...vals, shots: samples.shots, duels: samples.duels, measured: samples.measured };
      }
      setAim(demoId(m), rec);
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const team = (t: 0 | 1) => rows.filter((r) => m.players[r.player].team === t && r.samples.shots > 0);
  // Meilleure valeur de chaque colonne (mise en avant)
  const best = (id: keyof AimSummary, better: 'high' | 'low') => {
    const vals = rows.map((r) => r[id]).filter((v): v is number => typeof v === 'number');
    return vals.length ? (better === 'high' ? Math.max(...vals) : Math.min(...vals)) : null;
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-card text-card-foreground" data-testid="aim-panel">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <Crosshair className="size-4" />
        <span className="text-sm font-medium">{tt('Aim and duels')}</span>
        <span className="text-xs text-muted-foreground">{tt('medians over the match, guns only')}</span>
        <span className="flex-1" />
        {!adv && (
          <Button size="sm" variant="outline" onClick={compute} disabled={!file || state === 'loading'}>
            {state === 'loading' ? <><Loader2 className="animate-spin" /> {tt('Reading duels…')}</> : tt('Measure reaction and crosshair')}
          </Button>
        )}
        {!file && <span className="text-xs text-muted-foreground">{tt('Open the demo file to measure reaction and crosshair.')}</span>}
        {state === 'error' && <span className="text-xs text-destructive">{error}</span>}
      </div>
      <Table>
        <TableHeader><TableRow className="hover:bg-transparent">
          <TableHead className="w-44 pl-4">{tt('Player')}</TableHead>
          {COLS.map((c) => (
            <TableHead key={c.id} className="px-2 text-right">
              <Tooltip><TooltipTrigger className="cursor-default">{c.label}</TooltipTrigger><TooltipContent className="max-w-64">{c.hint}</TooltipContent></Tooltip>
            </TableHead>
          ))}
          <TableHead className="pr-4 text-right">{tt('Duels')}</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {([0, 1] as const).flatMap((t) => [
            <TableRow key={`h${t}`} className="hover:bg-transparent"><TableCell colSpan={COLS.length + 2} className="pl-4 text-[11px] tracking-wide text-muted-foreground uppercase">{m.teams[t].name}</TableCell></TableRow>,
            ...team(t).map((r) => (
              <TableRow key={r.player}>
                <TableCell className="pl-4 font-medium">{m.players[r.player].name}</TableCell>
                {COLS.map((c) => {
                  const v = r[c.id] as number | null;
                  const isBest = v !== null && v === best(c.id, c.better);
                  return <TableCell key={c.id} className={`num px-2 text-right ${isBest ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{v === null ? '—' : c.fmt(v)}</TableCell>;
                })}
                <TableCell className="num pr-4 text-right text-muted-foreground" title={tt('{0} duels with a measurable reaction', [r.samples.measured])}>{r.samples.duels}{adv ? ` · ${r.samples.measured}` : ''}</TableCell>
              </TableRow>
            )),
          ])}
        </TableBody>
      </Table>
      <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        {tt('Reaction and crosshair rely on the server’s approximate “spotted” flag, so they are measured on part of the duels only (second number in Duels). Compare players within a match rather than reading them as exact values.')}
      </p>
    </div>
  );
}
