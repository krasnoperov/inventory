# Quickstart

Make Effects started from a simple workflow: use a CLI with a Gemini key, generate images and media quickly, then keep moving.

That loop works well until the project gets large. You make many variants. You lose which prompt led to which result. You want to compare directions, refine the promising ones, remember source references, and keep the best media moving.

Make Effects adds a project layer for that loop. Use the `makefx` CLI when you want an agent, script, or local workflow to generate media. Use [makefx.app](https://makefx.app) when you want to review, organize, choose, refine, and collaborate.

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

A space is the shared memory for a project: assets, variants, recipes, lineage, and collaborators.

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

Each command creates website-backed jobs, waits for completion, downloads the finished file, and records what happened so the result is not just another detached file.

## Inspect results

```sh
makefx assets
makefx assets show ASSET_ID --json
makefx assets download VARIANT_ID -o references/variant.png
makefx listen --space YOUR_SPACE_ID
```

The website remains the source of truth. The CLI reads and mutates the same space graph that the browser UI uses, so your agent and your collaborators are working on the same project state.

## Next steps

- [Core Concepts](/docs/concepts) explains the data model.
- [CLI Reference](/docs/cli) covers commands and agent automation.
- [Media Playbooks](/docs/media-playbooks) shows how to build from references and continue selected assets.
