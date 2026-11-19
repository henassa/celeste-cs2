// Reviews : toutes les sessions de review (notes de rounds, marqueurs, dessins, playlists) de toutes les
// démos, des plus récentes aux plus anciennes, avec la VOD liée. Un clic rouvre la démo au bon round.

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Flag, ListVideo, NotebookPen, Pencil, Play, Search, Tv } from 'lucide-react';
import { idbEntries, STORES } from '@/lib/idb';
import { inActiveScope } from '@/app/profiles';
import type { ScrimDoc } from '@/scrim/types';
import { vodStore } from '@/app/vod';
import { mapDisplayName } from '@/maps/maps';
import { downloadBlob, safeName } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { locale, tt } from '@/i18n';

const notesOf = (d: ScrimDoc) => Object.entries(d.roundNotes ?? {}).filter(([, t]) => t.trim());

export function ReviewsPage({ onOpen }: { onOpen: (demoId: string, round: number) => void }) {
  const [docs, setDocs] = useState<ScrimDoc[] | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const vods = vodStore.use();
  useEffect(() => { idbEntries<ScrimDoc>(STORES.scrims).then((e) => setDocs(e.filter(([k]) => inActiveScope(k)).map(([, d]) => d))).catch(() => setDocs([])); }, []);

  const list = useMemo(() => (docs ?? [])
    .filter((d) => d.annotations.length || d.markers.length || notesOf(d).length || d.playlist?.length || vods[d.demo.id])
    .filter((d) => !q || `${d.demo.fileName} ${d.demo.map} ${notesOf(d).map(([, t]) => t).join(' ')} ${d.markers.map((m) => m.label).join(' ')}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt), [docs, q, vods]);

  return (
    <div className="h-full overflow-y-auto p-6" data-testid="reviews">
      <div className="mx-auto max-w-4xl space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1"><h1 className="text-lg font-semibold">{tt('Reviews')}</h1><p className="text-sm text-muted-foreground">{tt('Every review session: round notes, markers, drawings, playlists and the linked VOD, across all your demos.')}</p></div>
        </div>
        <div className="relative"><Search className="absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" /><Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tt('Search notes, markers, demos')} /></div>
        {docs === null && <p className="text-sm text-muted-foreground">{tt('Loading…')}</p>}
        {docs !== null && !list.length && <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{q ? tt('Nothing matches.') : tt('No review yet. In a replay, write round notes (Notes panel), press M for a marker, draw on the radar or queue moments in a playlist: each demo becomes a review session here.')}</p>}
        {list.map((d) => {
          const notes = notesOf(d), expanded = open === d.demo.id;
          const first = d.markers[0]?.round ?? (notes[0] ? Number(notes[0][0]) - 1 : 0);
          return (
            <div key={d.demo.id} className="rounded-xl border bg-card">
              <div className="flex items-center gap-3 p-3">
                <button type="button" aria-label={expanded ? tt('Collapse') : tt('Expand')} className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(expanded ? null : d.demo.id)}>{expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{mapDisplayName(d.demo.map)} <span className="font-normal text-muted-foreground">· {d.demo.fileName}</span></div>
                  <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span>{tt('Edited') + ' '}{new Date(d.updatedAt).toLocaleDateString(locale)}</span>
                    {notes.length > 0 && <span className="flex items-center gap-1"><NotebookPen className="size-3" />{notes.length} {tt('note')}{notes.length === 1 ? '' : 's'}</span>}
                    {d.markers.length > 0 && <span className="flex items-center gap-1"><Flag className="size-3" />{d.markers.length}</span>}
                    {d.annotations.length > 0 && <span className="flex items-center gap-1"><Pencil className="size-3" />{d.annotations.length}</span>}
                    {(d.playlist?.length ?? 0) > 0 && <span className="flex items-center gap-1"><ListVideo className="size-3" />{d.playlist!.length}</span>}
                    {vods[d.demo.id] && <span className="flex items-center gap-1"><Tv className="size-3" />{tt('VOD')}</span>}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => onOpen(d.demo.id, first)}><Play /> {tt('Open')}</Button>
                <Button size="icon-sm" variant="ghost" aria-label={tt('Export the .scrim file')} title={tt('Export the .scrim file (share with your team)')}
                  onClick={() => downloadBlob(new Blob([JSON.stringify(d)], { type: 'application/json' }), safeName(d.demo.fileName.replace(/\.dem.*$/, '')) + '.scrim')}><Download /></Button>
              </div>
              {expanded && (
                <div className={cn('space-y-2 border-t p-3 text-xs')}>
                  {notes.sort((a, b) => Number(a[0]) - Number(b[0])).map(([r, t]) => (
                    <button key={r} type="button" className="flex w-full gap-2 rounded-md p-1 text-left hover:bg-accent" onClick={() => onOpen(d.demo.id, Number(r) - 1)}>
                      <span className="num w-8 shrink-0 text-muted-foreground">R{r}</span><span className="whitespace-pre-wrap">{t}</span>
                    </button>
                  ))}
                  {d.markers.map((m) => (
                    <button key={m.id} type="button" className="flex w-full gap-2 rounded-md p-1 text-left hover:bg-accent" onClick={() => onOpen(d.demo.id, m.round)}>
                      <span className="num w-8 shrink-0 text-muted-foreground">R{m.round + 1}</span><Flag className="size-3 shrink-0 text-muted-foreground" /><span>{m.label || tt('Marker')}</span>
                    </button>
                  ))}
                  {vods[d.demo.id] && <a className="flex items-center gap-1 text-muted-foreground hover:text-foreground" href={vods[d.demo.id].url} target="_blank" rel="noreferrer"><Tv className="size-3" />{vods[d.demo.id].url}</a>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
