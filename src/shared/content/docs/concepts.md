# Core Concepts

Make Effects is not trying to replace a good generator CLI. It gives that CLI a project memory.

The goal is simple: generate freely, explore broadly, keep the best variants, understand how each result was made, and move chosen media into production.

## Space

A space is a collaborative container for media work. It owns assets, variants, lineage, chat, production records, and real-time sync.

Use one space for a game, episode, trailer, campaign, or other project boundary where you and an agent or colleague need shared context.

## Asset

An asset is the named thing you care about: a character, scene, item, music bed, sound effect, dialogue take, animation, or reference.

Assets have mutable metadata such as name, type, parent, and active variant.

## Variant

A variant is an immutable media result attached to an asset.

Variants can be images, audio files, or video files. A completed variant stores media metadata such as MIME type, dimensions, duration, storage key, and provider details when available.

## Recipe

A recipe records how a variant was made: prompt, operation, model or provider, source variants, local references, style settings, and generation options.

Recipes make it possible for humans and agents to explain, retry, refine, or branch from previous work instead of guessing what happened.

## Lineage

Lineage is the ancestry of generated media. It answers what sources were used to create a variant or asset.

For example, a video attack animation can be derived from a character image and an earlier idle animation. Those sources stay visible as lineage instead of becoming detached files.

## Run Manifest

CLI generation commands write debug manifests under `.inventory/runs/`.

Manifests map local downloaded files to website asset IDs, variant IDs, prompts, references, media keys, timestamps, and failed variant errors. They are troubleshooting traces, not the source of truth.

## Production Record

A production record places a completed variant into a named production timeline or handoff group.

Records can include scene label, timeline start, duration, shot ID, motion prompt, and source references. They make generated files easier to export into render, game, and editorial tools.

## Source of Truth

The website and its Cloudflare-backed space state are canonical. The CLI is the fast control surface over that state.

Agents should prefer `makefx` commands and JSON outputs over direct database, Durable Object, or R2 access.
