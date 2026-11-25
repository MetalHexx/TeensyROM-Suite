import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSite, stampPage } from '../lib/build.mjs';
import { SiteError } from '../lib/config.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'page');
const fixtureHtml = fs.readFileSync(path.join(FIXTURE, 'index.html'), 'utf8');

const pkg = (key, size) => ({
  name: `pkg-${key}`,
  url: `https://github.com/MetalHexx/TeensyROM-Suite/releases/download/v1.0.0-beta.3/pkg-${key}`,
  size,
});
const RELEASE = {
  tag: 'v1.0.0-beta.3',
  version: '1.0.0-beta.3',
  date: '2026-11-19',
  releaseUrl: 'https://github.com/MetalHexx/TeensyROM-Suite/releases/tag/v1.0.0-beta.3',
  packages: { windows: pkg('windows', 48_200_000), linux: pkg('linux', 47_000_000), pi: pkg('pi', 1_250_000) },
};

/** A minimal page with both regions; the hero variants are customisable. */
function page({ hero = 'x', fallback = 'fb' } = {}) {
  return `<!-- release:hero:fallback -->${fallback}<!-- release:hero:stamped -->${hero}<!-- release:hero:end -->`
    + '<!-- release:get:fallback -->fb<!-- release:get:stamped -->ok<!-- release:get:end -->';
}

test('a release stamps the stamped variant of every region', () => {
  const out = stampPage(fixtureHtml, RELEASE);
  assert.match(out, /<!-- release:hero state=stamped tag=v1\.0\.0-beta\.3 -->/);
  assert.match(out, /<!-- release:get state=stamped tag=v1\.0\.0-beta\.3 -->/);
  assert.match(out, /<!-- \/release:hero -->/);
  assert.match(out, /<time datetime="2026-11-19">19 Nov 2026<\/time>/);
  assert.match(out, /Windows 48\.2 MB/);
  assert.match(out, /Raspberry Pi 1\.3 MB/);
  assert.ok(out.includes(`href="${RELEASE.packages.linux.url}"`));
  assert.ok(!out.includes('See the releases'));
  assert.ok(!out.includes('{{'));
  assert.ok(!out.includes('release:hero:'));
});

test('without a release the fallback variant stays', () => {
  const out = stampPage(fixtureHtml, null);
  assert.match(out, /<!-- release:hero state=fallback -->/);
  assert.match(out, /<!-- release:get state=fallback -->/);
  assert.ok(out.includes('See the releases'));
  assert.ok(!out.includes('{{'));
});

test('stamped values are escaped as text, never markup', () => {
  const windows = { ...RELEASE.packages.windows, url: 'https://x/?a=1&b="2"<' };
  const hostile = { ...RELEASE, tag: `v1<b>"&'`, packages: { ...RELEASE.packages, windows } };
  const out = stampPage(fixtureHtml, hostile);
  assert.ok(out.includes('v1&lt;b&gt;&quot;&amp;&#39;'));
  assert.ok(out.includes('href="https://x/?a=1&amp;b=&quot;2&quot;&lt;"'));
  assert.ok(!out.includes('<b>'));
});

test('marker misuse stops the build', () => {
  const bad = {
    'a missing region': page().replace(/<!-- release:get:\w+ -->/g, ''),
    'a duplicated marker': `${page()}<!-- release:hero:end -->`,
    'a missing marker': page().replace('<!-- release:hero:stamped -->', ''),
    'markers out of order': page().replace(
      '<!-- release:get:fallback -->fb<!-- release:get:stamped -->ok<!-- release:get:end -->',
      '<!-- release:get:stamped -->ok<!-- release:get:fallback -->fb<!-- release:get:end -->',
    ),
    'an unknown placeholder': page({ hero: '{{nope}}' }),
    'a placeholder in the fallback': page({ fallback: '{{tag}}' }),
    'a region not in REGIONS': `${page()}<!-- release:extra:fallback -->`,
  };
  for (const [label, html] of Object.entries(bad)) {
    assert.throws(() => stampPage(html, RELEASE), SiteError, label);
    assert.throws(() => stampPage(html, null), SiteError, `${label} (fallback build)`);
  }
});

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'site-build-'));

test('buildSite copies the page, stamps index.html and reports it', () => {
  const dir = tempDir();
  try {
    const out = path.join(dir, 'build');
    assert.deepEqual(buildSite({ src: FIXTURE, out, release: RELEASE }), { out, stamped: true });
    assert.ok(fs.existsSync(path.join(out, 'css', 'site.css')));
    const stamped = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.match(stamped, /state=stamped tag=v1\.0\.0-beta\.3/);
    assert.equal(buildSite({ src: FIXTURE, out }).stamped, false);
    assert.match(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), /state=fallback/);
    assert.deepEqual(fs.readdirSync(dir), ['build'], 'no staging folder is left behind');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a failing stamp leaves the existing output untouched', () => {
  const dir = tempDir();
  try {
    const out = path.join(dir, 'build');
    const src = path.join(dir, 'src');
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, 'index.html'), 'last good build');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'index.html'), page({ hero: '{{nope}}' }));
    assert.throws(() => buildSite({ src, out, release: RELEASE }), SiteError);
    assert.equal(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), 'last good build');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['build', 'src']);
    assert.throws(() => buildSite({ src: path.join(dir, 'nowhere'), out }), SiteError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
