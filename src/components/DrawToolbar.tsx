// Barre d'outils de dessin, flottante sur le radar et sur la vue 3D : outils avec leur raccourci,
// couleurs et épaisseurs visibles d'un coup d'œil, durée d'affichage, annuler / rétablir / effacer,
// et un rappel des gestes pendant le dessin.

import { Circle, Eraser, MousePointer2, MoveUpRight, Pencil, Redo2, Slash, Square, Timer, Trash2, Type, Undo2, X } from 'lucide-react';
import { useState } from 'react';
import { useNarrow } from '@/app/use-narrow';
import type { ScrimStore } from '@/scrim/store';
import { useScrim } from '@/scrim/store';
import { ANNOTATION_COLORS, type Tool } from '@/scrim/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

const TOOLS: { id: Tool; label: string; key: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'select', label: tt('Select / pan'), key: 'V', icon: MousePointer2 },
  { id: 'pen', label: tt('Pen'), key: 'B', icon: Pencil },
  { id: 'arrow', label: tt('Arrow'), key: 'A', icon: MoveUpRight },
  { id: 'line', label: tt('Straight line'), key: 'S', icon: Slash },
  { id: 'circle', label: tt('Circle'), key: 'O', icon: Circle },
  { id: 'rect', label: tt('Rectangle'), key: 'R', icon: Square },
  { id: 'text', label: tt('Text'), key: 'I', icon: Type },
  { id: 'eraser', label: tt('Eraser'), key: 'X', icon: Eraser },
];

const WIDTHS = [2, 3, 5];
const HINTS: Partial<Record<Tool, string>> = {
  pen: 'Shift: straight line',
  arrow: 'Shift: 45° steps',
  line: 'Shift: 45° steps',
  circle: 'Drag from the center',
  rect: 'Shift: square',
  text: tt('Click where the text goes, Enter to place'),
  eraser: 'Click or drag over a drawing',
};

function ToolButton({ active, label, shortcut, onClick, children, disabled }: { active?: boolean; label: string; shortcut?: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          aria-label={shortcut ? `${label} (${shortcut})` : label}
          aria-pressed={active}
          className={cn(
            'relative flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4',
            active && 'bg-foreground text-background hover:bg-foreground hover:text-background',
          )}
        >
          {children}
          {shortcut && <span className={cn('pointer-events-none absolute right-0.5 bottom-0 font-mono text-[8px] leading-none opacity-60', active && 'opacity-80')}>{shortcut}</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}{shortcut && <span className="ml-1.5 font-mono opacity-70">{shortcut}</span>}</TooltipContent>
    </Tooltip>
  );
}

export function DrawToolbar({ scrim, round }: { scrim: ScrimStore; round: number }) {
  useScrim(scrim);
  const tool = scrim.tool;
  const drawing = tool !== 'select';
  const current = TOOLS.find((t) => t.id === tool);
  // Sur téléphone : outils repliés derrière un bouton, pour laisser le radar visible
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  if (narrow && !open) return (
    <button type="button" onClick={() => setOpen(true)} aria-label={tt('Drawing tools')} data-testid="draw-toolbar-open"
      className="absolute top-12 left-2 z-10 flex size-9 items-center justify-center rounded-lg border bg-overlay shadow-sm backdrop-blur-sm"><Pencil className="size-4" /></button>
  );
  return (
    <>
      {narrow && <button type="button" onClick={() => { setOpen(false); scrim.setTool('select'); }} aria-label={tt('Hide drawing tools')}
        className="absolute top-12 left-2 z-20 flex size-9 items-center justify-center rounded-lg border bg-overlay shadow-sm backdrop-blur-sm"><X className="size-4" /></button>}
      <div className="absolute top-1/2 left-3 z-10 grid max-h-[calc(100%-1.5rem)] -translate-y-1/2 grid-cols-2 justify-items-center gap-0.5 overflow-y-auto rounded-lg border bg-overlay p-1 shadow-sm backdrop-blur-sm" data-testid="draw-toolbar">
        {TOOLS.map((t) => (
          <ToolButton key={t.id} active={tool === t.id} label={t.label} shortcut={t.key} onClick={() => scrim.setTool(tool === t.id && t.id !== 'select' ? 'select' : t.id)}>
            <t.icon />
          </ToolButton>
        ))}
        <div className="col-span-2 my-1 h-px w-full bg-border" />
        {/* Couleurs : toutes visibles, un clic suffit */}
        <div className="col-span-2 grid grid-cols-2 gap-0.5">
          {ANNOTATION_COLORS.map((c) => (
            <button key={c} onClick={() => scrim.setColor(c)} aria-label={tt('Color {0}', [c])} aria-pressed={scrim.color === c}
              className={cn('flex size-8 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50', scrim.color === c && 'bg-accent')}>
              <span className={cn('size-3.5 rounded-full ring-1 ring-white/20', scrim.color === c && 'size-4 ring-2 ring-white/90')} style={{ background: c }} />
            </button>
          ))}
        </div>
        <div className="col-span-2 my-1 h-px w-full bg-border" />
        {WIDTHS.map((w) => (
          <ToolButton key={w} active={scrim.width === w} label={tt('Stroke width {0}', [w])} onClick={() => scrim.setWidth(w)}>
            <span className="rounded-full bg-current" style={{ width: w + 3, height: w + 3 }} />
          </ToolButton>
        ))}
        <ToolButton
          active={scrim.visibility === '5s'}
          label={scrim.visibility === '5s' ? tt('New drawings stay 5 s (click: until round end)') : tt('New drawings stay until round end (click: 5 s)')}
          onClick={() => scrim.setVisibility(scrim.visibility === '5s' ? 'round' : '5s')}
        >
          <Timer />
        </ToolButton>
        <div className="col-span-2 my-1 h-px w-full bg-border" />
        <ToolButton label={tt('Undo')} shortcut="⌃Z" onClick={() => scrim.undo()} disabled={!scrim.canUndo}><Undo2 /></ToolButton>
        <ToolButton label={tt('Redo')} shortcut="⌃⇧Z" onClick={() => scrim.redo()} disabled={!scrim.canRedo}><Redo2 /></ToolButton>
        <ToolButton label={tt('Clear the drawings of this round')} onClick={() => scrim.clearRound(round)}
          disabled={!scrim.doc.annotations.some((a) => a.round === round)}><Trash2 /></ToolButton>
        <span />
      </div>
      {/* Rappel des gestes de l'outil en cours */}
      {drawing && current && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-7rem)] -translate-x-1/2 items-center gap-1.5 truncate rounded-full border bg-overlay px-3 py-1 text-[11px] whitespace-nowrap text-muted-foreground shadow-sm backdrop-blur-sm" data-testid="draw-hint">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: scrim.color }} />
          <span className="font-medium text-foreground">{current.label}</span>
          {HINTS[tool] && <span>· {HINTS[tool]}</span>}
          <span>{tt('· Right-click cancels · Esc stops')}</span>
        </div>
      )}
    </>
  );
}

export function TextInputOverlay({ scrim }: { scrim: ScrimStore }) {
  useScrim(scrim);
  const p = scrim.pendingText;
  if (!p) return null;
  return (
    <input
      autoFocus
      placeholder={tt('Type, Enter to place')}
      className="absolute z-10 h-7 w-56 -translate-y-1/2 rounded-md border bg-overlay px-2 text-sm text-overlay-foreground shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      style={{ left: p.sx, top: p.sy, color: scrim.color }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') scrim.commitText(e.currentTarget.value);
        if (e.key === 'Escape') scrim.commitText('');
      }}
      onBlur={(e) => scrim.commitText(e.currentTarget.value)}
    />
  );
}
