// Petit magasin persistant (localStorage) avec abonnement React : équipe, calendrier, playbook…

import { useSyncExternalStore } from 'react';

export function createLocalStore<T>(key: string, initial: T, valid: (v: unknown) => boolean = () => true) {
  const listeners = new Set<() => void>();
  let value: T = (() => {
    try { const v = JSON.parse(localStorage.getItem(key) ?? 'null'); if (v !== null && valid(v)) return v as T; } catch { /* */ }
    return initial;
  })();
  const get = () => value;
  const set = (next: T | ((prev: T) => T)) => {
    value = typeof next === 'function' ? (next as (p: T) => T)(value) : next;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage plein */ }
    for (const l of listeners) l();
  };
  const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
  const use = () => useSyncExternalStore(subscribe, get);
  return { get, set, subscribe, use };
}

export const newLocalId = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
