// Rampes séquentielles pour les heatmaps : une seule teinte, du sombre (peu) au clair (beaucoup)
// sur fond sombre. Pas d'arc-en-ciel : l'intensité se lit sans légende de couleurs multiples.

export type RampId = 'mono' | 'blue' | 'orange';

import { tt } from '../i18n';

export const RAMPS: Record<RampId, { label: string; stops: string[] }> = {
  mono: { label: tt('Mono'), stops: ['#3a3a3a', '#8c8c8c', '#d4d4d4', '#fafafa'] },
  // Pas 700 -> 100 de la rampe bleue de référence (inversée pour le mode sombre)
  blue: { label: tt('Blue'), stops: ['#0d366b', '#1c5cab', '#3987e5', '#86b6ef', '#cde2fb'] },
  orange: { label: tt('Orange'), stops: ['#4a1d0c', '#9a3b16', '#eb6834', '#f5a07c', '#fcdccc'] },
};

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Couleur [r, g, b] pour une valeur 0..1 (interpolation linéaire entre les pas). */
export function rampColor(id: RampId, v: number): [number, number, number] {
  const stops = RAMPS[id].stops.map(hex);
  const x = Math.max(0, Math.min(1, v)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const t = x - i;
  const a = stops[i], b = stops[i + 1];
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

export const rampCss = (id: RampId) => `linear-gradient(to right, ${RAMPS[id].stops.join(', ')})`;
