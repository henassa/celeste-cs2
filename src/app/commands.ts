// Registre des commandes de la palette (Ctrl+K) : chaque écran déclare les siennes tant qu'il est affiché.

import { useEffect, useSyncExternalStore } from 'react';

export interface Command {
  id: string;
  title: string;
  group: string;
  /** Mots-clés supplémentaires pour la recherche. */
  keywords?: string;
  shortcut?: string;
  run: () => void;
}

const sources = new Map<string, Command[]>();
const subs = new Set<() => void>();
let snapshot: Command[] = [];
const emit = () => { snapshot = [...sources.values()].flat(); subs.forEach((s) => s()); };

export function useCommands(source: string, cmds: Command[]): void {
  useEffect(() => { sources.set(source, cmds); emit(); return () => { sources.delete(source); emit(); }; }, [source, cmds]);
}

export function useAllCommands(): Command[] {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => snapshot);
}

/** Recherche floue simple : toutes les lettres dans l'ordre, bonus aux débuts de mots. */
export function scoreCommand(c: Command, q: string): number {
  if (!q) return 1;
  const text = `${c.title} ${c.group} ${c.keywords ?? ''}`.toLowerCase();
  const query = q.toLowerCase().trim();
  if (text.includes(query)) return 100 - text.indexOf(query) + (c.title.toLowerCase().startsWith(query) ? 50 : 0);
  let i = 0, score = 0;
  for (const ch of query) {
    if (ch === ' ') continue;
    const j = text.indexOf(ch, i);
    if (j < 0) return 0;
    score += j === i ? 3 : (text[j - 1] === ' ' ? 2 : 1);
    i = j + 1;
  }
  return score;
}
