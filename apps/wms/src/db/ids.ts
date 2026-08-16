/**
 * Moved to `@fv/contracts` (B-027).
 *
 * Event ids are also the replay order, and the server sorts by them inside a
 * device's chain. One generator, one layout.
 *
 * Kept as a re-export so existing imports (`./ids`) still resolve.
 */
export { isUuidV7, timestampOf, uuidv7 } from '@fv/contracts';
