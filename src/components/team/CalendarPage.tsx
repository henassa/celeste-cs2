// Calendrier : mois, événements de l'équipe (scrims, officiels, entraînements, reviews) et matchs de la
// bibliothèque rangés sur leur jour. Un adversaire mène à sa préparation de match.

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Plus, Trash2 } from 'lucide-react';
import { calendarStore, dayKey, EVENT_KIND, type CalendarEvent, type EventKind } from '@/app/calendar';
import { newLocalId } from '@/app/local-store';
import { navigate } from '@/app/router';
import { ourSide, useMyTeam } from '@/app/my-team';
import { listMatches, type LibraryMatch } from '@/library/library';
import { knownMaps, mapDisplayName } from '@/maps/maps';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { locale, tt } from '@/i18n';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const KIND_CLS: Record<EventKind, string> = { scrim: 'bg-foreground text-background', official: 'bg-amber-500/90 text-black', practice: 'border', review: 'border border-dashed' };

export function CalendarPage() {
  const events = calendarStore.use();
  const team = useMyTeam();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selected, setSelected] = useState<string>(() => dayKey(new Date()));
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [matches, setMatches] = useState<LibraryMatch[]>([]);
  useEffect(() => { listMatches().then(setMatches); }, []);

  // Grille du mois (semaines du lundi au dimanche)
  const days = useMemo(() => {
    const first = new Date(month);
    const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [month]);
  const byDay = useMemo(() => {
    const m = new Map<string, { events: CalendarEvent[]; matches: LibraryMatch[] }>();
    const at = (k: string) => { let e = m.get(k); if (!e) m.set(k, (e = { events: [], matches: [] })); return e; };
    for (const e of events) at(e.day).events.push(e);
    for (const x of matches) at(dayKey(new Date(x.date))).matches.push(x);
    for (const v of m.values()) v.events.sort((a, b) => a.time.localeCompare(b.time));
    return m;
  }, [events, matches]);
  const sel = byDay.get(selected) ?? { events: [], matches: [] };
  const today = dayKey(new Date());

  const save = (e: CalendarEvent) => { calendarStore.set((all) => (all.some((x) => x.id === e.id) ? all.map((x) => (x.id === e.id ? e : x)) : [...all, e])); setEditing(null); };
  const blank = (day: string): CalendarEvent => ({ id: newLocalId(), day, time: '20:00', kind: 'scrim', opponent: '', map: '', notes: '' });

  return (
    <div className="grid h-full min-h-0 grid-cols-1 auto-rows-max overflow-y-auto md:auto-rows-auto md:overflow-visible md:grid-cols-[1fr_340px] gap-2 p-2" data-testid="calendar">
      <div className="flex min-h-0 flex-col rounded-xl border bg-card p-3">
        <div className="mb-2 flex items-center gap-2">
          <h1 className="flex-1 text-lg font-semibold">{month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</h1>
          <Button size="icon-sm" variant="ghost" aria-label={tt('Previous month')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></Button>
          <Button size="sm" variant="outline" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(dayKey(d)); }}>{tt('Today')}</Button>
          <Button size="icon-sm" variant="ghost" aria-label={tt('Next month')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></Button>
          <Button size="sm" onClick={() => setEditing(blank(selected))}><Plus /> {tt('Event')}</Button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">{WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}</div>
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-px overflow-hidden rounded-lg border bg-border">
          {days.map((d) => {
            const k = dayKey(d), inMonth = d.getMonth() === month.getMonth(), e = byDay.get(k);
            return (
              <button key={k} type="button" onClick={() => setSelected(k)} onDoubleClick={() => setEditing(blank(k))}
                className={cn('flex min-h-0 flex-col items-stretch gap-0.5 overflow-hidden bg-card p-1 text-left hover:bg-accent/60', !inMonth && 'opacity-40', selected === k && 'ring-1 ring-foreground ring-inset')}>
                <span className={cn('num self-end rounded px-1 text-[11px]', k === today && 'bg-foreground text-background')}>{d.getDate()}</span>
                {e?.events.slice(0, 3).map((ev) => (
                  <span key={ev.id} className={cn('truncate rounded px-1 text-[10px] leading-4', KIND_CLS[ev.kind])}>{ev.time && `${ev.time} `}{ev.opponent || EVENT_KIND[ev.kind]}</span>
                ))}
                {e && e.matches.length > 0 && <span className="truncate px-1 text-[10px] text-muted-foreground">{e.matches.length} {tt('demo')}{e.matches.length === 1 ? '' : 's'}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
        {editing ? <EventEditor event={editing} onSave={save} onCancel={() => setEditing(null)} onDelete={() => { calendarStore.set((all) => all.filter((x) => x.id !== editing.id)); setEditing(null); }} /> : (
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">{new Date(`${selected}T12:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
              <Button size="sm" variant="outline" onClick={() => setEditing(blank(selected))}><Plus /> {tt('Add')}</Button>
            </div>
            {sel.events.length === 0 && sel.matches.length === 0 && <p className="text-xs text-muted-foreground">{tt('Nothing this day. Double-click a day to add an event.')}</p>}
            {sel.events.map((ev) => (
              <div key={ev.id} className="space-y-1 rounded-lg border p-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <span className={cn('rounded px-1.5 text-[10px] leading-4', KIND_CLS[ev.kind])}>{EVENT_KIND[ev.kind]}</span>
                  <span className="num text-muted-foreground">{ev.time}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{ev.opponent || '—'}</span>
                  <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setEditing(ev)}>{tt('Edit')}</button>
                </div>
                {ev.map && <div className="text-xs text-muted-foreground">{mapDisplayName(ev.map)}</div>}
                {ev.notes && <p className="text-xs whitespace-pre-wrap text-muted-foreground">{ev.notes}</p>}
                {ev.opponent && <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => navigate({ page: 'prep', team: ev.opponent })}><FileText className="size-3" /> {tt('Prepare')}</button>}
              </div>
            ))}
            {sel.matches.map((m) => {
              const side = ourSide(m, team), us = side ?? 0;
              return (
                <div key={m.id} className="flex items-center gap-2 rounded-lg border border-dashed p-2.5 text-xs">
                  <span className="font-medium">{mapDisplayName(m.map)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{m.teams[us]} {tt('vs') + ' '}{m.teams[1 - us]}</span>
                  <span className="num">{m.score[us]}–{m.score[1 - us]}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function EventEditor({ event, onSave, onCancel, onDelete }: { event: CalendarEvent; onSave: (e: CalendarEvent) => void; onCancel: () => void; onDelete: () => void }) {
  const [e, setE] = useState(event);
  const isNew = !calendarStore.get().some((x) => x.id === event.id);
  return (
    <form className="space-y-3 rounded-xl border bg-card p-4" onSubmit={(f) => { f.preventDefault(); onSave(e); }} data-testid="event-editor">
      <h2 className="text-sm font-medium">{isNew ? tt('New event') : tt('Edit event')}</h2>
      <div className="grid grid-cols-4 gap-1">
        {(Object.keys(EVENT_KIND) as EventKind[]).map((k) => (
          <button key={k} type="button" onClick={() => setE({ ...e, kind: k })} className={cn('rounded-md border px-1 py-1 text-xs hover:bg-accent', e.kind === k && 'bg-accent font-medium')}>{EVENT_KIND[k]}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-muted-foreground">{tt('Day')}<Input type="date" value={e.day} onChange={(x) => setE({ ...e, day: x.target.value })} required /></label>
        <label className="space-y-1 text-xs text-muted-foreground">{tt('Time')}<Input type="time" value={e.time} onChange={(x) => setE({ ...e, time: x.target.value })} /></label>
      </div>
      <label className="block space-y-1 text-xs text-muted-foreground">{tt('Opponent')}<Input value={e.opponent} onChange={(x) => setE({ ...e, opponent: x.target.value })} placeholder={tt('Team name')} /></label>
      <label className="block space-y-1 text-xs text-muted-foreground">{tt('Map')}
        <select className="h-9 w-full rounded-md border bg-transparent px-2 text-sm text-foreground" value={e.map} onChange={(x) => setE({ ...e, map: x.target.value })}>
          <option value="">{tt('Not decided')}</option>
          {knownMaps().filter((m) => m.startsWith('de_')).map((m) => <option key={m} value={m}>{mapDisplayName(m)}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-xs text-muted-foreground">{tt('Notes')}<Textarea value={e.notes} onChange={(x) => setE({ ...e, notes: x.target.value })} rows={3} placeholder={tt('Server, password, what to work on…')} /></label>
      <div className="flex gap-2">
        <Button type="submit" size="sm">{tt('Save')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{tt('Cancel')}</Button>
        {!isNew && <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onDelete}><Trash2 /> {tt('Delete')}</Button>}
      </div>
    </form>
  );
}
