/**
 * Design-system compliance audit (T-111, T-112, T-113).
 *
 * UI Spec §22 points 2, 9 and 11 are exactly the rules that erode quietly: one
 * `#DC2626` here, one `"Material Issue"` typed straight into JSX there, and six
 * months later the token file no longer controls anything and a tenant cannot
 * rename a term without a code change.
 *
 * So they are checked mechanically rather than by review.
 *
 *   1. No raw colour values (hex, rgb, hsl) outside the tokens package
 *   2. No raw pixel sizes in className — sizing comes from density tokens
 *   3. No LOCKED GLOSSARY TERM written as a literal in JSX — those must go
 *      through `useTerm()` so they stay tenant-configurable (PRD §9.2)
 *   4. No gradient or opacity-for-meaning (UI Spec §6.4)
 *
 * Run: `pnpm audit:design`
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'src');

/** shadcn's own files are vendored; they were re-themed but keep their idioms. */
const SKIP_DIRS = new Set(['ui']);

/** Terms from the locked glossary (DS §13) that must never be literals in JSX. */
const GLOSSARY = [
  'Goods Receipt',
  'Delivery Note',
  'Material Issue',
  'Material Return',
  'Production Receipt',
  'Pick List',
  'Stock Take',
  'Blind Count',
  'Stock Adjustment',
  'Stock Card',
  'Dead Stock',
  'Shelf Life',
  'Minimum Stock',
  'Unit Conversion',
  'Finished Goods',
  'Raw Material',
  'Spare Part',
  'In Production',
];

const RULES = [
  {
    id: 'raw-colour',
    // Hex, rgb() or hsl() written into a component instead of a token.
    pattern: /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g,
    message: 'raw colour value — use a semantic token',
    // Comments citing the Design System's own hex values are documentation.
    ignoreLine: (line) => line.trim().startsWith('*') || line.trim().startsWith('//'),
  },
  {
    id: 'raw-size',
    // Arbitrary pixel values in Tailwind classes: h-[52px], w-[300px].
    pattern: /\b[hwp]-\[\d+px\]/g,
    message: 'hardcoded pixel size — use a density token (h-control, h-input, …)',
  },
  {
    id: 'gradient',
    /**
     * v5.0 amended UI Spec §6.4. Gradients are no longer banned outright —
     * they are banned as *ad hoc* values. A screen may use the named tokens
     * (`bg-gradient-brand`, `bg-gradient-danger`, …) defined once in
     * globals.css; it may not hand-roll `bg-gradient-to-br from-blue-500`,
     * because that is how a palette stops being a palette.
     *
     * The original reason for the ban is unchanged and still enforced by
     * review: a gradient may never CARRY meaning. Status is a solid fill and
     * a text label, in glare, at arm's length.
     */
    pattern: /\bbg-gradient-to-|\bfrom-\w+-\d{3}\b|\bvia-\w+-\d{3}\b|\bto-\w+-\d{3}\b/g,
    message: 'ad-hoc gradient — use a named gradient token (bg-gradient-brand, …)',
  },
  {
    id: 'opacity-meaning',
    // `opacity-50` to mean "disabled" or "less important" (UI Spec §6.4).
    pattern: /\bopacity-(0|10|20|30|40|50|60|70|80)\b/g,
    message: 'opacity used to convey meaning — use --gray-400 / --surface-secondary',
  },
];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      files.push(...walk(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const findings = [];

for (const file of walk(ROOT)) {
  const relPath = relative(process.cwd(), file);
  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, index) => {
    // An explicit `design-audit-ignore` marker exempts this line or the next,
    // so it can sit in a comment above. Meant for genuine physical dimensions
    // (a 58mm label preview), not for convenience.
    const exempt =
      line.includes('design-audit-ignore') || (lines[index - 1] ?? '').includes('design-audit-ignore');
    if (exempt) return;

    for (const rule of RULES) {
      if (rule.ignoreLine?.(line)) continue;
      const matches = line.match(rule.pattern);
      if (matches) {
        findings.push({
          rule: rule.id,
          file: relPath,
          line: index + 1,
          message: `${rule.message} → ${matches[0]}`,
        });
      }
    }

    // Glossary terms as JSX literals.
    //
    // Excluded: the dictionary (where those strings are supposed to live), the
    // item-class term map, and the seed fixtures — a location literally NAMED
    // "In Production" is tenant DATA, renamed in K04, not a UI label.
    const isTermSource =
      relPath.includes('dictionary') ||
      relPath.includes('itemClass') ||
      relPath.includes('fixtures') ||
      relPath.includes('design-audit');

    if (!isTermSource) {
      const isComment = line.trim().startsWith('*') || line.trim().startsWith('//');
      if (!isComment && !line.includes('design-audit-ignore')) {
        for (const term of GLOSSARY) {
          if (line.includes(`>${term}<`) || line.includes(`"${term}"`) || line.includes(`'${term}'`)) {
            findings.push({
              rule: 'hardcoded-term',
              file: relPath,
              line: index + 1,
              message: `locked glossary term "${term}" written directly — use useTerm()`,
            });
          }
        }
      }
    }
  });
}

const byRule = {};
for (const finding of findings) {
  byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
}

if (findings.length === 0) {
  console.log('design audit: clean — no raw colours, sizes, gradients, or hardcoded glossary terms');
  process.exit(0);
}

console.error(`design audit: ${findings.length} finding(s)\n`);
for (const finding of findings) {
  console.error(`  ${finding.file}:${finding.line}  [${finding.rule}] ${finding.message}`);
}
console.error('\nby rule:', byRule);
process.exit(1);
