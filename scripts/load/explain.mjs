#!/usr/bin/env node
// Explain plans for representative queries against the load-test database (built by run.mjs).
// The filters mirror what the routes send (see the comments); results go to stdout as a table.
//   node scripts/load/explain.mjs [--db clinc_load_test]
import mongoose from 'mongoose';

const dbArg = process.argv.indexOf('--db');
const DB = dbArg > 0 ? process.argv[dbArg + 1] : 'clinc_load_test';
if (!DB.includes('_load_test')) throw new Error('explain only runs against a *_load_test database');
const BASE_URI = process.env.MONGODB_TEST_URI ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017/?directConnection=true';
await mongoose.connect(BASE_URI, { dbName: DB });
const db = mongoose.connection.db;

const [largest] = await db
  .collection('patients')
  .aggregate([{ $group: { _id: '$organizationId', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 1 }])
  .toArray();
const orgId = largest._id;
const sample = await db.collection('patients').findOne({ organizationId: orgId });
const appt = await db.collection('appointments').findOne({ organizationId: orgId, status: 'scheduled' });
const day = new Date(appt.startAt);
const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - 2 * 3600_000);
const end = new Date(start.getTime() + 86_400_000);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const firstName = sample.nameKey.split(' ')[0];

const cases = [
  // patients GET ?q=<name>: $or on nameKey substring regex (patient.routes.ts) + countDocuments.
  [
    'patients: name search (substring regex)',
    'patients',
    { organizationId: orgId, $and: [{ $or: [{ nameKey: { $regex: esc(firstName) } }] }] },
    { createdAt: -1 },
    20,
  ],
  [
    'patients: name search count',
    'patients',
    { organizationId: orgId, $and: [{ $or: [{ nameKey: { $regex: esc(firstName) } }] }] },
    null,
    0,
    'count',
  ],
  [
    'patients: phone search',
    'patients',
    {
      organizationId: orgId,
      $and: [{ $or: [{ 'phone.e164': { $in: [sample.phone.e164] } }, { 'secondaryPhone.e164': { $in: [sample.phone.e164] } }] }],
    },
    { createdAt: -1 },
    20,
  ],
  [
    'patients: list recent, page 5',
    'patients',
    { organizationId: orgId, registrations: { $elemMatch: { status: 'active' } } },
    { createdAt: -1 },
    20,
    'find',
    80,
  ],
  ['patients: list count', 'patients', { organizationId: orgId, registrations: { $elemMatch: { status: 'active' } } }, null, 0, 'count'],
  [
    'appointments: today (all branches)',
    'appointments',
    { organizationId: orgId, startAt: { $gte: start, $lt: end } },
    { startAt: 1, _id: 1 },
    501,
  ],
  [
    'appointments: today one branch',
    'appointments',
    { organizationId: orgId, branchId: appt.branchId, startAt: { $gte: start, $lt: end } },
    { startAt: 1, _id: 1 },
    501,
  ],
  [
    'queue: checked-in / in progress today',
    'appointments',
    { organizationId: orgId, startAt: { $gte: start, $lt: end }, status: { $in: ['checked_in', 'in_progress'] } },
    null,
    500,
  ],
  [
    'availability: practitioner day',
    'appointments',
    { organizationId: orgId, practitionerId: appt.practitionerId, startAt: { $gte: start, $lt: end }, status: { $nin: ['cancelled'] } },
    null,
    200,
  ],
  ['patient appointment history', 'appointments', { organizationId: orgId, patientId: appt.patientId }, { startAt: -1 }, 20],
  ['support list (org)', 'support_requests', { organizationId: orgId }, { lastActivityAt: -1 }, 100],
  ['finance: charges of a patient', 'finance_charges', { organizationId: orgId, patientId: sample._id }, { createdAt: -1 }, 200],
  ['finance: invoices of a patient', 'finance_invoices', { organizationId: orgId, patientId: sample._id }, { createdAt: -1 }, 200],
];

function planSummary(stage) {
  const parts = [];
  const walk = (s) => {
    if (!s) return;
    parts.push(s.stage === 'IXSCAN' ? `IXSCAN(${s.indexName})` : s.stage);
    walk(s.inputStage);
    (s.inputStages ?? []).forEach(walk);
  };
  walk(stage);
  return parts.join(' <- ');
}

const rows = [];
for (const [label, coll, filter, sort, limit, kind = 'find', skip = 0] of cases) {
  let explain;
  if (kind === 'count') explain = await db.command({ explain: { count: coll, query: filter }, verbosity: 'executionStats' });
  else {
    let cursor = db.collection(coll).find(filter);
    if (sort) cursor = cursor.sort(sort);
    if (skip) cursor = cursor.skip(skip);
    if (limit) cursor = cursor.limit(limit);
    explain = await cursor.explain('executionStats');
  }
  const stats = explain.executionStats;
  rows.push({
    query: label,
    plan: planSummary(explain.queryPlanner.winningPlan.queryPlan ?? explain.queryPlanner.winningPlan),
    returned: stats.nReturned,
    keysExamined: stats.totalKeysExamined,
    docsExamined: stats.totalDocsExamined,
    ms: stats.executionTimeMillis,
  });
}
const counts = {
  patients: await db.collection('patients').countDocuments({ organizationId: orgId }),
  appointments: await db.collection('appointments').countDocuments({ organizationId: orgId }),
};
console.log(JSON.stringify({ db: DB, largestOrganization: String(orgId), counts, searchTerm: firstName, rows }, null, 2));
await mongoose.disconnect();
