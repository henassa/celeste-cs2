// Vue Overlay : plusieurs rounds d'une même équipe superposés sur le radar, synchronisés sur
// la fin du freeze time. Sert à lire les setups et les exécutions récurrentes d'un coup d'œil.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack } from 'lucide-react';
import { FLAG_ALIVE, SAMPLE_STEP, type MatchData, type TeamIndex } from '@/data/types';
import { getMap, isLower, radarUrl, RADAR_SIZE, worldToRadar } from '@/maps/maps';
import { playerState } from '@/viewer/sample';
import { readRenderTheme } from '@/viewer/theme';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { tt } from '@/i18n';

const TRAIL_SEC = 4;
const SPEEDS = [1, 2, 4] as const;

interface Props {
  match: MatchData;
  /** Ouvre un round dans le lecteur, `sec` secondes après le freeze. */
  onOpen: (round: number, sec: number) => void;
}

export function OverlayView({ match: m, onOpen }: Props) {
  const [team, setTeam] = useState<TeamIndex>(0);
  const [side, setSide] = useState<'ct' | 't'>('t');
  const [result, setResult] = useState<'all' | 'won' | 'lost'>('all');
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [sec, setSec] = useState(15);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [layer, setLayer] = useState<'upper' | 'lower'>('upper');
  const cal = getMap(m.header.map);

  // Rounds candidats : l'équipe du bon côté, filtrés par résultat
  const candidates = useMemo(() => m.rounds.filter((r) =>
    (r.ctTeam === team) === (side === 'ct') && (result === 'all' || (r.winnerTeam === team) === (result === 'won'))), [m, team, side, result]);
  const rounds = candidates.filter((r) => !excluded.has(r.index));
  const maxSec = Math.max(20, ...rounds.map((r) => (r.endTick - r.freezeEndTick) / m.tickrate));

  // Lecture
  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), raf = 0;
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setSec((s) => {
        const n = s + dt * speed;
        if (n >= maxSec) { setPlaying(false); return maxSec; }
        return n;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, maxSec]);

  const players = m.players.map((p, i) => ({ ...p, i })).filter((p) => p.team === team);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 auto-rows-max overflow-y-auto md:auto-rows-auto md:overflow-visible md:grid-cols-[300px_1fr] gap-2">
      <div className="min-h-0 space-y-4 overflow-y-auto rounded-xl border bg-card p-4">
        <div className="space-y-1">
          <div className="text-sm font-medium">{tt('Round overlay')}</div>
          <p className="text-xs text-muted-foreground">{tt('Every selected round plays at once, synced on the end of the freeze time. Dots show the round number.')}</p>
        </div>
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">{tt('Team')}</div>
          <ToggleGroup type="single" variant="outline" size="sm" value={String(team)} onValueChange={(v) => { if (v) { setTeam(Number(v) as TeamIndex); setExcluded(new Set()); } }} className="w-full">
            {([0, 1] as TeamIndex[]).map((t) => <ToggleGroupItem key={t} value={String(t)} className="min-w-0 flex-1 truncate px-2 text-xs">{m.teams[t].name}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">{tt('Side')}</div>
            <ToggleGroup type="single" variant="outline" size="sm" value={side} onValueChange={(v) => { if (v) { setSide(v as 'ct' | 't'); setExcluded(new Set()); } }} className="w-full">
              <ToggleGroupItem value="ct" className="flex-1 text-xs">{tt('CT')}</ToggleGroupItem>
              <ToggleGroupItem value="t" className="flex-1 text-xs">T</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">{tt('Result')}</div>
            <ToggleGroup type="single" variant="outline" size="sm" value={result} onValueChange={(v) => v && setResult(v as typeof result)} className="w-full">
              <ToggleGroupItem value="all" className="flex-1 px-1 text-xs">{tt('All')}</ToggleGroupItem>
              <ToggleGroupItem value="won" className="flex-1 px-1 text-xs">{tt('Won')}</ToggleGroupItem>
              <ToggleGroupItem value="lost" className="flex-1 px-1 text-xs">{tt('Lost')}</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{tt('Rounds') + ' '}<span className="num text-foreground">{rounds.length}</span>/{candidates.length}</span>
            {excluded.size > 0 && <button className="hover:text-foreground" onClick={() => setExcluded(new Set())}>{tt('Select all')}</button>}
          </div>
          <div className="flex flex-wrap gap-1">
            {candidates.map((r) => {
              const on = !excluded.has(r.index);
              return (
                <Tooltip key={r.index}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setExcluded((s) => { const n = new Set(s); if (on) n.add(r.index); else n.delete(r.index); return n; })}
                      onDoubleClick={() => onOpen(r.index, sec)}
                      className={cn('num h-7 min-w-7 rounded-md border px-1.5 text-xs transition-colors',
                        on ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                        r.winnerTeam === team ? 'font-semibold' : '')}>
                      {r.number}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{tt('Round') + ' '}{r.number} · {r.winnerTeam === team ? 'won' : 'lost'}{r.plant ? tt(' · plant {0}', [r.plant.site ?? '']) : ''} {tt('· double-click to open in the replay')}</TooltipContent>
                </Tooltip>
              );
            })}
            {candidates.length === 0 && <p className="text-xs text-muted-foreground">{tt('No round for this selection.')}</p>}
          </div>
        </div>
        {cal?.hasLower && (
          <ToggleGroup type="single" variant="outline" size="sm" value={layer} onValueChange={(v) => v && setLayer(v as typeof layer)}>
            <ToggleGroupItem value="upper" className="px-3 text-xs">{tt('Upper')}</ToggleGroupItem>
            <ToggleGroupItem value="lower" className="px-3 text-xs">{tt('Lower')}</ToggleGroupItem>
          </ToggleGroup>
        )}
        <p className="border-t pt-3 text-[11px] text-muted-foreground">
          {tt('Bold rounds were won. Crosses mark deaths, red squares bomb plants. Players:') + ' '}{players.map((p) => p.name).join(', ')}.
        </p>
      </div>

      <div className="flex min-h-0 flex-col gap-2">
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border bg-card p-3">
          <OverlayCanvas match={m} rounds={rounds.map((r) => r.index)} team={team} sec={sec} layer={layer} />
        </div>
        <div className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2">
          <Button size="icon-sm" variant="ghost" aria-label={tt('Back to start')} onClick={() => { setSec(0); setPlaying(false); }}><SkipBack /></Button>
          <Button size="icon-sm" aria-label={tt('Play / pause')} onClick={() => { if (sec >= maxSec) setSec(0); setPlaying((p) => !p); }}>{playing ? <Pause /> : <Play />}</Button>
          <span className="num w-14 text-sm">{Math.floor(sec / 60)}:{String(Math.floor(sec % 60)).padStart(2, '0')}</span>
          <input type="range" min={0} max={maxSec} step={0.1} value={sec} onChange={(e) => { setSec(Number(e.target.value)); setPlaying(false); }}
            className="h-1.5 flex-1 cursor-pointer accent-foreground" aria-label={tt('Time after freeze')} />
          <ToggleGroup type="single" variant="outline" size="sm" value={String(speed)} onValueChange={(v) => v && setSpeed(Number(v) as (typeof SPEEDS)[number])}>
            {SPEEDS.map((s) => <ToggleGroupItem key={s} value={String(s)} className="px-2 text-xs">{s}×</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
      </div>
    </div>
  );
}

function OverlayCanvas({ match: m, rounds, team, sec, layer }: { match: MatchData; rounds: number[]; team: TeamIndex; sec: number; layer: 'upper' | 'lower' }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(0);
  const [size, setSize] = useState(0);
  const cal = getMap(m.header.map);

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImgReady((n) => n + 1);
    i.src = radarUrl(m.header.map, layer === 'lower');
    img.current = i;
  }, [m.header.map, layer]);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (!wrap.current) return;
      const r = wrap.current.getBoundingClientRect();
      setSize(Math.floor(Math.min(r.width, r.height)));
    });
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !size || !cal) return;
    const th = readRenderTheme();
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr; c.height = size * dpr;
    c.style.width = `${size}px`; c.style.height = `${size}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = th.background;
    ctx.fillRect(0, 0, size, size);
    const s = size / RADAR_SIZE;
    const im = img.current;
    if (im?.complete && im.naturalWidth) {
      ctx.filter = 'grayscale(1) brightness(0.4) contrast(1.1)';
      ctx.drawImage(im, 0, 0, size, size);
      ctx.filter = 'none';
    }
    const onLayer = (z: number) => !cal.hasLower || isLower(cal, z) === (layer === 'lower');
    const toPx = (x: number, y: number) => { const [rx, ry] = worldToRadar(cal, x, y); return [rx * s, ry * s] as const; };
    const P = m.players.length;
    const tr = m.tickrate;
    const k = Math.max(0.7, Math.min(1.3, size / 800));

    for (const ri of rounds) {
      const r = m.rounds[ri];
      const tick = Math.min(r.officialEndTick, r.freezeEndTick + sec * tr);
      const isCt = r.ctTeam === team;
      const paint = isCt ? th.ct : th.t;

      // Fumées et feux de l'équipe actifs à cet instant
      for (const g of m.grenades) {
        if (g.round !== ri || m.players[g.thrower]?.team !== team) continue;
        if ((g.kind !== 'smoke' && g.kind !== 'molotov') || tick < g.detonateTick || tick > g.effectEndTick || !onLayer(g.effectPos[2])) continue;
        const [x, y] = toPx(g.effectPos[0], g.effectPos[1]);
        ctx.beginPath();
        ctx.arc(x, y, ((g.kind === 'smoke' ? 144 : 125) / cal.scale) * s, 0, Math.PI * 2);
        ctx.fillStyle = g.kind === 'smoke' ? 'rgba(220,220,220,0.12)' : 'rgba(239,68,68,0.14)';
        ctx.fill();
      }

      // Plant
      if (r.plant && tick >= r.plant.tick && onLayer(r.plant.z)) {
        const [x, y] = toPx(r.plant.x, r.plant.y);
        ctx.fillStyle = th.bomb;
        ctx.fillRect(x - 3.5 * k, y - 3.5 * k, 7 * k, 7 * k);
      }

      for (let p = 0; p < P; p++) {
        if (m.players[p].team !== team) continue;
        // Traînée des dernières secondes
        const f1 = Math.floor(tick / SAMPLE_STEP);
        const f0 = Math.max(Math.floor(r.freezeEndTick / SAMPLE_STEP), f1 - Math.round((TRAIL_SEC * tr) / SAMPLE_STEP));
        ctx.beginPath();
        let started = false;
        for (let f = f0; f <= f1; f++) {
          const j = f * P + p;
          if (!m.frames.present[j] || !(m.frames.flags[j] & FLAG_ALIVE) || !onLayer(m.frames.pos[j * 3 + 2])) { started = false; continue; }
          const [x, y] = toPx(m.frames.pos[j * 3], m.frames.pos[j * 3 + 1]);
          if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
        }
        ctx.strokeStyle = isCt ? 'rgba(250,250,250,0.28)' : 'rgba(163,163,163,0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const st = playerState(m, p, tick);
        if (!st.present || !onLayer(st.z)) continue;
        const [x, y] = toPx(st.x, st.y);
        if (!st.alive) {
          // Mort : croix discrète
          const d = 3 * k;
          ctx.strokeStyle = 'rgba(250,250,250,0.35)';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d); ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d); ctx.stroke();
          continue;
        }
        const rad = 6.5 * k;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fillStyle = paint.fill;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = paint.ring;
        ctx.stroke();
        ctx.fillStyle = paint.ink;
        ctx.font = `600 ${Math.round(8 * k)}px "Geist Mono Variable", ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(r.number), x, y + 0.5);
      }
    }
  }, [m, rounds, team, sec, layer, size, imgReady, cal]);

  return (
    <div ref={wrap} className="flex h-full w-full items-center justify-center">
      <canvas ref={canvas} className="rounded-lg" />
    </div>
  );
}
