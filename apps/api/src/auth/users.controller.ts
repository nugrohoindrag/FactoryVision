import { Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { Role, uuidv7 } from '@fv/contracts';
import { z } from 'zod';
import { AppError } from '../common/errors.js';
import { requireActor } from '../common/request-context.js';
import { ZodBody } from '../common/zod.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { audit } from '../common/audit.js';
import { Requires, Write } from './public.decorator.js';

/**
 * B-020 — K13 Users & roles.
 *
 * There is no "delete user". A user id appears on every event that person ever
 * wrote, and the movement log is append-only: deleting the row would leave
 * hundreds of movements pointing at somebody who does not exist, and the stock
 * card would show a blank where a name belongs with nothing to say whether that
 * is a bug or simply missing data.
 *
 * So the rule is the same one the master data screens follow: **deactivate,
 * never delete** (UI Plan Sprint 7).
 */

const InviteInput = z.object({
  name: z.string().trim().min(1),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, 'Include the country code, e.g. +6281234567890'),
  role: Role,
});

const UpdateInput = z.object({
  name: z.string().trim().min(1).optional(),
  role: Role.optional(),
  active: z.boolean().optional(),
});

@Controller('users')
export class UsersController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  @Requires('user.manage')
  async list() {
    const users = await this.prisma.client().user.findMany({ orderBy: { name: 'asc' } });
    return users.map((user) => ({
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      active: user.active,
    }));
  }

  @Post()
  @Write()
  @Requires('user.manage')
  async invite(@ZodBody(InviteInput) body: z.infer<typeof InviteInput>) {
    const actor = requireActor();

    // Phone is globally unique: one number is one person. Multi-tenant
    // membership is a Fase 2 problem, and inventing it now would be inventing
    // it wrong.
    const clash = await this.prisma.raw.user.findUnique({ where: { phone: body.phone } });
    if (clash) {
      throw new AppError('CONFLICT', 'That phone number already belongs to an account');
    }

    const id = uuidv7();
    await this.prisma.client().user.create({
      data: { id, tenantId: actor.tenantId, phone: body.phone, name: body.name, role: body.role },
    });

    await audit(this.prisma, {
      action: 'user.invited',
      subject: 'user',
      subjectId: id,
      after: { name: body.name, role: body.role },
    });

    // No invitation SMS: the person signs in with their number whenever they
    // first pick up a phone, and the OTP flow does the rest. One less message
    // to pay for and one less thing to expire unread.
    return { id, name: body.name, phone: body.phone, role: body.role, active: true };
  }

  @Patch(':id')
  @Write()
  @Requires('user.manage')
  async update(@Param('id') id: string, @ZodBody(UpdateInput) body: z.infer<typeof UpdateInput>) {
    const actor = requireActor();

    const user = await this.prisma.client().user.findFirst({ where: { id } });
    if (!user) throw new AppError('NOT_FOUND', 'User not found');

    if (user.id === actor.actorId && body.active === false) {
      throw new AppError(
        'CONFLICT',
        'You cannot deactivate your own account — ask another owner to do it',
      );
    }

    if (user.role === 'OWNER' && body.role && body.role !== 'OWNER') {
      const owners = await this.prisma.client().user.count({ where: { role: 'OWNER', active: true } });
      if (owners <= 1) {
        // A factory with no owner has nobody who can approve an adjustment or
        // a stock take. That is not a permissions edge case, it is a warehouse
        // that cannot close its month.
        throw new AppError('CONFLICT', 'This is the only owner — promote someone else first');
      }
    }

    await this.prisma.client().user.updateMany({ where: { id }, data: body });

    await audit(this.prisma, {
      action: body.active === false ? 'user.deactivated' : 'user.updated',
      subject: 'user',
      subjectId: id,
      before: { name: user.name, role: user.role, active: user.active },
      after: body,
    });

    return { ok: true };
  }

  /** Devices this factory has trusted — the other half of B-017. */
  @Get('devices/all')
  @Requires('user.manage')
  async devices() {
    const rows = await this.prisma.client().device.findMany({ orderBy: { lastSeenAt: 'desc' } });
    return rows.map((device) => ({
      id: device.id,
      userId: device.userId,
      label: device.label,
      lastSeenAt: device.lastSeenAt.toISOString(),
      revoked: Boolean(device.revokedAt),
    }));
  }

  @Post('devices/:id/revoke')
  @Write()
  @Requires('user.manage')
  async revokeDevice(@Param('id') id: string) {
    await this.prisma.client().device.updateMany({ where: { id }, data: { revokedAt: new Date() } });
    await this.prisma.client().session.updateMany({
      where: { deviceId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit(this.prisma, { action: 'device.revoked', subject: 'device', subjectId: id });
    return { ok: true };
  }
}
