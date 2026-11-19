// Accès IndexedDB partagé (base locale « scrimview »). Rien ne quitte le navigateur.

const DB = 'scrimview';
const VERSION = 3;
export const STORES = { scrims: 'scrims', matches: 'matches', boards: 'boards' } as const;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.scrims)) db.createObjectStore(STORES.scrims);
      if (!db.objectStoreNames.contains(STORES.matches)) db.createObjectStore(STORES.matches);
      if (!db.objectStoreNames.contains(STORES.boards)) db.createObjectStore(STORES.boards);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

export async function idbGet<T>(store: string, key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut<T>(store: string, key: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

/** Paires clé / valeur d'un magasin (les clés sont des chaînes ici). */
export async function idbEntries<T>(store: string): Promise<[string, T][]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out: [string, T][] = [];
    const req = db.transaction(store).objectStore(store).openCursor();
    req.onsuccess = () => { const c = req.result; if (c) { out.push([String(c.key), c.value as T]); c.continue(); } else resolve(out); };
    req.onerror = () => reject(req.error);
  });
}

/** Supprime les entrées dont la clé vérifie le test, dans les magasins donnés. */
export async function idbDeleteWhere(test: (key: string) => boolean, stores: string[]): Promise<void> {
  for (const store of stores) for (const [k] of await idbEntries(store)) if (test(k)) await idbDelete(store, k);
}
