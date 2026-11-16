export interface CustomSoundCue {
  id: string;
  name: string;
  notes: Array<{ frequency: number; durationMs: number }>;
}

export function sanitizeCustomSoundCue(value: unknown): CustomSoundCue | null {
  if (!value || typeof value !== 'object') return null;
  const cue = value as Partial<CustomSoundCue>;
  if (
    typeof cue.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(cue.id) ||
    typeof cue.name !== 'string' ||
    !cue.name.trim() ||
    cue.name.length > 24 ||
    !Array.isArray(cue.notes) ||
    cue.notes.length < 1 ||
    cue.notes.length > 8
  ) {
    return null;
  }

  const notes: CustomSoundCue['notes'] = [];
  for (const note of cue.notes) {
    if (
      !note ||
      typeof note.frequency !== 'number' ||
      !Number.isFinite(note.frequency) ||
      note.frequency < 80 ||
      note.frequency > 2000 ||
      typeof note.durationMs !== 'number' ||
      !Number.isFinite(note.durationMs) ||
      note.durationMs < 80 ||
      note.durationMs > 900
    ) {
      return null;
    }
    notes.push({ frequency: note.frequency, durationMs: note.durationMs });
  }

  return { id: cue.id, name: cue.name.trim(), notes };
}