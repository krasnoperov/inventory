# Rotation Pipeline

Experimental pipeline for generating multi-view reference sheets from one
completed image variant.

Rotation is hidden by default. The web UI, CLI command surface, and backend
WebSocket request handler are gated by `MAKEFX_ROTATION_ENABLED`.

## Overview

The pipeline creates a dedicated output asset, seeds it with the source variant,
then generates remaining views one at a time. Each step feeds completed views
back as named references for the next step. Those source references create
immutable lineage for provenance; they do not create a user-facing parent
hierarchy.

## Configurations

| Config | Directions | Count |
|--------|------------|-------|
| `4-directional` | S, E, N, W | 4 |
| `8-directional` | S, SE, E, NE, N, NW, W, SW | 8 |
| `turnaround` | front, 3/4-front, side, 3/4-back, back | 5 |

The first direction is always the seed. Generation starts from the second
direction onward.

## Pipeline Flow

1. Validate that the source variant is completed and has an image.
2. Create an output asset named `"{sourceName} -- Rotation"` with type
   `rotation-set`.
3. Fork the source variant into the output asset and create `forked` lineage.
4. Create the `rotation_set` record and register the seed `rotation_view`.
5. Broadcast `rotation:started`.
6. Call `advanceRotation()` until every direction is complete, failed, or
   cancelled.

## Completion Hook

`GenerationController` advances rotation when a completed variant belongs to a
`rotation_view`. Single-shot sheet variants are sliced by `RotationController`
when their recipe records `generationMode: "single-shot"` and a `gridLayout`.

Failure handling marks the rotation set failed and broadcasts
`rotation:failed`; standalone variants are unaffected.

## WebSocket Messages

Client messages:

| Type | Payload | Purpose |
|------|---------|---------|
| `rotation:request` | `requestId`, `sourceVariantId`, `config`, `subjectDescription?`, `aspectRatio?`, `disableStyle?`, `generationMode?` | Start rotation generation |
| `rotation:cancel` | `rotationSetId` | Cancel an in-progress rotation |

Server messages:

| Type | Payload | Purpose |
|------|---------|---------|
| `rotation:started` | `requestId`, `rotationSetId`, `assetId`, `totalSteps`, `directions[]` | Pipeline accepted |
| `rotation:step_completed` | `rotationSetId`, `direction`, `variantId`, `step`, `total` | One view finished |
| `rotation:completed` | `rotationSetId`, `views[]` | All views finished |
| `rotation:failed` | `rotationSetId`, `error`, `failedStep` | Pipeline failed |
| `rotation:cancelled` | `rotationSetId` | Pipeline cancelled |

Sync payloads may include `rotationSets` and `rotationViews` so clients can
display in-progress rotation state.

## CLI

```bash
MAKEFX_ROTATION_ENABLED=true makefx rotation --variant VARIANT_ID --config 8-directional
MAKEFX_ROTATION_ENABLED=true makefx rotation --variant VARIANT_ID --config turnaround --mode single-shot --subject "hero knight"
MAKEFX_ROTATION_ENABLED=true makefx rotation cancel ROTATION_SET_ID
```

Use `--detach` to return after `rotation:started` instead of waiting for a
terminal event.
