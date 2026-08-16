import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PhotoCapture } from '@/components/factoryvision/PhotoCapture';
import { SearchPicker } from '@/components/factoryvision/SearchPicker';
import { DateField } from '@/components/factoryvision/DateField';
import { ActionBar, OfflineNotice, ScreenBody, ScreenHeader } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePartners, usePoProgress } from '@/db/hooks';
import { uuidv7 } from '@/db/ids';
import { useAppend } from '@/db/useAppend';
import { useTerm } from '@/lib/terms/useTerm';
import { todayLocal } from '@fv/domain';

/**
 * L05 · New goods receipt (UI Spec §8).
 *
 * Opens one delivery from one supplier, then hands straight over to L06 —
 * this screen is a gate, not a destination, so it holds exactly four fields.
 *
 * The delivery-note photo is taken FIRST, not last. Once the truck is
 * unloaded the paper note has usually disappeared, and a receipt without it
 * cannot be reconciled with the supplier later.
 *
 * ## PRD v1.3 — receiving starts from a PO
 *
 * Choosing the PO fills in the supplier and, in L06, the item lines and their
 * outstanding quantities. A full delivery then becomes a confirm rather than a
 * typing exercise.
 *
 * **Receiving WITHOUT a PO is never blocked.** It is logged as an exception and
 * surfaces in `Receipts without PO`, but no operator is ever stopped at the
 * warehouse door because the office has not raised the paperwork yet. Tidiness
 * is pushed by reporting, not by a barrier (PRD F24).
 */
export function NewGoodsReceipt() {
  const t = useTerm();
  const navigate = useNavigate();
  const append = useAppend();
  const suppliers = usePartners('SUPPLIER');
  const purchaseOrders = usePoProgress();

  const today = todayLocal();

  const [purchaseOrderId, setPurchaseOrderId] = useState<string>();
  const [withoutPo, setWithoutPo] = useState(false);
  const [supplierId, setSupplierId] = useState<string>();
  const [deliveryNoteNo, setDeliveryNoteNo] = useState('');
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [receivedOn, setReceivedOn] = useState(today);
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  /** Only POs still owing something can receive goods. */
  const openPos = purchaseOrders?.filter(
    (po) => po.status === 'OPEN' || po.status === 'PARTIALLY RECEIVED',
  );

  // Picking a PO fills the supplier; it is no longer something to type.
  const handlePoChange = (poId: string) => {
    setPurchaseOrderId(poId);
    const po = openPos?.find((p) => p.purchaseOrderId === poId);
    if (po) setSupplierId(po.supplierId);
  };

  const supplierError = touched && !supplierId ? 'Choose the supplier who delivered.' : undefined;
  const photoError =
    touched && photoIds.length === 0 ? 'Photograph the delivery note before unloading.' : undefined;
  const canContinue = Boolean(supplierId) && photoIds.length > 0;

  const handleContinue = async () => {
    setTouched(true);
    if (!canContinue || !supplierId) return;

    setSubmitting(true);
    try {
      const receiptId = uuidv7();
      await append('goods_receipt.created', {
        receiptId,
        supplierId,
        deliveryNoteNo: deliveryNoteNo.trim() || undefined,
        receivedAt: new Date(`${receivedOn}T00:00:00`).toISOString(),
        photoIds,
        // Absent on the exception path — which is allowed, and reported.
        purchaseOrderId: withoutPo ? undefined : purchaseOrderId,
      });
      navigate(`/f/receipts/${receiptId}/items`, { state: { supplierId } });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <ScreenHeader title={t('screen_new_receipt')} />
      <OfflineNotice />

      <ScreenBody className="space-y-6">
        {/* Nearest ETA first — the delivery most likely to be at the door. */}
        {!withoutPo && (
          <SearchPicker
            label={t('screen_purchase_orders')}
            options={openPos?.map((po) => ({
              id: po.purchaseOrderId,
              name: po.poNo,
              code: `ETA ${po.eta}`,
              meta: `${po.totalOutstanding} outstanding`,
            }))}
            value={purchaseOrderId}
            onChange={handlePoChange}
            allLabel="All open POs"
            placeholder="Search PO number"
            emptyMessage="No open purchase order. Receive without one if the goods are here."
          />
        )}

        {/* One tap, no confirmation dialog: this is a legitimate path, not a
            transgression to be talked out of. */}
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={() => {
            setWithoutPo((v) => !v);
            setPurchaseOrderId(undefined);
          }}
        >
          {withoutPo ? 'Receive against a PO instead' : 'Receive without PO'}
        </Button>

        <SearchPicker
          label={t('field_supplier')}
          required
          options={suppliers?.map((p) => ({ id: p.id, name: p.name, code: p.code, meta: p.phone }))}
          value={supplierId}
          onChange={setSupplierId}
          recentLabel="Last used"
          allLabel="All suppliers"
          placeholder="Search supplier"
          emptyMessage="No supplier matches. Add them in Master data first."
          error={supplierError}
        />
        {purchaseOrderId && (
          <p className="-mt-4 text-body-sm text-text-secondary">
            Filled from the purchase order.
          </p>
        )}

        <div>
          <Label htmlFor="delivery-note" className="mb-2 block">
            {t('field_delivery_note_no')}
          </Label>
          <Input
            id="delivery-note"
            inputMode="text"
            autoComplete="off"
            value={deliveryNoteNo}
            onChange={(e) => setDeliveryNoteNo(e.target.value)}
            placeholder="As printed on the note"
          />
        </div>

        <PhotoCapture
          label={t('field_delivery_note_photo')}
          required
          value={photoIds}
          onChange={setPhotoIds}
          max={2}
          hint={
            photoError ??
            'Take this now. After unloading, the paper note is usually already gone.'
          }
        />

        <DateField
          label={t('field_date_received')}
          value={receivedOn}
          onChange={setReceivedOn}
          max={today}
        />
      </ScreenBody>

      <ActionBar>
        <Button
          className="flex-1"
          size="lg"
          loading={submitting}
          onClick={() => void handleContinue()}
        >
          {t('action_add_items')}
        </Button>
      </ActionBar>
    </>
  );
}
