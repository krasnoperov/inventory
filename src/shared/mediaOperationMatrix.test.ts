import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  CLI_GENERATION_PROFILES,
  MEDIA_OPERATION_MATRIX,
  canUseSlotMediaKindForForgeMode,
  getAssetTypeForForgeMode,
  getCliGenerationMediaKind,
  getForgeOperationForState,
  getMediaKindForForgeMode,
} from './mediaOperationMatrix';

describe('media operation matrix', () => {
  test('keeps Forge Tray media modes unique and ordered for the UI', () => {
    assert.deepEqual(
      MEDIA_OPERATION_MATRIX.map((entry) => entry.mode),
      ['image', 'video', 'speech', 'dialogue', 'music', 'sfx']
    );
    assert.equal(new Set(MEDIA_OPERATION_MATRIX.map((entry) => entry.mode)).size, MEDIA_OPERATION_MATRIX.length);
  });

  test('maps Forge Tray modes to output media kinds and reference compatibility', () => {
    assert.equal(getMediaKindForForgeMode('image'), 'image');
    assert.equal(getMediaKindForForgeMode('video'), 'video');
    assert.equal(getMediaKindForForgeMode('music'), 'audio');

    assert.equal(canUseSlotMediaKindForForgeMode('video', 'image'), true);
    assert.equal(canUseSlotMediaKindForForgeMode('video', 'video'), true);
    assert.equal(canUseSlotMediaKindForForgeMode('video', 'audio'), false);
    assert.equal(canUseSlotMediaKindForForgeMode('speech', 'audio'), true);
    assert.equal(canUseSlotMediaKindForForgeMode('speech', 'image'), false);
  });

  test('centralizes default asset type inheritance rules', () => {
    assert.equal(getAssetTypeForForgeMode('image', 'scene'), 'scene');
    assert.equal(getAssetTypeForForgeMode('video', 'character'), 'character');
    assert.equal(getAssetTypeForForgeMode('speech', 'character'), 'speech');
    assert.equal(getAssetTypeForForgeMode('sfx'), 'sfx');
  });

  test('centralizes Forge Tray operation selection', () => {
    assert.equal(getForgeOperationForState(0, true, 'new_asset'), 'generate');
    assert.equal(getForgeOperationForState(0, true, 'existing_asset'), 'refine');
    assert.equal(getForgeOperationForState(1, false, 'new_asset'), 'fork');
    assert.equal(getForgeOperationForState(2, false, 'new_asset'), 'derive');
    assert.equal(getForgeOperationForState(2, true, 'new_asset'), 'derive');
    assert.equal(getForgeOperationForState(2, true, 'existing_asset'), 'refine');
  });

  test('documents supported CLI generation namespaces', () => {
    const videoMode = MEDIA_OPERATION_MATRIX.find((entry) => entry.mode === 'video');
    const audioModes = MEDIA_OPERATION_MATRIX.filter((entry) => entry.mediaKind === 'audio');

    assert.equal(videoMode?.cliNamespace, 'video');
    assert.equal(videoMode?.cliCommands.join(','), 'generate,refine,derive');
    assert.equal(videoMode?.cliSupportsRefs, true);
    assert.equal(videoMode?.cliSavesBatchManifest, false);

    assert.ok(audioModes.every((entry) => entry.cliNamespace === 'audio'));
    assert.ok(audioModes.every((entry) => entry.cliCommands.join(',') === 'generate,batch'));
    assert.ok(audioModes.every((entry) => !entry.cliSupportsRefs));
    assert.ok(audioModes.every((entry) => !entry.cliSavesBatchManifest));

    assert.deepEqual(CLI_GENERATION_PROFILES, [
      {
        namespace: 'top-level',
        mediaKind: 'image',
        commands: ['generate', 'refine', 'derive', 'batch'],
        supportsRefs: true,
        savesBatchManifest: true,
      },
      {
        namespace: 'audio',
        mediaKind: 'audio',
        commands: ['generate', 'batch'],
        supportsRefs: false,
        savesBatchManifest: false,
      },
      {
        namespace: 'video',
        mediaKind: 'video',
        commands: ['generate', 'refine', 'derive'],
        supportsRefs: true,
        savesBatchManifest: false,
      },
    ]);
    assert.equal(getCliGenerationMediaKind('top-level'), 'image');
    assert.equal(getCliGenerationMediaKind('audio'), 'audio');
    assert.equal(getCliGenerationMediaKind('video'), 'video');
  });
});
