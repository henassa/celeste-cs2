// Barre de titre de l'app de bureau, dans l'interface : on y déplace la fenêtre, elle montre la page
// et donne accès à la recherche. Les boutons réduire / agrandir / fermer restent ceux du système.

import { Gauge, Search } from 'lucide-react';
import { desktop } from '@/app/desktop';
import { useMyTeam } from '@/app/my-team';
import { Kbd } from '@/components/ui/kbd';
import { tt } from '@/i18n';

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties;
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

export function TitleBar({ title, onSearch }: { title: string; onSearch: () => void }) {
  const team = useMyTeam();
  const mac = desktop?.platform === 'darwin';
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b bg-background text-xs select-none print:hidden" style={{ ...drag, paddingLeft: mac ? 80 : 12, paddingRight: mac ? 12 : 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 140px)))' }} data-testid="titlebar">
      <div className="flex min-w-0 items-center gap-2">
        {team.logo ? <img src={team.logo} alt="" className="size-4 rounded-sm object-contain" /> : <Gauge className="size-3.5 text-muted-foreground" />}
        <span className="font-semibold tracking-tight">{tt('Celeste CS2')}</span>
        {title && <><span className="text-muted-foreground/50">/</span><span className="truncate text-muted-foreground">{title}</span></>}
      </div>
      <div className="flex flex-1 justify-center">
        <button type="button" onClick={onSearch} style={noDrag}
          className="flex h-6 w-full max-w-sm items-center gap-2 rounded-md border bg-card/50 px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <Search className="size-3" /><span className="flex-1 truncate text-left">{tt('Search pages, rounds, players, commands…')}</span><Kbd className="h-4 text-[10px]">{tt('Ctrl K')}</Kbd>
        </button>
      </div>
      <div className="w-24 shrink-0" />
    </div>
  );
}
