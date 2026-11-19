// Panneau d'équipe : état de chaque joueur au tick courant (vie, armure, argent, armes, utilitaires).

import { memo } from 'react';
import { Mic } from 'lucide-react';
import { FLAG_DEFUSER, FLAG_HAS_BOMB, FLAG_HELMET, type GrenadeKind, type MatchData, type TeamIndex } from '@/data/types';
import { playerState } from '@/viewer/sample';
import type { Playback } from '@/viewer/playback';
import { cn } from '@/lib/utils';
import { WeaponIcon } from './WeaponIcon';
import { tt } from '@/i18n';

const NADE_ICON: Record<string, string> = { smoke: 'smokegrenade', flash: 'flashbang', he: 'hegrenade', molotov: 'molotov', decoy: 'decoy' };

const NADE_ORDER: GrenadeKind[] = ['smoke', 'flash', 'he', 'molotov', 'decoy'];
const NADE_LABEL: Record<GrenadeKind, { short: string; name: string }> = {
  smoke: { short: 'S', name: tt('Smoke') },
  flash: { short: 'F', name: tt('Flash') },
  he: { short: 'H', name: 'HE' },
  molotov: { short: 'M', name: tt('Molotov') },
  decoy: { short: 'D', name: tt('Decoy') },
};

interface Props {
  pb: Playback;
  team: TeamIndex;
  tick: number;
  follow: number;
  align: 'left' | 'right';
  /** Joueurs qui parlent (comms vocales chargées). */
  speaking?: Set<number>;
}

function statsUpTo(m: MatchData, tick: number) {
  const k: number[] = Array.from({ length: m.players.length }, () => 0);
  const d: number[] = Array.from({ length: m.players.length }, () => 0);
  for (const e of m.kills) {
    if (e.tick > tick) break;
    if (e.killer >= 0 && e.killer !== e.victim && m.players[e.killer]?.team !== m.players[e.victim]?.team) k[e.killer]++;
    d[e.victim]++;
  }
  return { k, d };
}

export const TeamPanel = memo(function TeamPanel({ pb, team, tick, follow, align, speaking }: Props) {
  const m = pb.match;
  const members = m.players.map((p, i) => ({ p, i })).filter((x) => x.p.team === team).sort((a, b) => a.p.slot - b.p.slot);
  const round = m.rounds.find((r) => r.startTick <= tick && tick <= r.officialEndTick) ?? m.rounds[0];
  const isCt = round ? round.ctTeam === team : false;
  const { k, d } = statsUpTo(m, tick);
  const right = align === 'right';
  const alive = members.filter(({ i }) => playerState(m, i, tick).alive).length;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground">
      <div className={cn('flex items-center gap-2 px-4 py-3', right && 'flex-row-reverse')}>
        <span className="min-w-0 truncate text-sm font-medium">{m.teams[team].name}</span>
        <span className={cn('rounded-md border px-1.5 py-px text-[11px] font-medium', isCt ? 'text-side-ct' : 'text-side-t')}>
          {isCt ? 'CT' : 'T'}
        </span>
        <span className="flex-1" />
        <span className="num text-xs text-muted-foreground">{alive} {tt('alive')}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {members.map(({ p, i }) => {
          const st = playerState(m, i, tick);
          const dead = !st.alive;
          const followed = follow === i;
          const nades = NADE_ORDER.flatMap((kind) => Array.from({ length: st.nades[kind] }, () => kind));
          return (
            <button
              key={p.steamid + i}
              onClick={() => pb.set({ follow: followed ? -1 : i })}
              className={cn(
                'flex w-full flex-col gap-2 border-t px-4 py-3 text-left transition-colors outline-none hover:bg-accent/40 focus-visible:bg-accent/40',
                followed && 'bg-accent/60 hover:bg-accent/60',
              )}
            >
              <div className={cn('flex items-center gap-2', right && 'flex-row-reverse', dead && 'opacity-50')}>
                <span className={cn('num flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', isCt ? 'badge-ct' : 'badge-t')}>
                  {p.slot}
                </span>
                <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', right && 'text-right')}>{p.name}</span>
                {speaking?.has(i) && <Mic className="size-3.5 shrink-0 text-foreground" aria-label={tt('Speaking')} />}
                <span className="num text-xs text-muted-foreground">{k[i]}–{d[i]}</span>
              </div>
              <div className={cn('flex items-center gap-2', right && 'flex-row-reverse')}>
                <span className={cn('num w-7 text-xs font-medium', right ? 'text-left' : 'text-right', !dead && st.hp <= 25 ? 'text-destructive' : dead ? 'text-muted-foreground' : '')}>
                  {dead ? '0' : st.hp}
                </span>
                <div className={cn('relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted', dead && 'opacity-50')}>
                  <div className={cn('absolute inset-y-0 rounded-full', isCt ? 'bar-ct' : 'bar-t', right ? 'right-0' : 'left-0')} style={{ width: `${st.hp}%` }} />
                </div>
              </div>
              <div className={cn('flex items-center gap-2 text-xs text-muted-foreground', right && 'flex-row-reverse', dead && 'opacity-50')}>
                <span className="num text-foreground">${st.money}</span>
                {!dead && st.armor > 0 && <WeaponIcon weapon={st.flags & FLAG_HELMET ? 'helmet' : 'kevlar'} title={st.flags & FLAG_HELMET ? tt('Kevlar + helmet ({0})', [st.armor]) : tt('Kevlar ({0})', [st.armor])} className="h-3.5 text-muted-foreground" />}
                <span className={cn('flex min-w-0 flex-1 items-center', right ? 'justify-start' : 'justify-end')}>
                  {!dead && st.mainWeapon && <WeaponIcon weapon={st.mainWeapon} className="h-4 text-foreground/90" />}
                </span>
              </div>
              {!dead && (nades.length > 0 || st.flags & (FLAG_DEFUSER | FLAG_HAS_BOMB)) ? (
                <div className={cn('flex items-center gap-1', right && 'flex-row-reverse')}>
                  {nades.map((kind, n) => (
                    <WeaponIcon key={kind + n} weapon={NADE_ICON[kind]} title={NADE_LABEL[kind].name} className="h-4 text-muted-foreground" />
                  ))}
                  <span className="flex-1" />
                  {st.flags & FLAG_DEFUSER ? <WeaponIcon weapon="defuser" title={tt('Defuse kit')} className="h-4 text-foreground" /> : null}
                  {st.flags & FLAG_HAS_BOMB ? <WeaponIcon weapon="c4" title={tt('Bomb')} className="h-4 text-destructive" /> : null}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
});

