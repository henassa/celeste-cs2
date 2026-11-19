// Rappel des zones posées par le coach (légende + effacer), affiché sur la carte concernée.

import { X } from 'lucide-react';
import { setZones, useZones, ZONE_COLOR } from '@/app/zones';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

export function ZonesChip({ map, className }: { map: string; className?: string }) {
  const z = useZones();
  if (!z || z.map !== map) return null;
  const kinds = [...new Set(z.zones.map((x) => x.kind))];
  return (
    <div className={cn('pointer-events-auto flex items-center gap-2 rounded-md border bg-overlay px-2 py-1 text-[11px] text-overlay-foreground backdrop-blur-sm', className)} data-testid="zones-chip">
      <span className="font-medium">{z.title}</span>
      {kinds.map((k) => <span key={k} className="flex items-center gap-1 text-muted-foreground"><span className="size-2 rounded-full" style={{ background: ZONE_COLOR[k] }} />{k === 'strong' ? 'strong' : k === 'weak' ? 'weak' : 'note'}</span>)}
      <button type="button" aria-label={tt('Clear the coach zones')} className="rounded p-0.5 hover:bg-accent" onClick={() => setZones(null)}><X className="size-3" /></button>
    </div>
  );
}
