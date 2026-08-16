# `@fv/api` — FactoryVision backend

NestJS (Fastify) + Prisma + MySQL. Implements the whole P0 backend scope of
[Backend Development Plan](../../docs/Backend-Development-Plan.md) — B-001 to B-092.

> **MySQL is temporary.** PostgreSQL is still the destination (BP-01); MySQL is
> what the Hostinger shared-hosting trial offers. The PostgreSQL schema and its
> migrations are preserved on the `postgres-version` branch, and the header of
> [`prisma/schema.prisma`](prisma/schema.prisma) lists exactly what the port
> costs and how to undo it.

## Running it

```bash
# Once: a database to develop against. `root` because creating the append-only
# triggers needs the TRIGGER privilege, which the auto-created user lacks.
docker run -d --name fv-mysql \
  -e MYSQL_ROOT_PASSWORD=factoryvision -e MYSQL_DATABASE=factoryvision_test \
  -p 33306:3306 mysql:8.0
docker exec fv-mysql mysql -uroot -pfactoryvision \
  -e "CREATE DATABASE IF NOT EXISTS factoryvision;"

pnpm --filter @fv/api db:deploy    # apply migrations
pnpm --filter @fv/api dev          # http://localhost:3000
pnpm --filter @fv/api test         # integration suite (needs the database)
pnpm --filter @fv/api typecheck
node apps/api/scripts/audit-decimal.mjs
```

Integration tests **skip with a loud reason** when the database is unreachable.
CI sets `REQUIRE_DB=1`, which turns that skip into a failure — otherwise a suite
can quietly stop running the day a container name changes.

## The five rules this codebase will not bend on

Each one has a concrete failure behind it, not a preference.

1. **The log is append-only, and the database enforces it.** A correction is a
   new event. `UPDATE`/`DELETE` on `event` and `admin_audit` raise at the
   trigger — because "no code does that" is a promise about today's code, and it
   survives exactly until somebody writes a fix-up script at 2am.

2. **One projection, two runtimes.** Every number comes from `@fv/domain`, used
   as-is. If a function cannot be used as it is, it gets fixed *there*, never
   re-implemented here. Two versions of a stock figure agree for a while and
   then diverge, and the one that loses is the one the operator is looking at.
   `test/ingest.test.ts` proves they still match.

3. **Quantities never touch `number`.** Decimal strings in, big.js in the
   middle, decimal strings out. `scripts/audit-decimal.mjs` is CI's copy of this
   rule and it has already caught a real violation.

4. **Tenant isolation is enforced at the Prisma client, not remembered.** The
   extension injects `tenantId` and refuses `findUnique`/`update`/`delete` on
   tenant-scoped models, because those take a unique where-clause that cannot
   carry a tenant filter. Every endpoint has a NEGATIVE isolation test.

5. **The backend is never in the path of an operator's tap.** Transactions are
   born on the device and sync afterwards. An endpoint that a warehouse phone
   must wait on mid-flow is an endpoint in the wrong place.

## Shape

```
src/
  auth/          OTP, sessions, devices, RBAC on actions      B-013 → B-024
  sync/          ingest, conflicts, downstream feed           B-026 → B-048
  events/        the append-only log                          B-025
  projection/    stock, issues, PO status, tasks              B-031 → B-037
  master/        products, locations, partners, PO, BOM       B-049 → B-060
  alerts/        nine thresholds, push, scheduler, approvals  B-064 → B-070
  storage/       presigned photo upload                       B-061 → B-063
  reports/       ten reports, dashboard, Excel & PDF          B-071 → B-081
  ops/           restore verification, audit, replay timing   B-083 → B-092
  tenant/        provisioning, trial, configuration           B-013, B-058
```

## Two decisions worth knowing before reading the code

**No `emitDecoratorMetadata`.** Every injected dependency uses an explicit
`@Inject(TOKEN)`. That is what lets the same code run under `tsx` in dev and
under Vitest in tests, both of which are esbuild and neither of which implements
that TypeScript-only feature. The one exception is `@Res()` in the reports
controller, which must be Nest's own — see the note there.

**Zod schemas come from `@fv/contracts`.** There is no DTO layer. The client
validates events against those exact schemas before writing them to its local
database; a second server-side definition would disagree with it on the first
change, and the disagreement would show up as an operator's transaction being
rejected after it had already been saved on their phone.

## Still open

These are business decisions, not missing code. Each is marked in the plan and
handled honestly at runtime — the server reports what is not configured rather
than pretending.

| | |
|---|---|
| **BP-02** hosting target | Shared hosting cannot run a long-lived process plus a scheduler |
| **BP-03** SMS provider | `OTP_PROVIDER=console` refuses to start in production |
| **BP-04** object storage in Indonesia | R2 has no Indonesian region; `/ready` reports storage as unconfigured |
