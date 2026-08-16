import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../common/errors.js';
import { updateContext } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantService } from '../tenant/tenant.service.js';
import { can, type Permission } from './permissions.js';
import { PERMISSION_KEY, PUBLIC_KEY, WRITE_KEY } from './public.decorator.js';
import { TokensService } from './tokens.service.js';

/**
 * The single gate. Four checks, in the order that gives the clearest answer:
 *
 * 1. **Is this route public?** Four routes are, and each says so out loud.
 * 2. **Is the token valid, and is the session still alive?** The token alone is
 *    not enough — a revoked session must stop working before its access token
 *    expires, or "sign this device out" means "in an hour".
 * 3. **Does the role permit this action?** On the action, never the screen.
 * 4. **Is the tenant read-only?** Trial over → reads keep working, writes stop.
 *    That ordering is deliberate: a factory whose trial lapsed should be told
 *    it lapsed, not told it is forbidden.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantService) private readonly tenants: TenantService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [handler, controller]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('UNAUTHENTICATED', 'Sign in to continue');
    }

    const claims = await this.tokens.verifyAccess(header.slice('Bearer '.length));

    /**
     * Device before session, and the order is the whole point.
     *
     * Revoking a device also revokes its sessions, so both checks would fire.
     * `SESSION_EXPIRED` tells the operator to sign in again — which they will
     * do, at the receiving door, and it will fail, because the device is
     * revoked. `DEVICE_UNKNOWN` tells them the truth the first time: this phone
     * is not allowed any more, go ask your warehouse head. One of those two
     * messages saves a shift.
     */
    const device = await this.prisma.raw.device.findUnique({ where: { id: claims.deviceId } });
    if (!device || device.revokedAt) {
      throw new AppError(
        'DEVICE_UNKNOWN',
        'This device is no longer allowed to sync. Ask your warehouse head to allow it again.',
      );
    }

    const session = await this.prisma.raw.session.findUnique({ where: { id: claims.sessionId } });
    if (!session || session.revokedAt) {
      throw new AppError('SESSION_EXPIRED', 'This device was signed out. Sign in again.');
    }

    const readOnly = await this.tenants.isReadOnly(claims.tenantId);

    updateContext({
      tenantId: claims.tenantId,
      actorId: claims.sub,
      actorRole: claims.role,
      deviceId: claims.deviceId,
      sessionId: claims.sessionId,
      readOnly,
    });

    const permission = this.reflector.getAllAndOverride<Permission>(PERMISSION_KEY, [
      handler,
      controller,
    ]);
    if (permission && !can(claims.role, permission)) {
      throw new AppError(
        'ROLE_NOT_PERMITTED',
        `Your role (${claims.role.toLowerCase().replace('_', ' ')}) cannot do this`,
        { permission },
      );
    }

    const isWrite = this.reflector.getAllAndOverride<boolean>(WRITE_KEY, [handler, controller]);
    if (isWrite && readOnly) {
      throw new AppError(
        'TRIAL_READ_ONLY',
        'Your trial has ended. Your data is all still here and you can read and export it — ' +
          'adding new records needs a subscription.',
      );
    }

    return true;
  }
}
