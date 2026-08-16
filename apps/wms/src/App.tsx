import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApplyDensity } from '@/app/density';
import { homeShellFor, useSession } from '@/app/session';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { TermProvider } from '@/lib/terms/useTerm';

/**
 * Root layout: terminology layer, density, and the role → shell landing rule.
 * The route map itself lives in `app/routes.tsx`.
 */
export function App() {
  useApplyDensity();

  const config = useTenantConfig();
  const role = useSession((s) => s.user.role);
  const location = useLocation();
  const navigate = useNavigate();

  // Landing on `/` sends each role to its own shell. Deep links are left
  // alone: a warehouse head opening L23 from a notification stays on L23.
  useEffect(() => {
    if (location.pathname !== '/') return;
    navigate(homeShellFor(role) === 'office' ? '/o' : '/f', { replace: true });
  }, [location.pathname, navigate, role]);

  return (
    // Tenant term overrides come from K14's configuration; with none set,
    // every label resolves to its English default (PRD §9.2).
    <TermProvider overrides={config.terms}>
      <Outlet />
    </TermProvider>
  );
}
