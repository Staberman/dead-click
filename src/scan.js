import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { UsageError } from './args.js';
import { scanPage } from './in-page.js';

const FREEZE_ANIMATIONS = `*, *::before, *::after {
  animation-duration: 0s !important; animation-delay: 0s !important;
  animation-iteration-count: 1 !important; transition: none !important;
  scroll-behavior: auto !important;
}`;

const SEVERITY = { covered: 'error', 'partly-covered': 'warning', 'pointer-events-none': 'warning', offscreen: 'warning' };

export function launchBrowser() {
  return chromium.launch({ headless: true });
}

async function openPage(browser, url, viewport, options) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, bypassCSP: true });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: options.timeout ?? 30000 });
  } catch (error) {
    await context.close();
    throw new UsageError(`Could not load ${url}: ${error.message.split('\n')[0]}`);
  }
  await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  if (options.waitFor) {
    await page.waitForSelector(options.waitFor, { timeout: options.timeout ?? 30000 }).catch(() => {
      throw new UsageError(`--wait-for "${options.waitFor}" did not match within the timeout.`);
    });
  }
  if (options.delay) await page.waitForTimeout(options.delay);
  if (!options.keepAnimations) await page.addStyleTag({ content: FREEZE_ANIMATIONS });
  const width = await page.evaluate(() => window.innerWidth);
  if (width !== viewport.width) {
    await context.close();
    throw new Error(`Requested viewport width ${viewport.width} but the page reports ${width}.`);
  }
  return { context, page };
}

// One group per covering element (or per pointer-events source). Elements
// that are offscreen share a single group without a cause.
export function groupFindings(elements) {
  const groups = new Map();
  for (const element of elements) {
    const key = element.by ? `${element.type === 'pointer-events-none' ? 'pe' : 'cover'}:${element.by.ref}` : element.type;
    if (!groups.has(key)) {
      groups.set(key, {
        kind: element.type === 'pointer-events-none' ? 'pointer-events-none' : element.by ? 'covered-by' : element.type,
        severity: 'warning',
        by: element.by ? stripRef(element.by) : null,
        elements: [],
        _ref: element.by?.ref,
        _first: element.ref,
      });
    }
    const group = groups.get(key);
    if (SEVERITY[element.type] === 'error') group.severity = 'error';
    const { ref, by, ...rest } = element;
    group.elements.push({ ...rest, severity: SEVERITY[element.type] });
    group._refs = [...(group._refs ?? []), ref];
  }
  return [...groups.values()].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

function stripRef({ ref, ...rest }) {
  return rest;
}

function countTypes(elements) {
  const count = (type) => elements.filter((e) => e.type === type).length;
  return {
    covered: count('covered'),
    partlyCovered: count('partly-covered'),
    pointerEventsNone: count('pointer-events-none'),
    offscreen: count('offscreen'),
  };
}

async function saveScreenshots(page, groups, viewport, dir) {
  await mkdir(dir, { recursive: true });
  for (const [index, group] of groups.entries()) {
    const file = join(dir, `${viewport.width}x${viewport.height}-${String(index + 1).padStart(2, '0')}-${group.kind}.png`);
    await page.evaluate(({ refs, coverRef }) => {
      const els = window.__deadClick.elements;
      const marked = [];
      const mark = (node, style) => { marked.push([node, node.style.cssText]); node.style.cssText += style; };
      els[refs[0]].scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      for (const ref of refs) mark(els[ref], ';outline: 3px solid #e5213a !important; outline-offset: 2px !important;');
      if (coverRef !== undefined) mark(els[coverRef], ';outline: 3px dashed #1f6feb !important; outline-offset: -3px !important;');
      window.__deadClickMarked = marked;
    }, { refs: group._refs, coverRef: group._ref });
    await page.screenshot({ path: file });
    await page.evaluate(() => {
      for (const [node, css] of window.__deadClickMarked) node.style.cssText = css;
    });
    group.screenshot = file;
  }
}

function finish(groups) {
  for (const group of groups) {
    delete group._ref;
    delete group._first;
    delete group._refs;
  }
}

export async function scanViewport(browser, url, viewport, options = {}) {
  const { context, page } = await openPage(browser, url, viewport, options);
  try {
    const raw = await page.evaluate(scanPage, { include: options.include ?? '', ignore: options.ignore ?? '' });
    if (raw.invalidSelector) throw new UsageError(`Invalid selector: ${raw.invalidSelector}`);
    const findings = groupFindings(raw.elements);
    if (options.screenshots && findings.length) await saveScreenshots(page, findings, viewport, options.screenshots);
    finish(findings);
    return {
      width: viewport.width,
      height: viewport.height,
      checked: raw.checked,
      skipped: raw.skipped,
      iframes: raw.iframes,
      counts: countTypes(raw.elements),
      findings,
    };
  } finally {
    await context.close();
  }
}

export function summarize(viewports) {
  const total = { covered: 0, partlyCovered: 0, pointerEventsNone: 0, offscreen: 0 };
  let groups = 0;
  for (const vp of viewports) {
    for (const key of Object.keys(total)) total[key] += vp.counts[key];
    groups += vp.findings.length;
  }
  return { viewports: viewports.length, groups, ...total };
}

export function failsAt(summary, level) {
  if (level === 'none') return false;
  if (level === 'covered') return summary.covered > 0;
  if (level === 'partly') return summary.covered + summary.partlyCovered > 0;
  return summary.covered + summary.partlyCovered + summary.pointerEventsNone + summary.offscreen > 0;
}

export async function scan(url, options = {}) {
  const browser = options.browser ?? (await launchBrowser());
  try {
    const viewports = [];
    for (const viewport of options.viewports) {
      viewports.push(await scanViewport(browser, url, viewport, options));
    }
    return { url, viewports, summary: summarize(viewports) };
  } finally {
    if (!options.browser) await browser.close();
  }
}
