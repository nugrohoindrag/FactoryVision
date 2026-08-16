import type { EventType } from '@fv/contracts';
import { useCallback } from 'react';
import { useSession } from '@/app/session';
import { appendEvent } from './appendEvent';

/**
 * The write path, bound to the active session.
 *
 * Screens never construct an envelope themselves — actor, role, tenant, device
 * and the hash chain are filled in here, so every event carries who did it
 * without a single screen having to remember (UI Spec §24).
 */
export function useAppend() {
  const tenantId = useSession((s) => s.tenantId);
  const user = useSession((s) => s.user);

  return useCallback(
    <T extends EventType>(type: T, payload: unknown) =>
      appendEvent({ tenantId, actorId: user.id, actorRole: user.role }, type, payload),
    [tenantId, user.id, user.role],
  );
}
