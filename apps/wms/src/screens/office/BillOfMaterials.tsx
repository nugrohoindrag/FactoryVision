import type { Bom } from '@fv/contracts';
import { AlertTriangle, BookOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BomTable } from '@/components/factoryvision/BomTable';
import { QuantityInput } from '@/components/factoryvision/QuantityInput';
import { SearchPicker } from '@/components/factoryvision/SearchPicker';
import { EmptyState, LoadingRows } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { useBoms, useProducts } from '@/db/hooks';
import { db } from '@/db/schema';
import { uuidv7 } from '@/db/ids';
import { useSession } from '@/app/session';
import { useTerm } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';

/**
 * K17 · Bill of materials 🆕 (UI Spec §19).
 *
 * The recipe store — the source of L13's material lines and K12's `Standard`
 * column. Moved from P1 into P0 by PRD v1.3, because without it the request
 * screen has nothing to prefill and the variance report has nothing to compare
 * against.
 *
 * ## Decisions
 *
 * - **Products with no BOM still appear in the list**, flagged. Hiding them
 *   would let an owner believe every product has a recipe, while K12 quietly
 *   fell back to a historical average for the ones that do not.
 * - **`Unverified` sits at the head of the detail pane**, under the product
 *   name — it applies to the whole recipe, not to one line, and it travels
 *   with the numbers into K12.
 * - **`Output quantity` is above the table, not inside it.** Every figure in
 *   the table is "per this much output"; putting the basis below would have
 *   people read the numbers before learning what they are per.
 * - **One active BOM per product, no versioning in P0** (PRD F21).
 */
export function BillOfMaterials() {
  const products = useProducts();
  const boms = useBoms();
  const tenantId = useSession((s) => s.tenantId);
  const t = useTerm();

  const [selectedProductId, setSelectedProductId] = useState<string>();
  const [draft, setDraft] = useState<Bom | null>(null);
  const [saving, setSaving] = useState(false);

  const finished = products?.filter((p) => p.active && p.itemClass === 'FINISHED_GOODS');
  const materials = products?.filter((p) => p.active && p.itemClass !== 'FINISHED_GOODS');

  const existing = boms?.find((b) => b.productId === selectedProductId);

  useEffect(() => {
    if (!selectedProductId) {
      setDraft(null);
      return;
    }
    setDraft(
      existing
        ? { ...existing, lines: existing.lines.map((l) => ({ ...l })) }
        : {
            id: uuidv7(),
            tenantId: tenantId as Bom['tenantId'],
            productId: selectedProductId,
            outputQuantity: '1',
            outputUnit: products?.find((p) => p.id === selectedProductId)?.baseUnit ?? 'pcs',
            lines: [],
            verified: false,
          },
    );
  }, [selectedProductId, existing, products, tenantId]);

  const productName = (productId: string) =>
    products?.find((p) => p.id === productId)?.name ?? productId;

  const save = async (verified?: boolean) => {
    if (!draft) return;
    setSaving(true);
    try {
      await db.boms.put({ ...draft, verified: verified ?? draft.verified });
    } finally {
      setSaving(false);
    }
  };

  if (!products || !boms) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-h2 font-semibold text-text-primary">{t('screen_bom')}</h1>
        </header>
        <LoadingRows rows={5} />
      </div>
    );
  }

  const missing = (finished?.length ?? 0) - boms.length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-semibold text-text-primary">{t('screen_bom')}</h1>
        <p className="pt-1 text-body-sm text-text-secondary">
          {boms.length} of {finished?.length ?? 0} finished products have a recipe
          {/* Said out loud, because K12 silently falls back to a historical
              average for these — and an owner should not have to infer that. */}
          {missing > 0 && (
            <span className="font-semibold text-st-warning"> · {missing} without one</span>
          )}
        </p>
      </header>

      {finished?.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No finished products yet"
          body="A recipe belongs to a finished product. Add one under Master data → Products, then come back and describe what it is made of."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          {/* Products WITHOUT a recipe stay listed and flagged. */}
          <ul className="space-y-2" aria-label="Finished products">
            {finished?.map((product) => {
              const bom = boms.find((b) => b.productId === product.id);
              const active = product.id === selectedProductId;
              return (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedProductId(product.id)}
                    aria-current={active}
                    className={cn(
                      'w-full rounded-card border bg-card p-card text-left',
                      active ? 'border-primary' : 'border-border hover:bg-secondary',
                    )}
                  >
                    <p className="truncate text-body font-medium text-text-primary">
                      {product.name}
                    </p>
                    <p className="pt-0.5 text-body-sm text-text-secondary">
                      {bom ? (
                        `${bom.lines.length} material${bom.lines.length === 1 ? '' : 's'}`
                      ) : (
                        <span className="text-st-warning">No BOM yet</span>
                      )}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>

          {draft ? (
            <section aria-label="Recipe" className="space-y-4">
              <div>
                <h2 className="text-h3 font-semibold text-text-primary">
                  {productName(draft.productId)}
                </h2>
                {!draft.verified && (
                  // Head of the pane: it qualifies the whole recipe, and the
                  // flag follows these numbers into K12.
                  <p className="flex items-center gap-2 pt-1 text-body-sm text-st-warning">
                    <AlertTriangle aria-hidden className="size-4" />
                    Unverified — nobody has checked this recipe yet
                  </p>
                )}
              </div>

              {/* Above the table: every figure below is "per this much". */}
              <div className="max-w-xs">
                <QuantityInput
                  label={`Output quantity (${draft.outputUnit})`}
                  value={draft.outputQuantity}
                  onChange={(outputQuantity) =>
                    setDraft((d) => (d ? { ...d, outputQuantity } : d))
                  }
                  unit={draft.outputUnit}
                  hint="The basis of the recipe — per batch or per unit, whichever your factory uses."
                />
              </div>

              <BomTable
                mode="edit"
                bom={draft}
                productNameOf={productName}
                onChangeLine={(lineId, standardQuantity) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          lines: d.lines.map((l) =>
                            l.id === lineId ? { ...l, standardQuantity } : l,
                          ),
                        }
                      : d,
                  )
                }
                onRemoveLine={(lineId) =>
                  setDraft((d) => (d ? { ...d, lines: d.lines.filter((l) => l.id !== lineId) } : d))
                }
              />

              <SearchPicker
                label="Add material"
                options={materials?.map((p) => ({
                  id: p.id,
                  name: p.name,
                  code: p.sku,
                  meta: p.baseUnit,
                }))}
                onChange={(productId) => {
                  const product = products.find((p) => p.id === productId);
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          lines: [
                            ...d.lines,
                            {
                              id: uuidv7(),
                              productId,
                              standardQuantity: '0',
                              unit: product?.baseUnit ?? '',
                            },
                          ],
                        }
                      : d,
                  );
                }}
                placeholder="Search material to add"
                emptyMessage="No material matches that name or code."
              />

              <div className="flex flex-wrap gap-2">
                <Button loading={saving} onClick={() => void save()}>
                  Save BOM
                </Button>
                {!draft.verified && (
                  <Button variant="outline" disabled={saving} onClick={() => void save(true)}>
                    Mark verified
                  </Button>
                )}
              </div>
            </section>
          ) : (
            <p className="py-10 text-center text-body text-text-secondary">
              Choose a finished product to see or build its recipe.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
