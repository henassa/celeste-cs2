// Détails du match (vue Stats) : économie par round, armes et zones touchées, grenades, duels.

import { useMemo, useState } from 'react';
import type { MatchData } from '@/data/types';
import { buildSpatial } from '@/library/spatial';
import { buySummary, duelMatrix, economy, HITGROUPS, utility, weapons, type EconomyRound, type Hitgroup } from '@/stats/details';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { WeaponIcon } from './WeaponIcon';
import { tt } from '@/i18n';

type Tab = 'economy' | 'weapons' | 'utility' | 'duels';
const money = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n}`);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
// Deux équipes : clair / gris moyen (monochrome, distincts en niveaux de gris)
const TEAM_FILL = ['var(--foreground)', 'color-mix(in oklab, var(--foreground) 45%, var(--card))'];

function EconomyChart({ m, rows, onRound }: { m: MatchData; rows: EconomyRound[]; onRound?: (r: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 960, H = 200, padL = 44, padB = 22, top = 10;
  const max = Math.max(5000, ...rows.flatMap((r) => r.equip));
  const step = (W - padL) / rows.length, bw = Math.max(3, (step - 6) / 2);
  const y = (v: number) => top + (H - top - padB) * (1 - v / max);
  const ticks = [0, 10000, 20000, 30000, 40000].filter((t) => t <= max);
  const h = hover !== null ? rows[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={tt('Team equipment value per round')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{money(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x0 = padL + i * step + 3;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onRound?.(i)} className={onRound ? 'cursor-pointer' : undefined}>
              <rect x={padL + i * step} y={top} width={step} height={H - top - padB} fill="transparent" />
              {[0, 1].map((t) => {
                const v = r.equip[t], yy = y(v), hh = Math.max(0, H - padB - yy);
                return <path key={t} d={`M${x0 + t * (bw + 2)},${H - padB} v${-Math.max(0, hh - 3)} q0,-3 3,-3 h${bw - 6} q3,0 3,3 v${Math.max(0, hh - 3)} z`} fill={TEAM_FILL[t]} opacity={hover === null || hover === i ? 1 : 0.45} />;
              })}
              {r.winner !== null && <circle cx={x0 + r.winner * (bw + 2) + bw / 2} cy={H - padB + 8} r={2.5} fill={TEAM_FILL[r.winner]} />}
              {(i + 1) % 5 === 0 && <text x={x0 + bw} y={H - 2} textAnchor="middle" className="fill-muted-foreground text-[10px]">{i + 1}</text>}
            </g>
          );
        })}
        {m.rounds.length > 12 && <line x1={padL + 12 * step} x2={padL + 12 * step} y1={top} y2={H - padB} stroke="var(--muted-foreground)" strokeDasharray="3 3" strokeWidth={1} />}
      </svg>
      {h && hover !== null && (
        <div className="pointer-events-none absolute top-0 z-10 w-56 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md"
          style={{ left: `min(calc(${((padL + hover * step) / W) * 100}% + 12px), calc(100% - 14rem))` }}>
          <div className="mb-1 font-medium">{tt('Round') + ' '}{hover + 1}{h.winner !== null ? tt(' · won by {0}', [m.teams[h.winner].name]) : ''}</div>
          {[0, 1].map((t) => (
            <div key={t} className="flex justify-between gap-2"><span className="truncate">{m.teams[t].name} <span className="text-muted-foreground">({h.ctTeam === t ? 'CT' : 'T'})</span></span>
              <span className="num">{h.buy[t]} · {money(h.equip[t])} {tt('· bank') + ' '}{money(h.bank[t])}</span></div>
          ))}
        </div>
      )}
      <div className="mt-1 flex items-center gap-4 text-[11px] text-muted-foreground">
        {[0, 1].map((t) => <span key={t} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: TEAM_FILL[t] }} />{m.teams[t].name}</span>)}
        <span>{tt('Bars: equipment value after buys · dot: round winner')}{onRound ? ' · click a round to watch it' : ''}</span>
      </div>
    </div>
  );
}

export function MatchDetails({ match: m, onRound }: { match: MatchData; onRound?: (r: number) => void }) {
  const [tab, setTab] = useState<Tab>('economy');
  const sp = useMemo(() => buildSpatial(m), [m]);
  const eco = useMemo(() => economy(m, sp), [m, sp]);
  const wp = useMemo(() => (tab === 'weapons' ? weapons(m) : null), [m, tab]);
  const ut = useMemo(() => (tab === 'utility' ? utility(m) : null), [m, tab]);
  const dm = useMemo(() => (tab === 'duels' ? duelMatrix(m) : null), [m, tab]);
  const name = (p: number) => m.players[p]?.name ?? '?';
  const byTeam = <T extends { player: number }>(rows: T[]) => [0, 1].flatMap((t) => rows.filter((r) => m.players[r.player]?.team === t));

  return (
    <div className="rounded-xl border bg-card p-4 text-card-foreground" data-testid="match-details">
      <div className="mb-3 flex items-center gap-3">
        <span className="text-sm font-medium">{tt('Details')}</span>
        <ToggleGroup type="single" variant="outline" size="sm" value={tab} onValueChange={(v) => v && setTab(v as Tab)}>
          <ToggleGroupItem value="economy" className="px-3 text-xs">{tt('Economy')}</ToggleGroupItem>
          <ToggleGroupItem value="weapons" className="px-3 text-xs">{tt('Weapons')}</ToggleGroupItem>
          <ToggleGroupItem value="utility" className="px-3 text-xs">{tt('Utility')}</ToggleGroupItem>
          <ToggleGroupItem value="duels" className="px-3 text-xs">{tt('Duels')}</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {tab === 'economy' && (
        <div className="space-y-4">
          <EconomyChart m={m} rows={eco} onRound={onRound} />
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map((t) => (
              <Table key={t}>
                <TableHeader><TableRow><TableHead>{m.teams[t].name}</TableHead><TableHead className="text-right">{tt('Rounds')}</TableHead><TableHead className="text-right">{tt('Won')}</TableHead><TableHead className="text-right">{tt('vs full buy')}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {buySummary(eco, t as 0 | 1).map((b) => (
                    <TableRow key={b.buy}><TableCell className="capitalize">{b.buy}</TableCell><TableCell className="num text-right">{b.played}</TableCell>
                      <TableCell className="num text-right">{b.won} <span className="text-muted-foreground">({pct(b.won, b.played)})</span></TableCell>
                      <TableCell className="num text-right">{b.vsFull ? `${b.vsFullWon}/${b.vsFull}` : '—'}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            ))}
          </div>
        </div>
      )}

      {tab === 'weapons' && wp && (
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Table>
            <TableHeader><TableRow><TableHead>{tt('Player')}</TableHead><TableHead>{tt('Weapon')}</TableHead><TableHead className="text-right">{tt('Kills')}</TableHead><TableHead className="text-right">{tt('HS')}</TableHead><TableHead className="text-right">{tt('Damage')}</TableHead><TableHead className="text-right" title={tt('Enemy hits / shots fired')}>{tt('Accuracy')}</TableHead></TableRow></TableHeader>
            <TableBody>
              {byTeam(wp.rows).slice(0, 40).map((r) => (
                <TableRow key={`${r.player}${r.weapon}`}><TableCell className="max-w-28 truncate">{name(r.player)}</TableCell><TableCell><span className="flex items-center gap-2"><WeaponIcon weapon={r.weapon.split('/')[0]} title={r.weapon} className="h-3.5 w-14 justify-start" /><span className="text-muted-foreground">{r.weapon}</span></span></TableCell>
                  <TableCell className="num text-right">{r.kills}</TableCell><TableCell className="num text-right">{pct(r.hs, r.kills)}</TableCell>
                  <TableCell className="num text-right">{r.damage}</TableCell><TableCell className="num text-right">{r.shots ? pct(r.hits, r.shots) : '—'}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">{tt('Where hits land (enemy hits with guns)')}</div>
            {byTeam(wp.hitgroups).map((h) => (
              <div key={h.player} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 text-xs">
                <span className="truncate">{name(h.player)}</span>
                <div className="flex h-3 gap-[2px] overflow-hidden rounded-sm" title={HITGROUPS.map((g) => `${g} ${pct(h.hits[g], h.total)}`).join(' · ')}>
                  {HITGROUPS.map((g, i) => h.hits[g] > 0 && <span key={g} style={{ flex: h.hits[g], background: `color-mix(in oklab, var(--foreground) ${100 - i * 18}%, var(--card))` }} />)}
                </div>
                <span className="num text-right text-muted-foreground">{pct(h.hits.head, h.total)}</span>
              </div>
            ))}
            <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-muted-foreground">
              {HITGROUPS.map((g: Hitgroup, i) => <span key={g} className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: `color-mix(in oklab, var(--foreground) ${100 - i * 18}%, var(--card))` }} />{g}</span>)}
              <span>{tt('· right column: head')}</span>
            </div>
          </div>
        </div>
      )}

      {tab === 'utility' && ut && (
        <Table>
          <TableHeader><TableRow>
            <TableHead>{tt('Player')}</TableHead><TableHead className="text-right" title={tt('Smoke / flash / HE / molotov thrown')}>{tt('S · F · HE · M')}</TableHead>
            <TableHead className="text-right" title={tt('Enemies blinded for 1.1 s or more')}>{tt('Enemies blinded')}</TableHead><TableHead className="text-right" title={tt('Total blind time given to enemies')}>{tt('Blind time')}</TableHead>
            <TableHead className="text-right" title={tt('Enemies killed by a teammate while blinded by this player')}>{tt('Flash → kill')}</TableHead><TableHead className="text-right">{tt('Team flashed')}</TableHead>
            <TableHead className="text-right">{tt('HE dmg (per HE)')}</TableHead><TableHead className="text-right">{tt('Fire dmg (per molly)')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {byTeam(ut).map((u) => (
              <TableRow key={u.player}>
                <TableCell className="max-w-32 truncate">{name(u.player)}</TableCell>
                <TableCell className="num text-right">{u.thrown.smoke} · {u.thrown.flash} · {u.thrown.he} · {u.thrown.molotov}</TableCell>
                <TableCell className="num text-right">{u.enemiesBlinded}{u.thrown.flash ? <span className="text-muted-foreground"> ({(u.enemiesBlinded / u.thrown.flash).toFixed(1)}{tt('/flash)')}</span> : null}</TableCell>
                <TableCell className="num text-right">{u.blindTime.toFixed(1)} s</TableCell>
                <TableCell className="num text-right">{u.flashKills}</TableCell>
                <TableCell className={cn('num text-right', u.teamBlinded > u.enemiesBlinded && u.teamBlinded >= 3 && 'text-destructive')}>{u.teamBlinded}</TableCell>
                <TableCell className="num text-right">{u.heDamage}{u.perHe !== null ? <span className="text-muted-foreground"> ({u.perHe})</span> : null}</TableCell>
                <TableCell className="num text-right">{u.fireDamage}{u.perFire !== null ? <span className="text-muted-foreground"> ({u.perFire})</span> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {tab === 'duels' && dm && (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead><tr><th className="p-1.5 text-left font-normal text-muted-foreground">{m.teams[0].name} {tt('↓ vs') + ' '}{m.teams[1].name} →</th>
              {dm.right.map((p) => <th key={p} className="max-w-24 truncate p-1.5 font-medium">{name(p)}</th>)}</tr></thead>
            <tbody>
              {dm.left.map((p, i) => (
                <tr key={p}>
                  <th className="max-w-28 truncate p-1.5 text-left font-medium">{name(p)}</th>
                  {dm.right.map((q, j) => {
                    const k = dm.kills[i][j], d = dm.killsBack[i][j], net = dm.damage[i][j] - dm.damageBack[i][j];
                    const total = dm.damage[i][j] + dm.damageBack[i][j];
                    return (
                      <td key={q} className="p-0.5" title={tt('{0} dealt {1} to {2}, took {3}', [name(p), dm.damage[i][j], name(q), dm.damageBack[i][j]])}>
                        <div className={cn('w-20 rounded-md border px-2 py-1.5 text-center', net > 0 && 'bg-foreground/10', net > 100 && 'bg-foreground/20')}>
                          <div className="num font-medium">{k}–{d}</div>
                          <div className="num text-[10px] text-muted-foreground">{total ? `${net > 0 ? '+' : ''}${net} dmg` : '—'}</div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">{tt('Each cell: kills–deaths of the row player against the column player, and the damage difference. Lighter cells: the row player came out ahead.')}</p>
        </div>
      )}
    </div>
  );
}
