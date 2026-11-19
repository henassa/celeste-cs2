// Barre latérale : toutes les pages à un clic, le replay en cours reste ouvert quand on navigue.

import type { ComponentType } from 'react';
import {
  Bot, Box, Crosshair, Dumbbell, Flame, House, Keyboard, Layers, ListFilter, PanelLeftClose, PanelLeftOpen,
  Presentation, Radar, Search, Shield, Swords, Trophy, Users, Workflow, FileText, BarChart3, Bomb, BookOpen, CalendarDays, Clapperboard, Library, Monitor, UserRound,
  Target,
} from 'lucide-react';
import { navigate, type AnalysisTab, type ReplayView, type Route, type SettingsSection } from '@/app/router';
import { ProfileSwitcher } from './ProfileSwitcher';
import { useNarrow } from '@/app/use-narrow';
import { isDesktop } from '@/app/desktop';
import { mapDisplayName } from '@/maps/maps';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

type Icon = ComponentType<{ className?: string }>;

// Menu en sections (analyse, stratégies, équipe, scouting, paramètres) ; « soon » : à venir, affiché grisé
type Entry =
  | { kind: 'tab'; tab: AnalysisTab; label: string; icon: Icon }
  | { kind: 'boards'; label: string; icon: Icon }
  | { kind: 'settings'; section: SettingsSection; label: string; icon: Icon }
  | { kind: 'page'; page: 'playbook' | 'reviews' | 'calendar' | 'prep'; label: string; icon: Icon }
  | { kind: 'soon'; label: string; icon: Icon };
const SECTIONS: { title: string; items: Entry[] }[] = [
  { title: tt('Analysis'), items: [
    { kind: 'tab', tab: 'teams', label: tt('Team stats'), icon: Shield }, { kind: 'tab', tab: 'players', label: tt('Player stats'), icon: UserRound },
    { kind: 'tab', tab: 'rounds', label: tt('Rounds'), icon: ListFilter }, { kind: 'tab', tab: 'heatmaps', label: tt('Heatmaps'), icon: Flame },
    { kind: 'tab', tab: 'lineups', label: tt('Lineups & nade finder'), icon: Crosshair },
  ] },
  { title: tt('Strategies'), items: [
    { kind: 'page', page: 'playbook', label: tt('Playbook'), icon: BookOpen }, { kind: 'boards', label: tt('Boards'), icon: Presentation }, { kind: 'tab', tab: 'strategies', label: tt('Detected strats'), icon: Workflow },
  ] },
  { title: tt('Team'), items: [
    { kind: 'tab', tab: 'training', label: tt('Training'), icon: Dumbbell }, { kind: 'page', page: 'reviews', label: tt('Reviews'), icon: Clapperboard }, { kind: 'page', page: 'calendar', label: tt('Calendar'), icon: CalendarDays },
  ] },
  { title: tt('Scout'), items: [
    { kind: 'page', page: 'prep', label: tt('Match prep'), icon: Target }, { kind: 'tab', tab: 'brief', label: tt('Anti-strat brief'), icon: FileText }, { kind: 'tab', tab: 'series', label: tt('Series'), icon: Trophy }, { kind: 'tab', tab: 'veto', label: tt('Veto'), icon: Swords },
  ] },
  { title: tt('Settings'), items: [
    { kind: 'settings', section: 'team', label: tt('My team'), icon: Users }, { kind: 'settings', section: '3d', label: '3D maps & models', icon: Box }, { kind: 'settings', section: 'display', label: tt('Display'), icon: Monitor },
  ] },
];
const REPLAY: { view: ReplayView; label: string; icon: Icon }[] = [
  { view: 'replay', label: tt('Replay'), icon: Radar }, { view: '3d', label: tt('Replay in 3D'), icon: Box }, { view: 'overlay', label: tt('Overlay'), icon: Layers },
  { view: 'grenades', label: tt('Grenades'), icon: Bomb }, { view: 'stats', label: tt('Stats'), icon: BarChart3 },
];

interface Props {
  route: Route;
  collapsed: boolean;
  onCollapse: () => void;
  match: { map: string; fileName: string; score: string } | null;
  coachOpen: boolean;
  onCoach: () => void;
  onPalette: () => void;
  onShortcuts: () => void;
}

function Item({ icon: I, label, active, collapsed, onClick, hint, testId, soon }: { icon: Icon; label: string; active?: boolean; collapsed: boolean; onClick?: () => void; hint?: string; testId?: string; soon?: boolean }) {
  const btn = (
    <button type="button" onClick={onClick} data-testid={testId} aria-current={active ? 'page' : undefined} disabled={soon} aria-disabled={soon}
      className={cn('flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
        active && 'bg-accent font-medium text-foreground', collapsed && 'justify-center px-0')}>
      <I className="size-4 shrink-0" />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && hint && <Kbd className="h-4 text-[10px]">{hint}</Kbd>}
      {!collapsed && soon && <span className="rounded border px-1 text-[9px] font-medium tracking-wide">{tt('SOON')}</span>}
    </button>
  );
  if (!collapsed) return btn;
  return <Tooltip><TooltipTrigger asChild>{btn}</TooltipTrigger><TooltipContent side="right">{label}{hint ? ` (${hint})` : ''}{soon ? ' (soon)' : ''}</TooltipContent></Tooltip>;
}

export function Sidebar({ route, collapsed, onCollapse, match, coachOpen, onCoach, onPalette, onShortcuts }: Props) {
  const narrow = useNarrow();
  const Section = ({ title }: { title: string }) => (collapsed ? <div className="mx-2 my-2 h-px bg-border" /> : <div className="px-2 pt-3 pb-1 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/70 uppercase">{title}</div>);
  return (
    <nav className={cn('flex h-full shrink-0 flex-col border-r bg-card/40 py-2 print:hidden', collapsed ? 'w-[52px] px-1.5' : 'w-[212px] px-2')} aria-label={tt('Main')}>
      <ProfileSwitcher collapsed={collapsed} />
      {!isDesktop && <button type="button" onClick={onPalette} data-testid="open-palette"
        className={cn('mt-1 mb-1 flex h-8 items-center gap-2 rounded-md border bg-background/50 px-2 text-[13px] text-muted-foreground hover:text-foreground', collapsed && 'justify-center px-0')}>
        <Search className="size-3.5" />{!collapsed && <><span className="flex-1 text-left">{tt('Search…')}</span>{!narrow && <Kbd className="h-4 text-[10px]">{tt('Ctrl K')}</Kbd>}</>}
      </button>}
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        <Item icon={House} label={tt('Dashboard')} collapsed={collapsed} active={route.page === 'home'} onClick={() => navigate({ page: 'home' })} testId="nav-home" />
        <Item icon={Library} label={tt('Library')} collapsed={collapsed} active={route.page === 'library'} onClick={() => navigate({ page: 'library' })} testId="nav-library" />
        {match && (
          <>
            <Section title={`${mapDisplayName(match.map)} · ${match.score}`} />
            {REPLAY.filter((r) => !narrow || r.view !== 'overlay').map((r) => (
              <Item key={r.view} icon={r.icon} label={r.label} collapsed={collapsed} testId={`nav-replay-${r.view}`}
                active={route.page === 'replay' && route.view === r.view} onClick={() => navigate({ page: 'replay', view: r.view })} />
            ))}
          </>
        )}
        {SECTIONS.map((g) => (
          <div key={g.title} className="space-y-0.5">
            <Section title={g.title} />
            {g.items.map((it) => it.kind === 'tab' ? (
              <Item key={it.label} icon={it.icon} label={it.label} collapsed={collapsed} testId={`nav-${it.tab}`}
                active={route.page === 'analysis' && route.tab === it.tab} onClick={() => navigate({ page: 'analysis', tab: it.tab })} />
            ) : it.kind === 'boards' ? (
              <Item key={it.label} icon={it.icon} label={it.label} collapsed={collapsed} testId="nav-boards" active={route.page === 'boards' || route.page === 'board'} onClick={() => navigate({ page: 'boards' })} />
            ) : it.kind === 'page' ? (
              <Item key={it.label} icon={it.icon} label={it.label} collapsed={collapsed} testId={`nav-${it.page}`} active={route.page === it.page} onClick={() => navigate({ page: it.page })} />
            ) : it.kind === 'settings' ? (
              <Item key={it.label} icon={it.icon} label={it.label} collapsed={collapsed} testId={`nav-settings-${it.section}`} active={route.page === 'settings' && route.section === it.section} onClick={() => navigate({ page: 'settings', section: it.section })} />
            ) : (
              <Item key={it.label} icon={it.icon} label={it.label} collapsed={collapsed} soon />
            ))}
          </div>
        ))}
      </div>
      <div className="space-y-0.5 border-t pt-2">
        <Item icon={Bot} label={tt('Coach')} hint="C" collapsed={collapsed} active={coachOpen} onClick={onCoach} testId="nav-coach" />
        {!narrow && <Item icon={Keyboard} label={tt('Shortcuts')} hint="?" collapsed={collapsed} onClick={onShortcuts} />}
        {!narrow && <Item icon={collapsed ? PanelLeftOpen : PanelLeftClose} label={collapsed ? tt('Expand') : tt('Collapse')} hint="[" collapsed={collapsed} onClick={onCollapse} />}
      </div>
    </nav>
  );
}
