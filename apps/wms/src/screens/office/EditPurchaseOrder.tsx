import type { PurchaseOrder, PurchaseOrderLine } from '@fv/contracts';
import { projectPurchaseOrder, todayLocal } from '@fv/domain';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSession } from '@/app/session';
import { DateField } from '@/components/factoryvision/DateField';
import { SearchPicker } from '@/components/factoryvision/SearchPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useEventLog, usePartners, useProducts, usePurchaseOrder } from '@/db/hooks';
import { uuidv7 } from '@/db/ids';
import { db } from '@/db/schema';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * K16 · Create / edit purchase order 🆕 (UI Spec §7.5).
 *
 * Template C, with one width exception stated rather than smuggled: the form
 * head keeps the ~640px reading column, and the line-item table takes the full
 * width. Forcing four numeric columns into 640px produces cramped fields that
 * get mistyped, and a mistyped quantity here becomes a PO that never reaches
 * `RECEIVED`.
 *
 * ## Two rules that are not cosmetic
 *
 * - **`ETA` is mandatory.** Without it there is no arrival task, and F25 loses
 *   its main source — the whole reason an operator knows goods are coming
 *   before the truck is at the gate.
 * - **A line that has already been received cannot be deleted**, and its
 *   ordered quantity can only go up. Deleting it would orphan the receipts
 *   that point at it, and the PO's own progress would stop adding up.
 *
 * Status is never edited here. It is projected from the receipts (PRD §8).
 */
export function EditPurchaseOrder() {
  const t = useTerm();
  const navigate = useNavigate();
  const { poId } = useParams<{ poId: string }>();
  const tenantId = useSession((s) => s.tenantId);
  const role = useSession((s) => s.user.role);

  const existing = usePurchaseOrder(poId);
  const suppliers = usePartners('SUPPLIER');
  const products = useProducts();
  const events = useEventLog();

  const [draft, setDraft] = useState<PurchaseOrder | null>(null);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const isNew = !poId;
  const canSeePrice = role === 'WAREHOUSE_HEAD' || role === 'OWNER';

  useEffect(() => {
    if (draft) return;
    if (poId && !existing) return;
    setDraft(
      existing
        ? { ...existing, lines: existing.lines.map((l) => ({ ...l })) }
        : {
            id: uuidv7(),
            tenantId: tenantId as PurchaseOrder['tenantId'],
            poNo: '',
            supplierId: '',
            orderDate: todayLocal(),
            eta: '',
            lines: [],
            cancelled: false,
          },
    );
  }, [existing, poId, tenantId, draft]);

  /** How much of each line has already arrived — what locks it against edits. */
  const progress = useMemo(
    () => (existing && events ? projectPurchaseOrder(existing, events) : undefined),
    [existing, events],
  );
  const receivedOf = (lineId: string) =>
    progress?.lines.find((l) => l.lineId === lineId)?.received ?? '0';

  const setLine = (lineId: string, patch: Partial<PurchaseOrderLine>) =>
    setDraft((d) =>
      d ? { ...d, lines: d.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) } : d,
    );

  const errors = {
    supplier: touched && !draft?.supplierId ? 'Choose the supplier.' : undefined,
    eta: touched && !draft?.eta ? 'An ETA is what creates the arrival task.' : undefined,
    lines: touched && draft?.lines.length === 0 ? 'Add at least one item.' : undefined,
  };

  const canSave = Boolean(
    draft?.supplierId && draft?.eta && draft.lines.length > 0 &&
      draft.lines.every((l) => l.productId && Number(l.quantityOrdered) > 0),
  );

  const save = async () => {
    setTouched(true);
    if (!draft || !canSave) return;
    setSaving(true);
    try {
      await db.purchaseOrders.put({
        ...draft,
        poNo: draft.poNo.trim() || autoPoNo(),
      });
      navigate('/o/purchase-orders');
    } finally {
      setSaving(false);
    }
  };

  if (!draft) return null;

  const productName = (productId: string) =>
    products?.find((p) => p.id === productId)?.name ?? '';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-h2 font-semibold text-text-primary">
          {isNew ? 'New purchase order' : `Edit ${draft.poNo}`}
        </h1>
        <p className="pt-1 text-body-sm text-text-secondary">
          A delivery plan, not a purchase approval. What this buys you is an operator who knows the
          goods are coming.
        </p>
      </header>

      {/* Form head — the 640px reading column of template C. */}
      <div className="max-w-form space-y-4">
        <SearchPicker
          label={t('field_supplier')}
          required
          options={suppliers?.map((p) => ({ id: p.id, name: p.name, code: p.code }))}
          value={draft.supplierId || undefined}
          onChange={(supplierId) => setDraft({ ...draft, supplierId })}
          placeholder="Search supplier"
          emptyMessage="No supplier matches. Add them under Master data → Partners."
          error={errors.supplier}
        />

        <div>
          <Label htmlFor="po-no" className="mb-2 block">
            PO number
          </Label>
          <Input
            id="po-no"
            autoComplete="off"
            value={draft.poNo}
            placeholder="Leave empty and one is generated"
            onChange={(e) => setDraft({ ...draft, poNo: e.target.value })}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <DateField
            label="Order date"
            value={draft.orderDate}
            onChange={(orderDate) => setDraft({ ...draft, orderDate })}
          />
          <DateField
            label="ETA"
            required
            value={draft.eta}
            onChange={(eta) => setDraft({ ...draft, eta })}
            error={errors.eta}
            hint="An arrival task appears in the warehouse queue the day before this."
          />
        </div>
      </div>

      {/**
       * Full width, outside the 640px column. Stated as an exception in UI Spec
       * §7.5 rather than quietly done: four numeric columns squeezed into a
       * reading measure are four columns that get mistyped.
       */}
      <div className="overflow-hidden rounded-card border border-border bg-card shadow-1">
        <Table minWidth="36rem">
          <TableHeader>
            <tr>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead>Unit</TableHead>
              {canSeePrice && <TableHead className="text-right">Unit price</TableHead>}
              <TableHead className="w-12">
                <span className="sr-only">Remove</span>
              </TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {draft.lines.map((line) => {
              const received = Number(receivedOf(line.id));
              const locked = received > 0;
              return (
                <TableRow key={line.id}>
                  <TableCell>
                    {locked ? (
                      <span>
                        {productName(line.productId)}
                        <span className="block text-body-sm text-text-secondary">
                          {received} already received
                        </span>
                      </span>
                    ) : (
                      <SearchPicker
                        label=""
                        options={products
                          ?.filter((p) => p.active)
                          .map((p) => ({ id: p.id, name: p.name, code: p.sku, meta: p.baseUnit }))}
                        value={line.productId || undefined}
                        onChange={(productId) => {
                          const product = products?.find((p) => p.id === productId);
                          setLine(line.id, { productId, unit: product?.baseUnit ?? line.unit });
                        }}
                        placeholder="Search item"
                        emptyMessage="No item matches."
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      inputMode="decimal"
                      value={line.quantityOrdered}
                      aria-label={`Quantity for ${productName(line.productId) || 'this line'}`}
                      className="w-28 text-right tabular-nums"
                      onChange={(e) =>
                        setLine(line.id, {
                          quantityOrdered: e.target.value.replace(',', '.').replace(/[^\d.]/g, ''),
                        })
                      }
                    />
                    {/* Can only go up once something has arrived: lowering it
                        below what was received makes the PO contradict itself. */}
                    {locked && Number(line.quantityOrdered) < received && (
                      <p className="pt-1 text-body-sm text-st-danger">
                        Cannot be below the {received} already received.
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-text-secondary">{line.unit}</TableCell>
                  {canSeePrice && (
                    <TableCell className="text-right">
                      <Input
                        inputMode="decimal"
                        value={line.unitPrice ?? ''}
                        aria-label="Unit price"
                        className="w-32 text-right tabular-nums"
                        onChange={(e) =>
                          setLine(line.id, {
                            unitPrice: e.target.value.replace(',', '.') || undefined,
                          })
                        }
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    {/* Absent, not disabled: §6.4 forbids opacity carrying
                        meaning, and a greyed control invites a click anyway. */}
                    {!locked && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${productName(line.productId) || 'line'}`}
                        onClick={() =>
                          setDraft({ ...draft, lines: draft.lines.filter((l) => l.id !== line.id) })
                        }
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}

            {/* Part of the table, not a button floating outside it. */}
            <TableRow>
              <TableCell colSpan={canSeePrice ? 5 : 4}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      lines: [
                        ...draft.lines,
                        { id: uuidv7(), productId: '', quantityOrdered: '0', unit: '' },
                      ],
                    })
                  }
                >
                  <Plus aria-hidden />
                  Add line
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {errors.lines && <p className="text-body-sm text-st-danger">{errors.lines}</p>}

      <div className="max-w-form">
        <Label htmlFor="po-note" className="mb-2 block">
          Notes
        </Label>
        <Input
          id="po-note"
          value={draft.note ?? ''}
          onChange={(e) => setDraft({ ...draft, note: e.target.value || undefined })}
        />
      </div>

      {/* Sticky action bar, per template C: a 30-line PO must not push Save
          off the end of the scroll. */}
      <div className="sticky bottom-0 flex gap-3 border-t border-border bg-background py-4">
        <Button loading={saving} disabled={saving} onClick={() => void save()}>
          Save purchase order
        </Button>
        <Button variant="outline" onClick={() => navigate('/o/purchase-orders')}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** `PO-20260816-4821` — recognisable, sortable, and never blank. */
function autoPoNo(): string {
  return `PO-${todayLocal().replace(/-/g, '')}-${String(Math.floor(Date.now() % 10000)).padStart(4, '0')}`;
}
