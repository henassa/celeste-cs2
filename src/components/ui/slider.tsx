// Curseur simple (input range natif, accessible au clavier), stylé comme le reste de l'interface.

import { cn } from '@/lib/utils';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  className?: string;
}

export function Slider({ label, value, min, max, step = 1, onChange, format = String, className }: Props) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="flex justify-between text-[11px] text-muted-foreground"><span>{label}</span><span className="num text-foreground">{format(value)}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))} onKeyDown={(e) => e.stopPropagation()}
        className="slider h-4 w-full cursor-pointer appearance-none bg-transparent"
        style={{ ['--pct' as string]: `${pct}%` }} />
    </label>
  );
}
