import type { Types } from 'mongoose';
import { hashPassword } from '../../auth/password.js';
import { UserModel } from '../../users/user.model.js';
import { BranchModel } from '../branches/branch.model.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { DEMO_ORGANIZATIONS, DEMO_USERS } from './demo.data.js';

const UPSERT = { upsert: true, returnDocument: 'after', runValidators: true } as const;

function required<T>(value: T, what: string): NonNullable<T> {
  if (value == null) throw new Error(`Demo seed: missing ${what}`);
  return value;
}

/**
 * Idempotently creates or resets the demo organizations, branches, users and memberships.
 * Re-running restores the documented state (e.g. a suspended member is suspended again).
 */
export async function seedDemoData(password: string) {
  const passwordHash = await hashPassword(password);
  const userIds = new Map<string, Types.ObjectId>();
  for (const user of DEMO_USERS) {
    const doc = await UserModel.findOneAndUpdate(
      { email: user.email },
      {
        $set: { displayName: user.displayName, preferredLanguage: user.language, passwordHash },
        $setOnInsert: { emailVerifiedAt: null },
      },
      UPSERT,
    );
    userIds.set(user.email, required(doc, user.email)._id);
  }

  const summary = new Map<string, string[]>(DEMO_USERS.map((u) => [u.email, []]));
  for (const org of DEMO_ORGANIZATIONS) {
    const owner = required(org.members.find((m) => m.role === 'owner'), `${org.key} owner`);
    const organization = required(
      await OrganizationModel.findOneAndUpdate(
        { seedKey: org.key },
        { $set: { name: org.name }, $setOnInsert: { createdBy: userIds.get(owner.email) } },
        UPSERT,
      ),
      org.key,
    );
    const branchIds = new Map<string, Types.ObjectId>();
    for (const branch of org.branches) {
      const doc = await BranchModel.findOneAndUpdate(
        { organizationId: organization._id, name: branch.name },
        { $set: { city: branch.city, status: 'active' } },
        UPSERT,
      );
      branchIds.set(branch.name, required(doc, branch.name)._id);
    }
    for (const member of org.members) {
      const branchScope = member.branches
        ? { type: 'selected', branchIds: member.branches.map((name) => required(branchIds.get(name), name)) }
        : { type: 'all', branchIds: [] };
      await MembershipModel.findOneAndUpdate(
        { organizationId: organization._id, userId: required(userIds.get(member.email), member.email) },
        { $set: { role: member.role, status: member.status ?? 'active', branchScope } },
        UPSERT,
      );
      const scope = member.branches ? member.branches.join('، ') : 'all branches';
      summary.get(member.email)?.push(`${org.name}: ${member.role}${member.status === 'suspended' ? ' (suspended)' : ''} — ${scope}`);
    }
  }

  return DEMO_USERS.map((u) => ({
    email: u.email,
    summary: summary.get(u.email)?.join(' | ') || 'no organization (use for onboarding / team add)',
  }));
}
