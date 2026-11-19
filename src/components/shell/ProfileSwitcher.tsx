// En-tête du menu latéral : le profil d'équipe actif, et la liste pour en changer ou en créer un.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, ChevronsUpDown, Gauge, Plus, Settings } from 'lucide-react';
import { createProfile, getProfiles, subscribeProfiles, switchProfile } from '@/app/profiles';
import { navigate } from '@/app/router';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

export function ProfileSwitcher({ collapsed }: { collapsed: boolean }) {
  const { active, list } = useSyncExternalStore(subscribeProfiles, getProfiles);
  const team = list.find((p) => p.id === active) ?? list[0];
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); setNaming(null); } };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setNaming(null); } };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const create = () => { const n = naming?.trim(); if (!n) return; const id = createProfile(n); switchProfile(id); };
  const Logo = ({ logo, size = 'size-7' }: { logo: string | null; size?: string }) => (logo ? <img src={logo} alt="" className={cn(size, 'shrink-0 rounded-md object-contain')} /> : <span className={cn(size, 'flex shrink-0 items-center justify-center rounded-md border')}><Gauge className="size-3.5" /></span>);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} data-testid="profile-switcher" aria-haspopup="menu" aria-expanded={open}
        className={cn('flex h-11 w-full items-center gap-2 rounded-md px-1 text-left hover:bg-accent/50', collapsed && 'justify-center px-0')} title={team.name || tt('Set up your team')}>
        <Logo logo={team.logo} />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block text-sm leading-tight font-semibold tracking-tight">{tt('Celeste CS2')}</span>
              <span className="block truncate text-[11px] leading-tight text-muted-foreground">{team.name || tt('Set up your team')}</span>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
      </button>
      {open && (
        <div role="menu" className="absolute top-12 left-0 z-50 w-60 space-y-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
          <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground/70 uppercase">{tt('Team profiles')}</div>
          {list.map((p) => (
            <button key={p.id} type="button" role="menuitem" onClick={() => { setOpen(false); switchProfile(p.id); }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
              <Logo logo={p.logo} size="size-5" />
              <span className="min-w-0 flex-1 truncate">{p.name || tt('Unnamed team')}</span>
              {p.id === active && <Check className="size-3.5" />}
            </button>
          ))}
          <div className="my-1 h-px bg-border" />
          {naming === null ? (
            <button type="button" role="menuitem" onClick={() => setNaming('')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent" data-testid="new-profile"><Plus className="size-3.5" /> {tt('New team profile')}</button>
          ) : (
            <form className="flex gap-1 p-1" onSubmit={(e) => { e.preventDefault(); create(); }}>
              <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder={tt('Team name')} maxLength={40} className="h-7 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-sm" aria-label={tt('New team name')} />
              <button type="submit" disabled={!naming.trim()} className="h-7 rounded-md bg-primary px-2 text-xs text-primary-foreground disabled:opacity-50">{tt('Create')}</button>
            </form>
          )}
          <button type="button" role="menuitem" onClick={() => { setOpen(false); navigate({ page: 'settings', section: 'team' }); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"><Settings className="size-3.5" /> {tt('Manage profiles')}</button>
        </div>
      )}
    </div>
  );
}
