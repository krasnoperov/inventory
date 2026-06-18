# Quickstart

Make Effects is a hosted media production workspace at [makefx.app](https://makefx.app). Use it from the browser when you want to review and organize assets visually, or from the `makefx` CLI when an agent, script, or local workflow needs to generate and track media.

## Install the CLI

```sh
npm install -g makefx
makefx --version
```

The CLI defaults to production at `https://makefx.app`.

Use `--env stage` for staging or `--local` for a local development server.

## Sign in

```sh
makefx login
```

The login flow opens the browser, authenticates with Google, and stores local CLI credentials outside your project directory.

## Create or bind a space

A space is the shared source of truth for assets, variants, recipes, lineage, and production records.

```sh
makefx spaces create "My Game Assets" --init
```

If you already have a space ID:

```sh
makefx init --space YOUR_SPACE_ID
```

This writes `.inventory/config.json` with the environment and space ID. It does not store prompts, media, auth tokens, or generation provider keys.

## Generate your first media

Generate an image:

```sh
makefx generate "A cozy pixel-art market background" \
  --name "Market Background" \
  --type scene \
  -o art/market.png
```

Generate sound:

```sh
makefx audio sfx generate "A crisp magical item pickup" \
  --name "Item Pickup" \
  -o audio/item-pickup.wav
```

Generate video:

```sh
makefx video generate "A looping idle animation for a tiny robot" \
  --name "Robot Idle" \
  --type animation \
  -o video/robot-idle.mp4
```

Each command creates website-backed jobs, waits for completion, downloads the finished file, and records a local debug run manifest.

## Inspect results

```sh
makefx assets
makefx assets show ASSET_ID --json
makefx assets download VARIANT_ID -o references/variant.png
makefx listen --space YOUR_SPACE_ID
```

The website remains the source of truth. The CLI reads and mutates the same space graph that the browser UI uses.

## Next steps

- [Core Concepts](/docs/concepts) explains the data model.
- [CLI Reference](/docs/cli) covers commands and agent automation.
- [Production Handoff](/docs/production-handoff) explains scene placement and export.

