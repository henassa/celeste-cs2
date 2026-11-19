// Qualité d'image de la 3D : Auto (mesurée au chargement), Haute, Performance. Fixe pendant l'utilisation.
import { createLocalStore } from './local-store';
export type Quality3D = 'auto' | 'high' | 'performance';
export const quality3dStore = createLocalStore<Quality3D>('scrimview.3d.quality', 'auto', (v) => v === 'auto' || v === 'high' || v === 'performance');
