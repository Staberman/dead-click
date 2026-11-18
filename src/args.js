import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_VIEWPORTS = '390x844,768x1024,1440x900';
export const FAIL_LEVELS = ['covered', 'partly', 'any', 'none'];

export class UsageError extends Error {}

export function parseViewports(text) {
  return text.split(',').map((item) => {
    const match = /^(\d{2,5})x(\d{2,5})$/.exec(item.trim());
    if (!match) throw new UsageError(`Invalid viewport "${item}". Use WIDTHxHEIGHT, for example 1440x900.`);
    return { width: Number(match[1]), height: Number(match[2]) };
  });
}

export function toUrl(target) {
  if (/^(https?|file):\/\//i.test(target)) return target;
  if (existsSync(target)) return pathToFileURL(resolve(target)).href;
  throw new UsageError(`"${target}" is neither an http(s)/file URL nor an existing file.`);
}

function toNumber(name, value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new UsageError(`${name} needs a non-negative integer, got "${value}".`);
  return number;
}

const VALUE_FLAGS = new Set([
  '--viewports', '--include', '--ignore', '--wait-for', '--delay', '--timeout', '--screenshots', '--fail-on',
]);
const BOOLEAN_FLAGS = new Set(['--json', '--keep-animations', '--help', '--version']);

function splitFlag(arg) {
  const eq = arg.indexOf('=');
  return arg.startsWith('--') && eq > 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg, undefined];
}

function readRaw(argv) {
  const raw = { positional: [], include: [], ignore: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const [name, inline] = splitFlag(argv[i]);
    if (BOOLEAN_FLAGS.has(name)) {
      raw.flags[name] = true;
    } else if (VALUE_FLAGS.has(name)) {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new UsageError(`${name} needs a value.`);
      if (name === '--include' || name === '--ignore') raw[name.slice(2)].push(value);
      else raw.flags[name] = value;
    } else if (name.startsWith('-')) {
      throw new UsageError(`Unknown option ${name}.`);
    } else {
      raw.positional.push(argv[i]);
    }
  }
  return raw;
}

export function parseArgs(argv) {
  const { positional, include, ignore, flags } = readRaw(argv);
  if (flags['--help'] || flags['--version']) return { help: Boolean(flags['--help']), version: Boolean(flags['--version']) };
  if (positional.length !== 1) throw new UsageError('Expected exactly one URL or file path.');

  const failOn = flags['--fail-on'] ?? 'covered';
  if (!FAIL_LEVELS.includes(failOn)) throw new UsageError(`--fail-on must be one of ${FAIL_LEVELS.join(', ')}.`);

  return {
    url: toUrl(positional[0]),
    viewports: parseViewports(flags['--viewports'] ?? DEFAULT_VIEWPORTS),
    include: include.join(', '),
    ignore: ignore.join(', '),
    waitFor: flags['--wait-for'] ?? '',
    delay: toNumber('--delay', flags['--delay'] ?? 0),
    timeout: toNumber('--timeout', flags['--timeout'] ?? 30000),
    json: Boolean(flags['--json']),
    screenshots: flags['--screenshots'] ?? '',
    failOn,
    keepAnimations: Boolean(flags['--keep-animations']),
  };
}
