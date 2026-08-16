import { describe, expect, it } from 'vitest';
import {
  canClose,
  computeLineBalance,
  decideIssueStatus,
  issueAgeHours,
  isOverdue,
  previewClose,
  projectIssues,
  summariseIssue,
} from '../src/issue.js';
import { ev, ids } from './helpers.js';

describe('material issue balance', () => {
  it('computes the L19 panel exactly', () => {
    const line = computeLineBalance({
      lineId: ids.line1,
      productId: ids.flour,
      unit: 'kg',
      issued: '100.00',
      returned: '8.00',
      shrinkage: '0.50',
      accounted: true,
    });
    expect(line.consumed).toBe('91.5');
    expect(line.overAccounted).toBe(false);
  });

  it('flags an impossible line instead of producing negative consumption', () => {
    const line = computeLineBalance({
      lineId: ids.line1,
      productId: ids.flour,
      unit: 'kg',
      issued: '10',
      returned: '9',
      shrinkage: '2',
      accounted: true,
    });
    expect(line.overAccounted).toBe(true);
    const balance = summariseIssue(ids.issue, [line]);
    expect(canClose(balance)).toBe(false);
    expect(decideIssueStatus(balance)).toBe('OPEN'); // never forced closed
  });

  it('stays PARTIALLY CLOSED when a line has no shrinkage reason', () => {
    const accounted = computeLineBalance({
      lineId: ids.line1,
      productId: ids.flour,
      unit: 'kg',
      issued: '50',
      shrinkage: '1',
      accounted: true,
    });
    const unaccounted = computeLineBalance({
      lineId: ids.line2,
      productId: ids.sugar,
      unit: 'kg',
      issued: '20',
    });
    const balance = summariseIssue(ids.issue, [accounted, unaccounted]);
    expect(balance.unaccountedLineIds).toEqual([ids.line2]);
    expect(decideIssueStatus(balance)).toBe('PARTIALLY CLOSED');
  });

  it('previews the close result live, the way L19 types', () => {
    const lines = [
      { lineId: ids.line1, productId: ids.flour, unit: 'kg', issued: '100', returned: '8', shrinkage: '0' },
    ];
    const dry = previewClose(lines, []);
    expect(dry.resultingStatus).toBe('PARTIALLY CLOSED');

    const withReason = previewClose(lines, [
      { lineId: ids.line1, quantity: '0.5', reason: 'SPILLAGE' },
    ]);
    expect(withReason.totals.consumed).toBe('91.5');
    expect(withReason.resultingStatus).toBe('CLOSED');
  });

  it('rebuilds balances from the event log using what was picked, not requested', () => {
    const issues = projectIssues([
      ev('material_issue.requested', {
        issueId: ids.issue,
        workOrderNo: 'WO-77',
        requestedBy: 'user-2',
        quick: false,
        lines: [{ lineId: ids.line1, productId: ids.flour, quantity: '60', unit: 'kg' }],
      }),
      // The operator could only find 55 kg.
      ev('material_issue.prepared', {
        issueId: ids.issue,
        picks: [
          {
            lineId: ids.line1,
            ref: { productId: ids.flour, batchId: ids.batchA, locationId: ids.rackA1, status: 'AVAILABLE' },
            quantity: '55',
          },
        ],
      }),
      ev('material_issue.returned', {
        issueId: ids.issue,
        returns: [
          {
            lineId: ids.line1,
            ref: { productId: ids.flour, batchId: ids.batchA, locationId: ids.production, status: 'IN PRODUCTION' },
            quantity: '5',
            toLocationId: ids.rackA1,
          },
        ],
      }),
      ev('material_issue.closed', {
        issueId: ids.issue,
        shrinkage: [{ lineId: ids.line1, quantity: '0.25', reason: 'NATURAL_LOSS', photoIds: [] }],
        resultingStatus: 'CLOSED',
      }),
    ]);

    const balance = issues.get(ids.issue);
    expect(balance?.totals.issued).toBe('55');
    expect(balance?.totals.consumed).toBe('49.75');
    expect(balance?.unaccountedLineIds).toEqual([]);
  });
});

describe('issue age', () => {
  const opened = '2026-08-16T08:00:00.000Z';

  it('reports whole hours', () => {
    expect(issueAgeHours(opened, new Date('2026-08-16T10:30:00.000Z'))).toBe(2);
    expect(issueAgeHours(opened, new Date('2026-08-16T07:00:00.000Z'))).toBe(0);
  });

  it('turns overdue exactly at 24 hours — the one red condition', () => {
    expect(isOverdue(opened, new Date('2026-08-17T07:59:00.000Z'))).toBe(false);
    expect(isOverdue(opened, new Date('2026-08-17T08:00:00.000Z'))).toBe(true);
  });
});
