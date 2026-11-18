import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, parseViewports, UsageError } from '../src/args.js';
import { fixturePath } from './helpers.js';

const file = fixturePath('clean');

describe('parseViewports', () => {
  test('parses a list', () => {
    assert.deepEqual(parseViewports('390x844, 1440x900'), [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]);
  });

  test('rejects malformed values', () => {
    for (const bad of ['390', '390x', 'abc', '390x844,', '0x0x1']) {
      assert.throws(() => parseViewports(bad), UsageError);
    }
  });
});

describe('parseArgs', () => {
  test('defaults', () => {
    const options = parseArgs([file]);
    assert.equal(options.viewports.length, 3);
    assert.equal(options.failOn, 'covered');
    assert.match(options.url, /^file:\/\//);
  });

  test('flags with = and repeated selectors', () => {
    const options = parseArgs([file, '--ignore=.a', '--ignore', '.b', '--delay', '50', '--json']);
    assert.equal(options.ignore, '.a, .b');
    assert.equal(options.delay, 50);
    assert.equal(options.json, true);
  });

  test('errors are UsageError', () => {
    assert.throws(() => parseArgs([]), UsageError);
    assert.throws(() => parseArgs([file, '--viewports', 'wide']), UsageError);
    assert.throws(() => parseArgs([file, '--fail-on', 'sometimes']), UsageError);
    assert.throws(() => parseArgs([file, '--nope']), UsageError);
    assert.throws(() => parseArgs([file, '--delay']), UsageError);
    assert.throws(() => parseArgs(['./does-not-exist.html']), UsageError);
  });

  test('help and version need no target', () => {
    assert.equal(parseArgs(['--help']).help, true);
    assert.equal(parseArgs(['--version']).version, true);
  });
});
