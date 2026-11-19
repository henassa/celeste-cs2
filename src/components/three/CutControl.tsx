// Coupe horizontale de la carte 3D : masque ce qui est au-dessus (toits, plafonds, étage).

import { Scissors } from 'lucide-react';
import type { MapScene } from '@/three/map-scene';
import { tt } from '@/i18n';

export function CutControl({ scene, value, onChange }: { scene: MapScene | null; value: number | null; onChange: (z: number | null) => void }) {
  if (!scene) return null;
  const [lo, hi] = scene.zRange;
  if (hi <= lo) return null;
  const v = value ?? hi;
  return (
    <div className="flex items-center gap-2 rounded-md border bg-overlay px-2 py-1 text-[11px] text-overlay-foreground backdrop-blur-sm">
      <Scissors className="size-3.5" />
      <span>{tt('Cut')}</span>
      <input type="range" min={lo + 100} max={hi} step={10} value={v} aria-label={tt('Hide everything above this height')}
        onChange={(e) => { const z = Number(e.target.value); onChange(z >= hi - 5 ? null : z); }} onKeyDown={(e) => e.stopPropagation()}
        className="slider h-4 w-28 cursor-pointer appearance-none bg-transparent" style={{ ['--pct' as string]: `${((v - lo - 100) / (hi - lo - 100)) * 100}%` }} />
      <span className="num w-12 text-right text-muted-foreground">{value === null ? 'off' : `${Math.round(value)}`}</span>
    </div>
  );
}
