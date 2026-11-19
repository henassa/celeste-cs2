// Tableau de bord (accueil) : ouvrir une démo, mise en place (équipe, maps 3D), derniers matchs,
// forme par map et joueurs de l'équipe, raccourcis vers le travail en cours.

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Box, ChevronRight, Clapperboard, Crosshair, Dumbbell, FileText, Library, Presentation, Radar, Users } from 'lucide-react';
import { navigate } from '@/app/router';
import { hasTeam, ourSide, useMyTeam } from '@/app/my-team';
import { desktop, type DesktopInfo } from '@/app/desktop';
import { calendarStore, EVENT_KIND, upcoming } from '@/app/calendar';
import { playbookStore } from '@/app/playbook';
import { listMatches, type LibraryMatch } from '@/library/library';
import { mapDisplayName } from '@/maps/maps';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { locale, tt } from '@/i18n';

interface Props {
  dropZone: React.ReactNode;
  current: { map: string; score: string } | null;
}

export function Dashboard({ dropZone, current }: Props) {
  const team = useMyTeam();
  const events = calendarStore.use();
  const plays = playbookStore.use();
  const next = upcoming(events);
  const [matches, setMatches] = useState<LibraryMatch[] | null>(null);
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  useEffect(() => { listMatches().then(setMatches); desktop?.info().then(setInfo); }, []);

  const mine = useMemo(() => {
    const ms = (matches ?? []).slice().sort((a, b) => b.date - a.date);
    if (!hasTeam(team)) return ms.map((m) => ({ m, side: null as 0 | 1 | null }));
    return ms.map((m) => ({ m, side: ourSide(m, team) })).filter((x) => x.side !== null);
  }, [matches, team]);

  const record = useMemo(() => {
    let w = 0, l = 0;
    for (const { m, side } of mine) { if (side === null) continue; const us = m.score[side], them = m.score[1 - side]; if (us > them) w++; else if (us < them) l++; }
    return { w, l };
  }, [mine]);

  const maps = useMemo(() => {
    const by = new Map<string, { played: number; won: number; rw: number; rp: number }>();
    for (const { m, side } of mine) {
      const e = by.get(m.map) ?? { played: 0, won: 0, rw: 0, rp: 0 };
      e.played++;
      if (side !== null) { if (m.score[side] > m.score[1 - side]) e.won++; e.rw += m.score[side]; e.rp += m.score[0] + m.score[1]; }
      by.set(m.map, e);
    }
    return [...by.entries()].sort((a, b) => b[1].played - a[1].played);
  }, [mine]);

  const players = useMemo(() => {
    if (!hasTeam(team)) return [];
    return team.players.map((p) => {
      let rounds = 0, rating = 0, adr = 0, kast = 0, n = 0;
      for (const { m } of mine) {
        const idx = m.players.findIndex((x) => x.steamid === p.steamid);
        const s = m.stats.all.find((x) => x.player === idx);
        if (!s || !s.rounds) continue;
        n++; rounds += s.rounds; rating += s.rating2 * s.rounds; adr += s.adr * s.rounds; kast += s.kast * s.rounds;
      }
      return { ...p, n, rating: rounds ? rating / rounds : null, adr: rounds ? adr / rounds : null, kast: rounds ? kast / rounds : null };
    }).sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
  }, [mine, team]);

  const setup = [
    !hasTeam(team) && { icon: Users, title: tt('Set up your team'), text: tt('Name, logo and players: everything becomes “us vs them”.'), go: () => navigate({ page: 'settings', section: 'team' }) },
    info && (!info.anim || info.geo.length === 0) && { icon: Box, title: tt('Install the 3D maps'), text: tt('Maps and real player models from your CS2, in one click.'), go: () => navigate({ page: 'settings', section: '3d' }) },
    matches !== null && matches.length === 0 && { icon: Library, title: tt('Build your library'), text: tt('Import a folder of demos: stats, heatmaps, lineups across all of them.'), go: () => navigate({ page: 'library' }) },
  ].filter(Boolean) as { icon: React.ComponentType<{ className?: string }>; title: string; text: string; go: () => void }[];

  return (
    <div className="h-full overflow-y-auto p-6" data-testid="dashboard">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-center gap-3">
          {team.logo ? <img src={team.logo} alt="" className="size-11 rounded-lg border object-contain" /> : <div className="flex size-11 items-center justify-center rounded-lg border bg-muted/40"><Radar className="size-5 text-muted-foreground" /></div>}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold">{team.name || tt('Dashboard')}</h1>
            <p className="text-xs text-muted-foreground">
              {hasTeam(team) ? <>{mine.length} {tt('match')}{mine.length === 1 ? '' : 'es'} {tt('in your library ·') + ' '}<span className="num text-foreground">{record.w}–{record.l}</span></> : tt('Open a demo, or set up your team to follow its form.')}
            </p>
          </div>
          {current && <Button onClick={() => navigate({ page: 'replay', view: 'replay' })}>{tt('Back to') + ' '}{mapDisplayName(current.map)} {current.score} <ChevronRight /></Button>}
        </div>

        {setup.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-3">
            {setup.map((c) => (
              <button key={c.title} type="button" onClick={c.go} className="flex items-start gap-3 rounded-xl border bg-card p-4 text-left hover:bg-accent">
                <c.icon className="mt-0.5 size-4 shrink-0" />
                <span><span className="block text-sm font-medium">{c.title}</span><span className="block text-xs text-muted-foreground">{c.text}</span></span>
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-4">
            <div className="flex justify-center">{dropZone}</div>
            <Card title={hasTeam(team) ? tt('Last matches of your team') : tt('Last matches')} action={<button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => navigate({ page: 'library' })}>{tt('Library →')}</button>}>
              {mine.length === 0 && <p className="text-xs text-muted-foreground">{matches === null ? tt('Loading…') : hasTeam(team) ? tt('No match of your team in the library yet.') : tt('No demo in the library yet.')}</p>}
              <div className="divide-y">
                {mine.slice(0, 8).map(({ m, side }) => {
                  const us = side ?? 0, them = 1 - us;
                  const res = side === null ? null : m.score[us] > m.score[them] ? 'W' : m.score[us] < m.score[them] ? 'L' : 'D';
                  return (
                    <div key={m.id} className="flex items-center gap-3 py-2 text-sm">
                      <span className={cn('flex size-6 items-center justify-center rounded text-[11px] font-semibold', res === 'W' ? 'bg-foreground text-background' : res === 'L' ? 'border text-muted-foreground' : 'text-muted-foreground')}>{res ?? '·'}</span>
                      <span className="w-20 text-xs text-muted-foreground">{new Date(m.date).toLocaleDateString(locale)}</span>
                      <span className="w-20 font-medium">{mapDisplayName(m.map)}</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{m.teams[us]} <span className="text-muted-foreground/60">{tt('vs')}</span> {m.teams[them]}</span>
                      <span className="num font-medium">{m.score[us]}–{m.score[them]}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card title={tt('Coming up')} action={<button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => navigate({ page: 'calendar' })}>{tt('Calendar →')}</button>}>
              {next.length === 0 ? <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => navigate({ page: 'calendar' })}>{tt('Nothing planned: add your next scrim or official →')}</button> : (
                <div className="space-y-1.5">
                  {next.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 text-xs">
                      <span className="w-20 text-muted-foreground">{new Date(`${e.day}T12:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                      <span className="num w-10 text-muted-foreground">{e.time}</span>
                      <span className="rounded border px-1 text-[10px]">{EVENT_KIND[e.kind]}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{e.opponent || '—'}</span>
                      {e.map && <span className="text-muted-foreground">{mapDisplayName(e.map)}</span>}
                      {e.opponent && <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => navigate({ page: 'prep', team: e.opponent })}>{tt('Prepare →')}</button>}
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card title={hasTeam(team) ? tt('Map form') : tt('Maps played')}>
              {maps.length === 0 && <p className="text-xs text-muted-foreground">{tt('Nothing yet.')}</p>}
              <div className="space-y-2">
                {maps.slice(0, 8).map(([map, e]) => {
                  const wr = hasTeam(team) && e.played ? (e.won / e.played) * 100 : null;
                  return (
                    <div key={map} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">{mapDisplayName(map)}</span>
                        <span className="num text-muted-foreground">{hasTeam(team) ? tt('{0}–{1} · {2}% rounds', [e.won, e.played - e.won, e.rp ? Math.round((e.rw / e.rp) * 100) : 0]) : `${e.played} match${e.played === 1 ? '' : 'es'}`}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground/80" style={{ width: `${wr ?? Math.min(100, e.played * 10)}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            </Card>
            {players.length > 0 && (
              <Card title={tt('Players')} action={<button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => navigate({ page: 'analysis', tab: 'players' })}>{tt('Player stats →')}</button>}>
                <div className="space-y-1">
                  {players.map((p) => (
                    <div key={p.steamid} className="flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                      <span className="num w-10 text-right" title={tt('Rating 2.0≈')}>{p.rating?.toFixed(2) ?? '—'}</span>
                      <span className="num w-10 text-right text-muted-foreground" title="ADR">{p.adr?.toFixed(0) ?? '—'}</span>
                      <span className="num w-10 text-right text-muted-foreground" title="KAST">{p.kast != null ? `${p.kast.toFixed(0)}%` : '—'}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            <Card title={tt('Prepare')}>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { icon: Dumbbell, label: tt('Training plan'), go: () => navigate({ page: 'analysis', tab: 'training' }) },
                  { icon: Crosshair, label: tt('Nade finder'), go: () => navigate({ page: 'analysis', tab: 'lineups' }) },
                  { icon: FileText, label: tt('Match prep'), go: () => navigate({ page: 'prep' }) },
                  { icon: Presentation, label: tt('Boards'), go: () => navigate({ page: 'boards' }) },
                  { icon: BookOpen, label: tt('Playbook ({0})', [plays.length]), go: () => navigate({ page: 'playbook' }) },
                  { icon: Clapperboard, label: tt('Reviews'), go: () => navigate({ page: 'reviews' }) },
                ].map((a) => (
                  <button key={a.label} type="button" onClick={a.go} className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs hover:bg-accent"><a.icon className="size-3.5 text-muted-foreground" />{a.label}</button>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between"><h2 className="text-sm font-medium">{title}</h2>{action}</div>
      {children}
    </div>
  );
}
