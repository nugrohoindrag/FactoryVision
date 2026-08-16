import type { Role } from '@fv/contracts';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEMO_TENANT_ID } from '@/db/fixtures';

/**
 * Active user context (UI Spec §24).
 *
 * Sign-in is deliberately the LAST screen built, but its foundations are not
 * deferred: every event records who did it, every query filters by tenant,
 * and every action checks a role. Until L01 exists, a temporary picker fills
 * this store (T-020) — and removing that picker (T-104) must not require
 * changing anything else.
 */

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
}

/** Stand-in users for the development role picker. Removed with T-104. */
export const DEV_USERS: SessionUser[] = [
  { id: '50000000-0000-4000-8000-000000000001', name: 'Budi (Operator)', role: 'OPERATOR' },
  { id: '50000000-0000-4000-8000-000000000002', name: 'Sari (Production)', role: 'PRODUCTION' },
  { id: '50000000-0000-4000-8000-000000000003', name: 'Rian (QC)', role: 'QC' },
  { id: '50000000-0000-4000-8000-000000000004', name: 'Wati (Warehouse Head)', role: 'WAREHOUSE_HEAD' },
  { id: '50000000-0000-4000-8000-000000000005', name: 'Pak Hendra (Owner)', role: 'OWNER' },
];

export const DEV_TENANTS = [{ id: DEMO_TENANT_ID, name: 'Demo factory' }];

interface SessionState {
  tenantId: string;
  user: SessionUser;
  setUser: (user: SessionUser) => void;
  setTenant: (tenantId: string) => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      tenantId: DEMO_TENANT_ID,
      user: DEV_USERS[0]!,
      setUser: (user) => set({ user }),
      setTenant: (tenantId) => set({ tenantId }),
    }),
    { name: 'fv.session' },
  ),
);

/**
 * Which shell a role lives in (UI Spec §2). The Warehouse Head works in both:
 * the office by default, but L04, L23 and L25 are field screens they use while
 * walking the racks.
 */
export function homeShellFor(role: Role): 'field' | 'office' {
  return role === 'OWNER' || role === 'WAREHOUSE_HEAD' ? 'office' : 'field';
}

/** Permission checks sit on the ACTION, never on the screen (UI Spec §24). */
export const PERMISSIONS = {
  'receipt.create': ['OPERATOR', 'WAREHOUSE_HEAD'],
  'inspection.decide': ['QC', 'WAREHOUSE_HEAD'],
  'issue.request': ['PRODUCTION', 'WAREHOUSE_HEAD'],
  'issue.prepare': ['OPERATOR', 'WAREHOUSE_HEAD'],
  'issue.close': ['PRODUCTION', 'WAREHOUSE_HEAD'],
  'stock.adjust': ['WAREHOUSE_HEAD'],
  'adjustment.approve': ['WAREHOUSE_HEAD', 'OWNER'],
  'stocktake.create': ['WAREHOUSE_HEAD'],
  'stocktake.count': ['OPERATOR', 'WAREHOUSE_HEAD'],
  'config.edit': ['OWNER'],
  'value.view': ['WAREHOUSE_HEAD', 'OWNER'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Hook form of {@link can}, bound to the active user. */
export function usePermission(permission: Permission): boolean {
  const role = useSession((s) => s.user.role);
  return can(role, permission);
}
