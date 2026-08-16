import { Inject, Injectable } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { uuidv7 } from '@fv/contracts';
import { AppError } from '../common/errors.js';
import { log } from '../common/logger.js';
import { ENV, requireStorageEnv, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * B-061 → B-063 — photo storage.
 *
 * ## Presigned, so the blob never touches this server
 *
 * A delivery-note photo goes from the phone straight to object storage. Routing
 * megabytes through the API would put the slowest thing in the system on the
 * same box as the fastest, and the API would spend its day copying bytes it
 * never reads.
 *
 * ## Uploads never block a save
 *
 * The event is written and synced first; the photo follows whenever there is
 * signal (PRD §10). An operator whose transaction waited for a 4 MB upload over
 * 3G would go back to the notebook by Thursday — and the photo is evidence
 * attached to a movement, not the movement itself.
 *
 * ## BP-04, stated plainly
 *
 * Tech Stack §1.3 names R2 or S3. PRD §10 requires data residency in Indonesia,
 * and photos of delivery notes and defective goods are customer data like any
 * other. Cloudflare R2 has no Indonesian region. This client is S3-compatible
 * and endpoint-driven, so it works with either — but the decision belongs to the
 * business and is still open. Until it is made, `STORAGE_*` points at whatever
 * development uses and `/ready` reports storage as unconfigured rather than
 * pretending.
 */
@Injectable()
export class StorageService {
  private client: S3Client | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Configuration, or a 503 that names what is missing.
   *
   * `requireStorageEnv` throws a plain `Error`, which the exception filter would
   * turn into "something went wrong on our side" — the exact unhelpful answer
   * this file's header argues against. An operator whose photo will not upload
   * deserves to know it is a server setting, not their phone.
   */
  private config() {
    try {
      return requireStorageEnv(this.env);
    } catch (error) {
      throw new AppError(
        'NOT_CONFIGURED',
        error instanceof Error ? error.message : 'Object storage is not configured',
      );
    }
  }

  private s3(): S3Client {
    if (this.client) return this.client;
    const config = this.config();
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    return this.client;
  }

  /**
   * Reserves a photo id and hands back a URL the device can PUT to.
   *
   * The row is created BEFORE the upload. A photo that exists in the bucket with
   * no row is invisible and un-deletable; a row with no object is a broken
   * thumbnail somebody can chase. The second failure is recoverable.
   */
  async presignUpload(input: {
    tenantId: string;
    contentType: string;
    byteSize?: number;
    eventId?: string;
  }): Promise<{ photoId: string; uploadUrl: string; expiresInSeconds: number }> {
    const config = this.config();

    if (!input.contentType.startsWith('image/')) {
      throw new AppError('VALIDATION_FAILED', 'Only images can be attached to a movement');
    }
    if (input.byteSize && input.byteSize > config.maxUploadBytes) {
      const mb = Math.round(config.maxUploadBytes / 1024 / 1024);
      throw new AppError('VALIDATION_FAILED', `Photos must be under ${mb} MB — compress it first`);
    }

    const photoId = uuidv7();
    // Tenant-prefixed so a mis-scoped bucket policy is a visible mistake rather
    // than a silent one.
    const storageKey = `${input.tenantId}/${photoId}`;

    await this.prisma.raw.photo.create({
      data: {
        id: photoId,
        tenantId: input.tenantId,
        storageKey,
        contentType: input.contentType,
        byteSize: input.byteSize ?? null,
        eventId: input.eventId ?? null,
      },
    });

    const uploadUrl = await getSignedUrl(
      this.s3(),
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: storageKey,
        ContentType: input.contentType,
      }),
      { expiresIn: 900 },
    );

    return { photoId, uploadUrl, expiresInSeconds: 900 };
  }

  /** The device calls this once the PUT succeeds. */
  async markUploaded(tenantId: string, photoId: string): Promise<void> {
    const updated = await this.prisma.raw.photo.updateMany({
      where: { id: photoId, tenantId },
      data: { uploadedAt: new Date() },
    });
    if (updated.count === 0) throw new AppError('NOT_FOUND', 'That photo was never reserved');
  }

  async presignDownload(tenantId: string, photoId: string): Promise<{ url: string }> {
    const config = this.config();
    const photo = await this.prisma.raw.photo.findFirst({ where: { id: photoId, tenantId } });
    if (!photo) throw new AppError('NOT_FOUND', 'Photo not found');
    if (!photo.uploadedAt) throw new AppError('NOT_FOUND', 'That photo has not finished uploading');

    const url = await getSignedUrl(
      this.s3(),
      new GetObjectCommand({ Bucket: config.bucket, Key: photo.storageKey }),
      { expiresIn: 900 },
    );
    return { url };
  }

  /** Attaches a photo to the event that finally arrived (they travel apart). */
  async attach(tenantId: string, photoIds: readonly string[], eventId: string): Promise<void> {
    if (photoIds.length === 0) return;
    await this.prisma.raw.photo.updateMany({
      where: { tenantId, id: { in: [...photoIds] } },
      data: { eventId },
    });
  }

  /**
   * B-062 — clears photos that were reserved and never uploaded.
   *
   * A reservation is made when the operator taps the shutter. If they abandon
   * the screen, the row stays forever pointing at nothing. Older than a day and
   * still not uploaded means it is not coming — the offline queue holds
   * transactions for seven days, but an upload that has not started in
   * twenty-four hours never will.
   */
  async collectOrphans(olderThanHours = 24): Promise<{ removed: number }> {
    const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
    const orphans = await this.prisma.raw.photo.findMany({
      where: { uploadedAt: null, createdAt: { lt: cutoff } },
    });

    for (const photo of orphans) {
      try {
        // Best effort: the object usually does not exist, which is the point.
        await this.s3().send(
          new DeleteObjectCommand({
            Bucket: this.config().bucket,
            Key: photo.storageKey,
          }),
        );
      } catch {
        // Nothing to do — the row goes either way.
      }
    }

    const removed = await this.prisma.raw.photo.deleteMany({
      where: { id: { in: orphans.map((photo) => photo.id) } },
    });

    if (removed.count > 0) log().info({ removed: removed.count }, 'Orphaned photos cleared');
    return { removed: removed.count };
  }
}
