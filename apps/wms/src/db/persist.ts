/**
 * Persistent storage (Tech Stack §2.7a).
 *
 * IndexedDB without permission can be evicted when the phone runs low on
 * space — and that means an operator's day of transactions is gone. Not
 * acceptable for a 7-day offline queue.
 *
 * Browsers evict based on FREE space, not capacity: a 64GB phone with 2GB
 * free behaves exactly like a 32GB one with 2GB free, and an operator's
 * phone is full of photos and WhatsApp like anyone else's.
 */

export interface StorageState {
  /** Granted means the browser will not evict this origin silently. */
  persisted: boolean;
  /** Bytes used / available, when the browser reports them. */
  usage?: number;
  quota?: number;
  /** Fraction of quota used, 0–1. Drives the L03 quota panel. */
  ratio?: number;
  supported: boolean;
}

export async function requestPersistentStorage(): Promise<StorageState> {
  if (!('storage' in navigator) || !navigator.storage?.persist) {
    return { persisted: false, supported: false };
  }

  const already = await navigator.storage.persisted();
  const persisted = already || (await navigator.storage.persist());

  return { ...(await storageEstimate()), persisted, supported: true };
}

export async function storageEstimate(): Promise<StorageState> {
  if (!('storage' in navigator) || !navigator.storage?.estimate) {
    return { persisted: false, supported: false };
  }
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  const { usage, quota } = await navigator.storage.estimate();
  return {
    persisted,
    supported: true,
    usage,
    quota,
    ratio: usage !== undefined && quota ? usage / quota : undefined,
  };
}

/**
 * Has the local database been wiped out from under us? (T-047)
 * A device that once held events and now holds none, while the app still
 * believes it is signed in, means the browser cleared storage — the operator
 * must be told loudly, not left to discover it at the next stock take.
 */
export async function detectStorageLoss(input: {
  hadEventsBefore: boolean;
  eventCountNow: number;
}): Promise<boolean> {
  return input.hadEventsBefore && input.eventCountNow === 0;
}
