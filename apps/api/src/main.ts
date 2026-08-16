import { buildApp } from './bootstrap.js';
import { log } from './common/logger.js';
import { env } from './config/env.js';

/**
 * B-002 in practice: configuration is validated on the first line, so a missing
 * setting stops the process before it serves anything. A server that boots
 * green and then fails one endpoint at 06:10 on the morning shift is a worse
 * outcome than one that refuses to start at 06:00 — the second is a deployment
 * problem, the first is an operator standing next to a truck.
 */
async function main(): Promise<void> {
  const config = env();
  const app = await buildApp();

  await app.listen({ port: config.PORT, host: config.HOST });
  log().info({ port: config.PORT, env: config.NODE_ENV }, 'FactoryVision API listening');

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      log().info({ signal }, 'Shutting down');
      void app.close().then(() => process.exit(0));
    });
  }
}

main().catch((error: unknown) => {
  // No logger here on purpose: if configuration failed to parse, the logger
  // itself could not be constructed either.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
