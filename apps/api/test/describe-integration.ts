import { describe } from 'vitest';
import { databaseAvailable, migrateTestDatabase } from './harness.js';

/**
 * Skips loudly when there is no database, fails loudly when there should be one.
 *
 * Called with top-level `await` from each integration file — Vitest collects ES
 * modules, so the probe resolves before `describe` is registered and no
 * blocking trickery is needed.
 *
 * `REQUIRE_DB=1` is set in CI. Without that switch, an integration suite can
 * quietly stop running the day a container name changes, and nobody notices
 * until the thing it was guarding breaks in production.
 */
export async function integrationSuite(name: string, fn: () => void): Promise<void> {
  const ready = await databaseAvailable();

  if (!ready) {
    if (process.env.REQUIRE_DB === '1') {
      describe(name, () => {
        throw new Error(
          'REQUIRE_DB=1 but the test database is unreachable. Start it with:\n' +
            '  docker run -d --name fv-postgres -e POSTGRES_PASSWORD=factoryvision \\\n' +
            '    -e POSTGRES_USER=factoryvision -e POSTGRES_DB=factoryvision \\\n' +
            '    -p 55432:5432 postgres:16-alpine',
        );
      });
      return;
    }
    describe.skip(`${name} — SKIPPED, no test database on localhost:55432`, fn);
    return;
  }

  migrateTestDatabase();
  describe(name, fn);
}
