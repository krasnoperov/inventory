# Video Playbook

A video prompt gets easier after the first frame is already right. Make keyframes first, then direct the shot.

## Start from locked keyframes

Text-to-video from a cold prompt is the least controlled path. For characters, scenes, and repeatable assets:

1. Generate or derive the keyframe as an image.
2. Check identity, composition, and style.
3. Use that completed variant as the reference for video.
4. Set the best result as the main variant or continue from it.

```sh
makefx derive --refs CHARACTER_VARIANT_ID,BACKGROUND_VARIANT_ID \
  --name "Shot 001 Keyframe" --type scene \
  "Hero centered in the market, cinematic 16:9 composition" \
  -o keyframes/shot-001.png

makefx video derive --refs KEYFRAME_VARIANT_ID \
  --name "Episode 01 Shot 001" --type animation \
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

## Keep the selected clip

Use the Space canvas and Details view to compare variants, set the strongest one as the asset's main variant, and continue from that variant when you need another pass.

```sh
makefx assets show ASSET_ID
makefx assets set-active ASSET_ID VARIANT_ID
makefx assets download VARIANT_ID -o video/episode-01/shot-001.mp4
```

The selected variant is the handoff point: it stays visible on Space, keeps lineage, and can be refined or used as a reference for the next asset.

## Quick reference

| Goal | Do this |
|-|-|
| Consistent character | Build image keyframes from the same reference asset |
| Controlled motion | `video derive --refs KEYFRAME_ID` |
| Directed shot | Camera + subject + action + context + style |
| Multi-beat clip | Timestamp each beat |
| Chosen clip | Set the best variant as main and download it |

See [Model & Parameter Selection](/docs/model-and-parameter-selection) for Veo defaults, reference limits, aspect ratios, and provider clip duration.
