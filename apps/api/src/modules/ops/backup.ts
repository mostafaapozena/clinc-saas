import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGunzip, createGzip } from 'node:zlib';
import mongoose from 'mongoose';

// Logical backup and restore drill (docs/operations/BACKUP_RESTORE.md). Portable: uses only the
// database driver, so it runs wherever the API runs (no mongodump binary needed). Format: gzip'ed
// JSON lines — a header with collections, counts and index definitions, then one Extended-JSON
// document per line. A restore goes ONLY into a new, isolated database whose name starts with
// `clinc_restore_`; it refuses the source database and any database that already has data.

const { EJSON } = mongoose.mongo.BSON;
type Db = NonNullable<typeof mongoose.connection.db>;
type IndexInfo = { name: string; key: Record<string, unknown>; [option: string]: unknown };
export type BackupHeader = {
  format: 'raclinic-backup';
  version: 1;
  createdAt: string;
  database: string;
  collections: { name: string; count: number; digest: string; indexes: IndexInfo[] }[];
};

export const RESTORE_PREFIX = 'clinc_restore_';
const BATCH = 500;

/** Order-independent digest of a collection's documents (canonical Extended JSON, sorted by _id). */
async function digestCollection(db: Db, name: string) {
  const hash = createHash('sha256');
  let count = 0;
  for await (const doc of db.collection(name).find({}, { sort: { _id: 1 } })) {
    hash.update(EJSON.stringify(doc, { relaxed: false }));
    hash.update('\n');
    count += 1;
  }
  return { count, digest: hash.digest('hex') };
}

async function collectionNames(db: Db) {
  return (await db.listCollections({ type: 'collection' }, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'))
    .sort();
}

export async function backupDatabase(db: Db, file: string): Promise<BackupHeader> {
  const names = await collectionNames(db);
  const collections: BackupHeader['collections'] = [];
  for (const name of names) {
    const { count, digest } = await digestCollection(db, name);
    const indexes = (await db.collection(name).indexes()) as IndexInfo[];
    collections.push({ name, count, digest, indexes: indexes.filter((i) => i.name !== '_id_') });
  }
  const header: BackupHeader = {
    format: 'raclinic-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    database: db.databaseName,
    collections,
  };
  async function* lines() {
    yield JSON.stringify(header) + '\n';
    for (const name of names) {
      for await (const doc of db.collection(name).find({}, { sort: { _id: 1 } })) {
        yield JSON.stringify({ c: name, d: EJSON.serialize(doc, { relaxed: false }) }) + '\n';
      }
    }
  }
  await pipeline(Readable.from(lines()), createGzip(), createWriteStream(file, { mode: 0o600 }));
  return header;
}

export type DrillResult = {
  target: string;
  collections: { name: string; expected: number; restored: number; digestMatches: boolean; indexesRestored: number }[];
  ok: boolean;
};

/** Restores a backup into an isolated database and verifies counts, content digests and indexes. */
export async function restoreInto(file: string, targetName: string, sourceName?: string): Promise<DrillResult> {
  if (!targetName.startsWith(RESTORE_PREFIX) || !/^[A-Za-z0-9_-]+$/.test(targetName))
    throw new Error(`Restore target must be a new database named ${RESTORE_PREFIX}*`);
  const target = mongoose.connection.useDb(targetName, { useCache: false }).db;
  if (!target) throw new Error('No database connection');
  if (sourceName && sourceName === targetName) throw new Error('Refusing to restore into the source database');
  if ((await collectionNames(target)).length > 0) throw new Error(`Refusing to restore into non-empty database ${targetName}`);

  const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  let header: BackupHeader | null = null;
  let batch: { name: string; docs: unknown[] } = { name: '', docs: [] };
  const flush = async () => {
    if (batch.docs.length) await target.collection(batch.name).insertMany(batch.docs as never[], { ordered: true });
    batch = { name: '', docs: [] };
  };
  for await (const line of rl) {
    if (!line) continue;
    if (!header) {
      header = JSON.parse(line) as BackupHeader;
      if (header.format !== 'raclinic-backup' || header.version !== 1) throw new Error('Not a raclinic backup file');
      if (sourceName === undefined && header.database === targetName) throw new Error('Refusing to restore into the source database');
      for (const c of header.collections) await target.createCollection(c.name);
      continue;
    }
    const { c, d } = JSON.parse(line) as { c: string; d: unknown };
    if (batch.name !== c || batch.docs.length >= BATCH) await flush();
    batch.name = c;
    batch.docs.push(EJSON.deserialize(d as Record<string, unknown>, { relaxed: false }));
  }
  await flush();
  if (!header) throw new Error('Empty backup file');

  const collections: DrillResult['collections'] = [];
  for (const c of header.collections) {
    for (const index of c.indexes) {
      const { key, name, v: _v, ns: _ns, ...options } = index;
      await target.collection(c.name).createIndex(key as Record<string, 1 | -1>, { ...options, name });
    }
    const { count, digest } = await digestCollection(target, c.name);
    const indexesRestored = (await target.collection(c.name).indexes()).filter((i) => i.name !== '_id_').length;
    collections.push({ name: c.name, expected: c.count, restored: count, digestMatches: digest === c.digest, indexesRestored });
  }
  return {
    target: targetName,
    collections,
    ok: collections.every(
      (c) =>
        c.expected === c.restored &&
        c.digestMatches &&
        c.indexesRestored === header!.collections.find((h) => h.name === c.name)!.indexes.length,
    ),
  };
}

/** Drops a drill database (only ever one with the restore prefix). */
export async function dropDrillDatabase(targetName: string) {
  if (!targetName.startsWith(RESTORE_PREFIX)) throw new Error('Only restore-drill databases can be dropped here');
  await mongoose.connection.useDb(targetName, { useCache: false }).dropDatabase();
}
