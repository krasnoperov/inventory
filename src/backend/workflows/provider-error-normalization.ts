export const IMAGE_PROVIDER_QUOTA_EXHAUSTED_MESSAGE =
  'Image generation is temporarily unavailable because provider quota is exhausted. Please try again later.';

export const IMAGE_PROVIDER_RATE_LIMITED_MESSAGE =
  'Image generation is temporarily busy. Please try again in a minute.';

export const VIDEO_PROVIDER_QUOTA_EXHAUSTED_MESSAGE =
  'Video generation is temporarily unavailable because provider quota is exhausted. Please try again later.';

export const VIDEO_PROVIDER_RATE_LIMITED_MESSAGE =
  'Video generation is temporarily busy. Please try again in a minute.';

export type NormalizedGenerationError = {
  userMessage: string;
  providerMessage: string;
  category: 'safety' | 'quota_exhausted' | 'rate_limited' | 'generic';
};

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function normalizeMediaGenerationError(
  error: unknown,
  mediaKind: 'image' | 'video'
): NormalizedGenerationError {
  const providerMessage = getErrorMessage(error);
  const normalized = providerMessage.toLowerCase();

  if (isSafetyBlockMessage(normalized)) {
    return {
      userMessage: providerMessage,
      providerMessage,
      category: 'safety',
    };
  }

  if (isQuotaExhaustionMessage(normalized)) {
    return {
      userMessage: mediaKind === 'video'
        ? VIDEO_PROVIDER_QUOTA_EXHAUSTED_MESSAGE
        : IMAGE_PROVIDER_QUOTA_EXHAUSTED_MESSAGE,
      providerMessage,
      category: 'quota_exhausted',
    };
  }

  if (isRateLimitMessage(normalized)) {
    return {
      userMessage: mediaKind === 'video'
        ? VIDEO_PROVIDER_RATE_LIMITED_MESSAGE
        : IMAGE_PROVIDER_RATE_LIMITED_MESSAGE,
      providerMessage,
      category: 'rate_limited',
    };
  }

  return {
    userMessage: error instanceof Error ? error.message : 'Generation failed',
    providerMessage,
    category: 'generic',
  };
}

function isSafetyBlockMessage(message: string): boolean {
  return (
    message.includes('prompt blocked for safety') ||
    message.includes('content matched existing material')
  );
}

function isQuotaExhaustionMessage(message: string): boolean {
  return (
    message.includes('resource_exhausted') ||
    message.includes('quota exceeded') ||
    message.includes('current quota') ||
    message.includes('free_tier') ||
    message.includes('freetier') ||
    message.includes('billing details')
  );
}

function isRateLimitMessage(message: string): boolean {
  return (
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('too many requests')
  );
}
