// Panneau Notes : notes du round, marqueurs de la timeline, dessins, export / import du fichier .scrim.

import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Flag, ListPlus, Play, Trash2, Upload, X } from 'lucide-react';
import type { Playback } from '@/viewer/playback';
import { formatClock, roundClock } from '@/viewer/sample';
import { useScrim, type ScrimStore } from '@/scrim/store';
import { parseScrimFile } from '@/scrim/storage';
import type { ScrimDoc } from '@/scrim/types';
import { downloadBlob, safeName } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

interface Props {
  pb: Playback;
  scrim: ScrimStore;
  roundIndex: number;
  onClose: () => void;
  /** Lance la playlist à partir de l'extrait donné. */
  onPlayPlaylist: (from: number) => void;
}

const SAVE_LABEL = { idle: 'Not saved yet', saving: 'Saving…', saved: 'Saved in this browser', memory: 'Not saved (storage unavailable)' };

export function NotesPanel({ pb, scrim, roundIndex, onClose, onPlayPlaylist }: Props) {
  useScrim(scrim);
  const m = pb.match;
  const round = m.rounds[roundIndex];
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<{ doc: ScrimDoc; mismatch: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drawings = scrim.doc.annotations.filter((a) => a.round === roundIndex).length;

  const timeLabel = (tick: number, ri: number) => {
    const r = m.rounds[ri];
    return r ? formatClock(roundClock(m, r, tick).remaining) : '';
  };

  const exportFile = () => {
    const blob = new Blob([JSON.stringify(scrim.doc, null, 1)], { type: 'application/json' });
    downloadBlob(blob, safeName(`${m.header.map}_${m.teams[0].name}_vs_${m.teams[1].name}`) + '.scrim');
  };

  const onImport = async (f: File) => {
    setError(null);
    try {
      const doc = parseScrimFile(await f.text());
      setImporting({ doc, mismatch: doc.demo.id !== scrim.doc.demo.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="text-sm font-medium">{tt('Notes')}</span>
        <span className="text-xs text-muted-foreground">{SAVE_LABEL[scrim.saveState]}</span>
        <span className="flex-1" />
        <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label={tt('Close notes')}><X /></Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto border-t px-4 py-4">
        {/* Notes du round */}
        <section className="space-y-2">
          <Label htmlFor="round-note">{tt('Round') + ' '}{round?.number ?? '-'}</Label>
          <Textarea
            id="round-note"
            key={roundIndex}
            placeholder={tt('What happened, what to fix…')}
            defaultValue={scrim.doc.roundNotes[(round?.number ?? 0)] ?? ''}
            onChange={(e) => round && scrim.setRoundNote(round.number, e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className="min-h-24 resize-y text-sm"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{drawings} {tt('drawing')}{drawings === 1 ? '' : 's'} {tt('in this round')}</span>
            {drawings > 0 && (
              <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => scrim.clearRound(roundIndex)}>
                <Trash2 className="size-3" /> {tt('Clear')}
              </button>
            )}
          </div>
        </section>

        {/* Marqueurs */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{tt('Markers')}</Label>
            <Button size="xs" variant="outline" onClick={() => scrim.addMarker(pb.get().tick, roundIndex)}>
              <Flag /> {tt('Add (M)')}
            </Button>
          </div>
          {scrim.doc.markers.length === 0 ? (
            <p className="text-xs text-muted-foreground">{tt('Mark key moments to jump back to them and share them with your team.')}</p>
          ) : (
            <ul className="space-y-1">
              {scrim.doc.markers.map((mk) => (
                <li key={mk.id} className={cn('group flex items-center gap-1 rounded-md pr-1', mk.round === roundIndex && 'bg-accent/40')}>
                  <button
                    className="num shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => pb.set({ tick: mk.tick, playing: false })}
                    title={tt('Go to marker')}
                  >
                    R{mk.round + 1} {timeLabel(mk.tick, mk.round)}
                  </button>
                  <Input
                    defaultValue={mk.label}
                    onBlur={(e) => e.target.value !== mk.label && scrim.renameMarker(mk.id, e.target.value)}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); }}
                    className="h-7 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-input dark:bg-transparent"
                  />
                  <button className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
                    onClick={() => scrim.removeMarker(mk.id)} aria-label={tt('Delete marker')}>
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Playlist */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{tt('Playlist')}</Label>
            <div className="flex gap-1">
              {scrim.playlist.length > 0 && <Button size="xs" variant="outline" onClick={() => onPlayPlaylist(0)}><Play /> {tt('Play all')}</Button>}
              <Button size="xs" variant="outline" disabled={!round} title={tt('Add from the current moment to the end of the round')} onClick={() => {
                if (!round) return;
                const t = pb.get().tick;
                const from = t < round.freezeEndTick ? round.freezeEndTick - 3 * m.tickrate : t;
                scrim.addClip(roundIndex, from, round.endTick + 2 * m.tickrate, `Round ${round.number} · ${t < round.freezeEndTick ? 'full round' : `from ${timeLabel(from, roundIndex)}`}`);
              }}><ListPlus /> {tt('Add')}</Button>
            </div>
          </div>
          {scrim.playlist.length === 0 ? (
            <p className="text-xs text-muted-foreground">{tt('Queue up moments to review in order: Add takes the current moment to the end of the round.')}</p>
          ) : (
            <ol className="space-y-1">
              {scrim.playlist.map((c, i) => (
                <li key={c.id} className={cn('group flex items-center gap-1 rounded-md pr-1', c.round === roundIndex && 'bg-accent/40')}>
                  <button className="num shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground" title={tt('Play from here')} onClick={() => onPlayPlaylist(i)}>
                    {i + 1}.
                  </button>
                  <Input
                    defaultValue={c.label}
                    onBlur={(e) => e.target.value !== c.label && scrim.renameClip(c.id, e.target.value)}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); }}
                    className="h-7 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-input dark:bg-transparent"
                  />
                  <span className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    <button className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === 0} onClick={() => scrim.moveClip(c.id, -1)} aria-label={tt('Move up')}><ArrowUp className="size-3.5" /></button>
                    <button className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === scrim.playlist.length - 1} onClick={() => scrim.moveClip(c.id, 1)} aria-label={tt('Move down')}><ArrowDown className="size-3.5" /></button>
                    <button className="text-muted-foreground hover:text-foreground" onClick={() => scrim.removeClip(c.id)} aria-label={tt('Remove from playlist')}><X className="size-3.5" /></button>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* Partage */}
      <div className="space-y-2 border-t px-4 py-3">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={exportFile}><Download /> {tt('Export .scrim')}</Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => fileInput.current?.click()}><Upload /> {tt('Import')}</Button>
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {tt('Notes stay in this browser. Send the .scrim file to your team: they open the same demo and import it.')}
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <input ref={fileInput} type="file" accept=".scrim,.json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
      </div>

      <Dialog open={!!importing} onOpenChange={(o) => !o && setImporting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tt('Import notes')}</DialogTitle>
            <DialogDescription>
              {importing?.doc.annotations.length ?? 0} {tt('drawings,') + ' '}{importing?.doc.markers.length ?? 0} {tt('markers,')}{' '}
              {Object.keys(importing?.doc.roundNotes ?? {}).length} {tt('round notes,') + ' '}{importing?.doc.playlist?.length ?? 0} {tt('playlist clips from') + ' '}{importing?.doc.demo.fileName}.
              {importing?.mismatch && ' This file was made for a different demo: drawings may not line up.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { if (importing) scrim.importDoc(importing.doc, 'replace'); setImporting(null); }}>{tt('Replace mine')}</Button>
            <Button onClick={() => { if (importing) scrim.importDoc(importing.doc, 'merge'); setImporting(null); }}>{tt('Merge')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
