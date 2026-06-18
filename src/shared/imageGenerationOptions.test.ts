import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_IMAGE_MODEL_ID,
  getImageModelCapabilities,
  getImageModelMaxReferenceImages,
  isImageSizeSupportedByModel,
  resolveImageModelSelection,
} from './imageGenerationOptions';

describe('imageGenerationOptions', () => {
  test('defaults to Pro image generation model capabilities', () => {
    assert.strictEqual(resolveImageModelSelection(), DEFAULT_IMAGE_MODEL_ID);

    const capabilities = getImageModelCapabilities();
    assert.strictEqual(capabilities.selection, 'pro');
    assert.strictEqual(capabilities.modelId, 'gemini-3-pro-image-preview');
    assert.strictEqual(capabilities.maxReferenceImages, 14);
    assert.deepStrictEqual(capabilities.supportedImageSizes, ['1K', '2K', '4K']);
  });

  test('exposes exact Flash image generation limits', () => {
    const capabilities = getImageModelCapabilities('gemini-2.5-flash-image');

    assert.strictEqual(capabilities.selection, 'flash');
    assert.strictEqual(capabilities.modelId, 'gemini-2.5-flash-image');
    assert.strictEqual(capabilities.maxReferenceImages, 1);
    assert.deepStrictEqual(capabilities.supportedImageSizes, ['1K']);
    assert.strictEqual(isImageSizeSupportedByModel('flash', '1K'), true);
    assert.strictEqual(isImageSizeSupportedByModel('flash', '2K'), false);
    assert.strictEqual(getImageModelMaxReferenceImages('flash'), 1);
  });
});
