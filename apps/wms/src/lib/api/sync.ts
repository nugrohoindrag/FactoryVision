import { useSession } from '@/app/session';
import { drainOutbox, noopTransport, type SyncOutcome } from '@/db/sync';
import { httpTransport, pullAll, type TransportConfig } from '@/db/transport';
import { API_BASE_URL, deviceId, refreshSession } from './client';

/**
 * Where the offline database meets the server (T-104).
 *
 * `drainOutbox` and `pullAll` were both written and tested long before there
 * was anything to talk to; `drainOutbox` defaulted to `noopTransport` and the
 * comment above it said so plainly. This module is the wire that was missing,
 * and it is deliberately the ONLY place that decides whether a sync actually
 * leaves the device.
 */

/** Refresh this long before expiry, so a slow drain does not 401 halfway. */
const REFRESH_MARGIN_MS = 120_000;

/**
 * Returns a usable access token, renewing it first if it is about to lapse.
 *
 * Renewal happens here rather than on a 401 because `TransportConfig.token` is
 * synchronous — the transport can read a token but cannot go and fetch one. So
 * the freshness check belongs before the sync starts, not inside it.
 *
 * A failed refresh signs the session out rather than retrying. A refresh token
 * the server rejects is a session that is over — it was revoked, replayed, or
 * expired — and retrying it only delays telling the operator.
 */
export async function ensureFreshToken(): Promise<string | null> {
  const { tokens, applySession, clearSession } = useSession.getState();
  if (!tokens) return null;
  if (tokens.expiresAt - Date.now() > REFRESH_MARGIN_MS) return tokens.accessToken;

  try {
    const session = await refreshSession(tokens.refreshToken);
    applySession(session);
    return session.accessToken;
  } catch {
    clearSession();
    return null;
  }
}

/**
 * Builds the transport, or refuses to.
 *
 * Signed out means `noopTransport`, exactly as before sign-in existed. The
 * outbox keeps its rows and nothing is lost — which is the whole reason the
 * offline database is the source of truth and the server is a destination.
 */
function transportConfig(token: string): TransportConfig {
  return {
    baseUrl: API_BASE_URL,
    token: () => token,
    deviceId: deviceId(),
  };
}

export interface FullSyncOutcome extends SyncOutcome {
  /** Events accepted FROM the server. */
  pulled: number;
  /** No session, or no network — nothing was attempted. */
  offline: boolean;
}

/**
 * One full round trip: push what we owe, then take what we are owed.
 *
 * Push first on purpose. The local outbox holds work an operator has already
 * done, and a pull that arrives first could apply a server event that the
 * projection then has to reconcile against an unsent local one. Sending first
 * keeps the log's order closer to the order things actually happened in.
 */
export async function syncNow(tenantId: string): Promise<FullSyncOutcome> {
  const token = await ensureFreshToken();

  if (!token || !navigator.onLine) {
    const outcome = await drainOutbox(tenantId, noopTransport);
    return { ...outcome, pulled: 0, offline: true };
  }

  const config = transportConfig(token);
  const outcome = await drainOutbox(tenantId, httpTransport(config));
  const pulled = await pullAll(config, tenantId);

  return { ...outcome, pulled, offline: false };
}
