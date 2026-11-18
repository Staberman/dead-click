import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, scan } from '../src/scan.js';
import { DESKTOP, MOBILE, elementsOf, fixtureUrl } from './helpers.js';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser.close(); });

const run = (name, viewports, extra = {}) => scan(fixtureUrl(name), { browser, viewports, ...extra });

describe('fixtures', () => {
  test('clean page has no findings', async () => {
    const { viewports, summary } = await run('clean', [MOBILE, DESKTOP]);
    for (const vp of viewports) {
      assert.equal(vp.findings.length, 0);
      assert.equal(vp.checked, 3);
    }
    assert.equal(summary.groups, 0);
  });

  test('--include adds a custom interactive element', async () => {
    const { viewports } = await run('clean', [MOBILE], { include: '.fake' });
    assert.equal(viewports[0].checked, 4);
  });

  test('decorative overlay covers the button only at 1440 wide', async () => {
    const { viewports } = await run('overlay-wide', [MOBILE, DESKTOP]);
    const [mobile, desktop] = viewports;
    assert.equal(mobile.findings.length, 0);
    assert.equal(desktop.counts.covered, 1);
    const [group] = desktop.findings;
    assert.equal(group.kind, 'covered-by');
    assert.equal(group.severity, 'error');
    assert.match(group.by.selector, /div\.glow$/);
    assert.equal(group.by.position, 'absolute');
    assert.equal(group.by.zIndex, '5');
    assert.ok(group.by.hints.some((h) => h.includes('decorative')));
    assert.equal(group.elements[0].text, 'Start free trial');
  });

  test('cookie banner is one group covering all footer links', async () => {
    const { viewports } = await run('cookie-banner', [MOBILE, DESKTOP]);
    for (const vp of viewports) {
      assert.equal(vp.findings.length, 1);
      const [group] = vp.findings;
      assert.equal(group.by.selector, '#cookie');
      assert.equal(group.by.position, 'fixed');
      assert.ok(group.by.hints.some((h) => h.includes('fixed or sticky')));
      assert.deepEqual(group.elements.map((e) => e.text), ['Privacy', 'Terms', 'Contact', 'Help']);
      assert.equal(vp.counts.covered, 4);
    }
  });

  test('partly covered button is a warning', async () => {
    const { viewports } = await run('partly', [DESKTOP]);
    const [el] = elementsOf(viewports[0]);
    assert.equal(el.type, 'partly-covered');
    assert.equal(el.severity, 'warning');
    assert.ok(el.blockedPoints > 0 && el.blockedPoints < el.totalPoints);
  });

  test('visually hidden checkbox with a styled label is not reported', async () => {
    const { viewports } = await run('hidden-checkbox', [DESKTOP]);
    assert.equal(viewports[0].findings.length, 0);
    assert.equal(viewports[0].checked, 1);
    assert.equal(viewports[0].skipped.clipped, 1);
  });

  test('button inside an open shadow root covered by an overlay', async () => {
    const { viewports } = await run('shadow-overlay', [DESKTOP]);
    const [el] = elementsOf(viewports[0]);
    assert.equal(el.type, 'covered');
    assert.equal(el.tag, 'button');
    assert.equal(viewports[0].findings[0].by.selector, '#overlay');
  });

  test('pointer-events: none on a link is reported once', async () => {
    const { viewports } = await run('pointer-events-link', [DESKTOP]);
    const [group] = viewports[0].findings;
    assert.equal(group.kind, 'pointer-events-none');
    assert.equal(group.elements.length, 1);
    assert.equal(group.elements[0].text, 'Looks like a link');
    assert.equal(viewports[0].checked, 2);
  });

  test('closed details content is skipped, the summary is checked', async () => {
    const { viewports } = await run('closed-details', [DESKTOP]);
    assert.equal(viewports[0].checked, 1);
    assert.equal(viewports[0].skipped['closed-details'], 2);
    assert.equal(viewports[0].findings.length, 0);
  });

  test('disabled button is skipped', async () => {
    const { viewports } = await run('disabled-button', [DESKTOP]);
    assert.equal(viewports[0].checked, 1);
    assert.equal(viewports[0].skipped.disabled, 1);
  });

  test('iframes are counted and not inspected', async () => {
    const { viewports } = await run('iframes', [DESKTOP]);
    assert.deepEqual(viewports[0].iframes, { total: 2, sameOrigin: 1, crossOrigin: 1 });
    assert.equal(viewports[0].checked, 1);
    assert.equal(viewports[0].findings.length, 0);
  });

  test('overlay with pointer-events: none is not reported', async () => {
    const { viewports } = await run('overlay-passthrough', [MOBILE, DESKTOP]);
    for (const vp of viewports) assert.equal(vp.findings.length, 0);
  });

  test('element left of the page is offscreen', async () => {
    const { viewports } = await run('offscreen', [DESKTOP]);
    const [group] = viewports[0].findings;
    assert.equal(group.kind, 'offscreen');
    assert.equal(group.elements[0].text, 'Skip to content');
  });
});

describe('options', () => {
  test('--ignore skips matches and their descendants', async () => {
    const { viewports } = await run('cookie-banner', [DESKTOP], { ignore: 'footer' });
    assert.equal(viewports[0].findings.length, 0);
    assert.equal(viewports[0].skipped.ignored, 4);
  });

  test('invalid --ignore selector is a usage error', async () => {
    await assert.rejects(run('clean', [DESKTOP], { ignore: '[[' }), /Invalid selector/);
  });

  test('the requested width is really applied', async () => {
    const { viewports } = await run('clean', [{ width: 320, height: 600 }]);
    assert.equal(viewports[0].width, 320);
  });
});
