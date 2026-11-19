// Menu de disposition du replay : préréglages, panneaux affichés, dispositions enregistrées.

import { useEffect, useRef, useState } from 'react';
import { Check, LayoutPanelLeft, Trash2 } from 'lucide-react';
import { applyPreset, deleteCustomLayout, setPresentation, LAYOUT_PRESETS, loadCustomLayouts, saveCustomLayout, setLayout, useLayout, type ReplayLayout } from '@/app/layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { COLOR_SWATCHES, DEFAULT_A, DEFAULT_B, setTeamColors, useTeamColors } from '@/app/team-colors';
import { tt } from '@/i18n';

export function LayoutMenu() {
  const l = useLayout();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(loadCustomLayouts);
  const [name, setName] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  const Check2 = ({ k, label }: { k: keyof ReplayLayout; label: string }) => (
    <button type="button" onClick={() => setLayout({ [k]: !l[k] } as Partial<ReplayLayout>)} className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent">
      <span className={cn('flex size-3.5 items-center justify-center rounded-sm border', l[k] && 'bg-foreground text-background')}>{l[k] && <Check className="size-2.5" />}</span>{label}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="layout-menu"><LayoutPanelLeft /> {tt('Layout')}</Button>
      {open && (
        <div className="absolute top-full right-0 z-50 mt-1 w-64 space-y-2 rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg">
          <div className="px-2 pt-1 text-[11px] font-medium text-muted-foreground">{tt('Presets')}</div>
          <div className="grid grid-cols-2 gap-1">
            {LAYOUT_PRESETS.map((p) => (
              <button key={p.id} type="button" title={p.hint} onClick={() => applyPreset(p.layout)} className="rounded-md border px-2 py-1.5 text-left text-xs hover:bg-accent">
                <div className="font-medium">{p.label}</div><div className="truncate text-[10px] text-muted-foreground">{p.hint}</div>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { setOpen(false); setPresentation({ on: true }); }} className="w-full rounded-md border px-2 py-1.5 text-left text-xs hover:bg-accent" data-testid="present">
            <div className="font-medium">{tt('Presentation mode') + ' '}<span className="text-muted-foreground">(P)</span></div><div className="text-[10px] text-muted-foreground">{tt('Broadcast look for streaming a review, keyboard only')}</div>
          </button>
          <div className="border-t pt-1">
            <Check2 k="left" label={tt('Left team panel')} />
            <Check2 k="right" label={tt('Right team panel')} />
            <Check2 k="killfeed" label={tt('Kill feed')} />
            <Check2 k="winCurve" label={tt('Win-probability curve')} />
            <Check2 k="timeline" label={tt('Timeline')} />
            <button type="button" onClick={() => setLayout({ dockSide: l.dockSide === 'right' ? 'left' : 'right' })} className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-accent">
              {tt('Side panel on the') + ' '}{l.dockSide === 'right' ? 'left' : 'right'}
            </button>
          </div>
          <PlayerColors />
          <div className="space-y-1 border-t pt-2">
            <div className="px-2 text-[11px] font-medium text-muted-foreground">{tt('My layouts')}</div>
            {custom.map((c) => (
              <div key={c.name} className="flex items-center gap-1">
                <button type="button" onClick={() => applyPreset(c.layout)} className="h-7 flex-1 truncate rounded px-2 text-left text-xs hover:bg-accent">{c.name}</button>
                <Button size="icon-xs" variant="ghost" aria-label={tt('Delete {0}', [c.name])} onClick={() => setCustom(deleteCustomLayout(c.name))}><Trash2 /></Button>
              </div>
            ))}
            <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { setCustom(saveCustomLayout(name.trim())); setName(''); } }}>
              <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder={tt('Save current as…')} className="h-7 text-xs" />
              <Button size="sm" type="submit" variant="outline" className="h-7" disabled={!name.trim()}>{tt('Save')}</Button>
            </form>
          </div>
          <p className="px-2 text-[10px] text-muted-foreground">{tt('Drag the edges between panels to resize them; double-click an edge to reset.')}</p>
        </div>
      )}
    </div>
  );
}

/** Couleurs des joueurs : par camp (CT / T) ou par équipe (garde sa couleur à la mi-temps). */
export function PlayerColors() {
  const c = useTeamColors();
  const team = c.by === 'team';
  const row = (which: 'a' | 'b', label: string, def: string) => {
    const value = c[which] ?? def;
    return (
      <div className="space-y-1">
        <div className="px-2 text-[11px] text-muted-foreground">{label}</div>
        <div className="flex flex-wrap gap-1 px-2">
          {COLOR_SWATCHES.map((hex) => (
            <button key={hex} type="button" onClick={() => setTeamColors({ [which]: hex === def && !team ? null : hex })} aria-label={`${label}: ${hex}`} aria-pressed={value === hex}
              className={cn('size-5 rounded-full border border-white/15 outline-none focus-visible:ring-2 focus-visible:ring-ring', value === hex && 'ring-2 ring-foreground ring-offset-1 ring-offset-popover')}
              style={{ background: hex }} />
          ))}
        </div>
      </div>
    );
  };
  return (
    <div className="space-y-2 border-t pt-2" data-testid="player-colors">
      <div className="flex items-center justify-between px-2">
        <span className="text-[11px] font-medium text-muted-foreground">{tt('Player colors')}</span>
        {(c.a || c.b || team) && <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setTeamColors({ by: 'side', a: null, b: null })}>{tt('Reset')}</button>}
      </div>
      <div className="grid grid-cols-2 gap-1 px-2">
        {(['side', 'team'] as const).map((by) => (
          <button key={by} type="button" onClick={() => setTeamColors({ by })} aria-pressed={c.by === by}
            className={cn('rounded-md border px-2 py-1 text-xs hover:bg-accent', c.by === by && 'bg-accent font-medium')}>
            {by === 'side' ? tt('By side') : tt('By team')}
          </button>
        ))}
      </div>
      {row('a', team ? tt('Team 1 (left)') : 'CT', DEFAULT_A)}
      {row('b', team ? tt('Team 2 (right)') : 'T', DEFAULT_B)}
      <p className="px-2 text-[10px] text-muted-foreground">{team ? tt('Each team keeps its color after the side switch.') : tt('Colors follow the side: they swap teams at half-time.')}</p>
    </div>
  );
}
