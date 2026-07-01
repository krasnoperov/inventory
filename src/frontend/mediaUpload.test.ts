import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { defaultAssetNameFromFile, findAcceptedUploadFile } from './mediaUpload';

describe('media upload helpers', () => {
  test('finds the first supported media file', () => {
    const pdf = new File(['pdf'], 'brief.pdf', { type: 'application/pdf' });
    const image = new File(['png'], 'hero.png', { type: 'image/png' });

    assert.equal(findAcceptedUploadFile([pdf, image]), image);
  });

  test('returns null for unsupported files', () => {
    const archive = new File(['zip'], 'assets.zip', { type: 'application/zip' });

    assert.equal(findAcceptedUploadFile([archive]), null);
  });

  test('uses the filename stem as the default asset name', () => {
    const file = new File(['video'], 'intro.cut.mp4', { type: 'video/mp4' });

    assert.equal(defaultAssetNameFromFile(file), 'intro.cut');
  });
});
