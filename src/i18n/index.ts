// Langue de l'interface (anglais / français). Les textes sont écrits en anglais dans le code et
// passent par t('…') : la traduction française est cherchée par le texte anglais lui-même, et un
// texte sans traduction reste en anglais. Les valeurs variables s'écrivent {0}, {1}… ou {nom}.
//
// Changer de langue recharge l'app : les libellés calculés au chargement sont relus dans la bonne langue.

import { FR } from './fr';

export type LangSetting = 'auto' | 'en' | 'fr';
export type Lang = 'en' | 'fr';
const KEY = 'scrimview.lang';

export function getLangSetting(): LangSetting {
  try { const v = localStorage.getItem(KEY); if (v === 'en' || v === 'fr' || v === 'auto') return v; } catch { /* */ }
  return 'auto';
}
function resolve(s: LangSetting): Lang {
  if (s !== 'auto') return s;
  const nav = typeof navigator !== 'undefined' ? (navigator.languages?.[0] ?? navigator.language ?? 'en') : 'en';
  return nav.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}
export const lang: Lang = resolve(getLangSetting());
if (typeof document !== 'undefined') document.documentElement.lang = lang;

export function setLang(s: LangSetting): void {
  try { localStorage.setItem(KEY, s); } catch { /* */ }
  if (resolve(s) !== lang) location.reload();
}

type Vars = readonly unknown[] | Record<string, unknown>;
const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => { const v = (vars as Record<string, unknown>)[k]; return v === undefined || v === null ? m : String(v); }) : s);

/** Texte traduit (clé = texte anglais). */
export function t(en: string, vars?: Vars): string {
  return fill(lang === 'fr' ? FR[en] ?? en : en, vars);
}

/** Nombre + nom accordé : tn(3, 'map', 'maps'). */
export function tn(n: number, one: string, many: string): string {
  return t(n === 1 ? one : many, [n]);
}

/** Format de date / nombre selon la langue. */
export const locale = lang === 'fr' ? 'fr-FR' : 'en-US';

/** Alias de t() pour les composants (le nom t est souvent pris par une variable locale). */
export const tt = t;
