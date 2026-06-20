# BYOK Key Broker Worker

The BYOK key broker is a separate Worker for provider-key custody. Provider-key
save, replace, and delete routes call the broker service binding so the app
Worker does not persist key material directly. Generation Workers may still use
legacy read paths until their traffic is migrated.

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

## Deployment Review Notes

`wrangler.key-broker.toml` is isolated from the current app and generation
Worker configs. Before deployment, a human should confirm:

- The key broker Worker is deployed first.
- The only versioned KEK bindings are Secrets Store bindings on the broker
  Worker, for example `BYOK_KEK_V1`.
- App Workers receive only a service binding named `KEY_BROKER`; generation
  Workers should receive the same binding when their read path is migrated.
- The broker has no public route and `workers_dev = false`.

Cloudflare's Wrangler syntax for Secrets Store bindings is:

```toml
[[secrets_store_secrets]]
binding = "BYOK_KEK_V1"
store_id = "<secret-store-id>"
secret_name = "BYOK_KEK_V1"
```

Cloudflare's service binding syntax for a caller Worker is:

```toml
[[services]]
binding = "KEY_BROKER"
service = "makefx-key-broker-stage"
```

For local multi-Worker development, run Wrangler with both configs after the
caller binding is added in a later issue:

```bash
pnpm exec wrangler dev -c wrangler.dev.toml -c wrangler.key-broker.toml
```
