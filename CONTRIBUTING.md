# Contributing

1. `npm ci`
2. `npx playwright install chromium`
3. `npm test`

Tests launch headless Playwright Chromium and load the pages in `test/fixtures`. A new check should come with a small fixture, one per case, and assertions for it in `test/scan.test.js`.

`src/in-page.js` runs inside the page and is serialised, so it must not reference anything outside its own function body. Keep the tool read-only: it may navigate and measure, never click, submit or type.

Use conventional commit messages. Keep docs plain: direct sentences, no emoji.
