import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { AppExceptionFilter } from './common/exception.filter.js';
import { enterContext } from './common/request-context.js';
import { env, type Env } from './config/env.js';

/**
 * Builds the application without listening.
 *
 * Split from `main.ts` so tests boot the identical stack — same guards, same
 * filter, same request context — and drive it through Fastify's `inject()`
 * rather than a real socket. An integration test that exercises a
 * hand-assembled subset of the app is a test of something nobody deploys.
 */
export async function buildApp(overrides: Partial<Env> = {}): Promise<NestFastifyApplication> {
  const config = { ...env(), ...overrides };

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(overrides),
    new FastifyAdapter({
      bodyLimit: config.SYNC_MAX_BODY_BYTES,
      // Trust the proxy in production only. Trusting it in development would
      // let anything set `x-forwarded-for` and walk straight past the per-IP
      // OTP limit.
      trustProxy: config.NODE_ENV === 'production',
    }),
    { logger: config.NODE_ENV === 'test' ? false : ['error', 'warn', 'log'] },
  );

  const fastify = app.getHttpAdapter().getInstance();

  /**
   * The request context is established before anything else runs.
   *
   * `enterWith` rather than `run` because a Fastify hook returns before the
   * handler executes — `run` would close the scope at exactly the wrong moment.
   */
  fastify.addHook('onRequest', (request, reply, done) => {
    const requestId = (request.headers['x-request-id'] as string | undefined) ?? randomUUID();
    enterContext({
      requestId,
      tenantId: null,
      actorId: null,
      actorRole: null,
      deviceId: null,
      sessionId: null,
      readOnly: false,
    });
    void reply.header('x-request-id', requestId);
    done();
  });

  /**
   * B-082 — security headers, set here rather than assumed from a proxy.
   *
   * This API serves JSON to one PWA and nothing else: no framing, no sniffing,
   * no referrer. HSTS is left to the edge, which is the only layer that knows
   * whether TLS actually terminates there.
   */
  fastify.addHook('onSend', (_request, reply, payload, done) => {
    void reply.header('x-content-type-options', 'nosniff');
    void reply.header('x-frame-options', 'DENY');
    void reply.header('referrer-policy', 'no-referrer');
    done(null, payload);
  });

  app.useGlobalFilters(new AppExceptionFilter());
  app.enableCors({
    origin: true,
    credentials: true,
    // The device id travels as a header on sync so the server can tell two
    // phones apart before it has parsed a body.
    allowedHeaders: ['authorization', 'content-type', 'x-device-id', 'x-request-id'],
  });

  await app.init();
  return app;
}
