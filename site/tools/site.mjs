#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildSite } from './lib/build.mjs';
import { SiteError } from './lib/config.mjs';
import {
  decideGate,
  fetchReleases,
  githubApi,
  readPropsVersion,
  selectRelease,
} from './lib/releases.mjs';

const USAGE = `usage: node site/tools/site.mjs <command>

  build [--offline] [--src <dir>] [--out <dir>]   build the page, stamped with the newest release
  gate                                            print publish=true|false for the Pages workflow`;

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

async function build(args) {
  const opts = parse(args, {
    offline: { type: 'boolean' },
    src: { type: 'string' },
    out: { type: 'string' },
  });
  let release = null;
  let kept = 'offline';
  if (!opts.offline) {
    const fetched = await fetchReleases(githubApi());
    if (fetched.ok) {
      const picked = selectRelease(fetched.releases);
      for (const reason of picked.passedOver) console.log(`passed over: ${reason}`);
      if (picked.release) release = picked.release;
      else kept = picked.fallback;
    } else {
      kept = fetched.reason;
      console.warn(`warning: cannot read releases: ${fetched.reason}`);
    }
  }
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

const COMMANDS = { build, gate };

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
