// Premier lancement de l'app de bureau : bienvenue, puis installation des maps 3D et des modèles
// depuis CS2 (facultatif, refaisable à tout moment dans Settings > 3D maps & models).

import { useEffect, useState } from 'react';
import { Box, Radar, Users } from 'lucide-react';
import { desktop } from '@/app/desktop';
import { navigate } from '@/app/router';
import { Button } from '@/components/ui/button';
import { Maps3DPanel } from './Maps3DPanel';
import { tt } from '@/i18n';

export function SetupWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'welcome' | 'maps'>('welcome');
  useEffect(() => { desktop?.info().then((i) => { if (!i.setupDone) setOpen(true); }); }, []);
  if (!open || !desktop) return null;
  const finish = () => { desktop!.setupDone(true); setOpen(false); };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm" data-testid="setup-wizard">
      <div className="max-h-full w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl border bg-card p-6 shadow-xl">
        {step === 'welcome' ? (
          <>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl border bg-muted/40"><Radar className="size-5" /></div>
              <div><h1 className="text-lg font-semibold">{tt('Welcome to Celeste CS2')}</h1><p className="text-sm text-muted-foreground">{tt('Review your CS2 demos, alone or with your team. Everything stays on this computer.')}</p></div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border p-3"><Box className="mb-1.5 size-4" /><div className="text-sm font-medium">{tt('3D replay')}</div><p className="text-xs text-muted-foreground">{tt('Build the 3D maps and the real player models from your own CS2 install. Optional, a few minutes per map.')}</p></div>
              <div className="rounded-xl border p-3"><Users className="mb-1.5 size-4" /><div className="text-sm font-medium">{tt('Your team')}</div><p className="text-xs text-muted-foreground">{tt('Declare your roster to get a dashboard of your form, per map and per player.')}</p></div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={finish}>{tt('Skip for now')}</Button>
              <Button variant="outline" onClick={() => { finish(); navigate({ page: 'settings', section: 'team' }); }}>{tt('Set up my team')}</Button>
              <Button onClick={() => setStep('maps')} data-testid="wizard-maps"><Box /> {tt('Set up the 3D maps')}</Button>
            </div>
          </>
        ) : (
          <>
            <div><h1 className="text-lg font-semibold">{tt('3D maps & player models')}</h1><p className="text-sm text-muted-foreground">{tt('Pick the maps you want in 3D. You can add others (workshop included) later in Settings.')}</p></div>
            <Maps3DPanel compact onDone={finish} />
          </>
        )}
      </div>
    </div>
  );
}
