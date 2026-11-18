const CODES = { red: 31, yellow: 33, dim: 2, bold: 1 };

export function makePaint(enabled) {
  return (style, text) => (enabled ? `\u001b[${CODES[style]}m${text}\u001b[0m` : text);
}

export function shouldUseColor(stream, env = process.env) {
  return Boolean(stream.isTTY) && !env.NO_COLOR;
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function header(vp) {
  const skipped = Object.values(vp.skipped).reduce((a, b) => a + b, 0);
  const parts = [`${vp.checked} checked`, `${vp.counts.covered} covered`, `${vp.counts.partlyCovered} partly covered`];
  if (vp.counts.pointerEventsNone) parts.push(`${vp.counts.pointerEventsNone} pointer-events: none`);
  if (vp.counts.offscreen) parts.push(`${vp.counts.offscreen} offscreen`);
  parts.push(`${skipped} skipped`);
  return `${vp.width}x${vp.height}  ${parts.join(', ')}`;
}

function describeCause(group) {
  const { by } = group;
  if (group.kind === 'offscreen') return 'cannot be brought into the viewport';
  const facts = `position: ${by.position}, z-index: ${by.zIndex}, pointer-events: ${by.pointerEvents}, opacity: ${by.opacity}, ${by.width}x${by.height}`;
  const lead = group.kind === 'pointer-events-none' ? `pointer-events: none on ${by.selector}` : `covered by ${by.selector}`;
  return `${lead}\n    ${facts}`;
}

function formatGroup(group, paint) {
  const color = group.severity === 'error' ? 'red' : 'yellow';
  const lines = [`  ${paint(color, group.severity)}  ${paint('bold', describeCause(group))}`];
  for (const hint of group.by?.hints ?? []) lines.push(`    hint: ${hint}`);
  lines.push(`    ${plural(group.elements.length, 'element', 'elements')}:`);
  for (const el of group.elements) {
    const text = el.text ? `"${truncate(el.text, 40)}"` : '(no text)';
    const detail = el.type === 'partly-covered' ? ` ${el.type} ${el.blockedPoints}/${el.totalPoints} points` : '';
    lines.push(`      ${el.selector}  ${text}  <${el.tag}>${detail}`);
  }
  return lines.join('\n');
}

function formatViewport(vp, paint) {
  const lines = [paint('bold', header(vp))];
  for (const group of vp.findings) lines.push(formatGroup(group, paint));
  if (vp.iframes.total > 0) {
    const { total, sameOrigin, crossOrigin } = vp.iframes;
    lines.push(paint('dim', `  not checked: ${plural(total, 'iframe', 'iframes')} (${sameOrigin} same-origin, ${crossOrigin} cross-origin); controls inside frames are not inspected`));
  }
  return lines.join('\n');
}

export function formatHuman(result, paint = makePaint(false)) {
  const blocks = [`dead-click  ${result.url}`, ...result.viewports.map((vp) => formatViewport(vp, paint))];
  const s = result.summary;
  blocks.push(`total: ${s.covered} covered, ${s.partlyCovered} partly covered, ${s.pointerEventsNone} pointer-events: none, ${s.offscreen} offscreen, in ${plural(s.groups, 'group', 'groups')} across ${plural(s.viewports, 'viewport', 'viewports')}`);
  return `${blocks.join('\n\n')}\n`;
}

export const HELP = `dead-click: find interactive elements that another element covers

Usage
  dead-click <url-or-file> [options]

Options
  --viewports <list>   WIDTHxHEIGHT,... (default 390x844,768x1024,1440x900)
  --include <selector> extra selector to treat as interactive (repeatable)
  --ignore <selector>  skip elements that match, or sit inside a match (repeatable)
  --wait-for <selector> wait for a selector after load
  --delay <ms>         extra wait before measuring
  --timeout <ms>       navigation and wait-for timeout (default 30000)
  --json               print JSON instead of text
  --screenshots <dir>  save one PNG per finding group, blocked elements outlined
  --fail-on <level>    covered (default), partly, any, none
  --keep-animations    do not freeze animations and transitions
  --help, --version

Exit codes
  0  no findings at or above --fail-on
  1  findings at or above --fail-on
  2  usage or navigation error
`;
