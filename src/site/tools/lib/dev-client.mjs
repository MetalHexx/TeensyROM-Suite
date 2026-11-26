/**
 * The dev client the preview server injects into served pages, and the three-width preview page,
 * kept as strings so `tools/` stays all `.mjs`. The injected script and style are same-origin and
 * CSP-clean: no inline `<style>`, no `style=""` markup. The preview page is a tool page the server
 * generates, not part of the site, so it is not under the site's CSP and carries its own `<style>`.
 * No template here has backticks, `${` or backslashes, so each reaches the browser as written.
 */
import { BASE_PATH } from './config.mjs';

const fill = (template) => template.replaceAll('@BASE@', BASE_PATH);

/**
 * `__dev/dev.js`: live reload on the server's `reload` event, and the font trial. The trial reads
 * `__dev/fonts/fonts.json` and, when it lists fonts, loads `__dev/fonts/trial.css` and shows a
 * switcher panel (buttons and number keys) that sets `data-font` on `<html>` and remembers the
 * choice. A page URL with `?clean` gets no panel and no keys; the remembered font still applies.
 */
export const DEV_JS = fill(`(function () {
  'use strict';

  var EVENTS_URL = '@BASE@__dev/events';
  var FONTS_URL = '@BASE@__dev/fonts/';
  var STORAGE_KEY = 'trom-site-dev-font';
  var clean = /[?&]clean(?:[=&]|$)/.test(location.search);

  var source = new EventSource(EVENTS_URL);
  source.addEventListener('reload', function () {
    location.reload();
  });

  function readSaved() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }

  function save(key) {
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch (err) {
      /* storage is blocked: the choice just will not persist */
    }
  }

  async function loadFontTrial() {
    var fonts;
    try {
      var res = await fetch(FONTS_URL + 'fonts.json', { cache: 'no-store' });
      if (!res.ok) return;
      fonts = await res.json();
    } catch (err) {
      return;
    }
    if (!Array.isArray(fonts)) return;
    fonts = fonts.filter(function (font) {
      return font && typeof font.key === 'string' && font.key !== '' && font.key !== '0' && typeof font.name === 'string';
    });
    if (fonts.length === 0) return;

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONTS_URL + 'trial.css';
    document.head.appendChild(link);

    var keys = fonts.map(function (font) {
      return font.key;
    }).concat(['0']);
    var buttons = new Map();
    function select(key, persist) {
      if (key === '0') delete document.documentElement.dataset.font;
      else document.documentElement.dataset.font = key;
      buttons.forEach(function (button, buttonKey) {
        button.classList.toggle('is-active', buttonKey === key);
        button.setAttribute('aria-pressed', String(buttonKey === key));
      });
      if (persist) save(key);
    }

    var saved = readSaved();
    select(keys.indexOf(saved) >= 0 ? saved : fonts[0].key, false);
    if (clean) return;

    var panel = document.createElement('div');
    panel.className = 'trom-dev-fonts';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', 'Font trial (dev only)');
    var title = document.createElement('div');
    title.className = 'trom-dev-fonts__title';
    title.textContent = 'dev · font trial';
    panel.appendChild(title);

    fonts.concat([{ key: '0', name: 'fallback' }]).forEach(function (font) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'trom-dev-fonts__item';
      button.textContent = font.key + ' · ' + font.name;
      button.addEventListener('click', function () {
        select(font.key, true);
      });
      buttons.set(font.key, button);
      panel.appendChild(button);
    });
    document.body.appendChild(panel);
    select(document.documentElement.dataset.font || '0', false);

    document.addEventListener('keydown', function (event) {
      if (event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return;
      var active = document.activeElement;
      if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return;
      if (buttons.has(event.key)) select(event.key, true);
    });
  }

  loadFontTrial();
})();
`);

/** `__dev/dev.css`: the font-trial panel, clearly dev-only and isolated from the page's styles. */
export const DEV_CSS = `.trom-dev-fonts {
  all: initial;
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 2147483647;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 176px;
  padding: 8px;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #f0f0f0;
  background: rgba(16, 16, 16, 0.94);
  border: 1px dashed #b0b090;
  border-radius: 6px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.55);
}

.trom-dev-fonts__title {
  padding: 0 4px 4px;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #b0b090;
}

.trom-dev-fonts__item {
  all: unset;
  box-sizing: border-box;
  padding: 3px 6px;
  border-radius: 3px;
  color: #f0f0f0;
  cursor: pointer;
}

.trom-dev-fonts__item:hover {
  background: rgba(240, 240, 240, 0.12);
}

.trom-dev-fonts__item:focus-visible {
  outline: 2px solid #70d030;
  outline-offset: 1px;
}

.trom-dev-fonts__item.is-active {
  color: #101010;
  background: #50d010;
}

@media print {
  .trom-dev-fonts {
    display: none;
  }
}
`;

const PREVIEW_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TeensyROM Suite preview (dev)</title>
  <style>
    :root {
      color-scheme: dark;
      --scale: 0.55;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 20px 24px 32px;
      color: #aab0a6;
      background: #0b0f0a;
      font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .bar {
      margin: 0 0 16px;
      font-size: 11px;
      font-weight: normal;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #6f776b;
    }

    .frames {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: 24px;
    }

    .frame {
      margin: 0;
    }

    .frame--desktop {
      --w: 1440;
      --h: 900;
    }

    .frame--tablet {
      --w: 768;
      --h: 1024;
    }

    .frame--phone {
      --w: 390;
      --h: 844;
    }

    .frame__label {
      margin: 0 0 8px;
      letter-spacing: 0.04em;
    }

    .frame__box {
      overflow: hidden;
      width: calc(var(--w) * var(--scale) * 1px);
      height: calc(var(--h) * var(--scale) * 1px);
      outline: 1px solid #243022;
    }

    .frame__view {
      display: block;
      width: calc(var(--w) * 1px);
      height: calc(var(--h) * 1px);
      border: 0;
      background: #ffffff;
      transform: scale(var(--scale));
      transform-origin: 0 0;
    }
  </style>
</head>
<body>
  <h1 class="bar">dev preview · reloads on save</h1>
  <div class="frames">
    <figure class="frame frame--desktop">
      <figcaption class="frame__label">Desktop · 1440</figcaption>
      <div class="frame__box"><iframe class="frame__view" src="@BASE@" title="Desktop, 1440 px wide"></iframe></div>
    </figure>
    <figure class="frame frame--tablet">
      <figcaption class="frame__label">Tablet · 768</figcaption>
      <div class="frame__box"><iframe class="frame__view" src="@BASE@" title="Tablet, 768 px wide"></iframe></div>
    </figure>
    <figure class="frame frame--phone">
      <figcaption class="frame__label">Phone · 390</figcaption>
      <div class="frame__box"><iframe class="frame__view" src="@BASE@" title="Phone, 390 px wide"></iframe></div>
    </figure>
  </div>
  <script>
    // A hash opens every frame at that section (__dev/preview#tv); ?clean is passed on to the frames.
    var suffix = (/[?&]clean(?:[=&]|$)/.test(location.search) ? '?clean' : '') + location.hash;
    if (suffix) {
      document.querySelectorAll('.frame__view').forEach(function (frame) {
        frame.src = frame.getAttribute('src') + suffix;
      });
    }
  </script>
</body>
</html>
`;

/**
 * `__dev/preview`: the page at desktop (1440), tablet (768) and phone (390) widths side by side,
 * each a same-origin iframe at its real width scaled down with CSS. `base` is the site's served
 * path, e.g. `/TeensyROM-Suite/`. The frames reload themselves through the injected dev client.
 * A hash on the preview's URL (`#tv`) opens every frame at that section; `?clean` is passed on.
 */
export const previewHtml = (base) => PREVIEW_TEMPLATE.replaceAll('@BASE@', base);
