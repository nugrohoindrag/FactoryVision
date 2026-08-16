import {
  DEFAULT_TENANT_CONFIG as SHARED_DEFAULTS,
  type TenantConfig as SharedTenantConfig,
} from '@fv/contracts';
import type { TermOverrides } from '@/lib/terms/dictionary';

/**
 * Tenant configuration — PRD §9.2.
 *
 * Everything here is DATA, not code. PRD §9.1 is explicit: Phase 1 does not
 * build a template engine, because an abstraction drawn from a single example
 * is almost always the wrong one. What it builds instead is every future
 * template axis as per-tenant configuration with one default value.
 *
 * The dividing rule: if a difference between factories touches the DATA
 * SCHEMA it belongs in the core engine; if it only touches BEHAVIOUR or
 * LANGUAGE it belongs here.
 *
 * K14 (T-094) is the screen that edits this. The shape is fixed now because
 * screens read it from the first sprint — retrofitting it later would mean
 * touching every screen that has a rule in it.
 */

/**
 * The shape now lives in `@fv/contracts` because the SERVER stores this
 * document and syncs it down (Backend Plan B-058). Two copies of the same
 * defaults would drift, and the drift would be silent: a factory whose device
 * thinks deep inspection is off while the server thinks it is on gets two
 * different answers rather than an error.
 *
 * What stays here is the one thing the server has no business knowing — the
 * TERM VOCABULARY. `terms` is a loose string map in the contract and a typed
 * `TermOverrides` here, so screens keep their key checking without the server
 * becoming a second place to update when a term is added.
 */
export type { FieldRule } from '@fv/contracts';

export interface TenantConfig extends Omit<SharedTenantConfig, 'terms'> {
  /** Interface terminology overrides. English is the default, not a constant. */
  terms: TermOverrides;
}

/** The Manufaktur template's default values — the only template in Phase 1. */
export const DEFAULT_TENANT_CONFIG: TenantConfig = SHARED_DEFAULTS as TenantConfig;

/**
 * Generates a production batch number from the pattern (PRD F7 / §9.2).
 * `20260816-S1-L2` — the operator can always overwrite it, but it is never
 * blank, because an untraceable production batch is M3 (PRD §3).
 */
export function generateBatchNumber(
  pattern: string,
  input: { date: Date; shift: string; line: string },
): string {
  const yyyy = input.date.getFullYear();
  const mm = String(input.date.getMonth() + 1).padStart(2, '0');
  const dd = String(input.date.getDate()).padStart(2, '0');
  return pattern
    .replace('YYYYMMDD', `${yyyy}${mm}${dd}`)
    .replace('YYYY', String(yyyy))
    .replace('MM', mm)
    .replace('DD', dd)
    .replace('Shift', input.shift)
    .replace('Line', input.line);
}
