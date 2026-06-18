import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs } from './utils';

test('parseArgs keeps prompt positional after video --audio flag', () => {
  const parsed = parseArgs([
    'generate',
    '--audio',
    'A market shot with ambience',
    '--name',
    'Market Shot',
    '--type',
    'animation',
    '-o',
    'market.mp4',
  ]);

  assert.deepEqual(parsed, {
    options: {
      audio: 'true',
      name: 'Market Shot',
      type: 'animation',
      o: 'market.mp4',
    },
    positionals: ['generate', 'A market shot with ambience'],
  });
});

test('parseArgs keeps short output option after video --no-audio flag', () => {
  const parsed = parseArgs([
    'generate',
    '--no-audio',
    '-o',
    'silent.mp4',
    'A silent background plate',
    '--name',
    'Background Plate',
    '--type',
    'animation',
  ]);

  assert.deepEqual(parsed, {
    options: {
      'no-audio': 'true',
      o: 'silent.mp4',
      name: 'Background Plate',
      type: 'animation',
    },
    positionals: ['generate', 'A silent background plate'],
  });
});

test('parseArgs keeps refine and derive prompts positional after video audio flags', () => {
  assert.deepEqual(parseArgs([
    'refine',
    '--variant',
    'variant-video',
    '--audio',
    'Add city ambience',
    '-o',
    'city.mp4',
  ]), {
    options: {
      variant: 'variant-video',
      audio: 'true',
      o: 'city.mp4',
    },
    positionals: ['refine', 'Add city ambience'],
  });

  assert.deepEqual(parseArgs([
    'derive',
    '--refs',
    'variant-a,variant-b',
    '--no-audio',
    'Loop the idle pose',
    '-o',
    'idle.mp4',
  ]), {
    options: {
      refs: 'variant-a,variant-b',
      'no-audio': 'true',
      o: 'idle.mp4',
    },
    positionals: ['derive', 'Loop the idle pose'],
  });
});
