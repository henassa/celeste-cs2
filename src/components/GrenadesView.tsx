// Vue Grenades du lecteur : toutes les grenades du match, filtrables, avec leur trajectoire sur le
// radar, la façon de les lancer et la commande setpos pour les reproduire en jeu.

import { useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import type { GrenadeInfo, GrenadeKind, MatchData, TeamIndex } from '@/data/types';
import { getMap } from '@/maps/maps';
import { placeLabel, setposCommand } from '@/viewer/places';
import { techLabel } from '@/analysis/lineups';
import { techCode } from '@/library/spatial';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { CopySetpos } from './CopySetpos';
import { NadeCanvas, type NadeItem } from './NadeCanvas';
import { tt } from '@/i18n';

const KINDS: { id: GrenadeKind | 'all'; label: string }[] = [
  { id: 'all', label: tt('All') }, { id: 'smoke', label: tt('Smoke') }, { id: 'flash', label: tt('Flash') }, { id: 'molotov', label: tt('Molly') }, { id: 'he', label: 'HE' },
];
export const KIND_LABEL: Record<GrenadeKind, string> = { smoke: tt('Smoke'), flash: tt('Flash'), molotov: tt('Molotov'), he: 'HE', decoy: tt('Decoy') };

/** Horloge du round (compte à rebours depuis 1:55) à partir des secondes après le freeze. */
export const roundClockAt = (secAfterFreeze: number) => {
  const left = Math.max(0, Math.ceil(115 - secAfterFreeze));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
};
const clock = roundClockAt;

export function grenadeSetpos(g: GrenadeInfo): string | null {
  const t = g.throw;
  return t ? setposCommand(t.x, t.y, t.z, t.pitch, t.yaw) : null;
}

interface Props {
  match: MatchData;
  /** Regarder le lancer dans le lecteur. */
  onWatch: (g: GrenadeInfo) => void;
}

export function GrenadesView({ match: m, onWatch }: Props) {
  const [kind, setKind] = useState<GrenadeKind | 'all'>('smoke');
  const [team, setTeam] = useState<'all' | '0' | '1'>('all');
  const [side, setSide] = useState<'all' | 'ct' | 't'>('all');
  const [round, setRound] = useState<string>('all');
  const [land, setLand] = useState<string>('*');
  const [selected, setSelected] = useState<string | null>(null);
  const [layer, setLayer] = useState<'upper' | 'lower'>('upper');
  const cal = getMap(m.header.map);

  const base = useMemo(() => m.grenades.filter((g) => {
    if (g.kind === 'decoy') return false;
    if (kind !== 'all' && g.kind !== kind) return false;
    const pt = m.players[g.thrower]?.team;
    if (pt === undefined) return false;
    if (team !== 'all' && pt !== Number(team)) return false;
    const r = m.rounds[g.round];
    if (side !== 'all' && (r.ctTeam === pt) !== (side === 'ct')) return false;
    if (round !== 'all' && g.round !== Number(round)) return false;
    return true;
  }), [m, kind, team, side, round]);
  const lands = useMemo(() => {
    const c = new Map<string, number>();
    for (const g of base) if (g.landPlace) c.set(g.landPlace, (c.get(g.landPlace) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [base]);
  const list = land === '*' ? base : base.filter((g) => g.landPlace === land);

  const items: NadeItem[] = useMemo(() => list.map((g) => {
    const path: [number, number][] = [];
    for (let i = 0; i < g.pathLen; i++) path.push([m.grenadePathXYZ[(g.pathStart + i) * 3], m.grenadePathXYZ[(g.pathStart + i) * 3 + 1]]);
    const from: [number, number, number] | null = g.throw ? [g.throw.x, g.throw.y, g.throw.z]
      : g.pathLen ? [m.grenadePathXYZ[g.pathStart * 3], m.grenadePathXYZ[g.pathStart * 3 + 1], m.grenadePathXYZ[g.pathStart * 3 + 2]] : null;
    return { id: String(g.id), kind: g.kind, from, to: g.effectPos, path };
  }), [list, m]);

  const sel = list.find((g) => String(g.id) === selected) ?? null;
  const pname = (p: number) => m.players[p]?.name ?? '?';
  const sideCls = (g: GrenadeInfo) => (m.rounds[g.round].ctTeam === m.players[g.thrower]?.team ? 'text-side-ct' : 'text-side-t');

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 auto-rows-max overflow-y-auto md:auto-rows-auto md:overflow-visible md:grid-cols-[380px_1fr] gap-2">
      <div className="flex min-h-0 flex-col gap-3 rounded-xl border bg-card p-4">
        <div className="space-y-2">
          <ToggleGroup type="single" variant="outline" size="sm" value={kind} onValueChange={(v) => { if (v) { setKind(v as typeof kind); setLand('*'); } }} className="w-full">
            {KINDS.map((k) => <ToggleGroupItem key={k.id} value={k.id} className="flex-1 px-1 text-xs">{k.label}</ToggleGroupItem>)}
          </ToggleGroup>
          <div className="grid grid-cols-2 gap-2">
            <Select value={team} onValueChange={(v) => setTeam(v as typeof team)}>
              <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tt('Both teams')}</SelectItem>
                {([0, 1] as TeamIndex[]).map((t) => <SelectItem key={t} value={String(t)}>{m.teams[t].name}</SelectItem>)}
              </SelectContent>
            </Select>
            <ToggleGroup type="single" variant="outline" size="sm" value={side} onValueChange={(v) => v && setSide(v as typeof side)} className="w-full">
              <ToggleGroupItem value="all" className="flex-1 px-1 text-xs">{tt('Both')}</ToggleGroupItem>
              <ToggleGroupItem value="ct" className="flex-1 px-1 text-xs">{tt('CT')}</ToggleGroupItem>
              <ToggleGroupItem value="t" className="flex-1 px-1 text-xs">T</ToggleGroupItem>
            </ToggleGroup>
            <Select value={round} onValueChange={setRound}>
              <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tt('All rounds')}</SelectItem>
                {m.rounds.map((r) => <SelectItem key={r.index} value={String(r.index)}>{tt('Round') + ' '}{r.number}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={land} onValueChange={setLand}>
              <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="*">{tt('Lands anywhere')}</SelectItem>
                {lands.map(([p, n]) => <SelectItem key={p} value={p}>{placeLabel(p)} <span className="num text-muted-foreground">{n}</span></SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {sel && (
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <div className="flex items-center gap-2">
              <span className={cn('font-medium', sideCls(sel))}>{pname(sel.thrower)}</span>
              <span className="text-muted-foreground">{KIND_LABEL[sel.kind]} {tt('· round') + ' '}{m.rounds[sel.round].number} · {clock(((sel.throw?.tick ?? sel.throwTick) - m.rounds[sel.round].freezeEndTick) / m.tickrate)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {placeLabel(sel.throw?.place ?? '') || tt('Unknown')} → <span className="text-foreground">{placeLabel(sel.landPlace) || 'unknown'}</span>
              {sel.throw && <> · {techLabel(techCode(sel.throw.tech))}</>}
            </div>
            {sel.throw && <code className="block truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground" title={grenadeSetpos(sel) ?? ''}>{grenadeSetpos(sel)}</code>}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => onWatch(sel)}><Eye /> {tt('Watch')}</Button>
              {sel.throw && <div className="flex items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground"><CopySetpos get={() => grenadeSetpos(sel)} /> {tt('setpos')}</div>}
            </div>
          </div>
        )}

        <div className="text-xs text-muted-foreground"><span className="num text-foreground">{list.length}</span> {tt('grenade')}{list.length === 1 ? '' : 's'}</div>
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto">
          {list.map((g) => {
            const r = m.rounds[g.round];
            const on = String(g.id) === selected;
            return (
              <button key={g.id} onClick={() => setSelected(on ? null : String(g.id))} onDoubleClick={() => onWatch(g)}
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent', on && 'bg-accent')}>
                <span className="num w-7 text-muted-foreground">R{r.number}</span>
                <span className="num w-9 text-muted-foreground">{clock(((g.throw?.tick ?? g.throwTick) - r.freezeEndTick) / m.tickrate)}</span>
                <span className={cn('w-24 truncate font-medium', sideCls(g))}>{pname(g.thrower)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {kind === 'all' && <span className="text-muted-foreground">{KIND_LABEL[g.kind]} · </span>}
                  {placeLabel(g.landPlace) || '—'}
                </span>
                {g.throw?.tech.jump && <span className="rounded-sm border px-1 text-[10px] text-muted-foreground">{tt('Jump')}</span>}
              </button>
            );
          })}
          {list.length === 0 && <p className="px-2 text-xs text-muted-foreground">{tt('No grenade for these filters.')}</p>}
        </div>
      </div>
      <div className="relative min-h-0 overflow-hidden rounded-xl border bg-card p-3">
        <NadeCanvas map={m.header.map} items={items} selected={selected} onSelect={setSelected} layer={layer} />
        {cal?.hasLower && (
          <ToggleGroup type="single" variant="outline" size="sm" value={layer} onValueChange={(v) => v && setLayer(v as typeof layer)} className="absolute top-3 left-3 bg-card">
            <ToggleGroupItem value="upper" className="px-3 text-xs">{tt('Upper')}</ToggleGroupItem>
            <ToggleGroupItem value="lower" className="px-3 text-xs">{tt('Lower')}</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>
    </div>
  );
}
