// Préparation de match : choisir l'adversaire (équipe détectée ou événement du calendrier), voir son
// map pool et le veto prédit, puis par carte ses tendances classées par importance, avec les rounds à
// revoir et une piste de contre à ajouter au playbook ; enfin le plan de jeu, exportable pour l'équipe.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, ClipboardCopy, Download, Play as PlayIcon, Plus, Search, Sparkles, TriangleAlert, Upload, X } from 'lucide-react';
import { listMatches, type LibraryMatch } from '@/library/library';
import { loadModels } from '@/calib/model';
import { detectTeams, type TeamGroup } from '@/analysis/teams';
import { subjectMaps } from '@/analysis/brief';
import { buildMapPrep, buildOverview, prepMarkdown, teamGroupFromRoster, type EconomyRow, type MapPrep, type PrepFinding } from '@/analysis/prep';
import { ACTIVE_DUTY, mapDisplayName } from '@/maps/maps';
import { navigate } from '@/app/router';
import { hasTeam, useMyTeam } from '@/app/my-team';
import { calendarStore, upcoming } from '@/app/calendar';
import { newPlay, playbookStore, savePlay, selectPlayLater, type PlayType } from '@/app/playbook';
import { exportPrep, importPrep, prepKey, prepStore, setPrepNote } from '@/app/prep-store';
import { newLocalId } from '@/app/local-store';
import { downloadBlob, safeName } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { copyText } from '../CopySetpos';
import { cn } from '@/lib/utils';
import { locale, tt } from '@/i18n';

type OpenRound = (lm: LibraryMatch, round: number, queue?: number[]) => void;
const clock = (sec: number | null) => { if (sec == null) return '—'; const l = Math.max(0, Math.ceil(115 - sec)); return `${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}`; };
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const BUY: Record<string, string> = { pistol: tt('Pistol'), eco: tt('Eco'), force: tt('Force'), full: tt('Full buy') };
const SIDE: Record<PrepFinding['side'], string> = { t: tt('T side'), ct: tt('CT side'), all: tt('Both') };

export function PrepPage({ team: teamParam, onOpenRound }: { team?: string; onOpenRound: OpenRound }) {
  const [matches, setMatches] = useState<LibraryMatch[] | null>(null);
  useEffect(() => { listMatches().then(setMatches); }, []);
  const my = useMyTeam();
  const events = calendarStore.use();
  const model3 = useMemo(() => loadModels().hltv3, []);
  const all = useMemo(() => (matches ?? []).filter((m) => m.spatial), [matches]);
  const us = useMemo(() => (hasTeam(my) ? teamGroupFromRoster(all, my.name, my.players.map((p) => p.steamid)) : null), [all, my]);
  const teams = useMemo(() => {
    const mine = new Set(my.players.map((p) => p.steamid));
    return detectTeams(all).filter((t) => t.players.filter((p) => mine.has(p.steamid)).length < 3).sort((a, b) => b.entries.length - a.entries.length);
  }, [all, my]);
  const find = (q: string) => teams.find((t) => t.id === q) ?? teams.find((t) => t.name.toLowerCase() === q.toLowerCase()) ?? teams.find((t) => t.name.toLowerCase().includes(q.toLowerCase()) || q.toLowerCase().includes(t.name.toLowerCase()));
  const them = teamParam ? find(teamParam) ?? null : null;

  if (!matches) return <div className="p-6 text-sm text-muted-foreground">{tt('Loading the library…')}</div>;
  if (!them) return <OpponentPicker teams={teams} events={upcoming(events, new Date(), 6).filter((e) => e.opponent)} find={find} missing={teamParam} empty={!all.length} />;
  return <Prep key={them.id} all={all} them={them} us={us} model3={model3} onOpenRound={onOpenRound} />;
}

function OpponentPicker({ teams, events, find, missing, empty }: { teams: TeamGroup[]; events: { id: string; day: string; opponent: string; map: string }[]; find: (q: string) => TeamGroup | undefined; missing?: string; empty: boolean }) {
  const [q, setQ] = useState('');
  const shown = teams.filter((t) => !q || `${t.name} ${t.players.map((p) => p.name).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const go = (t: TeamGroup) => navigate({ page: 'prep', team: t.id });
  return (
    <div className="h-full overflow-y-auto p-6" data-testid="prep-picker">
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h1 className="text-lg font-semibold">{tt('Match prep')}</h1>
          <p className="text-sm text-muted-foreground">{tt('Pick the team you play next. Celeste reads every demo of theirs in your library: map pool, veto, what they do by economy, their timings, their setups and players, and what changed recently.')}</p>
        </div>
        {missing && <p className="flex items-center gap-2 rounded-lg border p-3 text-sm"><TriangleAlert className="size-4" /> {tt('No team named “')}{missing}{tt('” in your library yet. Import their demos, then pick them here.')}</p>}
        {events.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">{tt('Coming up')}</div>
            <div className="flex flex-wrap gap-1.5">
              {events.map((e) => { const t = find(e.opponent); return (
                <button key={e.id} type="button" disabled={!t} onClick={() => t && go(t)} title={t ? tt('Prepare {0}', [t.name]) : tt('No demos of this team in your library')}
                  className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50">
                  <CalendarDays className="size-3" /> {e.opponent} <span className="text-muted-foreground">{new Date(`${e.day}T12:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}{e.map ? ` · ${mapDisplayName(e.map)}` : ''}</span>
                </button>
              ); })}
            </div>
          </div>
        )}
        <div className="relative"><Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" /><Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tt('Search a team or a player')} /></div>
        {empty ? <p className="text-sm text-muted-foreground">{tt('Your library is empty. Import demos (Library) to prepare against a team.')}</p> : (
          <div className="grid gap-2 sm:grid-cols-2">
            {shown.map((t) => (
              <button key={t.id} type="button" onClick={() => go(t)} className="rounded-lg border p-3 text-left hover:bg-accent" data-testid="prep-team">
                <div className="flex items-baseline gap-2"><span className="flex-1 truncate font-medium">{t.name}</span><span className="num text-xs text-muted-foreground">{t.entries.length} {tt('map')}{t.entries.length === 1 ? '' : 's'}</span></div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">{t.players.slice(0, 5).map((p) => p.name).join(', ')}</div>
              </button>
            ))}
            {!shown.length && <p className="text-sm text-muted-foreground">{tt('No team matches.')}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function Prep({ all, them, us, model3, onOpenRound }: { all: LibraryMatch[]; them: TeamGroup; us: TeamGroup | null; model3?: ReturnType<typeof loadModels>['hltv3']; onOpenRound: OpenRound }) {
  const maps = useMemo(() => subjectMaps(all, { kind: 'team', group: them }), [all, them]);
  const overview = useMemo(() => buildOverview(all, them, us, ACTIVE_DUTY), [all, them, us]);
  const [tab, setTab] = useState<string>('overview');
  const cache = useRef(new Map<string, MapPrep | null>());
  const prepOf = (map: string) => { if (!cache.current.has(map)) cache.current.set(map, buildMapPrep(all, map, them, model3)); return cache.current.get(map) ?? null; };
  const notes = prepStore.use()[prepKey(them.name)]?.notes ?? {};
  const counters = playbookStore.use().filter((p) => p.opponent && prepKey(p.opponent) === prepKey(them.name));
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const markdown = () => prepMarkdown(overview, maps.map(prepOf).filter((x): x is MapPrep => !!x), notes, mapDisplayName);
  const byId = useMemo(() => new Map(all.map((m) => [m.id, m])), [all]);

  const addCounter = (map: string, f: PrepFinding) => {
    const side: 't' | 'ct' = f.side === 'ct' ? 't' : 'ct';
    const type: PlayType = f.side === 'ct' ? 'execute' : f.side === 't' ? 'setup' : 'other';
    const p = newPlay(map, side);
    const clips = f.rounds.slice(0, 6).flatMap((r) => { const lm = byId.get(r.matchId); return lm ? [{ id: newLocalId(), demoId: lm.id, fileName: lm.fileName, round: r.round, tick: 0, label: tt('{0}, round {1}', [them.name, r.round + 1]) }] : []; });
    savePlay({ ...p, type, name: tt('Anti {0}: {1}', [them.name, f.text.length > 48 ? `${f.text.slice(0, 46)}…` : f.text]), description: tt('What they do: {0}{1}.\n\nOur answer: {2}', [f.text, f.sample ? ` (${f.sample})` : '', f.counter]), opponent: them.name, clips });
    selectPlayLater(p.id);
    navigate({ page: 'playbook' });
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="prep">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => navigate({ page: 'prep' })}>{tt('Match prep')}</button>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-base font-semibold">{them.name}</h1>
        <span className="num text-xs text-muted-foreground">{them.entries.length} {tt('map')}{them.entries.length === 1 ? '' : 's'} {tt('in your library')}</span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={async () => { if (await copyText(markdown())) { setCopied(true); setTimeout(() => setCopied(false), 1200); } }}>{copied ? <Check /> : <ClipboardCopy />} {tt('Markdown')}</Button>
        <Button size="sm" variant="ghost" title={tt('A file your teammates can open in Celeste (notes included)')} onClick={() => downloadBlob(new Blob([exportPrep(them.name, markdown())], { type: 'application/json' }), `prep-${safeName(them.name)}.json`)}><Download /> {tt('Share file')}</Button>
        <Button size="icon-sm" variant="ghost" aria-label={tt('Import a prep file')} title={tt('Import a prep file from a teammate')} onClick={() => fileRef.current?.click()}><Upload /></Button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { const r = importPrep(await f.text()); alert(tt('Notes for {0} imported ({1} map{2}).', [r.team, r.maps, r.maps === 1 ? '' : 's'])); } catch (err) { alert(err instanceof Error ? err.message : String(err)); } }} />
      </div>
      <div className="flex gap-1 overflow-x-auto border-b px-4 py-1.5" role="tablist">
        {['overview', ...maps, 'plan'].map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('rounded-md px-2.5 py-1 text-sm whitespace-nowrap hover:bg-accent', tab === t && 'bg-accent font-medium')}>
            {t === 'overview' ? tt('Overview') : t === 'plan' ? tt('Game plan') : mapDisplayName(t)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-5xl">
          {tab === 'overview' && <OverviewView overview={overview} hasUs={!!us} maps={maps} prepOf={prepOf} onMap={setTab} />}
          {tab === 'plan' && <PlanView team={them.name} maps={maps} notes={notes} counters={counters} />}
          {tab !== 'overview' && tab !== 'plan' && (() => { const p = prepOf(tab); return p ? <MapView prep={p} byId={byId} note={notes[tab] ?? ''} onNote={(t) => setPrepNote(them.name, tab, t)} onOpenRound={onOpenRound} onCounter={(f) => addCounter(tab, f)} /> : <p className="text-sm text-muted-foreground">{tt('Not enough data on this map.')}</p>; })()}
        </div>
      </div>
    </div>
  );
}

function OverviewView({ overview, hasUs, maps, prepOf, onMap }: { overview: ReturnType<typeof buildOverview>; hasUs: boolean; maps: string[]; prepOf: (m: string) => MapPrep | null; onMap: (m: string) => void }) {
  const strength = (s?: { strength: number; wins: number; matches: number; ties: number }) => (s ? <span><span className="num">{s.wins}–{s.matches - s.wins - s.ties}{s.ties ? `–${s.ties}` : ''}</span> <span className="text-muted-foreground">· {Math.round(s.strength * 100)}%</span></span> : <span className="text-muted-foreground">{tt('never')}</span>);
  const key = maps[0] ? prepOf(maps[0]) : null;
  const players = key?.players ?? [];
  return (
    <div className="space-y-6">
      {overview.form.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">{tt('Recent form')}</h2>
          <div className="flex flex-wrap gap-1.5">
            {overview.form.map((f) => (
              <span key={f.matchId} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                <span className={cn('w-3 font-semibold', f.us > f.them ? '' : 'text-muted-foreground')}>{f.us > f.them ? 'W' : f.us < f.them ? 'L' : 'D'}</span>
                <span className="num">{f.us}–{f.them}</span> {mapDisplayName(f.map)} <span className="text-muted-foreground">{tt('vs') + ' '}{f.opponent}</span>
              </span>
            ))}
          </div>
        </section>
      )}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">{tt('Map pool')}</h2>
        <Table>
          <TableHeader><TableRow><TableHead>{tt('Map')}</TableHead><TableHead>{tt('Them')}</TableHead>{hasUs && <TableHead>{tt('Us')}</TableHead>}{hasUs && <TableHead className="text-right">{tt('Edge')}</TableHead>}<TableHead /></TableRow></TableHeader>
          <TableBody>
            {overview.maps.map((r) => (
              <TableRow key={r.map}>
                <TableCell className="font-medium">{mapDisplayName(r.map)}</TableCell>
                <TableCell>{strength(r.them)}</TableCell>
                {hasUs && <TableCell>{strength(r.us)}</TableCell>}
                {hasUs && <TableCell className={cn('num text-right', !r.reliable && 'text-muted-foreground')} title={r.reliable ? '' : tt('Small sample on one side')}>{r.edge >= 0 ? '+' : ''}{Math.round(r.edge * 100)}</TableCell>}
                <TableCell className="text-right">{maps.includes(r.map) && <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onMap(r.map)}>{tt('Prep →')}</button>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!hasUs && <p className="text-xs text-muted-foreground">{tt('Declare your roster in Settings → My team to compare pools and get a veto suggestion.')}</p>}
      </section>
      {overview.veto && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">{tt('Suggested veto') + ' '}<span className="font-normal text-muted-foreground">{tt('(you start; strength from round win rates, shrunk toward average on small samples)')}</span></h2>
          {(['bo1', 'bo3'] as const).map((f) => (
            <div key={f} className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="w-8 font-medium uppercase">{f}</span>
              {overview.veto![f].map((s, i) => (
                <span key={i} className={cn('rounded-md border px-2 py-0.5', s.action === 'pick' && 'bg-accent', s.action === 'decider' && 'bg-foreground text-background')}>
                  {s.team === 'us' ? tt('You') : s.team === 'them' ? tt('They') : ''} {s.action} {mapDisplayName(s.map)}
                </span>
              ))}
            </div>
          ))}
        </section>
      )}
      {players.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">{tt('Key players') + ' '}<span className="font-normal text-muted-foreground">{tt('on') + ' '}{mapDisplayName(key!.map)}{tt(', their most played map')}</span></h2>
          <PlayerCards prep={key!} />
        </section>
      )}
    </div>
  );
}

function PlayerCards({ prep }: { prep: MapPrep }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {[...prep.players].sort((a, b) => b.rating - a.rating).map((p) => (
        <div key={p.steamid} className="space-y-1 rounded-lg border p-3 text-xs">
          <div className="flex items-baseline gap-2"><span className="flex-1 truncate text-sm font-medium">{p.name}</span><span className="text-muted-foreground">{p.role}</span></div>
          <div className="num flex gap-3 text-muted-foreground"><span>{tt('Rating') + ' '}<b className="text-foreground">{p.rating.toFixed(2)}</b></span><span>{tt('ADR') + ' '}{Math.round(p.adr)}</span><span>{tt('KAST') + ' '}{Math.round(p.kast)}%</span></div>
          <div className="text-muted-foreground">{tt('Openings') + ' '}<span className="num text-foreground">{p.openings[0]}–{p.openings[1]}</span> ({p.openingShare}{tt('% of the team’s) · Clutches') + ' '}<span className="num text-foreground">{p.clutches[0]}/{p.clutches[1]}</span>{p.awpShare >= 15 ? tt(' · AWP {0}%', [p.awpShare]) : ''}</div>
          {p.spots.t.length > 0 && <div><span className="text-muted-foreground">{tt('T at 20 s:')}</span> {p.spots.t.join(', ')}</div>}
          {p.spots.ct.length > 0 && <div><span className="text-muted-foreground">{tt('CT at 20 s:')}</span> {p.spots.ct.join(', ')}</div>}
          {p.awpSpots.length > 0 && <div><span className="text-muted-foreground">{tt('AWP kills from:')}</span> {p.awpSpots.join(', ')}</div>}
        </div>
      ))}
    </div>
  );
}

function MapView({ prep, byId, note, onNote, onOpenRound, onCounter }: { prep: MapPrep; byId: Map<string, LibraryMatch>; note: string; onNote: (t: string) => void; onOpenRound: OpenRound; onCounter: (f: PrepFinding) => void }) {
  const [watch, setWatch] = useState<PrepFinding | null>(null);
  const [draft, setDraft] = useState(note);
  useEffect(() => { const t = setTimeout(() => { if (draft !== note) onNote(draft); }, 400); return () => clearTimeout(t); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = prep.brief;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 text-xs">
        <Pill label={tt('Record')} value={`${b.record.won}–${b.record.lost}${b.record.tied ? `–${b.record.tied}` : ''}`} />
        <Pill label={tt('T rounds')} value={pct(b.t.won, b.t.played)} />
        <Pill label={tt('CT rounds')} value={pct(b.ct.won, b.ct.played)} />
        <Pill label={tt('Pistols')} value={pct(b.pistol.won, b.pistol.played)} />
        <Pill label={tt('First contact (T)')} value={clock(prep.timings.tContact)} sub={prep.timings.base.tContact != null ? `ref ${clock(prep.timings.base.tContact)}` : undefined} />
        <Pill label={tt('Plant')} value={clock(prep.timings.plant)} sub={prep.timings.base.plant != null ? `ref ${clock(prep.timings.base.plant)}` : undefined} />
      </div>
      {(b.small || prep.matches < 3) && <p className="flex items-center gap-2 rounded-lg border p-2.5 text-xs text-muted-foreground"><TriangleAlert className="size-3.5" /> {prep.matches} {tt('map')}{prep.matches === 1 ? '' : 's'} {tt('only: treat these as hints, not habits.')}</p>}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">{tt('What stands out') + ' '}<span className="font-normal text-muted-foreground">{tt('(ranked by how far it is from the reference and how often it happens)')}</span></h2>
        {prep.findings.length === 0 && <p className="text-xs text-muted-foreground">{tt('Nothing clearly unusual yet. More demos will sharpen this.')}</p>}
        <div className="space-y-1.5">
          {prep.findings.map((f) => (
            <div key={f.id} className="rounded-lg border p-3" data-testid="prep-finding">
              <div className="flex flex-wrap items-baseline gap-2">
                {f.isNew && <span className="rounded bg-foreground px-1.5 text-[10px] leading-4 font-semibold text-background" title={tt('Seen mostly in their last {0} map{1}', [prep.recentMatches, prep.recentMatches === 1 ? '' : 's'])}>{tt('NEW')}</span>}
                <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{SIDE[f.side]}</span>
                <span className="min-w-0 flex-1 text-sm font-medium">{f.text}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{[f.sample, f.baseline && `vs ${f.baseline}`].filter(Boolean).join(' · ')}</div>
              <div className="mt-1.5 text-xs"><span className="text-muted-foreground">{tt('Counter:') + ' '}</span>{f.counter}</div>
              <div className="mt-2 flex gap-1.5">
                {f.rounds.length > 0 && <Button size="xs" variant="outline" onClick={() => setWatch(f)}><PlayIcon /> {tt('Watch') + ' '}{f.rounds.length} {tt('round')}{f.rounds.length === 1 ? '' : 's'}</Button>}
                <Button size="xs" variant="ghost" onClick={() => onCounter(f)}><Plus /> {tt('Counter-strat')}</Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <EconomyTable title={tt('Their T side by economy')} rows={prep.economy.t} t />
        <EconomyTable title={tt('Their CT side by economy')} rows={prep.economy.ct} />
      </section>

      {(prep.strategies.t.length > 0 || prep.strategies.ct.length > 0) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {(['t', 'ct'] as const).map((s) => (
            <div key={s} className="space-y-1.5">
              <h3 className="text-xs font-medium">{s === 't' ? tt('T executes and defaults') : tt('CT setups')}</h3>
              {prep.strategies[s].slice(0, 5).map((st) => (
                <button key={st.id} type="button" className="block w-full rounded-md border p-2 text-left text-xs hover:bg-accent" onClick={() => onOpenRound(st.medoid.match, st.medoid.round.i, st.rounds.filter((r) => r.match.id === st.medoid.match.id).map((r) => r.round.i))}>
                  <div className="flex gap-2"><span className="flex-1 font-medium">{st.name}</span><span className="num text-muted-foreground">{st.rounds.length}× · {st.won} {tt('won')}</span></div>
                  {st.details.length > 0 && <div className="mt-0.5 truncate text-muted-foreground">{st.details.join(' · ')}{st.avgPlantT != null ? tt(' · plant {0}', [clock(st.avgPlantT)]) : ''}</div>}
                </button>
              ))}
              {!prep.strategies[s].length && <p className="text-xs text-muted-foreground">{tt('No repeated pattern yet.')}</p>}
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">{tt('Players')}</h2>
        <PlayerCards prep={prep} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">{tt('Our plan on') + ' '}{mapDisplayName(prep.map)}</h2>
        <Textarea rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tt('Defaults, what to stack, who takes their AWPer, the anti-eco… Saved here and in the exported prep.')} />
      </section>

      {watch && <WatchList finding={watch} byId={byId} onClose={() => setWatch(null)} onOpenRound={onOpenRound} />}
    </div>
  );
}

function Pill({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rounded-lg border px-3 py-2"><div className="text-muted-foreground">{label}</div><div className="num text-base font-semibold">{value}</div>{sub && <div className="num text-[10px] text-muted-foreground">{sub}</div>}</div>;
}

function EconomyTable({ title, rows, t }: { title: string; rows: EconomyRow[]; t?: boolean }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium">{title}</h3>
      <Table>
        <TableHeader><TableRow><TableHead>{tt('Buy')}</TableHead><TableHead className="text-right">{tt('Rounds')}</TableHead><TableHead className="text-right">{tt('Won')}</TableHead>{t && <TableHead className="text-right">A / B</TableHead>}{t && <TableHead className="text-right">{tt('Plant')}</TableHead>}<TableHead>{tt('At 20 s')}</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.buy}>
              <TableCell>{BUY[r.buy]}</TableCell>
              <TableCell className="num text-right">{r.rounds}</TableCell>
              <TableCell className="num text-right">{pct(r.won, r.rounds)}</TableCell>
              {t && <TableCell className="num text-right">{r.plantA} / {r.plantB}</TableCell>}
              {t && <TableCell className="num text-right">{clock(r.avgPlantT)}</TableCell>}
              <TableCell className="max-w-48 truncate text-xs text-muted-foreground" title={r.spots.map((s) => `${s.place} ${s.share}%`).join(', ')}>{r.spots.slice(0, 3).map((s) => `${s.place} ${s.share}%`).join(', ') || '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function WatchList({ finding, byId, onClose, onOpenRound }: { finding: PrepFinding; byId: Map<string, LibraryMatch>; onClose: () => void; onOpenRound: OpenRound }) {
  const groups = new Map<string, number[]>();
  for (const r of finding.rounds) groups.set(r.matchId, [...(groups.get(r.matchId) ?? []), r.round]);
  const list = [...groups.entries()].map(([id, rounds]) => ({ lm: byId.get(id), rounds: [...new Set(rounds)].sort((a, b) => a - b) })).filter((g) => g.lm).sort((a, b) => b.lm!.date - a.lm!.date);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="dialog" aria-label={tt('Rounds to watch')}>
      <div className="max-h-[80vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl border bg-card p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <div className="flex-1"><div className="text-sm font-medium">{finding.text}</div><div className="text-xs text-muted-foreground">{tt('Each demo plays its rounds back to back, with a bar to skip between them. A demo that is not open will ask for its file.')}</div></div>
          <Button size="icon-sm" variant="ghost" aria-label={tt('Close')} onClick={onClose}><X /></Button>
        </div>
        {list.map(({ lm, rounds }) => (
          <div key={lm!.id} className="flex items-center gap-2 rounded-md border p-2 text-xs">
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{lm!.teams[0]} {tt('vs') + ' '}{lm!.teams[1]}</div><div className="text-muted-foreground">{new Date(lm!.date).toLocaleDateString(locale)} {tt('· rounds') + ' '}{rounds.map((r) => r + 1).join(', ')}</div></div>
            <Button size="xs" onClick={() => { onClose(); onOpenRound(lm!, rounds[0], rounds); }}><PlayIcon /> {tt('Play') + ' '}{rounds.length}</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanView({ team, maps, notes, counters }: { team: string; maps: string[]; notes: Record<string, string>; counters: ReturnType<typeof playbookStore.get> }) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{tt('Your plan against') + ' '}{team}{tt(', map by map. Notes are saved in this browser and included in the Markdown and the share file. Counter-strats live in the Playbook, tagged “vs') + ' '}{team}”.</p>
      {maps.map((m) => {
        const plays = counters.filter((p) => p.map === m);
        return (
          <section key={m} className="space-y-2 rounded-lg border p-3">
            <h2 className="text-sm font-medium">{mapDisplayName(m)}</h2>
            <Textarea rows={4} defaultValue={notes[m] ?? ''} onBlur={(e) => e.target.value !== (notes[m] ?? '') && setPrepNote(team, m, e.target.value)} placeholder={tt('Our plan on this map')} />
            <div className="flex flex-wrap gap-1.5">
              {plays.map((p) => <button key={p.id} type="button" className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-accent" onClick={() => { selectPlayLater(p.id); navigate({ page: 'playbook' }); }}><Sparkles className="size-3" /> {p.side.toUpperCase()} · {p.name || tt('Untitled')}</button>)}
              {!plays.length && <span className="text-xs text-muted-foreground">{tt('No counter-strat yet: use “Counter-strat” on a finding.')}</span>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
