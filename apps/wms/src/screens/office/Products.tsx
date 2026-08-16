import type { Product } from '@fv/contracts';
import { formatMoney, formatWithUnit } from '@fv/domain';
import { useMemo, useState } from 'react';
import { useSession } from '@/app/session';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useProducts } from '@/db/hooks';
import { uuidv7 } from '@/db/ids';
import { db } from '@/db/schema';
import { ITEM_CLASSES, ITEM_CLASS_TONE, useItemClassLabel } from '@/lib/terms/itemClass';
import { useTerm } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';
import { TableRow } from '@/components/ui/table';
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
 * K03 · Products (UI Spec §19, PRD F1).
 *
 * Unit conversions are the reason this screen matters more than it looks.
 * `1 sak = 25 kg` is stored as an **exact decimal factor** and every
 * downstream quantity runs through it — a wrong factor here silently
 * corrupts receipts, issues, stock take and the inventory valuation at once
 * (UI Spec §19).
 *
 * Purchase cost is visible only to roles allowed to see prices (PRD F13).
 */

export function Products() {
  const t = useTerm();
  const products = useProducts();
  const classLabel = useItemClassLabel();
  const role = useSession((s) => s.user.role);
  const tenantId = useSession((s) => s.tenantId);
  const [query, setQuery] = useState('');

  const canSeeCost = role === 'WAREHOUSE_HEAD' || role === 'OWNER';

  const [editing, setEditing] = useState<Product | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const blank = (): Product => ({
    id: uuidv7(),
    tenantId: tenantId as Product['tenantId'],
    sku: '',
    name: '',
    itemClass: 'RAW_MATERIAL',
    baseUnit: '',
    conversions: [],
    active: true,
  });

  const duplicateSku = Boolean(
    editing &&
      products?.some(
        (p) => p.id !== editing.id && p.sku.trim().toLowerCase() === editing.sku.trim().toLowerCase(),
      ),
  );

  /**
   * Base unit is required. Every quantity of this product is stored in it, so a
   * product without one cannot be received at all — better to refuse the save
   * than to create a row that breaks at the warehouse door.
   */
  const canSave = Boolean(editing?.name.trim() && editing?.baseUnit.trim()) && !duplicateSku;

  const save = async () => {
    if (!editing || !canSave) return;
    setSaving(true);
    try {
      const name = editing.name.trim();
      await db.products.put({
        ...editing,
        name,
        baseUnit: editing.baseUnit.trim(),
        sku: editing.sku.trim() || autoSku(name, editing.itemClass, products ?? []),
      });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  /** Deactivate, never delete — every batch and movement points at this id. */
  const setActive = async (product: Product, active: boolean) => {
    await db.products.put({ ...product, active });
  };

  const toggleActive = async () => {
    if (!editing) return;
    await setActive(editing, !editing.active);
    setEditing(null);
  };

  const rows = useMemo(() => {
    if (!products) return undefined;
    const needle = query.trim().toLowerCase();
    return products.filter(
      (p) =>
        needle === '' ||
        p.name.toLowerCase().includes(needle) ||
        p.sku.toLowerCase().includes(needle),
    );
  }, [products, query]);

  return (
    <MasterLayout
      title={t('screen_products')}
      description="Items, units, and shelf life. Unit conversions are exact factors — a wrong one corrupts every calculation downstream."
      query={query}
      onQueryChange={setQuery}
      onCreate={() => {
        setEditing(blank());
        setIsNew(true);
      }}
      createLabel="Add product"
      count={rows?.length}
      loading={rows === undefined}
      emptyTitle={query ? 'Nothing matches that' : 'No products yet'}
      emptyBody={
        query
          ? 'Try the code instead of the name.'
          : 'Import your existing Excel list — it is usually faster than typing them in.'
      }
    >
      <MasterTable
        head={
          <>
            <Th>Code</Th>
            <Th>Name</Th>
            <Th>Class</Th>
            <Th>Base unit</Th>
            <Th>Conversions</Th>
            <Th>Min stock</Th>
            <Th>Shelf life</Th>
            {canSeeCost && <Th>Unit cost</Th>}
            <Th>{''}</Th>
          </>
        }
      >
        {(rows ?? []).map((product: Product) => (
          <TableRow key={product.id} className={cn(!product.active && 'text-text-disabled')}>
            <Td muted>{product.sku}</Td>
            <Td>{product.name}</Td>
            <Td>
              <Badge variant={ITEM_CLASS_TONE[product.itemClass]}>
                {classLabel(product.itemClass)}
              </Badge>
            </Td>
            <Td>{product.baseUnit}</Td>
            <Td muted>
              {product.conversions.length === 0
                ? '—'
                : product.conversions
                    .map((c) => `1 ${c.from} = ${c.factor} ${c.to}`)
                    .join(' · ')}
            </Td>
            <Td muted>
              {product.minimumStock
                ? formatWithUnit(product.minimumStock, product.baseUnit)
                : '—'}
            </Td>
            <Td muted>{product.shelfLifeDays ? `${product.shelfLifeDays} days` : '—'}</Td>
            {canSeeCost && (
              <Td muted>{product.averageCost ? formatMoney(product.averageCost) : '—'}</Td>
            )}
            <Td>
              <RowActions
                label={product.name}
                active={product.active}
                onEdit={() => {
                  setEditing({ ...product });
                  setIsNew(false);
                }}
                onToggleActive={() => void setActive(product, !product.active)}
              />
            </Td>
          </TableRow>
        ))}
      </MasterTable>

      <MasterFormDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        title={isNew ? 'Add product' : `Edit ${editing?.name ?? ''}`}
        onSave={() => void save()}
        saveDisabled={!canSave}
        saving={saving}
        onToggleActive={isNew ? undefined : () => void toggleActive()}
        active={editing?.active}
        deactivateHint="Kept for history — existing batches and movements still resolve."
      >
        {editing && (
          <>
            <Field label="Name" htmlFor="prod-name" required>
              <Input
                id="prod-name"
                value={editing.name}
                autoComplete="off"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>

            <Field label="Code" htmlFor="prod-sku" hint="Leave empty and one is generated.">
              <Input
                id="prod-sku"
                value={editing.sku}
                autoComplete="off"
                onChange={(e) => setEditing({ ...editing, sku: e.target.value })}
                aria-invalid={duplicateSku}
              />
              {duplicateSku && (
                <p className="pt-1.5 text-body-sm text-st-danger">
                  Another product already uses this code.
                </p>
              )}
            </Field>

            <Field
              label="Item class"
              htmlFor="prod-class"
              hint="Drives which fields are mandatory at receipt, and whether deep inspection applies."
            >
              <select
                id="prod-class"
                value={editing.itemClass}
                onChange={(e) =>
                  setEditing({ ...editing, itemClass: e.target.value as Product['itemClass'] })
                }
                className="h-input w-full rounded-input border border-border bg-card px-3 text-body text-text-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {ITEM_CLASSES.map((itemClass) => (
                  <option key={itemClass} value={itemClass}>
                    {classLabel(itemClass)}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Base unit"
              htmlFor="prod-unit"
              required
              hint="Every quantity is stored in this unit. Changing it later does not convert existing stock."
            >
              <Input
                id="prod-unit"
                value={editing.baseUnit}
                autoComplete="off"
                placeholder="kg, pcs, l, m"
                onChange={(e) => setEditing({ ...editing, baseUnit: e.target.value })}
              />
            </Field>

            <Field
              label="Minimum stock"
              htmlFor="prod-min"
              hint="Optional. Below this, the item appears in alerts and on the owner dashboard."
            >
              <Input
                id="prod-min"
                inputMode="decimal"
                value={editing.minimumStock ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    minimumStock: e.target.value.replace(',', '.') || undefined,
                  })
                }
              />
            </Field>

            <Field
              label="Shelf life (days)"
              htmlFor="prod-shelf"
              hint="Optional. Fills the expiry date at receipt so the operator can skip the field."
            >
              <Input
                id="prod-shelf"
                inputMode="numeric"
                value={editing.shelfLifeDays ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    shelfLifeDays: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : undefined,
                  })
                }
              />
            </Field>

            {canSeeCost && (
              <Field
                label="Average cost"
                htmlFor="prod-cost"
                hint="Drives every rupiah figure in the reports — variance, dead stock, inventory value."
              >
                <Input
                  id="prod-cost"
                  inputMode="decimal"
                  value={editing.averageCost ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      averageCost: e.target.value.replace(',', '.') || undefined,
                    })
                  }
                />
              </Field>
            )}

            {/* Conversions stay on the import path for now. A factor typed
                wrong here corrupts receipts, issues, stock take and valuation
                at once, so an editor for it needs its own validation pass
                rather than a text box smuggled into this dialog. */}
            {editing.conversions.length > 0 && (
              <p className="rounded-sm bg-secondary px-4 py-3 text-body-sm text-text-secondary">
                Unit conversions:{' '}
                {editing.conversions.map((c) => `1 ${c.from} = ${c.factor} ${c.to}`).join(' · ')}
                <br />
                Edit these through Excel import — a wrong factor corrupts every calculation
                downstream.
              </p>
            )}
          </>
        )}
      </MasterFormDialog>
    </MasterLayout>
  );
}

/** `Wheat flour` + RAW_MATERIAL → `RM-WHEATF`, deduped. Never blank (PRD F1). */
function autoSku(
  name: string,
  itemClass: Product['itemClass'],
  existing: readonly Product[],
): string {
  const prefix = itemClass
    .split('_')
    .map((word) => word[0])
    .join('');
  const body = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6) || 'ITEM';
  let candidate = `${prefix}-${body}`;
  let n = 2;
  while (existing.some((p) => p.sku === candidate)) {
    candidate = `${prefix}-${body}-${n}`;
    n += 1;
  }
  return candidate;
}
