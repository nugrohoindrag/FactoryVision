import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { Requires } from '../auth/public.decorator.js';
import { AppError } from '../common/errors.js';
import { requireActor } from '../common/request-context.js';
import { ZodQuery } from '../common/zod.js';
import { TenantService } from '../tenant/tenant.service.js';
import { ExportService, type Column } from './export.service.js';
import { ReportsService } from './reports.service.js';

/**
 * K10–K12, and the owner's dashboard.
 *
 * Every report is readable by roles that may see reports, and the price columns
 * are already filtered upstream — `averageCost` never reaches an operator's
 * device, so a report built from those products cannot leak it either.
 *
 * `?format=xlsx|pdf` on any of them produces the same rows as a file. One code
 * path, so an export can never quietly disagree with the screen it came from.
 *
 * These handlers take Nest's own `@Res()` rather than the thin decorator in
 * `common/http.ts`. It is the one place Nest's decorator set is needed: taking
 * the reply switches the route into library-specific mode, and only Nest's own
 * `@Res()` sets the metadata that tells it to stop managing the response. A
 * look-alike built with `createParamDecorator` hands over the object without
 * handing over the responsibility, and every request hangs until it times out —
 * which reads as a slow database, not as a missing `send`.
 */

const Period = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  format: z.enum(['json', 'xlsx', 'pdf']).default('json'),
});

const Format = z.object({ format: z.enum(['json', 'xlsx', 'pdf']).default('json') });

@Controller('reports')
@Requires('report.view')
export class ReportsController {
  constructor(
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(ExportService) private readonly exports: ExportService,
    @Inject(TenantService) private readonly tenants: TenantService,
  ) {}

  @Get('stock-card/:productId')
  async stockCard(
    @Param('productId') productId: string,
    @ZodQuery(Format) query: z.infer<typeof Format>,
    @Res() reply: FastifyReply,
  ) {
    const actor = requireActor();
    const rows = await this.reports.stockCard(actor.tenantId, productId);
    return this.deliver(reply, query.format, {
      title: 'Stock card',
      columns: [
        { key: 'occurredAt', header: 'When' },
        { key: 'type', header: 'Movement' },
        { key: 'quantityIn', header: 'In' },
        { key: 'quantityOut', header: 'Out' },
        { key: 'balance', header: 'Balance' },
        { key: 'actorRole', header: 'By' },
      ],
      rows: rows as unknown as Record<string, unknown>[],
    });
  }

  @Get('movements')
  async movements(
    @ZodQuery(Period) query: z.infer<typeof Period>,
    @Res() reply: FastifyReply,
  ) {
    const actor = requireActor();
    const rows = await this.reports.movements(actor.tenantId, query.from, query.to);
    return this.deliver(reply, query.format, {
      title: `Movements ${query.from} to ${query.to}`,
      columns: [
        { key: 'itemClass', header: 'Item class' },
        { key: 'quantityIn', header: 'In' },
        { key: 'quantityOut', header: 'Out' },
        { key: 'net', header: 'Net' },
      ],
      rows: rows as unknown as Record<string, unknown>[],
    });
  }

  @Get('inventory-value')
  async inventoryValue(@ZodQuery(Format) query: z.infer<typeof Format>, @Res() reply: FastifyReply) {
    const actor = requireActor();
    const result = await this.reports.inventoryValue(actor.tenantId);
    return this.deliver(
      reply,
      query.format,
      {
        title: 'Inventory value',
        columns: [
          { key: 'name', header: 'Product' },
          { key: 'itemClass', header: 'Class' },
          { key: 'quantity', header: 'Quantity' },
          { key: 'unitCost', header: 'Unit cost' },
          { key: 'value', header: 'Value' },
        ],
        rows: result.rows as unknown as Record<string, unknown>[],
        // Named in the file, because a printed valuation with no method on it
        // is a number somebody will assume is FIFO (PRD §14.4 is still open).
        caveats: ['Valued at weighted average cost'],
      },
      result,
    );
  }

  @Get('stock-takes')
  async stockTakes() {
    const actor = requireActor();
    const { config } = await this.tenants.config(actor.tenantId);
    return this.reports.stockTakes(actor.tenantId, config.defaults.recountThresholdPercent);
  }

  @Get('usage-per-batch')
  async usagePerBatch() {
    const actor = requireActor();
    return this.reports.usagePerBatch(actor.tenantId);
  }

  /**
   * The report factory owners actually ask for (PRD F6) — and the one that can
   * mislead if its caveats are dropped on the way to a printer.
   */
  @Get('bom-variance')
  async bomVariance(@ZodQuery(Format) query: z.infer<typeof Format>, @Res() reply: FastifyReply) {
    const actor = requireActor();
    const result = await this.reports.bomVariance(actor.tenantId);

    const unverified = result.rows.filter((row) => row.unverifiedRecipe).length;
    const noStandard = result.rows.filter((row) => row.withoutStandard).length;

    const caveats: string[] = [];
    if (unverified > 0) {
      caveats.push(
        `${unverified} row${unverified === 1 ? '' : 's'} compare against a recipe nobody has ` +
          'verified — treat the variance as indicative, not actionable.',
      );
    }
    if (noStandard > 0) {
      caveats.push(
        `${noStandard} row${noStandard === 1 ? '' : 's'} have no recipe at all, so there is ` +
          'nothing to compare against.',
      );
    }

    return this.deliver(
      reply,
      query.format,
      {
        title: 'Usage variance against recipe',
        columns: [
          { key: 'productId', header: 'Product' },
          { key: 'destinationId', header: 'Line' },
          { key: 'standard', header: 'Standard' },
          { key: 'actual', header: 'Actual' },
          { key: 'variance', header: 'Variance' },
          { key: 'valueImpact', header: 'Value' },
          { key: 'unverifiedRecipe', header: 'Recipe unverified' },
        ],
        rows: result.rows as unknown as Record<string, unknown>[],
        caveats,
      },
      result,
    );
  }

  @Get('aging')
  async aging(@ZodQuery(Format) query: z.infer<typeof Format>, @Res() reply: FastifyReply) {
    const actor = requireActor();
    const rows = await this.reports.aging(actor.tenantId);
    return this.deliver(reply, query.format, {
      title: 'Stock aging',
      columns: [
        { key: 'productId', header: 'Product' },
        { key: 'bucket', header: 'Age' },
        { key: 'quantity', header: 'Quantity' },
        { key: 'value', header: 'Value' },
      ],
      rows: rows as unknown as Record<string, unknown>[],
    });
  }

  @Get('shrinkage')
  async shrinkage() {
    const actor = requireActor();
    return this.reports.shrinkage(actor.tenantId);
  }

  @Get('suppliers')
  async suppliers(@ZodQuery(Format) query: z.infer<typeof Format>, @Res() reply: FastifyReply) {
    const actor = requireActor();
    const rows = await this.reports.suppliers(actor.tenantId);
    return this.deliver(reply, query.format, {
      title: 'Supplier performance',
      columns: [
        { key: 'supplierName', header: 'Supplier' },
        { key: 'orders', header: 'Orders' },
        { key: 'onTimeRate', header: 'On time %' },
        { key: 'fillRate', header: 'Fill rate %' },
        { key: 'defectRate', header: 'Defect %' },
      ],
      rows: rows as unknown as Record<string, unknown>[],
    });
  }

  /** Tidiness is pushed by reporting, never by blocking the door (PRD F24). */
  @Get('receipts-without-po')
  async receiptsWithoutPo(@ZodQuery(Format) query: z.infer<typeof Format>, @Res() reply: FastifyReply) {
    const actor = requireActor();
    const rows = await this.reports.receiptsWithoutPo(actor.tenantId);
    return this.deliver(reply, query.format, {
      title: 'Receipts recorded without a purchase order',
      columns: [
        { key: 'receivedAt', header: 'When' },
        { key: 'supplierId', header: 'Supplier' },
        { key: 'deliveryNoteNo', header: 'Delivery note' },
        { key: 'recordedBy', header: 'Recorded by' },
      ],
      rows: rows as unknown as Record<string, unknown>[],
    });
  }

  /** B-080 — nine numbers, one round trip. */
  @Get('dashboard')
  @Requires('dashboard.view')
  async dashboard() {
    const actor = requireActor();
    return this.reports.dashboard(actor.tenantId);
  }

  /**
   * One place that turns a report into JSON, a spreadsheet or a PDF.
   *
   * Shared on purpose: an export built from a second query could disagree with
   * the screen that produced it, and the disagreement would surface in a
   * meeting rather than in a test.
   */
  private async deliver(
    reply: FastifyReply,
    format: 'json' | 'xlsx' | 'pdf',
    payload: {
      title: string;
      columns: readonly Column[];
      rows: readonly Record<string, unknown>[];
      caveats?: readonly string[];
    },
    jsonBody?: unknown,
  ): Promise<unknown> {
    const response = reply;
    const filename = payload.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    /**
     * Taking the reply object hands the response back to Fastify, so EVERY
     * branch has to send — including the JSON one. Returning a value here
     * instead would leave the request open until it timed out, which is a
     * failure mode that looks like a slow database rather than a missing
     * `send`.
     */
    if (format === 'json') {
      void response.send(jsonBody ?? payload.rows);
      return response;
    }

    if (format === 'xlsx') {
      const buffer = await this.exports.toExcel(payload);
      void response
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="${filename}.xlsx"`)
        .send(buffer);
      return response;
    }

    if (format === 'pdf') {
      const buffer = await this.exports.toPdf(payload);
      void response
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${filename}.pdf"`)
        .send(buffer);
      return response;
    }

    throw new AppError('VALIDATION_FAILED', `Unknown export format ${format}`);
  }
}
