#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs, UsageError } from '../src/args.js';
import { failsAt, scan } from '../src/scan.js';
import { formatHuman, HELP, makePaint, shouldUseColor } from '../src/format.js';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (options.version) {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  const result = await scan(options.url, options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(formatHuman(result, makePaint(shouldUseColor(process.stdout))));
  }
  return failsAt(result.summary, options.failOn) ? 1 : 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (error) => {
    const usage = error instanceof UsageError;
    process.stderr.write(`dead-click: ${error.message}\n`);
    if (usage) process.stderr.write('Run dead-click --help for usage.\n');
    process.exitCode = 2;
  },
);
