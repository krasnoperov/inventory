# CLI Forge Control

The CLI can drive an existing Inventory space as a ForgeTray controller.
The website remains the source of truth: assets, variants, recipes, lineage, and
stored media live in the Space Durable Object and R2. The CLI sends requests,
waits for completion, and downloads local copies of completed media.
Top-level `generate`, `refine`, `derive`, and `batch` are image-only commands
and send `mediaKind: "image"` with generation requests. The `audio` subcommands
send `mediaKind: "audio"` and use the same website job lifecycle. The shared
source of truth for these generation capabilities is
`src/shared/mediaOperationMatrix.ts`.

## Shared Operation Matrix

| CLI surface | Commands | Sent `mediaKind` | References | Batch manifest |
|-------------|----------|------------------|------------|----------------|
| Top-level image | `generate`, `refine`, `derive`, `batch` | `image` | `derive --refs` and `batch --refs` accept completed image variant IDs or local image files | Yes, for `batch` |
| Audio namespace | `audio generate`, `audio batch` | `audio` | Not supported | No |
| Video generation | Not exposed yet | N/A | N/A | N/A |

Forge Tray uses the same matrix for mode labels, output media kind, default
asset type, slot compatibility, batch/style controls, and operation selection.

## Project Binding

Bind a local directory to a website space:

```bash
pnpm run cli init --space SPACE_ID
```

This writes `.inventory/config.json` with the target environment and space ID.
It does not store assets, prompts, images, generation keys, or auth tokens.
Inside an initialized project, Forge commands can omit `--space` and `--env`.
Explicit command flags override the project config.

Without an initialized project or explicit `--env`, the CLI targets production.
Use `--env stage` for staging and `--local` for a local dev server. `init` and
`spaces create` accept `--json` for script- and agent-friendly handoffs.

## Website Asset Inventory

Use `assets` to inspect the website state that generation commands create:

```bash
pnpm run cli assets
pnpm run cli assets --json
pnpm run cli assets show ASSET_ID --json
```

This is the CLI read side of the ForgeTray control loop. External agents can
list assets, select image variant IDs for `--refs`, inspect lineage, and
download a completed variant's media without direct database access:

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

Generate audio through website jobs:

```bash
pnpm run cli audio generate "A short brass victory sting" \
  --name "Victory Sting" \
  --type audio \
  -o audio/victory.wav

pnpm run cli audio batch "Three short UI notification sounds" \
  --name "Notification Sound" \
  --type audio \
  --count 3 \
  --output-dir audio/notifications
```

When the website is configured with `INVENTORY_AUDIO_PROVIDER=elevenlabs`,
`--type music` prompts are generated through ElevenLabs music, `--type sfx`
prompts are generated through ElevenLabs sound effects, and other audio prompts
are generated through ElevenLabs speech. Multi-speaker dialogue can be sent as
one `Speaker: line` entry per line; the website maps speakers to the
comma-separated `ELEVENLABS_DIALOGUE_VOICE_IDS` configured on the worker. The
CLI still sends only the prompt, asset type, and `mediaKind: "audio"`; API keys,
voice IDs, model IDs, and output format stay server-controlled.

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

The CLI downloads the completed R2 artifact to the path passed with `-o` or
`--output`. Existing files are not overwritten unless `--force` is passed.
Generic audio artifacts are downloaded through the authenticated variant media
endpoint rather than by dereferencing raw R2 keys.

## Options

| Option | Commands | Description |
|--------|----------|-------------|
| `--space <id>` | all | Target website space; overrides project binding |
| `--name <name>` | `generate`, `derive`, `batch`, `audio generate`, `audio batch` | New asset name |
| `--type <type>` | `generate`, `derive`, `batch`, `audio generate`, `audio batch` | New asset type |
| `--variant <id>` | `refine` | Source variant to refine |
| `--refs <refs>` | `derive`, `batch` | Comma-separated variant IDs or local image paths |
| `-o`, `--output <file>` | `generate`, `refine`, `derive`, `audio generate` | Local download path |
| `--output-dir <dir>` | `batch`, `audio batch` | Directory for downloaded batch files |
| `--count <2-8>` | `batch`, `audio batch` | Number of artifacts to generate |
| `--mode <mode>` | `batch`, `audio batch` | `explore` for one asset with many variants, or `set` for many assets |
| `--force` | all | Overwrite local output file |
| `--aspect <ratio>` | all | Optional generation aspect ratio |
| `--parent <assetId>` | `generate`, `derive` | Optional parent asset |
| `--no-style` | all | Disable active space style for this request |
| `--env <env>` | all | `production`, `stage`, or `local`; overrides project binding |
| `--local` | all | Shortcut for `--env local` |

Direct use of `gemini-images` or other generators remains intentionally
untracked by Inventory unless the resulting files are uploaded or used as local
references through these commands.

Audio generation currently does not accept `--refs`, `derive`, or `refine`.
Audio batch downloads completed files into the requested directory but does not
write image keyframe run manifests. ElevenLabs timestamp responses are stored
as transcript, timing, and render metadata sidecars on the completed variant.

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

Run the media foundation loop without external generation providers:

```bash
pnpm run test:e2e:media-foundation
```

This builds the app, starts a local Wrangler worker with an isolated D1/R2/DO
state directory, uploads image/audio/video assets through the website API,
downloads them through authenticated variant media routes, checks range support,
triggers one WebSocket generation with the fake image provider, and verifies the
generated media through the same authenticated media route.

Run the CLI/worker loop without Gemini calls:

```bash
pnpm run test:e2e:cli-forge
```

This starts a local Wrangler worker, applies local D1 migrations in an isolated
temporary state directory, creates a dev-authenticated space, runs
`generate`, `refine`, `derive`, and `batch`, verifies each downloaded file is a
PNG, verifies the batch manifest, and forces the backend image provider to
`fake`.
