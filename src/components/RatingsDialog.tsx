// Saisie des ratings de référence d'un match : coller le tableau d'une page FACEIT ou HLTV,
// vérifier / corriger les valeurs trouvées, enregistrer.

import { useEffect, useMemo, useState } from 'react';
import { parseReferencePaste } from '@/calib/paste';
import { REF_LABEL, setRefs, type LibraryMatch, type RefKind } from '@/library/library';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { tt } from '@/i18n';

interface Props {
  match: LibraryMatch | null;
  onClose: () => void;
  onSaved: () => void;
}

export function RatingsDialog({ match, onClose, onSaved }: Props) {
  const [kind, setKind] = useState<RefKind>('faceit');
  const [text, setText] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!match) return;
    const k: RefKind = 'hltv3';
    setKind(k);
    setText('');
  }, [match]);

  // Valeurs existantes, puis valeurs détectées dans le texte collé
  useEffect(() => {
    if (!match) return;
    const existing = match.refs[kind] ?? {};
    const v: Record<string, string> = {};
    for (const p of match.players) v[p.steamid] = existing[p.steamid] != null ? String(existing[p.steamid]) : '';
    setValues(v);
  }, [match, kind]);

  const parsed = useMemo(() => (match && text.trim() ? parseReferencePaste(text, match.players) : null), [match, text]);
  useEffect(() => {
    if (!parsed) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const r of parsed) if (r.value != null) next[r.steamid] = r.value.toFixed(2);
      return next;
    });
  }, [parsed]);

  if (!match) return null;
  const filled = Object.values(values).filter((v) => v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.')))).length;

  const save = async () => {
    const out: Record<string, number> = {};
    for (const [sid, v] of Object.entries(values)) {
      const n = Number(v.replace(',', '.'));
      if (v.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 4) out[sid] = n;
    }
    await setRefs(match.id, kind, out);
    onSaved();
    onClose();
  };

  return (
    <Dialog open={!!match} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tt('Reference ratings')}</DialogTitle>
          <DialogDescription>
            {tt('Open this map on HLTV (the map tab, not the match total), select the scoreboard table, copy it and paste it below. Check the values, then save.')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">{REF_LABEL[kind]}</div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={tt('Paste the scoreboard here…\nZywOo  25-14  +11  98.2  80.0%  1.45')}
              className="h-56 resize-none font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label>{match.teams[0]} {tt('vs') + ' '}{match.teams[1]} · {filled}/{match.players.length} {tt('found')}</Label>
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {match.players.map((p) => (
                <div key={p.steamid} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                  <Input
                    value={values[p.steamid] ?? ''}
                    onChange={(e) => setValues({ ...values, [p.steamid]: e.target.value })}
                    placeholder="—"
                    inputMode="decimal"
                    className="num h-8 w-20 text-right"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tt('Cancel')}</Button>
          <Button onClick={save}>{tt('Save') + ' '}{filled} {tt('rating')}{filled === 1 ? '' : 's'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
