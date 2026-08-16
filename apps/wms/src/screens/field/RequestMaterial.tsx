import type { Product } from '@fv/contracts';
import {
  explodeBom,
  shortLines,
  todayLocal,
  toLocalDate,
  totalQuantity,
  ZERO,
  type ExplodedLine,
  type Qty,
} from '@fv/domain';
import { Plus, Trash2, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@/app/session';
import { BomTable } from '@/components/factoryvision/BomTable';
import { ProductionLocationPicker } from '@/components/factoryvision/LocationPicker';
import { QuantityInput } from '@/components/factoryvision/QuantityInput';
import { SearchPicker } from '@/components/factoryvision/SearchPicker';
import { TimingReadout } from '@/components/dev/TimingReadout';
import { ActionBar, OfflineNotice, ScreenBody, ScreenHeader } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useBomFor,
  useEventLog,
  useProductionLocations,
  useProducts,
  useStock,
} from '@/db/hooks';
import { uuidv7 } from '@/db/ids';
import { useAppend } from '@/db/useAppend';
import { useInputTiming } from '@/lib/metrics/inputTiming';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L13 · Request material ⚠️ (UI Spec §11, acceptance §23.2, §23.15).
 *
 * **Target: request sent in under 30 seconds, from the production floor.**
 * If production feels slowed down they stop raising requests, the whole
 * F5→F6→F7 chain dies, and the product degrades into an ordinary stock app
 * (PRD Risk #1).
 *
 * ## What PRD v1.3 changed, and why it does not cost seconds
 *
 * BOM works FOR this target, not against it: choosing the product and how many
 * fills the material lines automatically, so production types less than before.
 * The only genuine addition is one mandatory field — the destination lane.
 *
 * That field may not be skipped, not even by `Quick issue`. Without an address
 * `IN PRODUCTION` collapses back into a single blob and M2 stays unsolved
 * (PRD F5). It is paid for with one tap from a short list, with the user's last
 * destination already selected — an operator on line 2 almost always requests
 * for line 2.
 *
 * ## The collapse decision (UI Spec §26.7)
 *
 * The derived material list is collapsed, but lines the warehouse cannot cover
 * stay visible even collapsed. What is folded away is what is already correct;
 * what needs a decision never is.
 */

interface RequestLine {
  lineId: string;
  productId?: string;
  quantity: Qty;
  unit: string;
  /** Standard at request time, when the line came from a recipe. */
  standard?: Qty;
}

const emptyLine = (): RequestLine => ({ lineId: uuidv7(), quantity: ZERO, unit: '' });

/** Shift from the wall clock: morning 06–14, afternoon 14–22, night otherwise. */
function currentShift(now = new Date()): string {
  const hour = now.getHours();
  if (hour >= 6 && hour < 14) return 'S1';
  if (hour >= 14 && hour < 22) return 'S2';
  return 'S3';
}

export function RequestMaterial() {
  const t = useTerm();
  const navigate = useNavigate();
  const append = useAppend();
  const products = useProducts();
  const events = useEventLog();
  const stock = useStock();
  const productionLocations = useProductionLocations();
  const user = useSession((s) => s.user);
  const timing = useInputTiming('L13');

  const [quick, setQuick] = useState(false);
  const [workOrderNo, setWorkOrderNo] = useState('');
  const [productionBatch, setProductionBatch] = useState('');
  const [destinationId, setDestinationId] = useState<string>();
  const [outputProductId, setOutputProductId] = useState<string>();
  const [plannedQuantity, setPlannedQuantity] = useState<Qty>(ZERO);
  const [lines, setLines] = useState<RequestLine[]>([emptyLine()]);
  const [manualMode, setManualMode] = useState(false);
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastMs, setLastMs] = useState<number | null>(null);

  const bom = useBomFor(outputProductId);

  /** The most recent request this person raised — the usual repeat order. */
  const lastRequest = useMemo(() => {
    if (!events) return undefined;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i]!;
      if (event.type === 'material_issue.requested' && event.payload.requestedBy === user.id) {
        return event.payload;
      }
    }
    return undefined;
  }, [events, user.id]);

  /**
   * Pre-select the destination this person used last. A mandatory field they
   * must set twenty times a day is a mandatory field they come to resent.
   */
  useEffect(() => {
    if (destinationId || !lastRequest?.destinationId) return;
    setDestinationId(lastRequest.destinationId);
  }, [lastRequest, destinationId]);

  const materialOptions = useMemo(
    () =>
      products
        ?.filter((p: Product) => p.active && p.itemClass !== 'FINISHED_GOODS')
        .map((p) => ({ id: p.id, name: p.name, code: p.sku, meta: p.baseUnit })),
    [products],
  );

  const outputOptions = useMemo(
    () =>
      products
        ?.filter((p: Product) => p.active && p.itemClass === 'FINISHED_GOODS')
        .map((p) => ({ id: p.id, name: p.name, code: p.sku, meta: p.baseUnit })),
    [products],
  );

  /** Recipe scaled to the planned output. Empty when there is no BOM. */
  const exploded: ExplodedLine[] = useMemo(
    () => (bom && plannedQuantity !== ZERO ? explodeBom(bom, plannedQuantity) : []),
    [bom, plannedQuantity],
  );

  /** What the warehouse can actually cover right now, per product. */
  const availableByProduct = useMemo(() => {
    const map = new Map<string, Qty>();
    if (!stock) return map;
    for (const level of stock) {
      if (level.status !== 'AVAILABLE') continue;
      map.set(level.productId, totalQuantity(stock, { productId: level.productId, status: 'AVAILABLE' }));
    }
    return map;
  }, [stock]);

  /**
   * Flagged at request time, not when the warehouse starts preparing.
   * Production has a right to know before it waits.
   */
  const short = useMemo(
    () => shortLines(exploded, availableByProduct),
    [exploded, availableByProduct],
  );

  // Recipe lines replace the manual list, unless the user has taken it over.
  useEffect(() => {
    if (manualMode || exploded.length === 0) return;
    setLines(
      exploded.map((line) => ({
        lineId: uuidv7(),
        productId: line.productId,
        quantity: line.requiredQuantity,
        unit: line.unit,
        standard: line.requiredQuantity,
      })),
    );
  }, [exploded, manualMode]);

  const setLine = (lineId: string, patch: Partial<RequestLine>) =>
    setLines((current) => current.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)));

  const filledLines = lines.filter((l) => l.productId && l.quantity !== ZERO);
  const usingBom = exploded.length > 0 && !manualMode;

  const errors = {
    destination:
      touched && !destinationId
        ? 'Choose which line or machine this material is for.'
        : undefined,
    workOrder:
      touched && !quick && !workOrderNo.trim()
        ? `Enter the work order, or switch to ${t('action_quick_issue')}.`
        : undefined,
    lines: touched && filledLines.length === 0 ? 'Add at least one material.' : undefined,
  };

  const canSend =
    filledLines.length > 0 && Boolean(destinationId) && (quick || workOrderNo.trim().length > 0);

  const applyLastRequest = () => {
    if (!lastRequest) return;
    setManualMode(true);
    setLines(
      lastRequest.lines.map((line) => ({
        lineId: uuidv7(),
        productId: line.productId,
        quantity: line.quantity,
        unit: line.unit,
      })),
    );
    if (!quick) setWorkOrderNo(lastRequest.workOrderNo);
  };

  const productNameOf = (productId: string) =>
    products?.find((p) => p.id === productId)?.name ?? productId;

  const send = async () => {
    setTouched(true);
    if (!canSend || !destinationId) return;

    setSending(true);
    try {
      const issueId = uuidv7();
      const now = new Date();
      await append('material_issue.requested', {
        issueId,
        // A quick issue still gets an identifier — date and shift — so the
        // material can be traced later even without a work-order system.
        workOrderNo: quick ? `${toLocalDate(now)}-${currentShift(now)}` : workOrderNo.trim(),
        requestedBy: user.id,
        quick,
        destinationId,
        productId: outputProductId,
        plannedQuantity: plannedQuantity === ZERO ? undefined : plannedQuantity,
        /**
         * A COPY of the standard, taken now. Never a live link to the BOM: a
         * live link would make last month's variance change every time someone
         * corrects a recipe (Tech Stack §2.8c).
         */
        bomStandard: filledLines
          .filter((l) => l.standard)
          .map((l) => ({ lineId: l.lineId, standardQuantity: l.standard! })),
        lines: filledLines.map((line) => {
          const product = products?.find((p) => p.id === line.productId);
          return {
            lineId: line.lineId,
            productId: line.productId!,
            quantity: line.quantity,
            unit: line.unit || product?.baseUnit || '',
          };
        }),
      });
      setLastMs(timing.stop());
      navigate('/f/issues/mine');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <ScreenHeader title={t('material_issue')} />
      <TimingReadout screen="L13" last={lastMs} />
      <OfflineNotice />

      <ScreenBody className="space-y-6">
        {/* Quick issue sits above everything: it is a different way in, and it
            must be reachable without reading. */}
        <Button
          type="button"
          variant={quick ? 'default' : 'outline'}
          size="lg"
          className="w-full"
          aria-pressed={quick}
          onClick={() => setQuick((on) => !on)}
        >
          <Zap aria-hidden />
          {t('action_quick_issue')}
        </Button>

        {/* What is being made — fills the material list from the recipe. */}
        <SearchPicker
          label="Product to produce"
          options={outputOptions}
          value={outputProductId}
          onChange={(id) => {
            setOutputProductId(id);
            setManualMode(false);
          }}
          placeholder="Search finished product"
          emptyMessage="No finished product matches. You can still add materials by hand below."
        />

        {outputProductId && (
          <QuantityInput
            label="Planned quantity"
            value={plannedQuantity}
            onChange={setPlannedQuantity}
            unit={products?.find((p) => p.id === outputProductId)?.baseUnit ?? ''}
            hint={
              bom
                ? `Recipe basis: ${bom.outputQuantity} ${bom.outputUnit}`
                : 'This product has no recipe yet — add materials by hand below.'
            }
          />
        )}

        {/**
         * MANDATORY, and deliberately above the work order even though the work
         * order comes first as a document. A required field must never sit
         * below an optional one, because the operator who taps `Quick issue`
         * would jump straight past it (UI Spec L13).
         */}
        <ProductionLocationPicker
          locations={productionLocations}
          value={destinationId}
          onChange={setDestinationId}
          suggestedIds={lastRequest?.destinationId ? [lastRequest.destinationId] : []}
          error={errors.destination}
        />

        {quick ? (
          <p className="rounded-sm bg-secondary px-4 py-3 text-body-sm text-text-secondary">
            No work order needed. This request is stamped{' '}
            <span className="font-semibold text-text-primary">
              {todayLocal()}-{currentShift()}
            </span>
            .
          </p>
        ) : (
          <>
            <div>
              <Label htmlFor="work-order" className="mb-2 block">
                {t('field_work_order')}
                <span className="text-st-danger"> *</span>
              </Label>
              <Input
                id="work-order"
                autoComplete="off"
                value={workOrderNo}
                onChange={(e) => setWorkOrderNo(e.target.value)}
                placeholder="e.g. WO-2608-14"
                aria-invalid={Boolean(errors.workOrder)}
              />
              {errors.workOrder && (
                <p className="pt-2 text-body-sm text-st-danger">{errors.workOrder}</p>
              )}
            </div>

            <div>
              <Label htmlFor="production-batch" className="mb-2 block">
                {t('field_production_batch')}
              </Label>
              <Input
                id="production-batch"
                autoComplete="off"
                value={productionBatch}
                onChange={(e) => setProductionBatch(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </>
        )}

        {usingBom ? (
          <div className="space-y-3">
            {/* Collapsed by default; short lines stay visible regardless. */}
            <BomTable
              mode="read"
              lines={exploded}
              productNameOf={productNameOf}
              shortProductIds={short.map((l) => l.productId)}
            />
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setManualMode(true)}
            >
              Edit materials
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {lastRequest && (
              <Button type="button" variant="ghost" className="w-full" onClick={applyLastRequest}>
                Reuse my last request ({lastRequest.lines.length} materials)
              </Button>
            )}

            {lines.map((line, index) => {
              const product = products?.find((p) => p.id === line.productId);
              return (
                <Card key={line.lineId}>
                  <CardContent className="space-y-4 pt-card">
                    <div className="flex items-center justify-between">
                      <span className="text-caption font-semibold uppercase tracking-wide text-text-secondary">
                        Material {index + 1}
                      </span>
                      {lines.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`${t('action_remove')} material ${index + 1}`}
                          onClick={() => setLines((c) => c.filter((l) => l.lineId !== line.lineId))}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      )}
                    </div>

                    <SearchPicker
                      label={t('field_item')}
                      required
                      options={materialOptions}
                      value={line.productId}
                      onChange={(productId) => {
                        const picked = products?.find((p) => p.id === productId);
                        setLine(line.lineId, { productId, unit: picked?.baseUnit ?? '' });
                      }}
                      placeholder="Search material"
                      emptyMessage="No material matches that name or code."
                    />

                    <QuantityInput
                      label={t('field_quantity_requested')}
                      required
                      value={line.quantity}
                      onChange={(quantity) => setLine(line.lineId, { quantity })}
                      unit={line.unit || product?.baseUnit || ''}
                      disabled={!line.productId}
                      // Editing a recipe line needs NO reason: the recipe is a
                      // starting point, not a fence. Forcing one here would add
                      // friction to the screen that has to stay under 30s. The
                      // deviation still surfaces as variance in K12.
                      hint={line.standard ? `Recipe says ${line.standard} ${line.unit}` : undefined}
                    />
                  </CardContent>
                </Card>
              );
            })}

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setLines((c) => [...c, emptyLine()])}
            >
              <Plus aria-hidden />
              {t('action_add_material')}
            </Button>
          </div>
        )}

        {errors.lines && <p className="text-body-sm text-st-danger">{errors.lines}</p>}
      </ScreenBody>

      <ActionBar>
        <Button className="flex-1" size="lg" loading={sending} onClick={() => void send()}>
          {t('action_send_request')}
        </Button>
      </ActionBar>
    </>
  );
}
