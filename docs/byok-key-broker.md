# BYOK Key Broker Worker

The BYOK key broker is a separate Worker for provider-key custody. Provider-key
save, replace, and delete routes call the broker service binding so the app
Worker does not persist key material directly in stage and production.
Generation runtime provider-key reads also resolve through the broker when a
customer BYOK key is used. Local development uses the same broker service
implementation in-process, backed by the local D1 binding, so `pnpm dev` cannot
write provider keys to stage storage.

## Contract

The broker RPC surface is limited to:

- `storeProviderKey`
- `deleteProviderKey`
- `resolveProviderKey`
- `rotateTenantDek`
- `rewrapAllDeks`

It deliberately does not expose generic `decrypt`, arbitrary `encrypt`, or
`unwrapDek` methods. It also does not call provider APIs, validate provider keys,
proxy provider requests, or return DEK material.

DEK/KEK rotation operations and operator verification steps are documented in
[`byok-rotation-runbook.md`](./byok-rotation-runbook.md).

## Deployment

`wrangler.key-broker.toml` is the deploy config for the separate key broker
Worker. The normal GitHub Actions deploy workflow does not deploy this Worker
and does not need broker credentials.

Before deployment, confirm:

- The key broker Worker is deployed first.
- The only versioned KEK bindings are Secrets Store bindings on the broker
  Worker, for example `BYOK_KEK_V1`.
- App and generation Workers receive only a service binding named `KEY_BROKER`
  for BYOK key custody.
- The broker has no public route and `workers_dev = false`.

Secrets Store IDs are committed in `wrangler.key-broker.toml`, like D1 and KV
binding IDs. Secret values are stored only in Cloudflare Secrets Store. The
default config binds only the active KEK, `BYOK_KEK_V1`; add another KEK version
only while staging or running a rotation.

Deploy stage manually with a broker-scoped Cloudflare token:

```bash
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_KEY_BROKER_API_TOKEN" \
  pnpm exec wrangler deploy --config wrangler.key-broker.toml --env=""
```

Deploy production manually with the same broker-scoped token:

```bash
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_KEY_BROKER_API_TOKEN" \
  pnpm exec wrangler deploy --config wrangler.key-broker.toml --env production
```

Cloudflare's Wrangler syntax for the active Secrets Store binding is:

```toml
[[secrets_store_secrets]]
binding = "BYOK_KEK_V1"
store_id = "<secret-store-id>"
secret_name = "BYOK_KEK_V1"
```

For a rotation window, add the next binding directly to
`wrangler.key-broker.toml`, deploy the broker, complete the rotation, and remove
the old binding after verification.

Cloudflare's service binding syntax for a caller Worker is:

```toml
[[services]]
binding = "KEY_BROKER"
service = "makefx-key-broker-stage"
```

For local multi-Worker development against a separate broker Worker, use a
local broker config whose D1 binding points at `makefx-local`. Do not pair
`wrangler.dev.toml` with the checked-in stage broker config for local provider
key writes.
