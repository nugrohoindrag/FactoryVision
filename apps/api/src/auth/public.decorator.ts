import { SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions.js';

/**
 * Authentication is on by default and switched off one endpoint at a time.
 *
 * The inverse — open by default, protected where somebody remembered — is how
 * an endpoint ships unprotected. There are exactly four public routes in this
 * product (health, ready, register, the two OTP steps), and each one says so.
 */
export const PUBLIC_KEY = 'fv:public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const PERMISSION_KEY = 'fv:permission';
/** `@Requires('po.write')` — the action, not the screen (B-018). */
export const Requires = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);

/**
 * Marks a route as a write. Trial-expired tenants keep full READ access to
 * their own data and lose only this (PRD F13.1) — withholding a customer's
 * data is the fastest way to lose trust, and that holds when they have not
 * paid too.
 */
export const WRITE_KEY = 'fv:write';
export const Write = () => SetMetadata(WRITE_KEY, true);
