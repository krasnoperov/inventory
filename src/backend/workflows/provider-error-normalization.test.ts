import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_PROVIDER_QUOTA_EXHAUSTED_MESSAGE,
  IMAGE_PROVIDER_RATE_LIMITED_MESSAGE,
  normalizeImageGenerationError,
} from './provider-error-normalization';

describe('normalizeImageGenerationError', () => {
  test('maps Gemini quota exhaustion JSON to a concise user message', () => {
    const error = new Error(
      'GeminiRateLimitError: {"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.\\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-2.5-flash-preview-image","status":"RESOURCE_EXHAUSTED"}}'
    );

    const normalized = normalizeImageGenerationError(error);

    assert.equal(normalized.category, 'quota_exhausted');
    assert.equal(normalized.userMessage, IMAGE_PROVIDER_QUOTA_EXHAUSTED_MESSAGE);
    assert.match(normalized.providerMessage, /RESOURCE_EXHAUSTED/);
  });

  test('maps plain provider rate limits to a retry-later message', () => {
    const normalized = normalizeImageGenerationError(new Error('429 Too many requests'));

    assert.equal(normalized.category, 'rate_limited');
    assert.equal(normalized.userMessage, IMAGE_PROVIDER_RATE_LIMITED_MESSAGE);
  });

  test('keeps safety errors user-actionable', () => {
    const normalized = normalizeImageGenerationError(new Error('Prompt blocked for safety reasons'));

    assert.equal(normalized.category, 'safety');
    assert.equal(normalized.userMessage, 'Prompt blocked for safety reasons');
  });

  test('leaves generic errors unchanged', () => {
    const normalized = normalizeImageGenerationError(new Error('Source image not found: image-1'));

    assert.equal(normalized.category, 'generic');
    assert.equal(normalized.userMessage, 'Source image not found: image-1');
  });
});
