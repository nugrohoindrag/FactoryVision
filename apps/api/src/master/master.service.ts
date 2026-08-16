import { Inject, Injectable } from '@nestjs/common';
import {
  MAX_LOCATION_DEPTH,
  uuidv7,
  type Location as LocationRecord,
  type UnitConversion,
} from '@fv/contracts';
import { toBase, UnknownUnitError } from '@fv/domain';
import { audit } from '../common/audit.js';
import { toPrismaDecimal } from '../common/decimal.js';
import { AppError } from '../common/errors.js';
import { requireActor } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * B-049 → B-057 — master data, and the two rules that run through all of it.
 *
 * ## Deactivate, never delete
 *
 * Every master record is referenced by an append-only movement log. Deleting a
 * rack that once held stock leaves hundreds of historical movements pointing at
 * a place that does not exist — the stock card renders a blank where a location
 * belongs, and nobody can tell whether that is a bug or simply missing data.
 *
 * The UI already follows this (UI Plan Sprint 7). Enforcing it only there would
 * mean the rule holds until somebody writes a script.
 *
 * ## Depth follows the parent, and is never typed
 *
 * A location's depth is derived from its parent chain (PRD v1.4). Letting it be
 * entered would allow a rack at depth 0 inside a warehouse at depth 2, and the
 * tree would render as something nobody could navigate.
 */
@Injectable()
export class MasterService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /* --- B-049 products ---------------------------------------------------- */

  /**
   * Unit conversions are validated, not trusted.
   *
   * `1 sak = 25 kg` typed as `1 sak = 2.5 kg` corrupts receiving, issuing,
   * counting and inventory valuation at once, and it does so silently — every
   * screen keeps working, every number is wrong. UI Plan Sprint 7 deliberately
   * left the conversion editor out of K03 for this reason; whatever eventually
   * edits them, this is the gate they pass through.
   */
  validateConversions(baseUnit: string, conversions: readonly UnitConversion[]): void {
    for (const conversion of conversions) {
      if (Number(conversion.factor) <= 0) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Conversion ${conversion.from} → ${conversion.to} needs a factor above zero`,
        );
      }
      if (conversion.from === conversion.to) {
        throw new AppError('VALIDATION_FAILED', `${conversion.from} cannot convert to itself`);
      }
    }

    // Two routes between the same pair of units will disagree eventually, and
    // the one that gets used is whichever the lookup happens to find first.
    const pairs = new Set<string>();
    for (const conversion of conversions) {
      const key = [conversion.from, conversion.to].sort().join('↔');
      if (pairs.has(key)) {
        throw new AppError(
          'VALIDATION_FAILED',
          `There are two different conversions between ${conversion.from} and ${conversion.to}`,
        );
      }
      pairs.add(key);
    }

    /**
     * Every alternate unit has to reach the base unit. A quantity entered in
     * sacks that cannot become kilos is a quantity the stock projection has to
     * silently drop, and silently dropped stock is the whole problem this
     * product exists to fix.
     *
     * Checked with the SAME function the receiving screen uses, so a conversion
     * that passes here cannot fail there.
     */
    const probe = { sku: '(new)', baseUnit, conversions: [...conversions] };
    for (const conversion of conversions) {
      const other = conversion.from === baseUnit ? conversion.to : conversion.from;
      if (other === baseUnit) continue;
      try {
        toBase(probe, '1', other);
      } catch (error) {
        if (error instanceof UnknownUnitError) {
          throw new AppError(
            'VALIDATION_FAILED',
            `${other} has no route to the base unit ${baseUnit}`,
          );
        }
        throw error;
      }
    }
  }

  /* --- B-050 / B-051 locations ------------------------------------------- */

  /** Depth comes from the parent. It is never accepted from the caller. */
  async depthFor(parentId: string | null): Promise<number> {
    if (!parentId) return 0;

    const parent = await this.prisma.client().location.findFirst({ where: { id: parentId } });
    if (!parent) throw new AppError('NOT_FOUND', 'That parent location does not exist');

    const depth = parent.depth + 1;
    if (depth >= MAX_LOCATION_DEPTH) {
      throw new AppError(
        'DEPTH_EXCEEDED',
        `The warehouse tree stops at ${MAX_LOCATION_DEPTH} levels. Past that an operator is ` +
          'naming more places than they can hold in their head, and putaway accuracy is the ' +
          'first thing to go.',
      );
    }
    return depth;
  }

  /**
   * B-051 — a level still in use cannot be removed from the configuration.
   *
   * Shortening `['Warehouse','Zone','Rack']` to `['Warehouse','Rack']` while
   * real racks sit at depth 2 would leave those rows with a depth that has no
   * name. They would not disappear; they would render as blanks in the picker,
   * which is worse.
   */
  async depthUsage(): Promise<Map<number, number>> {
    const rows = await this.prisma.client().location.groupBy({
      by: ['depth'],
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.depth, row._count._all]));
  }

  async assertLevelsRemovable(newLevels: readonly string[]): Promise<void> {
    const usage = await this.depthUsage();
    const deepest = Math.max(-1, ...[...usage.entries()].filter(([, n]) => n > 0).map(([d]) => d));

    if (deepest >= newLevels.length) {
      const count = usage.get(deepest) ?? 0;
      throw new AppError(
        'IN_USE',
        `${count} location${count === 1 ? '' : 's'} still sit at level ${deepest + 1}. ` +
          'Move or deactivate them before removing that level.',
      );
    }
  }

  /** Rejects a parent chain that loops back on itself. */
  async assertNoCycle(id: string, parentId: string | null): Promise<void> {
    let cursor = parentId;
    for (let hops = 0; cursor && hops <= MAX_LOCATION_DEPTH + 1; hops += 1) {
      if (cursor === id) {
        throw new AppError('VALIDATION_FAILED', 'A location cannot sit inside itself');
      }
      const parent: LocationRecord | null = (await this.prisma
        .client()
        .location.findFirst({ where: { id: cursor } })) as LocationRecord | null;
      cursor = parent?.parentId ?? null;
    }
  }

  /* --- B-057 deactivate, never delete ------------------------------------ */

  async deactivate(
    kind: 'product' | 'location' | 'partner' | 'productionLocation',
    id: string,
  ): Promise<void> {
    const client = this.prisma.client();

    if (kind === 'location') {
      const children = await client.location.count({ where: { parentId: id, active: true } });
      if (children > 0) {
        throw new AppError(
          'IN_USE',
          `That location still has ${children} active place${children === 1 ? '' : 's'} inside it`,
        );
      }
      const holding = await client.stockLine.count({ where: { locationId: id } });
      if (holding > 0) {
        // Not a technical constraint — stock that is physically there does not
        // stop being there because a row was switched off.
        throw new AppError('IN_USE', 'There is still stock at that location');
      }
    }

    const table = {
      product: client.product,
      location: client.location,
      partner: client.partner,
      productionLocation: client.productionLocation,
    }[kind];

    const updated = await (table as { updateMany: (args: unknown) => Promise<{ count: number }> })
      .updateMany({ where: { id }, data: { active: false } });

    if (updated.count === 0) throw new AppError('NOT_FOUND', 'Nothing to deactivate');

    await audit(this.prisma, {
      action: `${kind}.deactivated`,
      subject: kind,
      subjectId: id,
    });
  }

  /* --- B-059 bulk import ------------------------------------------------- */

  /**
   * Takes the rows K06 has already parsed in the browser.
   *
   * Parsing stays on the device (Tech Stack §2.3): warehouse spreadsheets run
   * to tens of megabytes, and uploading them to be parsed server-side is the
   * slowest and most breakable path available. What arrives here is clean rows.
   *
   * Partial import is allowed on purpose (PRD F1). A file where 40 of 900 rows
   * are unusable should import 860 and report 40, not refuse the lot — that
   * refusal is exactly what sends a factory back to its spreadsheet.
   */
  async importProducts(rows: readonly ImportProductRow[]): Promise<ImportOutcome> {
    const actor = requireActor();
    const outcome: ImportOutcome = { imported: 0, skipped: [], updated: 0 };

    for (const [index, row] of rows.entries()) {
      try {
        this.validateConversions(row.baseUnit, row.conversions ?? []);

        const existing = await this.prisma
          .client()
          .product.findFirst({ where: { sku: row.sku } });

        if (existing) {
          await this.prisma.client().product.updateMany({
            where: { id: existing.id },
            data: {
              name: row.name,
              itemClass: row.itemClass,
              baseUnit: row.baseUnit,
              conversions: (row.conversions ?? []) as object,
              shelfLifeDays: row.shelfLifeDays ?? null,
              minimumStock: row.minimumStock ? toPrismaDecimal(row.minimumStock) : null,
              averageCost: row.averageCost ? toPrismaDecimal(row.averageCost) : null,
            },
          });
          outcome.updated += 1;
          continue;
        }

        await this.prisma.client().product.create({
          data: {
            id: uuidv7(),
            tenantId: actor.tenantId,
            sku: row.sku,
            name: row.name,
            itemClass: row.itemClass,
            baseUnit: row.baseUnit,
            conversions: (row.conversions ?? []) as object,
            shelfLifeDays: row.shelfLifeDays ?? null,
            minimumStock: row.minimumStock ? toPrismaDecimal(row.minimumStock) : null,
            averageCost: row.averageCost ? toPrismaDecimal(row.averageCost) : null,
          },
        });
        outcome.imported += 1;
      } catch (error) {
        // Per row, with the row number, because "import failed" against a
        // 900-row file is not something anybody can act on.
        outcome.skipped.push({
          row: index + 1,
          reason: error instanceof AppError ? error.message : 'Could not import this row',
        });
      }
    }

    await audit(this.prisma, {
      action: 'import.products',
      subject: 'product',
      after: { imported: outcome.imported, updated: outcome.updated, skipped: outcome.skipped.length },
    });

    return outcome;
  }
}

export interface ImportProductRow {
  sku: string;
  name: string;
  itemClass: string;
  baseUnit: string;
  conversions?: UnitConversion[];
  shelfLifeDays?: number;
  minimumStock?: string;
  averageCost?: string;
}

export interface ImportOutcome {
  imported: number;
  updated: number;
  skipped: { row: number; reason: string }[];
}
