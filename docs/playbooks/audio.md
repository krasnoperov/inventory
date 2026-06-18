# Audio Playbook: Narration, Dialogue, Music, And Effects

Make Effects produces audio through explicit **modes** — `speech`, `dialogue`,
`music`, and `sfx` — with ElevenLabs as the default provider and Lyria
available for music. The same discipline from the image and video playbooks
applies: nothing good is filled in by default, so describe what the listener
should hear as deliberately as what they see. This page covers the shipped paths
first, then the broader Gemini-native audio architecture.

## Pick The Right Mode

Each mode maps to a distinct job. Choosing the wrong one is the most common
reason audio comes out flat.

| Mode | Use it for | CLI |
|-|-|-|
| `speech` | Single-voice narration, voiceover, host intro | `makefx audio speech generate` |
| `dialogue` | Multi-speaker scripts, character conversations | `makefx audio dialogue generate` |
| `music` | Beds, cues, stings, loops | `makefx audio music generate` |
| `sfx` | Discrete sound effects | `makefx audio sfx generate` |

```bash
makefx audio speech generate \
  "A calm host intro: Welcome back to the forge." \
  --name "Episode Intro Narration" -o audio/intro.wav

makefx audio sfx generate \
  "A crisp inventory item pickup sound effect" \
  --name "Item Pickup SFX" -o audio/item-pickup.wav
```

## Speech And Dialogue: Voice Is The Reference Asset

For spoken audio, the **voice** is what identity is for images: pick it once and
reuse it so a character or host sounds the same across an entire production. Make
Effects surfaces the connected account's voice library as a picker; treat a
chosen voice as a locked reference, the audio equivalent of a character sheet.

For multi-speaker work, `dialogue` mode parses scripts written one
`Speaker: line` entry per line. Keep speaker names stable across files so the
same voice maps to the same character throughout:

```text
Host: Welcome back to the forge.
Blacksmith: Took you long enough. Grab a hammer.
Host: Easy — I only just put my coffee down.
```

```bash
makefx audio dialogue generate \
  --input scripts/scene-dialogue.txt \
  --name "Blacksmith Dialogue" -o audio/blacksmith-dialogue.wav
```

When you write the line, write the *delivery* too. The cross-vendor rule for
generated speech is to state who is speaking, their tone, and their pacing
rather than leaving it to chance.[^veo3-audio] A line like "in a weary voice,
'We have to leave now'" carries far more than the bare words.

## Music: Brief It Like A Supervisor

Describe music with genre and era, tempo, key instruments, and a dynamic arc —
and keep the brief internally consistent. Google's Lyria guidance, which
generalizes well to any text-to-music model, is explicit: be descriptive and
specific, but don't over-complicate, and never issue contradictory instructions
like asking for music that is both "fast and slow."[^lyria-deepmind][^lyria-gcloud]

```bash
makefx audio music batch \
  "Three 20-second low-intensity fantasy workshop beds, warm strings and soft \
   hand percussion, no vocals, gentle and unobtrusive" \
  --name "Workshop Music Bed" --count 3 --output-dir audio/music-beds

makefx audio music generate \
  "A 30-second lyrical Celtic town theme, fiddle and harp, no vocals" \
  --provider lyria --name "Town Theme" -o audio/town-theme.wav
```

Reach for these descriptors: genre and era ("early-90s lo-fi hip-hop"), tempo
(slow ballad, mid-tempo, driving), specific instruments, and how the piece
evolves ("quiet piano builds into an explosive chorus").[^lyria-deepmind] Use
`batch` when the next step needs several candidates to choose between.

## SFX And Ambience: Tie Sound To What's On Screen

For effects, describe the sound concretely and, when it accompanies video, tie
it to a visible action. The audio-aware-prompting rule for generated sound is to
match effects to on-screen events and to define the ambient bed explicitly —
"crunchy typing sounds," "thunder cracks in the distance," "the quiet hum of a
starship bridge."[^veo3-audio][^skywork] State what should stay silent, too;
silence is a choice the model will not make for you.

## The Gemini-Native Audio Path (Target Architecture)

The shipped stack treats audio as separate generation steps. The Gemini-native
architecture collapses some of that:

- **Veo native audio.** Veo 3.1 generates synchronized dialogue, sound effects,
  and ambient audio *with* the video, scored simultaneously but separately, so
  requesting audio does not cost video resolution.[^veo3-audio] The catch is the
  same as everywhere else: Veo "won't automatically fill in audio — you have to
  explicitly tell it what sounds you want, who's speaking, and how they
  speak."[^veo3-audio] A modern Veo prompt therefore carries an audio layer:
  dialogue in quotes, `SFX:` cues bound to on-screen actions, and an
  `Ambient noise:` bed (see the [video playbook](./video.md)).
- **Lyria** is Google's dedicated music model, accepting genre/era/tempo/
  instrument/dynamic descriptors and even image- or lyrics-based
  prompts.[^lyria-deepmind] Note version differences before relying on a
  feature — negative prompts are supported on Lyria 2 but not on Lyria
  3.[^lyria-gcloud] Make Effects exposes it for `music` requests with
  `--provider lyria` or the Forge Tray music provider selector.

The whole stack is designed to chain: Nano Banana makes the keyframes, Veo
animates and voices them, Lyria scores them — with the same named references and
descriptive vocabulary threaded through each step.[^gcloud-nb] When the Make
Effects audio surface adds native Veo audio, the prompting discipline on this
page carries over unchanged; only the number of separate steps shrinks. Current
parameters and provider details live in
[model-and-parameter-selection.md](../model-and-parameter-selection.md).

## Quick Reference

| Goal | Do this |
|-|-|
| Consistent narrator/character voice | Pick one voice, reuse it across the production |
| Multi-speaker scene | `dialogue` mode, stable `Speaker:` names, describe delivery |
| Music bed or cue | Brief genre + era + tempo + instruments + dynamics; stay consistent |
| Several music options | `audio music batch --count N` |
| Effects for video | Describe the sound, tie it to the on-screen action |
| Future: audio with video in one step | Veo native audio — describe the audio layer in the Veo prompt |

## Sources

[^veo3-audio]: Veo3AI (2026). "Veo 3 Native Audio Prompt Guide 2026: Dialogue, SFX, and Lip Sync." https://www.veo3ai.io/blog/veo-3-native-audio-prompt-guide-2026
[^skywork]: Skywork AI. "How to Get Matching Soundscapes with Audio-Aware Prompting in Veo 3.1." https://skywork.ai/blog/how-to-audio-aware-prompting-veo-3-1-guide/
[^lyria-deepmind]: Google DeepMind. "How to create effective prompts with Lyria." https://deepmind.google/models/lyria/prompt-guide/
[^lyria-gcloud]: Google Cloud. "Lyria music generation prompt guide." Vertex AI documentation. https://docs.cloud.google.com/vertex-ai/generative-ai/docs/music/music-gen-prompt-guide
[^gcloud-nb]: Google Cloud (2025). "Ultimate prompting guide for Nano Banana." https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana
