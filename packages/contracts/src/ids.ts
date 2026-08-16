/**
 * UUIDv7 — time-ordered ids (Tech Stack §2.4 / T-013).
 *
 * Why v7 and not v4: events sort by id, so the event log replays in creation
 * order without a separate sequence column, and an index on the id is
 * append-friendly instead of scattering writes across the B-tree.
 *
 * Layout: 48-bit millisecond timestamp | version 7 | 12-bit counter | variant |
 * 62 bits of randomness.
 *
 * ## The counter is load-bearing, not decoration
 *
 * The plain layout fills everything after the timestamp with randomness, and
 * that is fine until two events are written inside the SAME millisecond — at
 * which point their relative order is decided by a coin toss. For a person
 * tapping a screen that never happens. For these two cases it happens every
 * time:
 *
 * - **Bulk import** (Backend Plan B-060) replays a factory's history in a
 *   loop, thousands of events per second.
 * - **Test fixtures and scripted flows**, which is how this was found: a
 *   `prepared` and a `handed_over` swapped places, so the projection never
 *   moved the goods off ALLOCATED and 90 kg sat reserved on a rack forever.
 *
 * Nothing about that failure looks like a sorting problem when you meet it. It
 * looks like the stock figure is wrong.
 *
 * So ids minted in the same millisecond carry an incrementing counter in the
 * 12 bits right after the version nibble (RFC 9562 §6.2, "fixed-length
 * dedicated counter"). Same millisecond → strictly increasing id. The counter
 * is per process, which is exactly the scope that matters: ordering WITHIN a
 * device's chain. Across devices the server's `receivedAt` decides
 * (Backend Plan §3.2).
 */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/** Last millisecond we minted in, and how many ids that millisecond has seen. */
let lastMs = -1;
let counter = 0;

/** 12 bits — 4096 ids per millisecond, far past any real write rate. */
const COUNTER_MAX = 0xfff;

export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);

  if (now === lastMs) {
    counter += 1;
    if (counter > COUNTER_MAX) {
      // Overflowed a millisecond. Borrowing from the next one keeps ids
      // strictly increasing, which matters more here than the timestamp being
      // accurate to the millisecond — the timestamp is a sort key, not a clock.
      lastMs += 1;
      now = lastMs;
      counter = 0;
    }
  } else if (now > lastMs) {
    lastMs = now;
    counter = 0;
  } else {
    // The clock went backwards (NTP correction, or a device being adjusted).
    // Keep the previous millisecond rather than emitting an id that sorts
    // before events already written.
    now = lastMs;
    counter += 1;
  }

  // 48-bit big-endian timestamp
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  crypto.getRandomValues(bytes.subarray(6));

  bytes[6] = 0x70 | ((counter >> 8) & 0x0f); // version 7 + counter high nibble
  bytes[7] = counter & 0xff; // counter low byte
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant

  const h = (i: number) => HEX[bytes[i]!]!;
  return (
    h(0) + h(1) + h(2) + h(3) + '-' +
    h(4) + h(5) + '-' +
    h(6) + h(7) + '-' +
    h(8) + h(9) + '-' +
    h(10) + h(11) + h(12) + h(13) + h(14) + h(15)
  );
}

/** Milliseconds encoded in a v7 id — lets us sort/filter without parsing dates. */
export function timestampOf(uuid: string): number {
  return Number.parseInt(uuid.slice(0, 8) + uuid.slice(9, 13), 16);
}

export function isUuidV7(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
