// Calibrage des radars CS2 (valeurs issues de CS Demo Manager, licence MIT).
// Conversion monde -> radar : px = (x - posX) / scale, py = (posY - y) / scale, sur une image 1024 px.

import data from './maps.json';

export interface MapCalibration {
  posX: number;
  posY: number;
  scale: number;
  /** Sous ce Z, le joueur est au niveau inférieur (Nuke, Vertigo, Train...). */
  lowerThresholdZ: number | null;
  hasLower: boolean;
  /** Radar ajouté sur cette machine (PNG extrait du jeu) au lieu des WebP livrés. */
  radar?: 'png';
  /** Map ajoutée par l'utilisateur (workshop, map récente). */
  user?: boolean;
}

export const RADAR_SIZE = 1024;

const MAPS = { ...(data as Record<string, MapCalibration>) };

/** Maps ajoutées sur cette machine (workshop, maps récentes) : calibrations écrites par l'extraction. */
export async function loadUserMaps(): Promise<void> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}maps/maps.json`, { cache: 'no-store' });
    if (!r.ok || (r.headers.get('content-type') ?? '').includes('html')) return;
    const extra = (await r.json()) as Record<string, MapCalibration>;
    for (const [k, v] of Object.entries(extra)) if (v && typeof v.posX === 'number' && typeof v.scale === 'number') MAPS[k] = { ...v, user: true };
  } catch { /* aucune map ajoutée */ }
}

/** Toutes les maps connues (livrées + ajoutées). */
export const knownMaps = () => Object.keys(MAPS);

export function getMap(name: string): MapCalibration | null {
  return MAPS[name] ?? null;
}

export function radarUrl(name: string, lower = false): string {
  return `${import.meta.env.BASE_URL}maps/${name}${lower ? '_lower' : ''}.${MAPS[name]?.radar === 'png' ? 'png' : 'webp'}`;
}

export function worldToRadar(m: MapCalibration, x: number, y: number): [number, number] {
  return [(x - m.posX) / m.scale, (m.posY - y) / m.scale];
}

/** Point du radar (0..1024) -> monde. */
export function radarToWorld(m: MapCalibration, rx: number, ry: number): [number, number] {
  return [m.posX + rx * m.scale, m.posY - ry * m.scale];
}

export function isLower(m: MapCalibration, z: number): boolean {
  return m.hasLower && m.lowerThresholdZ !== null && z < m.lowerThresholdZ;
}

/** Nom d'affichage : de_mirage -> Mirage. */
export function mapDisplayName(name: string): string {
  const base = name.replace(/^(de|cs|ar)_/, '');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Pool Active Duty (Premier et compétitions) fixé par Valve le 8 juillet 2026 : Cache a remplacé Overpass.
 * Valve le change environ deux fois par an : l'onglet Veto permet d'ajuster le pool à la main.
 */
export const ACTIVE_DUTY = ['de_ancient', 'de_anubis', 'de_cache', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke'];

/** Cartes proposées en premier (Active Duty puis anciennes cartes du pool), le reste suit par ordre alphabétique. */
export const COMPETITIVE_MAPS = [...ACTIVE_DUTY, 'de_overpass', 'de_train', 'de_vertigo'];

export function allMapNames(): string[] {
  const rest = Object.keys(MAPS).filter((n) => !COMPETITIVE_MAPS.includes(n)).sort();
  return [...COMPETITIVE_MAPS.filter((n) => MAPS[n]), ...rest];
}
