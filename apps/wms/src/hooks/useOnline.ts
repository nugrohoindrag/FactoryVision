import { useSyncExternalStore } from 'react';

/**
 * Connectivity, for screens that must state their offline behaviour
 * (UI Spec §6.2 / §15.3).
 *
 * Note what this is NOT used for: gating input. Every P0 transaction screen
 * works offline, so being offline changes what a screen SAYS, never what it
 * lets an operator do.
 */
function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
