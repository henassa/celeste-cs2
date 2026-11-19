// Poignée de redimensionnement entre deux colonnes (glisser ; double-clic : largeur par défaut).

import { useRef } from 'react';
import { cn } from '@/lib/utils';

export function ResizeHandle({ onResize, onReset, invert = false, label }: { onResize: (dx: number) => void; onReset?: () => void; invert?: boolean; label: string }) {
  const last = useRef<number | null>(null);
  return (
    <div role="separator" aria-orientation="vertical" aria-label={label} tabIndex={0}
      className={cn('group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none outline-none')}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); last.current = e.clientX; document.body.style.cursor = 'col-resize'; }}
      onPointerMove={(e) => { if (last.current === null) return; const dx = e.clientX - last.current; last.current = e.clientX; if (dx) onResize(invert ? -dx : dx); }}
      onPointerUp={() => { last.current = null; document.body.style.cursor = ''; }}
      onDoubleClick={onReset}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') onResize(invert ? 16 : -16); if (e.key === 'ArrowRight') onResize(invert ? -16 : 16); }}>
      <div className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-ring group-focus-visible:bg-ring group-active:bg-ring" />
    </div>
  );
}
