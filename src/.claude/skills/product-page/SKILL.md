---
name: product-page
description: 'Change the TeensyROM Suite product page in src/site/ (https://metalhexx.github.io/TeensyROM-Suite/): its copy, sections, pictures, the two TVs and their channels, the How it works diagram and the C64 screen, the DJ Mixer rig, or anything else that moves. Use when editing, previewing, checking or recording the page, or when the release skill''s product page step sends you here. NOT for publishing settings or the release itself; use release.'
---

# product-page

A thin router. **[src/site/AGENTS.md](../../../site/AGENTS.md) is the source of truth** for the page map, the rules,
what `check` enforces and each section's notes. Read it first, then the part that matches the task. Don't restate its
rules here.

## The bar

The page is the suite's front door. It must stay super dope: retro and modern, concise, and at feature level.

- **Replace before adding.** A new card, line, channel or picture takes the place of one, or earns its room against the
  whole section. Say what a change removes as well as what it adds.
- **Keep each section's length and altitude.** A head, one picture or animation, a few short lines. Never a wall of
  text or a feature list that reads like the docs: link to the docs instead.
- **Every claim traces** to the README or `docs/` and to shipped behaviour.
- **Look before you call it done:** 1440, 768 and 390 px (and 320 for overflow), each animation through a full loop,
  and reduced motion.

## Activities

| Task | Where |
|---|---|
| Preview the page while you work | AGENTS.md, "The preview loop" |
| Change copy or a section | AGENTS.md, "The page" and that section's notes |
| Add, remove or reorder a channel on either TV | AGENTS.md, "The TVs" |
| Add or replace a picture | AGENTS.md, "Images", the privacy look and the covers list |
| Change How it works or the C64's screen | AGENTS.md, "How it works (the diagram)" |
| Change the DJ Mixer rig or its tune | AGENTS.md, "DJ Mixer (the rig)" |
| Anything that moves | AGENTS.md, the rules for `page/` (pause, off screen, hidden tab, reduced motion) |
| The page as part of a release | The [release skill](../release/SKILL.md), *Update the product page* |
| How and when it publishes | AGENTS.md, "Publishing" |

## Procedure

1. **Preview.** Start `node src/site/tools/site.mjs dev --offline` in the background and open the page and
   `__dev/preview`. Keep one preview tab open: each frame holds a live-reload connection, and two preview tabs pass
   the browser's six connections to the host, so the frames stop reloading.
2. **Change** `src/site/page/`. Styles change only through classes and custom properties; only transform, opacity and
   filter animate.
3. **Check it in the browser.** Read timed states with JavaScript (classes, `document.getAnimations()`), since
   screenshots lag. For a phone or tablet still without a second preview tab, use headless Chrome or `record.mjs`.
4. **Finish.** `node --test "src/site/tools/test/**/*.test.mjs"`, then `node src/site/tools/site.mjs build` and
   `node src/site/tools/site.mjs check`. Every check passes.
5. **Keep AGENTS.md true.** Update the page map, the section's notes and the covers list for any new picture.
6. **Stop** the preview server you started.

## Report

What changed on the page and what it replaced, the `check` summary (weight and first screen), and stills or a
recording at three widths for the owner. A merge to `main` publishes the page (see "Publishing"), so get the owner's
approval first.
