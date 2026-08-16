import { uuidv7 } from '@fv/contracts';
import type { PrismaService } from '../prisma/prisma.service.js';
import { currentContext } from './request-context.js';

/**
 * B-085 — the desk-work audit trail.
 *
 * Warehouse movements audit themselves: they are events in an append-only log,
 * and "who moved what, when, from where" is the log's whole shape. This covers
 * everything that is NOT a movement and therefore leaves no trace otherwise —
 * who changed a purchase price, who deactivated a rack, who invited a user, who
 * closed a purchase order that still had stock outstanding.
 *
 * PRD §10 asks for an audit trail that cannot be erased. Rows here are only
 * ever inserted; nothing in the API updates or deletes them, and in production
 * the database grant says the same thing so that "nothing in the API" is not
 * the only thing standing between a record and its deletion.
 */
export async function audit(
  prisma: PrismaService,
  entry: {
    action: string;
    subject: string;
    subjectId?: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
  },
): Promise<void> {
  const context = currentContext();
  if (!context?.tenantId) return;

  await prisma.raw.adminAudit.create({
    data: {
      id: uuidv7(),
      tenantId: context.tenantId,
      actorId: context.actorId,
      action: entry.action,
      subject: entry.subject,
      subjectId: entry.subjectId ?? null,
      before: (entry.before ?? null) as object,
      after: (entry.after ?? null) as object,
      reason: entry.reason ?? null,
    },
  });
}
