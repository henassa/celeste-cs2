// Écran d'accueil : dépôt d'un fichier démo. Le fichier est traité localement.

import { useRef, useState } from 'react';
import { FileUp, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

const STEP_LABEL: Record<string, string> = {
  loading: tt('Reading file'),
  header: tt('Reading header'),
  events: tt('Parsing events'),
  grenades: tt('Tracking grenades'),
  players: tt('Tracking players'),
  building: tt('Building replay'),
};

interface Props {
  onFile: (f: File) => void;
  progress: { step: string; ratio: number } | null;
  error: string | null;
}

export function DropZone({ onFile, progress, error }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const busy = progress !== null;

  return (
    <div className="w-full max-w-5xl">
      <div className="rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <div className="mb-6 space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">{tt('Celeste CS2')}</h1>
          <p className="text-sm text-muted-foreground">{tt('Demo review for Counter-Strike 2.')}</p>
        </div>
        <div
          className={cn(
            'flex flex-col items-center gap-4 rounded-lg border border-dashed px-6 py-10 text-center transition-colors',
            over ? 'border-ring bg-accent/50' : 'border-input',
          )}
          onDragOver={(e) => { e.preventDefault(); if (!busy) setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f && !busy) onFile(f);
          }}
        >
          {busy ? (
            <div className="w-full">
              <div className="mb-2 flex justify-between text-sm">
                <span>{STEP_LABEL[progress.step] ?? progress.step}…</span>
                <span className="num text-muted-foreground">{Math.round(progress.ratio * 100)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.max(3, progress.ratio * 100)}%` }} />
              </div>
            </div>
          ) : (
            <>
              <div className="flex size-10 items-center justify-center rounded-full bg-muted"><FileUp className="size-5" /></div>
              <div className="space-y-1">
                <p className="text-sm font-medium">{tt('Drop a demo file here')}</p>
                <p className="text-xs text-muted-foreground">{tt('.dem, .dem.zst or .dem.gz · Matchmaking, Premier, FACEIT, HLTV')}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => input.current?.click()}>{tt('Choose file')}</Button>
            </>
          )}
        </div>
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3" /> {tt('Parsed in your browser. Nothing is uploaded.')}
        </p>
        <input
          ref={input}
          type="file"
          accept=".dem,.zst,.gz"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
        />
      </div>
    </div>
  );
}
