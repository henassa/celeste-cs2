// Quatre cartes de lecture rapide en tête de la vue Stats.

import { useMemo } from 'react';
import type { MatchData, TeamIndex } from '@/data/types';
import { computeStats } from '@/stats/compute';
import { computeInsights } from '@/stats/insights';
import { tt } from '@/i18n';

const BUY = { pistol: 'pistol', eco: 'eco', force: 'force buy', full: 'full buy' } as const;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4 text-card-foreground">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="mt-1.5 space-y-1 text-sm">{children}</div>
    </div>
  );
}

export function MatchInsightsCards({ match: m }: { match: MatchData }) {
  const ins = useMemo(() => computeInsights(m, computeStats(m, 'all')), [m]);
  const team = (t: TeamIndex) => m.teams[t].name;
  const pname = (p: number) => m.players[p]?.name ?? '?';
  const upsetsBy = (t: TeamIndex) => ins.upsets.filter((u) => u.winner === t);

  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      <Card title={tt('Momentum')}>
        {ins.streak ? (
          <p><span className="font-medium">{team(ins.streak.team)}</span> {tt('won') + ' '}<span className="num">{ins.streak.length}</span> {tt('in a row')}
            <span className="text-muted-foreground"> {tt('(rounds') + ' '}{ins.streak.from}–{ins.streak.to})</span></p>
        ) : <p className="text-muted-foreground">—</p>}
        {ins.comeback && (
          <p className="text-xs text-muted-foreground">
            {team(ins.comeback.team)} {tt('came back from') + ' '}<span className="num text-foreground">{ins.comeback.deficit}</span> {tt('rounds down (after round') + ' '}{ins.comeback.atRound}).
          </p>
        )}
      </Card>
      <Card title={tt('Impact player')}>
        {ins.impact ? (
          <>
            <p><span className="font-medium">{pname(ins.impact.player)}</span>
              <span className="num text-muted-foreground"> · {ins.impact.swing > 0 ? '+' : ''}{ins.impact.swing.toFixed(1)}{tt('% swing per round ·') + ' '}{ins.impact.rating.toFixed(2)}</span></p>
            {ins.impact.runnerUp !== null && <p className="text-xs text-muted-foreground">{tt('Next:') + ' '}{pname(ins.impact.runnerUp)}</p>}
          </>
        ) : <p className="text-muted-foreground">—</p>}
      </Card>
      <Card title={tt('Economy upsets')}>
        {ins.upsets.length === 0 ? <p className="text-muted-foreground">{tt('No round won on a weaker buy.')}</p> : (
          ([0, 1] as TeamIndex[]).filter((t) => upsetsBy(t).length).map((t) => (
            <p key={t}>
              <span className="font-medium">{team(t)}</span> <span className="num">{upsetsBy(t).length}</span>
              <span className="text-xs text-muted-foreground"> · {upsetsBy(t).slice(0, 4).map((u) => `R${u.round} ${BUY[u.winnerBuy]} vs ${BUY[u.loserBuy]}`).join(', ')}{upsetsBy(t).length > 4 ? '…' : ''}</span>
            </p>
          ))
        )}
      </Card>
      <Card title={tt('Site pressure (T side)')}>
        {ins.sites.map((s) => {
          const plants = s.plants.A + s.plants.B;
          return (
            <p key={s.team}>
              <span className="font-medium">{team(s.team)}</span>
              <span className="text-xs text-muted-foreground"> · {plants}/{s.tRounds} {tt('plants')}{plants ? ` (A ${s.plants.A}, B ${s.plants.B})` : ''}{plants ? tt(' · {0} won after plant', [s.postPlantWon]) : ''}</span>
            </p>
          );
        })}
      </Card>
    </div>
  );
}
