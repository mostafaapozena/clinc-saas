#!/usr/bin/env node
// Prints sample slow operations from the load-test database's profiler for a collection.
import mongoose from 'mongoose';
const [coll = 'appointments', n = '3'] = process.argv.slice(2);
await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/?directConnection=true', { dbName: 'clinc_load_test' });
const rows = await mongoose.connection.db
  .collection('system.profile')
  .find({ ns: `clinc_load_test.${coll}`, op: 'query' })
  .sort({ millis: -1 })
  .limit(Number(n))
  .toArray();
for (const r of rows)
  console.log(
    r.millis,
    'ms docs',
    r.docsExamined,
    'keys',
    r.keysExamined,
    JSON.stringify({ filter: r.command.filter, sort: r.command.sort, limit: r.command.limit, skip: r.command.skip }).slice(0, 700),
  );
await mongoose.disconnect();
