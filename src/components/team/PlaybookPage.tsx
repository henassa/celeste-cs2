// Playbook : stratégies par map et par côté. Pour chacune : le call, les rôles, les utilitaires (avec
// setpos à copier), les boards liés et les moments de démos où elle a été jouée (ajoutés depuis le replay).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Play as PlayIcon, Plus, Presentation, Search, Trash2, Upload, X } from 'lucide-react';
import { exportPlaybook, importPlaybook, newPlay, PLAY_TYPE, playbookStore, savePlay, takePendingPlay, type Play, type PlayType } from '@/app/playbook';
import { newLocalId } from '@/app/local-store';
import { useMyTeam } from '@/app/my-team';
import { navigate } from '@/app/router';
import { listBoards } from '@/board/storage';
import type { Board } from '@/board/types';
import { knownMaps, mapDisplayName } from '@/maps/maps';
import { downloadBlob } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { CopySetpos } from '../CopySetpos';
import { tt } from '@/i18n';

const POOL_FIRST = (a: string, b: string) => a.localeCompare(b);

export function PlaybookPage({ onOpenClip }: { onOpenClip: (demoId: string, round: number) => void }) {
  const plays = playbookStore.use();
  const [map, setMap] = useState<string>('all');
  const [side, setSide] = useState<'all' | 'ct' | 't'>('all');
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState<string | null>(() => takePendingPlay());
  const [boards, setBoards] = useState<Board[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { listBoards().then(setBoards); }, []);

  const maps = useMemo(() => [...new Set([...knownMaps().filter((m) => m.startsWith('de_')), ...plays.map((p) => p.map)])].sort(POOL_FIRST), [plays]);
  const shown = plays
    .filter((p) => (map === 'all' || p.map === map) && (side === 'all' || p.side === side) && (!q || `${p.name} ${p.description} ${p.opponent ?? ''}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.map.localeCompare(b.map) || a.side.localeCompare(b.side) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  const sel = plays.find((p) => p.id === selId) ?? null;

  const create = () => { const p = newPlay(map === 'all' ? maps[0] ?? 'de_mirage' : map, side === 'all' ? 't' : side); savePlay(p); setSelId(p.id); };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 auto-rows-max overflow-y-auto md:auto-rows-auto md:overflow-visible md:grid-cols-[320px_1fr] gap-2 p-2" data-testid="playbook">
      <div className="flex min-h-0 flex-col gap-2 rounded-xl border bg-card p-3">
        <div className="flex items-center gap-2">
          <h1 className="flex-1 text-lg font-semibold">{tt('Playbook')}</h1>
          <Button size="icon-sm" variant="ghost" aria-label={tt('Import a playbook file')} title={tt('Import a playbook file')} onClick={() => fileRef.current?.click()}><Upload /></Button>
          <Button size="icon-sm" variant="ghost" aria-label={tt('Export the playbook')} title={tt('Export the playbook (share with your team)')} disabled={!plays.length}
            onClick={() => downloadBlob(new Blob([exportPlaybook(plays)], { type: 'application/json' }), 'celeste-playbook.json')}><Download /></Button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { const n = importPlaybook(await f.text()); alert(tt('{0} strat{1} imported.', [n, n === 1 ? '' : 's'])); } catch (err) { alert(err instanceof Error ? err.message : String(err)); } }} />
        </div>
        <select className="h-8 rounded-md border bg-transparent px-2 text-sm" value={map} onChange={(e) => setMap(e.target.value)} aria-label={tt('Map')}>
          <option value="all">{tt('All maps')}</option>
          {maps.map((m) => <option key={m} value={m}>{mapDisplayName(m)}</option>)}
        </select>
        <div className="grid grid-cols-3 gap-1">
          {(['all', 't', 'ct'] as const).map((s) => <button key={s} type="button" onClick={() => setSide(s)} className={cn('rounded-md border py-1 text-xs hover:bg-accent', side === s && 'bg-accent font-medium')}>{s === 'all' ? tt('Both') : s.toUpperCase()}</button>)}
        </div>
        <div className="relative"><Search className="absolute top-2 left-2.5 size-3.5 text-muted-foreground" /><Input className="h-8 pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tt('Search')} /></div>
        <Button size="sm" onClick={create} data-testid="new-play"><Plus /> {tt('New strat')}</Button>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {shown.map((p) => (
            <button key={p.id} type="button" onClick={() => setSelId(p.id)} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent', p.id === selId && 'bg-accent')}>
              <span className="w-6 text-[10px] font-semibold text-muted-foreground">{p.side.toUpperCase()}</span>
              <span className="min-w-0 flex-1 truncate"><span className="font-medium">{p.name || tt('Untitled')}</span> <span className="text-muted-foreground">· {PLAY_TYPE[p.type]}{p.opponent ? ` · vs ${p.opponent}` : ''}</span></span>
              {map === 'all' && <span className="text-muted-foreground">{mapDisplayName(p.map)}</span>}
              {p.clips.length > 0 && <span className="num text-muted-foreground" title={tt('Demo moments')}>{p.clips.length}▶</span>}
            </button>
          ))}
          {!shown.length && <p className="px-2 py-3 text-xs text-muted-foreground">{plays.length ? tt('No strat for these filters.') : tt('Write down your strats: the call, each role, the utility with its setpos, the boards, and moments from demos where you played them (from the replay: Ctrl K → “Add this moment to the playbook”).')}</p>}
        </div>
      </div>
      {sel ? <PlayEditor key={sel.id} play={sel} maps={maps} boards={boards} onOpenClip={onOpenClip} onDelete={() => { playbookStore.set((all) => all.filter((x) => x.id !== sel.id)); setSelId(null); }} />
        : <div className="flex items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">{tt('Pick a strat, or create one.')}</div>}
    </div>
  );
}

function PlayEditor({ play, maps, boards, onOpenClip, onDelete }: { play: Play; maps: string[]; boards: Board[]; onOpenClip: (demoId: string, round: number) => void; onDelete: () => void }) {
  const team = useMyTeam();
  const [p, setP] = useState(play);
  // Enregistrement automatique (léger délai pendant la frappe)
  useEffect(() => { const t = setTimeout(() => savePlay(p), 300); return () => clearTimeout(t); }, [p]);
  const set = (patch: Partial<Play>) => setP((x) => ({ ...x, ...patch }));
  const mapBoards = boards.filter((b) => b.map === p.map);
  return (
    <div className="min-h-0 space-y-3 overflow-y-auto rounded-xl border bg-card p-4" data-testid="play-editor">
      <div className="flex items-start gap-2">
        <Input className="h-10 flex-1 text-base font-semibold" value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder={tt('Strat name (e.g. A split, B rush, 3-1-1 default)')} autoFocus={!p.name} />
        <Button size="icon-sm" variant="ghost" aria-label={tt('Delete this strat')} onClick={() => { if (confirm(tt('Delete this strat?'))) onDelete(); }}><Trash2 /></Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <select className="h-8 rounded-md border bg-transparent px-2 text-sm" value={p.map} onChange={(e) => set({ map: e.target.value })} aria-label={tt('Map')}>{maps.map((m) => <option key={m} value={m}>{mapDisplayName(m)}</option>)}</select>
        <div className="flex overflow-hidden rounded-md border">{(['t', 'ct'] as const).map((s) => <button key={s} type="button" onClick={() => set({ side: s })} className={cn('px-3 text-xs', p.side === s && 'bg-accent font-medium')}>{s.toUpperCase()}</button>)}</div>
        <Input className="h-8 w-44" value={p.opponent ?? ''} onChange={(e) => set({ opponent: e.target.value || undefined })} placeholder={tt('Anti-strat vs (optional)')} aria-label={tt('Opponent')} />
        <div className="flex flex-wrap gap-1">{(Object.keys(PLAY_TYPE) as PlayType[]).map((t) => <button key={t} type="button" onClick={() => set({ type: t })} className={cn('h-8 rounded-md border px-2 text-xs hover:bg-accent', p.type === t && 'bg-accent font-medium')}>{PLAY_TYPE[t]}</button>)}</div>
      </div>
      <Section title={tt('The call')}>
        <Textarea rows={4} value={p.description} onChange={(e) => set({ description: e.target.value })} placeholder={tt('When to call it, the timing, the triggers, the variants if they stack…')} />
      </Section>
      <Section title={tt('Roles')}>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {p.roles.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-24 truncate text-xs text-muted-foreground">{team.players[i]?.name ?? tt('Player {0}', [i + 1])}</span>
              <Input className="h-8" value={r} onChange={(e) => set({ roles: p.roles.map((x, j) => (j === i ? e.target.value : x)) })} placeholder={tt('Role, position, utility')} />
            </div>
          ))}
        </div>
      </Section>
      <Section title={tt('Utility')} action={<button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => set({ utility: [...p.utility, { id: newLocalId(), label: '', setpos: '' }] })}>{tt('+ Add')}</button>}>
        <div className="space-y-1.5">
          {p.utility.map((u) => (
            <div key={u.id} className="flex items-center gap-1.5">
              <Input className="h-8 w-56" value={u.label} onChange={(e) => set({ utility: p.utility.map((x) => (x.id === u.id ? { ...x, label: e.target.value } : x)) })} placeholder={tt('Smoke CT from T spawn')} />
              <Input className="h-8 flex-1 font-mono text-[11px]" value={u.setpos} onChange={(e) => set({ utility: p.utility.map((x) => (x.id === u.id ? { ...x, setpos: e.target.value } : x)) })} placeholder={tt('setpos … ; setang … (copy it from Lineups)')} />
              {u.setpos && <CopySetpos get={() => u.setpos} />}
              <Button size="icon-xs" variant="ghost" aria-label={tt('Remove')} onClick={() => set({ utility: p.utility.filter((x) => x.id !== u.id) })}><X /></Button>
            </div>
          ))}
          {!p.utility.length && <p className="text-xs text-muted-foreground">{tt('Smokes, flashes and molotovs of the strat. Copy their setpos from Lineups & nade finder.')}</p>}
        </div>
      </Section>
      <Section title={tt('Boards')}>
        <div className="flex flex-wrap gap-1.5">
          {p.boardIds.map((id) => { const b = boards.find((x) => x.id === id); return b && (
            <span key={id} className="flex items-center gap-1 rounded-md border py-0.5 pr-1 pl-2 text-xs">
              <button type="button" className="flex items-center gap-1 hover:underline" onClick={() => navigate({ page: 'board', id })}><Presentation className="size-3" />{b.name || tt('Board')}</button>
              <button type="button" aria-label={tt('Unlink')} className="text-muted-foreground hover:text-foreground" onClick={() => set({ boardIds: p.boardIds.filter((x) => x !== id) })}><X className="size-3" /></button>
            </span>
          ); })}
          {mapBoards.filter((b) => !p.boardIds.includes(b.id)).length > 0 && (
            <select className="h-7 rounded-md border bg-transparent px-1.5 text-xs" value="" onChange={(e) => e.target.value && set({ boardIds: [...p.boardIds, e.target.value] })} aria-label={tt('Link a board')}>
              <option value="">{tt('+ Link a board of') + ' '}{mapDisplayName(p.map)}</option>
              {mapBoards.filter((b) => !p.boardIds.includes(b.id)).map((b) => <option key={b.id} value={b.id}>{b.name || tt('Board')}</option>)}
            </select>
          )}
          {!mapBoards.length && <span className="text-xs text-muted-foreground">{tt('No board on') + ' '}{mapDisplayName(p.map)} {tt('yet (Strategies → Boards, or “Board” in the replay).')}</span>}
        </div>
      </Section>
      <Section title={tt('Played in demos')}>
        <div className="space-y-1">
          {p.clips.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-xs">
              <Button size="icon-xs" variant="ghost" aria-label={tt('Open in the replay')} onClick={() => onOpenClip(c.demoId, c.round)}><PlayIcon /></Button>
              <span className="num text-muted-foreground">R{c.round + 1}</span>
              <span className="min-w-0 flex-1 truncate">{c.label || c.fileName}</span>
              <span className="truncate text-muted-foreground">{c.fileName}</span>
              <Button size="icon-xs" variant="ghost" aria-label={tt('Remove')} onClick={() => set({ clips: p.clips.filter((x) => x.id !== c.id) })}><X /></Button>
            </div>
          ))}
          {!p.clips.length && <p className="text-xs text-muted-foreground">{tt('In a replay, press Ctrl K → “Add this moment to the playbook” to keep the rounds where you played it.')}</p>}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 border-t pt-3">
      <div className="flex items-center justify-between"><h3 className="text-xs font-medium text-muted-foreground">{title}</h3>{action}</div>
      {children}
    </div>
  );
}
