// Aide des raccourcis clavier (touche ?).

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { tt } from '@/i18n';

const GROUPS: { title: string; items: [string, string][] }[] = [
  { title: tt('Everywhere'), items: [['Ctrl K', 'Command palette'], ['?', 'This help'], ['[', 'Collapse the sidebar'], ['Alt ←  /  Alt →', 'Back / forward'], ['C', 'Coach']] },
  { title: tt('Replay'), items: [['Space', 'Play / pause'], ['←  →', '5 s back / forward (Shift: 1 s)'], ['Q  E', 'Previous / next round'], ['↑  ↓', 'Speed'], ['1–5  6–0', 'Follow a player'], ['Esc', 'Stop following'], ['F', 'Focus: radar only'], ['P', 'Presentation mode (stream)'], ['H  K', 'Presentation: team panels / caption'], ['N', 'Names'], ['T', 'Grenade trails'], ['L', 'Upper / lower level'], ['M', 'Marker'], ['G', 'Moments panel']] },
  { title: tt('Drawing'), items: [['V', 'Select'], ['B', 'Pen'], ['A', 'Arrow'], ['S', 'Straight line'], ['O', 'Circle'], ['R', 'Rectangle'], ['I', 'Text'], ['X', 'Eraser'], ['Shift (while drawing)', 'Straight / 45° / square'], ['Right-click  /  Esc', 'Cancel the stroke'], ['Ctrl Z  /  Ctrl Shift Z', 'Undo / redo']] },
];

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tt('Keyboard shortcuts')}</DialogTitle>
          <DialogDescription>{tt('Everything is also in the command palette (Ctrl K).')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title} className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">{g.title}</div>
              {g.items.map(([k, label]) => (
                <div key={k} className="flex items-center justify-between gap-3 text-sm">
                  <span>{label}</span>
                  <span className="flex gap-1">{k.split('  ').map((x) => <Kbd key={x}>{x}</Kbd>)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
