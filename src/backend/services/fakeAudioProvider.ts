import type {
  AudioGenerateOptions,
  AudioGenerationProvider,
  AudioGenerationResult,
} from './audioProvider';

const SAMPLE_RATE = 8000;
const DURATION_MS = 250;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function createSilenceWav(): Uint8Array {
  const sampleCount = Math.floor((SAMPLE_RATE * DURATION_MS) / 1000);
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const dataSize = sampleCount * CHANNELS * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * CHANNELS * bytesPerSample, true);
  view.setUint16(32, CHANNELS * bytesPerSample, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  return new Uint8Array(buffer);
}

export class FakeAudioProvider implements AudioGenerationProvider {
  async generate(options: AudioGenerateOptions): Promise<AudioGenerationResult> {
    return {
      audioData: createSilenceWav(),
      audioMimeType: 'audio/wav',
      model: options.model || 'fake-audio-v1',
      durationMs: DURATION_MS,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    };
  }
}

