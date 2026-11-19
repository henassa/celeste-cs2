// Page Analysis : joueurs, équipes, rounds filtrés et heatmaps sur toute la bibliothèque locale.
// Le sujet et les filtres de rounds sont partagés par les onglets Rounds et Heatmaps, et gardés
// en mémoire le temps de la session (retour depuis le lecteur).

import { useEffect, useMemo, useState } from 'react';
import { listMatches, type LibraryMatch } from '@/library/library';
import { loadModels } from '@/calib/model';
import { detectTeams, type TeamGroup } from '@/analysis/teams';
import { aggregatePlayers } from '@/analysis/players';
import { allRoundViews, DEFAULT_FILTER, filterRounds, openingPlaces, type RoundFilter } from '@/analysis/rounds';
import { mapDisplayName } from '@/maps/maps';
import { navigate, type AnalysisTab } from '@/app/router';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlayersTab } from './PlayersTab';
import { TeamsTab } from './TeamsTab';
import { HeatmapsTab } from './HeatmapsTab';
import { RoundsTab } from './RoundsTab';
import { LineupsTab } from './LineupsTab';
import { BriefTab } from './BriefTab';
import { VetoTab } from './VetoTab';
import { SeriesTab } from './SeriesTab';
import { StrategiesTab } from './StrategiesTab';
import { TrainingTab } from './TrainingTab';
import { RoundFilterPanel } from './RoundFilterPanel';
import { resolveSubject, SubjectSelect, type SubjectKey } from './SubjectSelect';
import { tt } from '@/i18n';

type Tab = AnalysisTab;
const TITLE: Record<Tab, string> = { players: tt('Players'), training: tt('Training'), teams: tt('Teams'), series: tt('Series'), rounds: tt('Rounds'), strategies: tt('Strategies'), heatmaps: tt('Heatmaps'), lineups: tt('Lineups'), brief: tt('Anti-strat brief'), veto: tt('Veto') };

// État conservé entre deux ouvertures de la page (même session, rien n'est stocké)
const session: { map: string; subject: SubjectKey; filter: RoundFilter } = {
  map: 'all', subject: 'all', filter: DEFAULT_FILTER,
};

interface Props {
  tab: Tab;
  onOpenRound: (m: LibraryMatch, round: number, queue?: number[]) => void;
  /** Message à afficher (ex. mauvais fichier choisi pour rouvrir un round). */
  notice?: string | null;
}

export function AnalysisPage({ tab, onOpenRound, notice }: Props) {
  const [matches, setMatches] = useState<LibraryMatch[] | null>(null);
  const setTab = (t: Tab) => navigate({ page: 'analysis', tab: t });
  const [map, setMap] = useState<string>(session.map);
  const [subject, setSubject] = useState<SubjectKey>(session.subject);
  const [filter, setFilter] = useState<RoundFilter>(session.filter);
  const model3 = useMemo(() => loadModels().hltv3, []);
  useEffect(() => { listMatches().then(setMatches); }, []);
  useEffect(() => { Object.assign(session, { map, subject, filter }); }, [map, subject, filter]);

  const all = matches ?? [];
  const maps = useMemo(() => [...new Set(all.map((m) => m.map))].sort(), [all]);
  const mapArg = map === 'all' ? undefined : map;
  const teams = useMemo(() => detectTeams(all), [all]);
  const players = useMemo(() => aggregatePlayers(all), [all]);
  const subj = useMemo(() => resolveSubject(subject, teams), [subject, teams]);
  const perspective = subj.kind !== 'all';

  // Rounds : tous ceux du sujet sur la carte, puis ceux qui passent les filtres
  const base = useMemo(() => allRoundViews(all, { map: mapArg, subject: subj }), [all, mapArg, subj]);
  const views = useMemo(() => filterRounds(base, filter), [base, filter]);
  // Callouts proposés : ceux des rounds retenus par les autres filtres
  const places = useMemo(() => openingPlaces(filterRounds(base, { ...filter, openingPlace: '' })), [base, filter]);

  const openTeamHeatmap = (g: TeamGroup) => { setSubject(`team:${g.id}`); setFilter(DEFAULT_FILTER); setTab('heatmaps'); };

  const filterPanel = (
    <>
      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground">{tt('Who')}</div>
        <SubjectSelect value={subject} onChange={setSubject} teams={teams} players={players} allLabel={tt('Everyone (both teams)')} />
      </div>
      <div className="border-t pt-3">
        <RoundFilterPanel filter={filter} onChange={setFilter} places={places} perspective={perspective} />
      </div>
    </>
  );

  return (
    <div className="flex h-full flex-col gap-2 p-2 print:block print:h-auto print:p-0">
      <header className="flex h-12 shrink-0 items-center gap-3 px-2 print:hidden">
        <h1 className="text-sm font-semibold">{TITLE[tab]}</h1>
        <span className="text-xs text-muted-foreground">{matches?.length ?? 0} {tt('maps in your library')}</span>
        <span className="flex-1" />
        {!['heatmaps', 'lineups', 'brief', 'veto', 'series', 'strategies', 'training'].includes(tab) && (
          <Select value={map} onValueChange={setMap}>
            <SelectTrigger size="sm" className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tt('All maps')}</SelectItem>
              {maps.map((m) => <SelectItem key={m} value={m}>{mapDisplayName(m)}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </header>
      {notice && <div className="rounded-lg border px-3 py-2 text-xs text-destructive">{notice}</div>}
      {!matches ? null : matches.length === 0 ? (
        <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">{tt('Your library is empty: add demos from the home screen first.')}</div>
      ) : (
        <>
          {tab === 'players' && <PlayersTab matches={matches} map={mapArg} model3={model3} />}
          {tab === 'teams' && <TeamsTab matches={matches} map={mapArg} onHeatmap={openTeamHeatmap} />}
          {tab === 'rounds' && (
            <div className="grid min-h-0 flex-1 grid-cols-1 auto-rows-max overflow-y-auto md:auto-rows-auto md:overflow-visible md:grid-cols-[300px_1fr] gap-2">
              <div className="min-h-0 space-y-4 overflow-y-auto rounded-xl border bg-card p-4">{filterPanel}</div>
              <RoundsTab views={views} total={base.length} perspective={perspective} onOpenRound={onOpenRound} />
            </div>
          )}
          {tab === 'training' && <TrainingTab matches={matches} players={players} onOpenRound={onOpenRound} />}
          {tab === 'strategies' && (
            <StrategiesTab matches={matches} map={mapArg} onMapChange={setMap} subject={subj} views={views} filterPanel={filterPanel} onOpenRound={onOpenRound} />
          )}
          {tab === 'series' && <SeriesTab matches={matches} model3={model3} onOpenRound={onOpenRound} />}
          {tab === 'veto' && <VetoTab matches={matches} teams={teams} players={players} subjectKey={subject} onSubjectChange={setSubject} />}
          {tab === 'brief' && (
            <BriefTab matches={matches} map={mapArg} onMapChange={setMap} subject={subj} model3={model3}
              subjectPicker={<SubjectSelect value={subject} onChange={setSubject} teams={teams} players={players} allLabel="Choose a team…" />} />
          )}
          {tab === 'lineups' && (
            <LineupsTab matches={matches} map={mapArg} onMapChange={setMap} subject={subj} filter={filter} views={views} filterPanel={filterPanel} onOpenRound={onOpenRound} />
          )}
          {tab === 'heatmaps' && (
            <HeatmapsTab matches={matches} map={mapArg} onMapChange={setMap} subject={subj} filter={filter} views={views} filterPanel={filterPanel} />
          )}
        </>
      )}
    </div>
  );
}
