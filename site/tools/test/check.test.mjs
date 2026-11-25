import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../lib/build.mjs';
import { checkExternalLinks, checkSite, externalTargets, readSiteFiles } from '../lib/check.mjs';
import { SiteError } from '../lib/config.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'page');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'trom-site-check-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const DOWNLOAD = 'https://github.com/MetalHexx/TeensyROM-Suite/releases/download/v1.0.0-beta.3';
const pkg = (key) => ({ name: `pkg-${key}`, url: `${DOWNLOAD}/pkg-${key}`, size: 48_200_000 });
const RELEASE = {
  tag: 'v1.0.0-beta.3',
  version: '1.0.0-beta.3',
  date: '2026-11-19',
  releaseUrl: 'https://github.com/MetalHexx/TeensyROM-Suite/releases/tag/v1.0.0-beta.3',
  packages: { windows: pkg('windows'), linux: pkg('linux'), pi: pkg('pi') },
};

function builtFiles(release) {
  const out = path.join(scratch, release ? 'stamped' : 'fallback');
  buildSite({ src: FIXTURE, out, release });
  return readSiteFiles(out);
}

const STAMPED = builtFiles(RELEASE);
const FALLBACK = builtFiles(null);

/** `files` with the text of `rel` rewritten by `fn`. */
const edit = (files, rel, fn) =>
  files.map((f) => {
    if (f.rel !== rel) return f;
    const text = fn(f.text);
    return { rel, text, size: Buffer.byteLength(text) };
  });
const editIndex = (files, fn) => edit(files, 'index.html', fn);
const addText = (files, rel, text) => [...files, { rel, text, size: Buffer.byteLength(text) }];
const addBinary = (files, rel, size) => [...files, { rel, text: null, size }];
const replaceOnce = (from, to) => (text) => {
  assert.ok(text.includes(from), `fixture no longer contains ${from}`);
  return text.replace(from, to);
};
const insertInBody = (markup) => replaceOnce('</body>', `${markup}\n</body>`);

const problemsOf = (result, id) => result.checks.find((c) => c.id === id).problems;
const failing = (result) => result.checks.filter((c) => !c.ok).map((c) => c.id);

/** Asserts that exactly the check `id` fails, with a problem matching `pattern`. */
function assertFailsOnly(result, id, pattern) {
  assert.deepEqual(failing(result), [id], JSON.stringify(result.checks.filter((c) => !c.ok)));
  assert.match(problemsOf(result, id).join('\n'), pattern);
}

test('the fixture passes every check, stamped and with fallbacks', () => {
  for (const files of [STAMPED, FALLBACK]) {
    const result = checkSite(files);
    assert.deepEqual(failing(result), []);
    assert.equal(result.ok, true);
    assert.equal(result.files, files.length);
    assert.ok(result.firstScreenBytes > 0 && result.firstScreenBytes <= result.bytes);
  }
});

test('entry: a build without index.html fails', () => {
  const result = checkSite(STAMPED.filter((f) => f.rel !== 'index.html'));
  assert.deepEqual(problemsOf(result, 'entry'), ['index.html is missing']);
  assert.equal(result.ok, false);
});

test('weight: one file over 400 KB', () => {
  assertFailsOnly(checkSite(addBinary(STAMPED, 'img/huge.png', 401 * 1024)), 'weight', /img\/huge\.png is 401\.0 KB/);
});

test('weight: a build over 3 MB', () => {
  let files = STAMPED;
  for (let i = 0; i < 8; i++) files = addBinary(files, `img/part-${i}.png`, 390 * 1024);
  assertFailsOnly(checkSite(files), 'weight', /the build is .* over the 3072\.0 KB budget/);
});

const EAGER_PAIR =
  '<img src="img/a.png" alt="" width="10" height="10">\n<img src="img/b.png" alt="" width="10" height="10">';

test('weight: eager images over 500 KB fail the first screen, lazy ones do not count', () => {
  const sized = addBinary(addBinary(STAMPED, 'img/a.png', 300_000), 'img/b.png', 300_000);
  const eager = checkSite(editIndex(sized, insertInBody(EAGER_PAIR)));
  assertFailsOnly(eager, 'weight', /the first screen is 6\d\d\.\d KB, over the 500\.0 KB budget/);

  const lazy = checkSite(editIndex(sized, insertInBody(EAGER_PAIR.replaceAll('alt=""', 'alt="" loading="lazy"'))));
  assert.deepEqual(failing(lazy), []);
  assert.ok(lazy.firstScreenBytes < 500_000);
});

test('weight: a picture source and a stylesheet url() count towards the first screen', () => {
  const sized = addBinary(addBinary(STAMPED, 'img/a.webp', 300_000), 'img/b.webp', 300_000);
  const picture = '<picture><source srcset="img/a.webp 1x, img/b.webp 2x"><img src="img/mark.svg" alt="" width="1" height="1"></picture>';
  assertFailsOnly(checkSite(editIndex(sized, insertInBody(picture))), 'weight', /first screen/);

  const css = addText(sized, 'css/fonts.css', '@font-face { src: url(../img/a.webp); }\n.x { background: url("../img/b.webp"); }');
  const linked = editIndex(css, replaceOnce('</head>', '<link rel="stylesheet" href="css/fonts.css">\n</head>'));
  assertFailsOnly(checkSite(linked), 'weight', /first screen/);
});

test('links: broken, root-absolute and outside-the-build references fail', () => {
  const files = editIndex(
    STAMPED,
    insertInBody('<a href="missing.html">a</a><img src="/img/mark.svg" alt="" width="1" height="1"><a href="../up.html">b</a><a href="#top">c</a><a href="mailto:a@b.c">d</a>'),
  );
  const result = checkSite(addText(files, 'css/more.css', '.a { background: url(nope.png); }'));
  const problems = problemsOf(result, 'links').join('\n');
  assert.deepEqual(failing(result), ['links']);
  assert.match(problems, /missing\.html does not exist in the build/);
  assert.match(problems, /\/img\/mark\.svg is root-absolute, which breaks under \/TeensyROM-Suite\//);
  assert.match(problems, /\.\.\/up\.html points outside the build/);
  assert.match(problems, /css\/more\.css: url\(nope\.png\) does not exist/);
  assert.doesNotMatch(problems, /#top|mailto/);
});

test('https: an http:// URL fails, the SVG namespace does not', () => {
  const files = editIndex(STAMPED, insertInBody('<svg xmlns="http://www.w3.org/2000/svg"></svg><p>http://example.com/a</p>'));
  const result = checkSite(files);
  assertFailsOnly(result, 'https', /http:\/\/example\.com\/a/);
  assert.equal(problemsOf(result, 'https').length, 1);
});

test('images: alt and numeric width and height are required', () => {
  const files = editIndex(
    STAMPED,
    insertInBody('<img src="img/mark.svg" width="16" height="16"><img src="img/mark.svg" alt="x" width="auto" height="16"><img src="img/mark.svg" alt="">'),
  );
  const problems = problemsOf(checkSite(files), 'images');
  assert.equal(problems.filter((p) => /has no alt/.test(p)).length, 1);
  assert.equal(problems.filter((p) => /numeric width/.test(p)).length, 2);
  assert.equal(problems.filter((p) => /numeric height/.test(p)).length, 1);
});

test('h1: two headings fail', () => {
  assertFailsOnly(checkSite(editIndex(STAMPED, insertInBody('<h1>Second</h1>'))), 'h1', /2 <h1> elements/);
});

test('csp: the policy is compared as a map, in any order', () => {
  const reordered = editIndex(
    STAMPED,
    replaceOnce("default-src 'self'; img-src 'self'", "img-src 'self'; default-src 'self'"),
  );
  assert.deepEqual(failing(checkSite(reordered)), []);
});

test('csp: a loosened, missing or extra directive fails', () => {
  const loosened = checkSite(editIndex(STAMPED, replaceOnce("img-src 'self'", "img-src 'self' https:")));
  assertFailsOnly(loosened, 'csp', /img-src is "'self' https:"/);

  const missing = checkSite(editIndex(STAMPED, replaceOnce("; form-action 'none'", '')));
  assertFailsOnly(missing, 'csp', /form-action is missing/);

  const extra = checkSite(editIndex(STAMPED, replaceOnce("form-action 'none'", "form-action 'none'; connect-src *")));
  assertFailsOnly(extra, 'csp', /connect-src is not allowed/);
});

test('csp: no policy, no referrer policy', () => {
  const none = checkSite(editIndex(STAMPED, (t) => t.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')));
  assert.match(problemsOf(none, 'csp').join('\n'), /found 0/);
  const referrer = checkSite(editIndex(STAMPED, (t) => t.replace(/<meta name="referrer"[^>]*>/, '')));
  assertFailsOnly(referrer, 'csp', /no <meta name="referrer"/);
});

test('csp: inline style, style element, inline script and handler attributes fail', () => {
  const files = editIndex(
    STAMPED,
    insertInBody('<p style="color: red">a</p><style>p { margin: 0 }</style><script>run()</script><button onclick="go()">b</button><script src="js/x.js"></script>'),
  );
  const problems = problemsOf(checkSite(addText(files, 'js/x.js', 'void 0;')), 'csp').join('\n');
  assert.match(problems, /<p> has a style attribute/);
  assert.match(problems, /<style> element/);
  assert.match(problems, /<script> without src/);
  assert.match(problems, /<button> has an onclick handler attribute/);
  assert.equal((problems.match(/<script>/g) ?? []).length, 1);
});

test('dev: a file that mentions __dev fails', () => {
  assertFailsOnly(checkSite(addText(STAMPED, 'js/x.js', "fetch('/__dev/events');")), 'dev', /js\/x\.js mentions __dev/);
});

test('release: regions in different states fail', () => {
  const files = editIndex(STAMPED, replaceOnce('<!-- release:hero state=stamped tag=v1.0.0-beta.3 -->', '<!-- release:hero state=fallback -->'));
  assert.match(problemsOf(checkSite(files), 'release').join('\n'), /regions disagree on state \(hero is fallback, get is stamped\)/);
});

test('release: stamped regions that show different tags fail', () => {
  const files = editIndex(STAMPED, replaceOnce('<!-- release:get state=stamped tag=v1.0.0-beta.3 -->', '<!-- release:get state=stamped tag=v1.0.0-beta.2 -->'));
  const problems = problemsOf(checkSite(files), 'release').join('\n');
  assert.match(problems, /different tags/);
  assert.match(problems, /region "get" does not show its tag v1\.0\.0-beta\.2/);
});

test('release: a stray {{, a source marker and a missing region fail', () => {
  const stray = checkSite(editIndex(STAMPED, insertInBody('<p>{{tag}}</p>')));
  assert.match(problemsOf(stray, 'release').join('\n'), /unfilled \{\{ placeholder/);

  const marker = checkSite(editIndex(STAMPED, insertInBody('<!-- release:hero:end -->')));
  assert.match(problemsOf(marker, 'release').join('\n'), /source release marker/);

  const missing = checkSite(editIndex(STAMPED, replaceOnce('<!-- /release:get -->', '')));
  assert.match(problemsOf(missing, 'release').join('\n'), /region "get" has 1 opening and 0 closing markers/);
});

test('release: a download link must sit under the shown tag, and needs one', () => {
  const other = checkSite(editIndex(STAMPED, insertInBody(`<a href="${DOWNLOAD.replace('beta.3', 'beta.2')}/pkg" rel="noreferrer">old</a>`)));
  assert.match(problemsOf(other, 'release').join(' '), /is not under https:\/\/github\.com\/MetalHexx\/TeensyROM-Suite\/releases\/download\/v1\.0\.0-beta\.3\//);

  const fallback = checkSite(editIndex(FALLBACK, insertInBody(`<a href="${DOWNLOAD}/pkg" rel="noreferrer">x</a>`)));
  assert.match(problemsOf(fallback, 'release').join(' '), /no release tag is shown/);
});

test('version: a hand-written version fails outside regions, comments and SVG', () => {
  const written = checkSite(editIndex(STAMPED, insertInBody('<p>Get v1.2.3 today</p>')));
  assertFailsOnly(written, 'version', /index\.html: hand-written version "v1\.2\.3"/);

  const allowed = checkSite(
    editIndex(STAMPED, insertInBody('<!-- 2.0.0 --><svg><text>v1.2.3</text></svg>')),
  );
  assert.deepEqual(failing(allowed), []);
  assert.ok(STAMPED.find((f) => f.rel === 'index.html').text.includes(RELEASE.tag));

  const script = checkSite(addText(STAMPED, 'js/x.js', "// 9.9.9 is a comment\nconst v = '1.2.3-rc.1';"));
  const problems = problemsOf(script, 'version');
  assert.deepEqual(problems, ['js/x.js: hand-written version "1.2.3-rc.1"']);
});

test('head: a missing og:url, a wrong og:url, no lang and no title fail', () => {
  const missing = checkSite(editIndex(STAMPED, (t) => t.replace(/<meta property="og:url"[^>]*>/, '')));
  assertFailsOnly(missing, 'head', /no <meta property="og:url">/);

  const wrong = checkSite(editIndex(STAMPED, replaceOnce('content="https://metalhexx.github.io/TeensyROM-Suite/">\n  <link', 'content="https://example.org/">\n  <link')));
  assertFailsOnly(wrong, 'head', /og:url is "https:\/\/example\.org\/", expected "https:\/\/metalhexx\.github\.io\/TeensyROM-Suite\/"/);

  const bare = checkSite(editIndex(STAMPED, (t) => t.replace('<html lang="en">', '<html>').replace(/<title>[^<]*<\/title>/, '')));
  const problems = problemsOf(bare, 'head').join('\n');
  assert.match(problems, /<html> has no lang/);
  assert.match(problems, /no <title>/);
});

test('external: a link to another origin needs rel noreferrer', () => {
  const files = editIndex(STAMPED, insertInBody('<a href="https://example.org/">x</a><a href="//example.org/y" rel="noopener">y</a><a href="https://example.org/z" rel="nofollow noreferrer">z</a>'));
  const problems = problemsOf(checkSite(files), 'external');
  assert.deepEqual(problems, [
    'index.html: https://example.org/ has no rel="noreferrer"',
    'index.html: //example.org/y has no rel="noreferrer"',
  ]);
});

test('wording: an AI tool name fails in alt text, a meta tag and visible text', () => {
  const alt = checkSite(editIndex(STAMPED, insertInBody('<img src="img/mark.svg" alt="Drawn by Claude" width="1" height="1">')));
  assertFailsOnly(alt, 'wording', /alt "Drawn by Claude" names "Claude"/);

  const og = checkSite(editIndex(STAMPED, replaceOnce('<meta property="og:description" content="A page', '<meta property="og:description" content="Built with claude. A page')));
  assertFailsOnly(og, 'wording', /og:description names "claude"/);

  const text = checkSite(editIndex(STAMPED, insertInBody('<p>Made with Anthropic tools</p>')));
  assertFailsOnly(text, 'wording', /text names "Anthropic"/);
});

test('wording: an internal project name fails, licence ids and C-64 do not', () => {
  const name = checkSite(editIndex(STAMPED, replaceOnce('<h1>Fixture page</h1>', '<h1>Fixture ASID-DJ-12</h1>')));
  assertFailsOnly(name, 'wording', /internal project name "ASID-DJ-12"/);

  const fine = checkSite(editIndex(STAMPED, insertInBody('<footer>Font under OFL-1.1, text CC-BY-4.0, for the C-64</footer>')));
  assert.deepEqual(failing(fine), []);
});

test('every failing check is reported in one run', () => {
  const files = editIndex(STAMPED, insertInBody('<h1>Two</h1><p>v3.3.3</p><p>Claude</p>'));
  assert.deepEqual(failing(checkSite(files)), ['h1', 'version', 'wording']);
});

test('readSiteFiles: a missing folder is a SiteError with a hint', () => {
  assert.throws(
    () => readSiteFiles(path.join(scratch, 'nope')),
    (err) => err instanceof SiteError && /there is no build/.test(err.message) && Boolean(err.hint),
  );
});

test('external links: the targets exclude the live site, downloads and meta URLs', () => {
  const files = editIndex(
    STAMPED,
    insertInBody('<a href="https://example.org/a#x" rel="noreferrer">a</a><a href="https://example.org/a" rel="noreferrer">a</a><a href="https://metalhexx.github.io/TeensyROM-Suite/x" rel="noreferrer">s</a><a href="img/mark.svg">l</a>'),
  );
  assert.deepEqual(externalTargets(files), [
    'https://example.org/a',
    'https://github.com/MetalHexx/TeensyROM-Suite/releases/tag/v1.0.0-beta.3',
  ]);
});

test('external links: HEAD falls back to GET, 4xx and network errors fail', async () => {
  const files = editIndex(
    STAMPED,
    insertInBody('<a href="https://ok.test/" rel="noreferrer">a</a><a href="https://head-refused.test/" rel="noreferrer">b</a><a href="https://gone.test/" rel="noreferrer">c</a><a href="https://down.test/" rel="noreferrer">d</a>'),
  );
  const calls = [];
  const fetchImpl = async (url, { method, headers }) => {
    calls.push(`${method} ${new URL(url).host}`);
    assert.equal(headers['User-Agent'], 'teensyrom-suite-site');
    const host = new URL(url).host;
    if (host === 'down.test') throw new TypeError('fetch failed');
    const status = host === 'gone.test' ? 404 : host === 'head-refused.test' && method === 'HEAD' ? 405 : 200;
    return { status, body: { cancel: async () => {} } };
  };
  const result = await checkExternalLinks(files, { fetchImpl });
  assert.equal(result.id, 'external-links');
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems, ['https://down.test/ answered fetch failed', 'https://gone.test/ answered 404']);
  assert.ok(calls.includes('HEAD head-refused.test') && calls.includes('GET head-refused.test'));
  assert.ok(!calls.includes('GET ok.test'));
});
