import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binPath, fixturePath } from './helpers.js';

const cli = (...args) => spawnSync(process.execPath, [binPath, ...args], {
  encoding: 'utf8',
  env: { ...process.env, NO_COLOR: '1' },
});

describe('cli', () => {
  test('exit 0 on a clean page', () => {
    const result = cli(fixturePath('clean'), '--viewports', '390x844');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /390x844  3 checked, 0 covered, 0 partly covered, 0 skipped/);
  });

  test('exit 1 and the covering element is named', () => {
    const result = cli(fixturePath('overlay-wide'));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /covered by .*div\.glow/);
    assert.match(result.stdout, /1440x900  1 checked, 1 covered/);
    assert.match(result.stdout, /Start free trial/);
    assert.doesNotMatch(result.stdout, /\u001b\[/);
  });

  test('--fail-on none and --fail-on partly', () => {
    assert.equal(cli(fixturePath('overlay-wide'), '--fail-on', 'none').status, 0);
    assert.equal(cli(fixturePath('partly'), '--viewports', '1440x900').status, 0);
    assert.equal(cli(fixturePath('partly'), '--viewports', '1440x900', '--fail-on', 'partly').status, 1);
    assert.equal(cli(fixturePath('offscreen'), '--viewports', '1440x900', '--fail-on', 'any').status, 1);
  });

  test('--json has a stable shape', () => {
    const result = cli(fixturePath('cookie-banner'), '--json', '--viewports', '1440x900');
    assert.equal(result.status, 1);
    const data = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(data), ['url', 'viewports', 'summary']);
    const [vp] = data.viewports;
    assert.deepEqual(Object.keys(vp), ['width', 'height', 'checked', 'skipped', 'iframes', 'counts', 'findings']);
    assert.equal(vp.findings[0].by.selector, '#cookie');
    assert.equal(data.summary.covered, 4);
    assert.equal(vp.findings[0]._ref, undefined);
  });

  test('--screenshots writes one PNG per group', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dead-click-'));
    const result = cli(fixturePath('cookie-banner'), '--viewports', '1440x900', '--screenshots', dir);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(existsSync(dir), true);
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.png')).length, 1);
  });

  test('bad viewport string exits 2', () => {
    const result = cli(fixturePath('clean'), '--viewports', 'wide');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Invalid viewport/);
  });

  test('missing file exits 2', () => {
    assert.equal(cli('./nope.html').status, 2);
  });

  test('unreachable URL exits 2', () => {
    const result = cli('http://127.0.0.1:1/', '--viewports', '390x844', '--timeout', '3000');
    assert.equal(result.status, 2);
  });

  test('--help and --version', () => {
    assert.match(cli('--help').stdout, /Usage/);
    assert.match(cli('--version').stdout, /^0\.1\.0/);
  });
});
