// Barre de la file de lecture, en bas du radar : passage en cours, précédent / suivant.

import { ChevronLeft, ChevronRight, ListVideo, X } from 'lucide-react';
import type { QueueState } from '@/viewer/queue';
import { Button } from '@/components/ui/button';
import { tt } from '@/i18n';

export function QueueBar({ queue, onGo, onClose }: { queue: QueueState; onGo: (i: number) => void; onClose: () => void }) {
  const it = queue.items[queue.index];
  if (!it) return null;
  return (
    <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md border bg-overlay py-0.5 pr-0.5 pl-2.5 text-xs text-overlay-foreground shadow-sm backdrop-blur-sm"
      data-testid="queue-bar">
      <ListVideo className="size-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">{queue.title}</span>
      <span className="num">{queue.index + 1}/{queue.items.length}</span>
      <span className="max-w-56 truncate font-medium">{it.label}</span>
      <Button size="icon-xs" variant="ghost" aria-label={tt('Previous in queue')} disabled={queue.index === 0} onClick={() => onGo(queue.index - 1)}><ChevronLeft /></Button>
      <Button size="icon-xs" variant="ghost" aria-label={tt('Next in queue')} disabled={queue.index >= queue.items.length - 1} onClick={() => onGo(queue.index + 1)}><ChevronRight /></Button>
      <Button size="icon-xs" variant="ghost" aria-label={tt('Stop queue')} onClick={onClose}><X /></Button>
    </div>
  );
}
