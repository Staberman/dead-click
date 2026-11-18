# dead-click

A decorative glow layer without `pointer-events: none` covered a hero call-to-action at 1440px wide and not at 390px. Every test passed, because `element.click()` from JavaScript dispatches the handler directly and never asks the browser what is at that point. The fix was one CSS line, and finding it took a user report. dead-click loads a page at the viewport sizes you list and reports every interactive element that a real user could not click because something else is on top of it.

Playwright's own `locator.click()` does run an actionability check, but only for the elements a test happens to click, at the viewport the test happens to use. dead-click checks every interactive element at every viewport you list. It does not replace your tests; it covers a different gap.

## Sample output

From `dead-click test/fixtures/overlay-wide.html` in this repository:

```text
dead-click  test/fixtures/overlay-wide.html

390x844  1 checked, 0 covered, 0 partly covered, 0 skipped

768x1024  1 checked, 0 covered, 0 partly covered, 0 skipped

1440x900  1 checked, 1 covered, 0 partly covered, 0 skipped
  error  covered by body > section.hero > div.glow
    position: absolute, z-index: 5, pointer-events: auto, opacity: 1, 1440x480
    hint: looks decorative (no text, no interactive content); pointer-events: none on it would let clicks through
    1 element:
      body > section.hero > button.cta  "Start free trial"  <button>

total: 1 covered, 0 partly covered, 0 pointer-events: none, 0 offscreen, in 1 group across 3 viewports
```

The exit code was 1. At 390 and 768 pixels the glow layer is hidden by a media query, so the button is reachable; at 1440 it is not.

## Install and run

dead-click is not on npm yet. It drives Playwright's Chromium, so download that browser once:

```sh
npx playwright install chromium
```

Then run it straight from GitHub:

```sh
npx github:Staberman/dead-click https://example.com
npx github:Staberman/dead-click ./public/index.html --viewports 390x844,1440x900
```

Node 18 or newer is required. A local path is converted to a `file://` URL. The tool only navigates and measures. It never clicks, submits or types.

## What it checks

For each viewport it opens a fresh browser context at that exact size (and fails if `window.innerWidth` disagrees), waits for the load event and a short network idle, then freezes animations and transitions so measurements are stable.

1. It collects candidates: `a[href]`, `button`, `input` (not hidden), `select`, `textarea`, `summary`, the ARIA roles `button`, `link`, `tab`, `menuitem`, `checkbox`, `switch` and `radio`, `[onclick]`, focusable `[tabindex]` and `contenteditable`. It walks open shadow roots. `--include` adds selectors.
2. It skips elements a user is not meant to click, and counts them by reason: ignored, disabled, inert, `aria-hidden`, inside a closed `<details>`, `display: none`, `visibility: hidden`, `opacity: 0`, zero size, clipped away.
3. It scrolls each remaining element to the centre of the viewport and tests five points inside its visible box: the centre and four points inset 25% from the corners. At each point `document.elementFromPoint` finds the top element, descending into open shadow roots. A point counts as reached when the hit is the element, one of its descendants, or a `<label>` whose control is the element. That last rule keeps a visually hidden checkbox with a styled label from being reported.

| Finding | Severity | Meaning |
| --- | --- | --- |
| `covered` | error | No point reaches the element. |
| `partly-covered` | warning | Some points reach it, some do not. |
| `pointer-events-none` | warning | The element computes `pointer-events: none`, so clicks fall through to what is behind. |
| `offscreen` | warning | It cannot be brought into the viewport. |

Findings are grouped by the element on top. A cookie banner covering 40 links is one group of 40. Each group shows the covering element's selector, `position`, `z-index`, `pointer-events`, `opacity` and size, plus a hint: a covering element with no text and no interactive content looks decorative, and `pointer-events: none` on it would let clicks through; a fixed or sticky cover is probably a banner, header or dialog backdrop.

## Options

```text
dead-click <url-or-file> [options]

--viewports <list>    WIDTHxHEIGHT,... (default 390x844,768x1024,1440x900)
--include <selector>  extra selector to treat as interactive (repeatable)
--ignore <selector>   skip elements that match, or sit inside a match (repeatable)
--wait-for <selector> wait for a selector after load
--delay <ms>          extra wait before measuring
--timeout <ms>        navigation and wait-for timeout (default 30000)
--json                print JSON instead of text
--screenshots <dir>   one PNG per finding group, blocked elements outlined in red
--fail-on <level>     covered (default), partly, any, none
--keep-animations     do not freeze animations and transitions
--help, --version
```

Colour is used only on a TTY and only when `NO_COLOR` is unset. The JSON shape is `{url, viewports: [{width, height, checked, skipped, iframes, counts, findings}], summary}`.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No findings at or above the `--fail-on` level. |
| 1 | Findings at or above the level. `covered` fails on errors only, `partly` also on partly covered, `any` on every warning, `none` never. |
| 2 | Usage or navigation error. |

## CI

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npx playwright install --with-deps chromium
- run: npx github:Staberman/dead-click http://localhost:3000 --viewports 390x844,1440x900 --wait-for main
```

Start your site before that step, for example with `npm run build && npm start &`.

## Limitations

- Iframes are counted and reported as not checked. Their contents are not inspected, same-origin or not.
- Closed shadow roots cannot be reached.
- It measures the page as it is right after load. Elements revealed by interaction (menus, modals, tabs) are not exercised; use `--wait-for` and `--delay` for content that arrives late.
- Five sample points can miss a thin sliver of cover. An element covered only by a narrow strip may pass.
- Controls drawn on a canvas are invisible to it.
- Inline elements that wrap over several lines are tested on their largest line box.
- Clipping by ancestors is detected only in simple cases (an empty `clip`, `clip-path: inset(50%)`, or a zero-area ancestor that clips overflow).

## How it relates to other tools

Playwright's actionability check answers "can this click succeed right now" for the elements and viewport a test uses. dead-click asks the same hit-testing question for all interactive elements at all listed viewports, without needing a test per element. Accessibility linters check semantics, names and contrast; they do not ask what sits at a control's pixels. The three complement each other.

## License

MIT
