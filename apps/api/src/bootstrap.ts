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

  /**
   * Everything the API serves lives under `/api`, so that `/` can belong to the
   * PWA when both are deployed behind one hostname — which is what Hostinger's
   * single Node deployment requires.
   *
   * Without this the two collide at the root and the SPA fallback has to carry
   * a hand-maintained list of API prefixes, quietly swallowing the first
   * controller somebody adds without updating it.
   *
   * `health` and `ready` stay where they are. They are for uptime probes, not
   * for the product, and a probe URL that moves is a monitor that lies.
   */
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] });

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

  /**
   * Serve the PWA from this process too, when asked to.
   *
   * Hostinger's shared hosting runs ONE Node application per deployment, so
   * shipping the frontend and the backend together means the backend hands out
   * the frontend's files. Unset `WEB_ROOT` and none of this is registered — the
   * process stays an API, which is what the tests and any split deployment get.
   *
   * `wildcard: false` matters: with it on, the plugin claims `/*` and answers
   * every unmatched route itself, including `/api/...` typos that should be a
   * JSON 404. Off, it serves only paths that exist on disk and leaves the rest
   * to the handler below.
   */
  if (config.WEB_ROOT) {
    const fastifyStatic = (await import('@fastify/static')).default;
    await app.register(fastifyStatic, { root: config.WEB_ROOT, wildcard: false });

    /**
     * The SPA fallback, and the one rule it must never break: an unknown
     * `/api/...` path is a 404, not an HTML page.
     *
     * A fallback that returns index.html for everything turns every mistyped
     * endpoint and every call made after a route is renamed into "200 OK" with
     * a body of HTML. The client then fails while parsing JSON, several layers
     * away from the actual cause. Deep-linking the PWA is worth a lot; that is
     * worth more.
     *
     * A catch-all ROUTE, not `setNotFoundHandler`: Nest's Fastify adapter
     * installs its own not-found handler during `init()`, and Fastify allows
     * exactly one per prefix — setting ours first made Nest's registration
     * throw `Not found handler already set` and the process exited before it
     * ever listened. A wildcard route sidesteps that entirely, and Fastify's
     * router still prefers every specific route over it, so nothing that Nest
     * maps is shadowed.
     */
    fastify.get('/*', (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: `No route for ${request.method} ${request.url}` },
        });
      }
      return reply.sendFile('index.html');
    });
  }

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
