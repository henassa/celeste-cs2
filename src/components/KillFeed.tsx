// Kill feed : kills des dernières secondes, en surimpression sur le radar.
// Un clic sur une ligne relance la lecture 3 s avant le duel.

import { memo } from 'react';
import type { MatchData } from '@/data/types';
import type { Playback } from '@/viewer/playback';
import { killfeedWeapon } from '@/parser/weapons';
import { WeaponIcon } from './WeaponIcon';
import { roundIndexAt } from '@/viewer/sample';
import { placeLabel } from '@/viewer/places';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

const WINDOW_SEC = 7;

export const KillFeed = memo(function KillFeed({ pb, match: m, tick }: { pb: Playback; match: MatchData; tick: number }) {
  const ri = roundIndexAt(m, tick);
  const round = m.rounds[ri];
  if (!round) return null;
  const recent = m.kills.filter((k) => k.round === ri && k.tick <= tick && tick - k.tick < WINDOW_SEC * m.tickrate).slice(-6);
  const nameCls = (p: number) => (m.players[p]?.team === round.ctTeam ? 'text-side-ct' : 'text-side-t');
  return (
    <div className="pointer-events-none absolute top-3 right-3 flex flex-col items-end gap-1.5">
      {recent.map((k) => (
        <button key={k.tick + '-' + k.victim} type="button"
          onClick={() => pb.jumpBefore(k.tick)}
          title={tt('Replay from 3 s before')}
          className="pointer-events-auto flex items-center gap-2 rounded-md border bg-overlay px-2.5 py-1 text-xs text-overlay-foreground shadow-sm backdrop-blur-sm transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {k.killer >= 0 && k.killer !== k.victim && <span className={cn('font-medium', nameCls(k.killer))}>{m.players[k.killer].name}</span>}
          {k.assister >= 0 && (
            <span className={cn('flex items-center gap-1 opacity-80', nameCls(k.assister))}>+ {k.flashAssist && <WeaponIcon weapon="flash assist" title={tt('Flash assist')} className="h-3" />}{m.players[k.assister].name}</span>
          )}
          {k.attackerBlind && <WeaponIcon weapon="blind" title={tt('Killer was blind')} className="h-3.5 text-muted-foreground" />}
          <WeaponIcon weapon={k.weapon} title={killfeedWeapon(k.weapon)} className="h-4 text-foreground/90" />
          {k.noScope && <span className="rounded-sm border px-1 text-[10px] text-muted-foreground">{tt('No-scope')}</span>}
          {k.thruSmoke && <span className="rounded-sm border px-1 text-[10px] text-muted-foreground">{tt('Smoke')}</span>}
          {k.penetrated && <span className="rounded-sm border px-1 text-[10px] text-muted-foreground" title={tt('Wallbang')}>{tt('WB')}</span>}
          {k.headshot && <WeaponIcon weapon="headshot" title={tt('Headshot')} className="h-3.5 text-foreground/90" />}
          <span className={cn('font-medium', nameCls(k.victim))}>{m.players[k.victim].name}</span>
          {k.victimPlace && <span className="text-[11px] text-muted-foreground">{placeLabel(k.victimPlace)}</span>}
        </button>
      ))}
    </div>
  );
});
