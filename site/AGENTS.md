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
| `index.html` | The whole page: head, skip link, sticky header, `<main>` (hero, then `#get`), footer. Holds the inline-SVG art (`#cart-art`, `#voices-art`). |
| `css/site.css` | Tokens, base, components, header, hero, footer, keyframes, reduced motion, in that order. |
| `js/site.js` | Adds the `js` class, scroll reveal, the cursor-following card glow, cursor blinking in view, the cartridge's replay on hover. Progressive: the page reads without it. |
| `img/` | `icon.svg` (the header icon, 16 cells), `favicon-32.png`, `apple-touch-icon.png`, `og-card.png`, `glow.svg` (the Web UI's background glows, fixed behind the page). |
| `fonts/` | The self-hosted pixel font (Web437 IBM VGA 8x16) and its licence file; see "The pixel font". |

Rules for every file in `page/`:

- Relative URLs for the page's own files (`css/site.css`, never `/css/...`). Docs are absolute
  `https://github.com/MetalHexx/TeensyROM-Suite/blob/main/docs/...` links. Every external link has `rel="noreferrer"`.
- Keep the CSP meta. No inline `<style>`, `<script>` or `style=""`; JS styles only through classes and CSS
  custom properties (it may set `hidden`, `aria-*`, `loading`, text, and insert the YouTube iframe on a click).
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
  `[data-reveal]` fade-and-rise for elements below the first screen only; `.cursor`.

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
