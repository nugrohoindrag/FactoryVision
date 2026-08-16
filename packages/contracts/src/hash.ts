/**
 * Event hash chain (T-013).
 *
 * Every event carries the hash of the previous event written on this device.
 * A gap or an edit breaks the chain, so tampering and dropped events are
 * detectable on ingest — which is what lets the server accept transactions
 * that were created days ago on a phone it has never spoken to.
 *
 * This is integrity, not secrecy: SHA-256 over a canonical serialisation.
 */

/** Stable stringify — key order must not change the hash. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

export interface HashableEvent {
  id: string;
  tenantId: string;
  type: string;
  occurredAt: string;
  actorId: string;
  deviceId: string;
  prevHash: string | null;
  payload: unknown;
}

export async function hashEvent(event: HashableEvent): Promise<string> {
  const material = canonical({
    id: event.id,
    tenantId: event.tenantId,
    type: event.type,
    occurredAt: event.occurredAt,
    actorId: event.actorId,
    deviceId: event.deviceId,
    prevHash: event.prevHash,
    payload: event.payload,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Verifies a device's chain end to end. Used by L03 and by ingest. */
export async function verifyChain(events: readonly HashableEvent[]): Promise<
  { ok: true } | { ok: false; brokenAt: string; reason: 'hash-mismatch' | 'chain-broken' }
> {
  let previous: string | null = null;
  for (const event of events) {
    if (event.prevHash !== previous) {
      return { ok: false, brokenAt: event.id, reason: 'chain-broken' };
    }
    const expected = await hashEvent(event);
    const actual = (event as HashableEvent & { hash?: string }).hash;
    if (actual && actual !== expected) {
      return { ok: false, brokenAt: event.id, reason: 'hash-mismatch' };
    }
    previous = expected;
  }
  return { ok: true };
}

export { canonical };
