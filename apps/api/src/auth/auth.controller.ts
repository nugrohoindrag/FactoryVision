import { Controller, Get, Inject, Post } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Req } from '../common/http.js';
import { currentContext, requireActor } from '../common/request-context.js';
import { LIMITS, RateLimitService } from '../common/rate-limit.service.js';
import { ZodBody } from '../common/zod.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantService } from '../tenant/tenant.service.js';
import { AuthService, type SessionResult } from './auth.service.js';
import { Public } from './public.decorator.js';

/**
 * L01 Sign in, plus register (UI Spec §24).
 *
 * Phone number, six digits, no password anywhere in the product.
 *
 * The rate limits live here rather than in the service because they answer a
 * different question. The service's lockout — three wrong codes, then fifteen
 * minutes — protects ONE ACCOUNT from being guessed. These protect the ENDPOINT
 * from being walked: somebody trying a thousand numbers to find which ones
 * exist. Two different attacks, so two different counters.
 */

/** E.164. `+62` is fixed in the UI; this is the wire format behind it. */
const Phone = z
  .string()
  .trim()
  .regex(
    /^\+[1-9]\d{7,14}$/,
    'Enter a phone number including the country code, e.g. +6281234567890',
  );

const RegisterInput = z.object({
  factoryName: z.string().trim().min(1, 'What is the factory called?'),
  ownerName: z.string().trim().min(1, 'Who owns it?'),
  phone: Phone,
  deviceId: z.string().uuid(),
  deviceLabel: z.string().max(120).optional(),
});

const RequestOtpInput = z.object({ phone: Phone });

const VerifyOtpInput = z.object({
  phone: Phone,
  code: z.string().regex(/^\d{6}$/, 'The code is six digits'),
  deviceId: z.string().uuid(),
  deviceLabel: z.string().max(120).optional(),
});

const RefreshInput = z.object({ refreshToken: z.string().min(10) });

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(TenantService) private readonly tenants: TenantService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  /**
   * B-013 — three fields, then straight into the app.
   *
   * Registration signs you in as part of the same request. Asking somebody to
   * register and then go find a second SMS is two chances to walk away from a
   * product they have not seen working yet.
   */
  @Public()
  @Post('register')
  async register(
    @ZodBody(RegisterInput) body: z.infer<typeof RegisterInput>,
    @Req() request: FastifyRequest,
  ): Promise<SessionResult> {
    this.limits.hit(`register:${request.ip}`, LIMITS.register);

    const { tenantId, userId } = await this.tenants.createTenant(body);

    await this.prisma.raw.device.create({
      data: { id: body.deviceId, tenantId, userId, label: body.deviceLabel ?? '' },
    });

    return this.auth.issueSession(userId, tenantId, 'OWNER', body.ownerName, body.deviceId);
  }

  @Public()
  @Post('otp/request')
  async requestOtp(
    @ZodBody(RequestOtpInput) body: z.infer<typeof RequestOtpInput>,
    @Req() request: FastifyRequest,
  ): Promise<{ sent: true; expiresInSeconds: number }> {
    this.limits.hit(`otp:phone:${body.phone}`, LIMITS.otpRequest);
    this.limits.hit(`otp:ip:${request.ip}`, LIMITS.otpRequest);
    return this.auth.requestOtp(body.phone);
  }

  @Public()
  @Post('otp/verify')
  async verifyOtp(
    @ZodBody(VerifyOtpInput) body: z.infer<typeof VerifyOtpInput>,
    @Req() request: FastifyRequest,
  ): Promise<SessionResult> {
    this.limits.hit(`otpv:ip:${request.ip}`, LIMITS.otpVerify);
    const session = await this.auth.verifyOtp(body);
    // They proved they are real. The counter should not go on punishing the
    // next operator signing in from the same factory wifi.
    this.limits.clear(`otpv:ip:${request.ip}`);
    this.limits.clear(`otp:phone:${body.phone}`);
    return session;
  }

  @Public()
  @Post('refresh')
  async refresh(@ZodBody(RefreshInput) body: z.infer<typeof RefreshInput>): Promise<SessionResult> {
    return this.auth.refresh(body.refreshToken);
  }

  /** Who am I, and is my factory's subscription still live. */
  @Get('me')
  async me(): Promise<{
    user: { id: string; role: string };
    tenant: { id: string; readOnly: boolean };
  }> {
    const actor = requireActor();
    const readOnly = await this.tenants.isReadOnly(actor.tenantId);
    return {
      user: { id: actor.actorId, role: actor.actorRole },
      tenant: { id: actor.tenantId, readOnly },
    };
  }

  /**
   * Signs out THIS session only.
   *
   * An operator signing out of the shared tablet at the receiving desk must not
   * find themselves signed out of their own phone at the same time — and with
   * sixty-day sessions, that mistake would cost them an SMS and a truck's wait.
   */
  @Post('sign-out')
  async signOut(): Promise<{ ok: true }> {
    const sessionId = currentContext()?.sessionId;
    if (sessionId) await this.auth.revoke(sessionId);
    return { ok: true };
  }
}
