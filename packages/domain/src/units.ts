import type { Product, UnitCode } from '@fv/contracts';
import { div, mul, type Qty } from './qty.js';

/**
 * Unit conversion (DS §13 "Satuan konversi").
 *
 * Stock is always stored in the product's `baseUnit`. Operators enter what
 * they can see on the sack — `3 sak` — and this converts it. The conversion
 * runs through big.js, because `3 sak × 25.5 kg` in floats is exactly how a
 * warehouse ends up with 76.49999999999999 kg on the stock card.
 */

export class UnknownUnitError extends Error {
  constructor(
    readonly unit: UnitCode,
    readonly product: Pick<Product, 'sku' | 'baseUnit'>,
  ) {
    super(`Unit "${unit}" is not defined for ${product.sku} (base unit ${product.baseUnit})`);
    this.name = 'UnknownUnitError';
  }
}

type ConvertibleProduct = Pick<Product, 'sku' | 'baseUnit' | 'conversions'>;

/** Factor that turns 1 `unit` into `baseUnit` quantity. */
function factorToBase(product: ConvertibleProduct, unit: UnitCode): Qty {
  if (unit === product.baseUnit) return '1';

  const direct = product.conversions.find((c) => c.from === unit && c.to === product.baseUnit);
  if (direct) return direct.factor;

  // A conversion stored the other way round (`kg → sak`) is still usable.
  const inverse = product.conversions.find((c) => c.to === unit && c.from === product.baseUnit);
  if (inverse) return div('1', inverse.factor);

  throw new UnknownUnitError(unit, product);
}

/** `toBase(product, '3', 'sak')` → `'75'` when 1 sak = 25 kg. */
export function toBase(product: ConvertibleProduct, quantity: Qty, unit: UnitCode): Qty {
  return mul(quantity, factorToBase(product, unit));
}

/** Inverse of {@link toBase}. Used for display in the unit the floor prefers. */
export function fromBase(product: ConvertibleProduct, quantity: Qty, unit: UnitCode): Qty {
  return div(quantity, factorToBase(product, unit));
}

/** Every unit this product accepts as input, base unit first. */
export function availableUnits(product: ConvertibleProduct): UnitCode[] {
  const units = new Set<UnitCode>([product.baseUnit]);
  for (const c of product.conversions) {
    if (c.to === product.baseUnit) units.add(c.from);
    if (c.from === product.baseUnit) units.add(c.to);
  }
  return [...units];
}
