// Thème du canvas : lu depuis les variables CSS (thème shadcn/ui neutre sombre, monochrome).

/** Couleurs du camp pour le canvas. */
export interface SidePaint { fill: string; ink: string; ring: string; accent: string }

export interface RenderTheme {
  ct: SidePaint;
  t: SidePaint;
  radarFilter: string;
  /** Fond opaque du canvas (exports lisibles partout). */
  background: string;
  outline: string;
  label: string;
  labelHalo: string;
  smoke: string;
  smokeEdge: string;
  fire: string;
  fireEdge: string;
  bomb: string;
  fontLabel: string;
  fontNumber: string;
  coneAlpha: number;
}

let cached: RenderTheme | null = null;

/** À appeler quand les variables CSS changent (couleurs des équipes). */
export function invalidateRenderTheme(): void { cached = null; }

/** Convertit n'importe quelle couleur CSS (oklch...) en rgb utilisable partout dans le canvas. */
const probe = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
function toRgb(color: string): string {
  if (!probe) return color;
  probe.fillStyle = '#000';
  probe.fillStyle = color;
  return String(probe.fillStyle);
}

export function readRenderTheme(): RenderTheme {
  if (cached) return cached;
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, d: string) => toRgb(cs.getPropertyValue(name).trim() || d);
  const theme: RenderTheme = {
    ct: { fill: v('--ct', '#fafafa'), ink: v('--ct-ink', '#0a0a0a'), ring: v('--ct-ring', '#0a0a0a'), accent: v('--ct-bar', '#fafafa') },
    t: { fill: v('--t', '#404040'), ink: v('--t-ink', '#fafafa'), ring: v('--t-ring', '#e5e5e5'), accent: v('--t-bar', '#a3a3a3') },
    radarFilter: cs.getPropertyValue('--r-filter').trim() || 'none',
    background: v('--card', '#171717'),
    outline: v('--r-outline', '#0a0a0a'),
    label: v('--r-label', '#fafafa'),
    labelHalo: v('--r-label-halo', 'rgba(10,10,10,0.85)'),
    smoke: v('--r-smoke', 'rgba(220,220,220,0.5)'),
    smokeEdge: v('--r-smoke-edge', 'rgba(250,250,250,0.8)'),
    fire: v('--r-fire', 'rgba(239,68,68,0.32)'),
    fireEdge: v('--r-fire-edge', 'rgba(239,68,68,0.9)'),
    bomb: v('--r-bomb', '#ef4444'),
    fontLabel: '500 10.5px "Geist Variable", system-ui, sans-serif',
    fontNumber: '600 9.5px "Geist Mono Variable", ui-monospace, monospace',
    coneAlpha: Number(cs.getPropertyValue('--r-cone-alpha').trim() || '0.35'),
  };
  cached = theme;
  return theme;
}

/** Remplace la taille (en px) d'une déclaration de police canvas. */
export function scaleFont(font: string, k: number): string {
  return font.replace(/(\d+(?:\.\d+)?)px/, (_, n) => `${Math.round(Number(n) * k * 10) / 10}px`);
}
