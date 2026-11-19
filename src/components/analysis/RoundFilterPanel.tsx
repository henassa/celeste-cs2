// Panneau de filtres de rounds, partagé par les onglets Rounds et Heatmaps.

import { RotateCcw } from 'lucide-react';
import { DEFAULT_FILTER, isDefaultFilter, type RoundFilter, type Situation } from '@/analysis/rounds';
import type { BuyType } from '@/library/spatial';
import { placeLabel } from '@/viewer/places';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { tt } from '@/i18n';

const BUYS: { id: BuyType | 'all'; label: string }[] = [
  { id: 'all', label: tt('Any buy') }, { id: 'pistol', label: tt('Pistol') }, { id: 'eco', label: tt('Eco') }, { id: 'force', label: tt('Force') }, { id: 'full', label: tt('Full buy') },
];

const SITUATIONS: { id: Situation; label: string }[] = [
  { id: 'any', label: tt('Any situation') },
  { id: 'second', label: tt('Second round (after pistol)') },
  { id: 'antieco', label: tt('Anti-eco (full buy vs eco)') },
  { id: 'advantage', label: tt('Got a player advantage') },
  { id: 'disadvantage', label: tt('Went a player down') },
  { id: 'clutch', label: tt('Last player alive (1vX)') },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function Toggles<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <ToggleGroup type="single" variant="outline" size="sm" value={value} onValueChange={(v) => v && onChange(v as T)} className="w-full">
      {items.map(([id, label]) => <ToggleGroupItem key={id} value={id} className="flex-1 px-1 text-xs">{label}</ToggleGroupItem>)}
    </ToggleGroup>
  );
}

interface Props {
  filter: RoundFilter;
  onChange: (f: RoundFilter) => void;
  /** Callouts des premiers duels disponibles (avec nombre de rounds). */
  places: { place: string; count: number }[];
  /** Le sujet est-il une équipe / un joueur (sinon « nous » = chaque équipe tour à tour). */
  perspective: boolean;
}

export function RoundFilterPanel({ filter: f, onChange, places, perspective }: Props) {
  const set = <K extends keyof RoundFilter>(k: K, v: RoundFilter[K]) => onChange({ ...f, [k]: v });
  const us = perspective ? 'Our' : 'Team';
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{tt('Rounds')}</span>
        {!isDefaultFilter(f) && (
          <Button size="xs" variant="ghost" onClick={() => onChange(DEFAULT_FILTER)}><RotateCcw /> {tt('Reset')}</Button>
        )}
      </div>
      <Row label={tt('Side')}>
        <Toggles value={f.side} onChange={(v) => set('side', v)} items={[['all', tt('Both')], ['ct', 'CT'], ['t', 'T']]} />
      </Row>
      <Row label={tt('Result')}>
        <Toggles value={f.result} onChange={(v) => set('result', v)} items={[['all', tt('All')], ['won', tt('Won')], ['lost', tt('Lost')]]} />
      </Row>
      <Row label={tt('Opening duel')}>
        <Toggles value={f.opening} onChange={(v) => set('opening', v)} items={[['all', tt('All')], ['won', tt('Won')], ['lost', tt('Lost')]]} />
      </Row>
      <Row label={tt('Bomb')}>
        <Toggles value={f.bomb} onChange={(v) => set('bomb', v)} items={[['all', tt('All')], ['A', 'A'], ['B', 'B'], ['none', tt('No plant')]]} />
      </Row>
      <div className="grid grid-cols-2 gap-2">
        <Row label={`${us} buy`}>
          <Select value={f.ourBuy} onValueChange={(v) => set('ourBuy', v as RoundFilter['ourBuy'])}>
            <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{BUYS.map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}</SelectContent>
          </Select>
        </Row>
        <Row label={tt('Opponent buy')}>
          <Select value={f.theirBuy} onValueChange={(v) => set('theirBuy', v as RoundFilter['theirBuy'])}>
            <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{BUYS.map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}</SelectContent>
          </Select>
        </Row>
      </div>
      <Row label={tt('Situation')}>
        <Select value={f.situation} onValueChange={(v) => set('situation', v as Situation)}>
          <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{SITUATIONS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
      </Row>
      <Row label={tt('Opening duel at')}>
        <Select value={f.openingPlace || '*'} onValueChange={(v) => set('openingPlace', v === '*' ? '' : v)} disabled={!places.length && !f.openingPlace}>
          <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="*">{tt('Anywhere')}</SelectItem>
            {f.openingPlace && !places.some((p) => p.place === f.openingPlace) && <SelectItem value={f.openingPlace}>{placeLabel(f.openingPlace)}</SelectItem>}
            {places.map((p) => (
              <SelectItem key={p.place} value={p.place}>
                {placeLabel(p.place)} <span className="num text-muted-foreground">{p.count}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!places.length && <p className="text-[11px] text-muted-foreground">{tt('Callouts need demos added with this version.')}</p>}
      </Row>
    </div>
  );
}
