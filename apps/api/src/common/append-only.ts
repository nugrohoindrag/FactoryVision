import type { Prisma } from '@prisma/client';

/**
 * The escape hatch from the append-only triggers on `event` and `admin_audit`,
 * and the one place that knows how MySQL differs from PostgreSQL here.
 *
 * On PostgreSQL this was a single line at the top of the transaction:
 *
 *   SET LOCAL factoryvision.allow_log_delete = 'on'
 *
 * `SET LOCAL` is scoped to the transaction. It expires on COMMIT or ROLLBACK
 * whatever happens, including an exception, so the flag could not outlive the
 * one operation that asked for it.
 *
 * MySQL has no `SET LOCAL`. Its user variables (`@fv_allow_log_delete`) are
 * scoped to the CONNECTION, and a Prisma interactive transaction borrows a
 * pooled connection and hands it back afterwards. Set the flag the obvious way
 * and it survives the commit, rides the connection back into the pool, and the
 * next request unlucky enough to be handed that connection runs with the audit
 * log unlocked — silently, and nowhere near the code that opened it.
 *
 * That is the whole reason this helper exists instead of two inline `SET`
 * statements. The `finally` is not defensive tidiness; it is the only thing
 * standing in for what `SET LOCAL` did for free. Both exits matter: the throw
 * path, so a failed deletion does not leave the flag on, and the success path,
 * so a committed one does not either.
 *
 * Restoring PostgreSQL: replace both statements below with the original
 * `SET LOCAL` line and delete the `finally` — it becomes dead weight, not a
 * safeguard, once the database scopes the flag itself.
 */
export async function withLogDeleteAllowed<T>(
  tx: Prisma.TransactionClient,
  operation: () => Promise<T>,
): Promise<T> {
  await tx.$executeRawUnsafe("SET @fv_allow_log_delete = 'on'");
  try {
    return await operation();
  } finally {
    // NULL, not 'off': the trigger tests for the literal string 'on', and an
    // unset variable reads as NULL there. Same meaning, one less state.
    await tx.$executeRawUnsafe('SET @fv_allow_log_delete = NULL');
  }
}
