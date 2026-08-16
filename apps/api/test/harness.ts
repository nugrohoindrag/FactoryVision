import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { uuidv7 } from '@fv/contracts';
import { buildApp } from '../src/bootstrap.js';
import { RateLimitService } from '../src/common/rate-limit.service.js';
import { setEnvForTesting, loadEnv } from '../src/config/env.js';

/**
 * B-012 — the integration harness.
 *
 * Tests drive the real application through Fastify's `inject()`: the real
 * guards, the real Prisma extension, the real exception filter. A test that
 * exercises a hand-assembled subset of the app proves something about a program
 * nobody deploys.
 *
 * ## When there is no database
 *
 * Every integration file calls `describeIntegration`, which SKIPS with a loud
 * reason instead of failing when `DATABASE_URL` points at nothing. The
 * distinction matters: a developer without Docker running should see "skipped —
 * no database" and get on with their unit tests, while CI — where the container
 * is always there — treats the same skip as a failure via `REQUIRE_DB=1`.
 * Silence in both directions is what lets an integration suite quietly stop
 * running for six months.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://factoryvision:factoryvision@localhost:55432/factoryvision_test?schema=public';

let cachedAvailability: boolean | null = null;

export async function databaseAvailable(): Promise<boolean> {
  if (cachedAvailability !== null) return cachedAvailability;
  const client = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  try {
    await client.$queryRaw`SELECT 1`;
    cachedAvailability = true;
  } catch {
    cachedAvailability = false;
  } finally {
    await client.$disconnect();
  }
  return cachedAvailability;
}

let migrated = false;

/**
 * Applies migrations to the test database. Memoised — every integration file
 * asks, and `migrate deploy` on an up-to-date database still costs a second of
 * process start-up that adds up across a suite.
 *
 * `fileURLToPath` rather than `url.pathname`: on Windows the raw pathname keeps
 * the drive slash AND percent-encodes spaces, so `C:/Users/wanse sejati` comes
 * back as `/C:/Users/wanse%20sejati` and the spawn fails with an ENOENT that
 * blames the shell.
 */
export function migrateTestDatabase(): void {
  if (migrated) return;
  execSync('pnpm exec prisma migrate deploy', {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
  migrated = true;
}

export interface TestApp {
  app: NestFastifyApplication;
  prisma: PrismaClient;
  close(): Promise<void>;
  /** Truncates every table between cases — one clean factory per test. */
  reset(): Promise<void>;
}

export async function startTestApp(): Promise<TestApp> {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ??= 'test-secret-that-is-definitely-long-enough-here';
  process.env.OTP_PROVIDER = 'console';
  process.env.SCHEDULER_ENABLED = 'false';
  setEnvForTesting(loadEnv());

  const app = await buildApp({ NODE_ENV: 'test' });
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

  const reset = async () => {
    // The limiter is in-process, so it survives a truncate. Fifteen tests all
    // registering from 127.0.0.1 would otherwise trip the hourly cap halfway
    // through the file — and the failure would look like a bug in registration.
    app.get(RateLimitService).resetAll();

    // Order does not matter with CASCADE, and listing tables by hand would rot
    // the moment a model is added.
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    if (tables.length === 0) return;
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  };

  return {
    app,
    prisma,
    reset,
    close: async () => {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

/* --- fixtures ------------------------------------------------------------- */

export interface SeededTenant {
  tenantId: string;
  ownerId: string;
  deviceId: string;
  accessToken: string;
  auth: { authorization: string };
}

/**
 * Registers a factory through the real endpoint rather than inserting rows.
 *
 * Seeding straight into the database would skip the code under test and let a
 * broken registration pass every other suite.
 */
export async function seedTenant(
  test: TestApp,
  overrides: { factoryName?: string; phone?: string } = {},
): Promise<SeededTenant> {
  const deviceId = crypto.randomUUID();
  const response = await test.app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      factoryName: overrides.factoryName ?? 'Pabrik Uji',
      ownerName: 'Bu Sri',
      phone: overrides.phone ?? `+6281${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
      deviceId,
      deviceLabel: 'test device',
    },
  });

  if (response.statusCode !== 201 && response.statusCode !== 200) {
    throw new Error(`seedTenant failed: ${response.statusCode} ${response.body}`);
  }

  const body = response.json() as {
    accessToken: string;
    user: { id: string; tenantId: string };
  };

  return {
    tenantId: body.user.tenantId,
    ownerId: body.user.id,
    deviceId,
    accessToken: body.accessToken,
    auth: { authorization: `Bearer ${body.accessToken}` },
  };
}

/** A second user in the same factory, at whatever role the test needs. */
export async function addUser(
  test: TestApp,
  tenant: SeededTenant,
  role: 'OPERATOR' | 'PRODUCTION' | 'QC' | 'WAREHOUSE_HEAD' | 'OWNER',
): Promise<{ userId: string; deviceId: string; auth: { authorization: string } }> {
  const phone = `+6282${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const invited = await test.app.inject({
    method: 'POST',
    url: '/users',
    headers: tenant.auth,
    payload: { name: `User ${role}`, phone, role },
  });
  if (invited.statusCode >= 400) throw new Error(`addUser failed: ${invited.body}`);
  const { id } = invited.json() as { id: string };

  const deviceId = crypto.randomUUID();
  await test.app.inject({ method: 'POST', url: '/auth/otp/request', payload: { phone } });

  // The console provider does not send anything, so the code is read straight
  // from the row. This is the only place a test reaches past the API, and it is
  // reaching for something an SMS would otherwise carry.
  const otp = await test.prisma.otpRequest.findFirst({
    where: { phone, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp) throw new Error('no OTP issued');

  const code = await bruteForceCode(phone, otp.codeHash);
  const verified = await test.app.inject({
    method: 'POST',
    url: '/auth/otp/verify',
    payload: { phone, code, deviceId },
  });
  if (verified.statusCode >= 400) throw new Error(`otp verify failed: ${verified.body}`);

  const body = verified.json() as { accessToken: string };
  return { userId: id, deviceId, auth: { authorization: `Bearer ${body.accessToken}` } };
}

/**
 * Recovers the six digits from the stored hash.
 *
 * A million SHA-256s is under a second and it keeps the OTP one-way in the
 * database — the alternative is a test-only endpoint that returns the code,
 * which is a production liability created to make a test convenient.
 */
async function bruteForceCode(phone: string, codeHash: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  for (let i = 0; i < 1_000_000; i += 1) {
    const candidate = String(i).padStart(6, '0');
    const hash = createHash('sha256').update(`${phone}:${candidate}`).digest('hex');
    if (hash === codeHash) return candidate;
  }
  throw new Error('could not recover OTP');
}

export const newId = () => uuidv7();
