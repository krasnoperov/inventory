# Production Handoff

Exploration is only useful if the best discoveries can make it into the thing you are building.

Make Effects keeps generated media connected to the production that needs it: what was chosen, where it belongs, and which file downstream tools should use.

## Production records

A production record associates a completed image or video variant with a production ID and optional scene metadata.

Common fields:

- `productionId`: stable group such as `trailer-01` or `s01e01-a2`.
- `sceneLabel`: human-readable scene or beat label.
- `timelineStartMs`: intended timeline start in milliseconds.
- `durationMs`: intended duration.
- `shotId`: stable shot identifier.
- `sourceRefs`: script, reference, or variant sources used for the placement.

## Generate and place

Single-output generation commands can create a production placement after the media completes:

```sh
makefx video generate "A looping idle animation" \
  --name "Idle Animation" \
  --type animation \
  --production-id trailer-01 \
  --scene-label "Robot idle" \
  --timeline-start-ms 0 \
  --duration-ms 3000 \
  -o handoff/robot-idle.mp4
```

## Place existing variants

```sh
makefx productions place \
  --production-id trailer-01 \
  --variant VARIANT_ID \
  --scene-label "Robot idle" \
  --timeline-start-ms 0
```

## Inspect and export

```sh
makefx productions list --production-id trailer-01
makefx productions export --production-id trailer-01 --json -o scenes.json
makefx productions export --production-id trailer-01 --media-dir handoff/media -o scenes.args
```

The export command downloads visual media through authenticated variant endpoints and writes ordered handoff records for downstream render, game, and editorial tools.

## Recommended workflow

1. Generate or upload media into a space.
2. Curate active variants.
3. Place approved variants into a production ID.
4. Export media and metadata for downstream tools.
5. Keep the space as the reviewable source of truth.
