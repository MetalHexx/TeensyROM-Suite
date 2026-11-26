import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareSemVer, formatSemVer, isPreRelease, parseSemVer } from '../lib/semver.mjs';

const cmp = (a, b) => compareSemVer(parseSemVer(a), parseSemVer(b));

test('numeric pre-release identifiers compare as numbers', () => {
  assert.equal(cmp('1.0.0-beta.10', '1.0.0-beta.9'), 1);
  assert.equal(cmp('1.0.0-beta.2', '1.0.0-beta.11'), -1);
});

test('alphanumeric identifiers compare ordinally and rank above numeric ones', () => {
  assert.equal(cmp('1.0.0-alpha.1', '1.0.0-beta.1'), -1);
  assert.equal(cmp('1.0.0-beta.1', '1.0.0-1'), 1);
});

test('a release ranks above its pre-releases', () => {
  assert.equal(cmp('1.0.0', '1.0.0-rc.1'), 1);
  assert.equal(cmp('1.0.0-rc.1', '1.0.0'), -1);
});

test('fewer identifiers rank lower', () => {
  assert.equal(cmp('1.0.0-beta', '1.0.0-beta.1'), -1);
});

test('core versions compare numerically', () => {
  assert.equal(cmp('1.10.0', '1.9.9'), 1);
  assert.equal(cmp('2.0.0', '10.0.0'), -1);
});

test('build metadata and a leading v are ignored', () => {
  assert.equal(cmp('v1.2.3+abc', '1.2.3+xyz'), 0);
  assert.deepEqual(parseSemVer('v1.2.3+abc'), { major: 1, minor: 2, patch: 3, pre: '' });
});

test('junk is rejected', () => {
  for (const junk of ['', '1.0', 'v1', '01.0.0', '1.0.0-', '1.0.0-01', 'latest', null, undefined, 3]) {
    assert.equal(parseSemVer(junk), null, String(junk));
  }
});

test('isPreRelease and formatSemVer', () => {
  const beta = parseSemVer('v1.0.0-beta.3');
  assert.equal(isPreRelease(beta), true);
  assert.equal(isPreRelease(parseSemVer('1.0.0')), false);
  assert.equal(formatSemVer(beta), '1.0.0-beta.3');
  assert.equal(formatSemVer(parseSemVer('2.1.0')), '2.1.0');
});
