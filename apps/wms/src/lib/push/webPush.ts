/**
 * Web Push (T-083, PRD F11).
 *
 * The alerts that matter — a material issue open past 24 hours, an adjustment
 * waiting for approval — are useless if they only exist inside an app nobody
 * has open. Push is how an owner finds out in five minutes a day rather than
 * at month end.
 *
 * **Scope, stated honestly:** Android Chrome only. iOS is deferred at PRD §10,
 * and this is one of the places that decision has a visible cost. WhatsApp
 * notification arrives in P1 and PRD F11 is explicit that it must never be a
 * launch dependency.
 *
 * The subscription needs a VAPID public key and an endpoint to register
 * against, both of which come from the backend (Tech Stack §1.3, not yet
 * built). Until then `subscribe()` reports `backend-missing` rather than
 * pretending to work — a notification system that silently does nothing is
 * worse than one that says it is not ready.
 */

export type PushSupport = 'ready' | 'unsupported' | 'denied' | 'backend-missing';

export interface PushState {
  support: PushSupport;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
}

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getPushState(): Promise<PushState> {
  if (!isPushSupported()) {
    return { support: 'unsupported', permission: 'unsupported', subscribed: false };
  }

  const registration = await navigator.serviceWorker.getRegistration();
  const existing = await registration?.pushManager.getSubscription();

  return {
    support: VAPID_PUBLIC_KEY ? 'ready' : 'backend-missing',
    permission: Notification.permission,
    subscribed: Boolean(existing),
  };
}

/**
 * Asks for permission and registers a subscription.
 *
 * Permission is requested at the moment the user turns notifications ON, never
 * on first launch — a permission prompt before any value has been shown is the
 * fastest way to get permanently denied.
 */
export async function subscribeToPush(): Promise<PushState> {
  if (!isPushSupported()) {
    return { support: 'unsupported', permission: 'unsupported', subscribed: false };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { support: 'denied', permission, subscribed: false };
  }

  if (!VAPID_PUBLIC_KEY) {
    return { support: 'backend-missing', permission, subscribed: false };
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  // The backend stores this against the user so it can target the right phone.
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(subscription),
  }).catch(() => {
    // Offline is normal here. The subscription exists in the browser and can
    // be re-sent on the next successful sync.
  });

  return { support: 'ready', permission, subscribed: true };
}

export async function unsubscribeFromPush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
}

/** VAPID keys arrive base64url-encoded; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}
