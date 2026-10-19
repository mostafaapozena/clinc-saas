// Registers every model so index builds (unique email, one membership per user and
// organization, …) can be awaited before the app serves requests or tests run.
import mongoose from 'mongoose';
import '../auth/session.model.js';
import '../modules/audit/audit-event.model.js';
import '../modules/branches/branch.model.js';
import '../modules/memberships/membership.model.js';
import '../modules/organizations/organization.model.js';
import '../modules/specialties/specialty.model.js';
import '../users/user.model.js';

export async function ensureIndexes(): Promise<void> {
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}
