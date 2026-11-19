// Liste des tableaux tactiques enregistrés (écran d'accueil) : créer, importer, ouvrir, supprimer.

import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Upload } from 'lucide-react';
import { deleteBoard, listBoards, saveBoard } from '@/board/storage';
import { newBoard, parseBoardFile, type Board } from '@/board/types';
import { allMapNames, COMPETITIVE_MAPS, mapDisplayName } from '@/maps/maps';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { locale, tt } from '@/i18n';

export function BoardsPanel({ onOpen }: { onOpen: (b: Board) => void }) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [map, setMap] = useState('de_mirage');
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { listBoards().then(setBoards); }, []);
  const maps = allMapNames();

  const create = async () => {
    const b = newBoard(map, tt('{0} plan', [mapDisplayName(map)]));
    await saveBoard(b);
    onOpen(b);
  };
  const importFile = async (f: File) => {
    setError(null);
    try {
      const b = parseBoardFile(await f.text());
      await saveBoard(b);
      onOpen(b);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="w-full max-w-5xl overflow-hidden rounded-xl border bg-card text-card-foreground">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <span className="text-sm font-medium">{tt('Tactical boards')}</span>
        <span className="text-xs text-muted-foreground">{tt('plans in steps, stored in this browser')}</span>
        <span className="flex-1" />
        <Select value={map} onValueChange={setMap}>
          <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup><SelectLabel>{tt('Competitive')}</SelectLabel>{maps.filter((m) => COMPETITIVE_MAPS.includes(m)).map((m) => <SelectItem key={m} value={m}>{mapDisplayName(m)}</SelectItem>)}</SelectGroup>
            <SelectGroup><SelectLabel>{tt('Other')}</SelectLabel>{maps.filter((m) => !COMPETITIVE_MAPS.includes(m)).map((m) => <SelectItem key={m} value={m}>{mapDisplayName(m)}</SelectItem>)}</SelectGroup>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={create}><Plus /> {tt('New board')}</Button>
        <Button size="sm" variant="outline" onClick={() => file.current?.click()}><Upload /> {tt('Import')}</Button>
        <input ref={file} type="file" accept=".board,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />
      </div>
      {error && <p className="px-4 pb-2 text-xs text-destructive">{error}</p>}
      {boards.length > 0 && (
        <ul className="border-t">
          {boards.map((b) => (
            <li key={b.id} className="group flex items-center gap-3 border-b px-4 py-2 last:border-b-0 hover:bg-accent/40">
              <button className="min-w-0 flex-1 truncate text-left text-sm font-medium" onClick={() => onOpen(b)}>{b.name}</button>
              <span className="text-xs text-muted-foreground">{mapDisplayName(b.map)}</span>
              <span className="num w-16 text-right text-xs text-muted-foreground">{b.steps.length} {tt('step')}{b.steps.length === 1 ? '' : 's'}</span>
              <span className="w-24 text-right text-xs text-muted-foreground">{new Date(b.updatedAt).toLocaleDateString(locale)}</span>
              <button className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground" aria-label={tt('Delete board')}
                onClick={async () => { if (confirm(tt('Delete “{0}”?', [b.name]))) { await deleteBoard(b.id); setBoards(await listBoards()); } }}>
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
