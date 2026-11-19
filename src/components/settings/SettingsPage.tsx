// Paramètres : mon équipe, maps 3D et modèles, affichage, à propos.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Box, ImagePlus, Info, Monitor, Plus, Search, Trash2, Users, X } from 'lucide-react';
import { navigate, type SettingsSection } from '@/app/router';
import { hasTeam, resizeLogo, setMyTeam, useMyTeam } from '@/app/my-team';
import { createProfile, deleteProfile, getProfiles, subscribeProfiles, switchProfile } from '@/app/profiles';
import { desktop } from '@/app/desktop';
import { isNativeApp } from '@/app/pwa';
import { REPO_URL } from '@/app/project';
import { quality3dStore, type Quality3D } from '@/app/quality';
import { listMatches, type LibraryMatch } from '@/library/library';
import { detectTeams } from '@/analysis/teams';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { PlayerColors } from '../shell/LayoutMenu';
import { Maps3DPanel } from './Maps3DPanel';
import { CoachSettingsDialog } from '../CoachSettings';
import { getLangSetting, setLang, tt } from '@/i18n';

const SECTIONS: { id: SettingsSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'team', label: tt('My team'), icon: Users },
  { id: '3d', label: tt('3D maps & models'), icon: Box },
  { id: 'display', label: tt('Display'), icon: Monitor },
  { id: 'about', label: tt('About'), icon: Info },
];

export function SettingsPage({ section }: { section: SettingsSection }) {
  return (
    <div className="flex h-full min-h-0">
      <div className="w-52 shrink-0 space-y-0.5 border-r p-3">
        <div className="px-2 pb-2 text-sm font-semibold">{tt('Settings')}</div>
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" onClick={() => navigate({ page: 'settings', section: s.id })} aria-current={section === s.id ? 'page' : undefined}
            className={cn('flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground', section === s.id && 'bg-accent font-medium text-foreground')}>
            <s.icon className="size-4" /> {s.label}
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {section === 'team' && <TeamSettings />}
          {section === '3d' && <><Header title={tt('3D maps & models')} text={tt('Choose which maps get a 3D model, from your own CS2 install: the competitive pool, the other maps of the game, and the workshop maps you are subscribed to.')} /><Maps3DPanel /></>}
          {section === 'display' && <DisplaySettings />}
          {section === 'about' && <About />}
        </div>
      </div>
    </div>
  );
}

const Header = ({ title, text }: { title: string; text?: string }) => (
  <div className="space-y-1"><h1 className="text-lg font-semibold">{title}</h1>{text && <p className="text-sm text-muted-foreground">{text}</p>}</div>
);

function ProfilesCard() {
  const { active, list } = useSyncExternalStore(subscribeProfiles, getProfiles);
  const [name, setName] = useState('');
  return (
    <div className="space-y-2 rounded-xl border bg-card p-4" data-testid="profiles-card">
      <div className="text-sm font-medium">{tt('Team profiles')}</div>
      <p className="text-xs text-muted-foreground">{tt('One profile per team you play or coach. Each has its own roster, logo, playbook, calendar, reviews, VODs, boards and match-prep notes; the demo library and settings are shared. Switch from the top of the sidebar.')}</p>
      <div className="space-y-1">
        {list.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
            {p.logo ? <img src={p.logo} alt="" className="size-5 rounded object-contain" /> : <span className="size-5 rounded border" />}
            <span className="min-w-0 flex-1 truncate">{p.name || tt('Unnamed team')}</span>
            {p.id === active ? <span className="text-xs text-muted-foreground">{tt('Active')}</span>
              : <Button size="xs" variant="outline" onClick={() => switchProfile(p.id)}>{tt('Switch')}</Button>}
            {list.length > 1 && <Button size="icon-xs" variant="ghost" aria-label={tt('Delete {0}', [p.name || 'this profile'])}
              onClick={() => { if (confirm(tt('Delete the profile “{0}” with its playbook, calendar, reviews, boards and prep notes? The demo library is kept.', [p.name || 'Unnamed team']))) void deleteProfile(p.id); }}><Trash2 /></Button>}
          </div>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; const id = createProfile(name); setName(''); switchProfile(id); }}>
        <Input className="h-8" value={name} onChange={(e) => setName(e.target.value)} placeholder={tt('New team profile name')} maxLength={40} />
        <Button size="sm" type="submit" disabled={!name.trim()}><Plus /> {tt('Create')}</Button>
      </form>
    </div>
  );
}

function TeamSettings() {
  const team = useMyTeam();
  const [matches, setMatches] = useState<LibraryMatch[]>([]);
  const [q, setQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { listMatches().then(setMatches); }, []);
  const detected = useMemo(() => detectTeams(matches).slice(0, 6), [matches]);
  // Tous les joueurs de la bibliothèque, par nombre de matchs
  const people = useMemo(() => {
    const m = new Map<string, { steamid: string; name: string; n: number }>();
    for (const x of matches) for (const p of x.players) { if (!p.steamid || p.steamid === '0') continue; const e = m.get(p.steamid) ?? { steamid: p.steamid, name: p.name, n: 0 }; e.n++; e.name = p.name; m.set(p.steamid, e); }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [matches]);
  const ids = new Set(team.players.map((p) => p.steamid));
  const found = q.trim() ? people.filter((p) => !ids.has(p.steamid) && (p.name.toLowerCase().includes(q.toLowerCase()) || p.steamid.includes(q))).slice(0, 8) : [];

  return (
    <>
      <Header title={tt('My team')} text={tt('The roster of the active profile: the dashboard, the sidebar and the analysis then know which side is yours.')} />
      <ProfilesCard />
      <div className="flex items-center gap-4 rounded-xl border bg-card p-4" data-testid="team-settings">
        <button type="button" onClick={() => fileRef.current?.click()} className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted/40 text-muted-foreground hover:text-foreground" aria-label={tt('Team logo')}>
          {team.logo ? <img src={team.logo} alt="" className="size-full object-contain" /> : <ImagePlus className="size-5" />}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setMyTeam({ logo: await resizeLogo(f) }); e.target.value = ''; }} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="text-xs text-muted-foreground">{tt('Team name')}</div>
          <Input value={team.name} onChange={(e) => setMyTeam({ name: e.target.value.slice(0, 40) })} placeholder={tt('Your team')} />
        </div>
        {team.logo && <Button size="icon-sm" variant="ghost" aria-label={tt('Remove the logo')} onClick={() => setMyTeam({ logo: null })}><X /></Button>}
      </div>

      <div className="space-y-2 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">{tt('Players') + ' '}<span className="num text-muted-foreground">({team.players.length})</span></div>
          {hasTeam(team) && <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setMyTeam({ players: [] })}>{tt('Clear')}</button>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {team.players.map((p) => (
            <span key={p.steamid} className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-1 pl-2 text-xs">
              {p.name}
              <button type="button" aria-label={tt('Remove {0}', [p.name])} className="text-muted-foreground hover:text-foreground" onClick={() => setMyTeam({ players: team.players.filter((x) => x.steamid !== p.steamid) })}><X className="size-3" /></button>
            </span>
          ))}
          {!team.players.length && <span className="text-xs text-muted-foreground">{tt('No player yet: pick a detected team below, or search your library.')}</span>}
        </div>
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
          <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={people.length ? tt('Search {0} players of your library (name or SteamID)', [people.length]) : tt('Add demos to your library to pick players')} />
        </div>
        {found.length > 0 && (
          <div className="space-y-0.5">
            {found.map((p) => (
              <button key={p.steamid} type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
                onClick={() => { setMyTeam({ players: [...team.players, { steamid: p.steamid, name: p.name }] }); setQ(''); }}>
                <Plus className="size-3.5 text-muted-foreground" /><span className="flex-1">{p.name}</span><span className="num text-muted-foreground">{p.n} {tt('match')}{p.n === 1 ? '' : 'es'}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {detected.length > 0 && (
        <div className="space-y-2 rounded-xl border bg-card p-4">
          <div className="text-sm font-medium">{tt('Teams found in your library')}</div>
          <p className="text-xs text-muted-foreground">{tt('Rosters that played together (3 shared players or more). One click fills your team.')}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {detected.map((t) => (
              <button key={t.id} type="button" className="rounded-lg border p-2.5 text-left hover:bg-accent"
                onClick={() => setMyTeam({ name: team.name || t.name, players: t.players.filter((p) => p.matches >= Math.max(1, Math.ceil(t.entries.length / 3))).slice(0, 7).map((p) => ({ steamid: p.steamid, name: p.name })) })}>
                <div className="truncate text-sm font-medium">{t.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">{t.entries.length} {tt('match')}{t.entries.length === 1 ? '' : 'es'} · {t.players.slice(0, 5).map((p) => p.name).join(', ')}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      {hasTeam(team) && <Button variant="outline" size="sm" onClick={() => setMyTeam({ name: '', logo: null, players: [] })}><Trash2 /> {tt('Forget my team')}</Button>}
    </>
  );
}

function DisplaySettings() {
  const langSetting = getLangSetting();
  const [coach, setCoach] = useState(false);
  const [radar, setRadar] = useState(() => { try { return localStorage.getItem('scrimview.3d.radarFloors') !== '0'; } catch { return true; } });
  return (
    <>
      <Header title={tt('Display')} />
      <div className="space-y-2 rounded-xl border bg-card p-4" data-testid="language">
        <div className="text-sm font-medium">{tt('Language')}</div>
        <div className="flex flex-wrap gap-1">
          {([['auto', tt('Automatic (system)')], ['fr', tt('Français')], ['en', tt('English')]] as const).map(([v, label]) => (
            <Button key={v} size="sm" variant={langSetting === v ? 'default' : 'outline'} onClick={() => setLang(v)}>{label}</Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{tt('The app reloads to apply the language. The AI coach has its own answer language in its settings.')}</p>
      </div>
      <div className="rounded-xl border bg-card p-2"><PlayerColors /></div>
      <div className="space-y-2 rounded-xl border bg-card p-4">
        <div className="text-sm font-medium">{tt('3D replay')}</div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-foreground" checked={radar} onChange={(e) => { setRadar(e.target.checked); try { localStorage.setItem('scrimview.3d.radarFloors', e.target.checked ? '1' : '0'); } catch { /* */ } }} />
          {tt('Radar image on the floors (otherwise plain floors)')}
        </label>
        <Quality3DSetting />
      </div>
      <div className="flex items-center justify-between rounded-xl border bg-card p-4">
        <div><div className="text-sm font-medium">{tt('Coach (AI)')}</div><div className="text-xs text-muted-foreground">{tt('Provider, model, language. Optional, your own key or a local model.')}</div></div>
        <Button size="sm" variant="outline" onClick={() => setCoach(true)}>{tt('Coach settings')}</Button>
      </div>
      <CoachSettingsDialog open={coach} onOpenChange={setCoach} onSaved={() => setCoach(false)} />
    </>
  );
}

function About() {
  const [ver, setVer] = useState<string | null>(null);
  useEffect(() => { desktop?.info().then((i) => setVer(i.version)); }, []);
  return (
    <>
      <Header title={tt('About Celeste')} />
      <div className="space-y-2 rounded-xl border bg-card p-4 text-sm">
        <p>{tt('Free, local-first demo viewer and scrim tool for Counter-Strike 2. Your demos, notes and stats never leave your machine.')}</p>
        <p className="text-muted-foreground">{desktop ? tt('Desktop app {0}', [ver ?? '']) : `${isNativeApp ? tt('Android app') : tt('Browser version')} ${__APP_VERSION__}`} {tt('· MIT license')}</p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Button size="sm" variant="outline" asChild><a href={REPO_URL} target="_blank" rel="noreferrer">{tt('GitHub')}</a></Button>
          <Button size="sm" variant="outline" asChild><a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">{tt('Report a problem')}</a></Button>
        </div>
      </div>
    </>
  );
}

function Quality3DSetting() {
  const q = quality3dStore.use();
  const OPTS: { id: Quality3D; label: string; hint: string }[] = [
    { id: 'auto', label: tt('Auto'), hint: tt('Measured once when the map loads, then fixed') },
    { id: 'high', label: tt('High'), hint: tt('Full resolution (sharpest, heavier)') },
    { id: 'performance', label: tt('Performance'), hint: tt('Lower resolution, smooth on small graphics cards') },
  ];
  return (
    <div className="space-y-1.5 pt-1">
      <div className="text-xs text-muted-foreground">{tt('Image quality')}</div>
      <div className="grid grid-cols-3 gap-1">
        {OPTS.map((o) => <button key={o.id} type="button" title={o.hint} onClick={() => quality3dStore.set(o.id)} className={cn('rounded-md border px-2 py-1 text-xs hover:bg-accent', q === o.id && 'bg-accent font-medium')}>{o.label}</button>)}
      </div>
      <p className="text-[11px] text-muted-foreground">{OPTS.find((o) => o.id === q)!.hint}{tt('. It never changes while you play or draw.')}</p>
    </div>
  );
}
