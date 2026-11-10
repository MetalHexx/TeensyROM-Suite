# Manual browser verification — the DJ view's SID panel vs `ASID-DJ-ROOT-WIREFRAME-SID-PANEL.html`

The SID panel (`lib-dj-sid-panel`) replaces the old mixer card in the DJ view. It is a 620px column
(`--mixer-col: 38.75rem`) between the two decks' Voice/Speed columns, and it is laid out for a
**1920 × 1080** viewport at minimum. The automated proof is in `dj-mixer-controls.cy.ts` and
`dj-mixer-responsive.cy.ts` (outside CI; run against a live dev server). This file records the
checks that need a real browser. The "Byte fidelity", "Hardware acceptance" and "Permission
auto-connect" sections below are separate records and are unchanged.

## How this was driven

`pnpm start` at `http://localhost:4200/dj-mixer` in a real Chrome tab. The automation window's
viewport cannot be set to a target CSS size, so the app was loaded into a same-origin `<iframe>` of
**1920 × 1080** CSS px, whose own `innerWidth`/`innerHeight` are that size, so the real media queries
and the live cascade apply. Every number below is `getBoundingClientRect()` or `scrollWidth` on the
live DOM. The cards' entry animation is a `scale(0.8)` transform that skews a rect read mid-flight,
so a stylesheet pinning `lib-scaling-container { transform: none }` was injected before measuring.
No API (port 10213) was running and no device was attached, so the page showed no devices.

## The panel at 1920 × 1080, bindings panel closed and open

| element | closed | open |
| --- | --- | --- |
| `lib-dj-sid-panel` (x, y, w × h) | 698, 66, 620 × 661.6 | 512, 66, 620 × 661.6 |
| `lib-synth-panel` faceplate (w × h) | 596 × 637.6 | — |
| each `lib-sid-voice-strip` (client / scroll width) | 90 / 90 | 90 / 90 |
| `.bottom-band` | 112, 739.6, 1792 × 324.4 | — |
| `lib-dj-bindings-panel` | — | 1544, 66, 360 × 998 |
| `.router-content` scroll / client height | 1030 / 1030 | 1030 / 1030 |

- Both decks' three voice strips, filter and Key sections, Panic buttons and deck labels render as
  frames A and B of the wireframe draw them: Deck A's lower row reads Filter then Key and deck B's
  Key then Filter, the bindings icon sits between the two labels, and the Camelot | Note switch
  sits between the two Panic buttons (136 × 24 at 940, 683; Panic A ends at 862 and Panic B starts at
  1154, either side of it).
- No voice strip overflows horizontally (client width equals scroll width on all six), and the panel
  keeps its 620px with the bindings panel open: the decks give way, not the panel.
- The page does not scroll (document 1080 = 1080) and the listing keeps a 324px band.
- Closing the bindings panel from its own close button returns focus to the bindings button.
- Camelot is no longer truncated: the switch is 8.5rem wide, and each cell's text fits (client 67 =
  scroll 67).
- **Narrow widths are a known limit.** The panel is laid out for 1920 × 1080 at minimum and keeps its
  fixed 620px column. Measured in the same iframe, a deck card is 474px at 1920, 314px at 1600,
  227px at 1400 and 167px at 1280, with no strip overflowing down to 1280 (strips 90-91px). At 400px
  the six strips overflow inside the panel (48px each), though the page itself never scrolls. The old
  stacked and one-device records were removed with the mixer card and not re-recorded; a breakpoint
  for narrow layouts is not decided.

## Live rings and lights

Needs no device. Serve the app (`pnpm nx run teensyrom-ui:serve`), serve a bundled `.sid` from a
local CORS-enabled server, stub the page's `/files/content` fetch to return it, and call
`DeckService.load('A', ...)` through the dev-mode Angular debug API (`ng.getInjector`).

- Deck A played: the voice-strip and filter-section style fingerprint took 3 distinct states across
  6 samples, while deck B's stayed constant.
- After pausing, deck A's fingerprint changed once and then held for 12 samples at 400ms (4.8s).
- A screenshot showed lit pulse waveforms, the Ring and Filt lights, LP lit, live rings and a Key
  readout of `5A`.

Recorded from the phase review's browser run. The ghost on a locked waveform was not separately
checked; the painter's unit tests cover the register-to-indicator mapping.

## The POC page still runs

`http://localhost:4200/dev/dj-poc`: loaded the bundled "InSID3 Out — Divertigo" tune on deck A, which
plays (frames advance and the status reads Playing). Moving the channel fader, crossfader, cutoff,
resonance, pulse-width and Key controls changes their values (Key's readout changed from `5A` to
`11A`), playback continues, and the console shows no errors — only the expected "no MIDI port
selected" warnings. The library refactor and the knob extension left the POC's behaviour alone.

## The restyled deck column: transport, voice and speed strip (P03-T02)

Browser check of the deck column rebuilt on the shared metal components (position strip and
transport, voice and speed channel strip, loops and binding plates) against
`ASID-DJ-ROOT-WIREFRAME-TRANSPORT.html`. Driven as above: the dev server's `/dj-mixer` in a
**1920 x 1080** same-origin `<iframe>`, no API and no device, with a bundled `.sid` served from a
local CORS server and the page's `/files/content` fetch stubbed to return it. Both decks were loaded
through `DeckService.load` (dev-mode `ng` debug API) and played for real; the output has no MIDI port
bound, so the engine drops its bytes. Held keys were driven with synthetic `keydown`/`keyup` events,
because a synthetic `pointerdown` throws in `setPointerCapture`.

**Frame A, the view at 1920 x 1080.** Matches: the display with status LED, title, author, elapsed
and total time and frame count; the position strip with its played fill, loop markers and white
playhead; Play (Pause while playing), Stop and the subtune pager; the Loops / Cues plate
beneath; the binding plate at the foot with its Identify and Enable MIDI. A playing deck shows the
green LED and a green line under Pause; a paused one shows the amber LED and line.

**Frame B, the transport at three widths.** The deck's transport measured 474px at 1920 with the
bindings panel closed, 404px at 1780, 364px at 1700, 314px at 1600, and 288px at 1920 with the
bindings panel open. At 404px Play and Stop shrink to icon-only buttons and the pager to `1/1`,
as the mockup's 400px frame draws them. At 288px Play and Stop share a row and the pager takes
the next, as the 300px frame draws it; nothing overflows (client width equals
scroll width) and the page does not scroll.

**Frame C, the channel strip.** Matches: V1-V3 buttons with Kill beneath; a muted voice dims and its
Kill reads Punch; a held Kill is a magenta pill; the speed display; the fader with its centre
marker; the Nudge caption over the two round pads side by side, under the fader; +50% / Home / -50%.

- **Scrubbing.** Dragging the position bar with the mouse jumped deck A from 36% to 83% and kept it
  playing. Focusing the bar and pressing the right arrow five times moved the playhead forward
  (22% to 33%), and playback continued from the new position.
- **Nudge on a playing deck.** Nudge up read 1.050x and nudge down 0.950x, in magenta, with the
  fader still at 1.000. Both held read 1.000x (still magenta); releasing one left the other's
  0.950x; releasing both returned the display to white 1.000x. Moving the fader to 1.100 mid-nudge
  with nudge up held read 1.150x, kept the fader at 1.100, and the release landed on 1.100x.
- **Empty decks.** Each reads "No tune - drop a SID here"; Play, Stop and the pager are disabled;
  the Loops / Cues plate is empty.
- **Drop highlight.** With a SID drag in flight both transports show a cyan outline and "Drop to
  load - Deck A/B" over the 474 x 151 display area; dragging over deck B's overlay marks only that
  one hot. (The drag was simulated with a `dragenter` carrying the DJ drag type: there is no device
  in this environment to list a file to pick up.)
- **Learn-mode overlays.** With mapping mode on (set on the store, because the toggle's Web MIDI
  permission prompt cannot be answered here) there are 134 overlays, 67 per deck, one on each
  control including all three voice buttons and Kill, both nudge pads, the position bar, the speed
  fader and jumps, Key, filter, and Panic, each aligned on its control. There is none for Clear.
- **The POC page.** `/dev/dj-poc` still renders its original look: the plain Position slider and
  Play/Stop row, the Voice panel with its checkboxes and Clear button, the Speed panel and the
  mixer column.

Not run here, for want of a MIDI controller: a mapped nudge note held and released, and the release
when the controller is unplugged mid-hold. The sound itself is not judged in a browser either.

### Bundle check

`pnpm nx build teensyrom-ui` on this branch against `main` (ac25dc43, the ASID-DJ-8 merge), the
initial chunks only, in bytes:

| chunk | main | this branch |
| --- | --- | --- |
| shared ui / vendor chunk | 1,354,572 | 1,394,023 |
| `main` | 419,031 | 419,031 |
| shared application chunk | 166,982 | 169,153 |
| other initial chunks and `polyfills` | 132,747 | 132,747 |
| **initial JavaScript** | **2,073,332** | **2,114,954 (+41,622)** |
| `styles` | 34,883 | 35,125 (+242) |

The styles chunk grew by the `--synth-display-*` token lines, as designed. This table is the
first measure, taken when the DJ components were still reaching the initial chunks through the
barrels: it showed the initial JavaScript 41.6 kB over `main`, which was recorded here as a failed
check. That was superseded. With the DJ-only components moved to the `@teensyrom-nx/ui/components/dj`
entry point, the check **passed**: the initial JavaScript came in 59 B under `main`. Components the
lazy route uses and the main barrel exports still land in the initial chunks (79 of the library's
components were already there on `main`); the DJ ones no longer do.

### Bench verdict (operator, real hardware)

On your C64s with a real TeensyROM, say whether:

1. Nudge beat-matches two decks by ear: hold nudge up or down on one playing deck and bring it
   back into step with the other; release lands where the fader says.
2. Scrubbing works: dragging the bar and the arrow keys move a playing tune without a glitch, and
   a drop loads a tune onto the deck it lands on.
3. The narrow transport is usable: with the bindings panel open (about 290-300px) Play, Stop
   and the pager are all easy to hit.
4. The restyled deck plays as before: voices, Kill, speed and the pad hold behave as they did.
5. A mapped nudge note held and released, and released by unplugging the controller, ends the
   nudge.

## Loops and cues

Browser check of the deck column's Loops / Cues plate and the position strip's marks lane, now fed
from the store, against `ASID-DJ-ROOT-WIREFRAME-LOOPS.html` (frame A). Driven as in the sections
above: `pnpm start`, `/dj-mixer` in a **1920 x 1080** same-origin `<iframe>` with
`lib-scaling-container { transform: none }` injected, no API and no device. A bundled `.sid`
(`InSID3_Out.sid`) was served from a local CORS server, the iframe's `fetch` was stubbed to return it
for the `/files/content` call, and `DeckService.load('A', ...)` was reached through the dev-mode
`ng.getComponent` handle on the deck column (storage type `'SD'`). The tune loaded and played for
real; the output has no MIDI port bound. Controls were pressed with DOM clicks on the buttons found
by their accessible names; the nudge strip was driven with `input` then `change` events on its range.

**Live behaviour, deck A.** An empty deck shows a disabled Add and Stop, an empty selected row
("nothing selected" for a reader, an empty display) and "Load a tune to add loops". With the tune
playing: Add placed a cue at the playhead (then a second, and a third) and selected each; Set End on
Item 2 made it a 1.5 s loop; selecting Item 2 and pressing its trigger started it (tile and row lit
"running", the tile's lap bar advancing, `loopLapPercent` 64% mid-lap, the row reading
`00:08.5-00:10.0`); Stop loop released it (all tiles idle, Stop disabled again). The strip above the
transport showed three marks (two cue ticks and the loop bracket, the selected one highlighted).
Dragging the End nudge strip showed `+12 fr` while held (the pin) and committing moved the end to
`00:10.2` with the pin cleared. Deck B stayed empty and its plate unchanged. The console showed no
errors from the plate. The document did not scroll (1080 = 1080).

**Against frame A (1920 x 1080), measured on both pages.** Both are 474px wide. The first pass found
the plate's keys drawn at the shared key's size rather than the mockup's compact sizes, which left
the selected-row display 162px wide against the mockup's 197px and truncated "Item N"; the boundary
rows were 26px tall with 32px snap keys against the mockup's 22px squares. Fixed in P02's
components, as sizing custom properties on the shared key (`--synth-key-*`, defaults unchanged) set
by the row, the boundary, the tile and the plate header:

| element | mockup | view, after |
| --- | --- | --- |
| selected row (w x h) | 444.7 x 70.3 | 440.4 x 70.6 |
| trigger / Set End / Clear End / delete keys (w) | 32 / 68.8 / 79.5 / 26 | 32 / 69 / 79.7 / 26 |
| row display (w x h) | 197.2 x 26 | 192.1 x 26 |
| boundary snap keys / nudge strip (w) | 22 / 72.7 | 22 / 69.6 |
| tile trigger | 30 x 30 | 30 x 30 |
| Add / Stop keys (w) | 58.9 / 65.5 | 59.3 / 65.6 |
| plate (w x h) | 474 x 344 | 474 x 334 |

What remains is the synth panel's padding, which leaves the plate's content 4px narrower than the
mockup's (this moves the display, nudge strip and tiles by a few px), and the plate's height, which
here is whatever the deck column's grid slot gives (334 against the mockup's 344). The fixed row, the
two-column tile grid and the marks lane read as frame A draws them.

**Not checked in the view.** The queued and not-ready tile and row states: no readiness delay or
queued trigger was produced against the stubbed tune, and Deck B was not given a tune. The queued
states are checked in Storybook below.

**Against frame B (Storybook).** `pnpm nx build-storybook ui-components`, the build served statically
and opened at `iframe.html?id=...`, the mockup page served beside it and measured in the same
browser. The three steps of frame B ("one deck through a queued jump") each have a story,
`QueuedJumpKnobMovedOn`, `QueuedJumpLapEnded` and `QueuedJumpSelectionFollows`, on the mockup's six
items (loop, loop, cue, loop, loop, cue; 7.8 s, 13.4 s, CUE, 8.0 s, 8.0 s, CUE):

| step | mockup | story |
| --- | --- | --- |
| 1 · Item 4 queued, knob moved on to Item 5 | Item 2 running with its lap bar, Item 4's light blinking, outline on Item 5, selected row on Item 5 and idle | the same: Item 2 running (53%), Item 4's light blinking (`state-blink` against the mockup's `blink`), outline and row on Item 5, row trigger unlit |
| 2 · lap ends, Item 4 runs, selection stays on Item 5 | Item 4 running with its lap bar, outline and row still on Item 5 | the same |
| 3 · knob left alone, selection follows to Item 4 | Item 4 running and outlined, row on Item 4 with its trigger lit | the same |

Measured on step 1 in both: the tile is 219.4 x 40 in the mockup and 215.4 x 40 in the story (the
same 4 px of synth-panel padding the frame A table notes); the plate is 474 wide in both. The mockup
plate is 164.9 high because it sizes to its content, where the story's wrapper gives it a fixed 360.
The running light is a theme token in the app (`rgb(134,198,145)`, queued `rgb(245,215,110)`) and a
mockup literal there (`rgb(111,220,140)`, `rgb(245,226,158)`), the same hue family. `EmptyNoTune`,
`FewMarkers`, `ManyMarkers` and `Narrow` were opened too and stand for frame A's empty, populated,
scrolling and narrow states: the empty plate shows disabled keys and "Load a tune to add loops", the
populated one a running and a queued tile, the scrolling one keeps the selected row fixed above the
tiles, and the narrow one stacks the Start and End rows. Frame A's own plate is the measured table
above.

**Automated.** `pnpm nx test dj-mixer`, `pnpm nx lint dj-mixer`, `pnpm nx run-many -t typecheck -p
application dj-mixer`, `pnpm nx build teensyrom-ui` and the five DJ end-to-end specs
(`dj-mixer-*.cy.ts`, 43 tests, run against `serve-static` with `--excludeTaskDependencies` because
Cypress gave up waiting for the production build the dependent task starts) pass.

### Audition on every edit

Driven as above against the running dev server: `/dj-mixer` in a 1920 x 1080 same-origin iframe,
`InSID3_Out.sid` (161 s at 100 play calls a second, so a second is 100 frames) from a local CORS
server with the iframe's `fetch` stubbed, deck A loaded through `DeckService.load`. The nudge strips
were released with `input` then `change` events and the snap keys pressed with DOM clicks, with every
`seekToFrame` logged against the time of the release. The MIDI snap path was not driven (no
controller here); it reaches the same `snapMarker` and is covered by the specs.

Deck A playing, a loop at 2394-3481 running: a start nudge of +30 held the old bounds for about 120
ms, then made one seek to 2424; start snaps next and previous sought to 2427 and 2311 after 125 and
94 ms; an end nudge of -50 sought at once to 3231 (the end less two seconds), and end snaps to
3259 and 3263 likewise. The same on the loop after Stop loop (idle) re-engaged it each time (start
nudge +20 to 2414 after about 100 ms, end nudge +40 to 3321, start snap to 2463). With the deck paused
a nudge resumed playback and then sought (end +10 to 3291, start +50 to 2444 on the running loop); with
it stopped, a start snap restarted it from the top and then landed at 2311. An end snap key that was
disabled (no moment in reach) was not pressed.

Deep marker, on a fresh page with only the one cue, at frame 13108 (131 s): start nudges to 13138,
13068 and 13168 landed 438, 579 and 576 ms after the release, against 92-162 ms for marks at 10-154
s that had another prepared mark nearer. About half a second is noticeable. A start edit withdraws
the old start's prepared image and a live-captured marker's image is never a chain source, so the new
start is replayed from the nearest prepared mark. Follow-up for the engine's prepared builds;
`sidablist` is unchanged here.

### Bundle check (loops and cues)

`pnpm nx build teensyrom-ui` on this branch against `main` (3899450b, after ASID-DJ-9 and
CLI-PARITY-9), the initial chunks only, in bytes (both built with the same `node_modules`):

| chunk | main | this branch |
| --- | --- | --- |
| shared ui / vendor chunk | 1,356,281 | 1,356,272 (-9) |
| `main` | 419,772 | 419,823 (+51) |
| shared application chunk | 170,554 | 186,821 (+16,267) |
| other initial chunks and `polyfills` | 132,747 | 133,096 (+349) |
| **initial JavaScript** | **2,079,354** | **2,096,012 (+16,658)** |
| `styles` | 35,125 | 35,125 (0) |

The new components add 0 B: they live in `dj.ts` and the ui chunk did not grow. The 16.3 kB is the
application layer: the loops state, `DeckLoops`, the loops selectors, the marker commands on
`DeckService` and the loop controls with their style layer, which the lazy DJ route's store pulls
into the shared application chunk (the same effect the ASID-DJ-8 table describes). The initial
JavaScript is over the 2.00 MB budget by 131 kB here against 114 kB on `main`; that warning is
already on `main` and `project.json`'s budgets are unchanged. The figures are from a build at the
final commit of the phase corrective, after the loop controls were mapped.

### Bench checklist (operator, real hardware)

- [ ] Loops and cues are placed, triggered and left on both decks, from the mouse and from the
  controller.
- [ ] A loop is added and its end set mid-set from the controller, then corrected with snap.
- [ ] A long tune reloaded has its loops ready within about a second.
- [ ] A running loop dialed in by slider, mouse snap and controller snap: each edit is heard at
  once, a start from the start of the loop and an end two seconds before the wrap.
- [ ] A start edit on a marker deep in a long tune lands without a noticeable wait.
- [ ] The speed controls work inside a loop, and the speed is kept on leaving it.
- [ ] The other deck's timing is unaffected while one deck loads or rebuilds.

## Per-loop settings and play now

Browser check of the play-now and GBL keys, the cue's Set End slot, the tiles' play-now keys and
dots, and the settings sign on the SID panel and the channel strip, against
`ASID-DJ-ROOT-WIREFRAME-LOOP-SETTINGS.html` (frames A to D). Driven as in "Loops and cues": `pnpm
start`, `/dj-mixer` in a **1920 x 1080** same-origin `<iframe>` with `lib-scaling-container {
transform: none }` injected, no API and no device. `InSID3_Out.sid` came from a local CORS server
(which also served the mockup page over `http://`, measured in the same browser), the iframe's
`fetch` was stubbed for `/files/content`, and `DeckService.load('A', ...)` was reached through
`ng.getComponent` on the deck column. Keys were pressed with DOM clicks on their accessible names;
the Key knob was turned with an `input` event on its range.

**Live behaviour, deck A.** Two cues were added, Set End on Item 2 made it a loop, and GBL on Item 2
was unlatched (its `aria-pressed` went false and its tile grew the dot). Then:

| step | Key readout | sign (SID panel and strip) | tiles |
| --- | --- | --- | --- |
| tune playing, nothing in play | `5A` | Main | Item 2 own dot |
| Key turned +3 on the main track | `2A` | Main | unchanged |
| play key on Item 2 (own settings) | `5A` | ITEM 2, lit | Item 2 running |
| play-now on Item 1 (shares) | `2A` | Main | all idle |
| play-now on Item 2 | `5A` | ITEM 2, lit | Item 2 running |
| play-now on Item 1, then the play key on Item 2 | `2A`, then `5A` | Main, then ITEM 2, lit | follows |
| Stop loop, then Stop | `2A` | Main | idle, deck stopped |

The two signs agreed at every step, and Deck B's stayed Main. The row's GBL read unlatched for Item 2
and latched for Item 1. The console showed no errors from the plate.

**Learn overlays (mapping mode set on the store, as in the transport section).**

| selection | `loop-play-now` / `loop-global` | `loop-set-end` | `loop-end-snap-*` |
| --- | --- | --- | --- |
| a loop (bindings closed and open) | one overlay each, centred on its key | none | on the End boundary's snap keys, as before |
| a cue (bindings closed and open) | one overlay each, centred on its key | one, over the End slot's Set End key | none (the slot has no snap keys) |

Each overlay sat 3 px outside its key on every side, as the existing ones do (play-now 34 x 32
around 28 x 26 before the sizing fix below, Set End 169 x 28 around 163.5 x 22).

**Against frames A to D (1920 x 1080), measured on both pages.** The first pass found the row's
keys narrower than the mockup's (play-now 28.1 wide against 32, GBL 32.2 against 44.2, Clear End
28.1 against 26) and, with the bindings panel open, the tiles squeezed to 122 px, which cut each
name down to its first letter. Fixed in P03-T01's components: the play-now key takes the trigger's
32 px, Clear End the delete key's 26 px and GBL a 44 px minimum, and the tile grid takes one tile per
line below 24rem. After:

| element | mockup | view |
| --- | --- | --- |
| selected row (w x h) | 443.9 x 71.1 | 439.9 x 71.1 |
| row keys, left to right (w) | 32 / 32 / display 235.6 / 44.2 / 26 / 26 | 32 / 32 / display 231.7 / 44 / 26 / 26 |
| tile (w x h), trigger, play-now | 218.9 x 40, 30 x 30, 26 x 30 | 214.9 x 40, 30 x 30, 26 x 30 |
| tile's own-settings dot | 6 x 6 | 6 x 6 |
| cue's Set End key (w x h) | 165.9 x 22 | 163.5 x 22 |
| sign on the SID panel, Main / Item 2 (w x h) | 50.2 x 18 / 61.3 x 18 | 50.2 x 18 / 61.2 x 18 |
| gap from the deck label to its sign | 8 | 8 |
| sign on the channel strip, full width of V1 | 61.7 (V1 61.7) | 69.9 (V1 69.9) |

The 4 px in the row, display and tile is the synth panel's padding, as the Loops and cues table
records. The channel strip's column is 8 px wider than the mockup's, so its V1 and sign are as well;
both fill the strip. The label sits first and the sign after it on both decks, as the mockup draws
them. The mockup's GBL lamp is drawn as the key's icon: a ringed dot when lit, an empty ring when
unlit, so the two states differ in shape as well as in cyan text, border and glow (checked in
Storybook: `dj-loop-selected-row--loop-sharing-global`, key 44 x 26). With nothing selected GBL is
a plain disabled key with no pressed state. The span text is fully readable at 474 px and when narrow.

**Narrow width (bindings panel open).** The plate is 288 px. The top line wraps its keys above the
display, which takes a line of its own: its text is whole (display scroll width equals client width,
the span `00:03.9-00:04.4` at 91 of 91 px). The two tiles take a line each, 250 px wide, with no
name, length or dot clipped. The page does not scroll (1080 = 1080). The same plate with the same
selection before the grid change had tiles 122 px wide and clipped names.

**Storybook** (`pnpm nx run ui-components:storybook`, port 4400), for states the live run did not
produce: `dj-loops-cues-plate--mixed-settings` (own dots on two of four tiles, row keys as in the
table), `--queued-jump-knob-moved-on` (queued tile, outline and row on another tile), `--narrow`
(300 px, one tile per line, nothing clipped); `dj-loop-selected-row--cue-set-end-slot` (Set End key
180.5 x 22 in the 474 px row, no snap keys); `dj-loop-tile--not-ready` (both keys present and
enabled); `dj-deck-settings-sign--marker` (lit, 61.2 x 18, named "Settings in play deck A: Item 2").

**Automated.** `pnpm nx test dj-mixer`, `pnpm nx lint dj-mixer`, `pnpm nx test ui-components`,
`pnpm nx run-many -t typecheck -p application dj-mixer`, `pnpm nx build teensyrom-ui` and the five DJ
end-to-end specs (`dj-mixer-*.cy.ts`, 43 tests, run against a `serve-static` started by hand, with
`--excludeTaskDependencies`) pass. No spec selected the row's keys, so none changed.

### Bundle check (per-loop settings)

`pnpm nx build teensyrom-ui` on this branch against `main` (c25d7588, after ASID-DJ-10), the initial
chunks only, in bytes (both built with the same `node_modules`):

| chunk | main | this branch |
| --- | --- | --- |
| shared ui / vendor chunk | 1,358,451 | 1,358,451 (0) |
| `main` | 419,823 | 419,823 (0) |
| shared application chunk | 187,929 | 195,774 (+7,845) |
| other initial chunks and `polyfills` | 133,334 | 133,334 (0) |
| **initial JavaScript** | **2,099,537** | **2,107,382 (+7,845)** |
| `styles` | 35,125 | 35,125 (0) |

The new components add 0 B: they live in `dj.ts` and the ui chunk did not grow. The 7.8 kB is the
application layer, which the lazy DJ route's store pulls into the shared application chunk: the
per-marker settings state, the settings landing with a jump, play-now, the GBL toggle and their
mapped controls. The initial JavaScript is over the 2.00 MB budget by 142.51 kB here against 134.66
kB on `main`; that warning is already on `main` and `project.json`'s budgets are unchanged.

### Bench checklist (operator, real hardware, per-loop settings)

- [ ] A marker's settings land with the jump into it with no audible glitch or timing slip, from a
  queued trigger and from play-now, in both directions between a marker with its own settings and
  one that shares.
- [ ] Rapid repeated play-now presses hold up over a long run.
- [ ] The other deck's timing is unaffected while one deck jumps with settings.
- [ ] GBL toggled mid-set on the running loop A/Bs between its own settings and the main track's.
- [ ] Play-now and GBL are learned and played from the controller.

## Sets

Frame-by-frame check of the hideable browser, the set card's peek and the set card itself in the DJ
view against the mockup, the bundle check, and the operator's bench list.

**How it was driven.** Two pages, side by side, at **1920 x 1080**. The mockup
(`ASID-DJ-ROOT-WIREFRAME-SETS.html`) was served statically and measured in Chrome with
`getBoundingClientRect()`; its frames are drawn at 0.8 scale, so its numbers are divided by 0.8 and
taken relative to each frame's own top-left. The view was driven with a throwaway Cypress spec in
Electron (deleted after the run, not committed) against `pnpm nx run teensyrom-ui:serve` on port
4210, with `lib-scaling-container, lib-scaling-compact-card { transform: none !important }`
injected and the library interceptors serving a saved set "Friday" (three rows) and a second set
"Saturday", one device, and `Still_Time.sid` in the listing. Every view number is
`getBoundingClientRect()` on the live DOM. `moveSelection` was reached through
`ng.getComponent(document.querySelector('lib-dj-mixer-view')).djSets`. API port 10213 was not used:
another checkout's API was listening there, so the DJ library was never written to a real host.

**Frames.**

| frame | what was checked                                                                                                     | how                                                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A     | full view: tree, listing, set card, the browser button lit, each deck's set row, header button order                 | measured on both pages, screenshot                                                                                               |
| B     | browser hidden: decks, speed strips and SID panel unchanged, freed height empty                                      | measured on both pages, screenshot                                                                                               |
| C     | peek: slides up over the bottom, follows Select, leaves after the last, decks unmoved, deck controls clickable after | measured on both pages, sampled every 150 ms, screenshot; the committed case in `dj-mixer-sets.cy.ts`                            |
| D     | set card: a drag in with a pending row then the analysed row, rename, reorder                                        | drag in measured and screenshotted; rename and reorder in `dj-mixer-sets.cy.ts`                                                  |
| E     | load a saved set from the tree, the delete confirm                                                                   | confirm measured and screenshotted; loading in `dj-mixer-sets.cy.ts`                                                             |
| F     | naming loops and cues in place, the name on the tile and the settings sign                                           | driven: Still Time loaded on Deck A, a cue added and renamed in place, GBL turned off and the cue played; texts read, screenshot |

**Frames A, B, C: the build against the mockup** (px, 1920 x 1080 coordinates).

| element                           | mockup                                                   | build                                                                                |
| --------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| grid                              | 112 66 / 1792 x 998                                      | 112 66 / 1792 x 998 (same)                                                           |
| deck column A / B                 | 112 and 1430, 474 wide, 614.5 high                       | transport 129 and 1447, 440 x 163.8                                                  |
| SID panel                         | 698 66 / 620 x 614.5                                     | 698 66 / 620 x 555.8                                                                 |
| band (tree + listing + set card)  | 112 692.5 / 1792 x 371.5, ends at 1064                   | 112 633.8 / 1792 x 430.2, ends at 1064                                               |
| tree / listing / set card (width) | 212 / 876 / 680, 12 apart                                | 212 / 778 / 778, 12 apart (the even split; see the widths table below)               |
| header buttons: bindings, browser | 974 and 1010, 32 x 32, 4 apart, wrapper 68 x 32          | 974 and 1010, 32 x 32, 4 apart, wrapper 68 x 32 (same)                               |
| browser button                    | `Hide the browser`, engaged (lit)                        | `Hide the browser`, lit, `aria-expanded` true; `Show the browser`, false once hidden |
| B (hidden)                        | decks, speed strips and SID panel as in A; band absent   | same as A to the pixel; band removed, the freed height empty                         |
| C (peek up)                       | 112 / 1792 x 316                                         | 112 748 / 1792 x 316 (bottom 1064, the grid's bottom)                                |
| set header, left to right         | glyph, name (flex), Saved lamp, count, delete 32, new 32 | name (flex), Saved lamp, count, delete 32, New key 57.2                              |
| deck set rows                     | in each deck stack                                       | 129 212.8 and 1447 212.8, 440 x 26                                                   |

The deck, speed strip, SID panel and grid rects are identical to the pixel in A, B and C, and again
after Show. The tree is 212 (short names) and the listing and the set card 778 each, no longer the
mockup's 876 and 680. The freed band height stays empty.

**The band's widths and the listing's fold.** Measured with `getBoundingClientRect()` in a same-origin
frame of exactly the stated viewport, loaded in a tab against the running `pnpm start` on port 4200
and its API, with `lib-scaling-container, lib-scaling-compact-card { transform: none !important }`
injected. The deck, speed strip and SID panel rects were read before and after each fold and unfold
and compared: identical in every state. The run's rendering was slow (a fold took a few seconds to
settle), so each state was read after waiting it out, not mid-transition.

| viewport    | state                              | tree         | listing | set card | tree scroller (scroll / client)     |
| ----------- | ---------------------------------- | ------------ | ------- | -------- | ----------------------------------- |
| 1920 x 1080 | open, short names                  | 212          | 778     | 778      | 179 / 179                           |
| 1920 x 1080 | folded                             | 212          | 44      | 1512     | 179 / 179                           |
| 1920 x 1080 | unfolded again                     | 212          | 778     | 778      | 179 / 179                           |
| 1920 x 1080 | a 64-character set name (see note) | 360 (cap)    | 704     | 704      | 327 / 327                           |
| 1366 x 768  | open, short names                  | 212          | 504.9   | 504.9    | 187 / 187                           |
| 1366 x 768  | folded                             | 212          | 44      | 965.8    | 187 / 187                           |
| 1366 x 768  | unfolded again                     | 212          | 504.9   | 504.9    | 187 / 187                           |
| 1366 x 768  | a 64-character set name (see note) | 360 (cap)    | 430.9   | 430.9    | 335 / 335                           |
| 400 x 800   | stacked, `listingFolded` true      | 358.5 (full) | 358.5   | 358.5    | no handle, not inert, listing shown |

At 1920 the widths are (1792 - 212 - 24) / 2 = 778 and, folded, 1792 - 212 - 44 - 24 = 1512; at 1366
the gap is 8 (below desktop), so 504.9 and 965.8. The handle's button is 32 x 32, 6 px from the card's
right edge and 8 px from its top, open (1920: 1076, 640.2 in a card ending at 1114) and folded (342 in
a card from 336 to 380). Unfolding returned the same directory and the same scroll position (200 px)
and the same rendered rows. A folded listing is `inert` and `visibility: hidden`; the handle's button
is the only stop. With mapping mode on (the bindings panel open, which narrows the grid) the Select
overlay followed its key through a fold and an unfold: key at x 969, 413 wide open and overlay at
966, 419 wide (a 3 px outset); folded, key at 421, 961 wide and overlay at 418, 967; back to the open
numbers after the unfold. Load A and Load B did not move in that layout (the set card's right edge is
fixed), so they were not a test of the re-measure, which the view spec pins.

*Note, the long name.* The live API holds no 64-character set, so that row's text was lengthened
in the DOM and the widths read from the live layout; the committed case in `dj-mixer-sets.cy.ts`
serves a real 64-character set and checks the 360 width, the ellipsis (the text's `scrollWidth`
exceeds its `clientWidth`, `title` the full name) and the tree's overflow.

**Frame E.** Delete asks inline: the confirm row measures 1236 679.8 / 656 x 36, directly under the
header, with Cancel focused. Cancel sends nothing; Delete sends the `DELETE` (`dj-mixer-sets.cy.ts`).

**Frame F.** With a cue added and renamed to "Drop", the selected row shows "Drop" with its CUE tag
and time, the tile reads "Drop CUE" (an unnamed marker keeps "Item N"), and with GBL off and the cue
played the settings sign over Deck A reads "Drop" (`aria-label` "Settings in play deck A: Drop"),
Deck B's "Main". The mockup's frame F is a close-up of one plate at a wider scale (592.5 wide
against the deck column's 440), so its tile and row sizes were not compared, only what they show.

**Peek timing.** In an unloaded view the peek was up 600 ms after a press (112 748 / 1792 x 316) and
gone about 1.9 s after the last one; a second press while up restarted the wait. After it left,
`elementFromPoint(300, 1000)`, a point it had covered, was `.mixer-grid`, and Deck A's Panic took a
click. With a tune playing on Deck A the same press, sampled every 150 ms, showed the card held at
its first 26 px for about 1.1 s and then at 316 px until about 3 s: the slide started late while the
1.5 s timer ran as usual, and the page's own 150 ms timer kept its pace. That reads as frame delivery
in this machine's software-rendered Electron with a tune playing, not the view's logic; it is on the
bench list for real hardware. `dj-mixer-sets.cy.ts` now commits the peek case (it needs the dev
`serve` for Angular's debug API and skips itself against a production build).

**Deviations from the mockup, and why.**

- **The even split.** The listing and the set card share what the tree leaves equally (778 each at
  1920) where the mockup draws 876 and 680, and below desktop the set card no longer holds 680 as its
  basis. The operator asked for it after bench testing.
- **A tree as wide as its widest row.** It is 212 at the least and 360 at the most, where the mockup
  and requirement R5 have it narrower than the old tree and fixed; a long set name is cut with an
  ellipsis at the cap (its full name in `title`) rather than widening it further, and it never
  scrolls sideways. The storage rows are block-level so a device's SD and USB rows do not sit side by
  side and set the width. The operator's request after bench testing.
- **The folding listing.** The file listing folds into a 44 px strip from a handle in its top-right
  corner, which the mockup frames A to C show but the requirements do not ask for; the set card takes
  the room. Choosing a storage unfolds it, choosing a set does not, and below the phone breakpoint
  there is no handle and nothing folds. Also the operator's request after bench testing.
- **No light on the loaded set (supersedes R5).** R5 asks for a light on the loaded set in the tree.
  The Sets branch shows none: the loaded set is the highlighted row (`aria-selected="true"`), which
  the dot only repeated. The operator dropped the clause after bench testing. The save lamp in the
  set header is unchanged.
- **A chevron and "Files" on the listing's fold (supersedes Amendment 01).** The amendment and its
  wireframe draw an X in the open listing's corner and the words "File listing" on the folded strip.
  The handle is a left-pointing chevron open and a right-pointing one folded, and the strip reads
  "Files", centred on the strip both ways with the chevron kept at the top. The accessible names
  ("Collapse the file listing", "Expand the file listing") are unchanged. The operator's request
  after bench testing.
- **Band height 430.2 against 371.5.** The grid's top row is sized by the decks' and the SID panel's
  real content (555.8) and the band takes what remains; the mockup draws that row at 614.5. That row
  is not this phase's to change; the band's width, its gaps and its bottom edge match.
- **No glyph before the set name.** The mockup puts a queue glyph before the name; the card shows the
  name directly, as `lib-set-header` was built and specced.
- **The New key is labelled.** It reads "New" (57.2 wide) beside the 32 px delete key, so it reads as a
  key like Load A and Load B; the mockup's is an icon. Its accessible name is "New set" either way.
- **Peek surface and offset.** The peek is a card on the view's own tokens (`--synth-face`, a
  `rgba(var(--color-highlight-rgb), 0.45)` border, a `0 -10px 24px` shadow); the mockup's is
  `rgba(20,16,22,.96)` with a `rgba(0,247,255,.3)` ring. It sits at the grid's bottom (`bottom: 0`)
  where the mockup's is 16 px up in its own container, and spans the grid's width (1792) as the
  mockup's does.
- **Browser button glyph.** `dock_to_bottom`, Material Symbols' window with a bottom panel; the
  mockup draws its own outline glyph. The button order (Bindings, then Browser), the 4 px gap and the
  lamp before the count were changed to match the mockup.
- **"Most recently used" is read as most recently edited.** The tree orders the sets by their
  `updated` stamp, which a rename, add, move, remove or row edit moves. Opening a set and playing from
  it without an edit does not, because a set carries only `created` and `updated` and has no
  last-used stamp.
- **"Unavailable" shows after a load is tried.** A row is marked unavailable when loading it finds its
  bytes uncached and its source device absent (and when its analysis fails); the load reports why.
  A row is not checked against the connected devices when a set is opened, so one that cannot load
  looks like any other until a Load or previous/next is attempted.

**Known limitation: the peek case in CI.** The peek's end-to-end case turns the Select knob through
Angular's dev-mode debug API, which a production build does not have. It runs against `nx run
teensyrom-ui:serve` and skips itself against the static build the CI configuration serves; the view
spec covers the logic there.

**Known limitation: save state while the browser is hidden.** The Saved lamp and the card's live region
live in the set card, which is not in the DOM while the browser is hidden and no peek is up. A save
that newly fails then raises the peek (so the Not saved lamp shows for a moment) and is announced by a
live region the view keeps ("The set was not saved"); the lamp does not stay lit afterwards, so a DJ
who wants to see it again shows the browser. A refused or failed load still shows on the deck's own
display.

**Mapping mode.** The Set group's overlays follow the band: the view hands the overlay layer new
targets when the band's slide finishes, so it measures again and Select, Load A and Load B regain
their overlays after the browser is shown with mapping mode on. This is pinned in the view spec; it
was not driven live (no MIDI is granted in this run).

**Storybook.** No new component, so no new story. `pnpm nx run ui-components:build-storybook`
passes.

**Automated.** `pnpm nx test dj-mixer` (11 files, 249 specs run green; locally the `nx` process does
not exit after reporting, so it was run under a timeout), `pnpm nx lint dj-mixer`, `tsc` on the
library's `tsconfig.lib.json`, `eslint` on the e2e project (no errors in the new files), `pnpm nx
build teensyrom-ui`, `pnpm nx run ui-components:build-storybook`, and the six DJ specs against a
`serve` on port 4210 (`dj-mixer-sets.cy.ts` 10 tests, the five earlier specs 43; 53 passing).
`dj-mixer-sets.cy.ts` covers the saved set in the card, rename (`PUT` with the new name), Alt+ArrowDown
on a handle (`PUT` with the new order), the tree listing the sets and loading another with its
own `GET`, delete (Cancel sends nothing, Delete sends `DELETE` then a `PUT` of a fresh "Set N"), the
New key, hiding and showing the browser with the deck, speed strip and SID panel rects unchanged, the peek on a Select turn (dev `serve` only), and
a SID dragged from the listing into the card (pending row, then the titled row, then the `PUT`).

### Bundle check (sets)

`pnpm nx build teensyrom-ui` on this branch against `main` (615a260b), the initial chunks only, as
printed by the build:

| chunk                                | main        | this branch        |
| ------------------------------------ | ----------- | ------------------ |
| shared ui / vendor chunk             | 1.36 MB     | 1.36 MB (same)     |
| `main`                               | 420.34 kB   | 431.58 kB (+11.24) |
| shared application chunk             | 195.83 kB   | 223.48 kB (+27.65) |
| other initial chunks and `polyfills` | 133.34 kB   | 129.63 kB (-3.71)  |
| `styles`                             | 35.13 kB    | 35.13 kB (0)       |
| **initial total**                    | **2.14 MB** | **2.18 MB**        |

The initial total is over the 2.00 MB budget by 143.08 kB on `main` and 184.77 kB on this branch
(+41.69 kB). This branch carries the whole of ASID-DJ-12 so far (the sets model, the application's
current set and the set components), not only this task, so the delta is the project's, not this
task's alone. That warning is already on `main`, and `project.json`'s budgets are unchanged.

### Bench checklist (operator, real hardware, sets)

- [ ] A set prepared, with the speeds pre-beatmatched, loops and cues named and settings per
      subtune, then the page refreshed and the set found as it was left.
- [ ] The browser cache cleared: the tunes and their settings come back, re-fetched from the device.
- [ ] Select, Load A, Load B, previous and next work from the screen and from a controller.
- [ ] One row loaded on both decks for beat juggling.
- [ ] The peek appears on Select while the browser is hidden, follows it, and leaves after the last.
- [ ] Hiding and showing the browser stretches or moves nothing, and every deck control still takes
      clicks after the peek has left.
- [ ] Naming loops in place shows the names on the tiles and the sign on the bench.
- [ ] The peek rises promptly with a tune playing on a deck (it started late in the software-rendered run).
- [ ] A failed save while the browser is hidden raises the peek and is announced.
- [ ] No audible glitch or timing slip from any load, restore or save.
- [ ] Fold and unfold the listing on a large real directory and find the scroll position where it
      was left, with the same rows and selection.

## Byte fidelity (P03-T02)

Not run. This task (`P03-T02`, wiring the drag/drop-to-alert path) requires a real TeensyROM
cartridge attached over serial to retrieve an actual `.sid` file's bytes and produce a real
SHA-256 in the alert. No cartridge was attached in this execution environment, so the drop →
retrieve → alert path, the byte count, and the hash were never exercised end to end here — this
check, and the companion real-browser check for the drag chip showing the correct row's name
(called out in the task as not skippable), are left for an operator with a device attached. No
hash is recorded here; none was fabricated.

To perform this check once a cartridge is available: `pnpm nx serve teensyrom-ui`, drag a known
`.sid` file from the DJ mixer's listing onto a deck's transport, copy the hash out of the resulting
alert, then hash the same file on the desktop (`Get-FileHash -Algorithm SHA256 <file>` on Windows,
or `sha256sum <file>` on macOS/Linux) and confirm the two hex strings match.

## Hardware acceptance (P04-T02)

Not run. This task wires the DJ Mixer's deck columns to `DeckService`/`DjStore` — the load,
transport, and MIDI binding path — which the automated Cypress specs exercise against fixture
devices only (`dj-mixer-decks.cy.ts`, `dj-mixer-responsive.cy.ts`). The checklist below requires a
real TeensyROM cartridge connected over serial and was not exercised end to end in this execution
environment; no result is recorded here, only what an operator with a device attached still needs
to confirm, per the task's own acceptance criteria:

- `pnpm nx serve teensyrom-ui`, connect a device, and drag a `.sid` file from the listing onto
  deck A: the transport's status LED shows **Analyzing…** and then **Playing** — or, on a failed
  read, **failed** with a reason on the LED and no DJ-raised alert (a device-read failure still
  carries the `-3` file service's own alert; that alert is expected and accepted, not a DJ Mixer
  regression).
- Dragging the same file onto deck A again shows no new network request in DevTools' Network tab
  and goes straight to **Playing**, skipping both the Loading and Analyzing phases — the tune is
  already resolved from the prior drop, so nothing new is fetched or scanned.
- After a page refresh, deck A's Output port select comes back either bound to its prior selection
  or showing the "last saw" placeholder for a port not currently present — never reset to the
  unbound placeholder while a binding is on record.
- With deck A already bound to a MIDI output port, that same port appears disabled and marked
  "taken by Deck A" in deck B's own binding card select.

## Permission auto-connect on reload (P05-T04)

Not run. This task makes `DeckBindings.hydrate` query the origin's standing Web MIDI permission
and request access on its own when already granted, so a reload comes up bound with no click, and
hides each deck's Enable MIDI button while access is granted. Cypress cannot carry a real,
persisted Web MIDI permission grant across a page reload (`dj-mixer-decks.cy.ts` runs with no
grant, by design, and asserts the button is present in that state), so the granted-origin path
needs a real browser to confirm:

- `pnpm nx serve teensyrom-ui`, open `/dj-mixer`, click a deck's Enable MIDI button and grant the
  browser's SysEx permission prompt. Both decks' Enable MIDI buttons disappear once granted.
- Reload the page. Both decks come up with their prior selection bound (or the "last saw"
  placeholder for a port not currently present) with no click — Enable MIDI stays hidden on the
  granted origin.
- In the browser's site settings, revoke the MIDI permission for the origin, then reload. Enable
  MIDI is showing again on both decks, and no alert was raised for a merely-not-yet-granted
  origin.

## Action and Trigger in the bindings panel (P05-T03)

Bench check for an operator with a MIDI controller. Open the bindings panel, turn on mapping mode and
map keys as below; expand a row to see its Action and Trigger choices, and read the collapsed chip
(for example `Turn off · Note Off`).

1. Map a note to Voice 1 mute and set it to Toggle with Trigger Note Off. Hold the note: nothing
   happens. Release it: the mute flips.
2. Map two keys to the same mute, one set to Turn on and one to Turn off, both on Note On. Each only
   does its own job: the first never unmutes, the second never mutes.
3. Map a note to a value control (Key or Speed) as Step and set Trigger Note Off. Pressing does
   nothing; releasing steps the value. The Amount field is shown for it.
4. Re-learn a mapping that has Turn off and Note Off set: after the new key is chosen, the row still
   shows the same Action and Trigger.

## Key match light (ASID-DJ-13)

Not run. The light sits in the SID panel's lower row between the two Key sections and shows how well
the two decks' keys, each as its Key knob has turned it, fit together. The automated checks cover
the label and the centring; what an operator still has to see is the colour. No hardware timing is
involved, so a cartridge is only needed to load tunes.

1. Load a tune in a minor key on one deck and a tune in a major key on the other. Turn a Key knob
   until A minor reads against C (for example `8A` against `8B` in Camelot). The light is a steady
   full green.
2. Keep turning the knob one step at a time and watch the light pass through green, amber and red.
   Tell the three apart at a glance, from arm's length, without reading the label.
3. Load a tune with no clear key on either deck. The light goes dark.
4. Switch the notation between Camelot and Note. The light does not change.
5. Make the window 768 px wide, the narrowest width this check covers. The light still sits
   centred between the two Key sections.

## File search (ASID-DJ-13)

Not run. The search box in the listing's header searches the active device across SD and USB and
shows the matches in place of the directory. The automated checks cover the states, the drag
payload and a result dropped into the set list; what needs a bench is a device with a tune on each
storage. Loading from the cartridge is the only hardware step.

1. Search a name that exists on both SD and USB. Results from both storages appear, and each row
   shows which storage it is on, so the two same-named matches can be told apart.
2. Drag an SD result onto a deck and a USB result onto the other deck. Each loads and plays from
   its own storage.
3. Drag a result into the set list. It is added as a row, and the deck drop targets light up while
   the drag is in flight and clear when it ends. The drag image is the small name chip.
4. With the listing showing SD, use the jump button on a USB result. The listing moves to that
   storage's folder, showing the result's containing folder, and the search box is cleared.
5. Search again, then clear the search. The directory comes back.
6. Fold and unfold the listing. The search box and its chevron are spaced and aligned as before.
7. Make the window 768 px wide. The search box and the chevron still sit spaced and aligned.

## Set list drag (ASID-DJ-13)

Not run. A row of the set list can be dragged by its handle onto either deck, and the same handle
still reorders the set. The automated checks cover the wiring with synthetic events, which skip the
browser's own drop rules; whether a real browser accepts the drop, and how the drag ghost looks,
needs a bench. Loading from the cartridge is the only hardware step, and it is the cartridge the
decks already use.

1. With a device, a storage and a set of at least two rows, drag the first row by its handle onto
   Deck A. The deck loads that row and plays, the row's deck lamp lights, and the set, its order
   and its selection do not change. Drag the second row onto Deck B. It loads the same way.
2. While a row is dragged, both decks show the drop overlay. Release over the deck and the overlays
   go. Press Esc during a drag and release off the window: the overlays go as well.
3. Look at the drag ghost over a bright row and a dark row. It reads clearly on both.
4. Reorder with the same handle, dropping inside the set list. The row moves and nothing loads.
5. Drag a file from the listing into the set list, then onto a deck. Both still work, and the set
   card does not show its listing drop state while a row is dragged.
6. Hide the browser with the mixer toggle and wait for the peek to come up. Start a drag from a row
   in the peek and keep it going longer than the peek's usual interval (about 1.5 s). The peek
   stays up for the whole drag. Drop on a deck: it loads, and the peek goes away about 1.5 s later.
7. Start a drag, and with a mapped control or the mixer toggle show or hide the browser mid-drag.
   The deck overlays go.
8. Press Load A and Load B on the set card. Each still loads the selected row onto its deck.

## Launching the ASID player from the mixer (ASID-DJ-14)

Needs real TeensyROM cartridges bound to the decks. The rocket button is the third in the SID panel
header, after the bindings and browser buttons. It is not mappable, so there is no MIDI control for
it, and it is disabled while a launch is running.

- [ ] A cartridge on the network: one press starts its ASID player, the info alert names its deck,
      and a SID dropped from that cartridge's own storage then plays.
- [ ] A cartridge already on USB: one press starts its player, with no alert.
- [ ] A cartridge whose serial port another program holds: the launch is refused with the USB
      error and the cartridge stays on the network. If a game was running, the C64 is back at its
      menu, which is accepted.
- [ ] One deck with no cartridge bound: only the other deck's cartridge launches.
- [ ] A cartridge running a game: the press resets it and starts the player.
- [ ] A network cartridge whose firmware lacks the built-in player: the error alert names its deck,
      and the info alert says it moved to USB as well.
- [ ] Press while a directory listing is still loading from a network cartridge: the listing may
      fail once as the cartridge moves to USB; the next request is served over USB.

## A hand on the deck (ASID-DJ-15)

Not run. A pitch bend strip mapped onto a deck's position strip works as a hand: the record follows
the finger, carries on when it lets go and slows to the deck's own speed. The automated checks
cover the maths and the wiring; how it sounds and feels needs a bench with a pitch bend strip and
two decks. The grip default (250 ms) is the value to tune.

1. Map a pitch bend strip onto a deck's position strip in mapping mode, and check that a knob on
   the same strip still jumps.
2. Load a tune (it starts playing) and stop it. Rock over its first kick, hold still and hear
   silence, and release it on the other deck's beat. Then grab a playing deck mid-phrase and do the
   same.
3. Note whether a drum hit's sharp edge, landing late when moving backward, misleads the cue. If it
   does, the attack-and-release swap is next.
4. Throw forward and backward on a playing deck and hear it come back to speed like a slipmat, with
   no seam when live playback takes over. Throw on a paused deck and see it stay put.
5. Change Reach and Grip in the panel and feel the difference.
6. Read *Held* at a glance, and tell the amber playhead from a yellow queued marker.
7. Note any lag or sluggishness.
8. With both decks playing and one under the hand, read the player's timing stats for new late
   frames against a run without the hand.
9. Run a loop and beat juggle off its start marker: rock the record back onto the loop's start
   and hold, then release. It stops at the start, the first transient lands on the beat, and the
   loop carries on.
10. Light WRAP on a loop and scratch it forward and backward under the finger. It plays as an
    endless tone, with no stop at the start and no seam at the end.
11. Learn WRAP onto a MIDI control and press it. The selected loop's WRAP toggles, and a scrub
    backward past the start now wraps or stops to match.

## Matching by hand (ASID-DJ-18)

Browser check of the deck's slow speed controls, the beat grid with Tap and BPM, and the beat-based
loop commands (Add, In, Out, Length, Move and the edge arrows), driven against the running dev
build, plus what the operator needs at the bench. The listening verdict is the operator's and is
not given here.

**How this was driven.** `nx run teensyrom-ui:serve` (the dev build, so `djBench` exists) and the
API from this branch (`dotnet run` in `apps/api/src/TeensyRom.Api`), with `/dj-mixer` open in a
Chrome tab of 1375 x 868 CSS px. Port 10213 on all addresses was held by another worktree's engine,
so the API was bound to `127.0.0.2:10213` and the UI served from `127.0.0.2:4201` (the dev build
reads the API from the page's own host); `TEENSYROM_DATA_DIR` pointed at a scratch folder so the
operator's sets and grids were not touched. No cartridge was bound, so each deck's output ticked on
its own. The tunes were the two bundled with the player POC: `InSID3_Out.sid` (deck A: 2x
multispeed, 9975 µs a play call, 16183 frames, 125.31 BPM scanned at 48 frames a beat) and
`Still_Time.sid` (deck B: 19950 µs a play call, 22 frames a beat, 136.71 BPM), and two small PSIDs
written for this check: one whose play routine does nothing (`Silent Bench`: no notes) and one that
gates voice 1 at pseudo-random frames (`Irregular Bench`: 255-frame period, notes with no steady
beat). They were loaded through `DeckService.load` with the content request answered from a local
server (the listing is not what this checks), and after a reload through the saved set's rows. The
page needs a click before the first load: with none, the load never finishes (see the findings).
State was read from the store and the engine's snapshot; controls were pressed as DOM clicks on
their accessible names, the speed fader with real key presses and mouse wheel, and the Length and
Move step menus with real clicks. Not driven: the MIDI paths, a drop from the listing, and sound of
any kind.

**Speed (deck A, `Speed multiplier deck A`).** Five presses of ArrowUp moved the fader from 1 to
1.0005 and the readout read `0.05%` (0.01% a press). A double-click on the fader went home
(`0.00%`, value 1). One wheel notch from the tool moved 0.01%; five notches 0.05%, ten the other way
0.10%; the tool's notches are well over 200 ms apart, so all of them evidently took the floor. For the fast
end, wheel events of 100 px were dispatched on the fader a measured gap apart (the second click's
move, from a fresh click at home):

| gap between two clicks | move of the second click |
| --- | --- |
| 9 ms | 1.00% |
| 22 ms | 1.00% |
| 44 ms | 0.90% |
| 63 ms | 0.52% |
| 104 ms | 0.16% |
| 153 ms | 0.04% |
| 209 ms | 0.01% |
| 415 ms | 0.01% |

The first click of any gesture moved 0.01% in every row, so one notch is always the finest move and
a flick of N notches in 22 ms moves about (N-1)% plus 0.01%. These are the starting values
(`SLOW_TURN_FAST_MS` 40, `SLOW_TURN_SLOW_MS` 200) as shipped; whether they feel right on the knob and
the wheel is the operator's. The BPM followed the speed (125.31 at 0.00%, 125.33 at +0.01%, 125.39
at +0.06%, 125.45 at +0.11%).

**Grid and BPM.** Deck A read `125.31 BPM` and deck B `136.71 BPM` (both scans). The first reading
of deck B right after its load was `---.-- BPM`; 1.5 s later it read 136.71 (the readout paints on
animation frames and this tab's ran at about 41 a second; not chased). `Silent Bench` read
`---.-- BPM` with a null grid. Nine Taps 500 ms apart on it lit Tap's tapping state and then cleared
it two seconds later with no grid: a tune with no note starts cannot be tapped (the service does
nothing until the tune has them). `Irregular Bench` was scanned to 15 frames a beat (`200.50 BPM`),
a grid on a tune with no steady beat. Tapped on deck B 600 ms apart (about 100 BPM): the first three
Taps changed nothing (`200.50`), the fourth read `93.98 BPM` (32 frames, beat one 131), then `91.14`
and, from the seventh, `107.41 BPM` (28 frames, beat one 2), with the source `tap`; the grid fitted
snaps to the tune's own note starts, which is why it is not 100. Two seconds after the last Tap the
server held `beatFrames 28, beatOneFrame 2` for subtune 1. With the same tune loaded on deck A it
showed `107.41` at once (the tapped grid beat its own scan). Tapped on deck A 500 ms apart: A read
`120.30 BPM` live (25 frames, beat one 27), deck B stayed at `107.41` until the taps stopped and
read `120.30` about two seconds after the last Tap; the server held 25 / 27. After a reload of the
page the set came back with its four rows, and loading the tune on both decks from the set showed
`120.30 BPM` on both with the source `tap`.

**Loops.** On deck A (125.31 BPM, beats at 29 + 48 n):
- Add with the playhead at about 14280 placed the cue at 14285, beat 297 (it snaps).
- Out pressed at 14528 (beat 302.06) made a loop 14285-14525, five beats, the end on beat 302. In
  pressed at 14735, past the end, changed nothing (refused).
- Length by the buttons, from a cue: Double gave 4 beats (192 frames). Halve took it through 2, 1,
  1/2, 1/4, 1/8 and 1/16 (3 frames) and stayed there (1/32 would be 1.5 frames); Double took it back up
  through 1/8 ... 32 beats, 1536 frames. The Length menu lists 1/16 ... 32 beats; picking 1/2 BEAT gave
  24 frames.
- Move step menu: 1, 2, 4, 8 and 16 beats. On a 32-beat loop at each step, Move shifted start and end
  together by exactly that many beats with the length kept, and the start and end arrows each moved
  their edge by exactly that many beats.
- On a loop running at 14285-14813 (11 beats, 143 s into a 161 s tune), `seekToFrame`, `queueJump`
  and `setActiveLoop` on the runtime were logged with the engine's hand-off count and the position
  every 8 ms:

| edit, pressed at | queued | hand-off at the pass end | bounds after |
| --- | --- | --- | --- |
| Double, playhead 14708 | 1 ms | 1061 ms, as the playhead reached 14813 | 14285-15053 (16 beats) |
| Halve, 14458 on 14285-14477 (new end 14381, behind the playhead) | 1 ms | 175 ms, as it reached 14477 | 14285-14381 |
| Move later (1 beat), 14333 | 1 ms | 475 ms | 14333-14429 |
| Double, 14381 | 1 ms | 493 ms | 14333-14525 |
| In at 14450 (start to beat 300) | 1 ms | 737 ms | 14429-14525 |
| End later, 14488 | 1 ms | 360 ms | 14429-14573 |

  No `seekToFrame` was called by any edit, and the only backward jump in each position trace was the
  wrap at the pass end; the halved loop did not jump when its new end fell behind the playhead.
  Passes after the hand-offs were the new length (the 96-frame loop wrapped every 952-992 ms, 957.6
  ideal). An Out pressed where the nearest beat was the loop's current end made no edit and queued
  nothing.
- The marks lane's bracket moved at once, ahead of the hand-off, for each edit (width in percent of
  the tune: Double 0.890 to 1.186, Halve to 0.593, Move later left 89.162 to 89.458, Move earlier
  back, start earlier to a width of 0.890 at left 88.865), and settled on the engine's bounds
  (14381-14525).

**Two decks and the timing probes.** With deck B's fader at 0.9166 its BPM read `125.30` against
deck A's `125.31`, each running a four-beat loop (192 frames at 9975 µs and 88 frames at 21765 µs, a
pass of 1915.2 ms and 1915.3 ms). That is 0.14 ms a pass apart, 1 ms in about seven passes. Polling
the wraps every 4 ms in the page could not show that: over 11 passes deck A averaged 1922.6 ms and B
1938.3 ms, which is the polling and the tab, not the clocks (deck A's clock reported 25 ms of drift in
310 s). Whether they hold together by ear is the checklist's.

The protocol below was run four ways on those decks (A at 1.00x with its loop; B a loop on
`Still Time`; display refresh by `requestAnimationFrame` about 41 Hz here, 2 Hz when the tab had been
left; Claude in Chrome attached; other worktrees' builds and tests running). `longTasks` was
`{ count: 0, longestMs: 0 }` in every window.

| window | A: lag p99 / max | A: collapsed / on grid | A: worst gap | B: lag p99 | B: collapsed / on grid |
| --- | --- | --- | --- | --- | --- |
| B at 0.9166, clocks running since load | 17.76 / 20.68 ms | 35.8% / 4.2% | 79.2 ms | 17.93 ms | 0% / 11.3% |
| both 1.00x, the same clocks | 17.41 / 19.01 ms | 35.8% / 4.3% | 79.2 ms | 17.12 ms | 0% / 61.8% |
| both 1.00x, after Pause and Play | 9.98 / 11.98 ms | 1.4% / 97.2% | 13.6 ms | 10.18 ms | 0% / 95.0% |
| both 1.00x, next window, no restart | 16.03 / 19.76 ms | 22.1% / 40.8% | 21.7 ms | 15.38 ms | 0% / 77.4% |
| B at 0.9166, after Pause and Play | 13.51 / 16.41 ms | 8.7% / 53.3% | 17.0 ms | 13.55 ms | 0% / 65.6% |

`intervalMs` read 9.98 on A and 19.95 on B at 1.00x, and 21.77 on B at 0.9166. The recorded numbers
(*Where it stands*, end of the ASID-DJ-15 session, one deck at 1x on a 100 Hz display with Dashlane
off) are lag p99 10.5 ms, collapsed 3.8%, on grid 90.8%, and 0 long tasks over 8192 frames; the log
does not record `worstGapMs`. Only the third row is near them. The rest, and the spread between
windows of the same decks a minute apart (collapsed 1.4% to 35.8%), are not comparable readings of
the build: they were taken under automation in a tab that was being throttled. Read them as the
reason the protocol below asks for a quiet page; the operator's own run is the reading.

### Audition on every edit

On a running loop, In, Out, Length (the buttons and the menu), Move and the edge arrows each held the
pass they were pressed in and took effect at its end, a queued hand-off in the engine and no seek.
The pass-end rule held 143 s into a long tune and with a halving that put the new end behind the
playhead. The edits that were not driven: a nudge (it applies at once, as in the section above), an
edit arriving from the other deck on the same row, and any edit through a controller.

### Findings

1. **The first load on a page with no click never finishes.** With the tab untouched, `DeckService.load`
   stalled with the deck `indexing`, busy and switching, and no console error: the player's `play()`
   waits on the clock's `AudioContext.resume()`, which the autoplay policy leaves pending until the
   page has had a user gesture. After one click, loading again played at once. At the bench the
   operator's first click does it; it matters for anything that loads before the first click.
2. **`djBench.reset()` does not reset the clock.** It clears the probes and the long-task count only;
   `clock.worstGapMs`, `clock.jitterMs` and `clock.lateCallbacks` run from the deck's last play. Two
   consecutive windows read an identical `worstGapMs` (79.2 ms on A) while the probe figures
   changed, and a Pause then Play of each deck, which restarts the clock, brought it to 13.6 ms. The
   protocol below starts the clocks just before Reset for that reason.
3. **Tap on a tune with no note starts does nothing and says nothing.** Nine Taps lit and then cleared
   the tapping state with the grid still null. By design (the service waits for note starts), but the
   operator sees nothing happen on a silent or noteless tune.
4. **The scan gave a grid to a tune with no steady beat.** `Irregular Bench` got 15 frames a beat
   (`200.50 BPM`) rather than `---.-- BPM`. The tune is synthetic and repeats every 255 frames, so
   this is one data point only: whether real tunes with no steady beat show `---.-- BPM` or a wrong
   BPM is the checklist's grid item to settle.
5. **The BPM read `---.-- BPM` for a moment after a deck's load** (deck B, read straight after the
   load resolved) and the right value 1.5 s later. Not chased; likely the readout waiting on an
   animation frame in a throttled tab.
6. **Timing readings under automation are not usable as the build's numbers** (see the table above).

### Timing protocol

Run on a fresh page with Chrome DevTools closed, Claude in Chrome off the tab (its automation costs
frames), and both decks
playing loops. `djBench` is in the dev build only (`pnpm start`, API on the default port).

0. Start both decks' loops, then press Pause and Play on each, so each clock's window starts now
   (`reset()` does not restart the clock; see finding 2).
1. Run `djBench.reset()`.
2. Wait about 10 s.
3. Run `djBench.report()`.
4. Compare `lagMs` p99, `spacing.collapsedPct`, `clock.worstGapMs` and `longTasks.count` (it
   should be 0; `longTasks` is `{ count, longestMs }`) with the Performance log's *Where it stands*:
   lag p99 10.5 ms, collapsed 3.8%, on grid 90.8% (so `spacing.onGridPct` too), 0 long tasks;
   `worstGapMs` has no recorded figure, so the first run is the baseline. Note the extensions on and
   the display's refresh rate with the reading.
5. Repeat with the deck at 1.00x (`intervalMs` reads the tune's nominal interval: 9.98 on a 2x
   multispeed tune such as `InSID3 Out`, 19.95 on a 50 Hz one).

The operator listens throughout and records the verdict in their words.

### Bench checklist (operator, real hardware)

- [ ] Two decks matched by hand with the fine knob and the BPMs, each running a whole-beat loop,
  hold together pass after pass with no nudge. (Matching to 0.01% leaves about 0.2 ms a pass on a
  four-beat loop.)
- [ ] Grids judged on drum-heavy, arpeggio-heavy, swung and multispeed tunes and a tune with no
  steady beat, and a wrong grid put right with Tap. On the no-steady-beat tune, note whether it
  shows `---.-- BPM` or a BPM (finding 4); on a wrong grid, note how many Taps it takes and whether
  the tapped one holds after a reload and on the other deck.
- [ ] The slow-turn curve tuned on the knob and the wheel: the 40 ms / 200 ms starting values in
  `mixer/slow-turn.ts` (the table above has the curve as shipped), judged on a real mouse wheel and
  on the knob, for setting a fine match without the first notch feeling dead.
- [ ] In, Out, Length (fractions included) and Move on a running loop deep in a long tune: each
  edit lands at the end of its pass with no late pass.
- [ ] Very short loops (1/16 beat is 3 frames at 125 BPM on a 2x tune): whether they stutter or hold
  a note.
- [ ] Playback timing run per the timing protocol above with both decks looping, and the fields
  recorded against the Performance log's numbers.

### Verdict

Pending: the operator's, from the bench, with both cartridges connected.

## Set row drag and the bench checklist (ASID-DJ-19, 2026-11-03)

Not run. The whole set row except its remove key now starts the drag that reorders the set and
drops onto a deck, the same drag as the grip. A pending row cannot be dragged, and a plain click
still selects the row. The automated checks cover the wiring with synthetic events, which skip the
browser's own drop rules; whether a real browser starts the drag from a row's title, number, decks
and length, and how the drag ghost looks, needs a bench.

### Bench checklist (operator, real hardware)

- [ ] The play and play-now keys feel immediate from the mouse, on the tiles and the selected row,
  early and deep in a long tune.
- [ ] A press-to-port measurement of a play-now, per the `asid-dj-diagnostics` protocol, to judge
  the parked engine item.
- [ ] A loop started from its tile, then edited.
- [ ] A running loop duplicated: silent takeover, live edits, and the original kept.
- [ ] Kill/Punch and nudge pads lit from a controller.
- [ ] The speed display read against frame B.
- [ ] Set rows dragged from their body, both to reorder the set and onto a deck.
- [ ] A long name typed in the rename field.
- [ ] The "Loop N" and "Cue N" labels.
- [ ] Playback timing per the `asid-dj-diagnostics` protocol, inside the Performance log's numbers.

### Verdict

Pending: the operator's, from the bench.

## Live loops and slip (ASID-DJ-20, 2026-11-04)

Browser check of the built Live loop row, the transport without Repeat and the strip's second
playhead against `ASID-DJ-ROOT-WIREFRAME-SLIP.html`; the DJ mixer's timing protocol with slip on,
very short live loops and build-ups, driven against the running dev build; the automated commands;
and what the operator needs at the bench. The listening verdict is the operator's and is not given
here.

**How this was driven.** `pnpm nx run teensyrom-ui:serve` (the dev build, so `djBench` exists) on
`localhost:4200`, and the API from this branch (`dotnet run` in `apps/api/src/TeensyRom.Api`) on the
default port 10213 with `TEENSYROM_DATA_DIR` pointed at a scratch folder. Claude in Chrome drove the
tab. The tab's viewport cannot be set to a target size, so the app was loaded into a same-origin
`<iframe>` of **1920 x 1080** CSS px, with `lib-scaling-container { transform: none }` injected before
measuring (as in the sections above). The mockup was opened over a local HTTP server (the browser
tool does not open `file://`) at its own 1920 x 1080 frame A. No cartridge and no MIDI port were
bound. The tunes were the two bundled with the player POC: `InSID3_Out.sid` on deck A (2x multispeed,
9975 us a play call, 48 frames a beat, scanned grid) and `Still_Time.sid` on deck B (19950 us a play
call, 22 frames a beat). They were loaded through `DeckService.load` with the content request
answered from a small local server (the listing is not what this checks), after one real click on
the page. Slip, the live loop and its size were driven through `DeckService` (`setSlip`,
`toggleLiveLoop`, `stepLiveLoopSize`, `endLiveLoop`), not through a pad, a hold or a controller.

### The mockup against the built view (1920 x 1080, deck A)

Built figures are `getBoundingClientRect()` on the live DOM (idle row, deck loaded); mockup figures
are the same on frame A (the running row, deck A). Both plates are 474 px wide and start at x = 112.
The browser ran at a device pixel ratio of 1.5625, so the mockup's 1 px borders read 0.64 px.

| | mockup (frame A) | built | outcome |
| --- | --- | --- | --- |
| Row order | Live loop key, Size control, Slip key | Live loop key, Size control, Slip key | same |
| Row box | a bordered tray (6 / 8 px padding, 1 px border, dark fill; green border and inner glow while running), 444.7 x 37.3 | the same tray in the theme's tokens (the selected row's border colour and radius, 6 / 8 px padding, 25% black fill, a success-colour border at 60% and an inner glow at 12% while running), 440.4 x 39.6 | tray added; the 2.3 px of height is the 26 px key scale |
| Spacing between the three | 8 px | 6 px | finding (part of the key scale) |
| Live loop key | 110.3 x 24, 9.5 px label, running lamp dot, label "Live loop" | 79.7 x 26, 8.5 px label, running state as the green bar across the key's top (the same as Pause) | finding |
| Size control | 223.7 x 22: dim "Size" tag, half, readout, double | 299.8 x 22: bright "SIZE" tag, half, readout, double | the tag colour is the shared control's (the Length and Move rows use it too); not changed |
| Slip key | 77.5 x 24, lamp dot, icon and "Slip" | 49 x 26, lamp ring and "SLIP"; latched cyan with slip on | finding |
| Transport keys | Pause 92 x 32, Stop 74.9 x 32, step keys 32 x 32 | Pause 80 x 26, Stop 80 x 26, step keys 31.6 x 26 | finding (the same key scale as above) |
| Transport without Repeat | Pause, Stop, previous, SUB readout, next; no Repeat | Pause, Stop, previous, readout, next; no Repeat | same. The "SUB" caption shows from a 496 px transport container; the container is 440 px here, so only the count reads |
| Transport plate | 474 x 206.9 | 474 x 181 | follows from the key scale |
| Strip | 444.7 x 14, playhead 2 px wide | 440.4 x 14, playhead 2 px wide | same |
| Second playhead | 2 px wide, striped 2 px on / 2 px off, 75% alpha, no glow, to the right of the playhead | 2 px wide, dotted, was 55% alpha, no glow | alpha changed to 75% |
| Running live loop's mark above the strip | green bracket (fill 55%, glow, at least 5 px wide) | was the plate-loop colour (magenta fill) | changed to the mockup's green |

Fixed in the components: the live loop's bracket now draws in the live (success) colour with its glow
and a 5 px minimum width, flagged by an optional `live` on `PositionMark` (set by the deck column,
which until now sent it as an ordinary running loop); the second playhead's opacity went from 0.55 to
0.75. Checked after the change on the running loop in the browser: the bracket reads green and the
second playhead's dots are visible beside the playhead.

The first version of the live rule lost its `min-width` to the plain loop rule declared after it (same
specificity), so the 5 px minimum never applied: a live mark and an ordinary loop mark both computed
`min-width: 2px`. The live rule now sits after the loop rule. Measured in the dev build on a
`data-live` loop mark set to 0.012% of the strip width (a 2-frame loop on a 16183-frame tune): computed
`min-width` 5px, drawn 4.99 px wide, green border `rgb(111, 220, 140)`; the same mark without
`data-live` computed 2px and drew 2.0 px with the plate-loop border. In the Storybook strip story
(below) the live mark computed `min-width: 5px` beside ordinary loops at 2px. jsdom does not resolve
this cascade, so no unit spec can see it; this was read in a real browser.

Findings, not fixed (larger than a small visual difference or not this task's to settle): the built
row has no lamp dot on its keys (the tray was added afterwards, see the Row box line); its keys follow the page's 26 px key scale where the
wireframe draws 24 px (live row) and 32 px (transport) keys; the Live loop and Slip keys are narrower
than the mockup's because their labels are set smaller and the Slip key has no lamp-dot-and-label
form. Nothing in the idle row clips or leaves its plate at any of the five widths the responsive spec
covers (see below), but the row does wrap: it holds on one line at 1100 and 768 px, and the Size
control drops to its own line when the row's container is under 20 rem (the row measured 241 px wide at
400 px, 136 at 1279 px and 196 at 1400 px, each with Size on a second line). That is the row's
container-query layout, not a fault. The tray was added in the final-review correction: the row's
padding and border take 18 px of the container's content width, so the 20 rem threshold now reads the
content box (the row's controls need about 273 px abreast at the 8 px gap, so it still leaves headroom);
the five-width responsive spec passes with the tray (47 of 47), and in the 1920 x 1080 frame the running
tray read a success-green border and inner glow beside the idle tray's grey border.

### Timing protocol with slip on

The protocol in the `asid-dj-diagnostics` skill, run as far as this session allows. Each window:
both clocks restarted (Pause then Play), `djBench.reset()`, about 10 s with the actions below, then
`djBench.report()`. "One deck" is deck A playing alone (deck B paused); "two decks" is both playing
with the same actions on both at once. Slip on in every row after the first; the live loop size
ladder is 1/24 beat (2 frames on both tunes: 2 of 48 on A, 2 of 22 on B), 1/16, 1/8, 1/4, 1/2, 1 ...
beats, so the shortest rung is 1/24 beat. A build-up is 1 beat then 1/2 then 1/4, one step every
1.5 s.

Not comparable to the Performance log's numbers (lag p99 10.5 ms, collapsed 3.8%, on grid 90.8%,
0 long tasks, on the operator's page with DevTools closed): the page was a tab in a window under
automation, and Claude in Chrome's debugger was attached. Read them against the baseline rows, which
were taken the same way. `lag` is `lagMs` p99 / max; `player.worstLagMs` read 44.88 ms on A and
37.98 ms on B in every row (it does not reset with `djBench.reset()` and was set before the first
window), so it is not repeated. `longTasks` read `{ count: 0, longestMs: 0 }` in every window.

| window | deck | frames | lag p99 / max (ms) | collapsed | on grid | worst gap (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| baseline, both playing, slip off | A | 1003 | 11.41 / 18.38 | 3.5% | 92.8% | 21.5 |
| | B | 501 | 11.38 / 18.48 | 0% | 93.4% | 20.7 |
| baseline, both playing, repeated at the end | A | 1003 | 10.18 / 11.48 | 2.2% | 95.8% | 15.1 |
| | B | 501 | 10.08 / 10.23 | 0% | 95.0% | 15.4 |
| one deck, baseline, slip off | A | 1004 | 10.28 / 14.96 | 3.3% | 93.6% | 20.2 |
| one deck, slip on, no departure | A | 1004 | 10.11 / 10.78 | 1.6% | 96.9% | 12.5 |
| one deck, live loop 1 beat | A | 1003 | 10.11 / 10.63 | 1.9% | 96.4% | 12.5 |
| one deck, live loop at the shortest rung | A | 1004 | 10.08 / 11.03 | 2.1% | 96.1% | 11.7 |
| one deck, build-up 1, 1/2, 1/4 | A | 1004 | 13.13 / 19.41 | 3.9% | 92.0% | 20.6 |
| one deck, slip landing | A | 1003 | 10.11 / 12.56 | 1.8% | 96.0% | 14.1 |
| one deck, live loop within 2 s of a landing | A | 1004 | 13.91 / 19.86 | 3.7% | 92.6% | 20.8 |
| two decks, live loop 1 beat on both | A | 1003 | 10.08 / 13.26 | 2.5% | 95.0% | 20.1 |
| | B | 501 | 10.23 / 10.58 | 0% | 95.4% | 20.3 |
| two decks, shortest rung on both | A | 1004 | 10.06 / 12.53 | 1.6% | 96.8% | 15.3 |
| | B | 502 | 10.08 / 11.33 | 0% | 96.8% | 15.4 |
| two decks, build-up on both | A | 1004 | 15.01 / 19.76 | 2.8% | 93.9% | 20.9 |
| | B | 502 | 11.18 / 19.53 | 0% | 93.2% | 21.1 |
| two decks, slip landing on both | A | 1003 | 10.08 / 11.53 | 2.1% | 95.6% | 14.8 |
| | B | 501 | 10.13 / 10.78 | 0% | 96.2% | 14.7 |
| two decks, live loop within 2 s of a landing, both | A | 1003 | 10.06 / 11.48 | 1.9% | 96.2% | 14.2 |
| | B | 502 | 10.18 / 13.08 | 0% | 97.0% | 14.2 |

Read as numbers: the windows with the live loop at 1 beat, at the shortest rung, with a landing, and
the two-deck loop within 2 s of a landing sit inside the spread of the baselines (p99 10.1-11.4 ms,
max 10.2-18.5 ms, worst gap 12.5-21.5 ms). The build-up windows (both decks) and the one-deck live
loop within 2 s of a landing read higher (p99 13.1-15.0 ms, max 19.4-19.9 ms on A), and the
baselines themselves moved by about as much between runs (max 11.5 to 18.4 ms); one window each is
not enough to say whether the build-up costs anything or the tab was throttled for those 10 s. They
are the windows to repeat at the bench.

Not run, and why:
- **Pops.** Counting them needs the ear, or `send-capture.js` with `send-analysis.js` against a bound
  cartridge with an operator tapping at each pop; there was no cartridge, no MIDI port and no sound.
- **DevTools Performance traces** (`trace-compare.mjs`, `trace-long.mjs`): the traces are recorded
  and saved by the operator in DevTools (the skill's Step 3); the browser tool here cannot record or
  save one.
- **Both cartridges connected**, as the protocol asks: the decks' output ticked on its own, so the
  figures are what the page hands to `send()`, not wire timing.
- The display's refresh rate and the page's extensions were not recorded; the tab was driven by an
  extension, and the page was fresh (a few minutes old) when the first window ran.
- The Slip key, the Live loop key's hold and the push encoder were not driven; the service calls
  were made directly, so the hold timing and a press are unproven here.

### Responsive spec

`dj-mixer-responsive.cy.ts` gained "the live loop row": at 1400, 1279, 1100, 768 and 400 px it
asserts that both rows sit inside their plate, do not overflow themselves, and that Live loop, Size
and Slip each have width and end inside the row. It passes with the Size control wrapped or not, and
measures the idle row only. Run against the dev server above with
`cypress run --project apps/teensyrom-ui-e2e --spec src/e2e/dj-mixer/dj-mixer-responsive.cy.ts`:
47 passing (the 5 new ones included). `pnpm nx e2e teensyrom-ui-e2e` itself was not used (the Cypress
config starts its own server on port 4200, which this session already held).

### Storybook checks

`pnpm nx run ui-components:build-storybook` passes. The built Storybook was served over a local HTTP
server and the `Dj/Position strip` "Marks every state" story was opened in the browser: the strip draws
idle, selected, running, queued and both loop marks, the cues, and the new live mark at its end. A
live mark was added to that story's `everyMarkState` (it reads green with its glow, computed
`min-width: 5px`, beside the ordinary loops at 2px). Not run: the strip and the Live loop row stories
were not compared side by side with the slip mockup in Storybook (the mockup comparison above was
made on the running app), and the Live loop row stories were not opened.

### Automated commands

| command | result |
| --- | --- |
| `pnpm nx run-many -t test -p application ui-components dj-mixer` | printed nothing in about 25 minutes while other nx and pnpm processes were running on the machine; not used. The three projects were run with `vitest run` from each project's folder instead |
| `vitest run` in `libs/application` | 98 files, 2723 tests passed |
| `vitest run` in `libs/ui/components` | 136 files, 2342 tests passed (the CSS-parse and shader-mock lines in its output are the suite's usual noise) |
| `vitest run` in `libs/features/dj-mixer` | 12 files, 352 tests passed |
| `pnpm nx run-many -t lint -p application ui-components dj-mixer` | 0 errors, 10 warnings (all in `application`, none in files this task touched) |
| `pnpm nx build teensyrom-ui` | built; initial total 2.44 MB raw (500.71 kB transfer), over the 2.00 MB initial budget by 437.62 kB (a warning; `project.json`'s budgets are unchanged). No baseline was taken: the app was not built at the pre-ASID-DJ-20 commit, so how much of the 437.62 kB overage this iteration added cannot be attributed from this run. The earlier sections' last tabulated overage was 184.77 kB on the branch (143.08 kB on `main`); this phase's own change to shipped code is one optional field, a style rule and an opacity value |
| `dotnet test apps/api/src/TeensyRom.Api.Tests.Unit` | 1110 passed, 0 failed |
| `pnpm test` in the `sidablist` root | core 924, asid 63, analysis 209, tunes 77 tests passed |

### Bench checklist (operator, real hardware)

- [ ] A live loop of 2-3 frames (1/24 beat on a 2x tune, 1/16 beat at 125 BPM): stutter or a held
  note.
- [ ] A build-up (1, then 1/2, then 1/4) landing on the grid with no seam.
- [ ] Slip landing after a live loop, after a list loop, and after the hand.
- [ ] A live loop over a 128-beat list loop, returning into it.
- [ ] A list loop fired from a build-up.
- [ ] A live loop pushed with a voice muted, then unmuted (the saved image may keep that voice silent
  until its next note).
- [ ] Right after a load, before the register record lands: a live loop over a list loop, ended past
  that loop's end (the worker-jump exception may land late).
- [ ] The 4-beat default size: confirm or change.
- [ ] Toggle and hold on a pad.
- [ ] A push encoder.
- [ ] The other deck's timing throughout.
- [ ] The row beside the mockup on the real display: the key sizes and the Slip key's form
  (findings above), and the green live bracket.
- [ ] Playback timing per the timing protocol above and the `asid-dj-diagnostics` skill, with both
  cartridges connected and DevTools closed, repeating the build-up and the live-loop-after-landing
  windows.

### Verdict

Pending the operator.

## Whole-beat length steps and No End (ASID-DJ-20, 2026-11-05)

The selected loop's nudge strips, edge arrows, In, Out and Clear End are gone. A loop is shaped by Add,
Length (1/2, a beat shorter, a beat longer, 2×, a picker with No End first) and Move. The Length row
reads LENGTH on both the selected row and the live loop row.

### What was checked in a browser

The real DJ view (`/dj-mixer`, the dev server) in Cypress's browser, at the viewports the handoff names, with
the longest readout text (`128 BEATS` and a caret, as `1/16 BEAT` is the same length) written into the
Length readout of the selected row, the Move readout and the live row's Length readout. No tune can be
loaded in this session (it needs a TeensyROM and its file service), so the readouts are the empty rows'
with that text put in. The widths are the controls' own, in CSS px.

| viewport | selected row | Length control | Move control | live Length control |
| --- | --- | --- | --- | --- |
| 1920 | 440 px | 422 px, 1 line | 422 px, 1 line | 271 px, 1 line |
| 1600 | 280 px | 262 px, 1 line, tight readout | 262 px, 1 line | 262 px, 1 line |
| 1536 | 264 px | 246 px, 2 lines | 246 px, 1 line | 246 px, 1 line |
| 1440 | 216 px | 198 px, 2 lines | 198 px, 1 line, tight readout | 198 px, 1 line, tight readout |
| 1400 | 196 px | 178 px, 2 lines | 178 px, 2 lines | 178 px, 2 lines |
| 1366 | 179 px | 161 px, 2 lines | 161 px, 2 lines | 161 px, 2 lines |
| 1300 | 141 px | 123 px, 3 lines | 123 px, 3 lines | 123 px, 3 lines |
| 1280 | 131 px | 113 px, 3 lines | 113 px, 3 lines | 113 px, 3 lines |

At 1279 px and below the app stacks the decks and the row is wider than at 1280 px (1018 px at 1279 x 900),
so the narrowest control is the 1280 px one. The 1920 px row's side-by-side layout starts at a 528 px row.

Every width in the table, and 1100, 768 and 400 px, passes the Cypress case below: no readout holds more than
its width, the text clears every key and tag, and every key, tag and readout stays on the plate.

How the layout was chosen. The old arithmetic assumed a row of 236 to 254 px as the narrowest, which was
read off Storybook and not off the app: the plate at 1280 x 900 gives a row of 131 to 136 px, and the Length
control 113 to 118 px, which cannot hold even the four keys beside any readout text. So each control
sizes itself by its own width (a container query on the control, not on the row it sits in, which is why the
live row and the Move control follow the same rule). With the real font (Roboto Mono, the longest text
62.4 px, the readout 83 px roomy and 76 px tight):

- Length with the − and + keys: one line above 272 px; below it the readout takes 2 px padding and gap and the
  signs 22 px; below 248 px (the tight line needs 245) two lines, the tag and the readout, then the four keys
  spread across the width; below 128 px three lines, the tag, the readout, the keys.
- The Move control and the live row's Length control, which need 200 px roomy and 193 px tight: tight below
  208 px, two lines below 196 px, three below 128 px.

A row that cannot hold its keys beside the text is taller, not squeezed; the page already scrolls at those
viewport heights. The keys come after the readout in the DOM, so in the two- and three-line layouts they sit
below the picker while the tab order keeps the DOM order (1/2, −, picker, +, 2×). A text longer than the readout is clipped by the readout, never
painted over a key.

An earlier pass of this check, on the empty rows at 900 px high in Chrome with a fallback monospace font,
passed at every width for a text 4 px narrower and missed the 1440 px overflow; the numbers above are with
the real font.

### Automated

`dj-mixer-responsive.cy.ts` has "the loop rows with the longest readout text": at 1920, 1600, 1536, 1440,
1400, 1366, 1300, 1280, 1279, 1100, 768 and 400 px it writes the longest text into the selected row's Length
readout, the Move readout and the live row's Length readout, and asserts for each control that the readout
holds its text, the text overlaps no key or tag, and every key, tag and readout lies inside the control and
on the plate. The fixture cannot select a marker (no tune loads in it), so the rows are the empty ones with
the text put in. Run with `cypress run` from `apps/teensyrom-ui-e2e` against the dev server on 4200: the
case failed at 1440 and 1280 px before the layout was fixed and passes at every width after.

### Bench checklist (operator, real hardware)

- [ ] `−` and `+` on a running loop land at the end of the pass, on the beat.
- [ ] No End on an idle loop makes it a cue. On a running loop it lets the loop go at once. With slip
  on, the deck lands and the second playhead goes.
- [ ] Deleting a running loop with slip on lands the same way.
- [ ] A tune with no grid: tap a grid in, then shape a loop.
- [ ] A settings file with no deck settings starts both decks with slip on. A saved slip off stays
  off after a refresh.
- [ ] The three LENGTH, MOVE and live-row LENGTH tags measure the same gap to the next control in
  the running DJ view at 1920 x 1080, wider, and with the bindings panel open.

## Alternating-lap loops (ASID-DJ-20, 2026-11-05)

A loop whose length is not a whole number of frames (1/8 of a beat on a 28-frame beat is 3.5 frames) now
plays laps of alternating whole-frame length (4, 3, 4, 3) so it never drifts from the grid. The ladder runs
from 1/16 to 128 beats with no odd division step, a queued hand-off carries the running lap clock on, and
loop boundary frames are stored as fractions.

### Automated

The engine's lap arithmetic, the hand-off clock and the shadow count are covered by `sidablist`'s
`libs/core` and `libs/analysis` specs (lap timing, queued hand-offs and the shadow position). In this
repo: the deck loops, live loop and runtime specs and the beat-math specs, the DJ library round trip of a fractional boundary
(Core, API and the infrastructure mapper), and the old integer-frame file read tests.

### By ear and on the bench (operator)

The by-ear check of very short and fractional loops, and the timing protocol's windows for this build,
are the operator's to run and record. Nothing here claims either was done: the operator's verdict and the
tunes used are to be added below, and the notes' Outcome in the loop-ladder experiment filled in
with it.

- [ ] A fractional loop (for example 1/8 on a grid whose beat is not a multiple of 8 frames) holds the beat
  by ear over a long run, with no drift against the other deck.
- [ ] Very short live loops sound clean, with no click at the re-entry.
- [ ] Playback timing per the timing protocol and the `asid-dj-diagnostics` skill for this build.

### Verdict

Pending the operator.

## The sender (ASID-DJ-21)

The timing helper that now carries the decks' packets: the checks that need no cartridge, run and
recorded here, and the five checks that need the operator's PC and both cartridges, left unticked.
Nothing below claims a listening result, a wire timing or a `djBench` reading from real hardware; the
verdict is the operator's. No code was changed by these checks: none of them found anything broken.

**How this was driven.** The automated commands ran from `src/` with `pnpm nx`; `nx` did not hang this
time, so no command fell back to running `vitest` or `eslint` by hand. The browser checks were driven
through the DevTools protocol by small throwaway scripts (not committed) against headless Edge
157.0.4341.42 on a throwaway profile: the dev server (`pnpm nx run teensyrom-ui:serve`, `localhost:4200`)
and the production build on `pnpm nx run teensyrom-ui:serve-static` (also port 4200). Both servers were
started by this session and stopped by process id afterwards. The API was not running and no cartridge
or MIDI device was attached, so the page logged its usual failed `/api/` calls (settings, devices, the
log hub, the version); those are not related to the sender.

**The MIDI limit on this machine, and the stub.** `navigator.requestMIDIAccess({ sysex: true })` never
resolved on this machine, with the permission reading `granted` through `navigator.permissions.query`.
It timed out after 6 to 8 s in headless Edge, in headless Chrome 156, in a headed Edge window, and in a
tab opened in the connected Edge through Claude in Chrome (a new tab on `localhost:4200`, used only to
read the badge and make that one call, no deck playing, closed afterwards; the tab already open on
`localhost:4393` was not touched). So every browser check below that needs MIDI ran with
`navigator.requestMIDIAccess` replaced by a stub that returns a MIDI access with no ports: injected into
the app page at document start, and into the sender frame by serving the sender's `index.html` with the
stub inlined first. What that changes: the supervisor, the frame, the messages, the own-thread test, the
retry timing and the alerts are the real code; the MIDI start-up is not (it is instant). Hence the
start-up time below is not measured.

### Automated commands

| command | result |
| --- | --- |
| `pnpm nx run-many -t test -p application,infrastructure,app-bootstrap,asid-sender,asid-sender-protocol,teensyrom-ui` | all six passed in 1 m 44 s. `application` 102 files, 2795 tests. `infrastructure` 40 files passed, 2 skipped (687 tests passed, 2 skipped). `app-bootstrap` 2 files, 16 tests. `asid-sender` 8 files, 120 tests. `asid-sender-protocol` 4 files, 102 tests. `teensyrom-ui` 1 file, 1 test. The error lines in the output (failed settings loads, launch failures and the like) are the specs' own expected failures |
| `pnpm nx run-many -t lint -p application,infrastructure,app-bootstrap,asid-sender,asid-sender-protocol,teensyrom-ui` | 0 errors on all six. 13 warnings: 10 in `application` and 3 in `infrastructure`, all unused variables or non-null assertions in files this task did not touch (`player/actions/*`, `player-context*`, `worker-tune-indexer.spec.ts`). `app-bootstrap` and `teensyrom-ui` were read from the nx cache ("existing outputs match the cache"), not re-run |
| `pnpm nx run-many -t typecheck -p asid-sender,asid-sender-protocol` | `asid-sender` passed (`tsc --noEmit -p tsconfig.app.json`). `asid-sender-protocol` has no `typecheck` target, so nx ran nothing for it. Run by hand instead from `libs/asid-sender-protocol`: `tsc --noEmit -p tsconfig.lib.json` is clean; `tsc --noEmit -p tsconfig.spec.json` fails with one TS2769 in `vite.config.mts` (the test reporters array does not match vitest's type), and nothing in the library's sources or specs. Not touched here: it is the test config's typing, and the library's tests pass |
| `pnpm nx build teensyrom-ui --configuration=production` | built, 50 s (three of its four tasks read from the cache). Initial total **2.46 MB raw (506.70 kB transfer)**, over the 2.00 MB budget by **460.17 kB** (a warning; budgets in `project.json` unchanged). The last reading in this file is in the live loops section above: 2.44 MB raw (500.71 kB transfer), over by 437.62 kB. So +22.55 kB overage and +5.99 kB transfer since; the sections between that reading and this one recorded no bundle size, so the growth cannot be split between the iterations. The sender is in the bundle as `asid-sender/index.html`, `asid-sender/assets/index-CVd4ELPx.js` (16,434 bytes) and `asid-sender/assets/alarm.worker-CuHvwMaF.js` (243 bytes), and the app's own `sender-ticker-worker` (40 bytes) is a lazy chunk |
| `git status` in the `SIDablist` sibling | on `main`, up to date with `origin/main`, nothing changed (checked after the tests and the build, and again at the end) |

### Browser checks, without a cartridge

All with the stubbed MIDI above, headless Edge 157, nothing playing. Times are the page's own clock
(`performance.now()`, ms since the page loaded); the sender log lines are the `ASID sender:` lines in the
console. Hello and ready times were read when the app's port received each message.

**Dev server.**
- The sender comes up: `idle -> opening: MIDI granted`, `opening -> testing: ready; own-thread test next`,
  `testing -> up: own-thread test passed`, 0.5 to 0.8 s after the grant. The own-thread test passed in each
  of the 3 dev loads where the stub reached the frame.
- The frame is its own target: the protocol lists `iframe http://127.0.0.1:4200/asid-sender/index.html?v=1`
  as a separate target beside the page `http://localhost:4200/dj-mixer`.
- The badge read `SEND: SENDER` with nothing playing. `djBench.sender()` read `path sender`, `state up`,
  wake margin 3 ms (now and max), no wake samples and no decks (nothing was sending), one visible entry.
- **The frame's MIDI start-up time, hello to ready: not measured.** With the stub it read 0.3 to 2.8 ms,
  which says nothing about MIDI. It needs the real `requestMIDIAccess`, so it is the operator's reading.

**Production build** on `serve-static`.
- `curl` on `http://localhost:4200/asid-sender/index.html` and `http://127.0.0.1:4200/asid-sender/index.html`:
  both 200, `text/html; charset=UTF-8`, 217 bytes, the sender page (title `ASID sender`, module script
  `./assets/index-CVd4ELPx.js`).
- The sender comes up in the browser: the same three log lines, own-thread test passed, the frame an
  `iframe` target on `127.0.0.1:4200`.
- `typeof window.djBench` is `undefined`, there is no `SEND:` text anywhere on the page and no fixed badge
  element. After `b` and then `i` (nothing focused) the frame was neither removed nor re-added, no alert
  showed and no new log line appeared: the keys do nothing.

**The wrong page** (dev server, two ways of making the sender page not the sender).
- *Unreachable* (the request for the sender page refused): the frame loaded the browser's error page and
  said nothing, and the supervisor logged `opening -> down: not the sender: the page loaded and never said hello`
  about 1 s after each open, removed the frame, and reopened it after 1.0, 2.0, 4.0, 8.3, 16.0 and 30.2 s
  (the 1, 2, 4, 8, 16, 30 s ladder). The down alert showed once, at 10.95 s: the 10 s grace after MIDI was
  granted. The badge read `SEND: MIXER · down` or `opening` throughout. The frame made no request except
  the error page's own images.
- *The app's own page served at the sender's address* (the dev server's fallback copy of the app): the same
  cycle and ladder (1.0, 2.0, 4.3, 8.2, 16.0 s), the down alert once at 10.94 s. The copy loaded its
  scripts, stylesheets and fonts (and its stores logged their set-up), and made **no** other request: no
  XHR, no fetch and no `/api/` call (0 of 1,254 requests in the 40 s run; the request types seen were
  `Script`, `Stylesheet` and `Font` only).

**The break drill** (dev build, no deck playing, page 13 s old so the grace had passed). `b` at 13.04 s:
- the frame was removed at 13.04 s, the badge went to `SEND: MIXER · down`, and the down alert showed at
  13.14 s: "Timing helper stopped. Playing with reduced timing while it recovers.";
- 1.2 s later the supervisor reopened the frame; the back alert showed at 14.33 s ("Timing helper is back.
  Full timing restored.") and the badge returned to `SEND: SENDER` at 14.58 s, on its own;
- the log read `up -> down: broken on purpose`, `down -> opening: retrying`, `opening -> up: ready`
  (no second own-thread test: it passes once per page).
- Pressed at 7 s instead (inside the 10 s grace), the same drill ran with the badge and the log, but no
  down alert and, with it, no back alert. That is the grace period working; press `b` more than 10 s after
  loading.

**Not run, and why**
- **The real MIDI start-up** (above): `requestMIDIAccess` does not resolve here.
- **Playback of any kind**: no cartridge and no tune loaded, so no packets crossed the frame.
  `djBench.report()`, the per-deck figures of `djBench.sender()`, the sender's wake lateness under load and
  the schedule-ahead on the sender path were not read.
- **Edge's task manager** (one core, a process of its own): the browser's own UI; the target list above is
  the only evidence of a separate frame here.
- **Hidden-tab behaviour and the API-served build**: bench checks 2 and 3 below. A cartridge dropping out is
  covered by automated tests only.

### The isolation test

`node run.mjs` from a copy of `reference/frame-isolation-test` (a copy, so the run's `results.json` did not
land in the reference folder), Edge 157.0.4341.42 and Chrome 156.0.8078.81, each with the parent page on
`localhost` and on `127.0.0.1` (4 runs of 6 cases). Against `results-2026-11-07-windows.json`, same browser
versions:

| case | 2026-11-07 | 2026-11-08 (this run) |
| --- | --- | --- |
| same address (control) | shares the parent thread in 4 of 4 (0 ticks in the freeze, gap 400.6 to 401.4 ms) | the same, 4 of 4 (gap 400.5 to 401.3 ms) |
| other port | shares the parent thread in 4 of 4 (gap 400.6 to 401.3 ms) | the same, 4 of 4 (gap 400.4 to 400.7 ms) |
| **other name, same port (the plan)** | **own thread in 4 of 4**: at least 607 ticks in the freeze, longest gap 6.8 to 14 ms | **own thread in 4 of 4**: at least 591 ticks, longest gap 7.2 to 10.5 ms. Every run also saw a separate-process target |
| other name, other port (console rig) | own thread in 4 of 4 | own thread in 4 of 4 |
| other port + Origin-Agent-Cluster | own thread in 3, mixed in 1 (Edge on 127.0.0.1, gap 62.5 ms) | own thread in 3, mixed in 1 (Edge on localhost, gap 67 ms) |
| sender.localhost, same port | own thread in 2, mixed in 2 (gaps 60.9 and 57.8 ms) | own thread in 3, mixed in 1 (Edge on localhost, gap 58.9 ms) |

The plan's case holds as it did the day before: the pass mark (own thread in every run) is met. The two
cases that are not the plan's flip between own thread and mixed (a longest gap just over the 50 ms line)
from run to run on both days, so neither day says anything about them.

### Bench checklist (operator, real hardware)

Conditions, as the timing protocol in the `asid-dj-diagnostics` skill asks: the operator's display;
Ableton and OBS running; DevTools closed while listening (open it only to read); both cartridges
connected; a freshly loaded page (say how old it was); both decks at 1.00x unless the check says
otherwise (`djBench.report()` `intervalMs` 9.98 for InSID3 Out). Dev build for 1, 2, 4 and 5 (`djBench`
exists there); click an empty part of the page before pressing `i` or `b`.

- [ ] **1. Two decks, mixer showing, about 10 minutes.** Aces High at 1x on one deck and InSID3 Out at 2x on
  the other, all voices.
  - [ ] By ear: at least as clean as the console tests.
  - [ ] `await djBench.sender()`: gaps within 1 ms of the median, against 98.0 to 99.2% on deck A and 95.7 to
    96.5% on deck B. A reading below that is a finding to explain, and the ear decides.
  - [ ] `djBench.report()`: each deck's own delivery probe (mixer lag p99 and max, long tasks) against the
    console tests, mixer lag p99 about 13.4 to 15.8 ms. Handing frames over must read no worse.
  - [ ] The sender under one core and in a process of its own in Edge's task manager (Shift+Esc; a subframe
    on `127.0.0.1`).
  - [ ] The own-thread test passed in the log (`testing -> up: own-thread test passed`).
  - [ ] The frame's MIDI start-up on a cold load, read from the time between the log lines
    `idle -> opening: MIDI granted` and `opening -> testing: ready; own-thread test next` (frame load,
    hello and MIDI start-up together, so an upper bound on hello to ready). The code waits 3 s for the
    MIDI start-up after hello (`MIDI_TIMEOUT_MS`) and 5 s for the frame to load (`LOAD_TIMEOUT_MS`). If
    that time is not comfortably under 3 s, raise `MIDI_TIMEOUT_MS` before the ear test, or the sender
    reloads forever on the 1, 2, 4, 8, 16, 30 s ladder. Confirm that 3 s and 5 s is the reading of
    "does not come up" you want.
- [ ] **2. Mixer hidden behind another tab for 30 minutes**, with no break. Afterwards read the
  `djBench.sender()` timeline and its hidden and shown log.
- [ ] **3. A production build served by the API.** `pnpm run build:frontend`, `trom api stop`,
  `trom api start`, then `http://localhost:10213/dj-mixer`.
  - [ ] A shorter run of check 1, by ear.
  - [ ] The sender's own process and its CPU in Edge's task manager.
  - [ ] The own-thread test in the log. There is no `djBench` there.
- [ ] **4. The self-heal drill.** `b` while both decks play, more than 10 s after load:
  - [ ] the down alert shows;
  - [ ] the decks keep playing on today's sending (`await djBench.sender()` reads `path` `mixer`, `state` `down`);
  - [ ] the sender comes back by itself (`path` `sender`, `state` `up`);
  - [ ] the back alert shows.
- [ ] **5. Every press behaves as before, 15 ms later:** play, stop, pause, loops and live loops, cues,
  tempo changes, slip landings and the hand.
- [ ] If deck B's C64 crashes on its own during the bench, record what happened.
- Do not power a C64 or a MIDI device off to test a dropout: it freezes Edge (a known Chromium bug). A
  cartridge dropping out is covered by automated tests only.

### Verdict

Operator, 2026-11-08, after the bench test: it looks fine. Some drops and audio slurs remain, but it is much better than
before the sender, and the operator accepts it for this project.

The individual checks above were not reported back, so their boxes stay unticked and no readings are recorded here. Add them
if they were taken. Where the remaining drops come from is not known; the hand-over for the next performance iteration is in
the project's requirements document, section *Outcome and Handover*.

## The sender's wake as the tick (ASID-DJ-22)

The decks now tick from the sender's wake instead of the mixer's silent audio graph, with a saved
lookahead and a timing-helper switch on Setup -> Settings. This section records the checks that need no
cartridge, run and recorded here, and leaves the whole bench as an unticked checklist for the operator
to run after the pipeline completes. **No bench ran inside this pipeline**: no hardware, no listening,
no real-cartridge `djBench` reading and no Edge task manager reading is recorded below. No code was
changed by these checks: none of them found anything broken.

**How this was driven.** The automated commands ran from `src/` with `pnpm nx`, `--skip-nx-cache` on the
test, lint, typecheck and build runs, so each was run, not read from the cache. The browser checks were
driven through the DevTools protocol by small throwaway scripts (not committed) against headless Edge
157.0.4341.42 on a throwaway profile, with MIDI and SysEx granted through `Browser.grantPermissions` for
`localhost:4200` and `127.0.0.1:4200`. Claude in Chrome had no browser connected, so it was not used.
Unlike ASID-DJ-21's run, `navigator.requestMIDIAccess({ sysex: true })` resolved here, with one input and
one output and no cartridge (no serial ports at all), so the MIDI start-up in these checks was the real
one and no stub stood in for it. Nothing was bound to a port, so no packet left any deck. The page was
brought to the front and given focus emulation so timers ran at full rate; headless Edge otherwise reads
hidden. The dev server (`pnpm nx run teensyrom-ui:serve`), the production build on `serve-static`, and the
API (`dotnet run`, port 10213, `TEENSYROM_DATA_DIR` pointed at a scratch folder so no real settings file
was touched) were started by this session and stopped by process id afterwards.

A tune was loaded without a cartridge by calling `DeckService.load` through the dev build's Angular debug
API (`ng.getComponent` on the deck column), with the page's `/files/content` request answered by the
bundled `InSID3_Out.sid` (5,200 bytes) through the protocol's request interception.

### Automated commands

| command | result |
| --- | --- |
| `pnpm nx run-many -t test -p application,infrastructure,app-bootstrap,asid-sender,asid-sender-protocol,dj-mixer,ui-components,teensyrom-ui` | all eight passed in 2 m 14 s. `application` 104 files, 2862 tests. `infrastructure` 41 files passed and 2 skipped (724 tests passed, 2 skipped: the device and storage integration specs). `app-bootstrap` 2 files, 16 tests. `asid-sender` 9 files, 144 tests. `asid-sender-protocol` 5 files, 124 tests. `dj-mixer` 12 files, 358 tests. `ui-components` 135 files, 2343 tests. `teensyrom-ui` 1 file, 1 test. The error lines in the output (failed settings loads, launch failures and the like) are the specs' own expected failures |
| `pnpm nx run-many -t lint -p` (the same eight) | 0 errors on all eight. 18 warnings: 10 in `application`, 5 in `ui-components` and 3 in `infrastructure`; the other five projects had none. They were not triaged against this project's diff |
| `pnpm nx run-many -t typecheck -p asid-sender,asid-sender-protocol` | both passed (`tsc --noEmit -p tsconfig.app.json` and `tsc --noEmit -p tsconfig.lib.json`). `asid-sender-protocol` has a `typecheck` target now; ASID-DJ-21 found none |
| `dotnet test apps/api/src/TeensyRom.Api.Tests.Unit` | passed: 1155 of 1155 |
| `dotnet test apps/api/src/TeensyRom.Core.Tests` | passed: 246 of 246 |
| `dotnet build apps/cli/TeensyRom.Cli.sln` | succeeded, 0 errors, 12 warnings (CS9107) on a clean compile, all in CLI files this project did not touch (the build run at the end was up to date and compiled nothing, so its "0 warnings" meant nothing; the phase 3 and phase 4 reviews measured the 12 on a clean compile). Not rebuilt |
| `pnpm nx build teensyrom-ui --configuration=production` | built, 42 s (the bundle itself 33.9 s). Initial total **2.47 MB raw (510.11 kB transfer)**, over the 2.00 MB budget by **473.36 kB** (a warning; budgets in `project.json` unchanged). ASID-DJ-21's reading, in its section above: 2.46 MB raw (506.70 kB transfer), over by 460.17 kB. So +13.19 kB over budget and +3.41 kB transfer since, across all of ASID-DJ-22's changes; this section does not split the growth between them. The sender is in the bundle as `asid-sender/index.html` (226 bytes), `asid-sender/assets/index-B7vW-z9l.js` (18,063 bytes, against 16,434 in ASID-DJ-21's reading) and `asid-sender/assets/alarm.worker-CuHvwMaF.js` (243 bytes). The app's own `sender-ticker-worker` (40 bytes) is a lazy chunk |
| `git status` in the `SIDablist` sibling | on `main` at `62cbd74`, up to date with `origin/main`, nothing changed (checked after the tests and the build, and again at the end) |

### Browser checks, without a cartridge

All on headless Edge 157, nothing bound to a port. Times are from the script's clock. The log lines are
the `ASID sender:` lines in the console.

**Dev server: the sender at version 2.**
- The frame is `http://127.0.0.1:4200/asid-sender/index.html?v=2`, a separate target beside the page on
  `localhost`. The log read `idle -> opening: MIDI granted`, `opening -> testing: ready; own-thread test
  next`, `testing -> up: own-thread test passed`, in every dev load that had the sender switched on.
- `await djBench.sender()` with nothing playing read `path sender`, `state up`, `answered true`, wake
  margin 3 ms (now and max), no decks.

**A deck playing with nothing bound** (InSID3 Out on deck A, loaded as above, about 6 s after play):
`djBench.report()` read `tick.source` `'sender'`, with `tick.wake` counting 299 wakes, 0 early and 0
`guardRearms`, against 303 frames. (Headless, no hardware: this says the wake chain runs, not how well.)

**A version-1 sender.** The frame's request was answered by a page that replies to `connect` with `hello`
at version 1. The hello failed: `opening -> down: wrong identity or version (teensyrom-asid-sender v1)`,
and the supervisor retried after about 1.0, 2.2, 4.2 and 8.2 s (the 1, 2, 4, 8 s start of its ladder),
failing the same way each time. `await djBench.sender()` read `path mixer`, `state down`, `answered
false`. No deck was playing in this run, so "the decks stay on the mixer's own sending" is the path
reading only; the down alert was not read.

**The `i` flip and the `b` fallback** (dev build, deck A playing, 264 samples of `djBench.report()` at
100 ms, page 20 to 34 s old; the click before each key on an empty part of the page):
- `i` at the sender: the first sample after the press, 134 ms later, read `tick.source` `'audio'`, and no
  other value came between. Log: `up -> parked: dev flip to the mixer`.
- `i` again, 4 s later: `parked -> opening: dev flip to the sender`, then `opening -> up: ready` 0.38 s
  after, and `tick.source` read `'sender'` in the first sample, 404 ms after the press.
- `b`, with the page 32 s old (past the 10 s grace): `up -> down: broken on purpose`; `tick.source`
  read `'audio'` 92 ms after the press, and `'sender'` again 1,494 ms after it; the log read `down ->
  opening: retrying` 1.2 s after the break and `opening -> up: ready` 0.2 s later, with nothing done by
  hand.
- Across all of it the frame count rose in every sample (never backwards), and the longest stretch
  between two changes of the count was 156 ms at a 100 ms sampling; `guardRearms` stayed 0. That is no
  stall long enough for these samples to see. The ear is the check for the rest: the no-click part and
  the beat-matching stay on the bench below.
- `await djBench.sender()` takes up to 3 s to return `answered false` while the sender is parked or down
  (the link waits `TIMING_REPLY_TIMEOUT_MS`, 3 s, for a reply). It was seen: `path mixer`, `state
  parked` first read about 3 s after the flip. Read `report()`'s `tick.source` right after a flip, and
  `sender()` when the state has settled.
- The down and back alerts were not captured.

**Setup -> Settings** (dev server, with the API running on port 10213 and `TEENSYROM_DATA_DIR` at a
scratch folder). The panel's tablist read Bindings, Settings.
- First view: the stepper at 15, its Lower button disabled and its Raise button enabled; the Timing
  helper switch on.
- One Raise press: 16 ms, Lower enabled. The switch turned off: `up -> off: switched off`, and
  `await djBench.sender()` read `path mixer`, `state off`.
- `GET /api/midi-settings` returned `"sendSettings":{"lookaheadMs":16,"senderEnabled":false}`, and the
  saved file, `<data dir>/api/Assets/System/Config/midi-settings.json`, held the same block.
- A reload: Settings showed 16 ms with the switch off, and the log read `idle -> off: switched off`, so
  the saved value won over the new default 15.
- The Raise-pressed values are test values in a scratch data folder, not the operator's settings.

**Production build** on `pnpm nx run teensyrom-ui:serve-static` (port 4200):
- `curl` on `http://127.0.0.1:4200/asid-sender/index.html`: 200, `text/html; charset=UTF-8`, 226 bytes.
- `typeof window.djBench` is `undefined` and no `SEND:` text is on the page. The Setup panel has the
  Bindings and Settings tabs. Settings read 15 ms with Lower disabled and the switch on. The API on port
  10213 held 16 ms and off at that moment, so this page was not reading it: `serve-static` has no API
  behind it, so a production page there reads the defaults. The saved-value check above was made on the
  dev server only, and no check has read the saved values back on a production build.
- The sender comes up: the same three log lines, own-thread test passed, the frame an `iframe` target on
  `127.0.0.1:4200` with `?v=2`.

### Not run, and why

- **Everything that needs a cartridge or the operator's ears:** playback on real hardware, wire timing,
  press-to-wire, the sender's own lateness, spare p1 and frames past their stamp on a real device.
- **The `i` and `b` keys on the production build.** Not driven here; ASID-DJ-21 recorded them doing
  nothing there, on its own build.
- **The 30-minute hidden run and the API-served production build.** Bench checks 6.1 and 6.6 below.
- **Reading the saved lookahead and switch back on a production build.** `serve-static` cannot (no
  API behind it); check 6.6 below does it on the API-served build.
- **Edge's task manager** (the sender under one core, in a process of its own): the browser's own UI.
- **Hidden-page behaviour:** these runs forced the page visible; no hidden reading was taken.
- **Claude in Chrome:** no browser was connected, so nothing was attached to the operator's Edge.

### Readings

**No bench readings were taken inside this pipeline.** The shipped lookahead
(`SENDER_SCHEDULE_AHEAD_MS`) and the floor (`SENDER_LOOKAHEAD_FLOOR_MS`, and the API's
`MidiSettingsAllowLists.LookaheadMinMs`) are **provisional at 15 ms each**: the value ASID-DJ-21's table
found to hold, on the audio tick. The checklist below is what chooses them. Two sets of readings already
exist, as other people's, and are cited, not repeated: the prework's wake test, in
`reference/wake-test/RESULTS.md` (two decks at lookahead 15, a rig driving the clock from the sender's
wakes: showing, due-to-send p99 5.7 ms and spare p1 8.5 ms against the audio tick's 12.6 and 3.0; hidden,
frames past their stamp 0.65% against 6.4 to 7.1%), and ASID-DJ-21's table in the doc comment of
`SENDER_SCHEDULE_AHEAD_MS`.

### Bench checklist (operator, after the pipeline completes)

Conditions: the operator's PC, Edge, Ableton and OBS on, Dashlane off, sleeping tabs off, DevTools closed
while listening, both cartridges, a freshly loaded `http://localhost:4200/dj-mixer`. Read only at the
start and end of a stretch: Claude in Chrome's debugger makes a hidden page read as visible while
attached. Deck A is Aces High at 1x on its double-kick loop and deck B is InSID3 Out at 2x, all voices.
Readings go to `C:/Users/Metal/.radorc/shared/projects/ASID-DJ-22/reference/bench/READINGS.md`, which the
first check creates, with an entry in the portfolio's performance log
(`C:\Users\Metal\.radorc\shared\projects\ASID-DJ-ROOT\ASID-DJ-PERFORMANCE-LOG.md`).

- [ ] **1. The baseline on the old tick**, from a separate checkout of `d994bd74`, which has every bench
  probe and the old audio tick, at lookahead 15 on the sender.
  - [ ] The checkout: a separate worktree of `d994bd74` beside `teensyrom-web` in
    `C:/Users/Metal/.radorc/worktrees/ASID-DJ-22/`, so the `../../SIDablist` links in `src/package.json`
    resolve; `pnpm install` per `src/AGENTS.md`; the branch's dev server stopped first (both serve on
    port 4200); run against the branch's API, which accepts the old app's saves.
  - [ ] Before any Settings change: the old app's saves drop `sendSettings`, so a saved lookahead or
    switch resets to the defaults. Run this check first, or set Setup -> Settings again after it.
  - [ ] One deck (A), 5 minutes showing and 5 minutes hidden. Each run is `djBench.reset()`, the stretch,
    then `djBench.report()`, `djBench.lagTimeline()` and `await djBench.sender()`.
  - [ ] Two decks, 10 minutes showing and 10 minutes hidden, the same readings.
  - [ ] Presses, on one showing two-deck run: `djBench.reset()`, then about 20 of each kind on deck A,
    then `djBench.report()`. The kinds: play, stop, pause, a jump into a loop or cue, play-now, a tempo
    change, a mute and a SID panel knob nudge. Press the jumps with deck A on its main track and no loop
    running, so each one engages at once.
  - [ ] Edge's task manager: the sender's and the mixer's CPU on each run.
  - [ ] Record it under **Baseline (old tick)**, with the conditions and the operator's words.
- [ ] **2. The new tick at lookahead 15**, back on `radorch/ASID-DJ-22`: the same runs, adding each deck's
  `tick` readings and the CPU. Record it under **After (new tick)**.
- [ ] **3. The sweep.** Two decks showing, at 10, 9, 8, 7, 6 and 5 ms in turn, lower while values hold.
  - [ ] At each value: `djBench.lookahead(ms)`, then `djBench.reset()`, then about 3 minutes.
  - [ ] Then read `djBench.report()` and `await djBench.sender()` (spare p1, past stamp), and take the
    operator's word by ear.
  - [ ] Every dev save reloads the page and resets the lookahead.
  - [ ] Record it under **Sweep**.
- [ ] **4. Choose**, with the operator. First check the lowest value that held: a 10-minute two-deck
  hidden run at it, then the press series at it, each after `djBench.reset()`.
  - [ ] The shipped lookahead is the lowest value below 10 ms that meets all four of these; if the
    candidate misses, step up 1 ms and check again:
    - the tightest margin (spare p1 per deck) is wider than the baseline's at 15, showing and hidden;
    - pooled mean press-to-wire (`presses.all.mean`) is lower than the baseline's, and no kind's mean is
      higher than its baseline;
    - the sender stays under one core with the mixer showing;
    - the ear holds.
  - [ ] The floor is the lowest value tried whose two-deck showing run kept frames past their stamp under
    1%.
  - [ ] If no value below 10 ms meets the bar, the operator decides.
  - [ ] Record a **Chosen** section: the shipped lookahead in ms, the floor in ms, and the operator's
    words.
- [ ] **5. Reconcile**, in a follow-up outside this pipeline.
  - [ ] Always, even at 15 / 15: remove "provisional" from the doc comments of
    `SENDER_SCHEDULE_AHEAD_MS`, `SENDER_LOOKAHEAD_FLOOR_MS` and `MidiSettingsAllowLists.LookaheadMinMs`,
    and from the `asid-dj-diagnostics` skill and from this section; give `SENDER_SCHEDULE_AHEAD_MS`'s
    comment the sweep's table.
  - [ ] When Chosen differs from 15 / 15: change `SENDER_SCHEDULE_AHEAD_MS`,
    `SENDER_LOOKAHEAD_FLOOR_MS` and `MidiSettingsAllowLists.LookaheadMinMs` to match, and update
    `deck-send-route.spec.ts`'s `[0, 15]`. The validator and clamp tests are written against the
    constants, so they follow on their own.
  - [ ] Rebuild and restart the API the app runs against, so it accepts the new floor. Until then a save
    below 15 is refused, and so are the bindings saved in the same request.
  - [ ] The saved value: any save during the provisional build wrote `sendSettings` with the lookahead at
    15, and a stored value wins over a new default. Once the follow-up is running, set the chosen
    lookahead on Setup -> Settings. The follow-up decides whether a stored 15 should migrate on other
    hosts.
- [ ] **6. The final bench**, once step 5 is in, on the build with the reconciled constants and the
  restarted API, with Setup -> Settings first showing the chosen lookahead (at 15 / 15, on the build as it
  stands).
  - [ ] 6.1 Two decks, mixer hidden behind another tab for 30 minutes, read afterwards from
    `djBench.report()`, `djBench.lagTimeline()` and `await djBench.sender()`. The sender's own lateness
    hidden, from its single waiter, is set against prework's rig.
  - [ ] 6.2 Two decks, mixer showing, 10 minutes: no frame past its stamp, mixer lateness p99 about 5 ms
    or less, and the sender under one core in Edge's task manager, against its ASID-DJ-21 reading.
  - [ ] 6.3 Press-to-wire for every kind against the baseline, and the presses by ear.
  - [ ] 6.4 The fallback without a click, two ways, in Edge, while both decks play:
    - [ ] `b`: the decks keep playing on the audio tick with no fresh click, then the sender comes back
      by itself with the tick handed back;
    - [ ] a real silent failure: end the sender's subframe process (`127.0.0.1`) in Edge's task manager
      (Shift+Esc). The fallback comes only after the health timeout. By ear and by `djBench.report()`,
      the decks stay beat-matched across it and keep their place, and the sender comes back by itself.
  - [ ] 6.5 The switch mid-set: Timing helper off and on while both decks play, with the chip in step
    after each. The setting survives a reload and a cleared browser cache.
  - [ ] 6.6 A production build served by the API: `pnpm run build:frontend`, `trom api stop`, `trom api
    start`, then `http://localhost:10213/dj-mixer` for a shorter run of check 2 by ear. Setup then
    Settings on this build must show the saved lookahead and switch, matching `GET /api/midi-settings`.
  - [ ] Record it under **Final**, with the operator's verdict.
- Never ask for a C64 or a MIDI device to be powered off: it freezes Edge (a known Chromium bug).
- [ ] If deck B's C64 crashes on its own during the bench, record what happened.

### Verdict

Pending the operator. Nothing in this section claims a listening result or a real-hardware reading.
