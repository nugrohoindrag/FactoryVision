import { Camera, X } from 'lucide-react';
import * as React from 'react';
import { uuidv7 } from '@/db/ids';
import { db } from '@/db/schema';
import { useSession } from '@/app/session';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * PhotoCapture — L05, L10, L22 (UI Spec §5).
 *
 * Capture → compress → queue. The photo is written to Dexie as a blob and
 * uploaded later; it NEVER blocks the transaction. An operator on a loading
 * dock with no signal must still be able to save the receipt.
 *
 * Compression happens on device because the alternative is a 4MB JPEG per
 * delivery note sitting in an offline queue for seven days, on a phone that
 * is already short on space (Tech Stack §2.7a).
 *
 * `capture="environment"` opens the rear camera directly instead of the photo
 * picker — one tap fewer, and the right camera.
 */

const MAX_EDGE = 1280; // enough to read a delivery note number
const QUALITY = 0.72;

async function compress(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', QUALITY);
  });
}

export interface PhotoCaptureProps {
  label: string;
  /** Photo ids already attached. */
  value: string[];
  onChange: (photoIds: string[]) => void;
  required?: boolean;
  max?: number;
  hint?: string;
  className?: string;
}

export function PhotoCapture({
  label,
  value,
  onChange,
  required,
  max = 3,
  hint,
  className,
}: PhotoCaptureProps) {
  const tenantId = useSession((s) => s.tenantId);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    // Object URLs are revoked on unmount; leaking them on a long shift would
    // hold every captured photo in memory.
    const urls = Object.values(previews);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [previews]);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, max - value.length)) {
        const blob = await compress(file);
        const id = uuidv7();
        await db.photos.add({
          id,
          tenantId,
          blob,
          capturedAt: new Date().toISOString(),
          uploadedAt: null,
        });
        added.push(id);
        setPreviews((prev) => ({ ...prev, [id]: URL.createObjectURL(blob) }));
      }
      onChange([...value, ...added]);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async (id: string) => {
    await db.photos.delete(id);
    onChange(value.filter((photoId) => photoId !== id));
  };

  return (
    <div className={cn('w-full', className)}>
      <Label className="mb-2 block">
        {label}
        {required && <span className="text-st-danger"> *</span>}
      </Label>

      <div className="flex flex-wrap gap-3">
        {value.map((id) => (
          <div key={id} className="relative h-24 w-24 overflow-hidden rounded-sm border border-border bg-secondary">
            {previews[id] && (
              // No colour wash over photos — the operator must see the goods
              // as they are (UI Spec §6.4).
              <img src={previews[id]} alt="" className="h-full w-full object-cover" />
            )}
            <button
              type="button"
              onClick={() => remove(id)}
              aria-label="Remove photo"
              // A solid ink circle, like every other framed icon in the
              // product. It sits on an unknown photo, so the fill has to carry
              // its own contrast rather than borrow the surface's.
              className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-st-danger text-st-danger-on"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        ))}

        {value.length < max && (
          <Button
            type="button"
            variant="outline"
            loading={busy}
            onClick={() => inputRef.current?.click()}
            className="h-24 w-24 flex-col gap-1 px-0 text-caption"
          >
            <Camera aria-hidden />
            {label}
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple={max > 1}
        hidden
        onChange={(e) => void handleFiles(e.target.files)}
      />

      {hint && <p className="pt-2 text-body-sm text-text-secondary">{hint}</p>}
    </div>
  );
}
