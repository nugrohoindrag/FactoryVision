import { uuidv7 } from '@fv/contracts';

/**
 * The one place that knows where the server is and how to prove who we are.
 *
 * Default `/api`, same origin as the app. That is not a convenience: the trial
 * deploys the PWA and the API behind a single Hostinger hostname, so a relative
 * base means no CORS preflight on every sync and no build-time URL to get wrong
 * between environments. `VITE_API_URL` overrides it for the split deployment
 * this will eventually become.
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? '/api';

const DEVICE_ID_KEY = 'fv.deviceId';

/**
 * This device's permanent identity (B-017).
 *
 * The server decides "known device" versus "new device" from this, and that
 * decision is what lets L01 sign an operator in offline. So it must survive
 * reloads and outlive any session — a device id regenerated on refresh would
 * make every sign-in look like a new phone, and offline sign-in would never
 * work twice.
 *
 * localStorage, not IndexedDB: it is read synchronously on the first render,
 * and it is forty characters.
 */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = uuidv7();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/** What every authenticated endpoint returns on the way in. */
export interface SessionResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; name: string; role: string; tenantId: string };
  tenant: { id: string; name: string; readOnly: boolean; trialEndsAt: string };
  deviceId: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * A single request, with the server's error message preserved.
 *
 * The API answers failures as `{ error: { code, message } }` and those messages
 * are written to be read by the person holding the phone — "wait fifteen
 * minutes", "this account is no longer active". Replacing them with a generic
 * string here would throw away the only part of the response that helps.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-device-id': deviceId(),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new ApiError(
      response.status,
      body?.error?.message ?? `Request failed (${response.status})`,
      body?.error?.code,
    );
  }

  // 204 has no body, and `.json()` on an empty response throws.
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/* --- the way in ----------------------------------------------------------- */

export async function registerFactory(input: {
  factoryName: string;
  ownerName: string;
  phone: string;
}): Promise<SessionResponse> {
  return apiFetch<SessionResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ ...input, deviceId: deviceId() }),
  });
}

/**
 * Trial sign-in: phone number, no code.
 *
 * Pairs with `AUTH_SKIP_OTP` on the server, which refuses this outright unless
 * it is switched on and cannot be switched on in production. When the OTP flow
 * comes back this call is replaced by the two-step pair below it, and nothing
 * else in the app has to change — the session it returns is identical.
 */
export async function signInWithoutOtp(phone: string): Promise<SessionResponse> {
  return apiFetch<SessionResponse>('/auth/sign-in', {
    method: 'POST',
    body: JSON.stringify({ phone, deviceId: deviceId() }),
  });
}

export async function requestOtp(phone: string): Promise<{ sent: true; expiresInSeconds: number }> {
  return apiFetch('/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone }) });
}

export async function verifyOtp(phone: string, code: string): Promise<SessionResponse> {
  return apiFetch<SessionResponse>('/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ phone, code, deviceId: deviceId() }),
  });
}

export async function refreshSession(refreshToken: string): Promise<SessionResponse> {
  return apiFetch<SessionResponse>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

export async function signOut(token: string): Promise<void> {
  await apiFetch('/auth/sign-out', { method: 'POST' }, token);
}
