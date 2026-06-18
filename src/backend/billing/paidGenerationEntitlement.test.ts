import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAdminUserId,
  isPaidGenerationAccessExpired,
  resolveEntitlement,
  normalizePaidGenerationEntitlement,
} from './paidGenerationEntitlement';

describe('isAdminUserId', () => {
  test('matches a user id in the comma-separated list (with whitespace)', () => {
    assert.equal(isAdminUserId(42, '7, 42, 99'), true);
    assert.equal(isAdminUserId('42', '7,42,99'), true);
  });

  test('returns false when not listed or list is empty/undefined', () => {
    assert.equal(isAdminUserId(42, '7,99'), false);
    assert.equal(isAdminUserId(42, ''), false);
    assert.equal(isAdminUserId(42, undefined), false);
  });

  test('does not match on substring (42 is not in 420)', () => {
    assert.equal(isAdminUserId(42, '420,4200'), false);
  });
});

describe('resolveEntitlement', () => {
  test('admins resolve to internal regardless of stored value', () => {
    assert.equal(resolveEntitlement('none', 1, '1'), 'internal');
    assert.equal(resolveEntitlement(null, 1, '1'), 'internal');
    assert.equal(resolveEntitlement('paid', 1, '1'), 'internal');
  });

  test('non-admins fall back to the normalized stored value', () => {
    assert.equal(resolveEntitlement('paid', 2, '1'), 'paid');
    assert.equal(resolveEntitlement('none', 2, '1'), 'none');
    assert.equal(resolveEntitlement('garbage', 2, '1'), 'none');
    assert.equal(resolveEntitlement('internal', 2, undefined), 'internal');
  });

  test('matches normalize behavior when there are no admins', () => {
    for (const value of ['none', 'paid', 'internal', 'bogus', null, undefined]) {
      assert.equal(resolveEntitlement(value, 5, ''), normalizePaidGenerationEntitlement(value));
    }
  });
});

describe('isPaidGenerationAccessExpired', () => {
  const now = new Date('2026-06-18T12:00:00.000Z');

  test('expires explicit paid cancellation grace at the cached timestamp', () => {
    assert.equal(isPaidGenerationAccessExpired('paid', '2026-06-18T11:59:59.000Z', now), true);
    assert.equal(isPaidGenerationAccessExpired('paid', '2026-06-18T12:00:00.000Z', now), true);
  });

  test('keeps paid access when no explicit grace expiry is cached', () => {
    assert.equal(isPaidGenerationAccessExpired('paid', null, now), false);
  });

  test('does not expire internal entitlement', () => {
    assert.equal(isPaidGenerationAccessExpired('internal', '2026-06-18T11:59:59.000Z', now), false);
  });
});
