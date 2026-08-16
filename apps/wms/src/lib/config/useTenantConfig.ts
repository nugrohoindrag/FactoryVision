import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useSession } from '@/app/session';
import { db } from '@/db/schema';
import { DEFAULT_TENANT_CONFIG, type TenantConfig } from './tenantConfig';

/**
 * Reads this tenant's configuration, merged over the Manufaktur defaults.
 *
 * Stored in Dexie `meta` so it is available offline like everything else —
 * a factory with no signal still knows whether it runs QC.
 */
const key = (tenantId: string) => `config:${tenantId}`;

export function useTenantConfig(): TenantConfig {
  const tenantId = useSession((s) => s.tenantId);
  const stored = useLiveQuery(() => db.meta.get(key(tenantId)), [tenantId]);

  return useMemo(() => {
    const overrides = (stored?.value ?? {}) as Partial<TenantConfig>;
    return {
      ...DEFAULT_TENANT_CONFIG,
      ...overrides,
      stages: { ...DEFAULT_TENANT_CONFIG.stages, ...overrides.stages },
      fieldRules: { ...DEFAULT_TENANT_CONFIG.fieldRules, ...overrides.fieldRules },
      autoPass: { ...DEFAULT_TENANT_CONFIG.autoPass, ...overrides.autoPass },
      deepInspection: { ...DEFAULT_TENANT_CONFIG.deepInspection, ...overrides.deepInspection },
      defaults: { ...DEFAULT_TENANT_CONFIG.defaults, ...overrides.defaults },
      reasons: { ...DEFAULT_TENANT_CONFIG.reasons, ...overrides.reasons },
      terms: { ...DEFAULT_TENANT_CONFIG.terms, ...overrides.terms },
      /**
       * Replaced wholesale, never merged element-by-element. A tenant that
       * shortens `['Warehouse','Zone','Rack']` to `['Warehouse','Rack']` means
       * exactly that — merging would silently keep the third level alive and
       * the screen would disagree with the setting that produced it.
       */
      locationLevels: overrides.locationLevels?.length
        ? overrides.locationLevels
        : DEFAULT_TENANT_CONFIG.locationLevels,
    };
  }, [stored]);
}

export async function saveTenantConfig(
  tenantId: string,
  patch: Partial<TenantConfig>,
): Promise<void> {
  const existing = (await db.meta.get(key(tenantId)))?.value ?? {};
  await db.meta.put({ key: key(tenantId), value: { ...(existing as object), ...patch } });
}
