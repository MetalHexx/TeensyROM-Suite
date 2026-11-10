---
name: asid-dj-diagnostics
description: 'Measure and tune the DJ mixer''s ASID playback timing: stutter, dropped drums, "wooden block" pops, main-thread jank, the deck paint loop and its frame cadence, schedule-ahead (lookahead), the frame clock and what reaches the MIDI port. Use when playback in /dj-mixer (or the /dev/dj-poc POC) stutters, pops or drops notes; before changing the frame clock, the send path's schedule-ahead, LivePaintPacer, the painters or anything that runs on the main thread during playback; when asked to "bench", "trace", "profile playback", "check the lookahead", "why does it pop", or compare the mixer with the POC. Includes the djBench console bench, in-page probes (frame timer and CSS A/B, frame log, send capture with pop marking and analysis), DevTools trace analysis scripts and tune register-stream scripts.'
---

# ASID-DJ Diagnostics

How to find out where a DJ mixer playback problem comes from, and to prove a fix, on the real
cartridge. Built during `ASID-DJ-15` (2026-10-29), where ten measured changes took the mixer from
"stutters and drops drums" to "come a long way" — and every one of them was found by measurement,
not by reading code. The running record of that work, with every number, is the portfolio's
**performance log**: `C:\Users\Metal\.radorc\shared\projects\ASID-DJ-ROOT\ASID-DJ-PERFORMANCE-LOG.md`.
Read its **Where it stands** section first, and add what you find to it.

Pairs with `chrome-devtools-mcp` / Claude in Chrome (driving the page) and `device-transport-probe`
(the cartridge itself).

## When to Use This Skill

- The operator hears stutter, dropped kicks/snares, or a "wooden block" pop during DJ playback
- Before and after any change to the frame clock, the ASID sink, the send path's schedule-ahead
  (`MIXER_SCHEDULE_AHEAD_MS`, `SENDER_SCHEDULE_AHEAD_MS`), `LivePaintPacer`, the painters, the deck column's live DOM, or anything else on the main thread
- Comparing the mixer with the POC (`/dev/dj-poc`), dev with prod, one deck with two
- Checking what a tune actually writes around a moment the operator points at

## How playback timing works (what can go wrong where)

```
frame clock (sender path: the sender's wake; mixer path: a silent ScriptProcessor graph, main thread, callbacks in back-to-back pairs every ~10.7 ms)
  → SidPlayer builds the frame (sidablist core, 6502 emulation)
  → ASID sink packs it (sidablist asid), stamps it due + schedule-ahead
  → MIDIOutput.send (main thread)  → Edge's MIDI service thread → WinMM SysEx → USB
  → TeensyROM ASID player: applies ONE register per IRQ (~90 cycles each, control registers last)
```

- **Main thread.** The clock's callbacks, the sends and the page's rendering share one thread. Any
  task that runs long delays the next callback; at schedule-ahead 0 that delay is the send's delay.
  Competitors: the deck paint loop (`DeckService.watchPositions` + `LivePaintPacer`, ~30 paints/s),
  Angular change detection (should be **zero** during playback), the dev build's Redux DevTools
  tracker, browser extensions' content scripts, DevTools itself, Claude in Chrome's debugger.
- **Schedule-ahead** (two constants in `sender/deck-send-route.ts`: `SENDER_SCHEDULE_AHEAD_MS`, **15** ms
  when the timing helper's hidden frame sends, and `MIXER_SCHEDULE_AHEAD_MS`, **0** on today's sending
  from the mixer page): stamps each frame ahead so Chrome sends it on the grid. On the mixer path 0 / 12 / 20
  sounded alike and 0 adds no delay; the sender path needs 15 to hold its grid.
- **Two tick sources** (`DeckTickClock`, `infrastructure/.../dj/clock/deck-tick-clock.ts`; one per deck, `djBench.report()` → `tick.source`).
  On the **sender path** the clock asks the sender's loop to wake it at the next frame's due time plus
  ε (0.3 ms, so the wake never lands just before the frame) and renders from the wake, so a frame is
  made within a fraction of a millisecond of when it is due. Each wake **asks for the next one first,
  then renders**, so a render that throws cannot end the chain; a wake that finds no frame due counts as
  `early` and asks again for the same time. On the **mixer path** (and on a fallback or the `i` flip) the
  silent audio graph above ticks the deck, crediting measured time. The switch happens in
  `SenderSupervisor.routeTo`'s one synchronous step with the path, keeps the frame count and the time
  owed, and starts the audio graph without a fresh click (it relies on the page's earlier activation; a
  `resume()` still pending after 1 s logs a warning that the audio clock waits for a click).
  The **guard** is the backstop tick: on the link's 250 ms beat, a sender-source clock whose last handled
  wake is older than max(100 ms, 3 × interval) renders the frames that fell due and re-arms, on every such
  beat (`tick.wake.guardRearms`), and logs once per silent stretch, so each deck keeps real time through a
  hung sender until the health machine falls back. A wake that is not the armed one (after a stop, a
  switch, a newer play or a speed change) is dropped.
- **Frame clock bursts** (audio source). 10.7 ms callback pairs against a 9.975 ms play call (2× PAL) put a frame
  pair on the same instant now and then at 0 (≈3.8% on InSID3 Out). Stamping ahead fixes the grid;
  it did not remove the pop.
- **Rendering.** Every frame that changes anything re-layerizes the page's big root layer (1–1.4 ms
  on the mixer, 0.17 on the POC). One paint frame per ~30 ms carrying both painters and both decks is
  the cheapest shape; a frame that changes nothing is ~0.45 ms.

Key files (teensyrom-web `src/libs/application/src/lib/dj/`; the clock is in `src/libs/infrastructure/src/lib/dj/clock/`): `deck-runtime.ts` (schedule-ahead,
port façade, delivery probes), `sender/` (the send route, the sender's health machine and supervisor),
`bench/sender-bench.ts` (the sender's keys and readings), `deck.service.ts` (`watchPositions`), `live-paint-pacer.ts`,
`live-paint-clock.ts`, `playhead-painter.ts`, `sid-panel-painter.ts`, `bench/deck-bench.ts`,
`bench/delivery-probe.ts`; `../with-devtools.ts` (DevTools gated to dev). sidablist:
`libs/asid/src/sink/asid-sink.ts`, `libs/asid/src/wire/`. Firmware (read only):
`C:\dev\src\TeensyROM-Fork`, `ASIDPlayer.asm`.

## Ground rules

- **The ear decides; numbers find the cause.** Every change ends with the operator listening, and
  the result goes in the performance log in their words.
- **Listening tests: DevTools closed, Claude in Chrome off the tab.** Both add main-thread load
  (DevTools tracing, the extension's debugger). Probe, detach, then let the operator listen. Say so
  whenever you attach to a tab where the loop is playing.
- **Extensions are part of the bench.** Dashlane's content script blocked the main thread 7–9 ms
  every ~1.2 s and caused most of the worst gaps; the Redux DevTools extension made every store write
  sync nine stores. `trace-compare.mjs` lists extension scripts by id — note them with any reading.
- **Fresh page.** A page open for hours through dev rebuilds and console experiments played far
  worse than a reload. Reload before comparing, and say how old the page was.
- **Check the deck is at 1.00×** (`djBench.report()` → `intervalMs` 9.98 for InSID3 Out; 9.88 meant
  the fader was at +1%).
- **Every save reloads the dev page** (the dev server pushes a reload) and stops playback — tell
  the operator, and re-run `djBench.lookahead(...)` if you set one (it resets to the default).
- **Never propose `APT_WriteOrder`** (ASID write-order messaging). The operator avoided it on
  purpose; timing stays in the web apps.
- **The paint cadence is detected, never a setting** — other people have other monitors.
- **Changing schedule-ahead or other ear-validated constants is a hardware experiment**: bench it,
  then listen; the constant's doc comment carries the numbers.

## Step 1 — the console bench (`djBench`, dev builds)

On http://localhost:4200/dj-mixer with the loop playing, in the console (or through Claude in
Chrome's `javascript_tool`):

```
djBench.reset()        // clear the delivery probes, the press probes, the clocks' wake readings and the long-task count; wait ~10 s
djBench.report()       // per playing deck, since the reset
djBench.lagTimeline()  // per deck, one row per closed 10 s since the reset: { atS, frames, p99Ms, maxMs }
djBench.lookahead(ms)  // both decks' schedule-ahead on the live send path (sink caps it at 40 ms), then a full reset(); the other path keeps its own value; not persisted across reloads; works below the Settings floor too
await djBench.sender() // the timing helper's own numbers per deck (see below)
djBench.help()
```

The sender's default lookahead is 15 ms, provisional until the post-run bench (ASID-DJ-22). The DJ sets
it on Setup -> Settings, from the floor (15 ms, also provisional) to 40, and it is saved. `djBench.lookahead(ms)`
still overrides it for the page load, below the floor too, and is not saved; the post-run sweep relies on this.

`djBench.reset()` also clears the sender's timing record. A change of path (a self-heal, the `i` flip) does not restart the readings; only `reset()` and `lookahead(ms)` do.

**The sender (dev builds).** Two keys act with nothing focused (click an empty part of the page first;
inputs, dialogs and buttons with focus are left alone): `i` flips between the sender and today's
sending, so the operator can compare them by ear with DevTools closed (from `up` it parks on the mixer,
from `parked` it reopens the sender and takes a moment to come back); `b` breaks the sender on purpose,
the self-heal drill (`djBench.sender()` reads `path mixer`, `state down` with the down alert, then
`path sender`, `state up` with the back alert on its own). Press `b` more than 10 s after the page
loads: inside that start-up grace the path and state change and the log shows it, but no alert is
raised, so it looks like a dead tool.
`await djBench.sender()` prints and returns `{ path, state, answered, marginMs, wake, decks, timeline, visibility }`
(`state` can read `off`: the DJ switched the sender off, or it was saved off, and it never opens until switched on):
the sender's record per deck (`decks.A` / `decks.B`, empty with no cartridge), its wake lateness and
margin, a timeline and the hidden/visible changes. The record is bounded and safe to read mid-run.
When the sender is closed or down it sends no record: `answered` is `false`, `marginMs` and `wake` are
`null` and the lists are empty. That is "no reading", not zeros; read `path` and `state` to see why.
The sender runs in its own process: Edge's task manager (Shift+Esc) lists it as a subframe on `127.0.0.1`.

(`waves`, `history` and `waveReport` also live on `djBench`; see *Voice waves A/B*.)

Reading `report()` per deck:

| Field | Meaning |
|---|---|
| `lagMs` p50/p90/p99/max | the mixer lateness: how long after its due time each frame was handed to `send()`, the end of the frame's render, over the whole stretch since `reset()` (a histogram, good to 0.1 ms; `max` exact). A frame handed over before its due time reads about 0.05 ms, not negative; `lagPct` edges are good to one 0.1 ms bin |
| `presses` | press-to-wire per kind under `presses.byKind` (`play`, `stop`, `pause`, `jump`, `play-now`, `tempo`, `mute`, `nudge`; kinds with no reading are left out) and pooled as `presses.all`, each with count, mean, p50, p99 and max in ms, plus `noFrame` and `superseded` counts. Measured from where the press reaches the deck's engine to the moment the deck's next frame is stamped to leave: the ASID stop message for a stop, a register frame for the rest. A SID panel nudge is measured from the knob's press but ends only at a frame rendered after the mixer applier pushed it to the engine. A jump queued to a lap's end reads that next frame, not its wait, so bench jumps with no loop running |
| `lagTimeline()` | where a stall landed: each closed 10 s row's frames, p99 and max lag |
| `missedWindowPct` | frames handed over at or past their stamp (sent at once). Always 100% at schedule-ahead 0 |
| `spacing.collapsedPct` | consecutive frames < 25% of an interval apart on the wire's timeline (stamps, or send times when unstamped) |
| `spacing.onGridPct` / `stretchedPct` | frames at the interval / well past it |
| `tick.source` | what drives the deck's frames: `'sender'` (the sender's wake, on the sender path) or `'audio'` (the silent audio graph, on the mixer path). Flips with the path in one step, so the `i` and `b` keys change it |
| `tick.wake` | `null` until a wake or a guard re-arm has touched the deck, then since `reset()`: `wakes` handled, `early` (a wake that found no frame due and asked again; should be near 0), `guardRearms` (silent beats the backstop re-armed on; should be 0 — each one is a hung or lost chain), `senderLateMs` (asked → sent by the sender) and `mixerLateMs` (sent → handled on the mixer), each `{ count, p50, p99, max }` good to 0.1 ms. The two lateness splits say where a late frame came from: the sender's loop or the mixer's thread |
| `clock.jitterMs`, `worstGapMs`, `lateCallbacks` | the frame clock's own ticks (reset on play): on the audio source the callbacks; on the sender source the gap between handled wakes, and a wake handled more than one interval after its due as late |
| `player.lateFrames`, `meanLagMs` | the player's view of the same lateness |
| `longTasks` | main-thread tasks ≥ 50 ms (should be 0) |

These are what the page hands to Edge, **not** wire timing.

## Step 2 — in-page probes (no code change)

All in `scripts/probes/`. Paste into the console (the operator) or run through Claude in Chrome's
`javascript_tool` (you). Each says at its top how to use it.

| Probe | Answers |
|---|---|
| `frame-timer.js` | What each rendering frame costs (first rAF callback → end of the frame's task), frames/s vs painting frames/s; `__frameTimer.ab(variants)` A/B-tests injected CSS live |
| `frame-log.js` | Which frames the page asks for and gets: timestamps, gaps, callback names, when each was asked relative to its vsync — the check on `LivePaintPacer` |
| `send-capture.js` | Records every `send()` (time, stamp, bytes) and a mark per `` ` `` key press — the operator taps it at each pop with DevTools closed |
| `send-analysis.js` | Decodes the recorded ASID packets; send-gap stats; each marked stretch (900–100 ms before the tap) against the unmarked baseline: bunched/late sends, gates, noise, test-bit hard restarts |

Healthy readings on the operator's 100 Hz display (2026-10-29, 1×, one deck): frame log gaps
mostly 30 ms, ~37 frames/s with ~31 painting; painting frame p50 ~3.2 ms, p90 ~4.4, max < 8.

The pop-marker run: operator pastes `send-capture.js`, closes DevTools, clicks an empty part of
the page, plays, taps `` ` `` at each pop for 60–90 s; then run `send-analysis.js` in that tab. If
marked stretches look like the baseline, the pop is downstream of `send()` (Edge, WinMM, USB, the
cartridge) or in the content; if they stand out, that is the target.

Byte comparison (POC vs mixer): record the same loop on both pages with `send-capture.js` and
compare the decoded packets — they matched byte for byte in `ASID-DJ-15`.

## Step 3 — a DevTools Performance trace

For exact attribution of main-thread time. The operator records it (DevTools adds load — do not
judge the sound during it):

1. Performance panel, gear: leave **Include resource content** and **Include script source maps**
   off (one needs the other; neither is needed — functions resolve by name in the dev build).
2. Loop playing, record 10–15 s, stop, **Save profile** (e.g. `c:\test\mixer.devtools`).
3. Record the POC (`/dev/dj-poc`, same loop) the same way when comparing.

Analyse with `scripts/` (Node 20+, gzipped or plain JSON, the first 500 ms skipped):

| Script | Prints |
|---|---|
| `trace-compare.mjs <trace...>` | Side by side: rAF/layerize/layout/style rates, main busy ms/s by phase, tasks ≥ 4/8/12 ms and the longest, audio-callback (`onaudioprocess`) gaps (mixer path only: the sender path has no audio callback), extension scripts, MIDI service-thread task spacing |
| `trace-long.mjs <trace> [minMs]` | Self time by event across tasks ≥ minMs, and the longest task's breakdown |
| `trace-frames.mjs <trace>` | Rendering-task signatures (`rAF Style Layout PrePaint Paint Layerize Commit`) per second, Paint events by node |
| `trace-phase-cost.mjs <trace>` | Mean cost of each lifecycle phase per signature, layerize p50/p90/max — what a frame that changes something costs vs one that does not |
| `trace-seq.mjs <trace> [startSec] [count]` | Consecutive frames: gap, cost, layout roots and dirty counts, what painted — shows painters drifting into separate frames |
| `trace-beginframes.mjs <trace> [startSec] [count]` | Compositor BeginFrames vs main-frame requests: whether a frame asked for mid-interval ran at once or waited for the next vsync |

Reference readings (trace 2, mixer, step 8, Dashlane off) vs the POC: main busy 168 vs 385 ms/s,
tasks ≥ 8 ms 1 vs 0, audio gaps > 12 ms 28 vs 5. The POC does more work in shorter slices.

## Step 4 — what the tune writes

Offline, against sidablist's own engine (build sidablist first; `SIDABLIST` overrides the repo
root, default the worktree sibling). `CALL_MS` overrides the play-call length (default InSID3 Out's
9.975 ms).

| Script | Prints |
|---|---|
| `profile-tune.mjs <file.sid> [subtune] [seconds]` | Header, play rate, per-frame cost, writes per frame |
| `voice-events.mjs <file.sid> <fromFrame> <toFrame>` | Per voice: control/envelope changes and one-call pitch spikes — find hard restarts and drum hits around a moment |
| `write-order.mjs <file.sid> <centreSec> [halfWindowSec] [subtune]` | What ASID's one-packet-per-frame cannot carry (lost intermediate writes, 3rd control writes, control-before-data order) |
| `alloc-probe.mjs <file.sid> [frames]` | Bytes sidablist's hot path allocates per frame, layer by layer (`node --expose-gc --max-semi-space-size=512`) |

InSID3 Out's voice 3 hard restart (gate off 4 calls → test+gate 2 calls → **one** call of triangle
`$F810` → pulse) is a 10 ms event whose sound depends on lasting exactly one play call — the shape
of tune most sensitive to timing.

## Voice waves A/B (`ASID-DJ-17`)

Proves the per-deck voice-wave windows (three voices a deck, drawn by one worker) cost the playback
nothing: every reading with the waves on falls within the baseline's own run-to-run spread. Dev builds
only; none of this is a user setting.

```
djBench.waves(false|true)  // whole feature off (the baseline) or on: windows hidden, history off, feed idle, worker told to suppress; on also times the hand-off
djBench.history(on)        // only the engine's delivery history on both decks (64 entries) or off; use with waves(false)
djBench.waveReport()       // Promise: feed counters (paints, entries, dropped, poolMisses, handOffMeanMs/MaxMs) + the worker's (draws, skipped, mean/max draw ms)
```

1. **Conditions** (as the performance log requires): same display, DevTools closed, no extensions on
   the tab, a fresh page, both decks at 1.00x (`djBench.report()` `intervalMs`), both cartridges
   connected for the listening part. Say how old the page was.
2. **Baseline, then waves on.** Loop playing: `djBench.waves(false)`, `djBench.reset()`, wait ~10 s,
   `djBench.report()`. Repeat **at least three times** to find the run-to-run spread. Then the same
   with `djBench.waves(true)`, at 1x and 1.5x and with one and two decks playing, on the same loop.
   Read `spacing.onGridPct`, `spacing.collapsedPct`, `lagMs` p99, `player.lateFrames`, and the painting
   frame times (`scripts/probes/frame-timer.js`). Pass: each reading with the waves on lies within the baseline's spread.
3. **Garbage.** Record a trace with the waves off and on and read both with `trace-compare.mjs` and
   `trace-long.mjs` (GC and long tasks): the garbage rate with the waves on is no higher. This also
   confirms the pooled, transferred buffers. Open `chrome://inspect/#workers`: exactly one worker
   serves all six windows.
4. **Pops.** `send-capture.js` and `send-analysis.js` (`scripts/probes/`) over the same material with the
   waves off and on (the pop-marker run in Step 2): the count of marked pops with the waves on is no higher.
5. **The engine's own cost.** Offline: `node --expose-gc --max-semi-space-size=512 scripts/alloc-probe.mjs <file.sid>`
   prints `player tick + FakeSink` beside `... + history` and `... + drain every 2nd tick`; compare
   B/frame and ms/frame. Live: `djBench.waves(false)`, then `djBench.history(true)` against
   `djBench.history(false)`, each with `reset()`, ~10 s and `report()`.
6. **The hand-off alone.** With the waves on, after ~10 s: `await djBench.waveReport()`;
   `handOffMeanMs` and `handOffMaxMs` are the main-thread cost of one paint's drain, decode and post.
7. **Listening and look.** The operator listens (drum-heavy, arpeggio-heavy and sustained tunes) and
   judges the picture: "smooth", "no flicker". Cadence is the constant `WAVE_DRAW_INTERVAL_MS`,
   plus the glow. The build has no delay, so a picture that looks early against the sound is a
   follow-up, not a defect of this pass. Record the verdict in the operator's words in the performance
   log (Performance log and Decisions), and discharge the hand-off's standing assumption in the
   portfolio with the measured number.

These measurements are for this iteration. Do not re-run them to "disprove" anything in the Ruled
out list below; each entry there stands on its own measurement.

## Ruled out (measured — do not re-test without a new reason)

The *Voice waves A/B* measurements are not evidence against this list; do not re-run them to overturn it.

- GC (one 2.4 ms scavenge in 12 s once the per-frame store write was gone); `performance.memory`
  sampling is too noisy below ~5 MB/s — use a trace.
- CSS containment and `will-change` layering on the deck (no frame got cheaper; layers on moving
  parts made every full layerize ~2.5× dearer).
- An AudioWorklet frame clock (the audio thread bursts the same ~10.7 ms way).
- ASID packing losing writes on InSID3 Out; the tune reading `$D41B/$D41C`; PAL/NTSC correction.
- Edge's timestamped sending as the main cause (POC clean at schedule-ahead 40).
- Stamp-level collisions as the cause of the remaining pop (gone at 12/20 ms, pop stayed).

## Troubleshooting

| Issue | What to do |
|---|---|
| `djBench` undefined | Not a dev build, or the page has not built the decks yet — load a tune |
| Frame log shows alternating +30/+10 ms gaps | The pacer is re-measuring every cycle — a woken frame landing off its expected place; see `live-paint-pacer.spec.ts`'s simulated displays, add the case |
| Many frames, few painting | Something besides `tick` asks for frames (frame log's callback names), or the pacer is mis-placed |
| A trace's main thread is not found | `trace-*.mjs` take the busiest `CrRendererMain`; record the tab alone |
| Readings jump between runs | Page age, extensions, DevTools, another app's load (the operator heard pops come and go while test suites ran) — fix the bench before comparing |
| Tune scripts fail to import | Build sidablist (`pnpm build` there) or set `SIDABLIST` |

## References

- Performance log (every measurement and change):
  `C:\Users\Metal\.radorc\shared\projects\ASID-DJ-ROOT\ASID-DJ-PERFORMANCE-LOG.md`
- `scripts/probes/` — in-page probes; `scripts/*.mjs` — trace and tune scripts;
  `scripts/lib/sidablist.mjs` — the loader the tune scripts share
- Portfolio Ground Truth and Research (`ASID-DJ-ROOT`) for the protocol and the firmware side
