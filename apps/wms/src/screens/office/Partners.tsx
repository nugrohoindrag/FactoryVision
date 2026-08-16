import type { Partner } from '@fv/contracts';
import { useMemo, useState } from 'react';
import { useSession } from '@/app/session';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { TableRow } from '@/components/ui/table';
import { usePartners } from '@/db/hooks';
import { uuidv7 } from '@/db/ids';
import { db } from '@/db/schema';
import { useTerm } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';
import {
  Field,
  MasterFormDialog,
  MasterLayout,
  MasterTable,
  RowActions,
  Td,
  Th,
} from './MasterLayout';

/**
 * K05 · Partners (UI Spec §19, PRD F1).
 *
 * Minimal data on purpose. The spec is explicit: **do not demand a tax number
 * and a full address before someone can start working.** A supplier needs a
 * name to receive goods against; everything else can be filled in later, or
 * never.
 *
 * Onboarding friction here is paid for at the worst possible moment — the
 * first delivery, on the first day. So `Name` is the only required field, and
 * the code writes itself if left blank.
 */

const KINDS: { value: Partner['kind']; label: string; hint: string }[] = [
  { value: 'SUPPLIER', label: 'Supplier', hint: 'You receive goods from them' },
  { value: 'CUSTOMER', label: 'Customer', hint: 'You ship goods to them' },
  { value: 'BOTH', label: 'Both', hint: 'Goods move in both directions' },
];

export function Partners() {
  const t = useTerm();
  const partners = usePartners();
  const tenantId = useSession((s) => s.tenantId);
  const [query, setQuery] = useState('');

  const [editing, setEditing] = useState<Partner | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const rows = useMemo(() => {
    if (!partners) return undefined;
    const needle = query.trim().toLowerCase();
    return partners.filter(
      (p) =>
        needle === '' ||
        p.name.toLowerCase().includes(needle) ||
        p.code.toLowerCase().includes(needle),
    );
  }, [partners, query]);

  const blank = (): Partner => ({
    id: uuidv7(),
    tenantId: tenantId as Partner['tenantId'],
    code: '',
    name: '',
    kind: 'SUPPLIER',
    active: true,
  });

  /** Only the name is required — the code writes itself (PRD F1). */
  const canSave = Boolean(editing?.name.trim());

  const save = async () => {
    if (!editing || !canSave) return;
    setSaving(true);
    try {
      const name = editing.name.trim();
      await db.partners.put({
        ...editing,
        name,
        // Derived from the name rather than demanded: asking for a code before
        // the first delivery is exactly the friction this screen refuses.
        code: editing.code.trim() || autoCode(name, partners ?? []),
      });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  /** Deactivate, never delete — receipts and shipments still point at them. */
  const setActive = async (partner: Partner, active: boolean) => {
    await db.partners.put({ ...partner, active });
  };

  const toggleActive = async () => {
    if (!editing) return;
    await setActive(editing, !editing.active);
    setEditing(null);
  };

  return (
    <MasterLayout
      title={t('screen_partners')}
      description="Suppliers and customers. A name is enough to start."
      query={query}
      onQueryChange={setQuery}
      onCreate={() => {
        setEditing(blank());
        setIsNew(true);
      }}
      createLabel="Add partner"
      count={rows?.length}
      loading={rows === undefined}
      emptyTitle={query ? 'Nothing matches that' : 'No partners yet'}
      emptyBody={
        query
          ? 'Try the code instead.'
          : 'Add the supplier you receive from most often — that is all you need to record a delivery.'
      }
    >
      <MasterTable
        head={
          <>
            <Th>Code</Th>
            <Th>Name</Th>
            <Th>Type</Th>
            <Th>Phone</Th>
            <Th>{''}</Th>
          </>
        }
      >
        {(rows ?? []).map((partner) => (
          <TableRow
            key={partner.id}
            className={cn(!partner.active && 'text-text-disabled')}
          >
            <Td muted>{partner.code}</Td>
            <Td>{partner.name}</Td>
            <Td>
              <Badge variant={partner.kind === 'CUSTOMER' ? 'info' : 'neutral'}>
                {partner.kind === 'BOTH' ? 'Supplier & customer' : partner.kind.toLowerCase()}
              </Badge>
            </Td>
            <Td muted>{partner.phone ?? '—'}</Td>
            <Td>
              <RowActions
                label={partner.name}
                active={partner.active}
                onEdit={() => {
                  setEditing({ ...partner });
                  setIsNew(false);
                }}
                onToggleActive={() => void setActive(partner, !partner.active)}
              />
            </Td>
          </TableRow>
        ))}
      </MasterTable>

      <MasterFormDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        title={isNew ? 'Add partner' : `Edit ${editing?.name ?? ''}`}
        onSave={() => void save()}
        saveDisabled={!canSave}
        saving={saving}
        onToggleActive={isNew ? undefined : () => void toggleActive()}
        active={editing?.active}
        deactivateHint="Kept for history — past receipts and shipments still resolve."
      >
        {editing && (
          <>
            <Field label="Name" htmlFor="partner-name" required>
              <Input
                id="partner-name"
                value={editing.name}
                autoComplete="off"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>

            <Field
              label="Code"
              htmlFor="partner-code"
              hint="Leave empty and one is generated from the name."
            >
              <Input
                id="partner-code"
                value={editing.code}
                autoComplete="off"
                onChange={(e) => setEditing({ ...editing, code: e.target.value })}
              />
            </Field>

            <Field label="Type" required>
              <RadioGroup
                value={editing.kind}
                onValueChange={(kind) => setEditing({ ...editing, kind: kind as Partner['kind'] })}
              >
                {KINDS.map((option) => (
                  <label key={option.value} className="flex min-h-touch items-start gap-3 py-1">
                    <RadioGroupItem value={option.value} className="mt-1" />
                    <span>
                      <span className="block text-body text-text-primary">{option.label}</span>
                      <span className="block text-body-sm text-text-secondary">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </Field>

            <Field label="Phone" htmlFor="partner-phone" hint="Optional. Not needed to receive goods.">
              <Input
                id="partner-phone"
                inputMode="tel"
                value={editing.phone ?? ''}
                autoComplete="off"
                onChange={(e) => setEditing({ ...editing, phone: e.target.value || undefined })}
              />
            </Field>
          </>
        )}
      </MasterFormDialog>
    </MasterLayout>
  );
}

/** `PT Sumber Boga` → `PTSUMBE`, deduped. Recognisable, and never blank. */
function autoCode(name: string, existing: readonly Partner[]): string {
  const base = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 7) || 'PARTNER';
  let candidate = base;
  let n = 2;
  while (existing.some((p) => p.code === candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}
