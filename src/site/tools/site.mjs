#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildSite } from './lib/build.mjs';
import { checkExternalLinks, checkSite, readSiteFiles } from './lib/check.mjs';
import { SiteError, paths } from './lib/config.mjs';
import {
  decideGate,
  fetchReleases,
  githubApi,
  readPropsVersion,
  selectRelease,
} from './lib/releases.mjs';
import { DEFAULT_PORT, startSiteServer } from './lib/serve.mjs';

const USAGE = `usage: node src/site/tools/site.mjs <command>

  build [--offline] [--src <dir>] [--out <dir>]   build the page, stamped with the newest release
  gate                                            print publish=true|false for the Pages workflow
  check [--out <dir>] [--external]                check the build (--external also asks the network about links)
  dev [--port <n>] [--offline] [--src <dir>]      serve the page with live reload and a three-width preview`;

class UsageError extends Error {}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateText(date) {
  const [year, month, day] = date.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

function parse(args, options) {
  try {
    const { values, positionals } = parseArgs({ args, options, allowPositionals: true });
    if (positionals.length > 0) throw new UsageError(`unexpected argument "${positionals[0]}"`);
    return values;
  } catch (err) {
    if (err instanceof UsageError) throw err;
    throw new UsageError(err.message);
  }
}

/**
 * Looks the newest usable release up, logging what was passed over.
 * @returns {Promise<{ release: object | null, kept: string }>} `kept` says why the fallback stays.
 */
async function lookupRelease() {
  const fetched = await fetchReleases(githubApi());
  if (!fetched.ok) {
    console.warn(`warning: cannot read releases: ${fetched.reason}`);
    return { release: null, kept: fetched.reason };
  }
  const picked = selectRelease(fetched.releases);
  for (const reason of picked.passedOver) console.log(`passed over: ${reason}`);
  return picked.release ? { release: picked.release, kept: '' } : { release: null, kept: picked.fallback };
}

async function build(args) {
  const opts = parse(args, {
    offline: { type: 'boolean' },
    src: { type: 'string' },
    out: { type: 'string' },
  });
  const { release, kept } = opts.offline ? { release: null, kept: 'offline' } : await lookupRelease();
  const { out } = buildSite({
    ...(opts.src && { src: path.resolve(opts.src) }),
    ...(opts.out && { out: path.resolve(opts.out) }),
    release,
  });
  console.log(
    release
      ? `built ${out} (stamped ${release.tag}, ${dateText(release.date)})`
      : `built ${out} (fallback kept: ${kept})`,
  );
  return 0;
}

async function gate(args) {
  parse(args, {});
  const propsVersion = readPropsVersion();
  const fetched = await fetchReleases(githubApi());
  if (!fetched.ok) {
    throw new SiteError(`cannot tell whether the page is ahead of the release: ${fetched.reason}`);
  }
  const { publish, reason } = decideGate({ propsVersion, releases: fetched.releases });
  console.log(`publish=${publish}`);
  console.log(reason);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::notice title=Pages::${reason}`);
  return 0;
}

const kib = (bytes) => (bytes / 1024).toFixed(1);

/** Prints `PASS/FAIL  <title>` and one `- <problem>` line per problem. */
function printChecks(checks) {
  for (const check of checks) {
    console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.title}`);
    for (const problem of check.problems) console.log(`  - ${problem}`);
  }
}

function printLinkTable(results) {
  const width = Math.max(0, ...results.map((r) => r.url.length));
  console.log('\nexternal links');
  for (const r of results) console.log(`  ${r.url.padEnd(width)}  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.detail}`);
}

async function check(args) {
  const opts = parse(args, { out: { type: 'string' }, external: { type: 'boolean' } });
  const files = readSiteFiles(opts.out ? path.resolve(opts.out) : paths.buildDir);
  const result = checkSite(files);
  const checks = [...result.checks];
  let linkResults = null;
  if (opts.external) {
    const external = await checkExternalLinks(files);
    linkResults = external.results;
    checks.push(external);
  }
  printChecks(checks);
  if (linkResults) printLinkTable(linkResults);
  const passed = checks.filter((c) => c.ok).length;
  const counted = passed === checks.length ? `${passed}` : `${passed} of ${checks.length}`;
  console.log(
    `\n${counted} checks passed (${result.files} files, ${kib(result.bytes)} KB, first screen ${(result.firstScreenBytes / 1000).toFixed(1)} KB)`,
  );
  if (checks.every((c) => c.ok)) return 0;
  console.error('hint: Fix src/site/page/, then run build and check again.');
  return 1;
}

async function dev(args) {
  const opts = parse(args, { port: { type: 'string' }, offline: { type: 'boolean' }, src: { type: 'string' } });
  const port = opts.port === undefined ? DEFAULT_PORT : Number(opts.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`--port must be a whole number from 0 to 65535, got "${opts.port}"`);
  }
  const { release, kept } = opts.offline ? { release: null, kept: 'offline' } : await lookupRelease();
  const server = await startSiteServer({
    ...(opts.src && { src: path.resolve(opts.src) }),
    release,
    port,
    log: {
      ok: (message) => console.log(message),
      warn: (message) => console.warn(`warning: ${message}`),
      error: (message) => console.error(`error: ${message}`),
    },
  });
  console.log(release ? `stamped ${release.tag}` : `fallback markup (${kept})`);
  console.log(`page     ${server.url}`);
  console.log(`preview  ${server.previewUrl}`);
  console.log('Ctrl+C to stop.');
  await new Promise((resolve) => {
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, resolve);
  });
  await server.close();
  return 0;
}

const COMMANDS = { build, gate, check, dev };

/**
 * Runs the CLI. Exit codes: 0 ok, 1 failure, 2 usage error.
 * @param {string[]} argv Arguments after `node site.mjs`.
 * @returns {Promise<number>}
 */
async function main(argv) {
  const [name, ...rest] = argv;
  try {
    const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : null;
    if (!command) throw new UsageError(name ? `unknown command "${name}"` : 'no command given');
    return await command(rest);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`error: ${err.message}\n${USAGE}`);
      return 2;
    }
    if (err instanceof SiteError) {
      console.error(`error: ${err.message}`);
      if (err.hint) console.error(`hint: ${err.hint}`);
      return 1;
    }
    throw err;
  }
}

process.exitCode = await main(process.argv.slice(2));
