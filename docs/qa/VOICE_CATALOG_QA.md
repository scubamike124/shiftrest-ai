# Voice Catalog QA — Phase 1 Quality Gate

This is the gate that blocks Phase 2 (cinematic Companion). Do not approve
until every cell in the matrix is filled and the production catalog is signed
off.

Harness: **`/qa/voice`** — 4 voices × 3 modes × 2 providers. Results and the
catalog selection are persisted in `localStorage`; use the **Export Markdown**
button to drop a snapshot back into this file.

## Test conditions

Run each cell on:

- iPhone speaker — normal volume
- iPhone speaker — bedtime volume
- AirPods — normal volume
- AirPods — bedtime volume

Pass criteria per cell: natural & premium · no robotic tone · no clipping ·
no awkward pauses · no skipped words · no sentence cutoffs · correct
emotional delivery · consistent pronunciation · fast first audio · smooth
playback throughout.

## Mode intent

- **Normal** — natural conversation, relaxed pacing, friendly and professional.
- **Sleep** — calmer, slightly slower, soft delivery, comfortable at bedtime
  volume. Must never whisper to the point of being hard to hear.
- **Encouraging** — more energy, positive, motivating. Natural enthusiasm —
  never exaggerated.

## Matrix — ElevenLabs (primary)

| Voice    | Normal | Sleep | Encouraging |
| -------- | ------ | ----- | ----------- |
| Sarah    |        |       |             |
| George   |        |       |             |
| Alice    |        |       |             |
| Matilda  |        |       |             |

## Matrix — OpenAI (forced fallback)

| Voice    | Normal | Sleep | Encouraging |
| -------- | ------ | ----- | ----------- |
| Sarah    |        |       |             |
| George   |        |       |             |
| Alice    |        |       |             |
| Matilda  |        |       |             |

## Fallback behavior checklist

- [ ] No failed playback on forced fallback
- [ ] Voice quality remains premium
- [ ] No obvious personality shift
- [ ] No major pronunciation or pacing differences
- [ ] Automatic recovery works (switch provider back to ElevenLabs; first turn plays)

## Failure policy

Remove from production any voice that sounds cheap, robotic, annoying,
artificial, inconsistent, or fatiguing during extended listening. Better to
ship fewer excellent voices than several average ones.

## Final production catalog

- [ ] Sarah — Calm female · default
- [ ] George — Calm male
- [ ] Alice — Warm British
- [ ] Matilda — Soft Australian

Sign-off: _________________________  Date: ___________
