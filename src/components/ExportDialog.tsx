// Export du moment : image PNG ou clip vidéo, HUD incrusté. Tout est généré localement.

import { useState } from 'react';
import { Film, ImageDown } from 'lucide-react';
import type { Playback } from '@/viewer/playback';
import { captureImage, clipMimeType, momentName, recordClip, type ClipJob } from '@/scrim/export';
import { downloadBlob } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { tt } from '@/i18n';

interface Props {
  pb: Playback;
  canvas: () => HTMLCanvasElement | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function ExportDialog({ pb, canvas, open, onOpenChange }: Props) {
  const [seconds, setSeconds] = useState('10');
  const [speed, setSpeed] = useState('1');
  const [progress, setProgress] = useState<number | null>(null);
  const [job, setJob] = useState<ClipJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mime = clipMimeType();
  const ext = mime?.includes('mp4') ? 'mp4' : 'webm';

  const image = async () => {
    const c = canvas();
    if (!c) return;
    setError(null);
    try {
      downloadBlob(await captureImage(pb, c), momentName(pb, 'png'));
      onOpenChange(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const clip = async () => {
    const c = canvas();
    if (!c) return;
    setError(null);
    const name = momentName(pb, ext);
    try {
      const j = recordClip(pb, c, { seconds: Number(seconds), speed: Number(speed) }, setProgress);
      setJob(j);
      setProgress(0);
      const blob = await j.done;
      downloadBlob(blob, name);
      onOpenChange(false);
    } catch (e) {
      if (!(e instanceof Error && e.message === 'cancelled')) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJob(null);
      setProgress(null);
    }
  };

  const recording = progress !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!recording) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tt('Export this moment')}</DialogTitle>
          <DialogDescription>{tt('Score, round, clock and recent kills are drawn on the export. Files are created on your computer.')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{tt('Clip length (game time, from now)')}</Label>
            <ToggleGroup type="single" variant="outline" size="sm" value={seconds} onValueChange={(v) => v && setSeconds(v)} disabled={recording}>
              {['5', '10', '20', '30'].map((s) => <ToggleGroupItem key={s} value={s} className="px-3">{s} s</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
          <div className="space-y-2">
            <Label>{tt('Speed')}</Label>
            <ToggleGroup type="single" variant="outline" size="sm" value={speed} onValueChange={(v) => v && setSpeed(v)} disabled={recording}>
              {['0.5', '1', '2'].map((s) => <ToggleGroupItem key={s} value={s} className="px-3">{s}×</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
          {recording && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground"><span>{tt('Recording…')}</span><span className="num">{Math.round((progress ?? 0) * 100)}%</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${(progress ?? 0) * 100}%` }} /></div>
            </div>
          )}
          {!mime && <p className="text-xs text-muted-foreground">{tt('Video recording is not supported in this browser. Image export still works.')}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          {recording ? (
            <Button variant="outline" onClick={() => job?.cancel()}>{tt('Cancel')}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={image}><ImageDown /> {tt('Image (PNG)')}</Button>
              <Button onClick={clip} disabled={!mime}><Film /> {tt('Clip (')}{ext.toUpperCase()})</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
