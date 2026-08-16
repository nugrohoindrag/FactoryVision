import type { Location } from '@fv/contracts';

/**
 * Warehouse tree helpers (F1, flexible depth added v1.4).
 *
 * The hierarchy used to be hard-coded `Warehouse → Zone → Rack`. It fitted one
 * shape of factory and quietly punished every other: a single shed with shelves
 * had to invent a zone it does not have, a cold store that genuinely picks by
 * bin had nowhere to put one, and a two-site business wanted a level above the
 * warehouse.
 *
 * So depth is a number here, and what each depth is CALLED is tenant
 * configuration. Nothing in this file knows the word "rack".
 *
 * Pure: no React, no Dexie, no clock.
 */

/** `WH-01 › Z-A › A-01` — the walk, not the tree. */
export function locationPath(
  location: Location,
  all: readonly Location[],
  separator = ' › ',
): string {
  const byId = new Map(all.map((l) => [l.id, l]));
  const parts = [location.code];
  let current = location;
  // Guarded against a cycle: a self-parenting row must not hang the screen.
  for (let guard = 0; current.parentId && guard < 8; guard += 1) {
    const parent = byId.get(current.parentId);
    if (!parent || parent.id === current.id) break;
    parts.unshift(parent.code);
    current = parent;
  }
  return parts.join(separator);
}

/** Depth computed from the parent chain — the authority when a row looks wrong. */
export function computeDepth(location: Location, all: readonly Location[]): number {
  const byId = new Map(all.map((l) => [l.id, l]));
  let depth = 0;
  let current = location;
  for (let guard = 0; current.parentId && guard < 8; guard += 1) {
    const parent = byId.get(current.parentId);
    if (!parent || parent.id === current.id) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

export interface LocationNode {
  location: Location;
  children: LocationNode[];
}

/**
 * Builds the tree for K04. Orphans — a row whose parent was deactivated or
 * never synced — are surfaced at the root rather than dropped, because a
 * location that silently disappears is stock nobody can find.
 */
export function locationTree(all: readonly Location[]): LocationNode[] {
  const byId = new Map(all.map((l) => [l.id, { location: l, children: [] as LocationNode[] }]));
  const roots: LocationNode[] = [];

  for (const node of byId.values()) {
    const parentId = node.location.parentId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  const sortRec = (nodes: LocationNode[]) => {
    nodes.sort((a, b) => a.location.code.localeCompare(b.location.code));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

/** Flattens the tree back to a list, parents before children, for a table. */
export function flattenTree(nodes: readonly LocationNode[]): LocationNode[] {
  const out: LocationNode[] = [];
  const walk = (list: readonly LocationNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** How many locations sit at each depth — what K14 checks before removing a level. */
export function depthUsage(all: readonly Location[]): Map<number, number> {
  const usage = new Map<number, number>();
  for (const location of all) {
    usage.set(location.depth, (usage.get(location.depth) ?? 0) + 1);
  }
  return usage;
}

/**
 * The deepest level actually in use. Shortening `locationLevels` below this
 * would orphan real locations, so K14 refuses it rather than silently
 * relabelling them.
 */
export function deepestUsedLevel(all: readonly Location[]): number {
  return all.reduce((max, l) => Math.max(max, l.depth), -1);
}

/** Where stock may actually be put. The one rule putaway needs. */
export function storableLocations(all: readonly Location[]): Location[] {
  return all.filter((l) => l.active && l.storable && !l.virtual);
}

/**
 * The label for a depth, falling back rather than rendering `undefined`.
 *
 * A tenant that shortens its level list after locations already exist would
 * otherwise show a blank column heading — worse than a plain `Level 4`.
 */
export function levelLabel(levels: readonly string[], depth: number): string {
  return levels[depth] ?? `Level ${depth + 1}`;
}
