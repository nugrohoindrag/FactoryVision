import { Truck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PhotoCapture } from '@/components/factoryvision/PhotoCapture';
import { ActionBar, OfflineNotice, ScreenBody, ScreenHeader } from '@/components/layout/Screen';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAppend } from '@/db/useAppend';
import { useTerm } from '@/lib/terms/useTerm';

/**
 * L22 · Staging & loading (UI Spec §14, PRD F8).
 *
 * **The photo of the loaded goods is mandatory before `SHIPPED`.** This is
 * not paperwork: it is what settles a customer claim about condition on
 * arrival. Without it the argument is one person's word against another's,
 * and the factory usually loses.
 *
 * The three steps stay visible as a sequence — staged, loaded, shipped —
 * because a truck at the gate is a state a warehouse reasons about out loud.
 */
export function StagingLoading() {
  const t = useTerm();
  const navigate = useNavigate();
  const append = useAppend();
  const { shipmentId } = useParams<{ shipmentId: string }>();

  const [staged, setStaged] = useState(false);
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const confirmLoaded = async () => {
    setTouched(true);
    if (photoIds.length === 0 || !shipmentId) return;
    setSaving(true);
    try {
      await append('shipment.loaded', { shipmentId, photoIds });
      setLoaded(true);
    } finally {
      setSaving(false);
    }
  };

  const confirmShipment = async () => {
    if (!loaded || !shipmentId) return;
    setSaving(true);
    try {
      await append('shipment.shipped', { shipmentId, shippedAt: new Date().toISOString() });
      navigate('/f');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ScreenHeader title={t('loading')} />
      <OfflineNotice />

      <ScreenBody className="space-y-6">
        <Card level={staged ? 'accented' : 'neutral'} status={staged ? 'success' : 'none'}>
          <CardContent className="flex items-center justify-between gap-4 p-card">
            <div>
              <h2 className="text-title font-semibold text-text-primary">{t('staging')}</h2>
              <p className="pt-1 text-body-sm text-text-secondary">
                Goods moved to the staging area, ready for the truck.
              </p>
            </div>
            <Button
              variant={staged ? 'outline' : 'default'}
              disabled={staged}
              onClick={() => setStaged(true)}
            >
              {staged ? 'Staged' : 'Move to staging'}
            </Button>
          </CardContent>
        </Card>

        <PhotoCapture
          label="Photo of loaded goods"
          required
          value={photoIds}
          onChange={setPhotoIds}
          max={3}
          hint={
            touched && photoIds.length === 0
              ? 'Photograph the load before the truck leaves. This is what settles a condition claim later.'
              : 'Take it with the truck doors open, before they close.'
          }
        />

        <Card level={loaded ? 'accented' : 'neutral'} status={loaded ? 'success' : 'none'}>
          <CardContent className="flex items-center justify-between gap-4 p-card">
            <div>
              <h2 className="text-title font-semibold text-text-primary">{t('loading')}</h2>
              <p className="pt-1 text-body-sm text-text-secondary">
                Everything on the pick list is on the truck.
              </p>
            </div>
            <Button
              variant={loaded ? 'outline' : 'default'}
              disabled={loaded || !staged}
              loading={saving && !loaded}
              onClick={() => void confirmLoaded()}
            >
              {loaded ? 'Loaded' : 'Confirm loaded'}
            </Button>
          </CardContent>
        </Card>
      </ScreenBody>

      <ActionBar>
        <Button
          className="flex-1"
          size="lg"
          loading={saving && loaded}
          disabled={!loaded}
          onClick={() => void confirmShipment()}
        >
          <Truck aria-hidden />
          Confirm shipment
        </Button>
      </ActionBar>
    </>
  );
}
