import { formatDate, todayLocal } from '@fv/domain';
import { Printer, SkipForward } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActionBar, OfflineNotice, ScreenBody, ScreenHeader } from '@/components/layout/Screen';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { QuantityInput } from '@/components/factoryvision/QuantityInput';
import { useTerm } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';

/**
 * L08 · Print batch label (UI Spec §8, PRD F2).
 *
 * **The print path itself is an open decision (P-02, PRD open question #8).**
 * A PWA cannot talk to a Bluetooth thermal printer the way a native app can;
 * the options are Web Bluetooth on Android Chrome, a network printer at the
 * receiving desk, or the system print dialog — and which one works has to be
 * settled against a real 58/80mm printer, not assumed.
 *
 * Until then this screen ships the preview, the size choice, and — the part
 * that matters operationally — **`Skip printing`**. A receiving flow must
 * never stall because a printer is offline; goods keep arriving whether the
 * label prints or not (UI Spec §8).
 *
 * The system print dialog is wired up as the interim path because it is the
 * one route that exists on every device today.
 */
export function PrintBatchLabel() {
  const t = useTerm();
  const navigate = useNavigate();

  const [size, setSize] = useState<'58mm' | '80mm'>('58mm');
  const [copies, setCopies] = useState('1');

  // Placeholder content until this screen is opened with a real batch.
  const label = {
    batchNo: 'TPG-2608A',
    itemName: 'Wheat flour',
    receivedOn: todayLocal(),
    expiryDate: '2026-11-28',
  };

  return (
    <>
      <ScreenHeader title={t('batch')} />
      <OfflineNotice />

      <ScreenBody className="space-y-6">
        <Alert>
          <AlertTitle>Printing path not settled yet</AlertTitle>
          <AlertDescription>
            How labels reach a thermal printer from a web app is still being tested on real
            hardware. Until it is decided, skip printing and write the batch number on the sack —
            the batch is already recorded in the system either way.
          </AlertDescription>
        </Alert>

        {/* Preview at the real label proportions, so the size choice is visible. */}
        <div>
          <Label className="mb-2 block">Preview</Label>
          <div
            className={cn(
              'mx-auto border border-border bg-white p-4 text-print-ink',
              // design-audit-ignore: physical label width in mm, not a UI size
              size === '58mm' ? 'w-[220px]' : 'w-[300px]',
            )}
          >
            <p className="text-center text-body-lg font-bold tracking-wide">{label.batchNo}</p>
            <p className="pt-1 text-center text-body-sm">{label.itemName}</p>
            <div className="my-2 border-t border-dashed border-print-rule" />
            <p className="text-caption">In: {formatDate(label.receivedOn)}</p>
            <p className="text-caption">Exp: {formatDate(label.expiryDate)}</p>
            {/* QR is P1 (barcode scanning); the placeholder keeps the layout honest. */}
            <div className="mx-auto mt-2 h-16 w-16 border border-print-rule text-center text-[8px] leading-[4rem] text-print-muted">
              QR · P1
            </div>
          </div>
        </div>

        <div>
          <Label className="mb-2 block">Label size</Label>
          <div className="flex gap-2">
            {(['58mm', '80mm'] as const).map((option) => (
              <Button
                key={option}
                type="button"
                variant={size === option ? 'default' : 'outline'}
                onClick={() => setSize(option)}
              >
                {option}
              </Button>
            ))}
          </div>
        </div>

        <QuantityInput label="Copies" value={copies} onChange={setCopies} unit="" min="1" max="20" />
      </ScreenBody>

      <ActionBar>
        <Button className="flex-1" size="lg" onClick={() => window.print()}>
          <Printer aria-hidden />
          Print
        </Button>
        {/* Never let a printer stop a delivery being recorded. */}
        <Button variant="outline" size="lg" onClick={() => navigate(-1)}>
          <SkipForward aria-hidden />
          {t('action_skip_printing')}
        </Button>
      </ActionBar>
    </>
  );
}
