/**
 * Contrast audit for the token palette (DS §9, WCAG AA).
 *
 * This exists because the palette shipped with five AA failures that nobody
 * caught by looking — including `AWAITING INSPECTION`, the badge on every newly
 * received item, at 1.92:1. Contrast is arithmetic; checking it by eye is how
 * it silently rots.
 *
 * Reads the real token values out of `globals.css`, so it cannot drift from
 * what actually ships. Run: `pnpm --filter @fv/tokens audit:contrast`
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'src', 'globals.css'), 'utf8');

/**
 * Pulls `--token: H S% L%;` declarations out of the `:root` block, then
 * resolves `--token: var(--other);` aliases against them.
 *
 * The alias pass is not optional: `--st-warning-on: var(--ink-950)` is how
 * the palette states which foreground belongs on which fill, and a checker
 * that only understood literals would silently skip every one of those pairs
 * — the exact class of hole that let a 1.92:1 badge ship.
 */
function readTokens() {
  const literals = {};
  const aliases = {};
  const root = css.slice(css.indexOf(':root'), css.indexOf('.dark'));

  // `--token: L% C H;` — OKLCH channels, the format the palette ships in.
  for (const [, name, l, c, h] of root.matchAll(
    /--([\w-]+):\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*;/g,
  )) {
    literals[name] = oklchToRgb(Number(l), Number(c), Number(h));
  }

  for (const [, name, target] of root.matchAll(/--([\w-]+):\s*var\(--([\w-]+)\)\s*;/g)) {
    aliases[name] = target;
  }

  // Follow chains (a → b → literal), with a depth cap so a typo that creates
  // a cycle fails loudly here instead of hanging CI.
  const tokens = { ...literals };
  for (const name of Object.keys(aliases)) {
    let target = aliases[name];
    for (let hop = 0; hop < 10 && !literals[target]; hop += 1) target = aliases[target];
    if (literals[target]) tokens[name] = literals[target];
  }
  return tokens;
}

/**
 * OKLCH → sRGB, clipped to gamut.
 *
 * The palette is stored in OKLCH because its lightness is perceptual, which
 * is what lets a 600 step carry the same visual weight across nine hues. WCAG
 * contrast, however, is defined on sRGB relative luminance — so the ratios
 * below have to be computed on the colour the screen actually shows, gamut
 * clipping included, not on the OKLCH lightness channel. Reading L% as if it
 * were brightness would quietly pass fills that are unreadable.
 */
function oklchToRgb(L, C, H) {
  const l = L / 100;
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
    -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
    -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
  ].map((v) => {
    const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, encoded));
  });
}

function luminance([r, g, b]) {
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const T = readTokens();
const missing = [];
const get = (name) => {
  if (!T[name]) missing.push(name);
  return T[name] ?? [0, 0, 0];
};

/**
 * Every pair a person actually reads.
 *
 * The `BADGE` rows are the ones that matter most: DS §5.3 makes badges a
 * solid fill, so a fill whose own foreground is illegible is a fill that
 * cannot be used. v5.0 made the fills vivid and gave each one an explicit
 * `--st-*-on`, so these rows now check the fill against the foreground the
 * palette actually declares — not against a hard-coded white that a
 * component might not be using.
 */
const PAIRS = [
  ['primary text on card', 'ink-900', 'white', 4.5],
  ['primary text on page', 'ink-900', 'ink-100', 4.5],
  ['secondary text on card', 'ink-600', 'white', 4.5],
  ['secondary text on page', 'ink-600', 'ink-100', 4.5],
  ['secondary text on surface-secondary', 'ink-600', 'ink-200', 4.5],
  ['disabled text on card', 'ink-500', 'white', 3],
  ['disabled text on secondary', 'ink-500', 'ink-200', 3],
  ['hairline on page', 'ink-300', 'ink-100', 1.2],
  ['white on primary button', 'white', 'primary-700', 4.5],
  ['white on primary hover', 'white', 'primary-700', 4.5],
  ['selected text on accent', 'primary-800', 'primary-50', 4.5],
  ['BADGE on success', 'st-success-on', 'st-success', 4.5],
  ['BADGE on warning', 'st-warning-on', 'st-warning', 4.5],
  ['BADGE on danger', 'st-danger-on', 'st-danger', 4.5],
  ['BADGE on info', 'st-info-on', 'st-info', 4.5],
  ['BADGE on maintenance', 'st-maintenance-on', 'st-maintenance', 4.5],
  ['BADGE on neutral', 'st-neutral-on', 'st-neutral', 4.5],
  ['BADGE on waiting', 'st-waiting-on', 'st-waiting', 4.5],
  ['BADGE on released', 'st-released-on', 'st-released', 4.5],
  ['success pairing', 'st-success-fg', 'st-success-bg', 4.5],
  ['warning pairing', 'st-warning-fg', 'st-warning-bg', 4.5],
  ['danger pairing', 'st-danger-fg', 'st-danger-bg', 4.5],
  ['info pairing', 'st-info-fg', 'st-info-bg', 4.5],
  ['maintenance pairing', 'st-maintenance-fg', 'st-maintenance-bg', 4.5],
  ['waiting pairing', 'st-waiting-fg', 'st-waiting-bg', 4.5],
  ['neutral pairing', 'st-neutral-fg', 'st-neutral-bg', 4.5],
  ['released pairing', 'st-released-fg', 'st-released-bg', 4.5],
  // Data accents are chips and meters, so they carry text too.
  ['chip on data teal', 'accent-teal-on', 'accent-teal', 4.5],
  ['chip on data violet', 'accent-violet-on', 'accent-violet', 4.5],
  ['chip on data amber', 'accent-amber-on', 'accent-amber', 4.5],
  ['chip on data rose', 'accent-rose-on', 'accent-rose', 4.5],
  ['chip on data cyan', 'accent-cyan-on', 'accent-cyan', 4.5],
  ['chip on data lime', 'accent-lime-on', 'accent-lime', 4.5],
  ['chip on data emerald', 'accent-emerald-on', 'accent-emerald', 4.5],
  ['chip on data fuchsia', 'accent-fuchsia-on', 'accent-fuchsia', 4.5],
  ['chip on data blue', 'accent-blue-on', 'accent-blue', 4.5],
  // Gradient endpoints — a fill that fades must stay legible at BOTH ends.
  ['white at end of gradient-brand', 'white', 'violet-600', 4.5],
  ['white at end of gradient-danger', 'white', 'rose-600', 4.5],
  ['white at start of gradient-danger', 'white', 'red-600', 4.5],
  ['ink at end of gradient-success', 'st-success-on', 'teal-600', 4.5],
  ['ink at end of gradient-warning', 'st-warning-on', 'amber-400', 4.5],
  ['white at end of gradient-info', 'white', 'cyan-700', 4.5],
];

let failures = 0;
const lines = [];

for (const [label, fg, bg, min] of PAIRS) {
  const ratio = contrast(get(fg), get(bg));
  const ok = ratio >= min;
  if (!ok) failures += 1;
  lines.push(`  ${ok ? 'pass' : 'FAIL'}  ${ratio.toFixed(2).padStart(5)}:1  (min ${min})  ${label}`);
}

if (missing.length > 0) {
  console.error(`contrast audit: tokens not found in globals.css: ${[...new Set(missing)].join(', ')}`);
  process.exit(1);
}

if (failures === 0) {
  console.log(`contrast audit: ${PAIRS.length} pairs, all pass WCAG AA`);
  process.exit(0);
}

console.error(`contrast audit: ${failures} of ${PAIRS.length} pairs below WCAG AA\n`);
console.error(lines.join('\n'));
process.exit(1);
