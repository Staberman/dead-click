import { fileURLToPath, pathToFileURL } from 'node:url';

export const fixtureUrl = (name) => pathToFileURL(fileURLToPath(new URL(`./fixtures/${name}.html`, import.meta.url))).href;
export const fixturePath = (name) => fileURLToPath(new URL(`./fixtures/${name}.html`, import.meta.url));
export const binPath = fileURLToPath(new URL('../bin/dead-click.js', import.meta.url));

export const MOBILE = { width: 390, height: 844 };
export const DESKTOP = { width: 1440, height: 900 };

export const elementsOf = (vp) => vp.findings.flatMap((group) => group.elements);
