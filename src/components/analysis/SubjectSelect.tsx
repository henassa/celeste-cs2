// Choix du sujet d'analyse : tout le monde, une équipe détectée ou un joueur.

import type { Subject } from '@/analysis/heatmap';
import type { TeamGroup } from '@/analysis/teams';
import type { PlayerAgg } from '@/analysis/players';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { tt } from '@/i18n';

/** Clé de sujet sérialisable : 'all' | 'team:<id>' | 'player:<steamid>'. */
export type SubjectKey = string;

export function resolveSubject(key: SubjectKey, teams: TeamGroup[]): Subject {
  if (key.startsWith('team:')) {
    const g = teams.find((t) => `team:${t.id}` === key);
    return g ? { kind: 'team', group: g } : { kind: 'all' };
  }
  if (key.startsWith('player:')) return { kind: 'player', steamid: key.slice(7) };
  return { kind: 'all' };
}

export function SubjectSelect({ value, onChange, teams, players, allLabel = tt('Everyone') }: {
  value: SubjectKey; onChange: (v: SubjectKey) => void; teams: TeamGroup[]; players: PlayerAgg[]; allLabel?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {teams.length > 0 && <SelectGroup><SelectLabel>{tt('Teams')}</SelectLabel>{teams.map((t) => <SelectItem key={t.id} value={`team:${t.id}`}>{t.name}</SelectItem>)}</SelectGroup>}
        <SelectGroup><SelectLabel>{tt('Players')}</SelectLabel>{players.map((p) => <SelectItem key={p.steamid} value={`player:${p.steamid}`}>{p.name}</SelectItem>)}</SelectGroup>
      </SelectContent>
    </Select>
  );
}
