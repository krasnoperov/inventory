# CLI Forge Control

The CLI can drive an existing Inventory space as a ForgeTray controller.
The website remains the source of truth: assets, variants, recipes, lineage, and
stored images live in the Space Durable Object and R2. The CLI sends requests,
waits for completion, and downloads local copies of completed images.

## Commands

Generate a new asset from text:

```bash
npm run cli -- generate "A watercolor background of Russafa market" \
  --space SPACE_ID \
  --name "Russafa Market Background" \
  --type scene \
  -o backgrounds/russafa-market.png
```

Refine an existing variant:

```bash
npm run cli -- refine \
  --space SPACE_ID \
  --variant VARIANT_ID \
  "make it evening, warmer lights" \
  -o backgrounds/russafa-market-evening.png
```

Derive a new asset from references:

```bash
npm run cli -- derive \
  --space SPACE_ID \
  --refs CHARACTER_VARIANT_ID,BACKGROUND_VARIANT_ID \
  --name "Lucia in Market Scene" \
  --type scene \
  "Place Lucia naturally in the market, cinematic keyframe" \
  -o keyframes/lucia-market-001.png
```

## Local References

`derive --refs` accepts both existing variant IDs and local image paths:

```bash
npm run cli -- derive \
  --space SPACE_ID \
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
| `--space <id>` | all | Target website space |
| `--name <name>` | `generate`, `derive` | New asset name |
| `--type <type>` | `generate`, `derive` | New asset type |
| `--variant <id>` | `refine` | Source variant to refine |
| `--refs <refs>` | `derive` | Comma-separated variant IDs or local image paths |
| `-o`, `--output <file>` | all | Local download path |
| `--force` | all | Overwrite local output file |
| `--aspect <ratio>` | all | Optional generation aspect ratio |
| `--parent <assetId>` | `generate`, `derive` | Optional parent asset |
| `--no-style` | all | Disable active space style for this request |
| `--env <env>` | all | `production`, `stage`, or `local` |
| `--local` | all | Shortcut for `--env local` |

Direct use of `gemini-images` or other generators remains intentionally
untracked by Inventory unless the resulting files are uploaded or used as local
references through these commands.

## End-To-End Test Loop

Run the CLI/worker loop without Gemini calls:

```bash
npm run test:e2e:cli-forge
```

This starts a local Wrangler worker, applies local D1 migrations in an isolated
temporary state directory, creates a dev-authenticated space, runs
`generate`, `refine`, and `derive`, verifies each downloaded file is a PNG, and
forces the backend image provider to `fake`.
