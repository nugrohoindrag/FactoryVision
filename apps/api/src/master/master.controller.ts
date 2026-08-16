import { Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { ItemClass, uuidv7 } from '@fv/contracts';
import { z } from 'zod';
import { Requires, Write } from '../auth/public.decorator.js';
import { audit } from '../common/audit.js';
import { toPrismaDecimal } from '../common/decimal.js';
import { AppError } from '../common/errors.js';
import { requireActor } from '../common/request-context.js';
import { ZodBody } from '../common/zod.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MasterService, type ImportProductRow } from './master.service.js';

/**
 * B-049 → B-059 — the master data screens (K03, K04, K05) behind an API.
 *
 * Everything here is desk work: it needs a signal, it happens at the office,
 * and it is not in the path of an operator with a truck at the door. That is
 * why these are plain CRUD endpoints while every warehouse movement goes
 * through the event log instead.
 *
 * The one rule repeated in every handler: **deactivate, never delete.**
 */

const Decimal = z.string().regex(/^-?\d+(\.\d+)?$/);

const UnitConversionInput = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  factor: Decimal,
});

const ProductInput = z.object({
  sku: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  itemClass: ItemClass,
  baseUnit: z.string().trim().min(1),
  conversions: z.array(UnitConversionInput).default([]),
  shelfLifeDays: z.number().int().nonnegative().optional(),
  minimumStock: Decimal.optional(),
  averageCost: Decimal.optional(),
});

const LocationInput = z.object({
  code: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  parentId: z.string().uuid().nullable().default(null),
  /**
   * Asked once and stored, never inferred from being a leaf. Receiving,
   * quarantine and reject areas all hold stock while sitting in the middle of
   * the tree — the case the old "deepest level holds stock" rule hid (PRD v1.4).
   */
  storable: z.boolean(),
  virtual: z.boolean().default(false),
});

const PartnerInput = z.object({
  code: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  kind: z.enum(['SUPPLIER', 'CUSTOMER', 'BOTH']).default('SUPPLIER'),
  phone: z.string().optional(),
});

const ProductionLocationInput = z.object({
  code: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  parentId: z.string().uuid().nullable().default(null),
  level: z.enum(['LINE', 'MACHINE', 'AREA']),
});

@Controller('master')
export class MasterController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MasterService) private readonly master: MasterService,
  ) {}

  /* --- products (K03) ---------------------------------------------------- */

  @Get('products')
  async listProducts() {
    const rows = await this.prisma.client().product.findMany({ orderBy: { name: 'asc' } });
    const canSeePrices = seesPrices();
    return rows.map((row) => ({
      ...row,
      minimumStock: row.minimumStock?.toString(),
      averageCost: canSeePrices ? row.averageCost?.toString() : undefined,
    }));
  }

  @Post('products')
  @Write()
  @Requires('master.write')
  async createProduct(@ZodBody(ProductInput) body: z.infer<typeof ProductInput>) {
    const actor = requireActor();
    this.master.validateConversions(body.baseUnit, body.conversions);

    // Auto code when blank (PRD F1). A factory that has no SKU scheme should
    // not have to invent one before it can enter its first product.
    const sku = body.sku ?? (await this.nextSku());

    const clash = await this.prisma.client().product.findFirst({ where: { sku } });
    if (clash) throw new AppError('CONFLICT', `SKU ${sku} is already used`);

    const id = uuidv7();
    await this.prisma.client().product.create({
      data: {
        id,
        tenantId: actor.tenantId,
        sku,
        name: body.name,
        itemClass: body.itemClass,
        baseUnit: body.baseUnit,
        conversions: body.conversions as object,
        shelfLifeDays: body.shelfLifeDays ?? null,
        minimumStock: body.minimumStock ? toPrismaDecimal(body.minimumStock) : null,
        averageCost: body.averageCost ? toPrismaDecimal(body.averageCost) : null,
      },
    });

    await audit(this.prisma, { action: 'product.created', subject: 'product', subjectId: id, after: body });
    return { id, sku };
  }

  @Patch('products/:id')
  @Write()
  @Requires('master.write')
  async updateProduct(
    @Param('id') id: string,
    @ZodBody(ProductInput.partial()) body: Partial<z.infer<typeof ProductInput>>,
  ) {
    const before = await this.prisma.client().product.findFirst({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND', 'Product not found');

    if (body.conversions) {
      this.master.validateConversions(body.baseUnit ?? before.baseUnit, body.conversions);
    }

    await this.prisma.client().product.updateMany({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.itemClass ? { itemClass: body.itemClass } : {}),
        ...(body.baseUnit ? { baseUnit: body.baseUnit } : {}),
        ...(body.conversions ? { conversions: body.conversions as object } : {}),
        ...(body.shelfLifeDays !== undefined ? { shelfLifeDays: body.shelfLifeDays } : {}),
        ...(body.minimumStock ? { minimumStock: toPrismaDecimal(body.minimumStock) } : {}),
        ...(body.averageCost ? { averageCost: toPrismaDecimal(body.averageCost) } : {}),
      },
    });

    await audit(this.prisma, {
      action: 'product.updated',
      subject: 'product',
      subjectId: id,
      before: { name: before.name, baseUnit: before.baseUnit },
      after: body,
    });
    return { ok: true };
  }

  @Post('products/:id/deactivate')
  @Write()
  @Requires('master.deactivate')
  async deactivateProduct(@Param('id') id: string) {
    await this.master.deactivate('product', id);
    return { ok: true };
  }

  /* --- locations (K04) --------------------------------------------------- */

  @Get('locations')
  async listLocations() {
    return this.prisma.client().location.findMany({ orderBy: [{ depth: 'asc' }, { code: 'asc' }] });
  }

  @Post('locations')
  @Write()
  @Requires('master.write')
  async createLocation(@ZodBody(LocationInput) body: z.infer<typeof LocationInput>) {
    const actor = requireActor();
    // Depth follows the parent and is never typed — a rack at depth 0 inside a
    // warehouse at depth 2 renders a tree nobody can navigate.
    const depth = await this.master.depthFor(body.parentId);
    const code = body.code ?? (await this.nextCode('location', 'LOC'));

    const clash = await this.prisma.client().location.findFirst({ where: { code } });
    if (clash) throw new AppError('CONFLICT', `Location code ${code} is already used`);

    const id = uuidv7();
    await this.prisma.client().location.create({
      data: {
        id,
        tenantId: actor.tenantId,
        code,
        name: body.name,
        parentId: body.parentId,
        depth,
        storable: body.storable,
        virtual: body.virtual,
      },
    });

    await audit(this.prisma, { action: 'location.created', subject: 'location', subjectId: id, after: { ...body, depth } });
    return { id, code, depth };
  }

  @Patch('locations/:id')
  @Write()
  @Requires('master.write')
  async updateLocation(
    @Param('id') id: string,
    @ZodBody(LocationInput.partial()) body: Partial<z.infer<typeof LocationInput>>,
  ) {
    const before = await this.prisma.client().location.findFirst({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND', 'Location not found');

    let depth = before.depth;
    if (body.parentId !== undefined && body.parentId !== before.parentId) {
      await this.master.assertNoCycle(id, body.parentId);
      depth = await this.master.depthFor(body.parentId);

      // Moving a branch moves everything under it. Leaving descendants at their
      // old depth would put a rack above the zone that contains it.
      const descendants = await this.descendantsOf(id);
      const shift = depth - before.depth;
      for (const child of descendants) {
        await this.prisma
          .client()
          .location.updateMany({ where: { id: child.id }, data: { depth: child.depth + shift } });
      }
    }

    await this.prisma.client().location.updateMany({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId, depth } : {}),
        ...(body.storable !== undefined ? { storable: body.storable } : {}),
      },
    });

    await audit(this.prisma, {
      action: 'location.updated',
      subject: 'location',
      subjectId: id,
      before: { name: before.name, depth: before.depth, storable: before.storable },
      after: body,
    });
    return { ok: true };
  }

  @Post('locations/:id/deactivate')
  @Write()
  @Requires('master.deactivate')
  async deactivateLocation(@Param('id') id: string) {
    await this.master.deactivate('location', id);
    return { ok: true };
  }

  /* --- partners (K05) ---------------------------------------------------- */

  @Get('partners')
  async listPartners() {
    return this.prisma.client().partner.findMany({ orderBy: { name: 'asc' } });
  }

  @Post('partners')
  @Write()
  @Requires('master.write')
  async createPartner(@ZodBody(PartnerInput) body: z.infer<typeof PartnerInput>) {
    const actor = requireActor();
    const code = body.code ?? (await this.nextCode('partner', 'P'));
    const id = uuidv7();

    await this.prisma.client().partner.create({
      data: { id, tenantId: actor.tenantId, code, name: body.name, kind: body.kind, phone: body.phone },
    });

    await audit(this.prisma, { action: 'partner.created', subject: 'partner', subjectId: id, after: body });
    return { id, code };
  }

  @Patch('partners/:id')
  @Write()
  @Requires('master.write')
  async updatePartner(
    @Param('id') id: string,
    @ZodBody(PartnerInput.partial()) body: Partial<z.infer<typeof PartnerInput>>,
  ) {
    const updated = await this.prisma.client().partner.updateMany({ where: { id }, data: body });
    if (updated.count === 0) throw new AppError('NOT_FOUND', 'Partner not found');
    await audit(this.prisma, { action: 'partner.updated', subject: 'partner', subjectId: id, after: body });
    return { ok: true };
  }

  @Post('partners/:id/deactivate')
  @Write()
  @Requires('master.deactivate')
  async deactivatePartner(@Param('id') id: string) {
    await this.master.deactivate('partner', id);
    return { ok: true };
  }

  /* --- production locations (B-053) -------------------------------------- */

  @Get('production-locations')
  async listProductionLocations() {
    return this.prisma.client().productionLocation.findMany({ orderBy: { code: 'asc' } });
  }

  @Post('production-locations')
  @Write()
  @Requires('master.write')
  async createProductionLocation(
    @ZodBody(ProductionLocationInput) body: z.infer<typeof ProductionLocationInput>,
  ) {
    const actor = requireActor();

    if (body.level === 'LINE' && body.parentId) {
      throw new AppError('VALIDATION_FAILED', 'A production line sits at the top — it has no parent');
    }
    if (body.level !== 'LINE' && !body.parentId) {
      // A machine with no line is a machine that cannot be reported on per lane,
      // which is the entire reason production locations are an entity (PRD §9.3).
      throw new AppError('VALIDATION_FAILED', 'A machine or area has to belong to a line');
    }

    const code = body.code ?? (await this.nextCode('productionLocation', 'LN'));
    const id = uuidv7();

    await this.prisma.client().productionLocation.create({
      data: {
        id,
        tenantId: actor.tenantId,
        code,
        name: body.name,
        parentId: body.parentId,
        level: body.level,
      },
    });

    await audit(this.prisma, {
      action: 'productionLocation.created',
      subject: 'productionLocation',
      subjectId: id,
      after: body,
    });
    return { id, code };
  }

  @Post('production-locations/:id/deactivate')
  @Write()
  @Requires('master.deactivate')
  async deactivateProductionLocation(@Param('id') id: string) {
    await this.master.deactivate('productionLocation', id);
    return { ok: true };
  }

  /* --- B-059 bulk import ------------------------------------------------- */

  @Post('import/products')
  @Write()
  @Requires('import.run')
  async importProducts(
    @ZodBody(
      z.object({
        rows: z.array(
          z.object({
            sku: z.string().min(1),
            name: z.string().min(1),
            itemClass: ItemClass,
            baseUnit: z.string().min(1),
            conversions: z.array(UnitConversionInput).optional(),
            shelfLifeDays: z.number().int().nonnegative().optional(),
            minimumStock: Decimal.optional(),
            averageCost: Decimal.optional(),
          }),
        ),
      }),
    )
    body: { rows: ImportProductRow[] },
  ) {
    return this.master.importProducts(body.rows);
  }

  /* --- helpers ----------------------------------------------------------- */

  private async nextSku(): Promise<string> {
    const count = await this.prisma.client().product.count();
    return `SKU-${String(count + 1).padStart(4, '0')}`;
  }

  private async nextCode(
    kind: 'location' | 'partner' | 'productionLocation',
    prefix: string,
  ): Promise<string> {
    const client = this.prisma.client();
    const count = await (
      { location: client.location, partner: client.partner, productionLocation: client.productionLocation }[
        kind
      ] as { count: () => Promise<number> }
    ).count();
    return `${prefix}-${String(count + 1).padStart(3, '0')}`;
  }

  private async descendantsOf(id: string): Promise<{ id: string; depth: number }[]> {
    const all = await this.prisma.client().location.findMany({
      select: { id: true, parentId: true, depth: true },
    });
    const out: { id: string; depth: number }[] = [];
    const walk = (parentId: string) => {
      for (const row of all) {
        if (row.parentId === parentId) {
          out.push({ id: row.id, depth: row.depth });
          walk(row.id);
        }
      }
    };
    walk(id);
    return out;
  }
}

function seesPrices(): boolean {
  const role = requireActor().actorRole;
  return role === 'OWNER' || role === 'WAREHOUSE_HEAD';
}
