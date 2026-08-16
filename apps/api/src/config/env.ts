import { z } from 'zod';

/**
 * B-002 — configuration validated once, at boot.
 *
 * The rule this file exists to enforce: a missing setting stops the process
 * BEFORE it starts serving, never at the first request that happens to need it.
 * A server that boots green and then fails one endpoint at 06:10 on the morning
 * shift is worse than one that refuses to start at 06:00 — the second is a
 * deployment problem, the first is an operator standing at a truck.
 *
 * Optional blocks (storage, push, OTP) are the exception, and they are optional
 * on purpose: the product is meant to run in development and in tests without
 * an S3 bucket or an SMS contract. Each feature checks its own block and says
 * plainly that it is not configured (see `requireStorageEnv`, `requirePushEnv`).
 * Nothing pretends to work.
 */

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HOST: z.string().default('0.0.0.0'),

  /** BP-01 → PostgreSQL from the start. See docs/Backend-Development-Plan.md §2. */
  DATABASE_URL: z.string().min(1),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /* --- sessions (B-016) ------------------------------------------------- */
  /**
   * Symmetric secret for access/refresh tokens. Rotated by adding a new value
   * and keeping the old one in `JWT_SECRET_PREVIOUS` until every session has
   * aged out — long sessions (PRD F13.1) mean rotation takes weeks, not hours.
   */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_SECRET_PREVIOUS: z.string().min(32).optional(),
  /** Short by design: a stolen access token is only useful for this long. */
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  /**
   * 60 days. PRD F13.1: "operator does NOT sign in again every shift". Login
   * friction is the most common reason a warehouse system gets abandoned, and
   * it costs nothing to make the refresh window long when refresh tokens are
   * rotated and revocable.
   */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(60),

  /* --- OTP (B-014, B-015) ------------------------------------------------ */
  /**
   * `console` prints the code to the log instead of sending it. Legitimate in
   * development, in tests, and in a demo — never in production, which is why
   * the refinement below rejects it there rather than trusting a checklist.
   */
  OTP_PROVIDER: z.enum(['console', 'http']).default('console'),
  OTP_HTTP_URL: z.string().url().optional(),
  OTP_HTTP_TOKEN: z.string().optional(),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  /** PRD F13.1: 3 failures → wait 15 minutes, with a message that says so. */
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  OTP_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  /* --- object storage (B-061, BP-04) ------------------------------------- */
  STORAGE_ENDPOINT: z.string().url().optional(),
  STORAGE_REGION: z.string().optional(),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_FORCE_PATH_STYLE: bool.default('true'),
  /** 10 MB. A delivery-note photo from a mid-range Android sits well under it. */
  STORAGE_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),

  /* --- web push (B-064) --------------------------------------------------- */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:ops@factoryvision.id'),

  /* --- trial (B-021) ------------------------------------------------------ */
  TRIAL_DAYS: z.coerce.number().int().positive().default(30),

  /* --- scheduler (B-067) --------------------------------------------------- */
  /** Off in tests so a background timer never races an assertion. */
  SCHEDULER_ENABLED: bool.default('true'),
  SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),

  /* --- sync (B-026, B-040, B-046) ------------------------------------------ */
  /** Matches the client's `BATCH_SIZE` in apps/wms/src/db/sync.ts. */
  SYNC_MAX_BATCH: z.coerce.number().int().positive().default(50),
  SYNC_MAX_BODY_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
  SYNC_DOWN_PAGE_SIZE: z.coerce.number().int().positive().default(500),
});

export type Env = z.infer<typeof EnvSchema>;

const refined = EnvSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && env.OTP_PROVIDER === 'console') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['OTP_PROVIDER'],
      message: 'OTP_PROVIDER=console prints login codes to the log — refused in production',
    });
  }
  if (env.OTP_PROVIDER === 'http' && !env.OTP_HTTP_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['OTP_HTTP_URL'],
      message: 'OTP_PROVIDER=http needs OTP_HTTP_URL',
    });
  }
});

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = refined.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Test seam: lets a spec swap configuration without touching `process.env`. */
export function setEnvForTesting(value: Env | null): void {
  cached = value;
}

export const ENV = Symbol('ENV');

export interface StorageEnv {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  maxUploadBytes: number;
}

/**
 * Storage is optional configuration but mandatory capability: a receipt photo
 * that cannot be uploaded is evidence the factory loses. So the check is loud
 * and the message names the missing keys rather than saying "not configured".
 */
export function requireStorageEnv(e: Env = env()): StorageEnv {
  const missing = (
    [
      ['STORAGE_BUCKET', e.STORAGE_BUCKET],
      ['STORAGE_ACCESS_KEY_ID', e.STORAGE_ACCESS_KEY_ID],
      ['STORAGE_SECRET_ACCESS_KEY', e.STORAGE_SECRET_ACCESS_KEY],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Object storage is not configured — missing ${missing.join(', ')}`);
  }

  return {
    endpoint: e.STORAGE_ENDPOINT,
    region: e.STORAGE_REGION ?? 'ap-southeast-3',
    bucket: e.STORAGE_BUCKET!,
    accessKeyId: e.STORAGE_ACCESS_KEY_ID!,
    secretAccessKey: e.STORAGE_SECRET_ACCESS_KEY!,
    forcePathStyle: e.STORAGE_FORCE_PATH_STYLE,
    maxUploadBytes: e.STORAGE_MAX_UPLOAD_BYTES,
  };
}

export function pushConfigured(e: Env = env()): boolean {
  return Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY);
}
