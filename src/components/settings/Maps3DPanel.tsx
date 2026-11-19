// Maps 3D et modèles des joueurs : choix des maps à préparer depuis CS2 (pool, autres maps du jeu,
// workshop), qualité, extraction avec avancement et journal, place sur le disque.
// Dans le navigateur, l'extraction se fait en ligne de commande : on l'explique.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Check, FolderOpen, HardDrive, Loader2, RefreshCw, Trash2, UserRound, X } from 'lucide-react';
import { desktop, estimateMap, formatBytes, MODELS_ESTIMATE, type DesktopInfo, type InstalledMap, type JobProgress } from '@/app/desktop';
import { mapDisplayName } from '@/maps/maps';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

type Quality = 'normal' | 'full' | 'complete';
const QUALITY: { id: Quality; label: string; hint: string }[] = [
  { id: 'normal', label: tt('Standard'), hint: tt('Playable areas, smooth everywhere (recommended)') },
  { id: 'full', label: tt('Full'), hint: tt('Adds the scenery around the map') },
  { id: 'complete', label: tt('Complete'), hint: tt('Every polygon: heavy, for a strong graphics card') },
];

export function Maps3DPanel({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  if (!desktop) return <WebInstructions />;
  return <DesktopMaps compact={compact} onDone={onDone} />;
}

function DesktopMaps({ compact, onDone }: { compact: boolean; onDone?: () => void }) {
  const d = desktop!;
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [maps, setMaps] = useState<InstalledMap[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [models, setModels] = useState(true);
  const [quality, setQuality] = useState<Quality>('normal');
  const [running, setRunning] = useState<string | null>(null);
  const [prog, setProg] = useState<JobProgress | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [disk, setDisk] = useState<{ assets: number; work: number; free: number | null } | null>(null);
  const [changed, setChanged] = useState(false);
  const queue = useRef<(() => Promise<boolean>)[]>([]);

  const refresh = useCallback(async () => {
    const i = await d.info();
    setInfo(i);
    setRunning(i.job);
    d.disk().then(setDisk);
    const r = await d.listMaps();
    if (!r.ok) { setError(r.error); setMaps([]); return; }
    setError(null);
    setMaps(r.maps);
    // Première fois : le pool pas encore construit est coché
    setSel((s) => (s.size ? s : new Set(r.maps.filter((m) => m.pool && !m.built).map((m) => m.name))));
    setModels(!i.anim);
  }, [d]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const offs = [
      d.onStart((e) => { setRunning(e.script); setProg(null); setLog((l) => [...l, `— ${e.script === 'extract-anims.mjs' ? 'Player models' : 'Maps'} —`]); }),
      d.onLine((e) => setLog((l) => [...l.slice(-400), e.line.replace(/^\[cs2\] /, '')])),
      d.onProgress(setProg),
      d.onEnd(async (e) => {
        setRunning(null);
        setLog((l) => [...l, e.code === 0 ? 'Finished.' : `Stopped (code ${e.code}).`]);
        if (e.code === 0) setChanged(true);
        const next = queue.current.shift();
        if (next && e.code === 0) await next(); else { queue.current = []; refresh(); }
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [d, refresh]);

  const groups = useMemo(() => {
    const ms = maps ?? [];
    return [
      { title: tt('Competitive pool'), items: ms.filter((m) => m.pool) },
      { title: tt('Other maps of the game'), items: ms.filter((m) => !m.pool && m.source === 'game') },
      { title: tt('Workshop'), items: ms.filter((m) => m.source === 'workshop') },
    ].filter((g) => g.items.length);
  }, [maps]);

  const start = async () => {
    const specs = (maps ?? []).filter((m) => sel.has(m.name)).map((m) => `${m.name}=${m.vpk}`);
    const steps: (() => Promise<boolean>)[] = [];
    if (models) steps.push(() => d.extractModels());
    if (specs.length) steps.push(() => d.extractMaps(specs, quality));
    if (!steps.length) return;
    setLog([]);
    queue.current = steps.slice(1);
    await steps[0]();
  };
  const toggle = (name: string) => setSel((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const pct = prog && prog.total ? Math.min(100, (prog.done / prog.total) * 100) : 0;

  if (!info || !maps) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {tt('Looking for Counter-Strike 2…')}</div>;

  return (
    <div className="space-y-4" data-testid="maps3d-panel">
      {error ? (
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <div className="font-medium">{tt('Counter-Strike 2 was not found')}</div>
          <p className="text-xs text-muted-foreground">{tt('The maps and player models come from your own CS2 install. Show where it is (the folder that contains') + ' '}<code className="font-mono">{tt('game/csgo')}</code>).</p>
          <Button size="sm" onClick={async () => { const r = await d.pickCs2(); if (r && 'error' in r) setError(r.error); else if (r) refresh(); }}><FolderOpen /> {tt('Choose the CS2 folder')}</Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{tt('From your CS2 install:') + ' '}<span className="font-mono text-foreground/80">{info.paths.cs2 ?? 'found automatically'}</span>{tt('. Nothing is downloaded from the internet except the free extraction tool (Source2Viewer) the first time.')}</p>
      )}

      {!error && (
        <>
          <label className={cn('flex cursor-pointer items-center gap-3 rounded-lg border p-3', models && 'border-foreground/40 bg-accent/40')}>
            <input type="checkbox" className="size-4 accent-foreground" checked={models} onChange={(e) => setModels(e.target.checked)} disabled={!!running} />
            <UserRound className="size-4 text-muted-foreground" />
            <span className="flex-1 text-sm">
              <span className="font-medium">{tt('Player models and animations')}</span>
              <span className="block text-xs text-muted-foreground">{tt('Real CT and T agents with the game\'s animations in the 3D replay. A few minutes, ≈') + ' '}{formatBytes(MODELS_ESTIMATE.final)} {tt('kept.')}</span>
            </span>
            {info.anim && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3.5" /> {tt('Installed')}</span>}
          </label>

          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.title} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">{g.title} <span className="num">({g.items.length})</span></span>
                  <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" disabled={!!running}
                    onClick={() => setSel((s) => { const n = new Set(s); const all = g.items.every((m) => n.has(m.name)); for (const m of g.items) if (all) n.delete(m.name); else n.add(m.name); return n; })}>
                    {g.items.every((m) => sel.has(m.name)) ? tt('None') : tt('All')}
                  </button>
                </div>
                <div className={cn('grid gap-1', compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-3')}>
                  {g.items.map((m) => (
                    <label key={m.name + m.vpk} className={cn('flex h-9 cursor-pointer items-center gap-2 rounded-md border px-2 text-sm', sel.has(m.name) && 'border-foreground/40 bg-accent/40')}>
                      <input type="checkbox" className="size-3.5 accent-foreground" checked={sel.has(m.name)} onChange={() => toggle(m.name)} disabled={!!running} />
                      <span className="min-w-0 flex-1 truncate" title={m.vpk}>{m.source === 'workshop' ? m.name : mapDisplayName(m.name)}</span>
                      {m.built
                        ? <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground" title={tt('3D model ready (size on disk)')}><Box className="size-3" /> {m.builtSize ? formatBytes(m.builtSize) : 'ready'}</span>
                        : <span className="num text-[11px] text-muted-foreground" title={tt('Estimate: {0} for the 3D model, {1} of temporary game exports', [formatBytes(estimateMap(m.size ?? 0, quality).final), formatBytes(estimateMap(m.size ?? 0, quality).temp)])}>≈ {formatBytes(estimateMap(m.size ?? 0, quality).final)}</span>}
                      {m.built && !compact && (
                        <button type="button" aria-label={tt('Remove the 3D model of {0}', [m.name])} className="text-muted-foreground hover:text-foreground" onClick={async (e) => { e.preventDefault(); await d.removeMap(m.name); refresh(); }}><X className="size-3.5" /></button>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {!groups.length && <p className="text-xs text-muted-foreground">{tt('No map found in this CS2 install.')}</p>}
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">{tt('Detail')}</div>
            <ToggleGroup type="single" variant="outline" size="sm" value={quality} onValueChange={(v) => v && setQuality(v as Quality)} className="w-full" disabled={!!running}>
              {QUALITY.map((q) => <ToggleGroupItem key={q.id} value={q.id} className="flex-1 text-xs" title={q.hint}>{q.label}</ToggleGroupItem>)}
            </ToggleGroup>
            <p className="text-[11px] text-muted-foreground">{QUALITY.find((q) => q.id === quality)!.hint}{tt('. About 2–5 minutes and a few hundred MB of temporary files per map.')}</p>
          </div>

          {(() => {
            const chosen = (maps ?? []).filter((m) => sel.has(m.name));
            const est = chosen.map((m) => estimateMap(m.size ?? 0, quality));
            const temp = est.reduce((a, e) => a + e.temp, 0) + (models ? MODELS_ESTIMATE.temp : 0); // (les exports déjà faits sont réutilisés)
            const final = est.reduce((a, e) => a + e.final, 0) + (models ? MODELS_ESTIMATE.final : 0);
            if (!chosen.length && !models) return null;
            const short = disk?.free != null && temp > disk.free;
            return (
              <div className={cn('rounded-lg border px-3 py-2 text-xs', short && 'border-destructive/60')} data-testid="maps3d-estimate">
                <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                  <span>{tt('3D files kept:') + ' '}<span className="num font-medium">≈ {formatBytes(final)}</span></span>
                  <span>{tt('Temporary game exports:') + ' '}<span className="num font-medium">≈ {formatBytes(temp)}</span> <span className="text-muted-foreground">{tt('(can be deleted afterwards)')}</span></span>
                  {disk?.free != null && <span className="text-muted-foreground">{tt('Free space:') + ' '}<span className={cn('num', short ? 'text-destructive' : 'text-foreground')}>{formatBytes(disk.free)}</span></span>}
                </div>
                {short && <p className="mt-1 text-destructive">{tt('Not enough free space for the temporary exports: pick fewer maps, or move the game exports to another disk below.')}</p>}
                <p className="mt-1 text-muted-foreground">{tt('Estimates from the size of each map; maps already exported are reused and take no new space.')}</p>
              </div>
            );
          })()}

          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button variant="outline" onClick={() => { queue.current = []; d.cancel(); }}><X /> {tt('Stop')}</Button>
            ) : (
              <Button onClick={start} disabled={!models && !sel.size} data-testid="maps3d-start">
                <Box /> {models && sel.size ? tt('Install models + {0} map{1}', [sel.size, sel.size === 1 ? '' : 's']) : models ? tt('Install player models') : tt('Build {0} map{1}', [sel.size, sel.size === 1 ? '' : 's'])}
              </Button>
            )}
            {changed && !running && <Button variant="outline" onClick={() => location.reload()}><RefreshCw /> {tt('Reload to use them')}</Button>}
            {onDone && !running && <Button variant="ghost" onClick={onDone}>{changed ? tt('Done') : tt('Later')}</Button>}
          </div>

          {(running || log.length > 0) && (
            <div className="space-y-1.5 rounded-lg border p-3">
              <div className="flex items-center gap-2 text-xs">
                {running && <Loader2 className="size-3.5 animate-spin" />}
                <span className="min-w-0 flex-1 truncate">{running ? (prog ? `${prog.label} (${prog.done}/${prog.total})` : tt('Starting…')) : log[log.length - 1]}</span>
                <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setShowLog((s) => !s)}>{showLog ? tt('Hide details') : tt('Details')}</button>
              </div>
              {running && <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-foreground transition-[width]" style={{ width: `${pct}%` }} /></div>}
              {showLog && <pre className="max-h-48 overflow-y-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{log.join('\n')}</pre>}
            </div>
          )}
        </>
      )}

      {!compact && disk && (
        <div className="space-y-2 rounded-lg border p-3 text-xs">
          <div className="flex items-center gap-2 font-medium"><HardDrive className="size-3.5" /> {tt('Disk space')}</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
            <span>{tt('3D maps and models:') + ' '}<span className="num text-foreground">{formatBytes(disk.assets)}</span></span>
            <span>{tt('Game exports (only needed to rebuild):') + ' '}<span className="num text-foreground">{formatBytes(disk.work)}</span></span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => d.open('assets')}><FolderOpen /> {tt('Open folder')}</Button>
            <Button size="sm" variant="outline" onClick={async () => { await d.pickWorkDir(); refresh(); }}>{tt('Move game exports…')}</Button>
            <Button size="sm" variant="outline" disabled={!disk.work || !!running} onClick={async () => { if (confirm(tt('Delete the game exports? The 3D maps stay installed; rebuilding a map will export it again.'))) { await d.cleanWork(); refresh(); } }}><Trash2 /> {tt('Delete game exports')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function WebInstructions() {
  return (
    <div className="space-y-3 text-sm" data-testid="maps3d-web">
      <p className="text-muted-foreground">{tt('In the desktop app, maps and player models are installed from here in one click. In the browser version, run these commands in the Celeste folder, then rebuild:')}</p>
      <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">{`npm install
npm run anims:extract      # player models and animations
npm run maps:extract       # the competitive pool
npm run maps:extract -- --all              # every installed map, workshop included
npm run maps:extract -- de_mirage --full   # one map, with its scenery
npm run build`}</pre>
      <p className="text-xs text-muted-foreground">{tt('Everything comes from your own CS2 install and stays on your machine.')}</p>
    </div>
  );
}
