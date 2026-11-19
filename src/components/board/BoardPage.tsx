// Page du tableau tactique : étapes à gauche, radar au centre (placer, déplacer, dessiner),
// note de l'étape à droite. Lecture animée des étapes, export PNG et fichier .board.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowDown, ArrowUp, Download, Eraser, ImageDown, Minus, MousePointer2, MoveUpRight, Pause, Pencil, Play, Plus, Redo2, Trash2, Undo2, X,
} from 'lucide-react';
import { BoardStore, useBoard } from '@/board/store';
import { drawBoard, tokenAt } from '@/board/draw';
import { BOARD_COLORS, type Board, type BoardTool } from '@/board/types';
import { getMap, mapDisplayName, radarUrl, RADAR_SIZE } from '@/maps/maps';
import { readRenderTheme } from '@/viewer/theme';
import { downloadBlob, safeName } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

const STEP_MS = 1400;

const TOOLS: { id: BoardTool; label: string; key: string; icon?: React.ReactNode; text?: string }[] = [
  { id: 'select', label: tt('Move'), key: 'V', icon: <MousePointer2 /> },
  { id: 'ct', label: tt('CT player'), key: 'C', text: 'CT' },
  { id: 't', label: tt('T player'), key: 'T', text: 'T' },
  { id: 'smoke', label: tt('Smoke'), key: 'S', text: tt('Smk') },
  { id: 'molotov', label: tt('Molotov'), key: 'M', text: tt('Mol') },
  { id: 'flash', label: tt('Flash'), key: 'F', text: tt('Fl') },
  { id: 'he', label: tt('HE grenade'), key: 'H', text: 'HE' },
  { id: 'bomb', label: tt('Bomb'), key: 'B', text: 'C4' },
  { id: 'arrow', label: tt('Arrow'), key: 'A', icon: <MoveUpRight /> },
  { id: 'line', label: tt('Line'), key: 'L', icon: <Minus /> },
  { id: 'pen', label: tt('Pen'), key: 'P', icon: <Pencil /> },
  { id: 'eraser', label: tt('Eraser'), key: 'X', icon: <Eraser /> },
];

export function BoardPage({ board, onClose }: { board: Board; onClose: () => void }) {
  const store = useMemo(() => new BoardStore(board), [board]);
  useEffect(() => { (window as unknown as { __board?: BoardStore }).__board = store; }, [store]);
  useBoard(store);
  const b = store.board;
  const cal = getMap(b.map);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileName = safeName(`${b.name}_${b.map}`);

  // Lecture animée : étape courante -> suivante, puis on avance
  useEffect(() => {
    if (!playing) return;
    let raf = 0, start = performance.now();
    const tick = (now: number) => {
      const p = (now - start) / STEP_MS;
      if (p >= 1) {
        if (store.step >= store.board.steps.length - 2) { store.setStep(store.board.steps.length - 1); setProgress(0); setPlaying(false); return; }
        store.setStep(store.step + 1);
        start = now;
        setProgress(0);
      } else setProgress(p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, store]);

  // Raccourcis
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { store.removeSelected(); return; }
      if (e.key === 'ArrowLeft') { setPlaying(false); store.setStep(store.step - 1); return; }
      if (e.key === 'ArrowRight') { setPlaying(false); store.setStep(store.step + 1); return; }
      if (e.key === ' ') { e.preventDefault(); togglePlay(); return; }
      if (e.key === 'Escape') { store.setTool('select'); store.select(null); return; }
      const t = TOOLS.find((x) => x.key === e.key.toUpperCase());
      if (t) store.setTool(t.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const togglePlay = () => {
    if (playing) { setPlaying(false); setProgress(0); return; }
    if (store.board.steps.length < 2) return;
    if (store.step >= store.board.steps.length - 1) store.setStep(0);
    setPlaying(true);
  };

  const exportPng = async () => {
    const c = document.createElement('canvas');
    c.width = c.height = RADAR_SIZE;
    const img = await loadImage(radarUrl(b.map, b.layer === 'lower'));
    drawBoard(c.getContext('2d')!, { size: RADAR_SIZE, board: b, step: store.step, radar: img, theme: readRenderTheme() });
    c.toBlob((blob) => blob && downloadBlob(blob, `${fileName}_${store.step + 1}.png`));
  };
  const exportFile = () => downloadBlob(new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' }), `${fileName}.board`);

  const cur = store.current;
  const sel = cur.tokens.find((t) => t.id === store.selected) ?? null;

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <header className="flex h-12 shrink-0 items-center gap-3 px-2">
        <Button size="sm" variant="ghost" onClick={onClose}><ArrowLeft /> {tt('Back')}</Button>
        <Input defaultValue={b.name} onBlur={(e) => store.rename(e.target.value || 'Untitled board')} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); }}
          className="h-8 w-96 border-transparent bg-transparent text-sm font-medium shadow-none hover:border-input dark:bg-transparent" aria-label={tt('Board name')} />
        <span className="text-xs text-muted-foreground">{mapDisplayName(b.map)} · {store.saved ? tt('Saved in this browser') : tt('Not saved yet')}</span>
        <span className="flex-1" />
        {cal?.hasLower && (
          <ToggleGroup type="single" variant="outline" size="sm" value={b.layer} onValueChange={(v) => v && store.setLayer(v as 'upper' | 'lower')}>
            <ToggleGroupItem value="upper" className="px-3 text-xs">{tt('Upper')}</ToggleGroupItem>
            <ToggleGroupItem value="lower" className="px-3 text-xs">{tt('Lower')}</ToggleGroupItem>
          </ToggleGroup>
        )}
        <Button size="sm" variant="outline" onClick={exportPng}><ImageDown /> {tt('PNG')}</Button>
        <Button size="sm" variant="outline" onClick={exportFile}><Download /> {tt('.board')}</Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 auto-rows-max overflow-y-auto md:auto-rows-auto md:overflow-visible md:grid-cols-[240px_1fr_280px] gap-2">
        {/* Étapes */}
        <div className="flex min-h-0 flex-col rounded-xl border bg-card">
          <div className="flex items-center justify-between px-3 py-2.5">
            <span className="text-sm font-medium">{tt('Steps')}</span>
            <Button size="xs" variant="outline" onClick={() => store.addStep()}><Plus /> {tt('Add')}</Button>
          </div>
          <ol className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
            {b.steps.map((s, i) => (
              <li key={s.id} className={cn('group flex items-center gap-1 rounded-md pr-1', i === store.step && 'bg-accent')}>
                <button className="num w-7 shrink-0 py-1.5 text-center text-xs text-muted-foreground" onClick={() => { setPlaying(false); store.setStep(i); }}>{i + 1}</button>
                <input key={s.id + s.name} defaultValue={s.name} onFocus={() => store.setStep(i)}
                  onBlur={(e) => e.target.value !== s.name && store.renameStep(i, e.target.value)}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); }}
                  className="min-w-0 flex-1 bg-transparent py-1 text-xs outline-none" />
                <span className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <button className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === 0} onClick={() => store.moveStep(i, -1)} aria-label={tt('Move step up')}><ArrowUp className="size-3.5" /></button>
                  <button className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === b.steps.length - 1} onClick={() => store.moveStep(i, 1)} aria-label={tt('Move step down')}><ArrowDown className="size-3.5" /></button>
                  <button className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={b.steps.length === 1} onClick={() => store.removeStep(i)} aria-label={tt('Delete step')}><X className="size-3.5" /></button>
                </span>
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-1 border-t p-2">
            <Button size="sm" className="flex-1" onClick={togglePlay} disabled={b.steps.length < 2}>{playing ? <Pause /> : <Play />} {playing ? tt('Stop') : tt('Play steps')}</Button>
          </div>
        </div>

        {/* Radar */}
        <div className="relative flex min-h-0 gap-2 overflow-hidden rounded-xl border bg-card p-2">
          <div className="flex flex-col gap-1">
            {TOOLS.map((t) => (
              <Tooltip key={t.id}>
                <TooltipTrigger asChild>
                  <button onClick={() => store.setTool(t.id)} aria-label={t.label}
                    className={cn('flex size-8 items-center justify-center rounded-md text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-4',
                      store.tool === t.id && 'bg-accent text-foreground')}>
                    {t.icon ?? t.text}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t.label} ({t.key})</TooltipContent>
              </Tooltip>
            ))}
            <div className="my-1 h-px bg-border" />
            {BOARD_COLORS.map((c) => (
              <button key={c} onClick={() => store.setColor(c)} aria-label={tt('Color {0}', [c])}
                className={cn('mx-auto size-5 rounded-full border-2', store.color === c ? 'border-foreground' : 'border-transparent')} style={{ background: c }} />
            ))}
            <div className="my-1 h-px bg-border" />
            <Tooltip><TooltipTrigger asChild><button className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-4" onClick={() => store.undo()} aria-label={tt('Undo')}><Undo2 /></button></TooltipTrigger><TooltipContent side="right">{tt('Undo (Ctrl+Z)')}</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild><button className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-4" onClick={() => store.redo()} aria-label={tt('Redo')}><Redo2 /></button></TooltipTrigger><TooltipContent side="right">{tt('Redo (Ctrl+Y)')}</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild><button className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-4" onClick={() => store.clearStep()} aria-label={tt('Clear step')}><Trash2 /></button></TooltipTrigger><TooltipContent side="right">{tt('Clear this step')}</TooltipContent></Tooltip>
          </div>
          <BoardCanvas store={store} progress={playing ? progress : 0} interactive={!playing} />
        </div>

        {/* Note et jeton sélectionné */}
        <div className="flex min-h-0 flex-col gap-3 rounded-xl border bg-card p-4">
          <div className="space-y-1.5">
            <div className="text-sm font-medium">{tt('Step') + ' '}{store.step + 1} · {cur.name}</div>
            <Textarea key={cur.id} defaultValue={cur.note} placeholder={tt('Calls, timings, who does what…')} onChange={(e) => store.setNote(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()} className="min-h-32 resize-y text-sm" />
          </div>
          {sel && (sel.kind === 'ct' || sel.kind === 't') && (
            <div className="space-y-1.5 border-t pt-3">
              <div className="text-xs text-muted-foreground">{tt('Selected') + ' '}{sel.kind.toUpperCase()} {tt('player')}</div>
              <Input key={sel.id} defaultValue={sel.label ?? ''} placeholder={tt('Number or name')} maxLength={10}
                onBlur={(e) => store.relabel(sel.id, e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); }} className="h-8 text-sm" />
              <Button size="xs" variant="ghost" onClick={() => store.removeSelected()}><Trash2 /> {tt('Remove')}</Button>
            </div>
          )}
          <div className="mt-auto space-y-1 border-t pt-3 text-[11px] text-muted-foreground">
            <p>{tt('Pick a tool and click the map to place it. Drag to move. A new step copies the players of the current one, so moves animate when you play the steps.')}</p>
            <p>{tt('← → change step · Space plays · Del removes')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = src; });
}

function BoardCanvas({ store, progress, interactive }: { store: BoardStore; progress: number; interactive: boolean }) {
  const version = useBoard(store);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [size, setSize] = useState(0);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const b = store.board;
  const scale = getMap(b.map)?.scale ?? 5;

  useEffect(() => { let alive = true; loadImage(radarUrl(b.map, b.layer === 'lower')).then((i) => alive && setImg(i)); return () => { alive = false; }; }, [b.map, b.layer]);
  useEffect(() => {
    const ro = new ResizeObserver(() => { const r = wrap.current!.getBoundingClientRect(); setSize(Math.floor(Math.min(r.width, r.height))); });
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !size) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr; c.height = size * dpr;
    c.style.width = `${size}px`; c.style.height = `${size}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBoard(ctx, { size, board: store.board, step: store.step, progress, selected: store.selected, draft: store.draft, radar: img, theme: readRenderTheme() });
  }, [version, size, img, progress, store]);

  const toRadar = (e: React.PointerEvent): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * RADAR_SIZE, ((e.clientY - r.top) / r.height) * RADAR_SIZE];
  };

  return (
    <div ref={wrap} className="flex min-w-0 flex-1 items-center justify-center">
      <canvas ref={canvas} className={cn('touch-none rounded-lg', store.tool === 'select' ? 'cursor-default' : 'cursor-crosshair')} data-testid="board-canvas"
        onPointerDown={(e) => {
          if (!interactive) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const [x, y] = toRadar(e);
          const tool = store.tool;
          if (tool === 'select') {
            const t = tokenAt(store.current, x, y, scale);
            store.select(t?.id ?? null);
            if (t) { store.beginMove(); drag.current = { id: t.id, dx: t.x - x, dy: t.y - y }; }
          } else if (tool === 'eraser') store.eraseAt(x, y, 18);
          else if (tool === 'arrow' || tool === 'line' || tool === 'pen') store.beginStroke(x, y);
          else store.addToken(tool, x, y);
        }}
        onPointerMove={(e) => {
          if (!interactive || !(e.buttons & 1)) return;
          const [x, y] = toRadar(e);
          if (drag.current) store.moveTokenLive(drag.current.id, x + drag.current.dx, y + drag.current.dy);
          else if (store.draft) store.extendStroke(x, y);
          else if (store.tool === 'eraser') store.eraseAt(x, y, 18);
        }}
        onPointerUp={() => {
          if (drag.current) { drag.current = null; store.endMove(); }
          if (store.draft) store.endStroke();
        }}
      />
    </div>
  );
}
