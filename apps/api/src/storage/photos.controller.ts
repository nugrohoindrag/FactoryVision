import { Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Requires, Write } from '../auth/public.decorator.js';
import { requireActor } from '../common/request-context.js';
import { ZodBody } from '../common/zod.js';
import { StorageService } from './storage.service.js';

/**
 * The photo half of receiving (F2), shrinkage (F6) and loading (F8).
 *
 * Three calls, in the order the phone makes them: reserve, upload straight to
 * storage, confirm. The middle step never touches this server.
 */
@Controller('photos')
export class PhotosController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  @Post('presign')
  @Write()
  async presign(
    @ZodBody(
      z.object({
        contentType: z.string().min(1),
        byteSize: z.number().int().positive().optional(),
        eventId: z.string().uuid().optional(),
      }),
    )
    body: { contentType: string; byteSize?: number; eventId?: string },
  ) {
    const actor = requireActor();
    return this.storage.presignUpload({ tenantId: actor.tenantId, ...body });
  }

  @Post(':id/uploaded')
  @Write()
  async confirm(@Param('id') id: string) {
    const actor = requireActor();
    await this.storage.markUploaded(actor.tenantId, id);
    return { ok: true };
  }

  @Get(':id/url')
  async url(@Param('id') id: string) {
    const actor = requireActor();
    return this.storage.presignDownload(actor.tenantId, id);
  }

  /** Links photos to the event once it has synced — they travel separately. */
  @Post('attach')
  @Write()
  async attach(
    @ZodBody(z.object({ eventId: z.string().uuid(), photoIds: z.array(z.string().uuid()) }))
    body: { eventId: string; photoIds: string[] },
  ) {
    const actor = requireActor();
    await this.storage.attach(actor.tenantId, body.photoIds, body.eventId);
    return { ok: true };
  }

  @Post('collect-orphans')
  @Requires('config.write')
  async collect() {
    return this.storage.collectOrphans();
  }
}
