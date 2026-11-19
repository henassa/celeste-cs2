// Bouton "copier setpos" : met dans le presse-papiers la commande console pour se placer en jeu.

import { useState } from 'react';
import { Check, Crosshair } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Repli pour les contextes sans API presse-papiers (http non local)
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function CopySetpos({ get, label = 'Copy setpos', className }: { get: () => string | null; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label}
          className={cn('inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground', className)}
          onClick={async (e) => {
            e.stopPropagation();
            const cmd = get();
            if (cmd && (await copyText(cmd))) { setDone(true); setTimeout(() => setDone(false), 1200); }
          }}>
          {done ? <Check className="size-3.5" /> : <Crosshair className="size-3.5" />}
        </button>
      </TooltipTrigger>
      <TooltipContent>{done ? tt('Copied') : tt('{0} (paste in the CS2 console with sv_cheats 1)', [label])}</TooltipContent>
    </Tooltip>
  );
}
