import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSession } from '@/app/session';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DEFAULT_TERMS, type TermKey } from '@/lib/terms/dictionary';
import { saveTenantConfig } from '@/lib/config/useTenantConfig';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { ITEM_CLASSES, useItemClassLabel } from '@/lib/terms/itemClass';
import { useTerm } from '@/lib/terms/useTerm';
import { deepestUsedLevel, depthUsage, todayLocal } from '@fv/domain';
import { MAX_LOCATION_DEPTH } from '@fv/contracts';
import { useLocations } from '@/db/hooks';

/**
 * K14 · Tenant configuration (UI Spec §21, PRD §9.2).
 *
 * Everything on this screen is **data, not code** — that is the entire point.
 * PRD §9.1 refuses to build a template engine in Phase 1, because an
 * abstraction drawn from one example is almost always wrong. What it builds
 * instead is every future template axis as configuration with one default,
 * and this is where those defaults get changed.
 *
 * There is deliberately **no template UI, no inheritance, no versioning**
 * here. Those arrive in Phase 2 with a second template to compare against.
 *
 * The terminology tab is the mitigation for the English-labels decision
 * (UI Spec D1): if operators stumble on a label, the answer is to change the
 * tenant's value, not to rewrite the application.
 */

/** The labels most worth overriding first — the ones operators say out loud. */
const COMMON_TERMS: TermKey[] = [
  'material_issue',
  'goods_receipt',
  'production_receipt',
  'putaway',
  'stock_take',
  'blind_count',
  'shrinkage',
  'material_return',
  'inspection',
  'quarantine',
];

export function TenantConfiguration() {
  const t = useTerm();
  const config = useTenantConfig();
  const locations = useLocations();
  const tenantId = useSession((s) => s.tenantId);
  const classLabel = useItemClassLabel();

  const [draft, setDraft] = useState(config);

  // What is actually out there, so a level cannot be removed under live rows.
  const usage = useMemo(() => (locations ? depthUsage(locations) : new Map<number, number>()), [locations]);
  const deepest = useMemo(() => (locations ? deepestUsedLevel(locations) : -1), [locations]);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await saveTenantConfig(tenantId, draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const patchReasons = (key: keyof typeof draft.reasons, value: string) =>
    setDraft((d) => ({
      ...d,
      reasons: { ...d.reasons, [key]: value.split('\n').filter((line) => line.trim() !== '') },
    }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-h2 font-semibold text-text-primary">{t('screen_tenant_config')}</h1>
          <p className="pt-1 text-body-sm text-text-secondary">
            All of this is data for your factory. Nothing here requires a new version of the app.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-body-sm text-st-success-fg">Saved</span>}
          <Button loading={saving} onClick={() => void save()}>
            Save configuration
          </Button>
        </div>
      </header>

      <Tabs defaultValue="terms">
        {/* Scrolls sideways instead of wrapping. Six wrapped tabs became a
            three-row block that pushed the actual settings below the fold. */}
        <TabsList>
          <TabsTrigger value="terms">Terminology</TabsTrigger>
          <TabsTrigger value="levels">Warehouse levels</TabsTrigger>
          <TabsTrigger value="stages">Stages</TabsTrigger>
          <TabsTrigger value="fields">Required fields</TabsTrigger>
          <TabsTrigger value="rules">Rules &amp; thresholds</TabsTrigger>
          <TabsTrigger value="reasons">Reason lists</TabsTrigger>
          <TabsTrigger value="batch">Batch numbering</TabsTrigger>
        </TabsList>

        {/* --- Terminology (T-095) --------------------------------------- */}
        <TabsContent value="terms" className="pt-6">
          <Card>
            <CardContent className="space-y-4 pt-card">
              <p className="text-body-sm text-text-secondary">
                English is the default value, not a fixed string. Change any label to whatever your
                floor actually calls it — in Indonesian if that is what people say.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {COMMON_TERMS.map((key) => (
                  <div key={key}>
                    <Label htmlFor={`term-${key}`} className="mb-2 block">
                      {DEFAULT_TERMS[key]}
                    </Label>
                    <Input
                      id={`term-${key}`}
                      value={draft.terms[key] ?? ''}
                      placeholder={DEFAULT_TERMS[key]}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          terms: { ...d.terms, [key]: e.target.value || undefined },
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Warehouse levels (v1.4) ----------------------------------- */}
        <TabsContent value="levels" className="pt-6">
          <Card>
            <CardContent className="space-y-4 pt-card">
              <p className="text-body-sm text-text-secondary">
                How deep your warehouse goes, and what each level is called. One shed with shelves
                needs two levels; a cold store that picks by bin needs four. Renaming a level
                changes wording only — nothing moves and no stock is touched.
              </p>

              <ol className="space-y-3">
                {draft.locationLevels.map((level, depth) => {
                  const inUse = (usage.get(depth) ?? 0) > 0;
                  const isLast = depth === draft.locationLevels.length - 1;
                  return (
                    <li key={depth} className="flex items-end gap-3">
                      <span className="pb-3 text-body-sm tabular-nums text-text-secondary">
                        {depth + 1}.
                      </span>
                      <div className="flex-1">
                        <Label htmlFor={`level-${depth}`} className="mb-2 block">
                          {inUse
                            ? `${usage.get(depth)} location${usage.get(depth) === 1 ? '' : 's'} at this level`
                            : 'Not used yet'}
                        </Label>
                        <Input
                          id={`level-${depth}`}
                          value={level}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              locationLevels: d.locationLevels.map((l, i) =>
                                i === depth ? e.target.value : l,
                              ),
                            }))
                          }
                        />
                      </div>
                      {/**
                       * Only the deepest level can be removed, and only when it
                       * is empty. Removing one under live locations would leave
                       * them labelled by a level that no longer exists — the
                       * screen would still work, and the data would quietly
                       * stop matching the setting that produced it.
                       */}
                      <Button
                        variant="outline"
                        disabled={!isLast || inUse || draft.locationLevels.length <= 1}
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            locationLevels: d.locationLevels.slice(0, -1),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  );
                })}
              </ol>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  disabled={draft.locationLevels.length >= MAX_LOCATION_DEPTH}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      locationLevels: [...d.locationLevels, `Level ${d.locationLevels.length + 1}`],
                    }))
                  }
                >
                  <Plus aria-hidden />
                  Add a level
                </Button>
                <span className="text-body-sm text-text-secondary">
                  {draft.locationLevels.length} of {MAX_LOCATION_DEPTH} · currently{' '}
                  {draft.locationLevels.join(' → ')}
                </span>
              </div>

              {deepest >= draft.locationLevels.length && (
                <p className="rounded-sm bg-secondary px-4 py-3 text-body-sm text-text-secondary">
                  Some locations already sit deeper than this. They keep working and keep holding
                  stock — they are shown by depth number until a level is named for them.
                </p>
              )}

              <p className="text-body-sm text-text-secondary">
                Five is the ceiling on purpose. Past it an operator is naming more places than they
                can hold in their head, and putaway accuracy is the first thing to go.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Stages on/off (T-096) ------------------------------------- */}
        <TabsContent value="stages" className="pt-6">
          <Card>
            <CardContent className="space-y-4 pt-card">
              <p className="text-body-sm text-text-secondary">
                A factory without a formal QC process should not be forced through one. Turn a
                stage off and it disappears from the flow entirely.
              </p>

              {(
                [
                  ['inspection', 'Inspection', 'Goods wait for a QC decision before becoming available'],
                  ['quarantine', 'Quarantine', 'Held goods go to a quarantine area'],
                  ['staging', 'Staging', 'Shipments move to a staging area before loading'],
                  ['productionQc', 'QC on production output', 'Finished goods are inspected too'],
                ] as const
              ).map(([key, label, hint]) => (
                <label key={key} className="flex min-h-touch items-start gap-3">
                  <Checkbox
                    className="mt-1"
                    checked={draft.stages[key]}
                    onCheckedChange={(checked) =>
                      setDraft((d) => ({ ...d, stages: { ...d.stages, [key]: checked === true } }))
                    }
                  />
                  <span>
                    <span className="block text-body text-text-primary">{label}</span>
                    <span className="block text-body-sm text-text-secondary">{hint}</span>
                  </span>
                </label>
              ))}

              <div className="pt-4">
                <h3 className="pb-2 text-title font-semibold text-text-primary">
                  Auto-pass per item class
                </h3>
                <p className="pb-3 text-body-sm text-text-secondary">
                  Classes ticked here skip inspection and become available immediately.
                </p>
                {ITEM_CLASSES.map((itemClass) => (
                  <label key={itemClass} className="flex min-h-touch items-center gap-3">
                    <Checkbox
                      checked={draft.autoPass[itemClass]}
                      onCheckedChange={(checked) =>
                        setDraft((d) => ({
                          ...d,
                          autoPass: { ...d.autoPass, [itemClass]: checked === true },
                        }))
                      }
                    />
                    <span className="text-body text-text-primary">{classLabel(itemClass)}</span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Required fields per class --------------------------------- */}
        <TabsContent value="fields" className="pt-6">
          <Card>
            <CardContent className="pt-card">
              <p className="pb-4 text-body-sm text-text-secondary">
                Raw materials usually need a batch and an expiry; spare parts usually need neither.
                Demanding both everywhere is how a receiving screen becomes slow enough to abandon.
              </p>
              <div className="overflow-hidden rounded-card border border-border">
                <Table minWidth="28rem">
                  <TableHeader>
                    <tr>
                      <TableHead>Item class</TableHead>
                      <TableHead>Batch required</TableHead>
                      <TableHead>Expiry required</TableHead>
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {ITEM_CLASSES.map((itemClass) => (
                      <TableRow key={itemClass}>
                        <TableCell>{classLabel(itemClass)}</TableCell>
                        {(['batchRequired', 'expiryRequired'] as const).map((field) => (
                          <TableCell key={field}>
                            <Checkbox
                              checked={draft.fieldRules[itemClass][field]}
                              onCheckedChange={(checked) =>
                                setDraft((d) => ({
                                  ...d,
                                  fieldRules: {
                                    ...d.fieldRules,
                                    [itemClass]: {
                                      ...d.fieldRules[itemClass],
                                      [field]: checked === true,
                                    },
                                  },
                                }))
                              }
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Rules & thresholds (T-097) -------------------------------- */}
        <TabsContent value="rules" className="pt-6">
          <Card>
            <CardContent className="space-y-5 pt-card">
              <label className="flex min-h-touch items-start gap-3">
                <Checkbox
                  className="mt-1"
                  checked={draft.defaults.blockExpiredBatches}
                  onCheckedChange={(checked) =>
                    setDraft((d) => ({
                      ...d,
                      defaults: { ...d.defaults, blockExpiredBatches: checked === true },
                    }))
                  }
                />
                <span>
                  <span className="block text-body text-text-primary">
                    Block expired batches from being issued
                  </span>
                  <span className="block text-body-sm text-text-secondary">
                    Owner approval becomes the only way past. Turning this off is rarely a good idea.
                  </span>
                </span>
              </label>

              <label className="flex min-h-touch items-start gap-3">
                <Checkbox
                  className="mt-1"
                  checked={draft.defaults.fefoEnforced}
                  onCheckedChange={(checked) =>
                    setDraft((d) => ({
                      ...d,
                      defaults: { ...d.defaults, fefoEnforced: checked === true },
                    }))
                  }
                />
                <span>
                  <span className="block text-body text-text-primary">Enforce FEFO strictly</span>
                  <span className="block text-body-sm text-text-secondary">
                    Off by default: FEFO is a suggestion the operator may override with a reason.
                  </span>
                </span>
              </label>

              {(
                [
                  ['issueOverdueHours', 'Material issue turns overdue after (hours)', 'The metric the whole product is measured on.'],
                  ['recountThresholdPercent', 'Recount threshold (% variance)', 'Above this, a stock take line is recounted automatically.'],
                  ['approvalThresholdValue', 'Approval threshold (Rp)', 'Adjustments worth more than this wait for the owner.'],
                  ['deadStockDays', 'Dead stock after (days)', ''],
                  ['quarantineWarningDays', 'Warn about quarantine after (days)', ''],
                ] as const
              ).map(([key, label, hint]) => (
                <div key={key}>
                  <Label htmlFor={`rule-${key}`} className="mb-2 block">
                    {label}
                  </Label>
                  <Input
                    id={`rule-${key}`}
                    inputMode="decimal"
                    className="max-w-[14rem]"
                    value={String(draft.defaults[key])}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d.]/g, '');
                      setDraft((d) => ({
                        ...d,
                        defaults: {
                          ...d.defaults,
                          [key]: key === 'approvalThresholdValue' ? raw : Number(raw || 0),
                        },
                      }));
                    }}
                  />
                  {hint && <p className="pt-2 text-body-sm text-text-secondary">{hint}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Reason lists (T-099) -------------------------------------- */}
        <TabsContent value="reasons" className="pt-6">
          <Card>
            <CardContent className="space-y-5 pt-card">
              <p className="text-body-sm text-text-secondary">
                One reason per line. These lists are closed on purpose — free text cannot be
                grouped, counted, or ranked by value, and the variance report depends on being
                able to do all three.
              </p>

              {(
                [
                  ['adjustment', 'Stock adjustment reasons'],
                  ['qcRejection', 'QC hold / reject reasons'],
                  ['shrinkage', 'Shrinkage reasons'],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <Label htmlFor={`reasons-${key}`} className="mb-2 block">
                    {label}
                  </Label>
                  <textarea
                    id={`reasons-${key}`}
                    rows={5}
                    className="w-full rounded-input border border-border bg-card p-4 text-body text-text-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={draft.reasons[key].join('\n')}
                    onChange={(e) => patchReasons(key, e.target.value)}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Batch numbering (T-098) ----------------------------------- */}
        <TabsContent value="batch" className="pt-6">
          <Card>
            <CardContent className="space-y-4 pt-card">
              <div>
                <Label htmlFor="batch-pattern" className="mb-2 block">
                  Production batch pattern
                </Label>
                <Input
                  id="batch-pattern"
                  className="max-w-md"
                  value={draft.batchNumberPattern}
                  onChange={(e) => setDraft((d) => ({ ...d, batchNumberPattern: e.target.value }))}
                />
                <p className="pt-2 text-body-sm text-text-secondary">
                  Tokens: <code>YYYYMMDD</code>, <code>YYYY</code>, <code>MM</code>,{' '}
                  <code>DD</code>, <code>Shift</code>, <code>Line</code>. Today this produces{' '}
                  <span className="font-semibold text-text-primary">
                    {draft.batchNumberPattern
                      .replace('YYYYMMDD', todayLocal().replace(/-/g, ''))
                      .replace('Shift', 'S1')
                      .replace('Line', 'L2')}
                  </span>
                  .
                </p>
              </div>
              <p className="text-body-sm text-text-secondary">
                Operators can always overwrite the generated number, but it is never blank —
                production output without a batch cannot be traced when a complaint arrives.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
