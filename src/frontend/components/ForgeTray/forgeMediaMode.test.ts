import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  FORGE_MEDIA_MODE_CONFIGS,
  getAssetTypeForForgeMode,
  getForgeMediaModeConfig,
  getForgeModeForAudioAssetType,
  getMediaKindForForgeMode,
  isAudioForgeMode,
} from './forgeMediaMode';

describe('forge media mode helpers', () => {
  test('maps speech, dialogue, music, and sfx modes to audio requests', () => {
    const audioModes = FORGE_MEDIA_MODE_CONFIGS.filter((config) => config.mode !== 'image');

    assert.deepEqual(
      audioModes.map((config) => config.mode),
      ['speech', 'dialogue', 'music', 'sfx']
    );
    assert.ok(audioModes.every((config) => config.mediaKind === 'audio'));
    assert.ok(audioModes.every((config) => isAudioForgeMode(config.mode)));
  });

  test('keeps image mode as the default image asset path', () => {
    assert.equal(getMediaKindForForgeMode('image'), 'image');
    assert.equal(isAudioForgeMode('image'), false);
    assert.equal(getAssetTypeForForgeMode('image'), 'character');
    assert.equal(getAssetTypeForForgeMode('image', 'scene'), 'scene');
  });

  test('uses audio operation asset types for audio modes', () => {
    assert.equal(getAssetTypeForForgeMode('speech', 'character'), 'speech');
    assert.equal(getAssetTypeForForgeMode('dialogue', 'character'), 'dialogue');
    assert.equal(getAssetTypeForForgeMode('music', 'character'), 'music');
    assert.equal(getAssetTypeForForgeMode('sfx', 'character'), 'sfx');
  });

  test('infers a concrete audio mode from existing audio asset types', () => {
    assert.equal(getForgeModeForAudioAssetType('dialogue'), 'dialogue');
    assert.equal(getForgeModeForAudioAssetType('music'), 'music');
    assert.equal(getForgeModeForAudioAssetType('ambience'), 'speech');
    assert.equal(getForgeMediaModeConfig('sfx').promptNoun, 'sound effect');
  });
});

