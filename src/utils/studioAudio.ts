import { sanitizeCustomSoundCue, type CustomSoundCue } from '../../shared/soundboard.ts';

export type StudioCueId = 'join' | 'leave' | 'mute' | 'unmute' | 'chime' | 'chord' | 'bell' | 'fanfare';

export const SOUNDBOARD_CUES: Array<{ id: StudioCueId; label: string; description: string }> = [
  { id: 'chime', label: 'Studio Chime', description: 'Crisp crystalline 2-note chime' },
  { id: 'chord', label: 'Warm Chord', description: 'Lush major-9th synth pad' },
  { id: 'bell', label: 'Pulse Bell', description: 'Harmonic telemetry ping' },
  { id: 'fanfare', label: 'Fanfare', description: 'Uplifting brass-synth triad' },
];

let audioCtx: AudioContext | null = null;
let sfxMuted = false;

export function setStudioAudioMuted(muted: boolean): void {
  sfxMuted = muted;
}

export function isStudioAudioMuted(): boolean {
  return sfxMuted;
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(
  ctx: AudioContext,
  freq: number,
  startOffset: number,
  duration: number,
  type: OscillatorType = 'sine',
  peakGain = 0.08
) {
  const now = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peakGain, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.03);
}

export function playStudioCue(cue: StudioCueId): void {
  if (sfxMuted) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    switch (cue) {
      case 'join':
        playTone(ctx, 440, 0, 0.14, 'triangle', 0.06);
        playTone(ctx, 659.25, 0.08, 0.22, 'triangle', 0.07);
        break;
      case 'leave':
        playTone(ctx, 523.25, 0, 0.12, 'triangle', 0.05);
        playTone(ctx, 349.23, 0.09, 0.2, 'triangle', 0.05);
        break;
      case 'mute':
        playTone(ctx, 320, 0, 0.08, 'sine', 0.045);
        break;
      case 'unmute':
        playTone(ctx, 520, 0, 0.09, 'sine', 0.05);
        break;
      case 'chime':
        playTone(ctx, 783.99, 0, 0.22, 'sine', 0.07);
        playTone(ctx, 1174.66, 0.09, 0.36, 'sine', 0.07);
        break;
      case 'chord':
        playTone(ctx, 261.63, 0, 0.65, 'triangle', 0.045);
        playTone(ctx, 329.63, 0.02, 0.65, 'triangle', 0.045);
        playTone(ctx, 392.0, 0.04, 0.65, 'triangle', 0.045);
        playTone(ctx, 493.88, 0.06, 0.7, 'sine', 0.04);
        playTone(ctx, 587.33, 0.08, 0.75, 'sine', 0.04);
        break;
      case 'bell':
        playTone(ctx, 987.77, 0, 0.45, 'sine', 0.065);
        playTone(ctx, 1479.98, 0, 0.25, 'sine', 0.03);
        break;
      case 'fanfare':
        playTone(ctx, 523.25, 0, 0.14, 'triangle', 0.06);
        playTone(ctx, 659.25, 0.11, 0.14, 'triangle', 0.06);
        playTone(ctx, 783.99, 0.22, 0.16, 'triangle', 0.065);
        playTone(ctx, 1046.5, 0.34, 0.45, 'triangle', 0.08);
        break;
    }
  } catch {
    // AudioContext blocked or unavailable
  }
}

export function playCustomStudioCue(value: CustomSoundCue): void {
  if (sfxMuted) return;
  const cue = sanitizeCustomSoundCue(value);
  if (!cue) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    cue.notes.forEach((note, index) => {
      playTone(ctx, note.frequency, index * 0.035, note.durationMs / 1000, 'triangle', 0.045);
    });
  } catch {
    // AudioContext blocked or unavailable.
  }
}
