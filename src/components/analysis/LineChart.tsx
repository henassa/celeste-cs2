// Courbe de progression par match (une ou deux séries), SVG, survol avec ligne verticale et infobulle.

import { useMemo, useRef, useState } from 'react';

export interface Series {
  name: string;
  /** Valeur par point (null = absent). */
  values: (number | null)[];
  dashed?: boolean;
}

interface Props {
  labels: string[];
  series: Series[];
  format: (v: number) => string;
  height?: number;
}

const PAD = { l: 36, r: 12, t: 12, b: 22 };

export function LineChart({ labels, series, format, height = 180 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(400);
  const n = labels.length;

  const { min, max } = useMemo(() => {
    const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
    if (!all.length) return { min: 0, max: 1 };
    let lo = Math.min(...all), hi = Math.max(...all);
    const pad = (hi - lo) * 0.15 || 0.1;
    lo -= pad; hi += pad;
    return { min: lo, max: hi };
  }, [series]);

  const x = (i: number) => PAD.l + (n <= 1 ? (width - PAD.l - PAD.r) / 2 : (i / (n - 1)) * (width - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (height - PAD.t - PAD.b);
  const ticks = [min + (max - min) * 0.15, (min + max) / 2, max - (max - min) * 0.15];

  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (el && Math.abs(el.clientWidth - width) > 2) setWidth(el.clientWidth);
      }}
      className="relative w-full select-none"
      onMouseMove={(e) => {
        const rect = ref.current!.getBoundingClientRect();
        const px = e.clientX - rect.left;
        let best = 0, bd = Infinity;
        for (let i = 0; i < n; i++) { const d = Math.abs(x(i) - px); if (d < bd) { bd = d; best = i; } }
        setHover(n ? best : null);
      }}
      onMouseLeave={() => setHover(null)}
    >
      <svg width={width} height={height} role="img" aria-label={series.map((s) => s.name).join(' vs ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground font-mono text-[10px]">{format(t)}</text>
          </g>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={height - PAD.b} stroke="var(--muted-foreground)" strokeWidth={1} />}
        {series.map((s, si) => {
          const color = si === 0 ? 'var(--foreground)' : 'var(--muted-foreground)';
          let d = '';
          s.values.forEach((v, i) => { if (v !== null) d += `${d ? 'L' : 'M'}${x(i)},${y(v)}`; });
          return (
            <g key={s.name}>
              <path d={d} fill="none" stroke={color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" />
              {s.values.map((v, i) => v !== null && (
                <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 4.5 : 3} fill={color} stroke="var(--card)" strokeWidth={2} />
              ))}
            </g>
          );
        })}
        {n > 1 && [0, n - 1].map((i) => (
          <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : 'end'} className="fill-muted-foreground text-[10px]">{labels[i]}</text>
        ))}
      </svg>
      {series.length > 1 && (
        <div className="mt-1 flex gap-4 text-xs text-muted-foreground">
          {series.map((s, si) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <svg width="18" height="6"><line x1="0" x2="18" y1="3" y2="3" stroke={si === 0 ? 'var(--foreground)' : 'var(--muted-foreground)'} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} /></svg>
              {s.name}
            </span>
          ))}
        </div>
      )}
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 rounded-md border bg-popover px-2 py-1 text-xs shadow-sm"
          style={{ left: Math.min(width - 150, Math.max(0, x(hover) + 8)) }}>
          <div className="text-muted-foreground">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.name} className="flex justify-between gap-3"><span>{s.name}</span><span className="num">{s.values[hover] !== null ? format(s.values[hover]!) : '—'}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}
