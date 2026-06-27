import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SpaceAccessRequiredError } from '../../queries';
import { isSpaceAccessRequiredError } from './-spaceRouteErrors';

describe('/spaces/$id error boundary classification', () => {
  test('only routes explicit Space access failures to the request-access page', () => {
    const accessError = new SpaceAccessRequiredError('space-1', {
      status: 'none',
      member: null,
      pendingRequest: null,
      pendingInvitation: null,
    });

    assert.equal(isSpaceAccessRequiredError(accessError), true);
    assert.equal(isSpaceAccessRequiredError(new Error('Asset not found')), false);
    assert.equal(isSpaceAccessRequiredError(new Error('Failed to fetch asset')), false);
  });
});
