// Mode présentation : habillage « broadcast » pour caster une review en stream. Pas de boutons
// d'édition ; tout se pilote au clavier (Espace, Q/E, 1–0, B pour dessiner, P ou Échap pour sortir).

import { useEffect, useState } from 'react';
import { SIDE_CT, type MatchData, type RoundInfo } from '@/data/types';
import { formatClock, type RoundClock } from '@/viewer/sample';
import { mapDisplayName } from '@/maps/maps';
import { setPresentation, usePresentation } from '@/app/layout';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

export function Scorebar({ match, score, round, clock, live }: { match: MatchData; score: [number, number]; round?: RoundInfo; clock: RoundClock | null; live: boolean }) {
  const side = (t: 0 | 1) => (round && round.ctTeam === t ? 'CT' : 'T');
  const Team = ({ t }: { t: 0 | 1 }) => (
    <div className={cn('flex min-w-0 items-center gap-3', t === 1 && 'flex-row-reverse')}>
      <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', side(t) === 'CT' ? 'badge-ct' : 'badge-t')}>{side(t)}</span>
      <span className="truncate text-xl font-semibold tracking-tight">{match.teams[t].name}</span>
      <span className="num text-4xl font-bold">{score[t]}</span>
    </div>
  );
  return (
    <div className="mx-auto flex w-fit max-w-full items-center gap-6 rounded-2xl border bg-card/95 px-6 py-2 shadow-lg" data-testid="scorebar">
      <Team t={0} />
      <div className="flex w-28 flex-col items-center">
        <span className={cn('num rounded-md bg-muted px-3 py-0.5 text-lg font-semibold', clock?.phase === 'planted' && 'text-destructive')}>{live && clock ? formatClock(clock.remaining) : tt('Final')}</span>
        <span className="mt-0.5 text-[11px] text-muted-foreground">{mapDisplayName(match.header.map)}{round && live ? ` · R${round.number}` : ''}</span>
      </div>
      <Team t={1} />
    </div>
  );
}

/** Bandeau bas : texte du caster (modifiable) ou, à défaut, la note d'équipe du round. */
export function LowerThird({ note }: { note: string }) {
  const p = usePresentation();
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setEditing(true); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  const text = p.caption || note;
  if (!text && !editing) return null;
  return (
    <div className="pointer-events-auto absolute bottom-6 left-1/2 w-[min(760px,80%)] -translate-x-1/2" data-testid="lower-third">
      {editing ? (
        <input autoFocus defaultValue={p.caption} placeholder={tt('Caption shown to viewers (Enter to apply, empty to show the round note)')}
          className="w-full rounded-xl border bg-card px-4 py-3 text-lg outline-none"
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { if (e.key === 'Enter') setPresentation({ caption: e.currentTarget.value }); setEditing(false); } }}
          onBlur={() => setEditing(false)} />
      ) : (
        <button type="button" onDoubleClick={() => setEditing(true)} className="w-full rounded-xl border bg-card/95 px-4 py-3 text-left text-lg leading-snug shadow-lg">
          {text}
        </button>
      )}
    </div>
  );
}

/** Rappel des commandes, visible quelques secondes à l'entrée. */
export function PresentationHint() {
  const [shown, setShown] = useState(true);
  useEffect(() => { const t = setTimeout(() => setShown(false), 4000); return () => clearTimeout(t); }, []);
  return (
    <div className={cn('pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 rounded-md border bg-overlay px-3 py-1.5 text-xs text-overlay-foreground backdrop-blur-sm transition-opacity duration-700', !shown && 'opacity-0')}>
      {tt('Presentation · Space play · Q/E rounds · 1–0 follow · B draw · K caption · H team panels · P or Esc to exit')}
    </div>
  );
}

export const sideColor = (round: RoundInfo | undefined, t: 0 | 1) => (round && round.ctTeam === t ? SIDE_CT : 2);
