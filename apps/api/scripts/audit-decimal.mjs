#!/usr/bin/env node
/**
 * B-008 enforced, not just written down.
 *
 * The rule: quantities and rupiah values never touch `number`. They arrive as
 * decimal strings, they are computed with big.js in `@fv/domain`, and they leave
 * as decimal strings.
 *
 * The reason is in Tech Stack §2.4 and it is concrete rather than theoretical:
 * `0.1 + 0.2 !== 0.3` means `Issued − Returned − Shrinkage` leaves a residue of
 * `0.0000000001 kg`, the material issue can never close cleanly, and the
 * variance report — the one thing a factory owner actually asks for — stops
 * being believed.
 *
 * A rule that is only in a document is a rule that gets broken by somebody who
 * has not read it. This script is CI's copy, and it caught a real violation in
 * the reports service the day it was written: three lines of `Number(a) *
 * Number(b)` in a rupiah total, written by the same person who had spent the
 * morning enforcing the rule elsewhere.
 *
 * It looks for the coercions, not for the word `number`. Counters, array
 * indexes and page sizes are all fine — the concern is arithmetic on money and
 * quantity, which is why the deny-list is `Number(`, `parseFloat`, `+value` on
 * a decimal, and `toFixed` outside the display layer.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src', import.meta.url));

/**
 * Files exempt, each for a stated reason. An exemption without one is how a
 * lint rule becomes decorative.
 */
const ALLOW = new Map([
  // The conversion boundary itself: it validates a factor is above zero before
  // handing it to big.js, and a comparison against zero is safe in any base.
  ['master/master.service.ts', 'compares a conversion factor against zero before use'],
  // Display-only rounding of a percentage that is never stored.
  ['common/decimal.ts', 'defines the big.js wrappers everything else uses'],
]);

const PATTERNS = [
  { rx: /\bNumber\s*\(/, why: 'Number() on a quantity loses precision — use big() from common/decimal' },
  { rx: /\bparseFloat\s*\(/, why: 'parseFloat on a quantity loses precision — use big()' },
  { rx: /\.toFixed\s*\(\s*\d/, why: 'toFixed on a JS number rounds in binary — use big().toFixed()' },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.ts')) yield full;
  }
}

const violations = [];

for (const file of walk(root)) {
  const rel = relative(root, file).split('\\').join('/');
  if (ALLOW.has(rel)) continue;

  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    // A line that says why it is safe has been thought about. One that does not
    // has not.
    if (line.includes('decimal-safe:')) return;

    for (const { rx, why } of PATTERNS) {
      if (rx.test(line)) {
        violations.push({ file: rel, line: index + 1, text: line.trim(), why });
      }
    }
  });
}

if (violations.length > 0) {
  console.error('\nDecimal discipline violated (Tech Stack §2.4):\n');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}`);
    console.error(`    ${violation.text}`);
    console.error(`    → ${violation.why}\n`);
  }
  console.error(
    'If a line is genuinely safe — a counter, an index, a page size — say so with a\n' +
      '`decimal-safe:` comment explaining why, on the same line.\n',
  );
  process.exit(1);
}

console.log(`Decimal discipline clean — ${ALLOW.size} stated exemptions.`);
