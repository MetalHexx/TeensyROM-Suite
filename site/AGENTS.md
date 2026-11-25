# site/

The product page for https://metalhexx.github.io/TeensyROM-Suite/. A static page, built with a
Node-only toolchain that stamps the newest release (version, date, download links) into it.

## Layout

| Path | What |
|------|------|
| `site/page/` | The page source. Only this folder is copied into a build. See "The page" below. |
| `site/tools/` | The toolchain: `site.mjs` (CLI), `record.mjs` (motion recorder) and `lib/` (config, semver, releases, build, check, serve, dev-client). |
| `site/tools/test/` | Unit tests and the fixture page. |
| `site/tools/font-trial/` | Dev-only font candidates for the preview server (`__dev/fonts/`); never built. |
| `site/tools/art/` | Sources of generated images (`og-card.html`, the social card); never built. |
| `site/build/` | Build output. Git-ignored. |

## Commands

Run from the repo root.

```
node site/tools/site.mjs build [--offline] [--src <dir>] [--out <dir>]
node site/tools/site.mjs gate
node site/tools/site.mjs check [--out <dir>] [--external]
node site/tools/site.mjs dev [--port <n>] [--offline] [--src <dir>]
node site/tools/record.mjs --url <page url> --seconds <n> --out <path without extension> [options]
node --test "site/tools/test/**/*.test.mjs"
```

- `build` looks up the release once and stamps it into every release region of `index.html`.
  `--offline` skips the lookup and keeps the fallback markup. A failed lookup is a warning, not a
  failure; the build keeps the fallbacks.
- `gate` prints `publish=true|false` and the reason. It appends `publish=...` to `$GITHUB_OUTPUT`
  when that is set. When the releases cannot be read it exits 1: holding blind beats publishing
  blind.
- `check` runs every check over `site/build/` (or `--out`), prints `PASS`/`FAIL` per check with a
  `- problem` line for each problem, and exits 1 if any fails. `--external` also asks the network about
  each external link (HEAD, then GET; 10 s timeout; 4 at a time). It is local only, never in CI.
- `dev` builds, then serves the page at `http://127.0.0.1:8087/TeensyROM-Suite/` (127.0.0.1 only) with live
  reload, rebuilding on every save under `site/page/` and keeping the last good build when a rebuild fails.
  It looks the release up once at start unless `--offline`. `__dev/preview` shows the page at 1440, 768 and
  390 px side by side; a hash (`__dev/preview#tv`) opens every frame at that section, and
  `__dev/preview?clean` passes `?clean` on. The dev client is injected into served pages only and is never
  part of a build. Stop it with Ctrl+C.
- `record.mjs` is a dev tool (headless Chrome or Edge, ffmpeg) that writes `<out>.mp4` and `<out>.gif`. Options:
  `--at <selector>`, `--crop`, `--seconds`, `--width`, `--height`, `--reduced-motion`, `--browser <path>`,
  `--from-load` (record from before the page loads, and scroll to `--at` smoothly once recording runs), and
  `--hover <selector>` (sweep the pointer across the matches). Recordings never go in the repo.

Environment: `SITE_GITHUB_API` replaces the GitHub API base (tests, local use); `GITHUB_TOKEN` (or
`GH_TOKEN`) is sent only to `https://api.github.com`.

## The preview loop

1. Start `node site/tools/site.mjs dev --offline` in the background.
2. Open the page and `__dev/preview` in Chrome.
3. Edit `site/page/` and watch the frames reload.
4. Read timed states with JavaScript (classes, computed styles, `document.getAnimations()`); screenshots lag.
5. Record motion with `record.mjs` (add `?clean` to the URL so the dev panel stays out of the shot).
6. Finish with `build` and `check`.

## What `check` enforces

Every check runs and every problem is reported in one run.

| Check | Rule |
|-------|------|
| `entry` | `index.html` exists. |
| `weight` | Budgets: 400 KB a file, 3 MB in all, 500 KB for the first screen (`index.html`, its stylesheets and scripts, their `url()`s, icons and preloads, and every image not `loading="lazy"`). |
| `links` | Every local `src`, `href`, `srcset` candidate and CSS `url()` resolves to a built file; no root-absolute URL (it breaks under `/TeensyROM-Suite/`). |
| `https` | No `http://` URL (the SVG namespace excepted). |
| `images` | Every `<img>` has `alt` (empty for decoration) and numeric `width` and `height`. |
| `h1` | Exactly one `<h1>`. |
| `csp` | The exact content policy `<meta>` and the referrer policy; no `<style>`, inline `<script>`, `style=` or `on…=` attribute. |
| `dev` | Nothing mentions `__dev`. |
| `release` | Each region appears once; all regions share one state and tag; a stamped region shows its tag; no `{{` or source marker is left; every download link sits under the shown tag. |
| `version` | No hand-written version outside release regions, comments and SVG. |
| `head` | `<html lang>`, `<title>`, description and `og:title`, `og:description`, `og:image`, `og:url` (equal to the site URL). |
| `external` | Every link to another origin has `rel="noreferrer"`. |
| `wording` | In visible text, `<title>`, meta descriptions, `og:*`, `twitter:*`, and `alt`, `aria-label` and `title` attributes: never "Claude" or "Anthropic", and no internal project name such as `ASID-DJ-12`. Write licence names in words ("SIL Open Font License"), not ids. |

## The page

`site/page/` holds everything the build copies. Nothing is generated at build time except the release regions.

| Path | What |
|------|------|
| `index.html` | The whole page: head, skip link, sticky header, `<main>` (hero, `#trom-ui`, then `#get`), footer. Holds the inline-SVG art (`#cart-art`, `#voices-art`). |
| `css/site.css` | Tokens, base, components, header, hero, the TV, footer, keyframes, reduced motion, in that order. |
| `js/site.js` | Adds the `js` class, scroll reveal, the cursor-following card glow, cursor blinking in view, the cartridge's replay on hover, the TV and its video facades. Progressive: the page reads without it. |
| `img/` | `icon.svg` (the header icon, 16 cells), `favicon-32.png`, `apple-touch-icon.png`, `og-card.png`, `glow.svg` (the Web UI's background glows, fixed behind the page). |
| `img/tv/` | The TV's pictures: three video posters and seven screenshots, WebP. See "Images". |
| `fonts/` | The self-hosted pixel font (Web437 IBM VGA 8x16) and its licence file; see "The pixel font". |

Rules for every file in `page/`:

- Relative URLs for the page's own files (`css/site.css`, never `/css/...`). Docs are absolute
  `https://github.com/MetalHexx/TeensyROM-Suite/blob/main/docs/...` links. Every external link has `rel="noreferrer"`.
- Keep the CSP meta. No inline `<style>`, `<script>` or `style=""`; JS styles only through classes and CSS
  custom properties (it may set `hidden`, `aria-*`, `loading`, text, build the video play buttons, and insert the YouTube
  iframe on a click).
- Only `transform`, `opacity` and `filter` animate. Anything that moves by itself can be paused and stays still
  under `prefers-reduced-motion: reduce`. A one-off entrance under five seconds that then rests needs no pause.
- Every `<img>` has `alt`, `width` and `height`. One `<h1>`.
- Features only, at feature level: no internal project names, no counts that go stale ("real C64s", never a
  number), no version written by hand, never the name of the AI tool Trom Agent runs in.
- Phone first, usable from 320 px; 16 px side gutters on a phone; no horizontal page scroll.

### Design language

Dark plum desk, magenta and cyan glow, a pixel face for headlines. It is the bigger sibling of ReBeep's
page (same parts, its own look): pink and purple are the brand here, ReBeep's lime and beige never appear. Read
`:root` in `site.css` before adding a colour or a size.

| Token | Use |
|-------|-----|
| `--bg` `#151116`, `--surface`, `--line` | The desk, panels and hairlines |
| `--plum` `#890089` | Fills, header and button grounds, glow. Never text on dark (about 2:1) |
| `--magenta` `#b333b3` | Glow, borders, large type only (about 3.6:1) |
| `--cyan` `#00f7ff` | Highlights, links, active states |
| `--yellow` `#f5e29e` | The third accent, the voice trace |
| `--green` `#6fdc8c` | Status lights |
| `--text`, `--text-soft` | Body text and the pink secondary text |
| `--glow-soft`, `--glow-hot` | Box-shadow glows; hot for hover and "on" moments |
| `--font-display`, `--font-body` | The pixel face (headlines, labels, eyebrows, the OSD) and the system sans |

- **Type.** The pixel face only at whole multiples of its pixel grid (16, 32, 48, 64 px for the current 8x16 face),
  never bold, crisp. The system sans for body text.
- **Commodore touches.** `READY.` with a block cursor in the footer. The C64's blue-on-blue appears only in that
  small screen and never replaces the palette. Every `.cursor` blinks for four seconds once it is in view, then
  rests solid (site.js adds `is-live`).
- **SID voice traces (`.voices`).** Pulse, saw and triangle in magenta, cyan and yellow, drawn still. The paths
  live once in `<g id="voices-art">`; reuse them anywhere with
  `<svg class="voices" viewBox="0 0 960 72" preserveAspectRatio="none" aria-hidden="true"><use href="#voices-art"/></svg>`.
  Each trace repeats every 40 units, so a scrolling variant can shift it by 40 and loop, but only next to a
  pause control.
- **The cartridge.** Inline SVG of whole-cell paths on a 56 x 62 grid with `shape-rendering="crispEdges"`,
  shown at a whole number of pixels per cell (`--cell` on `.hero__art`: 4, 5, 6, 7 or 8 px by width). It powers
  on once at load (under three seconds: the glow blooms, three LEDs come on) and then rests lit; under reduced
  motion it simply starts lit. A mouse over it plays the power-on again. It sits in a fixed-aspect `.hero__art`
  box so a mascot can replace it without moving the layout.
- **Shared parts.** `.wrap`; `.sechead` with an eyebrow number `01`..`06`; `.card` with `data-glow` (the glow
  follows the cursor through `--mx`/`--my`); `.tags`; `.btn--primary` and `.btn--ghost`; `.link-arrow`;
  `[data-reveal]` fade-and-rise for elements below the first screen only; `.cursor`; `.monitor` with `.tv__*` (the
  TV, see "The TV").

### The TV

Section 02 (`#trom-ui`) is built around a physical CRT, `<div class="monitor tv" id="tv">`: dark plum plastic with a
magenta and cyan glow, a 16:9 screen, a chin with the "TeensyROM" badge, prev / next / pause buttons and a power
LED, and a stand. It changes channel by itself between its pictures. The cards, the section head and the two docs
links sit around it.

**Channels.** Each is a `.tv__ch` inside `#tv-channels` with `role="group"`, `aria-roledescription="slide"` and
`aria-label="n of N: …"` (today N is 10); every one but the first has `hidden`. Today, in order:

| # | Channel | Picture |
|---|---------|---------|
| 1 to 3 | Video: Mix Preview, Scratch / Beat Juggle Preview, CRX 2026 Interview | `mix-preview.webp`, `scratch-preview.webp`, `crx-interview.webp` (posters) |
| 4 to 10 | The player, the DJ Mixer, CRT effects, full screen, file transfer, watch folders, themes | `player`, `dj-mixer`, `crt-effects`, `full-screen`, `file-transfer`, `watch-folders`, `themes` (`.webp`; all but `themes` also have a `-960.webp` copy) |

**Add, remove or reorder a channel.** Only `index.html` lists the channels: `site.js` and `site.css` count them from
the DOM, and the on-screen number (`CH 01` to `CH 10`) is the channel's position.

1. Copy a block of the same kind. A screenshot is `<figure class="tv__ch">` holding `<img class="tv__img">`; a video
   is `<div class="tv__ch video">` (see "Video facade").
2. Put it where it belongs (the order in the file is the order on the TV), or delete or move a block.
3. Renumber every `aria-label` (`n of N`: both the position and the total). Keep `hidden` on every channel but the
   first.
4. A new picture follows "Images": WebP in `img/tv/`, `loading="lazy"`, `width` and `height`, alt text.
5. `data-hold` (ms) on a channel overrides the 4.5 s default. Videos use 7000.
6. Check in the dev server: every channel shows through one full loop and the network log shows no picture before its
   channel is next. Removing a channel? Delete its image from `img/tv/` too.

The 460 ms switch-off and 420 ms switch-on in `site.js` (`OFF`, `ON`) mirror the `crt-off-*` and `crt-on-*`
keyframes in `site.css`; change them together.

**Behaviour.** A change is a CRT switch-off (`is-off`), a dark beat (`is-dark`) and a switch-on with a slight
overshoot and bloom (`is-on`), with a channel-number OSD that pops up and fades. The buttons are hidden until JS
runs; pause is hidden under reduced motion, where a button changes channel instantly with no effect. The TV holds
still on mouse hover and keyboard focus (not on tap), off screen (an observer at 0.3), in a hidden tab, under reduced
motion, while paused and while a video plays. `aria-live` is `polite` only for changes by hand or while paused. A
channel's picture loads only when it is next (`loading="lazy"`, set to `eager` one channel ahead and when the TV
first comes into view); nothing is requested from another origin until a play button is pressed. Only `transform`,
`opacity` and `filter` animate. Without JS the first channel shows, still, with its link.

**Video facade.** Every video channel is its own facade:

- The HTML carries the stored poster (`<img class="video__img">`, lazy, with alt) in `.video__stage` and a plain link
  `https://www.youtube.com/watch?v=<id>` (`rel="noreferrer"`) in the channel, outside the frame, always shown, so a
  video that cannot load (YouTube blocked or down) still has a way to it. `data-video-id` and `data-video-title`
  hold the id and the title.
- `site.js` validates the id against `/^[A-Za-z0-9_-]{11}$/` (no match, no play button; the poster and the link stay)
  and wraps the poster in a `<button>` labelled "Play video: <title>" with a pixel play icon.
- On click it replaces the poster with an iframe on `https://www.youtube-nocookie.com/embed/<id>?autoplay=1&rel=0&cc_load_policy=1`,
  `title` = the video title, `allow="autoplay; encrypted-media; picture-in-picture; fullscreen"`, `allowfullscreen`
  and `referrerpolicy="strict-origin-when-cross-origin"` (YouTube fails with error 153 without a referrer), and
  focuses it. The CSP's `frame-src` lets in only `youtube-nocookie.com`.
- While a video plays the TV never changes channel by itself. Previous and next stay available; changing channel
  stops the video (the iframe is removed and the poster facade comes back) and the automatic changes resume unless
  paused.
- The page never requests YouTube images: the poster is a stored copy (see "Images").

### The pixel font

Headlines, labels, eyebrows and buttons use **Web437 IBM VGA 8x16**, self-hosted from `page/fonts/` (the `.woff`
with its licence text, `Web437_IBM_VGA_8x16-LICENSE.txt`, beside it). It comes from VileR's Ultimate Oldschool PC
Font Pack under the Creative Commons Attribution-ShareAlike 4.0 licence, and is credited in the footer with the
licence named in words. It is the same face ReBeep's page ships.

**Temporary.** It was chosen because it is already cleared and in use next door, not because it is a C64 face: it
is a VGA text-mode face, not the C64's. Revisit it for a true C64 pixel font (for example Pet Me 64, C64 Pro Mono
or Bescii) before the page goes public. Keep only a font whose licence allows self-hosting on a public page and
redistribution in this public repo, and read the licence text before keeping it. Note that CC BY-SA 4.0 is
share-alike: it covers the font file, not the page's own MIT-licensed code.

Because the face is 16 px tall, set it only at 16, 32, 48 or 64 px (8 px advance per 16 px). Never bold.

To swap the font:

1. Compare candidates in `site/tools/font-trial/`: `fonts.json` (`[{ "key": "1", "name": "..." }]`), a `trial.css`
   mapping `[data-font="1"] { --font-display: ... }` with `@font-face` `src` as a bare `url(<file>)`, and the font
   files with their licences. The dev server serves that folder at `/TeensyROM-Suite/__dev/fonts/`, and the
   preview shows a switcher. Today it lists only the current font.
2. Put the winner (in its original format) and its licence text in `site/page/fonts/`.
3. Update the `@font-face` in `site.css`, `--font-display` and the head `<link rel="preload" as="font" crossorigin>`.
4. Update the footer credit, naming the licence in words ("SIL Open Font License", not an id such as `OFL-1.1`).
5. Record the choice and the reason here, then re-render `og-card.png`.

### Remaking the images

`icon.svg` and the cartridge are drawn as whole-cell paths. `favicon-32.png` (the icon at 32 px, transparent) and
`apple-touch-icon.png` (the icon at 160 px on a `#890089` ground, 180 x 180) are screenshots of `icon.svg` in
headless Chrome. The social card's source is `site/tools/art/og-card.html` (it loads the font from `site/page/fonts/`;
`--virtual-time-budget` gives it time to load); render it with absolute paths:

```
"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --hide-scrollbars --window-size=1200,630 --virtual-time-budget=3000 --screenshot=<abs path>/site/page/img/og-card.png file:///<abs path>/site/tools/art/og-card.html
```

To shrink a PNG: `ffmpeg -i in.png -compression_level 100 out.png`; keep the result only when it is smaller.

### Images

The page's screenshots and video posters are WebP files, made from the app's own pictures in `.github/images/`
(the TV's live in `page/img/tv/`, named for what they show, never for a game or a tune). To make or remake one so
the release step can swap a picture without any other notes:

1. **Look first** (see "The privacy look" below), and cover what needs covering in the source picture.
2. **Resize and compress** (ffmpeg with libwebp):
   `ffmpeg -i in.png -vf scale=1920:-2:flags=lanczos -c:v libwebp -quality 82 -compression_level 6 out.webp`.
   Never wider than the source (a 1200 px source such as `themes.png` keeps 1200). `-2` rounds the height to an
   even number, so read the real size from the result (`ffprobe -v error -show_entries stream=width,height -of csv=p=0 out.webp`).
   The TV's screen is about 960 CSS px wide on a desktop, so 1920 keeps the app's text sharp at 2x density (1600 is
   the least that stays legible there). Tune the width and quality until the text stays legible on the TV at 1440
   px and 390 px.
   Each screenshot also has a 960 px copy (`scale=960:-2`, same recipe, `<name>-960.webp`) for phones at 2x and
   desktops at 1x; the `<img>` lists both: `srcset="img/tv/<name>-960.webp 960w, img/tv/<name>.webp 1920w"` and
   `sizes="(min-width: 768px) 960px, 96vw"`, with `src` and `width` / `height` those of the larger file.
3. **Budget**: under 400 KB a file (`check` enforces it), the whole build under 3 MB.
4. **Markup**: `loading="lazy"` with `width` and `height` that match the file, and alt text saying what it shows at
   feature level.

**Video posters** are stored copies; the page never requests YouTube images. Fetch the video's thumbnail once,
`https://i.ytimg.com/vi/<id>/maxresdefault.jpg` (`hqdefault.jpg` when there is no max resolution), and store it
as WebP at about 1280 x 720 with the same recipe (`scale=1280:720`, `-quality 80`). They are the videos' public
thumbnails, kept as published apart from the covers below.

**The privacy look.** Before any picture ships, open it at full size and zoom in on every part. Look for private IP
addresses, local paths with a user name, tokens, e-mail addresses, device names and serial numbers, and any other
personal data. Cover what you find in the *source* picture, before scaling, with a filled box in the colour around
it (sample the surroundings), for example `-vf "drawbox=x=<x>:y=<y>:w=<w>:h=<h>:color=0x<hex>:t=fill,scale=1600:-2:flags=lanczos"`,
and add a line to the covers list. Version numbers shown in the app's header are accepted for now.

**Covers.** One line per site image that carries a cover: what is covered and where (pixels in the source picture).
A cover goes on every size made from that source. Add to this list whenever a cover is added or a picture is remade.

- `file-transfer.png` (`img/tv/watch-folders.webp`): a grey box over a private path at the top of the Watch Folders
  list, already in the source (kept as is); a USB serial number under "TR-2" in the device picker, 92 x 22 at 184, 578
  (`#230d25`).
- `file-transfer-details.png` (`img/tv/file-transfer.webp`): a USB serial number under "TR-1" in the device picker,
  84 x 22 at 167, 527 (`#2c1a2c`). A transfer row behind the dialog is blurred in the source (kept as is).
- `dj-mixer.png` (`img/tv/dj-mixer.webp`): the USB serial numbers in both deck pickers, 64 x 18 at 374, 796 and
  66 x 18 at 2080, 796 (`#08060a`).
- `crt-emulation.png` (`img/tv/crt-effects.webp`): a device name in the dimmed device tree at the lower left,
  100 x 22 at 148, 866 (`#050205`).
- Video posters `mix-preview.webp` (from `PjhqYkmsScg`) and `scratch-preview.webp` (from `xoJBOEPB5IY`): the USB
  serial numbers in the deck pickers at the foot of the frame, boxes 38 x 12 at 196, 699 and 44 x 12 at 1082, 699 in the
  first, 32 x 11 at 171, 565 and 30 x 11 at 987, 565 in the second (colours sampled around each, about `#0d0a10`).
  `crx-interview.webp` (from `ACT5R9AYFKA`) shows the same pickers only as an unreadable blur, and the presenter's
  name as the video's own caption.

## Release regions

Each region in `page/index.html` is three markers around two variants. The names are listed in
`REGIONS` in `tools/lib/config.mjs` (`hero`, `get`).

```html
<!-- release:hero:fallback -->  markup when no release can be read (no version)
<!-- release:hero:stamped -->   markup with {{tag}} {{version}} {{date}} {{dateText}} {{releaseUrl}}
                                {{windows.url}} {{windows.size}} {{linux.*}} {{pi.*}}
<!-- release:hero:end -->
```

The build replaces a region with `<!-- release:hero state=stamped tag=v1.0.0-beta.3 -->`, the chosen
variant, and `<!-- /release:hero -->` (`state=fallback` without a release). Values are HTML-escaped.

## Rules

- Never write a version by hand. The build stamps it.
- Node built-ins only; no `package.json`, no dependency. Any new dependency, web font or workflow
  action is asked about first, with the reason recorded here (the pixel font: see "The pixel font").
- Folder and file names: the root `.gitignore` is the Visual Studio template and silently ignores
  folders named `release`, `releases`, `log`, `logs`, `bin`, `obj`, `debug`, `x64`, `x86`, `arm`,
  `arm64`, `win32`, `bld`, `publish`, `artifacts`, `packages`, `express`, `Backup*` and
  `TestResult*`, and files matching `*.log`, `*.tmp`, `*.cache` and `*.pfx`. Never use those names
  (a file like `releases.mjs` is fine). Run `git check-ignore -v <path>` on every new folder before
  committing.

## Which release the page shows

Drafts and releases whose tag is not SemVer are skipped. Pre-release comes from the version alone
(a `-suffix`); GitHub's `prerelease` flag and its "Latest" mark are ignored. A release is usable
only with a valid `published_at` and all three packages (Windows, Linux, Raspberry Pi) whose
download URLs sit under this repo's release; unusable ones are passed over and logged. The page
shows the highest usable stable release, or the highest usable pre-release when none is stable.

## Publish gate

A publish may go out only when `Version.props` is not ahead of the newest published release (any
non-draft release with a SemVer tag, packages or not), so the page never gets ahead of the
download. With no published release the gate holds. Known limit: once a stable release exists,
publishing a newer pre-release clears the hold although the page keeps showing the stable release.
