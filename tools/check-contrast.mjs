// Checks the colour pairs the site relies on against WCAG 2.1 contrast minimums.
// Reads the theme file, so a new theme is checked by pointing THEME at its copy.
// Usage: node tools/check-contrast.mjs            (exit 1 if any pair fails)
// No dependencies.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const THEME = join(here, '..', 'site', 'assets', 'css', 'theme-night-plum.css');

const vars = {};
for (const m of readFileSync(THEME, 'utf8').matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) {
  vars[m[1]] = m[2];
}

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5;       // body text, WCAG AA
const CONTROL = 3;      // control edges and essential graphics, WCAG 2.1 1.4.11

const dark = ['bg', 'panel', 'panel2'];
const checks = [
  ...['ink', 'soft', 'mute', 'pinkl', 'green', 'err', 'gold', 'blue', 'link-url'].flatMap((fg) =>
    dark.map((bg) => ({ fg, bg, min: TEXT, what: 'text' }))),
  ...dark.map((bg) => ({ fg: 'line', bg, min: CONTROL, what: 'control edge' })),
  { fg: 'deep', bg: 'pink', min: TEXT, what: 'button label' },
  { fg: 'deep', bg: 'action', min: TEXT, what: 'button label' },
  { fg: 'deep', bg: 'cta-performer', min: TEXT, what: 'button label' },
  { fg: 'light-ink', bg: 'light-bg', min: TEXT, what: 'text on light' },
  { fg: 'light-soft', bg: 'light-bg', min: TEXT, what: 'text on light' },
  { fg: 'light-accent', bg: 'light-bg', min: TEXT, what: 'text on light' },
  { fg: 'light-ink', bg: 'card', min: TEXT, what: 'text on light card' },
];

let failed = 0;
for (const c of checks) {
  const fg = vars[c.fg], bg = vars[c.bg];
  if (!fg || !bg) { console.log(`MISSING token: ${c.fg} or ${c.bg}`); failed++; continue; }
  const r = ratio(fg, bg);
  const ok = r >= c.min;
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${c.fg.padEnd(13)} on ${c.bg.padEnd(13)} ${r.toFixed(2).padStart(6)}:1  needs ${c.min}:1  (${c.what})`);
}
console.log(failed ? `\n${failed} pair(s) failed.` : '\nAll pairs pass.');
process.exit(failed ? 1 : 0);
