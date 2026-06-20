// @ts-nocheck - The InternalApi controller surface is intentionally broad; these tests mock one route.
import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createInternalApi } from './InternalApi';

function createApp(backfill = mock.fn(async (data: unknown) => ({
  mode: 'empty',
  scannedAssets: 0,
  parentClusters: 0,
  collectionsCreated: 0,
  collectionItemsCreated: 0,
  relationsCreated: 0,
  data,
}))) {
  const app = createInternalApi({
    asset: {},
    variant: {},
    lineage: {},
    sync: {},
    generation: {},
    approval: {},
    session: {},
    organization: {
      httpBackfillParentHierarchy: backfill,
    },
    production: {},
  });
  return { app, backfill };
}

describe('InternalApi parent hierarchy backfill route', () => {
  test('rejects malformed JSON before running the mutating backfill', async () => {
    const { app, backfill } = createApp();

    const response = await app.fetch(new Request('http://do/internal/backfill-parent-hierarchy', {
      method: 'POST',
      body: '{"createManualRelations":',
    }));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'backfill options must be valid JSON' });
    assert.equal(backfill.mock.callCount(), 0);
  });

  test('treats an empty body as default backfill options', async () => {
    const { app, backfill } = createApp();

    const response = await app.fetch(new Request('http://do/internal/backfill-parent-hierarchy', {
      method: 'POST',
    }));

    assert.equal(response.status, 200);
    assert.equal(backfill.mock.callCount(), 1);
    assert.deepEqual(backfill.mock.calls[0].arguments[0], {});
  });
});
