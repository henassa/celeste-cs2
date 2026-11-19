// Palette de commandes (Ctrl+K) : aller à une page, un round, suivre un joueur, changer la disposition...

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { scoreCommand, useAllCommands, type Command } from '@/app/commands';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const all = useAllCommands();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setQ(''); setSel(0); } }, [open]);

  // « 12 » ou « r12 » : aller directement au round
  const results = useMemo(() => {
    const scored = all.map((c) => ({ c, s: scoreCommand(c, q) })).filter((x) => x.s > 0);
    if (q) scored.sort((a, b) => b.s - a.s);
    const direct = /^r?(\d{1,2})$/i.exec(q.trim());
    const goRound = direct ? all.find((c) => c.id === 'replay.goto-round') : undefined;
    const list: Command[] = scored.map((x) => x.c).slice(0, 60);
    if (goRound && direct) list.unshift({ ...goRound, id: 'replay.goto-round.n', title: tt('Go to round {0}', [direct[1]]), run: () => (goRound as Command & { runWith?: (n: number) => void }).runWith?.(Number(direct[1]) - 1) });
    return list;
  }, [all, q]);

  const run = (c: Command | undefined) => { if (!c) return; onOpenChange(false); setTimeout(() => c.run(), 0); };
  useEffect(() => { listRef.current?.querySelector(`[data-index="${sel}"]`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  let lastGroup = '';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl" data-testid="command-palette">
        <DialogTitle className="sr-only">{tt('Command palette')}</DialogTitle>
        <DialogDescription className="sr-only">{tt('Search pages, rounds, players and actions')}</DialogDescription>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-muted-foreground" />
          <input autoFocus value={q} placeholder={tt('Search pages, rounds, players, actions… (type 12 to go to round 12)')}
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); run(results[sel]); }
            }} />
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{tt('Nothing found.')}</p>}
          {results.map((c, i) => {
            const header = !q && c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">{header}</div>}
                <button type="button" data-index={i} onMouseMove={() => setSel(i)} onClick={() => run(c)}
                  className={cn('flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm', i === sel && 'bg-accent text-accent-foreground')}>
                  <span className="flex-1 truncate">{c.title}</span>
                  {q && <span className="text-[11px] text-muted-foreground">{c.group}</span>}
                  {c.shortcut && <Kbd>{c.shortcut}</Kbd>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> {tt('move')}</span><span><Kbd>{tt('Enter')}</Kbd> {tt('run')}</span><span><Kbd>{tt('Esc')}</Kbd> {tt('close')}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
