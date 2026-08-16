import type { DefectReason, Product, StockStatus } from '@fv/contracts';
import {
  availableUnits,
  formatWithUnit,
  gt,
  isZero,
  projectPurchaseOrder,
  toBase,
  todayLocal,
  toLocalDate,
  ZERO,
  type Qty,
} from '@fv/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSession } from '@/app/session';
import { DateField } from '@/components/factoryvision/DateField';
import { DefectQuantityField } from '@/components/factoryvision/DefectQuantityField';
import { PhotoCapture } from '@/components/factoryvision/PhotoCapture';
import { QuantityInput } from '@/components/factoryvision/QuantityInput';
import { SearchPicker } from '@/components/factoryvision/SearchPicker';
import { TimingReadout } from '@/components/dev/TimingReadout';
import { ActionBar, OfflineNotice, ScreenBody, ScreenHeader } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useEventLog, useProducts, usePurchaseOrder } from '@/db/hooks';
import { uuidv7 } from '@/db/ids';
import { useAppend } from '@/db/useAppend';
import { useInputTiming } from '@/lib/metrics/inputTiming';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L06 · Add item to receipt ⚠️ (UI Spec §8, acceptance §23.1).
 *
 * **Target: one item in ≤20 seconds, measured in a real warehouse with
 * gloves on.** If this screen misses, operators go back to the notebook and
 * the product dies (PRD Risk #4). Every decision below serves that number.
 *
 * The field order is LOCKED — item → quantity → batch → expiry → price →
 * photo. It is not a layout preference: it is the order the operator already
 * reads off the sack, and reordering it forces them to hunt.
 *
 * How the seconds are won:
 * - the item picker opens on mount, already focused, recents first
 * - expiry is derived from the product's shelf life, so it is usually
 *   already correct and simply skipped
 * - `Save & add next` keeps supplier and delivery note, clears the rest, and
 *   reopens the item picker — the next item starts instantly
 * - nothing waits on the network: the event goes to Dexie and the form is
 *   ready again before any sync is attempted
 */
export function AddReceiptItem() {
  const t = useTerm();
  const navigate = useNavigate();
  const append = useAppend();
  const { receiptId } = useParams<{ receiptId: string }>();
  const role = useSession((s) => s.user.role);
  const config = useTenantConfig();

  const products = useProducts();
  const events = useEventLog();
  const timing = useInputTiming('L06');

  const [productId, setProductId] = useState<string>();
  const [quantity, setQuantity] = useState<Qty>(ZERO);
  const [unit, setUnit] = useState<string>();
  const [batchNo, setBatchNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [price, setPrice] = useState('');
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [pickerNonce, setPickerNonce] = useState(0);

  /* --- defect (v1.3) --------------------------------------------------- */
  // Closed by default. While it is closed this screen is byte-for-byte the
  // screen that existed before: no extra field, no extra tap, no reorder.
  const [defectOpen, setDefectOpen] = useState(false);
  const [defectQty, setDefectQty] = useState<Qty>(ZERO);
  const [defectReason, setDefectReason] = useState<DefectReason | null>(null);
  const [defectPhotoIds, setDefectPhotoIds] = useState<string[]>([]);

  /**
   * Two timings, never one average (UI Spec L06, acceptance §23.13).
   *
   * Merging them would hide a regression on the path 95% of receipts take,
   * which is the path the ≤20s target is actually about.
   */
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [lastDefectMs, setLastDefectMs] = useState<number | null>(null);

  const batchRef = useRef<HTMLInputElement>(null);

  const product = products?.find((p) => p.id === productId);

  /* --- purchase order (v1.3) -------------------------------------------- */
  // The receipt records which PO it fills; the lines come from folding the log.
  const purchaseOrderId = useMemo(() => {
    if (!events || !receiptId) return undefined;
    for (const event of events) {
      if (event.type === 'goods_receipt.created' && event.payload.receiptId === receiptId) {
        return event.payload.purchaseOrderId;
      }
    }
    return undefined;
  }, [events, receiptId]);

  const purchaseOrder = usePurchaseOrder(purchaseOrderId);
  const poProgress = useMemo(
    () => (purchaseOrder && events ? projectPurchaseOrder(purchaseOrder, events) : undefined),
    [purchaseOrder, events],
  );

  /** The next PO line still owing something — what the operator is holding. */
  const nextOutstandingLine = useMemo(
    () => poProgress?.lines.find((l) => gt(l.outstanding, ZERO)),
    [poProgress],
  );

  const currentPoLine = useMemo(
    () => poProgress?.lines.find((l) => l.productId === productId),
    [poProgress, productId],
  );

  /**
   * On the PO path the operator types nothing to begin with: the next
   * unfulfilled line is already selected and its outstanding quantity is
   * already in the box. A full delivery is then a single confirm.
   */
  useEffect(() => {
    if (!nextOutstandingLine || productId) return;
    setProductId(nextOutstandingLine.productId);
    setQuantity(nextOutstandingLine.outstanding);
  }, [nextOutstandingLine, productId]);

  /** The five items last received from this supplier — usually the whole job. */
  const recentIds = useMemo(() => {
    if (!events) return [];
    const seen: string[] = [];
    for (let i = events.length - 1; i >= 0 && seen.length < 5; i -= 1) {
      const event = events[i]!;
      if (event.type !== 'goods_receipt.item_added') continue;
      if (!seen.includes(event.payload.productId)) seen.push(event.payload.productId);
    }
    return seen;
  }, [events]);

  // Expiry follows the product's shelf life so the operator can skip the field.
  useEffect(() => {
    if (!product?.shelfLifeDays) {
      setExpiryDate('');
      return;
    }
    const due = new Date();
    due.setDate(due.getDate() + product.shelfLifeDays);
    setExpiryDate(toLocalDate(due));
  }, [product]);

  useEffect(() => {
    if (product) setUnit(product.baseUnit);
  }, [product]);

  const rules = product ? config.fieldRules[product.itemClass] : undefined;
  const batchRequired = rules?.batchRequired ?? true;
  const expiryRequired = rules?.expiryRequired ?? false;
  // Price is hidden from Operator and Production by default (PRD F13).
  const canSeePrice = role === 'WAREHOUSE_HEAD' || role === 'OWNER';

  const unitOptions = product ? availableUnits(product) : [];
  const baseQuantity =
    product && unit && quantity !== ZERO ? toBase(product, quantity, unit) : undefined;
  const showsConversion = Boolean(baseQuantity && unit !== product?.baseUnit);

  const errors = {
    product: touched && !productId ? 'Choose the item that was delivered.' : undefined,
    quantity: touched && quantity === ZERO ? 'Enter how much arrived.' : undefined,
    batch:
      touched && batchRequired && !batchNo.trim()
        ? "This item class needs a batch number. It is on the supplier's label."
        : undefined,
    expiry: touched && expiryRequired && !expiryDate ? 'This item class needs an expiry date.' : undefined,
  };
  // Defect is a PART of `quantity`, not an addition — so it can never exceed
  // it, and both its reason and its photo are mandatory once it is non-zero.
  const defectErrors = {
    quantity:
      touched && defectOpen && isZero(defectQty)
        ? 'Enter how many are defective, or remove the defect.'
        : touched && defectOpen && gt(defectQty, quantity)
          ? 'Defect cannot exceed the quantity received.'
          : undefined,
    reason: touched && defectOpen && !defectReason ? 'Choose why they are defective.' : undefined,
    photo:
      touched && defectOpen && defectPhotoIds.length === 0
        ? 'A photo is the evidence used to bill the supplier.'
        : undefined,
  };
  const defectValid =
    !defectOpen || (!defectErrors.quantity && !defectErrors.reason && !defectErrors.photo);

  const valid =
    productId && quantity !== ZERO && !errors.batch && !errors.expiry && defectValid;

  const reset = () => {
    setProductId(undefined);
    setQuantity(ZERO);
    setUnit(undefined);
    setBatchNo('');
    setExpiryDate('');
    setPrice('');
    setPhotoIds([]);
    setTouched(false);
    setDefectOpen(false);
    setDefectQty(ZERO);
    setDefectReason(null);
    setDefectPhotoIds([]);
    setPickerNonce((n) => n + 1);
  };

  const save = async (then: 'next' | 'finish') => {
    setTouched(true);
    if (!valid || !product || !unit || !receiptId) return;

    setSaving(true);
    const hadDefect = defectOpen && !isZero(defectQty);
    try {
      /**
       * Default path lands straight in AVAILABLE (PRD F3, v1.3): the operator
       * has already looked at the goods while unloading, and that is the
       * cheapest and most accurate moment to judge them. Deep inspection is
       * opt-in per item class, for material that genuinely waits on a lab.
       */
      const landsIn: StockStatus = config.deepInspection[product.itemClass]
        ? 'AWAITING INSPECTION'
        : 'AVAILABLE';

      await append('goods_receipt.item_added', {
        receiptId,
        lineId: uuidv7(),
        productId: product.id,
        batchId: uuidv7(),
        batchNo: batchNo.trim() || `${product.sku}-${todayLocal()}`,
        // Stock is always stored in the base unit; the operator entered sacks.
        quantity: toBase(product, quantity, unit),
        unit: product.baseUnit,
        expiryDate: expiryDate || undefined,
        locationId: config.receivingLocationId,
        landsIn,
        purchaseOrderId,
        purchaseOrderLineId: currentPoLine?.lineId,
        // Defect stays part of `quantity`; the projection subtracts it.
        defectQuantity: hadDefect ? toBase(product, defectQty, unit) : ZERO,
        defectReason: hadDefect ? (defectReason ?? undefined) : undefined,
        defectPhotoIds: hadDefect ? defectPhotoIds : [],
        defectLocationId: hadDefect ? config.rejectLocationId : undefined,
      });

      const ms = timing.stop();
      if (hadDefect) setLastDefectMs(ms);
      else setLastMs(ms);
      setSavedCount((n) => n + 1);

      if (then === 'next') {
        reset();
        timing.restart();
      } else {
        navigate('/f');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ScreenHeader
        title={t('goods_receipt')}
        subtitle={
          [
            poProgress ? poProgress.poNo : undefined,
            savedCount > 0 ? `${savedCount} saved to this delivery` : undefined,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
      />
      {/* Two readouts, never merged (§23.13). The plain path is the one the
          ≤20s target is about; the defect path is expected to be slower and
          must not be allowed to disguise a regression in the other. */}
      <TimingReadout screen="L06" last={lastMs} />
      <TimingReadout screen="L06 · defect" last={lastDefectMs} />
      <OfflineNotice />

      {/* Single column, no page scroll at 360px until the optional fields. */}
      <ScreenBody className="space-y-6">
        <SearchPicker
          key={pickerNonce}
          label={t('field_item')}
          required
          autoOpen
          options={products
            ?.filter((p) => p.active)
            .map((p: Product) => ({
              id: p.id,
              name: p.name,
              code: p.sku,
              meta: p.baseUnit,
            }))}
          value={productId}
          onChange={setProductId}
          recentIds={recentIds}
          recentLabel="Last received"
          allLabel="All items"
          placeholder="Search item or code"
          emptyMessage="No item matches. Check the code on the sack, or add the product first."
          error={errors.product}
        />

        <div className="space-y-2">
          <QuantityInput
            label={t('field_quantity')}
            required
            value={quantity}
            onChange={setQuantity}
            unit={unit ?? product?.baseUnit ?? ''}
            disabled={!product}
            error={errors.quantity}
            conversionHint={
              showsConversion && baseQuantity
                ? `= ${formatWithUnit(baseQuantity, product!.baseUnit)}`
                : undefined
            }
          />

          {/* Only shown when the product actually has an alternate unit. */}
          {unitOptions.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {unitOptions.map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={unit === option ? 'default' : 'outline'}
                  onClick={() => setUnit(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          )}

          {/* What the PO still expects, right under the box being filled. */}
          {currentPoLine && gt(currentPoLine.outstanding, ZERO) && (
            <p className="text-body-sm tabular-nums text-text-secondary">
              Outstanding {formatWithUnit(currentPoLine.outstanding, currentPoLine.unit)}
            </p>
          )}
        </div>

        {/**
         * Inline, directly under Quantity — not a sheet and not a seventh field.
         *
         * Defect is a PART of the quantity above it, and a sheet would cover
         * the parent number at exactly the moment the operator needs to compare
         * the two. Placed at the end of the form it would read as a fifth
         * standalone figure and get entered as an addition, which corrupts
         * stock immediately (UI Spec L06).
         *
         * The locked field order 1–6 is untouched: this is a sub-block of
         * field 2, not an insertion.
         */}
        {defectOpen && product && (
          <DefectQuantityField
            receivedQuantity={quantity}
            unit={unit ?? product.baseUnit}
            quantity={defectQty}
            onQuantityChange={setDefectQty}
            reason={defectReason}
            onReasonChange={setDefectReason}
            photoIds={defectPhotoIds}
            onPhotoChange={setDefectPhotoIds}
            onRemove={() => {
              setDefectOpen(false);
              setDefectQty(ZERO);
              setDefectReason(null);
              setDefectPhotoIds([]);
            }}
          />
        )}

        <div>
          <Label htmlFor="batch-no" className="mb-2 block">
            {t('field_batch_no')}
            {batchRequired && <span className="text-st-danger"> *</span>}
          </Label>
          <Input
            id="batch-no"
            ref={batchRef}
            autoComplete="off"
            value={batchNo}
            onChange={(e) => setBatchNo(e.target.value)}
            placeholder="From the supplier's label"
            aria-invalid={Boolean(errors.batch)}
          />
          {errors.batch && <p className="pt-2 text-body-sm text-st-danger">{errors.batch}</p>}
        </div>

        <DateField
          label={t('field_expiry_date')}
          required={expiryRequired}
          value={expiryDate}
          onChange={setExpiryDate}
          error={errors.expiry}
          hint={
            product?.shelfLifeDays
              ? `Filled from ${product.shelfLifeDays} days shelf life. Change it if the label says otherwise.`
              : undefined
          }
        />

        {canSeePrice && (
          <div>
            <Label htmlFor="price" className="mb-2 block">
              {t('field_purchase_price')}
            </Label>
            <Input
              id="price"
              inputMode="decimal"
              autoComplete="off"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ''))}
              placeholder="Optional"
            />
          </div>
        )}

        <PhotoCapture
          label={t('field_photo')}
          value={photoIds}
          onChange={setPhotoIds}
          max={2}
          hint="Optional — condition of the goods."
        />

        {/* A SECONDARY ACTION, not a field. While it is untouched the plain
            path costs exactly what it cost before v1.3. */}
        {!defectOpen && (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={!product}
            onClick={() => setDefectOpen(true)}
          >
            Mark defect
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={() => navigate(`/f/receipts/${receiptId}/weigh`)}
        >
          {t('action_weigh_instead')}
        </Button>
      </ScreenBody>

      <ActionBar>
        <Button
          className="flex-1"
          size="lg"
          loading={saving}
          onClick={() => void save('next')}
        >
          {t('action_save_add_next')}
        </Button>
        <Button
          variant="outline"
          size="lg"
          disabled={saving}
          onClick={() => void save('finish')}
        >
          {t('action_save_finish')}
        </Button>
      </ActionBar>
    </>
  );
}
