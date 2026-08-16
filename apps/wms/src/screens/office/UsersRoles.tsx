import type { Role } from '@fv/contracts';
import { Check, Minus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DEV_USERS } from '@/app/session';
import { PERMISSIONS, type Permission } from '@/app/session';
import { IconChip } from '@/components/factoryvision/IconChip';
import { Badge } from '@/components/ui/badge';
import { TableCell, TableRow } from '@/components/ui/table';
import { useTerm } from '@/lib/terms/useTerm';
import { MasterLayout, MasterTable, Td, Th } from './MasterLayout';

/**
 * K13 · Users & roles (UI Spec §21, PRD F13).
 *
 * Five roles, and one rule that shapes the model: **a person may hold more
 * than one role, and the permissions are UNIONED.** In a small factory the
 * warehouse head is often also the QC inspector, and making them log out and
 * back in as a different profile is the kind of friction that gets a system
 * abandoned (UI Spec open question #1).
 *
 * The permission matrix is shown as data because it is data — the same table
 * the application checks at every action (`can(role, permission)`). What is
 * displayed here cannot drift from what is enforced.
 *
 * Purchase price is hidden from Operator and Production by default, which is
 * why `value.view` is a permission rather than a screen-level rule.
 */

const ROLE_ORDER: Role[] = ['OWNER', 'WAREHOUSE_HEAD', 'OPERATOR', 'PRODUCTION', 'QC'];

const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  WAREHOUSE_HEAD: 'Warehouse Head',
  OPERATOR: 'Warehouse Operator',
  PRODUCTION: 'Production',
  QC: 'QC',
};

/**
 * A role is a CATEGORY, so it gets a data accent rather than a status colour.
 * Five roles all wearing the same badge is the same as no badge — the reader
 * has to fall back to reading each label, on a screen whose whole job is
 * showing who can do what at a glance.
 */
const ROLE_TONE: Record<Role, 'violet' | 'teal' | 'cyan' | 'amber' | 'rose'> = {
  OWNER: 'violet',
  WAREHOUSE_HEAD: 'teal',
  OPERATOR: 'cyan',
  PRODUCTION: 'amber',
  QC: 'rose',
};

const PERMISSION_LABELS: Record<Permission, string> = {
  'receipt.create': 'Record goods receipt',
  'inspection.decide': 'Pass / hold / reject',
  'issue.request': 'Request material',
  'issue.prepare': 'Prepare material issue',
  'issue.close': 'Close material issue',
  'stock.adjust': 'Adjust stock',
  'adjustment.approve': 'Approve adjustments',
  'stocktake.create': 'Start a stock take',
  'stocktake.count': 'Count stock',
  'config.edit': 'Change configuration',
  'value.view': 'See prices and value',
};

export function UsersRoles() {
  const t = useTerm();
  const [query, setQuery] = useState('');

  const users = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return DEV_USERS.filter((u) => needle === '' || u.name.toLowerCase().includes(needle));
  }, [query]);

  const permissions = Object.keys(PERMISSIONS) as Permission[];

  return (
    <div className="space-y-10">
      <MasterLayout
        title={t('screen_users_roles')}
        description="Five roles. One person can hold several — the permissions add up rather than replacing each other."
        query={query}
        onQueryChange={setQuery}
        createLabel="Invite user"
        count={users.length}
        loading={false}
        emptyTitle="Nothing matches that"
        emptyBody="Try part of the name."
      >
        <MasterTable
          head={
            <>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Sees prices</Th>
            </>
          }
        >
          {users.map((user) => (
            <TableRow key={user.id}>
              <Td>{user.name}</Td>
              <Td>
                <Badge variant={ROLE_TONE[user.role]}>{ROLE_LABELS[user.role]}</Badge>
              </Td>
              <Td muted>
                {(PERMISSIONS['value.view'] as readonly Role[]).includes(user.role) ? 'Yes' : 'No'}
              </Td>
            </TableRow>
          ))}
        </MasterTable>
      </MasterLayout>

      <section className="space-y-3">
        <div>
          <h2 className="text-title font-semibold text-text-primary">What each role may do</h2>
          <p className="pt-1 text-body-sm text-text-secondary">
            This is the same table the app checks before every action — not a description of it.
          </p>
        </div>

        <div className="overflow-x-auto rounded-card border border-border">
          <MasterTable
            head={
              <>
                <Th>Action</Th>
                {ROLE_ORDER.map((role) => (
                  <Th key={role}>{ROLE_LABELS[role]}</Th>
                ))}
              </>
            }
          >
            {permissions.map((permission) => (
              <TableRow key={permission}>
                <Td>{PERMISSION_LABELS[permission]}</Td>
                {ROLE_ORDER.map((role) => {
                  const allowed = (PERMISSIONS[permission] as readonly Role[]).includes(role);
                  return (
                    <TableCell key={role}>
                      {allowed ? (
                        <IconChip icon={Check} tone="success" size="sm" aria-label="allowed" />
                      ) : (
                        <IconChip icon={Minus} tone="soft" size="sm" aria-label="not allowed" />
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </MasterTable>
        </div>
      </section>
    </div>
  );
}
