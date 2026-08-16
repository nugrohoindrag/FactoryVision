import { isUuidV7, timestampOf, uuidv7 } from '@fv/contracts';
import { describe, expect, it } from 'vitest';

/**
 * Event ids are the replay order. If two ids minted in the same millisecond can
 * come out in either order, the projection can apply a handover before the pick
 * it hands over — and 90 kg sits reserved on a rack with nothing in the UI to
 * explain why.
 *
 * That is not a hypothetical: it is how the counter in `uuidv7` came to exist.
 */
describe('uuidv7 ordering', () => {
  it('is strictly increasing within one millisecond', () => {
    const ids = Array.from({ length: 5_000 }, () => uuidv7());
    const sorted = [...ids].sort();
    // Not "sorted equals itself after sorting" by luck — 5,000 ids in a tight
    // loop is thousands of collisions on the same millisecond.
    expect(sorted).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is strictly increasing when the clock is pinned', () => {
    const ids = Array.from({ length: 100 }, () => uuidv7(1_700_000_000_000));
    expect([...ids].sort()).toEqual(ids);
  });

  it('never emits an id that sorts before an earlier one when the clock steps back', () => {
    const later = uuidv7(1_700_000_000_000);
    // NTP correction, or somebody fixing the date on a warehouse phone.
    const earlier = uuidv7(1_600_000_000_000);
    expect(earlier > later).toBe(true);
  });

  it('keeps the version, variant and timestamp readable', () => {
    // Ahead of anything the earlier cases pinned. The generator never goes
    // backwards, so a timestamp in the past would legitimately be clamped —
    // which is the behaviour the previous case asserts.
    const at = 4_000_000_000_000;
    const id = uuidv7(at);
    expect(isUuidV7(id)).toBe(true);
    expect(timestampOf(id)).toBe(at);
  });
});
