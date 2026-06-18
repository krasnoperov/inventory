# Video Playbook

A video prompt gets easier after the first frame is already right. Make keyframes first, then direct the shot.

## Start from locked keyframes

Text-to-video from a cold prompt is the least controlled path. For characters, scenes, and repeatable productions:

1. Generate or derive the keyframe as an image.
2. Check identity, composition, and style.
3. Use that completed variant as the reference for video.
4. Attach production metadata if the clip belongs on a timeline.

```sh
makefx derive --refs CHARACTER_VARIANT_ID,BACKGROUND_VARIANT_ID \
  --name "Shot 001 Keyframe" --type scene \
  "Hero centered in the market, cinematic 16:9 composition" \
  -o keyframes/shot-001.png

makefx video derive --refs KEYFRAME_VARIANT_ID \
  --name "Episode 01 Shot 001" --type animation \
  --production-id episode-01 --shot-id shot-001 \
  --scene-label "Market" --timeline-start-ms 0 --duration-ms 8000 \
  "Slow dolly-in, subtle crowd movement, keep the hero centered" \
  -o video/episode-01/shot-001.mp4
```

## Direct the shot

A useful video prompt describes:

- camera movement
- subject
- action
- context
- style and ambience
- sound when sound matters

Example:

```text
Medium shot of a tired office worker rubbing his temples in front of a bulky 1980s computer late at night. Slow dolly-in. Harsh fluorescent overhead light and green monitor glow. Slightly grainy 1980s color film look. Quiet keyboard clacks and distant air conditioner hum.
```

Use camera words when they change the shot: dolly, tracking shot, low angle, close-up, wide shot, shallow depth of field, rim lighting, golden hour.

## Use beats for short clips

For a multi-beat clip, timestamp the beats:

```text
[00:00-00:02] Medium shot from behind an explorer pushing aside a jungle vine.
[00:02-00:04] Reverse shot of her face, awe at moss-covered ruins.
[00:04-00:06] Tracking shot as she runs a hand over ancient carvings.
[00:06-00:08] Wide crane shot revealing the temple.
```

Keep the number of beats honest for the duration you will actually get.

## Hand off production clips

Use production metadata while generating so the clip is already attached to the shot record:

```sh
makefx productions export --production-id episode-01 -o handoff/episode-01.scenes.args
```

The export pulls selected media from the workspace and writes ordered handoff records for your editor, game, or render pipeline.

## Quick reference

| Goal | Do this |
|-|-|
| Consistent character | Build image keyframes from the same reference asset |
| Controlled motion | `video derive --refs KEYFRAME_ID` |
| Directed shot | Camera + subject + action + context + style |
| Multi-beat clip | Timestamp each beat |
| Timeline handoff | Add production metadata and export |

See [Model & Parameter Selection](/docs/model-and-parameter-selection) for Veo defaults, reference limits, aspect ratios, and the difference between generated clip length and production timeline duration.
