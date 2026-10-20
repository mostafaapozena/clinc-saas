import mongoose, { type Types } from 'mongoose';
import { recordAudit } from '../audit/audit-event.model.js';
import { BranchModel } from '../branches/branch.model.js';
import { MembershipModel } from '../memberships/membership.model.js';
import { OrganizationModel } from './organization.model.js';

function first<T>(items: T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error('Expected a created document');
  return item;
}

/**
 * Creates an organization, its first branch and the creator's active owner membership in a
 * single MongoDB transaction: either all three exist afterwards, or none do. Transactions
 * need a replica set (the devcontainer and CI run a single-node one).
 */
export async function createOrganizationWithOwner(input: {
  userId: Types.ObjectId;
  name: string;
  branch: { name: string; city?: string };
}) {
  return mongoose.connection.transaction(async (session) => {
    const organization = first(
      await OrganizationModel.create([{ name: input.name, createdBy: input.userId }], { session }),
    );
    const branch = first(
      await BranchModel.create(
        [{ organizationId: organization._id, name: input.branch.name, city: input.branch.city ?? '' }],
        { session },
      ),
    );
    const membership = first(
      await MembershipModel.create(
        [
          {
            organizationId: organization._id,
            userId: input.userId,
            role: 'owner',
            status: 'active',
            branchScope: { type: 'all', branchIds: [] },
          },
        ],
        { session },
      ),
    );
    await recordAudit(
      {
        organizationId: organization._id,
        actorUserId: input.userId,
        action: 'organization.created',
        target: { type: 'organization', id: organization._id },
        changes: { initialBranchId: branch._id },
      },
      session,
    );
    return { organization, branch, membership };
  });
}
