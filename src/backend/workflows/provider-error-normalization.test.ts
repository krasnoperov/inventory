import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMAGE_PROVIDER_QUOTA_EXHAUSTED_MESSAGE,
  IMAGE_PROVIDER_RATE_LIMITED_MESSAGE,
  VIDEO_PROVIDER_QUOTA_EXHAUSTED_MESSAGE,
  normalizeMediaGenerationError,
} from './provider-error-normalization';

describe('normalizeMediaGenerationError', () => {
  test('maps Gemini quota exhaustion JSON to a concise user message', () => {
    const error = new Error(
      'GeminiRateLimitError: {"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.\\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-2.5-flash-preview-image","status":"RESOURCE_EXHAUSTED"}}'
    );

    const normalized = normalizeMediaGenerationError(error, 'image');

    assert.equal(normalized.category, 'quota_exhausted');
    assert.equal(normalized.userMessage, IMAGE_PROVIDER_QUOTA_EXHAUSTED_MESSAGE);
    assert.match(normalized.providerMessage, /RESOURCE_EXHAUSTED/);
  });

  test('maps video quota exhaustion to a video-specific message', () => {
    const error = new Error(
      'GoogleVeoServiceError: {"error":{"code":429,"message":"Quota exceeded for video generation","status":"RESOURCE_EXHAUSTED"}}'
    );

    const normalized = normalizeMediaGenerationError(error, 'video');

    assert.equal(normalized.category, 'quota_exhausted');
    assert.equal(normalized.userMessage, VIDEO_PROVIDER_QUOTA_EXHAUSTED_MESSAGE);
  });

  test('maps plain provider rate limits to a retry-later message', () => {
    const normalized = normalizeMediaGenerationError(new Error('429 Too many requests'), 'image');

    assert.equal(normalized.category, 'rate_limited');
    assert.equal(normalized.userMessage, IMAGE_PROVIDER_RATE_LIMITED_MESSAGE);
  });

  test('keeps safety errors user-actionable', () => {
    const normalized = normalizeMediaGenerationError(new Error('Prompt blocked for safety reasons'), 'image');

    assert.equal(normalized.category, 'safety');
    assert.equal(normalized.userMessage, 'Prompt blocked for safety reasons');
  });

  test('leaves generic errors unchanged', () => {
    const normalized = normalizeMediaGenerationError(new Error('Source image not found: image-1'), 'image');

    assert.equal(normalized.category, 'generic');
    assert.equal(normalized.userMessage, 'Source image not found: image-1');
  });
});
