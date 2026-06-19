export type ProviderPricingProvider = 'claude' | 'gemini' | 'elevenlabs';
export type ProviderPricingUnit =
  | 'token'
  | 'image'
  | 'video_second'
  | 'character'
  | 'generation'
  | 'minute';

export interface ProviderUsagePricingEvent {
  eventName: string;
  quantity: number;
  metadata?: string | Record<string, unknown> | null;
}

export interface ProviderUsagePrice {
  amountUsd: number;
  currency: 'USD';
  provider: ProviderPricingProvider;
  model: string;
  unit: ProviderPricingUnit;
  quantity: number;
  unitPriceUsd: number;
  rateTable: string;
}

export interface ProviderPricingMiss {
  amountUsd: 0;
  currency: 'USD';
  provider: ProviderPricingProvider | null;
  model: string | null;
  unit: ProviderPricingUnit | null;
  quantity: number;
  reason: 'unsupported_event' | 'unsupported_model' | 'invalid_metadata' | 'unsupported_rate';
}

export type ProviderPricingResult = ProviderUsagePrice | ProviderPricingMiss;

interface TokenRatesPerMillion {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

interface GeminiImageRate extends TokenRatesPerMillion {
  imageUsd: number | Partial<Record<'0.5K' | '1K' | '2K' | '4K', number>>;
}

interface GeminiVideoRate {
  videoUsdPerSecond: Partial<Record<'720p' | '1080p' | '4k', number>>;
  videoWithAudioUsdPerSecond: Partial<Record<'720p' | '1080p' | '4k', number>>;
}

interface ElevenLabsRate {
  unit: 'character' | 'generation' | 'minute';
  unitPriceUsd: number;
  usageUnitPriceUsd?: number;
}

const TOKENS_PER_MILLION = 1_000_000;
const CHARACTERS_PER_THOUSAND = 1_000;
const SECONDS_PER_MINUTE = 60;
const DEFAULT_VIDEO_DURATION_SECONDS = 8;
const DEFAULT_VIDEO_RESOLUTION = '720p';

export const PROVIDER_PRICING_SOURCES = {
  claude: 'https://platform.claude.com/docs/en/about-claude/pricing',
  gemini: 'https://ai.google.dev/gemini-api/docs/pricing',
  elevenlabs: 'https://elevenlabs.io/pricing/api',
} as const;

export const CLAUDE_TOKEN_RATES_USD_PER_MILLION: Record<string, TokenRatesPerMillion> = {
  'claude-fable-5': { inputUsdPerMillion: 10, outputUsdPerMillion: 50 },
  'claude-mythos-5': { inputUsdPerMillion: 10, outputUsdPerMillion: 50 },
  'claude-opus-4.8': { inputUsdPerMillion: 5, outputUsdPerMillion: 25 },
  'claude-opus-4.7': { inputUsdPerMillion: 5, outputUsdPerMillion: 25 },
  'claude-opus-4.6': { inputUsdPerMillion: 5, outputUsdPerMillion: 25 },
  'claude-opus-4.5': { inputUsdPerMillion: 5, outputUsdPerMillion: 25 },
  'claude-opus-4.1': { inputUsdPerMillion: 15, outputUsdPerMillion: 75 },
  'claude-opus-4': { inputUsdPerMillion: 15, outputUsdPerMillion: 75 },
  'claude-sonnet-4.6': { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  'claude-sonnet-4.5': { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  'claude-sonnet-4': { inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  'claude-haiku-4.5': { inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
  'claude-haiku-3.5': { inputUsdPerMillion: 0.8, outputUsdPerMillion: 4 },
};

export const GEMINI_IMAGE_RATES_USD: Record<string, GeminiImageRate> = {
  'gemini-3-pro-image': {
    inputUsdPerMillion: 2,
    outputUsdPerMillion: 12,
    imageUsd: { '1K': 0.134, '2K': 0.134, '4K': 0.24 },
  },
  'gemini-2.5-flash-image': {
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 2.5,
    imageUsd: 0.039,
  },
};

export const GEMINI_VIDEO_RATES_USD: Record<string, GeminiVideoRate> = {
  'veo-3.1-generate-preview': {
    videoUsdPerSecond: { '720p': 0.2, '1080p': 0.2, '4k': 0.4 },
    videoWithAudioUsdPerSecond: { '720p': 0.4, '1080p': 0.4, '4k': 0.6 },
  },
  'veo-3.1-fast-generate-preview': {
    videoUsdPerSecond: { '720p': 0.08, '1080p': 0.1, '4k': 0.25 },
    videoWithAudioUsdPerSecond: { '720p': 0.1, '1080p': 0.12, '4k': 0.3 },
  },
  'veo-3.1-lite-generate-preview': {
    videoUsdPerSecond: { '720p': 0.03, '1080p': 0.05 },
    videoWithAudioUsdPerSecond: { '720p': 0.05, '1080p': 0.08 },
  },
};

export const GEMINI_AUDIO_RATES_USD: Record<string, { generationUsd: number }> = {
  'lyria-3-clip-preview': { generationUsd: 0.04 },
  'lyria-3-pro-preview': { generationUsd: 0.08 },
};

export const ELEVENLABS_RATES_USD: Record<string, ElevenLabsRate> = {
  'eleven_flash_v2': { unit: 'character', unitPriceUsd: 0.05 / CHARACTERS_PER_THOUSAND },
  'eleven_flash_v2_5': { unit: 'character', unitPriceUsd: 0.05 / CHARACTERS_PER_THOUSAND },
  'eleven_turbo_v2': { unit: 'character', unitPriceUsd: 0.05 / CHARACTERS_PER_THOUSAND },
  'eleven_turbo_v2_5': { unit: 'character', unitPriceUsd: 0.05 / CHARACTERS_PER_THOUSAND },
  'eleven_multilingual_v1': { unit: 'character', unitPriceUsd: 0.1 / CHARACTERS_PER_THOUSAND },
  'eleven_multilingual_v2': { unit: 'character', unitPriceUsd: 0.1 / CHARACTERS_PER_THOUSAND },
  'eleven_v3': { unit: 'character', unitPriceUsd: 0.1 / CHARACTERS_PER_THOUSAND },
  'music_v1': { unit: 'minute', unitPriceUsd: 0.15, usageUnitPriceUsd: 0.15 / CHARACTERS_PER_THOUSAND },
  'eleven_music_v1': { unit: 'minute', unitPriceUsd: 0.15, usageUnitPriceUsd: 0.15 / CHARACTERS_PER_THOUSAND },
  'eleven_text_to_sound_v2': { unit: 'generation', unitPriceUsd: 0.12 },
};

const GEMINI_MODEL_ALIASES: Record<string, string> = {
  'gemini-3-pro-image-preview': 'gemini-3-pro-image',
};

export function priceProviderUsageEvent(event: ProviderUsagePricingEvent): ProviderPricingResult {
  const metadata = parseMetadata(event.metadata);
  if (!metadata) {
    return miss(event, null, null, null, 'invalid_metadata');
  }

  switch (event.eventName) {
    case 'claude_input_tokens':
      return priceClaudeTokens(event, metadata, 'input');
    case 'claude_output_tokens':
      return priceClaudeTokens(event, metadata, 'output');
    case 'gemini_input_tokens':
      return priceGeminiTokens(event, metadata, 'input');
    case 'gemini_output_tokens':
      return priceGeminiTokens(event, metadata, 'output');
    case 'gemini_images':
      return priceGeminiImages(event, metadata);
    case 'gemini_videos':
      return priceGeminiVideos(event, metadata);
    case 'gemini_audio':
      return priceGeminiAudio(event, metadata);
    case 'elevenlabs_audio':
      return priceElevenLabsAudio(event, metadata);
    default:
      return miss(event, null, null, null, 'unsupported_event');
  }
}

function priceClaudeTokens(
  event: ProviderUsagePricingEvent,
  metadata: Record<string, unknown>,
  tokenType: 'input' | 'output'
): ProviderPricingResult {
  const model = normalizeClaudeModel(getString(metadata, 'model') ?? '');
  if (!model) return miss(event, 'claude', null, 'token', 'unsupported_model');

  const rate = CLAUDE_TOKEN_RATES_USD_PER_MILLION[model];
  if (!rate) return miss(event, 'claude', model, 'token', 'unsupported_model');

  const unitPriceUsd =
    (tokenType === 'input' ? rate.inputUsdPerMillion : rate.outputUsdPerMillion) / TOKENS_PER_MILLION;
  return priced(event, 'claude', model, 'token', normalizedQuantity(event.quantity), unitPriceUsd, 'claude');
}

function priceGeminiTokens(
  event: ProviderUsagePricingEvent,
  metadata: Record<string, unknown>,
  tokenType: 'input' | 'output'
): ProviderPricingResult {
  const model = normalizeGeminiImageModel(getString(metadata, 'model') ?? '');
  if (!model) return miss(event, 'gemini', null, 'token', 'unsupported_model');

  const rate = GEMINI_IMAGE_RATES_USD[model];
  if (!rate) return miss(event, 'gemini', model, 'token', 'unsupported_model');

  const unitPriceUsd =
    (tokenType === 'input' ? rate.inputUsdPerMillion : rate.outputUsdPerMillion) / TOKENS_PER_MILLION;
  return priced(event, 'gemini', model, 'token', normalizedQuantity(event.quantity), unitPriceUsd, 'gemini');
}

function priceGeminiImages(
  event: ProviderUsagePricingEvent,
  metadata: Record<string, unknown>
): ProviderPricingResult {
  const model = normalizeGeminiImageModel(getString(metadata, 'model') ?? '');
  if (!model) return miss(event, 'gemini', null, 'image', 'unsupported_model');

  const rate = GEMINI_IMAGE_RATES_USD[model];
  if (!rate) return miss(event, 'gemini', model, 'image', 'unsupported_model');

  const imageSize = normalizeImageSize(
    getString(metadata, 'imageSize') ??
    getString(metadata, 'image_size') ??
    getString(metadata, 'resolution')
  );
  const unitPriceUsd = typeof rate.imageUsd === 'number'
    ? rate.imageUsd
    : (imageSize ? rate.imageUsd[imageSize] : undefined) ?? highestImageRate(rate.imageUsd);

  if (unitPriceUsd === undefined) {
    return miss(event, 'gemini', model, 'image', 'unsupported_rate');
  }

  return priced(event, 'gemini', model, 'image', normalizedQuantity(event.quantity), unitPriceUsd, 'gemini');
}

function priceGeminiVideos(
  event: ProviderUsagePricingEvent,
  metadata: Record<string, unknown>
): ProviderPricingResult {
  const model = getString(metadata, 'model') ?? '';
  if (!isGeminiVideoModel(model)) {
    return miss(event, 'gemini', model || null, 'video_second', 'unsupported_model');
  }

  const resolution = normalizeVideoResolution(getString(metadata, 'resolution'));
  const rates = GEMINI_VIDEO_RATES_USD[model];
  const unitPriceUsd = rates.videoWithAudioUsdPerSecond[resolution];
  if (unitPriceUsd === undefined) {
    return miss(event, 'gemini', model, 'video_second', 'unsupported_rate');
  }

  const durationSeconds =
    getPositiveNumber(metadata, 'durationSeconds') ??
    getPositiveNumber(metadata, 'duration_seconds') ??
    secondsFromMs(getPositiveNumber(metadata, 'durationMs') ?? getPositiveNumber(metadata, 'duration_ms')) ??
    DEFAULT_VIDEO_DURATION_SECONDS;

  const videoCount =
    getPositiveNumber(metadata, 'video_count') ??
    getPositiveNumber(metadata, 'videoCount') ??
    normalizedQuantity(event.quantity);
  const videoSeconds = videoCount * durationSeconds;
  return priced(event, 'gemini', model, 'video_second', videoSeconds, unitPriceUsd, 'gemini');
}

function priceGeminiAudio(
  event: ProviderUsagePricingEvent,
  metadata: Record<string, unknown>
): ProviderPricingResult {
  const model = normalizeLyriaModel(getString(metadata, 'model') ?? '');
  if (!model) return miss(event, 'gemini', null, 'generation', 'unsupported_model');

  const rate = GEMINI_AUDIO_RATES_USD[model];
  if (!rate) return miss(event, 'gemini', model, 'generation', 'unsupported_model');

  return priced(event, 'gemini', model, 'generation', normalizedQuantity(event.quantity), rate.generationUsd, 'gemini');
}

function priceElevenLabsAudio(
  event: ProviderUsagePricingEvent,
  metadata: Record<string, unknown>
): ProviderPricingResult {
  const model = getString(metadata, 'model') ?? '';
  const rate = ELEVENLABS_RATES_USD[model];
  if (!rate) return miss(event, 'elevenlabs', model || null, null, 'unsupported_model');

  let quantity = normalizedQuantity(event.quantity);
  if (rate.unit === 'generation') {
    quantity = getPositiveNumber(metadata, 'generations') ?? getPositiveNumber(metadata, 'generation_count') ?? 1;
  } else if (rate.unit === 'minute') {
    const durationMinutes =
      getPositiveNumber(metadata, 'durationMinutes') ??
      getPositiveNumber(metadata, 'duration_minutes') ??
      minutesFromMs(getPositiveNumber(metadata, 'durationMs') ?? getPositiveNumber(metadata, 'duration_ms')) ??
      secondsToMinutes(getPositiveNumber(metadata, 'durationSeconds') ?? getPositiveNumber(metadata, 'duration_seconds'));
    if (durationMinutes === null) {
      const usageUnits =
        getPositiveNumber(metadata, 'total_tokens') ??
        getPositiveNumber(metadata, 'input_tokens') ??
        quantity;
      if (rate.usageUnitPriceUsd !== undefined && usageUnits > 0) {
        return priced(event, 'elevenlabs', model, 'character', usageUnits, rate.usageUnitPriceUsd, 'elevenlabs');
      }
      return miss(event, 'elevenlabs', model, 'minute', 'unsupported_rate');
    }
    quantity = durationMinutes;
  } else {
    quantity =
      getPositiveNumber(metadata, 'total_tokens') ??
      getPositiveNumber(metadata, 'input_tokens') ??
      quantity;
  }

  return priced(event, 'elevenlabs', model, rate.unit, quantity, rate.unitPriceUsd, 'elevenlabs');
}

function priced(
  event: ProviderUsagePricingEvent,
  provider: ProviderPricingProvider,
  model: string,
  unit: ProviderPricingUnit,
  quantity: number,
  unitPriceUsd: number,
  rateTable: keyof typeof PROVIDER_PRICING_SOURCES
): ProviderUsagePrice {
  return {
    amountUsd: quantity * unitPriceUsd,
    currency: 'USD',
    provider,
    model,
    unit,
    quantity,
    unitPriceUsd,
    rateTable: PROVIDER_PRICING_SOURCES[rateTable],
  };
}

function miss(
  event: ProviderUsagePricingEvent,
  provider: ProviderPricingProvider | null,
  model: string | null,
  unit: ProviderPricingUnit | null,
  reason: ProviderPricingMiss['reason']
): ProviderPricingMiss {
  return {
    amountUsd: 0,
    currency: 'USD',
    provider,
    model,
    unit,
    quantity: normalizedQuantity(event.quantity),
    reason,
  };
}

function parseMetadata(metadata: ProviderUsagePricingEvent['metadata']): Record<string, unknown> | null {
  if (!metadata) return {};
  if (typeof metadata !== 'string') return metadata;
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizeClaudeModel(model: string): string | null {
  if (model in CLAUDE_TOKEN_RATES_USD_PER_MILLION) {
    return model;
  }

  const lower = model.toLowerCase();
  if (lower.startsWith('claude-fable-5')) return 'claude-fable-5';
  if (lower.startsWith('claude-mythos-5')) return 'claude-mythos-5';
  if (lower.startsWith('claude-opus-4-8')) return 'claude-opus-4.8';
  if (lower.startsWith('claude-opus-4-7')) return 'claude-opus-4.7';
  if (lower.startsWith('claude-opus-4-6')) return 'claude-opus-4.6';
  if (lower.startsWith('claude-opus-4-5')) return 'claude-opus-4.5';
  if (lower.startsWith('claude-opus-4-1')) return 'claude-opus-4.1';
  if (lower.startsWith('claude-opus-4')) return 'claude-opus-4';
  if (lower.startsWith('claude-sonnet-4-6')) return 'claude-sonnet-4.6';
  if (lower.startsWith('claude-sonnet-4-5')) return 'claude-sonnet-4.5';
  if (lower.startsWith('claude-sonnet-4')) return 'claude-sonnet-4';
  if (lower.startsWith('claude-haiku-4-5')) return 'claude-haiku-4.5';
  if (lower.startsWith('claude-3-5-haiku')) return 'claude-haiku-3.5';
  if (lower.startsWith('claude-haiku-3-5')) return 'claude-haiku-3.5';
  return null;
}

function normalizeGeminiImageModel(model: string): string | null {
  if (model in GEMINI_IMAGE_RATES_USD) return model;
  return GEMINI_MODEL_ALIASES[model] ?? null;
}

function isGeminiVideoModel(model: string): boolean {
  return model in GEMINI_VIDEO_RATES_USD;
}

function normalizeLyriaModel(model: string): string | null {
  if (model in GEMINI_AUDIO_RATES_USD) return model;
  const match = model.match(/(?:^|\/)(lyria-3-(?:clip|pro)-preview)$/);
  return match?.[1] ?? null;
}

function normalizeImageSize(value?: string | null): '0.5K' | '1K' | '2K' | '4K' | null {
  const normalized = value?.trim().toUpperCase();
  if (normalized === '0.5K' || normalized === '512' || normalized === '512PX') return '0.5K';
  if (normalized === '1K' || normalized === '1024' || normalized === '1024PX') return '1K';
  if (normalized === '2K' || normalized === '2048' || normalized === '2048PX') return '2K';
  if (normalized === '4K' || normalized === '4096' || normalized === '4096PX') return '4K';
  return null;
}

function normalizeVideoResolution(value?: string | null): '720p' | '1080p' | '4k' {
  const normalized = value?.trim().toLowerCase();
  if (normalized === '1080p') return '1080p';
  if (normalized === '4k') return '4k';
  return DEFAULT_VIDEO_RESOLUTION;
}

function getString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getPositiveNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function normalizedQuantity(quantity: number): number {
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

function highestImageRate(rates: Partial<Record<'0.5K' | '1K' | '2K' | '4K', number>>): number | undefined {
  const values = Object.values(rates).filter((rate): rate is number => typeof rate === 'number');
  return values.length > 0 ? Math.max(...values) : undefined;
}

function secondsFromMs(milliseconds?: number | null): number | null {
  return milliseconds ? milliseconds / 1000 : null;
}

function minutesFromMs(milliseconds?: number | null): number | null {
  return milliseconds ? milliseconds / 1000 / SECONDS_PER_MINUTE : null;
}

function secondsToMinutes(seconds?: number | null): number | null {
  return seconds ? seconds / SECONDS_PER_MINUTE : null;
}
