// Bibliothèque : import par lots (fichiers ou dossier), liste des matchs, ratings de référence, étalonnage.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, ChartColumn, Download, FolderOpen, Plus, Trash2, Upload } from 'lucide-react';
import { canRefresh, countUnreadable, deleteMatch, exportLibrary, importLibrary, isOutdated, listMatches, REF_LABEL, saveMatch, summarize, type LibraryMatch, type RefKind } from '@/library/library';
import { loadDemo } from '@/data/load-demo';
import { calibrationData, fitModel, loadModels, parseModelsFile, saveModels, type RatingModel } from '@/calib/model';
import { mapDisplayName } from '@/maps/maps';
import { downloadBlob } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RatingsDialog } from './RatingsDialog';
import { locale, tt } from '@/i18n';

const num = (v: unknown, d = 3) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—');

const DEMO_RE = /\.(dem|dem\.zst|dem\.gz|zst|gz)$/i;

interface Job { done: number; total: number; current: string; errors: string[] }

export function LibraryPanel({ onAnalysis }: { onAnalysis: () => void }) {
  const [matches, setMatches] = useState<LibraryMatch[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [editing, setEditing] = useState<LibraryMatch | null>(null);
  const [models, setModels] = useState(loadModels);
  const [modelMsg, setModelMsg] = useState<string | null>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const modelInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const [unreadable, setUnreadable] = useState(0);
  const [libMsg, setLibMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => { setMatches(await listMatches()); setUnreadable(await countUnreadable()); }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Import séquentiel : une démo à la fois (mémoire maîtrisée), seules les stats sont gardées
  const importFiles = async (list: FileList | null) => {
    const files = [...(list ?? [])].filter((f) => DEMO_RE.test(f.name));
    if (!files.length) return;
    const j: Job = { done: 0, total: files.length, current: '', errors: [] };
    setJob({ ...j });
    for (const f of files) {
      j.current = f.name;
      setJob({ ...j });
      try {
        const m = await loadDemo(f, () => {});
        await saveMatch(summarize(m, f.lastModified));
      } catch (e) {
        j.errors.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      j.done++;
      setJob({ ...j });
      await refresh();
    }
    j.current = '';
    setJob({ ...j });
  };

  const counts = (kind: RefKind) => {
    const ms = matches.filter((m) => m.refs[kind] && Object.keys(m.refs[kind]!).length);
    return { matches: ms.length, players: ms.reduce((a, m) => a + Object.keys(m.refs[kind]!).length, 0) };
  };

  const calibrate = () => {
    const next: Partial<Record<RefKind, RatingModel>> = { ...models };
    const msgs: string[] = [];
    for (const kind of ['faceit', 'hltv3'] as RefKind[]) {
      const model = fitModel(kind, matches);
      if (model) {
        next[kind] = model;
        msgs.push(`${REF_LABEL[kind]}: ±${num(model.cvMae)} average error`);
        const w = model.wpInfo;
        if (w && model.cvMaeWithout !== undefined) {
          msgs.push(w.kept
            ? tt('win model trained on {0} rounds kept (±{1} without it)', [w.rounds, num(model.cvMaeWithout)])
            : tt('win model trained on {0} rounds not kept: no measurable gain (±{1})', [w.rounds, num(model.cvMaeWithout)]));
        } else if (!w) msgs.push('add 150+ rounds with demos from this version to train the win model');
      }
      else if (counts(kind).matches) msgs.push(tt('{0}: need at least 2 up-to-date matches with ratings', [REF_LABEL[kind]]));
    }
    saveModels(next);
    setModels(next);
    const old = matches.filter(isOutdated).length;
    if (old) msgs.push(tt(old === 1 ? '{0} match was analysed by an older version and skipped: add the demo again to update it' : '{0} matches were analysed by an older version and skipped: add the demos again to update them', [old]));
    setModelMsg(msgs.join(' · ') || tt('Add reference ratings to at least 2 matches first.'));
  };

  const exportModels = () => {
    downloadBlob(new Blob([JSON.stringify(models, null, 1)], { type: 'application/json' }), 'scrimview-calibration.json');
  };
  const importModels = async (f: File) => {
    try {
      const m = { ...models, ...parseModelsFile(await f.text()) };
      saveModels(m);
      setModels(m);
      setModelMsg('Calibration imported.');
    } catch (e) { setModelMsg(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="w-full max-w-5xl space-y-3">
      <div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <span className="text-sm font-medium">{tt('Library')}</span>
          <span className="text-xs text-muted-foreground">{tt(matches.length === 1 ? '{0} match' : '{0} matches', [matches.length])} {tt('· stats only, stored in this browser')}</span>
          {unreadable > 0 && <span className="text-xs text-destructive">{unreadable} {tt('unreadable entr')}{unreadable === 1 ? 'y' : 'ies'} {tt('kept aside')}</span>}
          {matches.some(isOutdated) && <span className="text-xs text-destructive">{matches.filter(isOutdated).length} {tt('to update: add these demos again')}</span>}
          {matches.some(canRefresh) && <span className="text-xs text-muted-foreground">{matches.filter(canRefresh).length} {tt('without callouts: add these demos again to filter by place')}</span>}
          <span className="flex-1" />
          <Button size="sm" onClick={onAnalysis} disabled={!matches.length}><ChartColumn /> {tt('Analysis')}</Button>
          <Button size="sm" variant="ghost" onClick={async () => downloadBlob(new Blob([await exportLibrary()], { type: 'application/json' }), `celeste-library-${new Date().toISOString().slice(0, 10)}.json`)}
            disabled={!matches.length}><Archive /> {tt('Backup')}</Button>
          <Button size="sm" variant="ghost" onClick={() => backupInput.current?.click()}><ArchiveRestore /> {tt('Restore')}</Button>
          <Button size="sm" variant="outline" onClick={() => filesInput.current?.click()} disabled={!!job && job.done < job.total}><Plus /> {tt('Add demos')}</Button>
          <Button size="sm" variant="outline" onClick={() => folderInput.current?.click()} disabled={!!job && job.done < job.total}><FolderOpen /> {tt('Add folder')}</Button>
        </div>
        {libMsg && <p className="border-t px-4 py-2 text-xs text-muted-foreground">{libMsg}</p>}
        {job && (
          <div className="space-y-1.5 border-t px-4 py-3">
            <div className="flex justify-between text-xs">
              <span className="truncate">{job.current ? tt('Parsing {0}', [job.current]) : tt('Done: {0} imported', [job.done - job.errors.length])}</span>
              <span className="num text-muted-foreground">{job.done}/{job.total}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${(job.done / job.total) * 100}%` }} /></div>
            {job.errors.map((e) => <p key={e} className="text-xs text-destructive">{e}</p>)}
          </div>
        )}
        {matches.length > 0 && (
          <div className="max-h-80 overflow-y-auto border-t">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">{tt('Map')}</TableHead>
                  <TableHead>{tt('Match')}</TableHead>
                  <TableHead>{tt('Date')}</TableHead>
                  <TableHead>{tt('Source')}</TableHead>
                  <TableHead>{tt('Reference ratings')}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {matches.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="pl-4 font-medium">{mapDisplayName(m.map)}{isOutdated(m) && <span className="ml-2 rounded-sm border border-destructive/50 px-1 text-[10px] text-destructive">{tt('update')}</span>}</TableCell>
                    <TableCell className="max-w-72 truncate">
                      {m.teams[0]} <span className="num">{m.score[0]}–{m.score[1]}</span> {m.teams[1]}
                    </TableCell>
                    <TableCell className="num text-muted-foreground">{new Date(m.date).toLocaleDateString(locale)}</TableCell>
                    <TableCell className="text-muted-foreground capitalize">{m.source === 'other' ? tt('Other') : m.source}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {(['faceit', 'hltv3'] as RefKind[]).filter((k) => m.refs[k]).map((k) => (
                          <span key={k} className="rounded-sm border px-1.5 text-[11px]">{k === 'faceit' ? tt('FACEIT') : tt('HLTV 3.0')}</span>
                        ))}
                        <Button size="xs" variant="ghost" onClick={() => setEditing(m)}>{m.refs.faceit || m.refs.hltv3 ? tt('Edit') : tt('Add')}</Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button size="icon-xs" variant="ghost" aria-label={tt('Remove from library')} onClick={async () => { await deleteMatch(m.id); refresh(); }}><Trash2 /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card p-4 text-card-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{tt('Rating calibration')}</span>
          <span className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => modelInput.current?.click()}><Upload /> {tt('Import')}</Button>
          <Button size="sm" variant="outline" onClick={exportModels} disabled={!models.faceit && !models.hltv3}><Download /> {tt('Export')}</Button>
          <Button size="sm" variant="outline" disabled={!counts('faceit').players && !counts('hltv3').players}
            onClick={() => downloadBlob(new Blob([JSON.stringify(calibrationData(matches))], { type: 'application/json' }), 'scrimview-calibration-data.json')}>
            <Download /> {tt('Export data')}
          </Button>
          <Button size="sm" onClick={calibrate}>{tt('Calibrate')}</Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {tt('HLTV 3.0 is private. Add its real values to a few maps, then calibrate: Celeste fits ≈3.0 on your stats and shows the measured error. A default calibration is included.')}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(['hltv3'] as RefKind[]).map((kind) => {
            const c = counts(kind), m = models[kind];
            return (
              <div key={kind} className="rounded-lg border p-3">
                <div className="text-sm font-medium">{REF_LABEL[kind]}</div>
                <div className="mt-1 text-xs text-muted-foreground">{tt('{0} players from {1} matches', [c.players, c.matches])}</div>
                <div className="mt-2 text-xs">
                  {m ? (
                    <>
                      {m.builtIn ? tt('Default calibration') : tt('Your calibration')}: {m.samples} {tt('players from') + ' '}{m.matches} {tt('maps, average error') + ' '}<span className="num font-medium"> ±{num(m.cvMae)}</span>{m.extra?.includes('wpa') && m.wpInfo ? tt(' · uses a win model trained on {0} of your rounds', [m.wpInfo.rounds]) : ''}
                      <span className="text-muted-foreground"> {tt('(2.0≈ vs reference: ±')}{num(m.baselineMae)})</span>
                    </>
                  ) : <span className="text-muted-foreground">{tt('Not calibrated yet')}</span>}
                </div>
              </div>
            );
          })}
        </div>
        {modelMsg && <p className="mt-2 text-xs text-muted-foreground">{modelMsg}</p>}
      </div>

      <input ref={filesInput} type="file" multiple accept=".dem,.zst,.gz" className="hidden" onChange={(e) => { importFiles(e.target.files); e.target.value = ''; }} />
      <input ref={folderInput} type="file" className="hidden" {...{ webkitdirectory: '', directory: '' }} onChange={(e) => { importFiles(e.target.files); e.target.value = ''; }} />
      <input ref={backupInput} type="file" accept=".json" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        try { const n = await importLibrary(await f.text()); setLibMsg(tt(n === 1 ? '{0} match restored.' : '{0} matches restored.', [n])); await refresh(); }
        catch (err) { setLibMsg(err instanceof Error ? err.message : String(err)); }
      }} />
      <input ref={modelInput} type="file" accept=".json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importModels(f); e.target.value = ''; }} />
      <RatingsDialog match={editing} onClose={() => setEditing(null)} onSaved={refresh} />
    </div>
  );
}
