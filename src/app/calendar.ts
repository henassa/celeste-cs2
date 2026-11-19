// Calendrier de l'équipe : scrims, officiels, entraînements, reviews. Gardé dans ce navigateur.

import { scopedKey } from './profiles';
import { createLocalStore } from './local-store';
import { tt } from '../i18n';

export type EventKind = 'scrim' | 'official' | 'practice' | 'review';
export interface CalendarEvent {
  id: string;
  /** Jour local AAAA-MM-JJ. */
  day: string;
  /** Heure HH:MM (facultative). */
  time: string;
  kind: EventKind;
  opponent: string;
  map: string;
  notes: string;
}

export const EVENT_KIND: Record<EventKind, string> = { scrim: tt('Scrim'), official: tt('Official'), practice: tt('Practice'), review: tt('Review') };

export const calendarStore = createLocalStore<CalendarEvent[]>(scopedKey('scrimview.calendar'), [], Array.isArray);

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Prochains événements (à partir d'aujourd'hui), triés. */
export function upcoming(events: CalendarEvent[], now = new Date(), n = 3): CalendarEvent[] {
  const today = dayKey(now);
  return events.filter((e) => e.day >= today).sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time)).slice(0, n);
}
