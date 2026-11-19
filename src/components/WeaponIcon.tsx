// Icônes d'armes et d'équipement (silhouettes de CS Demo Manager, licence MIT), en couleur du texte.

import { memo } from 'react';
import { cn } from '@/lib/utils';

import { ICONS, iconFor } from '@/assets/icons';

export { iconFor };

export const WeaponIcon = memo(function WeaponIcon({ weapon, className, title }: { weapon: string; className?: string; title?: string }) {
  const name = iconFor(weapon);
  const svg = name ? ICONS[name] : null;
  if (!svg) return title === undefined ? <span className={cn('text-[10px]', className)}>{weapon}</span> : null;
  return <span role="img" aria-label={title ?? weapon} title={title ?? weapon} className={cn('inline-flex h-4 shrink-0 items-center [&>svg]:h-full [&>svg]:w-auto', className)} dangerouslySetInnerHTML={{ __html: svg }} />;
});
