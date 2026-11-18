// Evaluated inside the page through page.evaluate. It is serialised with
// toString(), so it must stay self-contained: no imports, no references to
// anything defined outside the function body.
export function scanPage(options) {
  const CANDIDATES = [
    'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
    '[role=button]', '[role=link]', '[role=tab]', '[role=menuitem]', '[role=checkbox]',
    '[role=switch]', '[role=radio]', '[onclick]', '[tabindex]:not([tabindex="-1"])',
    '[contenteditable=""]', '[contenteditable=true]',
  ].join(',');
  const selectorList = options.include ? `${CANDIDATES},${options.include}` : CANDIDATES;

  const refs = new Map();
  window.__deadClick = { elements: [] };

  function refOf(node) {
    if (!refs.has(node)) {
      refs.set(node, window.__deadClick.elements.length);
      window.__deadClick.elements.push(node);
    }
    return refs.get(node);
  }

  // Parent in the composed tree: crosses open shadow boundaries upwards.
  function parentOf(node) {
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode();
    return root && root.host ? root.host : null;
  }

  function isInside(node, ancestor) {
    for (let n = node; n; n = parentOf(n)) if (n === ancestor) return true;
    return false;
  }

  function matchesSelfOrAncestor(node, selector) {
    for (let n = node; n; n = parentOf(n)) if (n.matches(selector)) return true;
    return false;
  }

  // ---- collection -------------------------------------------------------

  function collect(root, found, iframes) {
    for (const node of root.querySelectorAll(selectorList)) found.add(node);
    for (const node of root.querySelectorAll('*')) {
      if (node.tagName === 'IFRAME' || node.tagName === 'FRAME') iframes.push(node);
      if (node.shadowRoot) collect(node.shadowRoot, found, iframes);
    }
  }

  function countIframes(frames) {
    let sameOrigin = 0;
    for (const frame of frames) {
      try {
        if (frame.contentDocument) sameOrigin += 1;
      } catch {
        // cross-origin: access throws
      }
    }
    return { total: frames.length, sameOrigin, crossOrigin: frames.length - sameOrigin };
  }

  // ---- skipping ---------------------------------------------------------

  function insideClosedDetails(node) {
    let child = node;
    for (let n = parentOf(node); n; child = n, n = parentOf(n)) {
      if (n.tagName === 'DETAILS' && !n.open && child.tagName !== 'SUMMARY') return true;
    }
    return false;
  }

  function hasEmptyClip(style) {
    const rect = /^rect\(([^)]*)\)$/.exec(style.clip);
    if (rect) {
      const [top, right, bottom, left] = rect[1].split(/[\s,]+/).map(parseFloat);
      if (right - left <= 0 || bottom - top <= 0) return true;
    }
    return /^inset\(\s*(50|100)%/.test(style.clipPath);
  }

  // Clipped away by its own clip/clip-path, or by an ancestor that clips
  // overflow and has no area at all.
  function isClippedAway(node) {
    if (hasEmptyClip(getComputedStyle(node))) return true;
    for (let n = parentOf(node); n; n = parentOf(n)) {
      if (n === document.body || n === document.documentElement) break;
      const style = getComputedStyle(n);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      if (style.display === 'contents') continue;
      const box = n.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return true;
    }
    return false;
  }

  function skipReason(node) {
    if (options.ignore && matchesSelfOrAncestor(node, options.ignore)) return 'ignored';
    if (node.matches(':disabled')) return 'disabled';
    if (matchesSelfOrAncestor(node, '[inert]')) return 'inert';
    if (matchesSelfOrAncestor(node, '[aria-hidden="true"]')) return 'aria-hidden';
    if (insideClosedDetails(node)) return 'closed-details';
    if (!node.checkVisibility()) return 'display-none';
    const style = getComputedStyle(node);
    if (style.visibility !== 'visible') return 'visibility-hidden';
    if (parseFloat(style.opacity) === 0) return 'opacity-zero';
    const box = node.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return 'zero-size';
    if (isClippedAway(node)) return 'clipped';
    return null;
  }

  // ---- description ------------------------------------------------------

  function simpleName(node) {
    const tag = node.tagName.toLowerCase();
    const classes = [...node.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
    const base = tag + classes;
    const parent = node.parentElement;
    if (!parent) return base;
    const same = [...parent.children].filter((c) => c.tagName === node.tagName);
    const ambiguous = [...parent.children].filter((c) => c.matches(base)).length > 1;
    if (!ambiguous) return base;
    return `${base}:nth-of-type(${same.indexOf(node) + 1})`;
  }

  function selectorFor(node) {
    const parts = [];
    for (let n = node; n && parts.length < 3; n = n.parentElement) {
      const root = n.getRootNode();
      if (n.id && root.querySelectorAll(`#${CSS.escape(n.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(n.id)}`);
        break;
      }
      parts.unshift(simpleName(n));
      if (n === document.body || n === document.documentElement) break;
    }
    return parts.join(' > ');
  }

  function visibleText(node) {
    const raw = node.innerText || node.value || node.getAttribute('aria-label')
      || node.getAttribute('title') || node.getAttribute('alt') || '';
    return String(raw).replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function looksDecorative(node, style) {
    if (['IFRAME', 'VIDEO', 'CANVAS', 'OBJECT', 'EMBED', 'IMG'].includes(node.tagName)) return false;
    if (style.pointerEvents === 'none') return false;
    if (node.textContent.trim() !== '') return false;
    return !node.matches(selectorList) && !node.querySelector(selectorList);
  }

  function describeCover(node) {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    const hints = [];
    if (looksDecorative(node, style)) {
      hints.push('looks decorative (no text, no interactive content); pointer-events: none on it would let clicks through');
    }
    if (style.position === 'fixed' || style.position === 'sticky') {
      hints.push(`position: ${style.position}, so this is a fixed or sticky layer (banner, header, dialog backdrop)`);
    }
    return {
      ref: refOf(node),
      selector: selectorFor(node),
      position: style.position,
      zIndex: style.zIndex,
      pointerEvents: style.pointerEvents,
      opacity: style.opacity,
      width: Math.round(box.width),
      height: Math.round(box.height),
      hints,
    };
  }

  // ---- hit testing ------------------------------------------------------

  function deepElementFromPoint(x, y) {
    let hit = document.elementFromPoint(x, y);
    while (hit && hit.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    return hit;
  }

  function reaches(hit, target) {
    if (!hit) return false;
    if (isInside(hit, target)) return true;
    const label = hit.closest('label');
    return Boolean(label && label.control === target);
  }

  // The top-most branch of the DOM that sits above the target. Groups blocked
  // elements by layer, so a banner with many children is one cause.
  function layerOf(hit, target) {
    let top = hit;
    let fixed = null;
    for (let n = hit; n && n !== document.body && n !== document.documentElement; n = parentOf(n)) {
      if (isInside(target, n) && n !== hit) break;
      top = n;
      const position = getComputedStyle(n).position;
      if (position === 'fixed' || position === 'sticky') fixed = n;
    }
    return fixed || top;
  }

  function largestBox(node) {
    const rects = [...node.getClientRects()];
    if (rects.length === 0) return node.getBoundingClientRect();
    return rects.reduce((best, r) => (r.width * r.height > best.width * best.height ? r : best));
  }

  function visiblePart(box) {
    const left = Math.max(box.left, 0);
    const top = Math.max(box.top, 0);
    const right = Math.min(box.right, window.innerWidth);
    const bottom = Math.min(box.bottom, window.innerHeight);
    return { left, top, width: right - left, height: bottom - top };
  }

  function samplePoints(part) {
    const at = (fx, fy) => [part.left + part.width * fx, part.top + part.height * fy];
    return [at(0.5, 0.5), at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75)];
  }

  function pointerEventsSource(node) {
    let source = node;
    while (parentOf(source) && getComputedStyle(parentOf(source)).pointerEvents === 'none') {
      source = parentOf(source);
    }
    return source;
  }

  function base(node, type) {
    return {
      ref: refOf(node), type, selector: selectorFor(node), tag: node.tagName.toLowerCase(),
      text: visibleText(node), blockedPoints: 0, totalPoints: 0, by: null,
    };
  }

  function inspect(node) {
    node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const part = visiblePart(largestBox(node));
    if (part.width <= 0 || part.height <= 0) return base(node, 'offscreen');

    if (getComputedStyle(node).pointerEvents === 'none') {
      const finding = base(node, 'pointer-events-none');
      finding.by = describeCover(pointerEventsSource(node));
      finding.by.hints = ['pointer-events: none is set here, so clicks fall through to whatever is behind'];
      return finding;
    }

    const points = samplePoints(part);
    const blocked = [];
    for (const [x, y] of points) {
      const hit = deepElementFromPoint(x, y);
      if (!reaches(hit, node)) blocked.push(hit);
    }
    if (blocked.length === 0) return null;

    const finding = base(node, blocked.length === points.length ? 'covered' : 'partly-covered');
    finding.blockedPoints = blocked.length;
    finding.totalPoints = points.length;
    finding.by = blocked[0] ? describeCover(layerOf(blocked[0], node)) : null;
    return finding;
  }

  // ---- main -------------------------------------------------------------

  try {
    document.querySelectorAll(selectorList);
    if (options.ignore) document.querySelector(options.ignore);
  } catch (error) {
    return { invalidSelector: String(error.message || error) };
  }

  const found = new Set();
  const frames = [];
  collect(document, found, frames);

  const skipped = {};
  const elements = [];
  let checked = 0;
  for (const node of found) {
    const reason = skipReason(node);
    if (reason) {
      skipped[reason] = (skipped[reason] || 0) + 1;
      continue;
    }
    checked += 1;
    const finding = inspect(node);
    if (finding) elements.push(finding);
  }
  window.scrollTo(0, 0);

  return { checked, skipped, iframes: countIframes(frames), elements };
}
