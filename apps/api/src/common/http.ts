import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/**
 * `@Req()` without pulling in Nest's decorator set.
 *
 * Nest's own `@Req()` is fine, but the ones next to it (`@Body()`, `@Param()`)
 * lead straight back to `class-validator` and `design:paramtypes`, which this
 * codebase deliberately does without (see tsconfig.json). One small decorator
 * keeps that boundary visible.
 */
export const Req = () =>
  createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<FastifyRequest>(),
  )();

/**
 * There is deliberately no `Res()` here.
 *
 * File exports need Nest's own `@Res()`: taking the reply object switches the
 * route into library-specific mode, and only Nest's decorator carries the
 * metadata that tells it to stop managing the response. A look-alike built with
 * `createParamDecorator` hands over the object without handing over the
 * responsibility, and the request hangs until it times out.
 */

/** The caller's IP, honouring a proxy header only when one is configured. */
export function clientIp(request: FastifyRequest): string {
  return request.ip;
}
