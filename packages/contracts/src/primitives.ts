import { z } from 'zod';

/**
 * A quantity or money value. ALWAYS a decimal string, never a JS number.
 * Tech Stack §2.4: `0.1 + 0.2 !== 0.3` means a Material Issue can never close
 * clean, and the variance report — the report owners actually want — becomes
 * untrustworthy. Arithmetic happens in @fv/domain via big.js.
 */
export const Decimal = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'must be a decimal string, e.g. "12.5"');
export type Decimal = z.infer<typeof Decimal>;

/** Non-negative decimal — quantities on hand, issued, counted. */
export const Quantity = Decimal.refine((v) => !v.startsWith('-'), {
  message: 'quantity cannot be negative',
});

export const Uuid = z.string().uuid();
export const TenantId = Uuid.brand<'TenantId'>();
export type TenantId = z.infer<typeof TenantId>;

export const UserId = Uuid.brand<'UserId'>();
export type UserId = z.infer<typeof UserId>;

/** ISO 8601 with timezone. Device clocks drift; the server records arrival separately. */
export const Timestamp = z.string().datetime({ offset: true });
export type Timestamp = z.infer<typeof Timestamp>;

/** Calendar date without time — production date, expiry date. */
export const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type DateOnly = z.infer<typeof DateOnly>;

/** Unit of measure code as the floor says it: `kg`, `pcs`, `sak`, `box`. */
export const UnitCode = z.string().min(1).max(12);
export type UnitCode = z.infer<typeof UnitCode>;
