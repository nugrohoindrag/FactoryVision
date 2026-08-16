import type { Bom } from '@fv/contracts';
import { describe, expect, it } from 'vitest';
import { bomUsageVariance, explodeBom, shortLines, varianceByDestination } from '../src/bom.js';
import { ev, ids } from './helpers.js';

/**
 * BOM arithmetic (F21).
 *
 * This is a decimal multiplication that feeds every variance figure in the
 * product, which makes it exactly the place a float would rot quietly — so
 * the tests here care about exact strings, not approximate numbers.
 */

const perBatch: Bom = {
  id: 'bom-1',
  tenantId: 'tenant-1' as Bom['tenantId'],
  productId: ids.sugar,
  // A per-BATCH recipe: 1000 g of dough, not "per piece".
  outputQuantity: '1000',
  outputUnit: 'g',
  verified: true,
  lines: [
    { id: 'bl-1', productId: ids.flour, standardQuantity: '600', unit: 'g' },
    { id: 'bl-2', productId: 'prod-yeast', standardQuantity: '8', unit: 'g', standardShrinkagePct: '2' },
  ],
};

const perUnit: Bom = {
  id: 'bom-2',
  tenantId: 'tenant-1' as Bom['tenantId'],
  productId: 'prod-donut',
  outputQuantity: '1',
  outputUnit: 'pcs',
  verified: false,
  lines: [{ id: 'bl-3', productId: ids.flour, standardQuantity: '0.05', unit: 'kg' }],
};

describe('explodeBom', () => {
  it('scales a per-batch recipe to the planned output', () => {
    // 2500 g planned ÷ 1000 g basis = ×2.5
    const lines = explodeBom(perBatch, '2500');
    expect(lines[0]!.requiredQuantity).toBe('1500');
    expect(lines[0]!.netQuantity).toBe('1500');
  });

  it('adds the shrinkage allowance on top of net, not inside it', () => {
    // 8 g × 2.5 = 20 g net, +2% = 20.4 g required.
    const lines = explodeBom(perBatch, '2500');
    expect(lines[1]!.netQuantity).toBe('20');
    expect(lines[1]!.requiredQuantity).toBe('20.4');
  });

  it('handles a per-unit recipe with the same structure', () => {
    // The whole point of outputQuantity: one shape for both bases.
    const lines = explodeBom(perUnit, '500');
    expect(lines[0]!.requiredQuantity).toBe('25');
  });

  it('produces no fake decimal remainder on a repeating division', () => {
    // 1000 ÷ 3 is the classic float trap.
    const thirds: Bom = { ...perUnit, outputQuantity: '3', lines: perUnit.lines };
    const lines = explodeBom(thirds, '1000');
    expect(lines[0]!.requiredQuantity).not.toMatch(/0{6,}[1-9]/);
  });

  it('returns nothing rather than dividing by zero', () => {
    expect(explodeBom({ ...perUnit, outputQuantity: '0' }, '100')).toEqual([]);
  });

  it('treats a product with no BOM lines as simply empty, not an error', () => {
    // Products without a recipe must still be requestable by hand (PRD F21).
    expect(explodeBom({ ...perUnit, lines: [] }, '100')).toEqual([]);
  });
});

describe('shortLines', () => {
  it('flags material the warehouse cannot cover', () => {
    const exploded = explodeBom(perBatch, '2500');
    const available = new Map([
      [ids.flour, '2000'],
      ['prod-yeast', '2'],
    ]);
    const short = shortLines(exploded, available);
    // Flour is fine (1500 needed, 2000 there); yeast is not (20.4 vs 2).
    expect(short).toHaveLength(1);
    expect(short[0]!.productId).toBe('prod-yeast');
  });

  it('treats an unknown product as zero stock, not as unlimited', () => {
    const exploded = explodeBom(perUnit, '10');
    expect(shortLines(exploded, new Map())).toHaveLength(1);
  });
});

describe('usageVariance', () => {
  const requested = ev('material_issue.requested', {
    issueId: ids.issue,
    workOrderNo: 'WO-1',
    requestedBy: 'user-2',
    quick: false,
    destinationId: ids.lane2,
    productId: ids.sugar,
    plannedQuantity: '450',
    // The snapshot: what the recipe said AT REQUEST TIME.
    bomStandard: [{ lineId: ids.line1, standardQuantity: '90' }],
    lines: [{ lineId: ids.line1, productId: ids.flour, quantity: '100', unit: 'kg' }],
  });

  it('compares actual against the standard captured at request time', () => {
    const rows = bomUsageVariance([requested], new Map([[`${ids.issue}|${ids.line1}`, '91.5']]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.standard).toBe('90');
    expect(rows[0]!.actual).toBe('91.5');
    expect(rows[0]!.variance).toBe('1.5');
    expect(rows[0]!.withoutStandard).toBe(false);
  });

  it('carries the destination lane so the number can be acted on', () => {
    const rows = bomUsageVariance([requested], new Map([[`${ids.issue}|${ids.line1}`, '91.5']]));
    expect(rows[0]!.destinationId).toBe(ids.lane2);
  });

  it('says so plainly when there was no standard, rather than implying one', () => {
    const noBom = ev('material_issue.requested', {
      issueId: 'issue-2',
      workOrderNo: '',
      requestedBy: 'user-2',
      quick: true,
      destinationId: ids.lane1,
      bomStandard: [],
      lines: [{ lineId: 'l-9', productId: ids.flour, quantity: '10', unit: 'kg' }],
    });
    const rows = bomUsageVariance([noBom], new Map([['issue-2|l-9', '12']]));
    expect(rows[0]!.withoutStandard).toBe(true);
    expect(rows[0]!.variance).toBeNull();
  });

  it('ignores lines that have not been consumed yet', () => {
    expect(bomUsageVariance([requested], new Map())).toEqual([]);
  });
});

describe('varianceByDestination', () => {
  it('splits variance per lane — the split that makes it actionable', () => {
    const rows = [
      { issueId: 'i1', lineId: 'l1', productId: 'p', destinationId: ids.lane1, standard: '10', actual: '12', variance: '2', withoutStandard: false },
      { issueId: 'i2', lineId: 'l2', productId: 'p', destinationId: ids.lane1, standard: '10', actual: '13', variance: '3', withoutStandard: false },
      { issueId: 'i3', lineId: 'l3', productId: 'p', destinationId: ids.lane2, standard: '10', actual: '10', variance: '0', withoutStandard: false },
    ];
    const byLane = varianceByDestination(rows);
    // 5 on one line and 0 on the other is a line problem, not a recipe problem.
    expect(byLane.get(ids.lane1)).toBe('5');
    expect(byLane.get(ids.lane2)).toBe('0');
  });
});
