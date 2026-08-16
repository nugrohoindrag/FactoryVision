import type { Location } from '@fv/contracts';
import { describe, expect, it } from 'vitest';
import {
  computeDepth,
  deepestUsedLevel,
  depthUsage,
  flattenTree,
  levelLabel,
  locationPath,
  locationTree,
  storableLocations,
} from '../src/locations.js';

/**
 * Flexible warehouse depth (F1, v1.4).
 *
 * The point of these tests is that NOTHING here knows the word "rack". A
 * factory with one flat list of shelves and a cold store with four levels must
 * both work, and the old fixed `Warehouse → Zone → Rack` model served neither.
 */

const loc = (
  id: string,
  code: string,
  depth: number,
  parentId: string | null = null,
  extra: Partial<Location> = {},
): Location => ({
  id,
  tenantId: 'tenant-1' as Location['tenantId'],
  code,
  name: code,
  parentId,
  depth,
  storable: false,
  virtual: false,
  active: true,
  ...extra,
});

/** Three levels — the Manufaktur default, now just a default. */
const threeLevel: Location[] = [
  loc('wh', 'WH-01', 0),
  loc('za', 'Z-A', 1, 'wh'),
  loc('a01', 'A-01', 2, 'za', { storable: true }),
  loc('a02', 'A-02', 2, 'za', { storable: true }),
  // A zone that holds stock directly with nothing beneath it — the case the
  // old model could not express at all.
  loc('rcv', 'RCV', 1, 'wh', { storable: true }),
];

/** One shed, one flat list of shelves. No zones, and none invented. */
const flat: Location[] = [
  loc('shed', 'SHED', 0),
  loc('s1', 'S-1', 1, 'shed', { storable: true }),
  loc('s2', 'S-2', 1, 'shed', { storable: true }),
];

/** Site → Warehouse → Zone → Rack → Bin. Four deep, all legal. */
const deep: Location[] = [
  loc('site', 'JKT', 0),
  loc('wh', 'WH-01', 1, 'site'),
  loc('z', 'Z-A', 2, 'wh'),
  loc('r', 'R-01', 3, 'z'),
  loc('b', 'B-01', 4, 'r', { storable: true }),
];

describe('locationPath', () => {
  it('renders the walk, not the tree', () => {
    expect(locationPath(threeLevel[2]!, threeLevel)).toBe('WH-01 › Z-A › A-01');
  });

  it('works at any depth without knowing how many there are', () => {
    expect(locationPath(deep[4]!, deep)).toBe('JKT › WH-01 › Z-A › R-01 › B-01');
    expect(locationPath(flat[1]!, flat)).toBe('SHED › S-1');
  });

  it('does not hang on a self-parenting row', () => {
    const cyclic = [loc('x', 'X', 0, 'x')];
    expect(locationPath(cyclic[0]!, cyclic)).toBe('X');
  });
});

describe('computeDepth', () => {
  it('agrees with the stored depth when the tree is sound', () => {
    for (const location of deep) {
      expect(computeDepth(location, deep)).toBe(location.depth);
    }
  });

  it('is the authority when a stored depth is wrong', () => {
    // An import can produce a row whose depth does not match its parent.
    const wrong = [loc('wh', 'WH', 0), loc('r', 'R', 4, 'wh')];
    expect(computeDepth(wrong[1]!, wrong)).toBe(1);
  });
});

describe('locationTree', () => {
  it('nests children under their parent', () => {
    const roots = locationTree(threeLevel);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.location.code).toBe('WH-01');
    expect(roots[0]!.children.map((c) => c.location.code)).toEqual(['RCV', 'Z-A']);
  });

  it('surfaces an orphan at the root rather than dropping it', () => {
    // A location whose parent was deactivated or never synced. Losing it from
    // the screen would mean stock nobody can find.
    const orphaned = [...flat, loc('ghost', 'GHOST', 1, 'missing-parent', { storable: true })];
    const codes = locationTree(orphaned).map((n) => n.location.code);
    expect(codes).toContain('GHOST');
  });

  it('flattens parents before children', () => {
    const codes = flattenTree(locationTree(deep)).map((n) => n.location.code);
    expect(codes).toEqual(['JKT', 'WH-01', 'Z-A', 'R-01', 'B-01']);
  });
});

describe('storableLocations', () => {
  it('offers a zone that holds stock directly', () => {
    // The old rule excluded anything at the top level and hid receiving —
    // a place that genuinely holds stock.
    expect(storableLocations(threeLevel).map((l) => l.code)).toEqual(['A-01', 'A-02', 'RCV']);
  });

  it('never offers a virtual location', () => {
    const withVirtual = [...flat, loc('prod', 'PROD', 0, null, { storable: true, virtual: true })];
    expect(storableLocations(withVirtual).some((l) => l.code === 'PROD')).toBe(false);
  });

  it('never offers a deactivated one', () => {
    const withInactive = [...flat, loc('old', 'OLD', 1, 'shed', { storable: true, active: false })];
    expect(storableLocations(withInactive).some((l) => l.code === 'OLD')).toBe(false);
  });
});

describe('depth usage', () => {
  it('counts locations per depth', () => {
    const usage = depthUsage(threeLevel);
    expect(usage.get(0)).toBe(1);
    expect(usage.get(1)).toBe(2);
    expect(usage.get(2)).toBe(2);
  });

  it('reports the deepest level in use, so a level cannot be removed under it', () => {
    expect(deepestUsedLevel(threeLevel)).toBe(2);
    expect(deepestUsedLevel(flat)).toBe(1);
    expect(deepestUsedLevel([])).toBe(-1);
  });
});

describe('levelLabel', () => {
  it('uses the tenant name for that depth', () => {
    expect(levelLabel(['Warehouse', 'Zone', 'Rack'], 1)).toBe('Zone');
  });

  it('falls back rather than rendering nothing', () => {
    // A tenant that shortened the list after locations already existed.
    expect(levelLabel(['Warehouse'], 3)).toBe('Level 4');
  });
});
