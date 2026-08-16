import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AppError, type ErrorBody, type ErrorCode } from './errors.js';
import { log } from './logger.js';
import { currentContext } from './request-context.js';

/**
 * One place that turns a thrown thing into the envelope in `errors.ts`.
 *
 * An unhandled exception becomes `INTERNAL` with a deliberately bland message.
 * The detail goes to the log, where support can read it, and not to the
 * warehouse phone, where it would be a stack trace on a screen somebody is
 * holding with gloves on.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const requestId = currentContext()?.requestId;

    if (exception instanceof AppError) {
      // Expected outcomes — a locked OTP, a stale cursor. Not incidents.
      log().info({ code: exception.code }, exception.message);
      void reply.status(exception.getStatus()).send(exception.toBody(requestId));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ErrorCode =
        status === HttpStatus.NOT_FOUND
          ? 'NOT_FOUND'
          : status === HttpStatus.UNAUTHORIZED
            ? 'UNAUTHENTICATED'
            : status === HttpStatus.FORBIDDEN
              ? 'FORBIDDEN'
              : 'VALIDATION_FAILED';
      const body: ErrorBody = {
        error: { code, message: exception.message, requestId, retryable: false },
      };
      void reply.status(status).send(body);
      return;
    }

    log().error({ err: exception }, 'Unhandled exception');
    const body: ErrorBody = {
      error: {
        code: 'INTERNAL',
        message: 'Something went wrong on our side. Your work is still queued on this device.',
        requestId,
        retryable: true,
      },
    };
    void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send(body);
  }
}
