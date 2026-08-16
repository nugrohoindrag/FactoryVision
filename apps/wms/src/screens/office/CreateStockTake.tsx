import type { ItemClass } from '@fv/contracts';
import { storableLocations } from '@fv/domain';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEV_USERS } from '@/app/session';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useLocations } from '@/db/hooks';
import { uuidv7 } from '@/db/ids';
import { useAppend } from '@/db/useAppend';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { ITEM_CLASSES, useItemClassLabel } from '@/lib/terms/itemClass';
import { useTerm } from '@/lib/terms/useTerm';
import { todayLocal } from '@fv/domain';

/**
 * K07 · Create stock take session (UI Spec §16, PRD F10).
 *
 * A full stock take takes a factory 2–5 days today and stops production while
 * it runs (problem M5). The scope options exist so it does not have to be all
 * or nothing: counting one zone, or one item class, is what makes cycle
 * counting possible and eventually removes the need for the big count at all.
 *
 * The recount threshold is set HERE, before anyone counts — deciding what
 * counts as a suspicious variance after seeing the variances is not a control.
 */

/**
 * Scope hints name the tenant's own levels rather than assuming "rack"
 * (v1.4) — a factory that calls its places `Shelf` should not be offered
 * "by rack" for something it does not have.
 */
const SCOPES = [
  { value: 'full', label: 'Everything', hint: 'Every place stock can sit' },
  { value: 'warehouse', label: 'By area', hint: 'One part of the warehouse at a time' },
  { value: 'class', label: 'By item class', hint: 'Raw materials only, for example' },
  { value: 'rack', label: 'By location', hint: 'A cycle count of specific places' },
] as const;

export function CreateStockTake() {
  const t = useTerm();
  const navigate = useNavigate();
  const append = useAppend();
  const config = useTenantConfig();
  const locations = useLocations();
  const classLabel = useItemClassLabel();

  const [name, setName] = useState(
    `Stock take ${todayLocal()}`,
  );
  const [scope, setScope] = useState<(typeof SCOPES)[number]['value']>('full');
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedClasses, setSelectedClasses] = useState<ItemClass[]>([]);
  const [counters, setCounters] = useState<string[]>([]);
  const [threshold, setThreshold] = useState(String(config.defaults.recountThresholdPercent));
  const [saving, setSaving] = useState(false);

  /**
   * Only places stock can actually sit are countable. Previously this excluded
   * the top level, which was a guess: it hid receiving and quarantine — both
   * genuinely hold stock and both belong in a count — and it broke outright for
   * a factory whose whole warehouse is one flat list of shelves (v1.4).
   */
  const countable = storableLocations(locations ?? []);

  const scopeIds =
    scope === 'full' || scope === 'class'
      ? countable.map((l) => l.id)
      : selectedLocations;

  const canStart = scopeIds.length > 0 && counters.length > 0;

  const start = async () => {
    if (!canStart) return;
    setSaving(true);
    try {
      const sessionId = uuidv7();
      await append('stock_take.session_created', {
        sessionId,
        scopeLocationIds: scopeIds,
        countedBy: counters,
      });
      navigate(`/f/stock-take/${sessionId}/count`);
    } finally {
      setSaving(false);
    }
  };

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <div className="max-w-form space-y-6">
      <header>
        <h1 className="text-h2 font-semibold text-text-primary">{t('screen_stock_take')}</h1>
        <p className="pt-1 text-body-sm text-text-secondary">
          Counters never see the system figure. That is what makes the result worth acting on.
        </p>
      </header>

      <div>
        <Label htmlFor="session-name" className="mb-2 block">
          Session name
        </Label>
        <Input id="session-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <Label className="mb-2 block">Scope</Label>
        <RadioGroup value={scope} onValueChange={(value) => setScope(value as typeof scope)}>
          {SCOPES.map((option) => (
            <label key={option.value} className="flex min-h-touch items-start gap-3 py-1">
              <RadioGroupItem value={option.value} className="mt-1" />
              <span>
                <span className="block text-body text-text-primary">{option.label}</span>
                <span className="block text-body-sm text-text-secondary">{option.hint}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </div>

      {(scope === 'rack' || scope === 'warehouse') && (
        <Card>
          <CardContent className="space-y-2 pt-card">
            {countable.map((location) => (
              <label key={location.id} className="flex min-h-touch items-center gap-3">
                <Checkbox
                  checked={selectedLocations.includes(location.id)}
                  onCheckedChange={() =>
                    setSelectedLocations((current) => toggle(current, location.id))
                  }
                />
                <span className="text-body text-text-primary">
                  {location.code} · {location.name}
                </span>
              </label>
            ))}
          </CardContent>
        </Card>
      )}

      {scope === 'class' && (
        <Card>
          <CardContent className="space-y-2 pt-card">
            {ITEM_CLASSES.map((itemClass) => (
              <label key={itemClass} className="flex min-h-touch items-center gap-3">
                <Checkbox
                  checked={selectedClasses.includes(itemClass)}
                  onCheckedChange={() => setSelectedClasses((current) => toggle(current, itemClass))}
                />
                <span className="text-body text-text-primary">{classLabel(itemClass)}</span>
              </label>
            ))}
          </CardContent>
        </Card>
      )}

      <div>
        <Label className="mb-2 block">Assign counters</Label>
        <p className="pb-2 text-body-sm text-text-secondary">
          Several people can count the same session at the same time, each on their own phone.
        </p>
        <Card>
          <CardContent className="space-y-2 pt-card">
            {DEV_USERS.filter((u) => u.role === 'OPERATOR' || u.role === 'WAREHOUSE_HEAD').map(
              (user) => (
                <label key={user.id} className="flex min-h-touch items-center gap-3">
                  <Checkbox
                    checked={counters.includes(user.id)}
                    onCheckedChange={() => setCounters((current) => toggle(current, user.id))}
                  />
                  <span className="text-body text-text-primary">{user.name}</span>
                </label>
              ),
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <Label htmlFor="threshold" className="mb-2 block">
          Recount threshold
        </Label>
        <div className="flex items-center gap-3">
          <Input
            id="threshold"
            inputMode="decimal"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value.replace(/[^\d.]/g, ''))}
            className="max-w-[8rem]"
          />
          <span className="text-body text-text-secondary">% variance</span>
        </div>
        <p className="pt-2 text-body-sm text-text-secondary">
          Anything above this is recounted automatically. The counter is not asked to decide.
        </p>
      </div>

      <Button size="lg" loading={saving} disabled={!canStart} onClick={() => void start()}>
        Start session
      </Button>
    </div>
  );
}
