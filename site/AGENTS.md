# site/

The product page for https://metalhexx.github.io/TeensyROM-Suite/. A static page, built with a
Node-only toolchain that stamps the newest release (version, date, download links) into it.

## Layout

| Path | What |
|------|------|
| `site/page/` | The page source. Only this folder is copied into a build. |
| `site/tools/` | The toolchain: `site.mjs` (CLI) and `lib/` (config, semver, releases, build). |
| `site/tools/test/` | Unit tests and the fixture page. |
| `site/build/` | Build output. Git-ignored. |

## Commands

Run from the repo root.

```
node site/tools/site.mjs build [--offline] [--src <dir>] [--out <dir>]
node site/tools/site.mjs gate
node --test "site/tools/test/*.test.mjs"
```

- `build` looks up the release once and stamps it into every release region of `index.html`.
  `--offline` skips the lookup and keeps the fallback markup. A failed lookup is a warning, not a
  failure; the build keeps the fallbacks.
- `gate` prints `publish=true|false` and the reason. It appends `publish=...` to `$GITHUB_OUTPUT`
  when that is set. When the releases cannot be read it exits 1: holding blind beats publishing
  blind.

Environment: `SITE_GITHUB_API` replaces the GitHub API base (tests, local use); `GITHUB_TOKEN` (or
`GH_TOKEN`) is sent only to `https://api.github.com`.

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
  action is asked about first, with the reason recorded here.
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
