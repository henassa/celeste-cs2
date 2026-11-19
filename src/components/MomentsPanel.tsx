// Panneau Moments : moments clés détectés automatiquement, filtrables ; un clic relance le replay
// quelques secondes avant.

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { Playback } from '@/viewer/playback';
import { detectMoments, MOMENT_LABEL, type MomentKind } from '@/stats/moments';
import { loadModels } from '@/calib/model';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

export function MomentsPanel({ pb, roundIndex, onClose }: { pb: Playback; roundIndex: number; onClose: () => void }) {
  const m = pb.match;
  const moments = useMemo(() => detectMoments(m, loadModels().hltv3?.wp ?? null), [m]);
  const kinds = useMemo(() => [...new Set(moments.map((x) => x.kind))], [moments]);
  const [off, setOff] = useState<Set<MomentKind>>(new Set());
  const list = moments.filter((x) => !off.has(x.kind));
  const sideCls = (team: number | null, round: number) => (team === null ? '' : m.rounds[round]?.ctTeam === team ? 'text-side-ct' : 'text-side-t');

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground" data-testid="moments-panel">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="text-sm font-medium">{tt('Moments')}</span>
        <span className="text-xs text-muted-foreground">{list.length} {tt('found')}</span>
        <span className="flex-1" />
        <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label={tt('Close moments')}><X /></Button>
      </div>
      <div className="flex flex-wrap gap-1 border-t px-4 py-2">
        {kinds.map((k) => (
          <button key={k} onClick={() => setOff((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
            className={cn('rounded-md border px-1.5 py-0.5 text-[11px]', off.has(k) ? 'text-muted-foreground line-through' : 'bg-accent text-foreground')}>
            {MOMENT_LABEL[k]} <span className="num text-muted-foreground">{moments.filter((x) => x.kind === k).length}</span>
          </button>
        ))}
      </div>
      <ol className="min-h-0 flex-1 space-y-0.5 overflow-y-auto border-t px-2 py-2">
        {list.map((x, i) => (
          <li key={i}>
            <button onClick={() => pb.jumpBefore(x.tick, x.kind === 'eco' ? 0 : 4)}
              className={cn('flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent', x.round === roundIndex && 'bg-accent/40')}>
              <span className="num w-7 shrink-0 text-muted-foreground">R{x.round + 1}</span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-[10px] tracking-wide uppercase', sideCls(x.team, x.round) || 'text-muted-foreground')}>{MOMENT_LABEL[x.kind]}</span>
                <span className="block">{x.title}</span>
              </span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="px-2 text-xs text-muted-foreground">{tt('No moment for these filters.')}</li>}
      </ol>
      <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{tt('Click a moment to replay it from a few seconds before.')}</p>
    </div>
  );
}
