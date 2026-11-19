// Voix enregistrée dans une démo (souvent présente en FACEIT, absente des démos Valve) :
// paquets Opus bruts par joueur, en colonnes, tels que sortis du parser.

export interface VoiceData {
  ticks: Int32Array;
  steamids: string[];
  /** 2 = Opus (seul format décodé). */
  formats: Int32Array;
  sampleRates: Uint32Array;
  starts: Uint32Array;
  lengths: Uint32Array;
  bytes: Uint8Array;
}

export const VOICE_FORMAT_OPUS = 2;

export function voiceTransferables(v: VoiceData): ArrayBuffer[] {
  return [v.ticks, v.formats, v.sampleRates, v.starts, v.lengths, v.bytes].map((a) => a.buffer as ArrayBuffer);
}
