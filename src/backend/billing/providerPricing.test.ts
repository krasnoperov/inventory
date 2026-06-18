import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ELEVENLABS_RATES_USD,
  GEMINI_IMAGE_RATES_USD,
  GEMINI_VIDEO_RATES_USD,
  priceProviderUsageEvent,
} from './providerPricing';

describe('provider pricing', () => {
  test('prices Claude input and output token events by normalized model family', () => {
    const input = priceProviderUsageEvent({
      eventName: 'claude_input_tokens',
      quantity: 1_000_000,
      metadata: { model: 'claude-opus-4-5-20251101' },
    });
    const output = priceProviderUsageEvent({
      eventName: 'claude_output_tokens',
      quantity: 500_000,
      metadata: { model: 'claude-sonnet-4-20250514' },
    });

    assert.equal(input.amountUsd, 5);
    assert.equal(input.model, 'claude-opus-4.5');
    assert.equal(output.amountUsd, 7.5);
    assert.equal(output.model, 'claude-sonnet-4');
  });

  test('prices Gemini image preview aliases with current Gemini 3 Pro Image rates', () => {
    const result = priceProviderUsageEvent({
      eventName: 'gemini_images',
      quantity: 2,
      metadata: { model: 'gemini-3-pro-image-preview', imageSize: '4K' },
    });

    assert.equal(result.amountUsd, 0.48);
    assert.equal(result.model, 'gemini-3-pro-image');
    assert.equal(result.unit, 'image');
  });

  test('prices size-missing Gemini Pro image events with the conservative highest image tier', () => {
    const result = priceProviderUsageEvent({
      eventName: 'gemini_images',
      quantity: 1,
      metadata: { model: 'gemini-3-pro-image-preview' },
    });

    assert.equal(result.amountUsd, 0.24);
    assert.equal(result.model, 'gemini-3-pro-image');
    assert.equal(result.unit, 'image');
  });

  test('prices Gemini image token events separately from image count events', () => {
    const input = priceProviderUsageEvent({
      eventName: 'gemini_input_tokens',
      quantity: 1_000_000,
      metadata: JSON.stringify({ model: 'gemini-2.5-flash-image' }),
    });
    const output = priceProviderUsageEvent({
      eventName: 'gemini_output_tokens',
      quantity: 100_000,
      metadata: { model: 'gemini-2.5-flash-image' },
    });
    const image = priceProviderUsageEvent({
      eventName: 'gemini_images',
      quantity: 1,
      metadata: { model: 'gemini-2.5-flash-image' },
    });

    assert.equal(input.amountUsd, 0.3);
    assert.equal(output.amountUsd, 0.25);
    assert.equal(image.amountUsd, 0.039);
  });

  test('prices Gemini video count events as generated seconds', () => {
    const fast1080 = priceProviderUsageEvent({
      eventName: 'gemini_videos',
      quantity: 2,
      metadata: {
        model: 'veo-3.1-fast-generate-preview',
        resolution: '1080p',
        durationSeconds: 8,
      },
    });
    const defaultedStandard = priceProviderUsageEvent({
      eventName: 'gemini_videos',
      quantity: 1,
      metadata: { model: 'veo-3.1-generate-preview' },
    });

    assert.equal(fast1080.amountUsd, 1.92);
    assert.equal(fast1080.quantity, 16);
    assert.equal(defaultedStandard.amountUsd, 3.2);
  });

  test('prices ElevenLabs text-to-speech audio events by character', () => {
    const multilingual = priceProviderUsageEvent({
      eventName: 'elevenlabs_audio',
      quantity: 500,
      metadata: { model: 'eleven_multilingual_v2', total_tokens: 1_000 },
    });
    const flash = priceProviderUsageEvent({
      eventName: 'elevenlabs_audio',
      quantity: 1_000,
      metadata: { model: 'eleven_flash_v2_5' },
    });

    assert.equal(multilingual.amountUsd, 0.1);
    assert.equal(multilingual.quantity, 1_000);
    assert.equal(flash.amountUsd, 0.05);
  });

  test('prices ElevenLabs music and sound effects using their native units', () => {
    const music = priceProviderUsageEvent({
      eventName: 'elevenlabs_audio',
      quantity: 42,
      metadata: { model: 'music_v1', duration_ms: 120_000 },
    });
    const sfx = priceProviderUsageEvent({
      eventName: 'elevenlabs_audio',
      quantity: 100,
      metadata: { model: 'eleven_text_to_sound_v2' },
    });

    assert.equal(music.amountUsd, 0.3);
    assert.equal(music.quantity, 2);
    assert.equal(music.unit, 'minute');
    assert.equal(sfx.amountUsd, 0.12);
    assert.equal(sfx.quantity, 1);
    assert.equal(sfx.unit, 'generation');
  });

  test('prices persisted ElevenLabs music events by provider usage when duration is unavailable', () => {
    const music = priceProviderUsageEvent({
      eventName: 'elevenlabs_audio',
      quantity: 41,
      metadata: { model: 'music_v1', total_tokens: 41 },
    });

    assert.ok(Math.abs(music.amountUsd - 0.00615) < 0.000001);
    assert.equal(music.quantity, 41);
    assert.equal(music.unit, 'character');
  });

  test('does not guess ElevenLabs minute pricing without duration or provider usage metadata', () => {
    const music = priceProviderUsageEvent({
      eventName: 'elevenlabs_audio',
      quantity: 0,
      metadata: { model: 'music_v1' },
    });

    assert.ok('reason' in music);
    assert.equal(music.reason, 'unsupported_rate');
    assert.equal(music.amountUsd, 0);
  });

  test('exposes rate tables for the currently tracked providers', () => {
    assert.ok(GEMINI_IMAGE_RATES_USD['gemini-3-pro-image']);
    assert.ok(GEMINI_IMAGE_RATES_USD['gemini-2.5-flash-image']);
    assert.ok(GEMINI_VIDEO_RATES_USD['veo-3.1-generate-preview']);
    assert.ok(GEMINI_VIDEO_RATES_USD['veo-3.1-fast-generate-preview']);
    assert.ok(GEMINI_VIDEO_RATES_USD['veo-3.1-lite-generate-preview']);
    assert.ok(ELEVENLABS_RATES_USD.eleven_multilingual_v2);
    assert.ok(ELEVENLABS_RATES_USD.eleven_v3);
    assert.ok(ELEVENLABS_RATES_USD.music_v1);
    assert.ok(ELEVENLABS_RATES_USD.eleven_text_to_sound_v2);
  });

  test('returns a pricing miss for unsupported events or malformed metadata', () => {
    const unsupported = priceProviderUsageEvent({
      eventName: 'gemini_audio',
      quantity: 1,
      metadata: { model: 'lyria-3-clip-preview' },
    });
    const malformed = priceProviderUsageEvent({
      eventName: 'gemini_images',
      quantity: 1,
      metadata: '{not-json',
    });

    assert.ok('reason' in unsupported);
    assert.equal(unsupported.reason, 'unsupported_event');
    assert.equal(unsupported.amountUsd, 0);
    assert.ok('reason' in malformed);
    assert.equal(malformed.reason, 'invalid_metadata');
    assert.equal(malformed.amountUsd, 0);
  });
});
