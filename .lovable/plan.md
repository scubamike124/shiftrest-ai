# Client-Side Buffering — Confirmed on iOS Safari

## Direct answers

**1. Is the client streaming or buffering the whole body?**
The client code in `src/lib/companion/speak.ts` (`playOnce`) has TWO paths:

- **Streaming path** — uses `MediaSource` + `SourceBuffer.appendBuffer(...)` fed by a `ReadableStream` reader as chunks arrive. This is the correct incremental-playback path.
- **Fallback path** — `blob = await resp.blob()` which waits for the ENTIRE response body before assigning `audio.src`.

Which path runs is gated by:

```
MediaSource.isTypeSupported("audio/mpeg")
```

**2. Is the full response awaited before `audio.src` is set?**
On iOS Safari (the device the timing tests are running on — viewport 375×598) `window.MediaSource` is **undefined**, so `canStreamMse` is false and the code falls into `await resp.blob()` — the full ElevenLabs stream is buffered before playback starts. This exactly matches the observed 8–10 s delay that scales with clip length and network.

Desktop Chrome/Firefox would stream correctly today; iPhone Safari would not. This is the smoking gun.

## Root cause

Safari on iOS does not expose the classic `MediaSource` API for `<audio>`. Since 17.1 it ships `ManagedMediaSource` (same shape, different global) specifically designed for streaming into media elements from a `ReadableStream`. Our feature detection only checks `MediaSource`, so iOS always falls back to the buffered blob path — negating the server-side `/stream` fix entirely on the device the user is testing on.

## Fix (small, surgical)

Edit only `src/lib/companion/speak.ts`:

1. Add a helper that resolves the streaming MSE constructor:
   ```
   const MSE = (typeof window !== "undefined"
     && ((window as any).ManagedMediaSource ?? window.MediaSource)) || null;
   ```
2. Replace the `canStreamMse` check with `MSE && MSE.isTypeSupported("audio/mpeg") && resp.body != null`.
3. Construct `new MSE()` instead of `new MediaSource()`.
4. For `ManagedMediaSource`, set `audio.disableRemotePlayback = true` and listen for the `startstreaming` / `endstreaming` events to pace `appendBuffer` (required by the spec; without it Safari may throttle appends).
5. Keep the existing `MediaSource` path as-is for desktop.

No server changes. No other files. Pure iOS Safari compatibility fix for the streaming path we already built.

## Expected impact

- iPhone Safari: `t4 → t5` drops from ~8–10 s to ~0.5–1.5 s (matches desktop, matches realtime voice chat).
- Desktop: unchanged (already streaming).
- If Safari version is < 17.1 (no `ManagedMediaSource`), falls back to today's blob behaviour — no regression.

## Verification

- Typecheck.
- Publish once.
- One final on-device timing run to confirm `t4 → t5` collapses.

## Out of scope

- Server prompt shortening for the 2.9 s LLM step — noted but deferred until this TTS fix lands and we re-measure.
