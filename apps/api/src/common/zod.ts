import {
  createParamDecorator,
  type ArgumentMetadata,
  type ExecutionContext,
  type PipeTransform,
} from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { AppError } from './errors.js';

/**
 * B-005 — validation reads its schemas from `@fv/contracts`.
 *
 * There is no DTO layer here, and its absence is the point. The client already
 * validates every event and every master record against those exact schemas
 * before writing them to Dexie. A second set of server-side DTOs would be a
 * second definition of the same truth, and the two would disagree on the first
 * change — with the server accepting something the client can never send, or
 * rejecting something it already stored locally and considers done.
 *
 * The cost of doing it this way is that Nest's own `ValidationPipe`,
 * `class-validator` and `class-transformer` are unused. That is a saving, not
 * a loss: those three read `design:paramtypes`, which is the compiler feature
 * deliberately switched off in tsconfig.json.
 */

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new AppError(
      'VALIDATION_FAILED',
      'The request does not match what this endpoint accepts',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
}

/** `@ZodBody(PurchaseOrder)` — parses and narrows in one step, no DTO class. */
export const ZodBody = <T>(schema: ZodSchema<T>) =>
  createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ body: unknown }>();
    return new ZodPipe(schema).transform(request.body, { type: 'body' });
  })();

/** Same for query strings, which arrive as strings and need coercion in-schema. */
export const ZodQuery = <T>(schema: ZodSchema<T>) =>
  createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ query: unknown }>();
    return new ZodPipe(schema).transform(request.query, { type: 'query' });
  })();
