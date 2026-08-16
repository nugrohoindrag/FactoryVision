import { Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { uuidv7 } from '@fv/contracts';
import { z } from 'zod';
import { Requires, Write } from '../auth/public.decorator.js';
import { audit } from '../common/audit.js';
import { big, toPrismaDecimal } from '../common/decimal.js';
import { AppError } from '../common/errors.js';
import { requireActor } from '../common/request-context.js';
import { ZodBody } from '../common/zod.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectorService } from '../projection/projector.service.js';
import { HistoryImportService } from './history-import.service.js';

/**
 * B-055 / B-056 — purchase orders (K15/K16) and recipes (K17).
 *
 * ## The PO has no status column, and that is the point
 *
 * `status` and `outstanding` are projected from receipt events every time they
 * are asked for (`ProjectorService.purchaseOrders`). Storing them would produce
 * a purchase order whose status disagrees with its own receipts the first time
 * two devices sync out of order — the identical failure that made stock a
 * projection in the first place (PRD §8, Tech Stack §2.8a).
 *
 * What IS stored is the closing decision: a PO closed by hand with a reason,
 * because that is a human judgement and nothing can derive it.
 */

const Decimal = z.string().regex(/^-?\d+(\.\d+)?$/);
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const PoLineInput = z.object({
  id: z.string().uuid().optional(),
  productId: z.string().uuid(),
  quantityOrdered: Decimal,
  unit: z.string().min(1),
  unitPrice: Decimal.optional(),
});

const PoInput = z.object({
  poNo: z.string().trim().min(1).optional(),
  supplierId: z.string().uuid(),
  orderDate: DateOnly,
  /** Mandatory: no ETA means no arrival task, and F25 loses its main source. */
  eta: DateOnly,
  note: z.string().optional(),
  lines: z.array(PoLineInput).min(1, 'A purchase order needs at least one line'),
});

const BomLineInput = z.object({
  productId: z.string().uuid(),
  standardQuantity: Decimal,
  unit: z.string().min(1),
  standardShrinkagePct: Decimal.optional(),
});

const BomInput = z.object({
  productId: z.string().uuid(),
  /**
   * `outputQuantity` + `outputUnit` is what lets a per-batch recipe (1000 g of
   * dough) and a per-unit recipe (1 pcs) share one structure. The factory fills
   * in its own basis — not a decision anybody can make from an office (PRD §14.10).
   */
  outputQuantity: Decimal,
  outputUnit: z.string().min(1),
  verified: z.boolean().default(false),
  lines: z.array(BomLineInput).default([]),
});

@Controller()
export class DocumentsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectorService) private readonly projector: ProjectorService,
    @Inject(HistoryImportService) private readonly history: HistoryImportService,
  ) {}

  /* --- B-060 history import ---------------------------------------------- */

  /**
   * Loads a factory's past movements so the stock card is not blank on day one.
   *
   * The rows come from K06, parsed in the browser (Tech Stack §2.3). What
   * arrives here is already shaped like events.
   */
  @Post('import/history')
  @Write()
  @Requires('import.run')
  async importHistory(
    @ZodBody(
      z.object({
        rows: z
          .array(
            z.object({
              type: z.string().min(1),
              occurredAt: z.string().datetime({ offset: true }),
              payload: z.unknown(),
            }),
          )
          .max(5000, 'Import in batches of 5,000 movements or fewer'),
      }),
    )
    body: { rows: { type: string; occurredAt: string; payload: unknown }[] },
  ) {
    return this.history.importHistory(body.rows);
  }

  @Post('import/history/revert')
  @Write()
  @Requires('import.run')
  async revertHistory() {
    return this.history.revertImport();
  }

  /* --- purchase orders (K15, K16) ---------------------------------------- */

  @Get('purchase-orders')
  async list() {
    const actor = requireActor();
    // Progress, not a stored status. Same call the dashboard makes.
    return this.projector.purchaseOrders(actor.tenantId);
  }

  @Post('purchase-orders')
  @Write()
  @Requires('po.write')
  async create(@ZodBody(PoInput) body: z.infer<typeof PoInput>) {
    const actor = requireActor();
    const poNo = body.poNo ?? (await this.nextPoNo());

    const clash = await this.prisma.client().purchaseOrder.findFirst({ where: { poNo } });
    if (clash) throw new AppError('CONFLICT', `Purchase order ${poNo} already exists`);

    const id = uuidv7();
    await this.prisma.client().purchaseOrder.create({
      data: {
        id,
        tenantId: actor.tenantId,
        poNo,
        supplierId: body.supplierId,
        orderDate: new Date(body.orderDate),
        eta: new Date(body.eta),
        note: body.note,
      },
    });

    await this.prisma.client().purchaseOrderLine.createMany({
      data: body.lines.map((line) => ({
        id: line.id ?? uuidv7(),
        tenantId: actor.tenantId,
        purchaseOrderId: id,
        productId: line.productId,
        quantityOrdered: toPrismaDecimal(line.quantityOrdered),
        unit: line.unit,
        unitPrice: line.unitPrice ? toPrismaDecimal(line.unitPrice) : null,
      })),
    });

    await audit(this.prisma, {
      action: 'purchaseOrder.created',
      subject: 'purchaseOrder',
      subjectId: id,
      after: { poNo, eta: body.eta, lines: body.lines.length },
    });

    return { id, poNo };
  }

  /**
   * Editing a PO that is already being delivered against.
   *
   * A line with receipts on it is frozen. Changing an ordered quantity after
   * goods have arrived rewrites what the supplier still owes — retroactively,
   * silently, and in the factory's favour or the supplier's depending on which
   * way the edit went. Neither is a conversation anybody wants to have from a
   * spreadsheet six weeks later.
   */
  @Patch('purchase-orders/:id')
  @Write()
  @Requires('po.write')
  async update(
    @Param('id') id: string,
    @ZodBody(PoInput.partial()) body: Partial<z.infer<typeof PoInput>>,
  ) {
    const actor = requireActor();
    const po = await this.prisma.client().purchaseOrder.findFirst({
      where: { id },
      include: { lines: true },
    });
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found');
    if (po.closedAt) throw new AppError('IMMUTABLE_FIELD', 'That purchase order is closed');

    const progress = (await this.projector.purchaseOrders(actor.tenantId)).find(
      (row) => row.purchaseOrderId === id,
    );

    if (body.lines) {
      const received = new Set(
        (progress?.lines ?? [])
          .filter((line) => big(line.received).gt(0))
          .map((line) => line.lineId),
      );

      for (const line of po.lines) {
        const incoming = body.lines.find((candidate) => candidate.id === line.id);
        const changed =
          !incoming || incoming.quantityOrdered !== line.quantityOrdered.toString();
        if (received.has(line.id) && changed) {
          throw new AppError(
            'IMMUTABLE_FIELD',
            'That line has already been delivered against — its ordered quantity is fixed',
          );
        }
      }

      await this.prisma.client().purchaseOrderLine.deleteMany({
        where: { purchaseOrderId: id, id: { notIn: [...received] } },
      });
      await this.prisma.client().purchaseOrderLine.createMany({
        data: body.lines
          .filter((line) => !line.id || !received.has(line.id))
          .map((line) => ({
            id: line.id ?? uuidv7(),
            tenantId: actor.tenantId,
            purchaseOrderId: id,
            productId: line.productId,
            quantityOrdered: toPrismaDecimal(line.quantityOrdered),
            unit: line.unit,
            unitPrice: line.unitPrice ? toPrismaDecimal(line.unitPrice) : null,
          })),
      });
    }

    await this.prisma.client().purchaseOrder.updateMany({
      where: { id },
      data: {
        ...(body.supplierId ? { supplierId: body.supplierId } : {}),
        ...(body.orderDate ? { orderDate: new Date(body.orderDate) } : {}),
        ...(body.eta ? { eta: new Date(body.eta) } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
      },
    });

    await audit(this.prisma, {
      action: 'purchaseOrder.updated',
      subject: 'purchaseOrder',
      subjectId: id,
      after: body,
    });
    return { ok: true };
  }

  /**
   * B-055 — closing a PO that still has outstanding quantity (PRD §14.9).
   *
   * The P0 route for settling a defect remainder while supplier returns (F17)
   * are still P1. The reason is mandatory and the trail is permanent, because
   * this is the moment a factory writes off money owed by a supplier — and
   * "why did we stop chasing that?" is a question somebody asks eventually.
   */
  @Post('purchase-orders/:id/close')
  @Write()
  @Requires('po.close')
  async close(
    @Param('id') id: string,
    @ZodBody(z.object({ reasonCode: z.string().min(1), note: z.string().optional() }))
    body: { reasonCode: string; note?: string },
  ) {
    const po = await this.prisma.client().purchaseOrder.findFirst({ where: { id } });
    if (!po) throw new AppError('NOT_FOUND', 'Purchase order not found');
    if (po.closedAt) throw new AppError('CONFLICT', 'That purchase order is already closed');

    await this.prisma.client().purchaseOrder.updateMany({
      where: { id },
      data: { closedAt: new Date(), closeReason: body.reasonCode },
    });

    await audit(this.prisma, {
      action: 'purchaseOrder.closed',
      subject: 'purchaseOrder',
      subjectId: id,
      reason: body.reasonCode,
      after: { note: body.note },
    });

    return { ok: true };
  }

  @Post('purchase-orders/:id/cancel')
  @Write()
  @Requires('po.close')
  async cancel(@Param('id') id: string) {
    const updated = await this.prisma
      .client()
      .purchaseOrder.updateMany({ where: { id, cancelled: false }, data: { cancelled: true } });
    if (updated.count === 0) throw new AppError('NOT_FOUND', 'Purchase order not found');
    await audit(this.prisma, { action: 'purchaseOrder.cancelled', subject: 'purchaseOrder', subjectId: id });
    return { ok: true };
  }

  /* --- bills of material (K17) ------------------------------------------- */

  @Get('boms')
  async listBoms() {
    const rows = await this.prisma.client().bom.findMany({ include: { lines: true } });
    return rows.map((bom) => ({
      id: bom.id,
      productId: bom.productId,
      outputQuantity: bom.outputQuantity.toString(),
      outputUnit: bom.outputUnit,
      verified: bom.verified,
      lines: bom.lines.map((line) => ({
        id: line.id,
        productId: line.productId,
        standardQuantity: line.standardQuantity.toString(),
        unit: line.unit,
        standardShrinkagePct: line.standardShrinkagePct?.toString(),
      })),
    }));
  }

  /**
   * One active BOM per product, no versioning in P0 (PRD F21).
   *
   * Upsert rather than create: a factory correcting a recipe should not have to
   * find and delete the old one first. Historical variance is unaffected —
   * material requests copy the standard at the moment they are raised rather
   * than linking to the recipe, so fixing a recipe today cannot change last
   * month's report (Tech Stack §2.8c).
   */
  @Post('boms')
  @Write()
  @Requires('bom.write')
  async upsertBom(@ZodBody(BomInput) body: z.infer<typeof BomInput>) {
    const actor = requireActor();

    if (body.lines.some((line) => line.productId === body.productId)) {
      throw new AppError('VALIDATION_FAILED', 'A product cannot be an ingredient of itself');
    }

    const existing = await this.prisma.client().bom.findFirst({ where: { productId: body.productId } });
    const id = existing?.id ?? uuidv7();

    if (existing) {
      await this.prisma.client().bom.updateMany({
        where: { id },
        data: {
          outputQuantity: toPrismaDecimal(body.outputQuantity),
          outputUnit: body.outputUnit,
          verified: body.verified,
        },
      });
      await this.prisma.client().bomLine.deleteMany({ where: { bomId: id } });
    } else {
      await this.prisma.client().bom.create({
        data: {
          id,
          tenantId: actor.tenantId,
          productId: body.productId,
          outputQuantity: toPrismaDecimal(body.outputQuantity),
          outputUnit: body.outputUnit,
          verified: body.verified,
        },
      });
    }

    await this.prisma.client().bomLine.createMany({
      data: body.lines.map((line) => ({
        id: uuidv7(),
        tenantId: actor.tenantId,
        bomId: id,
        productId: line.productId,
        standardQuantity: toPrismaDecimal(line.standardQuantity),
        unit: line.unit,
        standardShrinkagePct: line.standardShrinkagePct
          ? toPrismaDecimal(line.standardShrinkagePct)
          : null,
      })),
    });

    await audit(this.prisma, {
      action: existing ? 'bom.updated' : 'bom.created',
      subject: 'bom',
      subjectId: id,
      after: { productId: body.productId, lines: body.lines.length, verified: body.verified },
    });

    return { id };
  }

  /**
   * Marking a recipe as checked by a human.
   *
   * Separate from editing on purpose. `verified` travels with the variance
   * report (K12): variance measured against a recipe nobody has confirmed is
   * not yet actionable, and PRD §12 requires that to be visible rather than
   * presented as though it were sound.
   */
  @Post('boms/:id/verify')
  @Write()
  @Requires('bom.write')
  async verifyBom(@Param('id') id: string) {
    const updated = await this.prisma
      .client()
      .bom.updateMany({ where: { id }, data: { verified: true } });
    if (updated.count === 0) throw new AppError('NOT_FOUND', 'Recipe not found');
    await audit(this.prisma, { action: 'bom.verified', subject: 'bom', subjectId: id });
    return { ok: true };
  }

  private async nextPoNo(): Promise<string> {
    const count = await this.prisma.client().purchaseOrder.count();
    const year = new Date().getFullYear();
    return `PO-${year}-${String(count + 1).padStart(4, '0')}`;
  }
}
