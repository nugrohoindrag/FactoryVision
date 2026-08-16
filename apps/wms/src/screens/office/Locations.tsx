import { MAX_LOCATION_DEPTH, type Location } from '@fv/contracts';
import {
  deepestUsedLevel,
  depthUsage,
  flattenTree,
  levelLabel,
  locationPath,
  locationTree,
  type LocationNode,
} from '@fv/domain';
import { CornerDownRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSession } from '@/app/session';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { TableRow } from '@/components/ui/table';
import { useLocations } from '@/db/hooks';
import { uuidv7 } from '@/db/ids';
import { db } from '@/db/schema';
import { useTenantConfig } from '@/lib/config/useTenantConfig';
import { useTerm } from '@/lib/terms/useTerm';
import { cn } from '@/lib/utils';
import {
  Field,
  MasterFormDialog,
  MasterLayout,
  MasterTable,
  RowActions,
  Td,
  Th,
} from './MasterLayout';

/**
 * K04 · Locations (UI Spec §19, PRD F1).
 *
 * ## Depth is the factory's decision, not ours (v1.4)
 *
 * This screen used to say "two levels only" and mean it. That fitted one shape
 * of factory and quietly punished every other: a single shed with shelves had
 * to invent a zone it does not have, a cold store that genuinely picks by bin
 * had nowhere to put one, and a two-site business wanted a level above the
 * warehouse.
 *
 * The tree is now any depth up to five, and what each level is CALLED comes
 * from tenant configuration (K14). Nothing on this screen writes the word
 * "rack".
 *
 * ## Indentation carries the hierarchy, not a column
 *
 * A `Level` column tells you a row's rank; indentation tells you where it sits.
 * Those are different questions, and the second is the one someone opens this
 * screen to answer. The level name still appears as a badge, because a name is
 * how a factory recognises its own structure.
 *
 * ## `Holds stock` is shown, and it is not decorative
 *
 * It decides what putaway offers. Receiving and quarantine hold stock while
 * sitting mid-tree with nothing beneath them — the exact case the old fixed
 * model could not express, and the reason it is stored rather than inferred
 * from being a leaf.
 */
export function Locations() {
  const t = useTerm();
  const locations = useLocations();
  const config = useTenantConfig();
  const tenantId = useSession((s) => s.tenantId);
  const [query, setQuery] = useState('');

  const levels = config.locationLevels;

  /* --- create / edit (v1.4) --------------------------------------------- */
  const [editing, setEditing] = useState<Location | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const blank = (): Location => ({
    id: uuidv7(),
    tenantId: tenantId as Location['tenantId'],
    code: '',
    name: '',
    parentId: null,
    depth: 0,
    // A new location is nearly always somewhere stock goes. The exception —
    // a container that only holds other locations — is one untick away.
    storable: true,
    virtual: false,
    active: true,
  });

  /**
   * Depth follows the parent, and is never typed.
   *
   * Letting someone set both a parent and a depth is letting them contradict
   * themselves, and the tree would render in a shape the data does not have.
   */
  const setParent = (parentId: string | null) =>
    setEditing((current) => {
      if (!current) return current;
      const parent = locations?.find((l) => l.id === parentId);
      return { ...current, parentId, depth: parent ? parent.depth + 1 : 0 };
    });

  /** Anything that would nest deeper than the configured levels is not offered. */
  const parentOptions = (locations ?? []).filter(
    (l) =>
      l.active &&
      !l.virtual &&
      l.id !== editing?.id &&
      l.depth + 1 < Math.max(levels.length, MAX_LOCATION_DEPTH) &&
      l.depth + 1 <= levels.length - 1,
  );

  const duplicateCode = Boolean(
    editing &&
      locations?.some(
        (l) => l.id !== editing.id && l.code.trim().toLowerCase() === editing.code.trim().toLowerCase(),
      ),
  );

  const canSave = Boolean(editing?.code.trim() && editing?.name.trim()) && !duplicateCode;

  const save = async () => {
    if (!editing || !canSave) return;
    setSaving(true);
    try {
      await db.locations.put({ ...editing, code: editing.code.trim(), name: editing.name.trim() });
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Deactivate, never delete. Every past movement points at a location id; a
   * deleted row leaves the stock card rendering a blank where a place should
   * be, and nobody can tell a bug from a real gap.
   */
  const setActive = async (location: Location, active: boolean) => {
    await db.locations.put({ ...location, active });
  };

  const toggleActive = async () => {
    if (!editing) return;
    await setActive(editing, !editing.active);
    setEditing(null);
  };

  const childCount = editing ? (locations ?? []).filter((l) => l.parentId === editing.id).length : 0;

  /**
   * Searching flattens the tree on purpose. Someone typing a code wants that
   * row, not its ancestry — and a filtered tree with gaps in it reads as
   * missing data.
   */
  const searching = query.trim().length > 0;

  const rows = useMemo((): LocationNode[] | undefined => {
    if (!locations) return undefined;
    const ordered = flattenTree(locationTree(locations));
    if (!searching) return ordered;
    const needle = query.trim().toLowerCase();
    return ordered.filter(
      (node) =>
        node.location.name.toLowerCase().includes(needle) ||
        node.location.code.toLowerCase().includes(needle),
    );
  }, [locations, query, searching]);

  const usage = useMemo(() => (locations ? depthUsage(locations) : new Map()), [locations]);
  const deepest = locations ? deepestUsedLevel(locations) : -1;

  // A tenant can shorten its level list; existing locations are not relabelled
  // behind their back, so the screen says plainly that it happened.
  const beyondConfigured = deepest >= levels.length;

  return (
    <MasterLayout
      title={t('screen_locations')}
      description={`${levels.join(' → ')} · up to ${levels.length} level${levels.length === 1 ? '' : 's'}. Rename or add levels in Tenant configuration.`}
      query={query}
      onQueryChange={setQuery}
      onCreate={() => {
        setEditing(blank());
        setIsNew(true);
      }}
      createLabel="Add location"
      count={rows?.length}
      loading={rows === undefined}
      emptyTitle={query ? 'Nothing matches that' : 'No locations yet'}
      emptyBody={
        query
          ? 'Try the code instead of the name.'
          : `Add your ${levels[0]?.toLowerCase() ?? 'top level'} first, then work down. Stock cannot be put away until there is somewhere to put it.`
      }
    >
      {beyondConfigured && (
        <p className="border-b border-border bg-secondary px-4 py-3 text-body-sm text-text-secondary">
          Some locations sit deeper than the {levels.length} configured level
          {levels.length === 1 ? '' : 's'}. They still work and still hold stock — they are
          labelled by depth until a level is named for them.
        </p>
      )}

      <MasterTable
        head={
          <>
            <Th>Code</Th>
            <Th>Name</Th>
            <Th>Level</Th>
            <Th>Holds stock</Th>
            <Th>{''}</Th>
          </>
        }
      >
        {(rows ?? []).map(({ location }) => (
          <TableRow
            key={location.id}
            // Deactivated rows stay visible — they are still referenced by
            // history — but read as set aside rather than current.
            className={cn(!location.active && 'text-text-disabled')}
          >
            <Td muted>
              {/* Indentation is the hierarchy. In search results it is dropped,
                  because a partial tree with gaps reads as missing rows. */}
              <span
                className={cn('inline-flex items-center gap-1.5')}
                style={{ paddingLeft: searching ? 0 : `${location.depth * 1.25}rem` }}
              >
                {!searching && location.depth > 0 && (
                  <CornerDownRight aria-hidden className="size-3.5 shrink-0 text-text-disabled" />
                )}
                {location.code}
              </span>
            </Td>
            <Td>{location.name}</Td>
            <Td>
              <Badge variant={location.virtual ? 'cyan' : 'teal'}>
                {location.virtual ? 'Virtual' : levelLabel(levels, location.depth)}
              </Badge>
            </Td>
            <Td muted>
              {location.storable ? (
                <span className="text-st-success">Yes</span>
              ) : (
                // Not blank: an empty cell reads as data that failed to load.
                <span>No — container only</span>
              )}
            </Td>
            <Td>
              <RowActions
                label={`${location.code} · ${location.name}`}
                active={location.active}
                onEdit={() => {
                  setEditing({ ...location });
                  setIsNew(false);
                }}
                onToggleActive={() => void setActive(location, !location.active)}
                deactivateNote={
                  (locations ?? []).some((l) => l.parentId === location.id)
                    ? 'Locations inside it stay reachable.'
                    : undefined
                }
              />
            </Td>
          </TableRow>
        ))}
      </MasterTable>

      {/* What K14 checks before letting a level be removed. */}
      {!searching && rows && rows.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border px-4 py-3 text-body-sm text-text-secondary">
          {levels.map((level, depth) => (
            <span key={level}>
              {level}: <span className="tabular-nums text-text-primary">{usage.get(depth) ?? 0}</span>
            </span>
          ))}
        </div>
      )}

      <MasterFormDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        title={isNew ? 'Add location' : `Edit ${editing?.code ?? ''}`}
        description={
          editing
            ? `${levelLabel(levels, editing.depth)} · depth follows whatever it sits inside.`
            : undefined
        }
        onSave={() => void save()}
        saveDisabled={!canSave}
        saving={saving}
        onToggleActive={isNew ? undefined : () => void toggleActive()}
        active={editing?.active}
        deactivateHint={
          childCount > 0
            ? `${childCount} location${childCount === 1 ? '' : 's'} sit inside this one and stay reachable.`
            : 'Kept for history — past movements still resolve.'
        }
      >
        {editing && (
          <>
            <Field label="Code" htmlFor="loc-code" required hint="Short, and what people say out loud.">
              <Input
                id="loc-code"
                value={editing.code}
                autoComplete="off"
                onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                aria-invalid={duplicateCode}
              />
              {duplicateCode && (
                <p className="pt-1.5 text-body-sm text-st-danger">
                  Another location already uses this code.
                </p>
              )}
            </Field>

            <Field label="Name" htmlFor="loc-name" required>
              <Input
                id="loc-name"
                value={editing.name}
                autoComplete="off"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>

            <Field
              label="Inside"
              htmlFor="loc-parent"
              hint={`Leave empty for a top-level ${levels[0]?.toLowerCase() ?? 'location'}. Depth is set from this, never typed.`}
            >
              <select
                id="loc-parent"
                value={editing.parentId ?? ''}
                onChange={(e) => setParent(e.target.value || null)}
                className="h-input w-full rounded-input border border-border bg-card px-3 text-body text-text-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">— top level —</option>
                {parentOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {locationPath(option, locations ?? [])} · {option.name}
                  </option>
                ))}
              </select>
            </Field>

            <label className="flex min-h-touch items-start gap-3">
              <Checkbox
                className="mt-1"
                checked={editing.storable}
                onCheckedChange={(checked) =>
                  setEditing({ ...editing, storable: checked === true })
                }
              />
              <span>
                <span className="block text-body text-text-primary">Holds stock</span>
                <span className="block text-body-sm text-text-secondary">
                  Offered at putaway and counted in a stock take. Untick for a place that only
                  contains other places.
                </span>
              </span>
            </label>
          </>
        )}
      </MasterFormDialog>
    </MasterLayout>
  );
}
