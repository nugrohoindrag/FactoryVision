/**
 * Enforces the service-worker precache budget: ≤5MB (Tech Stack §4).
 *
 * size-limit covers the JS and CSS budgets, but not this one — and a budget
 * that is not enforced automatically WILL be broken. Fonts, icons and the app
 * shell all land in the precache, and every one of them has to travel over 3G
 * the first time an operator opens the app.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT_BYTES = 5 * 1024 * 1024;
const dist = join(process.cwd(), 'dist');

const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
// Workbox minifies the manifest inline as `{revision:"…",url:"…"}` entries.
const urls = [...new Set([...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]))];

if (urls.length === 0) {
  console.error('check-precache: no precache entries found in dist/sw.js');
  process.exit(1);
}

let total = 0;
for (const url of urls) {
  try {
    total += readFileSync(join(dist, url)).byteLength;
  } catch {
    console.warn(`check-precache: skipped missing ${url}`);
  }
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log(`precache: ${urls.length} entries, ${mb(total)} of ${mb(LIMIT_BYTES)}`);

if (total > LIMIT_BYTES) {
  console.error(`check-precache: over budget by ${mb(total - LIMIT_BYTES)}`);
  process.exit(1);
}
