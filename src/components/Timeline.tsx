// Timeline : rounds du match (gagnant / raison), barre du round courant avec marqueurs, contrôles de lecture.

import { memo, useRef } from 'react';
import { Bomb, ChevronLeft, ChevronRight, Clock, FastForward, Pause, Play, Rewind, Scissors, Skull } from 'lucide-react';
import { SIDE_CT, type RoundInfo } from '@/data/types';
import { SPEEDS, type Playback, type PlaybackState } from '@/viewer/playback';
import { useNarrow, useShort } from '@/app/use-narrow';
import { roundIndexAt } from '@/viewer/sample';
import { Flag } from 'lucide-react';
import type { ScrimStore } from '@/scrim/store';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { placeLabel } from '@/viewer/places';
import { WinCurve } from './WinCurve';
import { tt } from '@/i18n';

function ReasonIcon({ r }: { r: RoundInfo }) {
  const cls = 'size-3';
  if (r.reason === 'bomb_exploded') return <Bomb className={cls} />;
  if (r.reason === 'bomb_defused') return <Scissors className={cls} />;
  if (r.reason === 'target_saved') return <Clock className={cls} />;
  return <Skull className={cls} />;
}

const REASON_LABEL: Record<string, string> = {
  bomb_exploded: tt('Bomb exploded'), bomb_defused: tt('Bomb defused'), target_saved: tt('Time ran out'),
  t_killed: tt('Terrorists eliminated'), ct_killed: tt('CTs eliminated'), t_surrender: tt('Surrender'), ct_surrender: tt('Surrender'),
};

/** Séparation entre les mi-temps (MR12) et les prolongations (MR3). */
const gapBefore = (i: number) => i === 12 || (i >= 24 && (i - 24) % 3 === 0);

function RoundStrip({ pb, current, scrim }: { pb: Playback; current: number; scrim: ScrimStore }) {
  const m = pb.match;
  return (
    <div className="flex items-stretch gap-3 overflow-x-auto px-4 pt-3">
      <div className="flex w-28 shrink-0 flex-col justify-between py-0.5 text-xs text-muted-foreground">
        <span className="truncate">{m.teams[0].name}</span>
        <span className="truncate">{m.teams[1].name}</span>
      </div>
      <div className="flex gap-1">
        {m.rounds.map((r, i) => {
          const cell = (team: 0 | 1) => (
            <div className={cn('flex h-5 w-full items-center justify-center rounded-sm',
              r.winnerTeam === team ? (r.winnerSide === SIDE_CT ? 'badge-ct' : 'badge-t') : 'bg-muted')}>
              {r.winnerTeam === team && <ReasonIcon r={r} />}
            </div>
          );
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => pb.goToRound(i)}
                  className={cn('flex w-[26px] shrink-0 flex-col gap-1 rounded-md p-[3px] transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    gapBefore(i) && 'ml-2', current === i && 'bg-accent')}
                >
                  {cell(0)}
                  <span className={cn('num relative text-center text-[10px] leading-none', current === i ? 'text-foreground' : 'text-muted-foreground')}>
                    {r.number}
                    {scrim.roundHasContent(i) && <span className="absolute -top-0.5 -right-0.5 size-1 rounded-full bg-foreground" />}
                  </span>
                  {cell(1)}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {tt('Round') + ' '}{r.number} · {REASON_LABEL[r.reason] ?? r.reason} · {r.scoreAfter[0]}–{r.scoreAfter[1]}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

function RoundScrubber({ pb, state, scrim }: { pb: Playback; state: PlaybackState; scrim: ScrimStore }) {
  const m = pb.match;
  const ref = useRef<HTMLDivElement>(null);
  const ri = roundIndexAt(m, state.tick);
  const r = m.rounds[ri];
  if (!r) return null;
  const t0 = r.startTick, t1 = r.officialEndTick;
  const pct = (t: number) => `${((Math.min(t1, Math.max(t0, t)) - t0) / (t1 - t0)) * 100}%`;
  const seek = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    pb.set({ tick: t0 + k * (t1 - t0) });
  };
  const kills = m.kills.filter((k) => k.round === ri);
  const isCt = (p: number) => m.players[p]?.team === r.ctTeam;

  return (
    <div
      ref={ref}
      className="relative mx-4 mt-2 h-8 cursor-pointer touch-none select-none"
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); seek(e.clientX); }}
      onPointerMove={(e) => { if (e.buttons & 1) seek(e.clientX); }}
    >
      <div className="absolute inset-x-0 top-[13px] h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="absolute inset-y-0 left-0 bg-foreground/10" style={{ width: pct(r.freezeEndTick) }} />
        <div className="absolute inset-y-0 right-0 bg-foreground/10" style={{ left: pct(r.endTick) }} />
        <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: pct(state.tick) }} />
      </div>
      {kills.map((k) => (
        <Tooltip key={k.tick + '-' + k.victim}>
          <TooltipTrigger asChild>
            <button type="button" aria-label={tt('Replay this kill')}
              className={cn('absolute top-1.5 h-5 w-[3px] -translate-x-1/2 rounded-full ring-2 ring-card before:absolute before:-inset-x-1.5 before:inset-y-0', isCt(k.victim) ? 'bar-ct' : 'bar-t')}
              style={{ left: pct(k.tick) }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => pb.jumpBefore(k.tick)} />
          </TooltipTrigger>
          <TooltipContent>
            {m.players[k.killer]?.name ?? tt('World')} → {m.players[k.victim].name}
            {k.victimPlace && <span className="text-muted-foreground"> · {placeLabel(k.victimPlace)}</span>}
            <div className="text-[10px] text-muted-foreground">{tt('Click to replay from 3 s before')}</div>
          </TooltipContent>
        </Tooltip>
      ))}
      {scrim.doc.markers.filter((mk) => mk.round === ri).map((mk) => (
        <Tooltip key={mk.id}>
          <TooltipTrigger asChild>
            <button
              className="absolute -top-1 -translate-x-1/2 text-foreground"
              style={{ left: pct(mk.tick) }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => pb.set({ tick: mk.tick, playing: false })}
              aria-label={mk.label}
            >
              <Flag className="size-3.5 fill-current" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{mk.label}</TooltipContent>
        </Tooltip>
      ))}
      {r.plant && (
        <div className="absolute -top-0.5 -translate-x-1/2 text-destructive" style={{ left: pct(r.plant.tick) }}><Bomb className="size-3.5" /></div>
      )}
      {r.defuseTick && (
        <div className="absolute -top-0.5 -translate-x-1/2" style={{ left: pct(r.defuseTick) }}><Scissors className="size-3.5" /></div>
      )}
      <div className="absolute top-[7px] size-[18px] -translate-x-1/2 rounded-full border-2 border-primary bg-background shadow-sm" style={{ left: pct(state.tick) }} />
    </div>
  );
}

interface ControlsProps {
  pb: Playback;
  state: PlaybackState;
  right?: React.ReactNode;
}

interface TimelineProps extends ControlsProps {
  scrim: ScrimStore;
  /** Version du scrim : force le rendu quand les marqueurs / notes changent (composant mémoïsé). */
  scrimVersion: number;
  /** Courbe de probabilité de victoire au-dessus du curseur. */
  winCurve?: boolean;
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-sm" variant="ghost" onClick={onClick} aria-label={label}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Controls({ pb, state, right }: ControlsProps) {
  const m = pb.match;
  const ri = roundIndexAt(m, state.tick);
  const tr = m.tickrate;
  const narrow = useNarrow();
  return (
    <div className="flex items-center gap-1 px-3 pt-1 pb-3">
      <IconButton label={tt('Previous round (Q)')} onClick={() => pb.goToRound(ri - 1)}><ChevronLeft /></IconButton>
      <IconButton label={tt('Back 5 s (←)')} onClick={() => pb.set({ tick: state.tick - 5 * tr })}><Rewind /></IconButton>
      <Button size="icon-sm" onClick={() => pb.set({ playing: !state.playing })} aria-label={tt('Play / pause (Space)')}>
        {state.playing ? <Pause /> : <Play />}
      </Button>
      <IconButton label={tt('Forward 5 s (→)')} onClick={() => pb.set({ tick: state.tick + 5 * tr })}><FastForward /></IconButton>
      <IconButton label={tt('Next round (E)')} onClick={() => pb.goToRound(ri + 1)}><ChevronRight /></IconButton>
      {narrow ? (
        <Button size="sm" variant="outline" className="num ml-auto px-2 text-xs" aria-label={tt('Playback speed')}
          onClick={() => pb.set({ speed: SPEEDS[(SPEEDS.indexOf(state.speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length] })}>{state.speed}×</Button>
      ) : <ToggleGroup
        type="single" variant="outline" size="sm" className="ml-3"
        value={String(state.speed)}
        onValueChange={(v) => { if (v) pb.set({ speed: Number(v) }); }}
        aria-label={tt('Playback speed')}
      >
        {SPEEDS.map((s) => (
          <ToggleGroupItem key={s} value={String(s)} className="num px-2 text-xs">{s}×</ToggleGroupItem>
        ))}
      </ToggleGroup>}
      {!narrow && <div className="flex-1" />}
      {!narrow && right}
    </div>
  );
}

export const Timeline = memo(function Timeline({ pb, state, right, scrim, winCurve = true }: TimelineProps) {
  const current = roundIndexAt(pb.match, state.tick);
  const short = useShort();
  return (
    <div className="rounded-xl border bg-card text-card-foreground">
      {!short && <RoundStrip pb={pb} current={current} scrim={scrim} />}
      {winCurve && !short && <WinCurve match={pb.match} round={current} tick={state.tick} />}
      <RoundScrubber pb={pb} state={state} scrim={scrim} />
      <Controls pb={pb} state={state} right={right} />
    </div>
  );
});
