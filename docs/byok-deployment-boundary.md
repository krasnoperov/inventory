# BYOK Deployment Boundary Proof

This guide proves that the BYOK provider-key custody boundary in code matches
the Cloudflare deployment boundary.

## Static Boundary

Run:

```bash
pnpm run byok:prove-boundary
```

The proof command verifies:

- App, generation, billing, and local Wrangler configs have no active
  `BYOK_ACTIVE_KEK_VERSION` or `BYOK_KEK_*` binding.
- App and generation Wrangler configs bind only `KEY_BROKER` to the broker
  Worker.
- `wrangler.key-broker.toml` is route-less, has `workers_dev = false`, and
  contains the broker-only Secrets Store binding templates for `BYOK_KEK_V1`
  and `BYOK_KEK_V2`.
- The normal deploy workflow does not deploy `wrangler.key-broker.toml` and
  does not receive broker-only credentials.
- The broker deploy workflow uses `CLOUDFLARE_KEY_BROKER_API_TOKEN` and the
  protected-environment `BYOK_SECRET_STORE_ID`, runs only from `main`, and
  checks out reviewed `main` code.

`pnpm run lint` also runs this proof so regular CI rejects a PR that gives an
app, generation, billing, or local Worker a BYOK KEK binding.

## Deploy Paths

Normal app/generation deploys stay in `.github/workflows/deploy.yml` and use
`CLOUDFLARE_API_TOKEN`. That workflow deploys:

- `wrangler.toml`
- `wrangler.generation.toml`
- `wrangler.polar.toml`

Broker deploys use `.github/workflows/deploy-key-broker.yml`, which is manual
only, runs from reviewed `main` code, and must be attached to protected GitHub
environments:

- `key-broker-stage`
- `key-broker-production`

Each broker environment must define:

- `CLOUDFLARE_KEY_BROKER_API_TOKEN`
- `BYOK_SECRET_STORE_ID`

The workflow materializes a temporary broker config from
`wrangler.key-broker.toml` so the account Secrets Store ID is not committed.

Equivalent local operator command:

```bash
BYOK_SECRET_STORE_ID="..." \
  node scripts/prove-byok-deployment-boundary.mjs \
    --materialize-broker-config stage \
    --out .tmp/wrangler.key-broker.stage.toml

CLOUDFLARE_API_TOKEN="$CLOUDFLARE_KEY_BROKER_API_TOKEN" \
  pnpm exec wrangler deploy --config .tmp/wrangler.key-broker.stage.toml --env=""
```

For production, materialize `production` and deploy with `--env production`.

## Cloudflare Token RBAC Evidence

Record these checks before marking an environment complete.

1. Broker token can deploy only the broker:

   ```bash
   CLOUDFLARE_API_TOKEN="$CLOUDFLARE_KEY_BROKER_API_TOKEN" \
     pnpm exec wrangler deploy --config .tmp/wrangler.key-broker.stage.toml --env=""
   ```

2. Normal deploy token cannot deploy the broker:

   ```bash
   CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
     pnpm exec wrangler deploy --config .tmp/wrangler.key-broker.stage.toml --env=""
   ```

   Expected result: Cloudflare rejects the deploy because the token is not
   scoped to `makefx-key-broker-stage`.

3. Normal deploy token cannot add BYOK KEK bindings to app or generation
   Workers. Use a scratch copy of the app config with a `BYOK_KEK_V1`
   Secrets Store binding and deploy it with the normal token.

   Expected result: Cloudflare rejects the deploy because the token cannot bind
   the BYOK Secrets Store secret. Do not commit the scratch config.

4. Broker token is the only token with both permissions:

   - deploy permission for `makefx-key-broker-stage` or
     `makefx-key-broker-production`
   - Secrets Store read/bind permission for `BYOK_KEK_V1` and `BYOK_KEK_V2`

Normal app/generation credentials may have platform provider secrets such as
managed provider API keys. Those are separate from BYOK KEKs and must not use
`BYOK_KEK_*` binding names.

## Staging Proof

After broker deployment, verify the staging runtime path:

1. Key write:

   - Save or replace a staging BYOK provider key through the Profile provider
     key route.
   - Confirm the API response returns only provider metadata and `keyHint`.
   - Confirm D1 stores an `enc:v2:*` value in `user_provider_keys`, not the
     plaintext key.

2. BYOK generation:

   - Generate one image or audio job as the same user.
   - Confirm the job succeeds while resolving the provider key through
     `KEY_BROKER`.

3. Platform fallback:

   - Run the same generation flow with a user that has no BYOK key.
   - Confirm managed platform credentials are used only for an entitled
     platform generation path.

4. Rotation rehearsal:

   - Follow the staging steps in
     [`byok-rotation-runbook.md`](./byok-rotation-runbook.md).
   - Run dry-run KEK rewrap, real KEK rewrap, one scoped tenant DEK rotation,
     and one post-rotation BYOK generation.

Focused commands for this proof:

```bash
pnpm run byok:prove-boundary
pnpm run typecheck
pnpm run lint
pnpm test src/backend/key-broker/keyBrokerWorker.test.ts \
  src/backend/routes/userProviderKeys.test.ts \
  src/backend/services/generationProviderKeys.test.ts \
  src/backend/routes/voices.test.ts
pnpm test
```

## Observability Check

Tail the broker, app, and generation Workers during the staging key write,
BYOK generation, platform fallback, and rotation rehearsal:

```bash
pnpm exec wrangler tail makefx-key-broker-stage --format json > .tmp/byok-broker-tail.ndjson
pnpm exec wrangler tail makefx-stage --format json > .tmp/byok-app-tail.ndjson
pnpm exec wrangler tail makefx-generation-stage --format json > .tmp/byok-generation-tail.ndjson
```

Check the captured tails for:

- plaintext provider key
- `enc:v1:` or `enc:v2:` ciphertext
- `wrapped_dek`
- `key_hint` or `keyHint`

Example check:

```bash
node -e '
  const fs = require("node:fs");
  const needles = ["PLAINTEXT_KEY_SAMPLE", "enc:v1:", "enc:v2:", "wrapped_dek", "key_hint", "keyHint"];
  for (const file of process.argv.slice(1)) {
    const text = fs.readFileSync(file, "utf8");
    for (const needle of needles) {
      if (text.includes(needle)) {
        console.error(`${file}: found ${needle}`);
        process.exitCode = 1;
      }
    }
  }
' .tmp/byok-*-tail.ndjson
```

The expected result is no matches. Worker logs may include operation status,
user IDs, provider names, job IDs, and error classes, but must not include
plaintext keys, encrypted provider-key blobs, wrapped DEKs, or key hints.
