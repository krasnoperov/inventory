import type {
  AudioGenerateOptions,
  AudioGenerationProvider,
  AudioGenerationResult,
  AudioSidecar,
} from './audioProvider';
import { base64ToBuffer } from '../utils/image-utils';

type Fetcher = typeof fetch;

interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface ElevenLabsVoiceSegment {
  voice_id: string;
  start_time_seconds: number;
  end_time_seconds: number;
  character_start_index: number;
  character_end_index: number;
  dialogue_input_index: number;
}

interface ElevenLabsTimingResponse {
  audio_base64: string;
  alignment?: ElevenLabsAlignment | null;
  normalized_alignment?: ElevenLabsAlignment | null;
  voice_segments?: ElevenLabsVoiceSegment[];
}

export interface ElevenLabsAudioProviderConfig {
  apiKey: string;
  voiceId: string;
  dialogueVoiceIds?: string[];
  modelId?: string;
  outputFormat?: string;
  fetcher?: Fetcher;
}

export interface ParsedDialogueLine {
  speaker: string;
  text: string;
}

export class ElevenLabsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'ElevenLabsApiError';
  }
}

const BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
const TEXT_ENCODER = new TextEncoder();

export function parseElevenLabsDialoguePrompt(prompt: string): ParsedDialogueLine[] | null {
  const lines = prompt
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return null;

  const parsed: ParsedDialogueLine[] = [];
  for (const line of lines) {
    const match = /^([^:\n]{1,64}):\s+(.+)$/.exec(line);
    if (!match) return null;
    parsed.push({
      speaker: match[1].trim(),
      text: match[2].trim(),
    });
  }

  const speakerCount = new Set(parsed.map(line => line.speaker)).size;
  return speakerCount >= 2 ? parsed : null;
}

export function getMimeTypeForElevenLabsOutputFormat(outputFormat: string): string {
  const codec = outputFormat.split('_')[0];
  switch (codec) {
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'pcm':
      return 'audio/L16';
    case 'ulaw':
      return 'audio/basic';
    default:
      return 'application/octet-stream';
  }
}

export class ElevenLabsAudioProvider implements AudioGenerationProvider {
  private readonly fetcher: Fetcher;
  private readonly outputFormat: string;

  constructor(private readonly config: ElevenLabsAudioProviderConfig) {
    this.fetcher = config.fetcher ?? fetch;
    this.outputFormat = config.outputFormat ?? DEFAULT_OUTPUT_FORMAT;
  }

  async generate(options: AudioGenerateOptions): Promise<AudioGenerationResult> {
    const dialogue = parseElevenLabsDialoguePrompt(options.prompt);
    if (dialogue) {
      return this.generateDialogue(options, dialogue);
    }
    return this.generateSpeech(options);
  }

  private async generateSpeech(options: AudioGenerateOptions): Promise<AudioGenerationResult> {
    if (!this.config.voiceId) {
      throw new ElevenLabsApiError('ELEVENLABS_VOICE_ID is required for speech generation', 0, false);
    }

    const model = this.resolveModel(options.model);
    const response = await this.postWithTiming(
      `/text-to-speech/${encodeURIComponent(this.config.voiceId)}/with-timestamps`,
      {
        text: options.prompt,
        ...(model ? { model_id: model } : {}),
      }
    );

    return this.toAudioResult(response, {
      kind: 'speech',
      model,
      transcript: options.prompt,
      voices: [{ voiceId: this.config.voiceId }],
    });
  }

  private async generateDialogue(
    options: AudioGenerateOptions,
    dialogue: ParsedDialogueLine[]
  ): Promise<AudioGenerationResult> {
    const speakerVoiceIds = this.assignDialogueVoices(dialogue);
    const model = this.resolveModel(options.model);
    const inputs = dialogue.map(line => ({
      text: line.text,
      voice_id: speakerVoiceIds.get(line.speaker)!,
    }));

    const response = await this.postWithTiming('/text-to-dialogue/with-timestamps', {
      inputs,
      ...(model ? { model_id: model } : {}),
    });

    return this.toAudioResult(response, {
      kind: 'dialogue',
      model,
      transcript: dialogue.map(line => `${line.speaker}: ${line.text}`).join('\n'),
      voices: Array.from(speakerVoiceIds.entries()).map(([speaker, voiceId]) => ({ speaker, voiceId })),
      dialogueInputs: dialogue,
    });
  }

  private assignDialogueVoices(dialogue: ParsedDialogueLine[]): Map<string, string> {
    const speakers = Array.from(new Set(dialogue.map(line => line.speaker)));
    const voiceIds = this.config.dialogueVoiceIds?.length
      ? this.config.dialogueVoiceIds
      : [this.config.voiceId].filter(Boolean);

    if (voiceIds.length < speakers.length) {
      throw new ElevenLabsApiError(
        `ELEVENLABS_DIALOGUE_VOICE_IDS must include at least ${speakers.length} voice IDs for this dialogue`,
        0,
        false
      );
    }

    return new Map(speakers.map((speaker, index) => [speaker, voiceIds[index]]));
  }

  private resolveModel(requestModel?: string): string | undefined {
    return requestModel || this.config.modelId || undefined;
  }

  private async postWithTiming(path: string, body: unknown): Promise<ElevenLabsTimingResponse> {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set('output_format', this.outputFormat);

    const response = await this.fetcher(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.config.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw await this.toApiError(response);
    }

    const payload = await response.json<ElevenLabsTimingResponse>();
    if (!payload.audio_base64) {
      throw new ElevenLabsApiError('ElevenLabs response did not include audio data', 502, true);
    }
    return payload;
  }

  private async toApiError(response: Response): Promise<ElevenLabsApiError> {
    let body = '';
    try {
      body = await response.text();
    } catch {
      // Ignore body read errors; status is still enough to classify retries.
    }
    const detail = extractErrorDetail(body);
    const retryable = response.status === 429 || response.status >= 500;
    return new ElevenLabsApiError(
      `ElevenLabs audio generation failed (${response.status})${detail ? `: ${detail}` : ''}`,
      response.status,
      retryable
    );
  }

  private toAudioResult(
    response: ElevenLabsTimingResponse,
    metadata: {
      kind: 'speech' | 'dialogue';
      model?: string;
      transcript: string;
      voices: Array<{ speaker?: string; voiceId: string }>;
      dialogueInputs?: ParsedDialogueLine[];
    }
  ): AudioGenerationResult {
    const timingPayload = {
      provider: 'elevenlabs',
      kind: metadata.kind,
      alignment: response.alignment ?? null,
      normalizedAlignment: response.normalized_alignment ?? null,
      voiceSegments: response.voice_segments ?? null,
    };
    const renderMetadata = {
      provider: 'elevenlabs',
      kind: metadata.kind,
      model: metadata.model ?? null,
      outputFormat: this.outputFormat,
      voices: metadata.voices,
      dialogueInputs: metadata.dialogueInputs,
    };

    return {
      audioData: base64ToBuffer(response.audio_base64),
      audioMimeType: getMimeTypeForElevenLabsOutputFormat(this.outputFormat),
      model: metadata.model ?? defaultModelForKind(metadata.kind),
      durationMs: getDurationMs(response),
      transcript: textSidecar(metadata.transcript, 'text/plain'),
      wordTimings: jsonSidecar(timingPayload),
      renderMetadata: jsonSidecar(renderMetadata),
    };
  }
}

function defaultModelForKind(kind: 'speech' | 'dialogue'): string {
  return kind === 'dialogue' ? 'eleven_v3' : 'eleven_multilingual_v2';
}

function getDurationMs(response: ElevenLabsTimingResponse): number | null {
  const candidates: number[] = [];
  const alignment = response.normalized_alignment ?? response.alignment;
  if (alignment?.character_end_times_seconds.length) {
    candidates.push(...alignment.character_end_times_seconds);
  }
  if (response.voice_segments?.length) {
    candidates.push(...response.voice_segments.map(segment => segment.end_time_seconds));
  }
  if (candidates.length === 0) return null;
  return Math.round(Math.max(...candidates) * 1000);
}

function textSidecar(text: string, mimeType: string): AudioSidecar {
  return {
    data: TEXT_ENCODER.encode(text),
    mimeType,
  };
}

function jsonSidecar(value: unknown): AudioSidecar {
  return textSidecar(JSON.stringify(value, null, 2), 'application/json');
}

function extractErrorDetail(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; message?: unknown };
    const detail = parsed.detail ?? parsed.message;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object') return JSON.stringify(detail);
  } catch {
    return body.slice(0, 500);
  }
  return null;
}
