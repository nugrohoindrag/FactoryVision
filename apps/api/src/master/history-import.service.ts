import { Inject, Injectable } from '@nestjs/common';
import { EventPayloads, hashEvent, uuidv7, type EventType } from '@fv/contracts';
import { audit } from '../common/audit.js';
import { withLogDeleteAllowed } from '../common/append-only.js';
import { AppError } from '../common/errors.js';
import { log } from '../common/logger.js';
import { requireActor } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectorService } from '../projection/projector.service.js';

/**
 * B-060 — importing a factory's history, not just its closing balances.
 *
 * ## Why this is not optional
 *
 * PRD F1 asks for it in one line, and the reason is the whole migration story.
 * A factory that imports only balances opens the stock card for its
 * best-selling item and sees one row: "opening balance". No arrivals, no
 * issues, no batches. Everything before today is gone.
 *
 * That factory keeps its spreadsheet open "just to check" — and PRD §11's
 * measure of success is the opposite: 60% of customers stop updating the
 * warehouse spreadsheet by month three. A blank history is a standing reason
 * not to.
 *
 * ## Imported movements are movements
 *
 * They enter the same append-only log as everything else, with `occurredAt` set
 * to the date they really happened and `receivedAt` set to now. The two-clock
 * rule already covers this (Backend Plan §3.2): reports read `occurredAt`, so
 * an import lands on its true date; replay reads `receivedAt`, so ordering
 * stays deterministic. Nothing special is needed, which is the point of having
 * decided the rule up front.
 *
 * The only thing that marks them is `provenance: 'import'`, so a stock card can
 * say where a number came from when somebody asks why April looks odd.
 *
 * ## The device id is honest
 *
 * Imported events carry a synthetic device (`import:<tenant>`) with its own
 * hash chain. Attributing them to the warehouse head's phone would corrupt that
 * phone's chain and make every subsequent event from it unverifiable.
 */
@Injectable()
export class HistoryImportService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectorService) private readonly projector: ProjectorService,
  ) {}

  async importHistory(rows: readonly HistoryRow[]): Promise<HistoryImportOutcome> {
    const actor = requireActor();
    const deviceId = `import:${actor.tenantId}`;

    const outcome: HistoryImportOutcome = { imported: 0, skipped: [] };

    // Chronological, whatever order the spreadsheet was in. A return dated
    // March that imports after an issue dated April would be a return of
    // material that had not left yet.
    const ordered = [...rows].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));

    const head = await this.prisma.raw.event.findFirst({
      where: { tenantId: actor.tenantId, deviceId },
      orderBy: { id: 'desc' },
      select: { hash: true },
    });
    let prevHash: string | null = head?.hash ?? null;

    for (const [index, row] of ordered.entries()) {
      const schema = EventPayloads[row.type as EventType];
      if (!schema) {
        outcome.skipped.push({ row: index + 1, reason: `Unknown movement type ${row.type}` });
        continue;
      }

      const payload = schema.safeParse(row.payload);
      if (!payload.success) {
        outcome.skipped.push({
          row: index + 1,
          reason: payload.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
        continue;
      }

      const draft = {
        id: uuidv7(),
        tenantId: actor.tenantId,
        type: row.type,
        occurredAt: row.occurredAt,
        actorId: actor.actorId,
        deviceId,
        prevHash,
        payload: payload.data,
      };
      const hash = await hashEvent(draft);

      await this.prisma.raw.event.create({
        data: {
          ...draft,
          occurredAt: new Date(row.occurredAt),
          actorRole: actor.actorRole,
          hash,
          payload: payload.data as object,
          provenance: 'import',
        },
      });

      prevHash = hash;
      outcome.imported += 1;
    }

    if (outcome.imported > 0) {
      await this.projector.catchUp(actor.tenantId);
    }

    /**
     * Deliberately NOT run through the ingest conflict checks.
     *
     * An import is a bulk load of a past that already happened. Running the
     * negative-line check over it would flag every movement that precedes the
     * opening balance row it depends on, and a factory would see two hundred
     * "conflicts" on its first day. The balances are reconciled by looking at
     * the result instead: `outcome.imported` plus the projection the caller can
     * read back, and a stock take is the tool for fixing what does not match.
     */
    log().info({ ...outcome, skipped: outcome.skipped.length }, 'History import finished');

    await audit(this.prisma, {
      action: 'import.history',
      subject: 'event',
      after: { imported: outcome.imported, skipped: outcome.skipped.length },
    });

    return outcome;
  }

  /** Undoes an import that turned out to be wrong, before anybody built on it. */
  async revertImport(): Promise<{ removed: number }> {
    const actor = requireActor();

    const later = await this.prisma.raw.event.count({
      where: { tenantId: actor.tenantId, provenance: 'device' },
    });
    if (later > 0) {
      // Once real work sits on top of imported history, removing it would leave
      // that work referring to batches and issues that no longer exist.
      throw new AppError(
        'IN_USE',
        'This factory has recorded real movements since the import — it can no longer be undone. ' +
          'Correct the figures with a stock take instead.',
      );
    }

    /**
     * The one place besides customer deletion that removes log rows, and it
     * needs the escape hatch the append-only trigger looks for.
     *
     * The narrowness is what makes it defensible. The check above has already
     * established that NOT ONE real movement has been recorded since the
     * import — so this history has not yet become history: nobody has received
     * against it, issued from it, or counted it. Undoing a bad import in that
     * window is correcting a load, not rewriting a record.
     *
     * The moment a single device event exists, this refuses and says to use a
     * stock take instead, which is the tool for disagreeing with the past
     * without erasing it.
     */
    const removed = await this.prisma.raw.$transaction(async (tx) =>
      withLogDeleteAllowed(tx, () =>
        tx.event.deleteMany({ where: { tenantId: actor.tenantId, provenance: 'import' } }),
      ),
    );

    await this.projector.rebuild(actor.tenantId);
    await audit(this.prisma, {
      action: 'import.history.reverted',
      subject: 'event',
      after: { removed: removed.count },
    });

    return { removed: removed.count };
  }
}

export interface HistoryRow {
  type: string;
  /** ISO timestamp of when it really happened, not when it was imported. */
  occurredAt: string;
  payload: unknown;
}

export interface HistoryImportOutcome {
  imported: number;
  skipped: { row: number; reason: string }[];
}
