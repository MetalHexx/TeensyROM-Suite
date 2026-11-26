import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULT_API_BASE, SiteError } from '../lib/config.mjs';
import {
  decideGate,
  fetchReleases,
  githubApi,
  newestPublished,
  readPropsVersion,
  selectRelease,
} from '../lib/releases.mjs';

const REPO = 'https://github.com/MetalHexx/TeensyROM-Suite';
const SUFFIXES = { windows: 'win-x64.zip', linux: 'linux-x64.tar.gz', pi: 'linux-arm64.tar.gz' };

/** A feed entry; `omit` drops a package, `overrides` replaces top-level fields. */
function release(tag, { omit = [], overrides = {}, assetUrlTag = tag } = {}) {
  const version = tag.replace(/^v/, '');
  const assets = Object.entries(SUFFIXES)
    .filter(([key]) => !omit.includes(key))
    .map(([, suffix]) => {
      const name = `TeensyROM-Suite-${version}-${suffix}`;
      return {
        name,
        size: 48_200_000,
        browser_download_url: `${REPO}/releases/download/${assetUrlTag}/${name}`,
      };
    });
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: '2026-11-19T06:16:32Z',
    assets,
    ...overrides,
  };
}

const shownTag = (releases) => selectRelease(releases).release?.tag;

test('a normal release is stamped from its tag, date and assets', () => {
  const { release: shown, passedOver } = selectRelease([release('v1.0.0-beta.3')]);
  assert.deepEqual(passedOver, []);
  assert.equal(shown.tag, 'v1.0.0-beta.3');
  assert.equal(shown.version, '1.0.0-beta.3');
  assert.equal(shown.date, '2026-11-19');
  assert.equal(shown.releaseUrl, `${REPO}/releases/tag/v1.0.0-beta.3`);
  assert.equal(shown.packages.pi.name, 'TeensyROM-Suite-1.0.0-beta.3-linux-arm64.tar.gz');
  assert.equal(shown.packages.windows.size, 48_200_000);
  assert.ok(shown.packages.linux.url.startsWith(`${REPO}/releases/download/v1.0.0-beta.3/`));
});

test('with only pre-releases the highest wins', () => {
  const feed = [release('v1.0.0-beta.2'), release('v1.0.0-beta.10'), release('v1.0.0-beta.9')];
  assert.equal(shownTag(feed), 'v1.0.0-beta.10');
});

test('a stable release beats a newer pre-release', () => {
  assert.equal(shownTag([release('v1.1.0-beta.1'), release('v1.0.0'), release('v0.9.0')]), 'v1.0.0');
});

test('GitHub prerelease flags are ignored', () => {
  const flaggedStable = release('v1.0.0', { overrides: { prerelease: true } });
  const unflaggedBeta = release('v1.1.0-beta.1', { overrides: { prerelease: false } });
  assert.equal(shownTag([unflaggedBeta, flaggedStable]), 'v1.0.0');
  assert.equal(shownTag([unflaggedBeta, release('v1.0.0-beta.1')]), 'v1.1.0-beta.1');
});

test('a newest release missing a package is passed over for the previous complete one', () => {
  const result = selectRelease([release('v1.0.0-beta.4', { omit: ['pi'] }), release('v1.0.0-beta.3')]);
  assert.equal(result.release.tag, 'v1.0.0-beta.3');
  assert.deepEqual(result.passedOver, [
    'v1.0.0-beta.4 has no TeensyROM-Suite-1.0.0-beta.4-linux-arm64.tar.gz',
  ]);
});

test('no usable release gives a fallback', () => {
  const result = selectRelease([release('v1.0.0-beta.1', { omit: ['pi'] }), 'junk', null]);
  assert.equal(result.release, undefined);
  assert.equal(typeof result.fallback, 'string');
  assert.equal(result.passedOver.length, 1);
  assert.equal(typeof selectRelease([]).fallback, 'string');
  assert.equal(typeof selectRelease('not a list').fallback, 'string');
});

test('a download URL on another repo or tag is unusable', () => {
  const otherTag = release('v1.0.0-beta.4', { assetUrlTag: 'v1.0.0-beta.3' });
  const otherRepo = release('v1.0.0-beta.5');
  otherRepo.assets[0].browser_download_url =
    'https://github.com/someone/else/releases/download/v1.0.0-beta.5/x.zip';
  const result = selectRelease([otherRepo, otherTag, release('v1.0.0-beta.3')]);
  assert.equal(result.release.tag, 'v1.0.0-beta.3');
  assert.equal(result.passedOver.length, 2);
});

test('a bad published_at or size is unusable', () => {
  const noDate = release('v1.0.0-beta.5', { overrides: { published_at: 'yesterday' } });
  const noSize = release('v1.0.0-beta.4');
  noSize.assets[1].size = '48 MB';
  assert.equal(shownTag([noDate, noSize, release('v1.0.0-beta.3')]), 'v1.0.0-beta.3');
});

test('drafts and non-SemVer tags are skipped', () => {
  const draft = release('v2.0.0', { overrides: { draft: true } });
  const nightly = release('nightly');
  const feed = [draft, nightly, release('v1.0.0-beta.3')];
  assert.equal(shownTag(feed), 'v1.0.0-beta.3');
  assert.equal(newestPublished(feed), 'v1.0.0-beta.3');
});

test('newestPublished counts releases without packages and returns null for none', () => {
  const bare = release('v1.0.0-beta.4', { omit: ['windows', 'linux', 'pi'] });
  assert.equal(newestPublished([bare, release('v1.0.0-beta.3')]), 'v1.0.0-beta.4');
  assert.equal(newestPublished([]), null);
});

test('the gate holds when Version.props is ahead of the newest release', () => {
  const result = decideGate({ propsVersion: '1.0.0-beta.4', releases: [release('v1.0.0-beta.3')] });
  assert.equal(result.publish, false);
  assert.equal(result.newest, 'v1.0.0-beta.3');
  assert.match(result.reason, /1\.0\.0-beta\.4.*v1\.0\.0-beta\.3/);
});

test('the gate publishes when Version.props equals or trails the newest release', () => {
  const releases = [release('v1.0.0-beta.3'), release('v1.0.0-beta.2')];
  assert.equal(decideGate({ propsVersion: '1.0.0-beta.3', releases }).publish, true);
  assert.equal(decideGate({ propsVersion: '1.0.0-beta.2', releases }).publish, true);
});

test('the gate holds with no published release and rejects a junk props version', () => {
  assert.equal(decideGate({ propsVersion: '1.0.0', releases: [] }).publish, false);
  const draftOnly = [release('v1.0.0', { overrides: { draft: true } })];
  assert.equal(decideGate({ propsVersion: '1.0.0', releases: draftOnly }).publish, false);
  assert.throws(() => decideGate({ propsVersion: 'x', releases: [] }), SiteError);
});

test('readPropsVersion reads the first <Version>', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'props-'));
  try {
    const file = path.join(dir, 'Version.props');
    fs.writeFileSync(file, '<Project><PropertyGroup><Version> 1.2.3-beta.1 </Version></PropertyGroup></Project>');
    assert.equal(readPropsVersion(file), '1.2.3-beta.1');
    fs.writeFileSync(file, '<Project />');
    assert.throws(() => readPropsVersion(file), SiteError);
    fs.writeFileSync(file, '<Project><Version>one</Version></Project>');
    assert.throws(() => readPropsVersion(file), SiteError);
    assert.throws(() => readPropsVersion(path.join(dir, 'missing.props')), SiteError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('githubApi reads the base and token from the environment', () => {
  assert.deepEqual(githubApi({}), { apiBase: DEFAULT_API_BASE, token: undefined });
  const env = { SITE_GITHUB_API: 'http://x', GH_TOKEN: 't' };
  assert.deepEqual(githubApi(env), { apiBase: 'http://x', token: 't' });
});

/** Runs `fn` against a throwaway server on port 0 that answers with `handler`. */
async function withServer(handler, fn) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req);
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const reply = (body, status = 200) => (_req, res) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

test('fetchReleases returns the list from the releases endpoint', async () => {
  await withServer(reply([release('v1.0.0-beta.3')]), async (apiBase, requests) => {
    const result = await fetchReleases({ apiBase, token: 'secret' });
    assert.equal(result.ok, true);
    assert.equal(result.releases.length, 1);
    assert.equal(requests[0].url, '/repos/MetalHexx/TeensyROM-Suite/releases?per_page=30');
    assert.equal(requests[0].headers['user-agent'], 'teensyrom-suite-site');
    assert.equal(requests[0].headers['x-github-api-version'], '2022-11-28');
    assert.equal(requests[0].headers.authorization, undefined, 'token must not leave api.github.com');
  });
});

test('fetchReleases reports HTTP errors, non-JSON and non-array bodies', async () => {
  await withServer(reply({}, 500), async (apiBase) => {
    const result = await fetchReleases({ apiBase });
    assert.equal(result.ok, false);
    assert.match(result.reason, /HTTP 500/);
  });
  await withServer(reply('<html>nope</html>'), async (apiBase) => {
    const result = await fetchReleases({ apiBase });
    assert.equal(result.ok, false);
    assert.match(result.reason, /not JSON/);
  });
  await withServer(reply({ message: 'rate limited' }), async (apiBase) => {
    const result = await fetchReleases({ apiBase });
    assert.equal(result.ok, false);
    assert.match(result.reason, /list of releases/);
  });
});

test('fetchReleases gives up on a server that never answers', async () => {
  await withServer(() => {}, async (apiBase) => {
    const result = await fetchReleases({ apiBase, timeoutMs: 100 });
    assert.equal(result.ok, false);
    assert.match(result.reason, /did not answer/);
  });
});

test('fetchReleases reports a closed port', async () => {
  const closed = await withServer(reply([]), async (apiBase) => apiBase);
  const result = await fetchReleases({ apiBase: closed, timeoutMs: 2000 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /cannot reach/);
});
