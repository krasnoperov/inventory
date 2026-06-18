import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOC_REGISTRY } from './content-registry';

describe('public content registry', () => {
  it('has source markdown for every registered public doc', async () => {
    for (const entry of DOC_REGISTRY) {
      const markdown = await readFile(`src/shared/content/docs/${entry.slug}.md`, 'utf8');
      assert.ok(markdown.trim().startsWith('#'), `${entry.slug} should contain markdown`);
    }
  });
});
