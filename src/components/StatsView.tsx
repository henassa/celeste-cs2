// Vue Stats : tableau par équipe (tri par colonne, filtre de côté) et explication des ratings.

import { useEffect, useMemo, useState } from 'react';
import { extrasForMatch, loadModels, predictStats, type RatingModel } from '@/calib/model';
import { buildSpatial } from '@/library/spatial';
import { ArrowDown, Info } from 'lucide-react';
import type { MatchData } from '@/data/types';
import { computeStats, type PlayerStats, type SideFilter } from '@/stats/compute';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { MatchInsightsCards } from './MatchInsights';
import { AimPanel } from './AimPanel';
import { MatchDetails } from './MatchDetails';
import { tt } from '@/i18n';

interface Column {
  id: string;
  label: string;
  hint: string;
  value: (s: PlayerStats) => number;
  format: (s: PlayerStats) => string;
}

const fx = (n: number, d = 0) => n.toFixed(d);
const clutchWins = (s: PlayerStats) => s.clutches.reduce((a, c) => a + c.wins, 0);
const clutchAtt = (s: PlayerStats) => s.clutches.reduce((a, c) => a + c.attempts, 0);
const multiKills = (s: PlayerStats) => s.multi[2] + s.multi[3] + s.multi[4] + s.multi[5];

const COLUMNS: Column[] = [
  { id: 'k', label: 'K', hint: tt('Kills'), value: (s) => s.kills, format: (s) => `${s.kills}` },
  { id: 'd', label: 'D', hint: tt('Deaths'), value: (s) => -s.deaths, format: (s) => `${s.deaths}` },
  { id: 'a', label: 'A', hint: tt('Assists (incl. flash assists)'), value: (s) => s.assists, format: (s) => `${s.assists}` },
  { id: 'pm', label: '+/−', hint: tt('Kills minus deaths'), value: (s) => s.kills - s.deaths, format: (s) => `${s.kills - s.deaths > 0 ? '+' : ''}${s.kills - s.deaths}` },
  { id: 'adr', label: 'ADR', hint: tt('Average damage per round (capped at remaining health, like the game)'), value: (s) => s.adr, format: (s) => fx(s.adr, 1) },
  { id: 'kast', label: 'KAST', hint: tt('Rounds with a kill, assist, survival or traded death (5 s window)'), value: (s) => s.kast, format: (s) => `${fx(s.kast)}%` },
  { id: 'hs', label: tt('HS%'), hint: tt('Headshot kills / kills'), value: (s) => s.hsPct, format: (s) => `${fx(s.hsPct)}%` },
  { id: 'fk', label: tt('FK–FD'), hint: tt('Opening kills – opening deaths (first duel of the round)'), value: (s) => s.entryKills - s.entryDeaths, format: (s) => `${s.entryKills}–${s.entryDeaths}` },
  { id: 'tr', label: tt('Trades'), hint: tt('Trade kills (killed the enemy who killed a teammate within 5 s)'), value: (s) => s.tradeKills, format: (s) => `${s.tradeKills}` },
  { id: 'cl', label: tt('Clutch'), hint: '1vX won / attempted', value: (s) => clutchWins(s) * 10 + clutchAtt(s) / 100, format: (s) => `${clutchWins(s)}/${clutchAtt(s)}` },
  { id: 'mk', label: 'MK', hint: tt('Rounds with 2+ kills (3K, 4K, aces in the tooltip)'), value: multiKills, format: (s) => `${multiKills(s)}` },
  { id: 'ud', label: 'UD', hint: tt('Utility damage (HE + fire)'), value: (s) => s.utilityDamage, format: (s) => `${s.utilityDamage}` },
  { id: 'ef', label: 'EF', hint: tt('Enemies flashed (blind > 1.5 s; close to the in-game counter, whose exact rule is not public)'), value: (s) => s.enemiesFlashed, format: (s) => `${s.enemiesFlashed}` },
  { id: 'fa', label: 'FA', hint: tt('Flash assists'), value: (s) => s.flashAssists, format: (s) => `${s.flashAssists}` },
  { id: 'sw', label: tt('Swing'), hint: tt('Round Swing: average change in round win probability caused per round (Celeste model)'), value: (s) => s.swing, format: (s) => `${s.swing > 0 ? '+' : ''}${fx(s.swing, 1)}%` },
  { id: 'r1', label: '1.0', hint: tt('HLTV Rating 1.0 (public formula)'), value: (s) => s.rating1, format: (s) => fx(s.rating1, 2) },
  { id: 'r2', label: '2.0≈', hint: tt('HLTV Rating 2.0, community approximation (formula not published by HLTV)'), value: (s) => s.rating2, format: (s) => fx(s.rating2, 2) },
];

interface Props {
  match: MatchData;
  onPlayer: (p: number) => void;
  /** Ouvre un round dans le replay. */
  onRound?: (r: number) => void;
  /** Fichier de la démo, pour la seconde passe des stats d'aim. */
  file?: File | null;
}

export function StatsView({ match, onPlayer, onRound, file }: Props) {
  const [side, setSide] = useState<SideFilter>('all');
  const [models, setModels] = useState(loadModels);
  useEffect(() => {
    const on = () => setModels(loadModels());
    window.addEventListener('scrimview:models', on);
    return () => window.removeEventListener('scrimview:models', on);
  }, []);
  // WPA du match (seulement si l'étalonnage l'utilise) : même calcul que dans la bibliothèque
  const extrasByPlayer = useMemo(() => {
    const m3 = models.hltv3;
    if (!m3?.extra?.length || side !== 'all') return new Map();
    const all = computeStats(match, 'all');
    const rounds = new Map(all.map((x) => [x.player, x.rounds]));
    return extrasForMatch(m3, buildSpatial(match), (p) => rounds.get(p) ?? 0);
  }, [match, models, side]);
  const columns = useMemo(() => {
    const extra: Column[] = [];
    const add = (id: string, label: string, name: string, m?: RatingModel) => {
      if (!m) return;
      extra.push({ id, label, hint: tt('{0}, {1} on {2} players from {3} maps (average error ±{4})', [name, m.builtIn ? 'default calibration' : 'your calibration', m.samples, m.matches, m.cvMae.toFixed(2)]),
        value: (s) => predictStats(m, s, extrasByPlayer.get(s.player)), format: (s) => predictStats(m, s, extrasByPlayer.get(s.player)).toFixed(2) });
    };
    add('r3', '3.0≈', 'HLTV Rating 3.0 estimate', models.hltv3);
    return [...COLUMNS, ...extra];
  }, [models, extrasByPlayer]);
  const [sort, setSort] = useState('r2');
  const stats = useMemo(() => computeStats(match, side), [match, side]);
  const col = columns.find((c) => c.id === sort) ?? COLUMNS[COLUMNS.length - 1];
  const rounds = match.rounds.length;

  const teamTable = (team: 0 | 1) => {
    const rows = stats.filter((s) => s.team === team).sort((a, b) => col.value(b) - col.value(a));
    const won = match.rounds[rounds - 1]?.scoreAfter[team] ?? 0;
    return (
      <div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="text-sm font-medium">{match.teams[team].name}</span>
          <span className="num text-sm text-muted-foreground">{won}</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-44 pl-4">{tt('Player')}</TableHead>
              {columns.map((c) => (
                <TableHead key={c.id} className="px-2 text-right">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setSort(c.id)}
                        className={cn('inline-flex items-center gap-0.5 rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                          sort === c.id && 'text-foreground')}
                      >
                        {sort === c.id && <ArrowDown className="size-3" />}
                        {c.label}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{c.hint}</TooltipContent>
                  </Tooltip>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.player}>
                <TableCell className="pl-4">
                  <button className="max-w-40 truncate text-left font-medium hover:underline" onClick={() => onPlayer(s.player)} title={tt('Watch in replay')}>
                    {s.name}
                  </button>
                </TableCell>
                {columns.map((c) => (
                  <TableCell key={c.id} className={cn('num px-2 text-right text-muted-foreground', (c.id === sort || c.id === 'r2') && 'text-foreground',
                    c.id === 'r2' && 'font-medium')}>
                    {c.id === 'mk' ? (
                      <Tooltip>
                        <TooltipTrigger className="cursor-default">{c.format(s)}</TooltipTrigger>
                        <TooltipContent>2K {s.multi[2]} · 3K {s.multi[3]} · 4K {s.multi[4]} {tt('· Ace') + ' '}{s.multi[5]}</TooltipContent>
                      </Tooltip>
                    ) : c.id === 'cl' ? (
                      <Tooltip>
                        <TooltipTrigger className="cursor-default">{c.format(s)}</TooltipTrigger>
                        <TooltipContent>
                          {[1, 2, 3, 4, 5].map((n) => `1v${n} ${s.clutches[n].wins}/${s.clutches[n].attempts}`).join(' · ')}
                        </TooltipContent>
                      </Tooltip>
                    ) : c.format(s)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
      <div className="flex items-center gap-3 px-2 py-1">
        <span className="text-sm font-medium">{tt('Match stats')}</span>
        <span className="text-xs text-muted-foreground">{rounds} {tt('rounds')}</span>
        <span className="flex-1" />
        <ToggleGroup type="single" variant="outline" size="sm" value={side} onValueChange={(v) => v && setSide(v as SideFilter)} aria-label={tt('Side')}>
          <ToggleGroupItem value="all" className="px-3 text-xs">{tt('Both sides')}</ToggleGroupItem>
          <ToggleGroupItem value="ct" className="px-3 text-xs">{tt('CT')}</ToggleGroupItem>
          <ToggleGroupItem value="t" className="px-3 text-xs">T</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <MatchInsightsCards match={match} />
      {teamTable(0)}
      {teamTable(1)}
      <MatchDetails match={match} onRound={onRound} />
      <AimPanel match={match} file={file ?? null} />
      <div className="rounded-xl border bg-card p-4 text-card-foreground">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium"><Info className="size-4" /> {tt('About ratings')}</div>
        <dl className="grid gap-x-8 gap-y-3 text-xs text-muted-foreground md:grid-cols-2">
          <div><dt className="font-medium text-foreground">{tt('HLTV 1.0 · exact formula')}</dt>
            <dd>{tt('Public since 2010: kills, survival and multi-kill rounds against fixed averages.')}</dd></div>
          <div><dt className="font-medium text-foreground">{tt('HLTV 2.0≈ · approximation')}</dt>
            <dd>{tt('HLTV never published 2.0. This is the widely used community regression (KAST, KPR, DPR, impact, ADR). Close, not identical.')}</dd></div>
          <div><dt className="font-medium text-foreground">{tt('Swing · Celeste model')}</dt>
            <dd>{tt('How much each kill, death, plant and defuse moved the round win probability (players alive, equipment, bomb, time). Same idea as the round swing in HLTV 3.0, with an open model.')}</dd></div>
          <div><dt className="font-medium text-foreground">{tt('HLTV 3.0≈ · calibrated estimate')}</dt>
            <dd>{models.hltv3
              ? tt('{0} on {1} players from {2} maps, average error ±{3}.{4} Fitted on real HLTV values; individual estimates can be off by more.', [models.hltv3.builtIn ? 'Default calibration' : 'Your calibration', models.hltv3.samples, models.hltv3.matches, models.hltv3.cvMae.toFixed(2), models.hltv3.extra?.includes('wpa') ? ` Includes win probability added, from a win model trained on ${models.hltv3.wpInfo?.rounds ?? 'your'} rounds.` : ''])
              : tt('HLTV 3.0 uses a private win-probability model. Add real values to a few matches in the library and calibrate to see estimates here, with the measured error.')}</dd></div>
        </dl>
      </div>
    </div>
  );
}
