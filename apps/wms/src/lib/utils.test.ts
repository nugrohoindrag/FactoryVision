import { describe, expect, it } from 'vitest';
// The preset is plain JS with no types; this test only reads its key names.
// @ts-expect-error -- untyped workspace module, intentionally imported raw
import preset from '@fv/tokens/tailwind-preset';
import { cn, FONT_SIZES } from './utils';

/**
 * `cn()` regression tests.
 *
 * These exist because the failure they guard against is invisible. When
 * `twMerge` does not recognise a role-named size it files it under TEXT
 * COLOUR, so a size and a colour in the same call look like two competing
 * colours and the size is dropped — no error, no warning, no missing class in
 * the stylesheet. The product rendered every heading and every KPI figure at
 * body size for as long as nobody measured a screenshot.
 */

describe('cn keeps a role-named size alongside a colour', () => {
  for (const size of FONT_SIZES) {
    it(`text-${size} survives a text colour`, () => {
      const out = cn(`text-${size} font-semibold`, 'text-text-primary');
      expect(out).toContain(`text-${size}`);
      expect(out).toContain('text-text-primary');
    });
  }

  it('still lets one size override another', () => {
    expect(cn('text-body', 'text-h2')).toBe('text-h2');
  });

  it('still lets one colour override another', () => {
    expect(cn('text-text-primary', 'text-st-danger')).toBe('text-st-danger');
  });
});

describe('cn resolves the other token scales by intent', () => {
  it('a later radius wins instead of both surviving', () => {
    expect(cn('rounded-card', 'rounded-pill')).toBe('rounded-pill');
  });

  it('a directional padding overrides only its own side', () => {
    expect(cn('p-card', 'pt-0')).toBe('p-card pt-0');
  });

  it('a later shadow wins', () => {
    expect(cn('shadow-1', 'shadow-hover')).toBe('shadow-hover');
  });

  it('a later density height wins', () => {
    expect(cn('h-control', 'h-input')).toBe('h-input');
  });
});

/**
 * The list in `utils.ts` is a hand-kept mirror of the preset. If someone adds
 * a size to the design system and not here, every `cn()` call combining it
 * with a colour starts silently dropping it again — so the mirror is checked
 * rather than trusted.
 */
describe('the merge config mirrors the design system', () => {
  it('covers every font size in the Tailwind preset', () => {
    const inPreset = Object.keys(preset.theme.extend.fontSize);
    expect([...FONT_SIZES].sort()).toEqual(inPreset.sort());
  });
});
