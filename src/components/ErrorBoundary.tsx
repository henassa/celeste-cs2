// Filet de sécurité : affiche l'erreur au lieu d'une page vide, avec une réinitialisation des données locales.

import { Component, type ReactNode } from 'react';
import { tt } from '@/i18n';

interface State { error: Error | null }

export async function resetLocalData(): Promise<void> {
  if (!confirm(tt('Delete your library, reference ratings and notes stored in this browser? Make a library backup first if you can. This cannot be undone.'))) return;
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('scrimview.')) localStorage.removeItem(k);
  } catch { /* ignoré */ }
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase('scrimview');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch { resolve(); }
  });
  location.reload();
}

export function ErrorScreen({ error }: { error: unknown }) {
  const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const stack = error instanceof Error ? error.stack ?? '' : '';
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-4 rounded-xl border bg-card p-6 text-card-foreground">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">{tt('Something went wrong')}</h1>
          <p className="text-sm text-muted-foreground">{tt('Copy the message below and send it to the developer. Reloading usually helps. Resetting local data deletes your library, reference ratings and notes: only use it as a last resort.')}</p>
        </div>
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{msg}{stack ? `\n\n${stack}` : ''}</pre>
        <div className="flex gap-2">
          <button className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" onClick={() => location.reload()}>{tt('Reload')}</button>
          <button className="h-8 rounded-md border px-3 text-sm" onClick={() => navigator.clipboard?.writeText(`${msg}\n\n${stack}`)}>{tt('Copy error')}</button>
          <button className="h-8 rounded-md border px-3 text-sm text-destructive" onClick={() => resetLocalData()}>{tt('Reset local data (last resort)')}</button>
        </div>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error) { console.error('[scrimview]', error); }
  render() { return this.state.error ? <ErrorScreen error={this.state.error} /> : this.props.children; }
}
