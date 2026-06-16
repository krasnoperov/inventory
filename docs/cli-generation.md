# CLI Forge Control

The CLI can drive an existing Inventory space as a ForgeTray controller.
The website remains the source of truth: assets, variants, recipes, lineage, and
stored images live in the Space Durable Object and R2. The CLI sends requests,
waits for completion, and downloads local copies of completed images.
`generate`, `refine`, `derive`, and `batch` are image-only commands and send
`mediaKind: "image"` with generation requests.

## Project Binding

Bind a local directory to a website space:

```bash
pnpm run cli init --space SPACE_ID --env stage
```

This writes `.inventory/config.json` with the target environment and space ID.
It does not store assets, prompts, images, generation keys, or auth tokens.
Inside an initialized project, Forge commands can omit `--space` and `--env`.
Explicit command flags override the project config.

## Website Asset Inventory

Use `assets` to inspect the website state that generation commands create:

```bash
pnpm run cli assets
pnpm run cli assets --json
pnpm run cli assets show ASSET_ID --json
```

This is the CLI read side of the ForgeTray control loop. External agents can
list assets, select variant IDs for `--refs`, inspect lineage, and download a
completed variant without direct database access:

```bash
pnpm run cli assets download VARIANT_ID -o references/variant.png
```

The command reads from the website API on demand. It does not scan the local
workspace and does not mirror website state into a local DB.

## Commands

Generate a new asset from text:

```bash
pnpm run cli generate "A watercolor background of Russafa market" \
  --name "Russafa Market Background" \
  --type scene \
  -o backgrounds/russafa-market.png
```

Refine an existing variant:

```bash
pnpm run cli refine \
  --variant VARIANT_ID \
  "make it evening, warmer lights" \
  -o backgrounds/russafa-market-evening.png
```

Derive a new asset from references:

```bash
pnpm run cli derive \
  --refs CHARACTER_VARIANT_ID,BACKGROUND_VARIANT_ID \
  --name "Lucia in Market Scene" \
  --type scene \
  "Place Lucia naturally in the market, cinematic keyframe" \
  -o keyframes/lucia-market-001.png
```

Batch generate multiple images and write a run manifest:

```bash
pnpm run cli batch "Three cinematic keyframes in Russafa market" \
  --name "Russafa Market Keyframe" \
  --type scene \
  --count 3 \
  --output-dir keyframes/russafa-market
```

## Local References

`derive --refs` and `batch --refs` accept both existing variant IDs and local
image paths:

```bash
pnpm run cli derive \
  --refs ./lucia.png,VARIANT_BACKGROUND_ID \
  --name "Lucia in Market Scene" \
  --type scene \
  "Use image 1 as the character and image 2 as the background" \
  -o keyframes/lucia-market-001.png
```

Local image paths are uploaded first as `reference` assets in the website space.
The returned uploaded variant IDs are then sent as `referenceVariantIds` for the
generation request. This keeps local references visible in the web graph.

## Output Files

The CLI downloads the completed R2 image to the path passed with `-o` or
`--output`. Existing files are not overwritten unless `--force` is passed.

## Options

| Option | Commands | Description |
|--------|----------|-------------|
| `--space <id>` | all | Target website space; overrides project binding |
| `--name <name>` | `generate`, `derive`, `batch` | New asset name |
| `--type <type>` | `generate`, `derive`, `batch` | New asset type |
| `--variant <id>` | `refine` | Source variant to refine |
| `--refs <refs>` | `derive`, `batch` | Comma-separated variant IDs or local image paths |
| `-o`, `--output <file>` | `generate`, `refine`, `derive` | Local download path |
| `--output-dir <dir>` | `batch` | Directory for downloaded batch images |
| `--count <2-8>` | `batch` | Number of images to generate |
| `--mode <mode>` | `batch` | `explore` for one asset with many variants, or `set` for many assets |
| `--force` | all | Overwrite local output file |
| `--aspect <ratio>` | all | Optional generation aspect ratio |
| `--parent <assetId>` | `generate`, `derive` | Optional parent asset |
| `--no-style` | all | Disable active space style for this request |
| `--env <env>` | all | `production`, `stage`, or `local`; overrides project binding |
| `--local` | all | Shortcut for `--env local` |

Direct use of `gemini-images` or other generators remains intentionally
untracked by Inventory unless the resulting files are uploaded or used as local
references through these commands.

## Run Manifests

`batch` writes a JSON manifest to `.inventory/runs/<run-id>.json` at the
initialized project root, even when the command runs from a child directory. The
manifest maps downloaded local files to website asset IDs, variant IDs, image
keys, prompt, refs, command options, timestamps, run success, and any failed
variant errors. Completed images are still downloaded and recorded when another
batch member fails. It is a handoff artifact for Remotion, Kling, or other video
tooling; it is not a local asset database and the website remains the source of
truth.

Inspect and export manifests:

```bash
pnpm run cli runs
pnpm run cli runs show --latest
pnpm run cli runs show RUN_ID --json
pnpm run cli runs export --latest --format remotion -o keyframes.json
```

The Remotion export writes ordered keyframe data with local paths, absolute
paths resolved from the original batch command working directory, website
IDs/URLs, prompt, refs, and failed variant errors for downstream video tooling.

## End-To-End Test Loop

Run the CLI/worker loop without Gemini calls:

```bash
pnpm run test:e2e:cli-forge
```

This starts a local Wrangler worker, applies local D1 migrations in an isolated
temporary state directory, creates a dev-authenticated space, runs
`generate`, `refine`, `derive`, and `batch`, verifies each downloaded file is a
PNG, verifies the batch manifest, and forces the backend image provider to
`fake`.
