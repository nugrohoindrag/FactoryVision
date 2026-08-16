import { ChevronDown, FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDensityPreference, type DensityPreference } from '@/app/density';
import { DEV_TENANTS, DEV_USERS, homeShellFor, useSession } from '@/app/session';
import { isInternalBuild } from '@/lib/buildMode';
import { useTerm } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';

/**
 * Temporary role & tenant picker (T-020, UI Spec §24).
 *
 * Collapsed to a single 32px strip by default. Expanded, it took three rows and
 * about a fifth of a 360px screen — which meant every screenshot and every
 * field test was judging the product with a development tool sitting on top of
 * it. A test instrument must not change what is being tested.
 *
 * Present in internal builds only, including the installed build used for
 * field testing — role switching is how one test phone covers five roles.
 * Deleted whole by T-104 once real authentication exists.
 */
export function DevSessionSwitcher() {
  const t = useTerm();
  const navigate = useNavigate();
  const { user, tenantId, setUser, setTenant } = useSession();
  const { preference, setPreference } = useDensityPreference();
  const [open, setOpen] = useState(false);

  if (!isInternalBuild) return null;

  const selectClass =
    'h-8 rounded-sm border border-border bg-card px-2 text-caption text-text-primary';

  return (
    // Marked as dev chrome so the touch-target audit measures the PRODUCT and
    // not this instrument. It is intentionally below the 48dp minimum — it is
    // never shipped to an operator, and T-104 deletes it entirely.
    <div data-dev-chrome className="border-b border-border bg-secondary text-text-secondary">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-8 w-full items-center gap-2 px-3 text-caption"
      >
        <FlaskConical size={13} aria-hidden />
        <span className="font-semibold uppercase tracking-wide">Internal</span>
        <span className="min-w-0 truncate">
          {user.name} · {DEV_TENANTS.find((x) => x.id === tenantId)?.name}
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={cn('ml-auto shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 pb-2">
          <label className="flex items-center gap-1.5 text-caption">
            {t('dev_role')}
            <select
              className={selectClass}
              value={user.id}
              onChange={(e) => {
                const next = DEV_USERS.find((u) => u.id === e.target.value);
                if (!next) return;
                setUser(next);
                navigate(homeShellFor(next.role) === 'office' ? '/o' : '/f');
              }}
            >
              {DEV_USERS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-caption">
            {t('dev_tenant')}
            <select
              className={selectClass}
              value={tenantId}
              onChange={(e) => setTenant(e.target.value)}
            >
              {DEV_TENANTS.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-caption">
            {t('dev_density')}
            <select
              className={selectClass}
              value={preference}
              onChange={(e) => setPreference(e.target.value as DensityPreference)}
            >
              <option value="auto">auto</option>
              <option value="touch">touch</option>
              <option value="compact">compact</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
