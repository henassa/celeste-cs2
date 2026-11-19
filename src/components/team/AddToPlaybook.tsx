// Depuis le replay : garder le moment affiché dans une stratégie du playbook (existante ou nouvelle).

import { useState } from 'react';
import { addClip, newPlay, PLAY_TYPE, playbookStore, savePlay } from '@/app/playbook';
import { mapDisplayName } from '@/maps/maps';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

interface Moment { demoId: string; fileName: string; map: string; round: number; tick: number; side: 'ct' | 't' }

export function AddToPlaybookDialog({ open, onOpenChange, moment }: { open: boolean; onOpenChange: (o: boolean) => void; moment: Moment }) {
  const plays = playbookStore.use().filter((p) => p.map === moment.map);
  const [label, setLabel] = useState('');
  const [name, setName] = useState('');
  const [side, setSide] = useState<'ct' | 't'>(moment.side);
  const [done, setDone] = useState<string | null>(null);
  const add = (playId: string) => {
    addClip(playId, { demoId: moment.demoId, fileName: moment.fileName, round: moment.round, tick: moment.tick, label: label.trim() });
    setDone(playId);
    setTimeout(() => { setDone(null); onOpenChange(false); }, 700);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="add-to-playbook">
        <DialogHeader>
          <DialogTitle>{tt('Add round') + ' '}{moment.round + 1} {tt('to the playbook')}</DialogTitle>
          <DialogDescription>{mapDisplayName(moment.map)} {tt('· pick the strat it shows, or create it.')}</DialogDescription>
        </DialogHeader>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={tt('Note on this moment (optional): e.g. good timing, they stacked B')} />
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {plays.map((p) => (
            <button key={p.id} type="button" onClick={() => add(p.id)} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent', done === p.id && 'bg-accent')}>
              <span className="w-6 text-[10px] font-semibold text-muted-foreground">{p.side.toUpperCase()}</span>
              <span className="min-w-0 flex-1 truncate">{p.name || tt('Untitled')} <span className="text-xs text-muted-foreground">· {PLAY_TYPE[p.type]}</span></span>
              {done === p.id ? <span className="text-xs">{tt('Added')}</span> : <span className="num text-xs text-muted-foreground">{p.clips.length}▶</span>}
            </button>
          ))}
          {!plays.length && <p className="px-2 py-1 text-xs text-muted-foreground">{tt('No strat on') + ' '}{mapDisplayName(moment.map)} {tt('yet.')}</p>}
        </div>
        <form className="flex gap-1.5 border-t pt-3" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; const p = { ...newPlay(moment.map, side), name: name.trim() }; savePlay(p); add(p.id); setName(''); }}>
          <div className="flex overflow-hidden rounded-md border">{(['t', 'ct'] as const).map((s) => <button key={s} type="button" onClick={() => setSide(s)} className={cn('px-2 text-xs', side === s && 'bg-accent font-medium')}>{s.toUpperCase()}</button>)}</div>
          <Input className="flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder={tt('New strat name')} />
          <Button type="submit" size="sm" disabled={!name.trim()}>{tt('Create + add')}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
