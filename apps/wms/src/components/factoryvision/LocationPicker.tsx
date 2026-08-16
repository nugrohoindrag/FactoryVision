import type { Location, ProductionLocation } from '@fv/contracts';
import * as React from 'react';
import { SearchPicker } from './SearchPicker';

/**
 * LocationPicker — L11 putaway, L18 return, L25 adjustment.
 *
 * Wraps SearchPicker with the warehouse tree flattened into readable one-line
 * paths, because an operator needs to know where to WALK, not how the tree is
 * shaped. The tree's depth and the name of each level are tenant configuration
 * since v1.4 — this component never assumes three levels.
 *
 * The suggested location goes first: for putaway it is where this item was
 * last stored, and putting the same item back in the same place is right far
 * more often than not.
 *
 * **Only `storable` locations are offered.** Previously this filtered out
 * anything at the top level, which was a guess dressed as a rule — it hid
 * receiving and quarantine, both of which genuinely hold stock, and it broke
 * outright for a factory whose whole warehouse is one flat list of shelves.
 *
 * Virtual locations are still excluded: stock gets to `In Production` by
 * handover, never by someone choosing it from a list.
 */

export interface LocationPickerProps {
  label: string;
  locations: Location[] | undefined;
  value?: string;
  onChange: (locationId: string) => void;
  /** Shown first, above the full list. */
  suggestedIds?: string[];
  suggestedLabel?: string;
  required?: boolean;
  error?: string;
  className?: string;
}

/** `WH-01 › Z-A › A-01` — the walk, not the tree. */
function pathOf(location: Location, all: Location[]): string {
  const parts = [location.code];
  let current = location;
  let guard = 0;
  while (current.parentId && guard < 5) {
    const parent = all.find((l) => l.id === current.parentId);
    if (!parent) break;
    parts.unshift(parent.code);
    current = parent;
    guard += 1;
  }
  return parts.join(' › ');
}

export function LocationPicker({
  label,
  locations,
  value,
  onChange,
  suggestedIds = [],
  suggestedLabel = 'Suggested',
  required,
  error,
  className,
}: LocationPickerProps) {
  const options = React.useMemo(() => {
    if (!locations) return undefined;
    return locations
      .filter((l) => l.active && !l.virtual && l.storable)
      .map((l) => ({
        id: l.id,
        name: l.name,
        code: pathOf(l, locations),
      }));
  }, [locations]);

  return (
    <SearchPicker
      className={className}
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      recentIds={suggestedIds}
      recentLabel={suggestedLabel}
      allLabel="All locations"
      placeholder="Search rack or zone"
      emptyMessage="No location matches. Add it under Master data → Locations."
      required={required}
      error={error}
    />
  );
}

/**
 * Production variant — `Line → Machine / Area` (added v2.1).
 *
 * A VARIANT of this component, not a twin: UI Spec §5.1 step 1 says a near-miss
 * gets a variant, never a parallel component. Same picker, same path rendering,
 * different tree.
 *
 * Used by L13, where the destination is MANDATORY — including on `Quick issue`.
 * That is the one field quick mode may not skip: without an address,
 * `IN PRODUCTION` collapses back into a single blob and M2 goes unsolved.
 *
 * The user's last destination is pre-selected. An operator on line 2 almost
 * always requests for line 2, and making them choose it 20 times a day is how
 * a mandatory field turns into a resented one.
 */
export interface ProductionLocationPickerProps {
  label?: string;
  locations: ProductionLocation[] | undefined;
  value?: string;
  onChange: (locationId: string) => void;
  /** Usually just the user's previous destination. */
  suggestedIds?: string[];
  required?: boolean;
  error?: string;
  className?: string;
}

/** `L2 › L2-PK` — the same "where do I walk" shape as the warehouse variant. */
function productionPathOf(location: ProductionLocation, all: ProductionLocation[]): string {
  const parts = [location.code];
  let current = location;
  let guard = 0;
  while (current.parentId && guard < 5) {
    const parent = all.find((l) => l.id === current.parentId);
    if (!parent) break;
    parts.unshift(parent.code);
    current = parent;
    guard += 1;
  }
  return parts.join(' › ');
}

export function ProductionLocationPicker({
  label = 'Line / Machine / Area',
  locations,
  value,
  onChange,
  suggestedIds = [],
  required = true,
  error,
  className,
}: ProductionLocationPickerProps) {
  const options = React.useMemo(() => {
    if (!locations) return undefined;
    return locations
      .filter((l) => l.active)
      .map((l) => ({ id: l.id, name: l.name, code: productionPathOf(l, locations) }));
  }, [locations]);

  return (
    <SearchPicker
      className={className}
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      recentIds={suggestedIds}
      recentLabel="Last used"
      allLabel="All lines"
      placeholder="Search line or machine"
      emptyMessage="No production line yet. Add one under Master data → Locations."
      required={required}
      error={error}
    />
  );
}
