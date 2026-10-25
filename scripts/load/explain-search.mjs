#!/usr/bin/env node
// Explain the patient name search (word prefix) for a common and a rare term in the largest
// organization of a *_load_test database, for the list query and the capped count.
import mongoose from 'mongoose';

const DB = process.argv[2] ?? 'clinc_load_test';
if (!DB.includes('_load_test')) throw new Error('load-test databases only');
await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/?directConnection=true', { dbName: DB });
const db = mongoose.connection.db;
const [largest] = await db
  .collection('patients')
  .aggregate([{ $group: { _id: '$organizationId', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 1 }])
  .toArray();
const orgId = largest._id;
for (const term of ['محمد', 'سعيد', 'karim', 'نورهان']) {
  const filter = { organizationId: orgId, $and: [{ $or: [{ $and: [{ nameTokens: { $regex: `^${term}` } }] }] }] };
  const find = await db.collection('patients').find(filter).sort({ createdAt: -1, _id: -1 }).limit(20).explain('executionStats');
  const count = await db.command({ explain: { count: 'patients', query: filter, limit: 1001 }, verbosity: 'executionStats' });
  const matches = await db.collection('patients').countDocuments(filter);
  const plan = (s) =>
    s ? `${s.stage === 'IXSCAN' ? `IXSCAN(${s.indexName})` : s.stage}${s.inputStage ? ' <- ' + plan(s.inputStage) : ''}` : '';
  console.log(
    term.padEnd(8),
    'matches',
    String(matches).padStart(6),
    '| find',
    `${find.executionStats.executionTimeMillis}ms docs ${find.executionStats.totalDocsExamined} keys ${find.executionStats.totalKeysExamined}`,
    plan(find.queryPlanner.winningPlan),
    '| count',
    `${count.executionStats.executionTimeMillis}ms docs ${count.executionStats.totalDocsExamined}`,
  );
}
await mongoose.disconnect();
