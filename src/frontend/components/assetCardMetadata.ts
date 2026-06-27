import type { Variant } from '../hooks/useSpaceWebSocket';

export interface AudioCardMetadata {
  name: string | null;
  prompt: string | null;
  model: string | null;
  voice: string | null;
}

export function getAudioCardMetadata(variant: Variant | null | undefined): AudioCardMetadata {
  if (!variant || variant.media_kind !== 'audio') {
    return { name: null, prompt: null, model: null, voice: null };
  }

  const recipe = parseJsonObject(variant.recipe);
  const provenance = parseJsonObject(variant.generation_provenance);
  const provider = parseJsonObject(variant.provider_metadata);

  return {
    name: firstText(recipe?.name, provider?.name, provenance?.name),
    prompt: firstText(recipe?.prompt, provenance?.prompt),
    model: firstText(provider?.model, recipe?.model, provenance?.model),
    voice: formatVoice(
      provider?.voices,
      recipe?.voiceName,
      recipe?.voiceNames,
      recipe?.dialogueVoiceNames,
      recipe?.voiceId,
      recipe?.dialogueVoiceIds,
      provider?.voiceName,
      provider?.voiceId,
      provider?.voice
    ),
  };
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (text) return text;
  }
  return null;
}

function formatVoice(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const text = value.trim();
      if (text) return text;
    }
    if (Array.isArray(value)) {
      const voices = value
        .map(formatVoiceEntry)
        .filter(Boolean);
      if (voices.length > 0) return voices.join(', ');
    }
  }
  return null;
}

function formatVoiceEntry(entry: unknown): string | null {
  if (typeof entry === 'string') {
    const text = entry.trim();
    return text || null;
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

  const record = entry as Record<string, unknown>;
  const label = firstText(record.name, record.voiceName, record.voiceId, record.id);
  if (!label) return null;
  const speaker = firstText(record.speaker, record.speakerName);
  return speaker ? `${speaker}: ${label}` : label;
}
