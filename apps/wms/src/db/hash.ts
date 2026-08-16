/**
 * Moved to `@fv/contracts` (B-027).
 *
 * The server has to verify the exact chain this client produced. Two copies of
 * a hash function are two hash functions: they agree until one is touched, and
 * then every event from every phone in the field is rejected as tampered.
 *
 * Kept as a re-export so existing imports (`./hash`) still resolve.
 */
export { canonical, hashEvent, verifyChain, type HashableEvent } from '@fv/contracts';
