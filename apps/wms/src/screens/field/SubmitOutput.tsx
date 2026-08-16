import { todayLocal, toLocalDate, ZERO, type Qty } from '@fv/domain';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DateField } from '@/components/factoryvision/DateField';
import { QuantityInput } from '@/components/factoryvision/QuantityInput';
import { SearchPicker } from '@/components/factoryvision/SearchPicker';
import { ActionBar, OfflineNotice, ScreenBody, ScreenHeader } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useIssues, useProducts } from '@/db/hooks';
import { uuidv7 } from '@/db/ids';
import { useAppend } from '@/db/useAppend';
import { generateBatchNumber } from '@/lib/config/tenantConfig';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L20 · Submit production output (UI Spec §13, PRD F7).
 *
 * Three rules, each answering a specific failure the PRD names:
 *
 * 1. **The batch number is never blank.** It is auto-generated from the
 *    tenant's pattern (`20260816-S1-L2`) and editable. Output arriving without
 *    a batch is problem M3 — untraceable when a complaint comes in, and FEFO
 *    cannot work downstream.
 * 2. **Reject is its own field, not a note.** Grade B mixed into sellable
 *    stock is problem M7, and a note is not a quantity anyone can report on.
 * 3. **The material issue is linked**, which is what makes traceability run
 *    both ways later (P1 F22) without re-recording anything.
 *
 * Expiry is derived from the product's shelf life and can be overridden.
 */

function currentShift(now = new Date()): string {
  const hour = now.getHours();
  if (hour >= 6 && hour < 14) return 'S1';
  if (hour >= 14 && hour < 22) return 'S2';
  return 'S3';
}

export function SubmitOutput() {
  const t = useTerm();
  const navigate = useNavigate();
  const append = useAppend();
  const config = useTenantConfig();

  const products = useProducts();
  const issues = useIssues();

  const today = todayLocal();

  const [productId, setProductId] = useState<string>();
  const [quantity, setQuantity] = useState<Qty>(ZERO);
  const [batchNo, setBatchNo] = useState('');
  const [productionDate, setProductionDate] = useState(today);
  const [expiryDate, setExpiryDate] = useState('');
  const [rejectQuantity, setRejectQuantity] = useState<Qty>(ZERO);
  const [linkedIssueId, setLinkedIssueId] = useState<string>();
  const [line, setLine] = useState('L1');
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const product = products?.find((p) => p.id === productId);

  // Never blank: the pattern fills it, the operator may overwrite it.
  useEffect(() => {
    setBatchNo(
      generateBatchNumber(config.batchNumberPattern, {
        date: new Date(productionDate || today),
        shift: currentShift(),
        line,
      }),
    );
  }, [config.batchNumberPattern, productionDate, line, today]);

  useEffect(() => {
    if (!product?.shelfLifeDays || !productionDate) return;
    const due = new Date(productionDate);
    due.setDate(due.getDate() + product.shelfLifeDays);
    setExpiryDate(toLocalDate(due));
  }, [product, productionDate]);

  /** Open issues for this work — the traceability link, offered not typed. */
  const openIssues = useMemo(
    () =>
      [...(issues?.values() ?? [])]
        .filter((issue) => issue.status !== 'CLOSED' && issue.handedOverAt)
        .map((issue) => ({
          id: issue.issueId,
          name: issue.workOrderNo ?? issue.issueId.slice(0, 8),
          meta: `${issue.lines.length} materials`,
        })),
    [issues],
  );

  const canSubmit = Boolean(product) && quantity !== ZERO && batchNo.trim().length > 0;

  const submit = async () => {
    setTouched(true);
    if (!canSubmit || !product) return;

    setSaving(true);
    try {
      await append('production.output_submitted', {
        productId: product.id,
        batchId: uuidv7(),
        batchNo: batchNo.trim(),
        quantity,
        unit: product.baseUnit,
        productionDate,
        expiryDate: expiryDate || undefined,
        rejectQuantity,
        rejectLocationId: rejectQuantity === ZERO ? undefined : config.rejectLocationId,
        linkedIssueId,
        locationId: config.receivingLocationId,
        // Optional QC on production output is a tenant decision (PRD F7).
        landsIn: config.stages.productionQc ? 'AWAITING INSPECTION' : 'AVAILABLE',
      });
      navigate('/f');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ScreenHeader title={t('production_receipt')} />
      <OfflineNotice />

      <ScreenBody className="space-y-6">
        <SearchPicker
          label={t('product')}
          required
          options={products
            ?.filter((p) => p.itemClass === 'FINISHED_GOODS' || p.itemClass === 'WIP')
            .map((p) => ({ id: p.id, name: p.name, code: p.sku, meta: p.baseUnit }))}
          value={productId}
          onChange={setProductId}
          placeholder="Search finished product"
          emptyMessage="No finished product matches. Add it under Master data first."
        />

        <QuantityInput
          label={t('field_quantity')}
          required
          value={quantity}
          onChange={setQuantity}
          unit={product?.baseUnit ?? ''}
          disabled={!product}
        />

        <div>
          <Label htmlFor="batch-no" className="mb-2 block">
            Production batch no.
            <span className="text-st-danger"> *</span>
          </Label>
          <Input
            id="batch-no"
            value={batchNo}
            onChange={(e) => setBatchNo(e.target.value)}
            aria-invalid={touched && !batchNo.trim()}
          />
          <p className="pt-2 text-body-sm text-text-secondary">
            Generated from {config.batchNumberPattern}. Change it if your line uses a different
            number — but it cannot be empty.
          </p>
        </div>

        <div className="flex gap-2">
          {['L1', 'L2', 'L3'].map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={line === option ? 'default' : 'outline'}
              onClick={() => setLine(option)}
            >
              {option}
            </Button>
          ))}
        </div>

        <DateField
          label="Production date"
          value={productionDate}
          onChange={setProductionDate}
          max={today}
        />

        <DateField
          label={t('field_expiry_date')}
          value={expiryDate}
          onChange={setExpiryDate}
          hint={
            product?.shelfLifeDays
              ? `From ${product.shelfLifeDays} days shelf life.`
              : undefined
          }
        />

        {/* A separate field, never a note — reject must be reportable. */}
        <QuantityInput
          label="Reject / Grade B quantity"
          value={rejectQuantity}
          onChange={setRejectQuantity}
          unit={product?.baseUnit ?? ''}
          disabled={!product}
          hint="Goes to the reject area. It never mixes with sellable stock."
        />

        <SearchPicker
          label="Linked material issue"
          options={openIssues}
          value={linkedIssueId}
          onChange={setLinkedIssueId}
          placeholder="Which issue produced this?"
          emptyMessage="No open material issues to link."
        />
      </ScreenBody>

      <ActionBar>
        <Button
          className="flex-1"
          size="lg"
          loading={saving}
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          Submit output
        </Button>
      </ActionBar>
    </>
  );
}
