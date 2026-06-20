# BYOK Rotation Runbook

This runbook covers the broker-only rotation tools for envelope-encrypted BYOK
provider keys:

- `rewrapAllDeks({ fromKekVersion, toKekVersion })`
- `rotateTenantDek({ tenant: { type: 'user', userId } })`

Do not add public routes, provider validation, provider proxying, generic
decrypt calls, or DEK-returning tooling for these operations. Run rotation
through a controlled Worker service binding to the key broker.

## Preconditions

1. Runtime provider-key reads and writes are broker-backed for the target
   environment.
2. The key broker Worker has explicit versioned Secrets Store bindings for both
   the old and new KEKs, for example `BYOK_KEK_V1` and `BYOK_KEK_V2`.
3. `BYOK_ACTIVE_KEK_VERSION` is set to the intended write version before tenant
   DEK rotation or new provider-key writes.
4. A recent D1 backup exists before production tenant DEK rotation. KEK rewrap
   can be reversed while both KEK bindings exist; tenant DEK rotation rewrites
   provider ciphertext and needs database restore for full rollback.

## Staging Rehearsal

1. Bind both staging KEKs on the key broker Worker:

   ```toml
   [[secrets_store_secrets]]
   binding = "BYOK_KEK_V1"
   store_id = "<stage-secret-store-id>"
   secret_name = "BYOK_KEK_V1"

   [[secrets_store_secrets]]
   binding = "BYOK_KEK_V2"
   store_id = "<stage-secret-store-id>"
   secret_name = "BYOK_KEK_V2"
   ```

2. Deploy the key broker with `BYOK_ACTIVE_KEK_VERSION = "2"` only after both
   bindings are present.
3. Run a dry-run KEK rewrap:

   ```ts
   await env.KEY_BROKER.rewrapAllDeks({ fromKekVersion: 1, toKekVersion: 2, dryRun: true });
   ```

4. Run the real staging KEK rewrap:

   ```ts
   await env.KEY_BROKER.rewrapAllDeks({ fromKekVersion: 1, toKekVersion: 2 });
   ```

5. Pick one staging user with BYOK keys and rotate only that tenant DEK:

   ```ts
   await env.KEY_BROKER.rotateTenantDek({
     tenant: { type: 'user', userId: 123 },
     reason: 'stage rehearsal',
   });
   ```

6. Generate one image or audio job using that user's BYOK provider key and
   confirm it resolves through the broker.

## Production Execution

1. Confirm the production key broker has both KEK bindings and the app and
   generation Workers call `KEY_BROKER`.
2. Create or verify the D1 backup.
3. Set `BYOK_ACTIVE_KEK_VERSION = "2"` on the key broker and deploy.
4. Run:

   ```ts
   await env.KEY_BROKER.rewrapAllDeks({ fromKekVersion: 1, toKekVersion: 2, dryRun: true });
   await env.KEY_BROKER.rewrapAllDeks({ fromKekVersion: 1, toKekVersion: 2 });
   ```

5. Rotate tenant DEKs in scoped batches:

   ```ts
   await env.KEY_BROKER.rotateTenantDek({
     tenant: { type: 'user', userId },
     reason: 'production rotation 2026-06',
   });
   ```

Both operations are retryable. Re-running KEK rewrap skips scopes already on
the target KEK. Tenant DEK rotation writes provider rows and the tenant envelope
through one D1 batch; retry after a failed batch resumes from the last committed
database state.

## Rollback

Keep `BYOK_KEK_V1` and `BYOK_KEK_V2` bound for the rollback window.

For KEK rewrap rollback, run the reverse rewrap while both bindings exist:

```ts
await env.KEY_BROKER.rewrapAllDeks({ fromKekVersion: 2, toKekVersion: 1 });
```

Then redeploy with `BYOK_ACTIVE_KEK_VERSION = "1"` if new writes should return
to V1. Do not remove `BYOK_KEK_V2` until verification shows no envelopes still
need it.

For tenant DEK rotation rollback, restore the pre-rotation D1 backup. The old
DEK is intentionally not retained in broker responses or a generic decrypt API.

## Verification Queries

Envelope distribution:

```sql
SELECT kek_version, dek_version, COUNT(*) AS scopes
FROM key_envelopes
GROUP BY kek_version, dek_version
ORDER BY kek_version, dek_version;
```

Provider rows still requiring legacy migration:

```sql
SELECT COUNT(*) AS legacy_provider_keys
FROM user_provider_keys
WHERE encrypted_api_key NOT LIKE 'enc:v2:%';
```

Ciphertext/envelope version inventory:

```sql
WITH first_parse AS (
  SELECT
    user_id,
    provider,
    substr(encrypted_api_key, 8) AS tail
  FROM user_provider_keys
  WHERE encrypted_api_key LIKE 'enc:v2:%'
),
second_parse AS (
  SELECT
    user_id,
    provider,
    CAST(substr(tail, 1, instr(tail, ':') - 1) AS INTEGER) AS ciphertext_kek_version,
    substr(tail, instr(tail, ':') + 1) AS tail
  FROM first_parse
),
parsed AS (
  SELECT
    user_id,
    provider,
    ciphertext_kek_version,
    CAST(substr(tail, 1, instr(tail, ':') - 1) AS INTEGER) AS ciphertext_dek_version
  FROM second_parse
)
SELECT
  p.ciphertext_kek_version,
  p.ciphertext_dek_version,
  e.kek_version AS envelope_kek_version,
  e.dek_version AS envelope_dek_version,
  COUNT(*) AS provider_keys
FROM parsed p
JOIN key_envelopes e ON e.scope_id = 'user:' || p.user_id
GROUP BY
  p.ciphertext_kek_version,
  p.ciphertext_dek_version,
  e.kek_version,
  e.dek_version
ORDER BY
  p.ciphertext_kek_version,
  p.ciphertext_dek_version,
  e.kek_version,
  e.dek_version;
```

After KEK rewrap, provider ciphertext KEK versions may remain on the old value
while `key_envelopes.kek_version` moves to the new value. That is expected:
rewrap changes only `wrapped_dek` and `kek_version`.
