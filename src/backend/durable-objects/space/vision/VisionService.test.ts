import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrayBufferToBase64,
  detectImageType,
  processDescribe,
  processCompare,
  hasApiKey,
  hasStorage,
  type VisionDependencies,
} from './VisionService';

describe('VisionService', () => {
  describe('arrayBufferToBase64', () => {
    test('converts ArrayBuffer to base64', () => {
      const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer; // "Hello"
      const base64 = arrayBufferToBase64(buffer);
      assert.strictEqual(base64, 'SGVsbG8=');
    });

    test('handles empty buffer', () => {
      const buffer = new Uint8Array([]).buffer;
      const base64 = arrayBufferToBase64(buffer);
      assert.strictEqual(base64, '');
    });

    test('handles binary data', () => {
      const buffer = new Uint8Array([0, 255, 128, 64]).buffer;
      const base64 = arrayBufferToBase64(buffer);
      // Verify it can be decoded back
      const decoded = atob(base64);
      assert.strictEqual(decoded.charCodeAt(0), 0);
      assert.strictEqual(decoded.charCodeAt(1), 255);
      assert.strictEqual(decoded.charCodeAt(2), 128);
      assert.strictEqual(decoded.charCodeAt(3), 64);
    });
  });

  describe('detectImageType', () => {
    test('detects PNG from magic bytes', () => {
      // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const base64 = arrayBufferToBase64(pngBytes.buffer);
      assert.strictEqual(detectImageType(base64), 'image/png');
    });

    test('detects JPEG from magic bytes', () => {
      // JPEG magic bytes: FF D8 FF
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const base64 = arrayBufferToBase64(jpegBytes.buffer);
      assert.strictEqual(detectImageType(base64), 'image/jpeg');
    });

    test('detects GIF from magic bytes', () => {
      // GIF magic bytes: 47 49 46 38 (GIF8)
      const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      const base64 = arrayBufferToBase64(gifBytes.buffer);
      assert.strictEqual(detectImageType(base64), 'image/gif');
    });

    test('detects WebP from magic bytes', () => {
      // WebP magic: RIFF....WEBP (52 49 46 46 ... 57 45 42 50)
      const webpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
      const base64 = arrayBufferToBase64(webpBytes.buffer);
      assert.strictEqual(detectImageType(base64), 'image/webp');
    });

    test('defaults to JPEG for unknown format', () => {
      const unknownBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      const base64 = arrayBufferToBase64(unknownBytes.buffer);
      assert.strictEqual(detectImageType(base64), 'image/jpeg');
    });

    test('defaults to JPEG for empty string', () => {
      assert.strictEqual(detectImageType(''), 'image/jpeg');
    });

    test('defaults to JPEG for invalid base64', () => {
      assert.strictEqual(detectImageType('not-valid-base64!!!'), 'image/jpeg');
    });
  });

  describe('hasApiKey', () => {
    test('returns true for valid string', () => {
      assert.strictEqual(hasApiKey('sk-123456'), true);
    });

    test('returns false for undefined', () => {
      assert.strictEqual(hasApiKey(undefined), false);
    });

    test('returns false for empty string', () => {
      assert.strictEqual(hasApiKey(''), false);
    });
  });

  describe('hasStorage', () => {
    test('returns true for object', () => {
      assert.strictEqual(hasStorage({}), true);
    });

    test('returns true for array', () => {
      assert.strictEqual(hasStorage([]), true);
    });

    test('returns false for undefined', () => {
      assert.strictEqual(hasStorage(undefined), false);
    });

    test('returns false for null', () => {
      assert.strictEqual(hasStorage(null), false);
    });
  });

  describe('processDescribe', () => {
    const createMockDeps = (overrides: Partial<VisionDependencies> = {}): VisionDependencies => ({
      getVariant: async () => ({ image_key: 'images/test.png' }),
      getVariantWithAsset: async () => ({ image_key: 'images/test.png', asset_name: 'Test Asset' }),
      getImage: async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer,
      describeImage: async () => ({
        description: 'A test image description',
        usage: { inputTokens: 100, outputTokens: 50 },
      }),
      compareImages: async () => ({
        comparison: 'A test comparison',
        usage: { inputTokens: 200, outputTokens: 100 },
      }),
      ...overrides,
    });

    test('successfully describes an image', async () => {
      const deps = createMockDeps();
      const result = await processDescribe(
        { variantId: 'v1', assetName: 'Test Asset', focus: 'general' },
        deps
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.description, 'A test image description');
        assert.strictEqual(result.usage?.inputTokens, 100);
        assert.strictEqual(result.usage?.outputTokens, 50);
      }
    });

    test('returns error when variant not found', async () => {
      const deps = createMockDeps({
        getVariant: async () => null,
      });

      const result = await processDescribe(
        { variantId: 'nonexistent', assetName: 'Test' },
        deps
      );

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.error, 'Variant not found or has no image');
      }
    });

    test('returns error when variant has no image_key', async () => {
      const deps = createMockDeps({
        getVariant: async () => ({ image_key: '' }),
      });

      const result = await processDescribe(
        { variantId: 'v1', assetName: 'Test' },
        deps
      );

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.error, 'Variant not found or has no image');
      }
    });

    test('returns error when image not found in storage', async () => {
      const deps = createMockDeps({
        getImage: async () => null,
      });

      const result = await processDescribe(
        { variantId: 'v1', assetName: 'Test' },
        deps
      );

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.error, 'Image not found in storage');
      }
    });

    test('passes question to describeImage', async () => {
      let capturedQuestion: string | undefined;
      const deps = createMockDeps({
        describeImage: async (_base64, _mediaType, _name, _focus, question) => {
          capturedQuestion = question;
          return { description: 'Answer', usage: { inputTokens: 10, outputTokens: 5 } };
        },
      });

      await processDescribe(
        { variantId: 'v1', assetName: 'Test', question: 'What color is the sky?' },
        deps
      );

      assert.strictEqual(capturedQuestion, 'What color is the sky?');
    });

    test('uses general focus when not specified', async () => {
      let capturedFocus: string | undefined;
      const deps = createMockDeps({
        describeImage: async (_base64, _mediaType, _name, focus) => {
          capturedFocus = focus;
          return { description: 'Desc', usage: { inputTokens: 10, outputTokens: 5 } };
        },
      });

      await processDescribe({ variantId: 'v1', assetName: 'Test' }, deps);

      assert.strictEqual(capturedFocus, 'general');
    });
  });

  describe('processCompare', () => {
    const createMockDeps = (overrides: Partial<VisionDependencies> = {}): VisionDependencies => ({
      getVariant: async () => ({ image_key: 'images/test.png' }),
      getVariantWithAsset: async (id) => ({
        image_key: `images/${id}.png`,
        asset_name: `Asset ${id}`,
      }),
      getImage: async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer,
      describeImage: async () => ({
        description: 'Test',
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
      compareImages: async () => ({
        comparison: 'These images are similar in style',
        usage: { inputTokens: 200, outputTokens: 100 },
      }),
      ...overrides,
    });

    test('successfully compares two images', async () => {
      const deps = createMockDeps();
      const result = await processCompare(
        { variantIds: ['v1', 'v2'], aspects: ['style'] },
        deps
      );

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.comparison, 'These images are similar in style');
        assert.strictEqual(result.usage?.inputTokens, 200);
        assert.strictEqual(result.usage?.outputTokens, 100);
      }
    });

    test('returns error for less than 2 variants', async () => {
      const deps = createMockDeps();

      const result = await processCompare({ variantIds: ['v1'] }, deps);

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.error, 'Must provide 2-4 variants to compare');
      }
    });

    test('returns error for more than 4 variants', async () => {
      const deps = createMockDeps();

      const result = await processCompare(
        { variantIds: ['v1', 'v2', 'v3', 'v4', 'v5'] },
        deps
      );

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.strictEqual(result.error, 'Must provide 2-4 variants to compare');
      }
    });

    test('returns error for empty variantIds', async () => {
      const deps = createMockDeps();

      const result = await processCompare({ variantIds: [] }, deps);

      assert.strictEqual(result.success, false);
    });

    test('returns error when variant not found', async () => {
      const deps = createMockDeps({
        getVariantWithAsset: async (id) => (id === 'v2' ? null : { image_key: 'k', asset_name: 'A' }),
      });

      const result = await processCompare({ variantIds: ['v1', 'v2'] }, deps);

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert(result.error.includes('v2'));
        assert(result.error.includes('not found'));
      }
    });

    test('returns error when image not found', async () => {
      let callCount = 0;
      const deps = createMockDeps({
        getImage: async () => {
          callCount++;
          return callCount === 2 ? null : new Uint8Array([0xff, 0xd8, 0xff]).buffer;
        },
      });

      const result = await processCompare({ variantIds: ['v1', 'v2'] }, deps);

      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert(result.error.includes('not found'));
      }
    });

    test('uses default aspects when not provided', async () => {
      let capturedAspects: string[] | undefined;
      const deps = createMockDeps({
        compareImages: async (_, aspects) => {
          capturedAspects = aspects;
          return { comparison: 'Test', usage: { inputTokens: 10, outputTokens: 5 } };
        },
      });

      await processCompare({ variantIds: ['v1', 'v2'] }, deps);

      assert.deepStrictEqual(capturedAspects, ['style', 'composition', 'colors']);
    });

    test('uses provided aspects', async () => {
      let capturedAspects: string[] | undefined;
      const deps = createMockDeps({
        compareImages: async (_, aspects) => {
          capturedAspects = aspects;
          return { comparison: 'Test', usage: { inputTokens: 10, outputTokens: 5 } };
        },
      });

      await processCompare({ variantIds: ['v1', 'v2'], aspects: ['mood', 'details'] }, deps);

      assert.deepStrictEqual(capturedAspects, ['mood', 'details']);
    });

    test('uses asset_name as label', async () => {
      let capturedImages: Array<{ label: string }> | undefined;
      const deps = createMockDeps({
        getVariantWithAsset: async (id) => ({
          image_key: `img/${id}`,
          asset_name: id === 'v1' ? 'Hero Character' : 'Villain',
        }),
        compareImages: async (images) => {
          capturedImages = images;
          return { comparison: 'Test', usage: { inputTokens: 10, outputTokens: 5 } };
        },
      });

      await processCompare({ variantIds: ['v1', 'v2'] }, deps);

      assert.strictEqual(capturedImages?.[0].label, 'Hero Character');
      assert.strictEqual(capturedImages?.[1].label, 'Villain');
    });

    test('falls back to variant ID prefix for label', async () => {
      let capturedImages: Array<{ label: string }> | undefined;
      const deps = createMockDeps({
        getVariantWithAsset: async (id) => ({
          image_key: `img/${id}`,
          asset_name: '', // Empty name
        }),
        compareImages: async (images) => {
          capturedImages = images;
          return { comparison: 'Test', usage: { inputTokens: 10, outputTokens: 5 } };
        },
      });

      await processCompare({ variantIds: ['variant123', 'variant456'] }, deps);

      // slice(0, 8) takes first 8 chars: 'variant1' and 'variant4'
      assert.strictEqual(capturedImages?.[0].label, 'Variant variant1');
      assert.strictEqual(capturedImages?.[1].label, 'Variant variant4');
    });
  });
});
