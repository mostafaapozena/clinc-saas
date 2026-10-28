import { createHash } from 'node:crypto';
import { Schema, model, type Query, type Types } from 'mongoose';
import { tenantGuardPlugin } from '../tenancy/tenant-guard.plugin.js';
import { clock } from '../time/clock.js';

// Organization files (docs/architecture/ORGANIZATION_PROFILE.md). The rest of the code talks to
// the `FileStorage` interface only; this implementation keeps small files in MongoDB, scoped to
// the organization. An object store (S3-compatible) can replace it without touching the routes.
// Files are never served as active content: only sniffed raster images are accepted.

export const MAX_IMAGE_BYTES = 512 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** The real type of an image from its first bytes (never trusting the declared type or a name). */
export function sniffImage(bytes: Buffer): ImageType | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP')
    return 'image/webp';
  return null;
}

export interface StoredFile {
  organizationId: Types.ObjectId;
  /** What the file is for, e.g. "logo". */
  purpose: string;
  contentType: ImageType;
  size: number;
  sha256: string;
  data: Buffer;
  /** Replaced or removed files are kept (no destructive retention); only `active` ones are served. */
  status: 'active' | 'replaced' | 'removed';
  createdBy: Types.ObjectId;
  createdAt: Date;
}
const storedFileSchema = new Schema<StoredFile>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    purpose: { type: String, required: true, maxlength: 40 },
    contentType: { type: String, enum: IMAGE_TYPES, required: true },
    size: { type: Number, required: true, min: 1, max: MAX_IMAGE_BYTES },
    sha256: { type: String, required: true },
    data: { type: Buffer, required: true },
    status: { type: String, enum: ['active', 'replaced', 'removed'], required: true, default: 'active' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { collection: 'org_files', timestamps: { createdAt: true, updatedAt: false, currentTime: () => clock.now() } },
);
storedFileSchema.index({ organizationId: 1, purpose: 1, status: 1 });
storedFileSchema.plugin(tenantGuardPlugin);
storedFileSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace'], function (this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup !== true) throw new Error('Stored files are not deleted');
});
export const StoredFileModel = model<StoredFile>('StoredFile', storedFileSchema);

export interface FileStorage {
  /** Stores a new active file for a purpose; earlier active files of that purpose become `replaced`. */
  put(input: {
    organizationId: Types.ObjectId;
    purpose: string;
    contentType: ImageType;
    bytes: Buffer;
    userId: Types.ObjectId;
  }): Promise<{ id: Types.ObjectId }>;
  get(organizationId: Types.ObjectId, id: Types.ObjectId): Promise<{ contentType: ImageType; bytes: Buffer; sha256: string } | null>;
  remove(organizationId: Types.ObjectId, purpose: string): Promise<void>;
}

export const mongoFileStorage: FileStorage = {
  async put({ organizationId, purpose, contentType, bytes, userId }) {
    const doc = await StoredFileModel.create({
      organizationId,
      purpose,
      contentType,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      data: bytes,
      createdBy: userId,
    });
    await StoredFileModel.updateMany({ organizationId, purpose, status: 'active', _id: { $ne: doc._id } }, { $set: { status: 'replaced' } });
    return { id: doc._id };
  },
  async get(organizationId, id) {
    const f = await StoredFileModel.findOne({ organizationId, _id: id, status: 'active' }).lean();
    if (!f) return null;
    // A lean read returns the driver's Binary; its `buffer` holds exactly the stored bytes.
    const bytes = Buffer.isBuffer(f.data) ? f.data : Buffer.from((f.data as unknown as { buffer: Uint8Array }).buffer);
    return { contentType: f.contentType, bytes, sha256: f.sha256 };
  },
  async remove(organizationId, purpose) {
    await StoredFileModel.updateMany({ organizationId, purpose, status: 'active' }, { $set: { status: 'removed' } });
  },
};
