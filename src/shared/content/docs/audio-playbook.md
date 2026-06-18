# Audio Playbook

Audio prompts need the same staging as visuals: who is speaking, where the sound happens, and what action it belongs to.

## Pick the mode

| Mode | Use it for | CLI |
|-|-|-|
| `speech` | Single-voice narration or voiceover | `makefx audio speech generate` |
| `dialogue` | Multi-speaker scripts | `makefx audio dialogue generate` |
| `music` | Beds, cues, stings, loops | `makefx audio music generate` |
| `sfx` | One-off sound effects | `makefx audio sfx generate` |

```sh
makefx audio speech generate \
  "A calm host intro: Welcome back to the forge." \
  --name "Episode Intro Narration" -o audio/intro.wav

makefx audio sfx generate \
  "A crisp inventory item pickup sound effect" \
  --name "Item Pickup SFX" -o audio/item-pickup.wav
```

## Treat voice as identity

For speech and dialogue, the voice is the audio equivalent of a character sheet. Pick it once and reuse it across the production.

For dialogue, keep speaker names stable:

```text
Host: Welcome back to the forge.
Blacksmith: Took you long enough. Grab a hammer.
Host: Easy. I only just put my coffee down.
```

```sh
makefx audio dialogue generate \
  --input scripts/scene-dialogue.txt \
  --name "Blacksmith Dialogue" -o audio/blacksmith-dialogue.wav
```

Do not leave the performance implied. Add pace, emotion, and situation directly to the line.

## Brief music clearly

For music, include:

- genre or era
- tempo
- key instruments
- mood
- dynamic arc
- whether vocals are allowed

```sh
makefx audio music batch \
  "Three 20-second low-intensity fantasy workshop beds, warm strings and soft hand percussion, no vocals, gentle and unobtrusive" \
  --name "Workshop Music Bed" --count 3 --output-dir audio/music-beds
```

Use batch generation when the next step is choosing among candidates.

## Tie effects to action

For SFX, describe the sound and the visible event it belongs to:

```text
A short, bright magical pickup chime exactly as a glowing coin snaps into the inventory.
```

For video work, include ambience too: room tone, crowd murmur, wind, machine hum, footsteps, or intentional silence.

## Quick reference

| Goal | Do this |
|-|-|
| Consistent narrator | Reuse one voice |
| Multi-speaker scene | Stable `Speaker:` names |
| Music bed | Genre + tempo + instruments + dynamics |
| Several candidates | Batch mode |
| Video effect | Tie the sound to visible action |

See [Model & Parameter Selection](/docs/model-and-parameter-selection) for choosing speech, dialogue, music, SFX, and output settings.
