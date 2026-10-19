import type { Aggregate, MongooseQueryMiddleware, Query, Schema } from 'mongoose';

export class TenantScopeError extends Error {
  constructor(model: string, operation: string) {
    super(`Unscoped ${operation} on tenant collection "${model}": filter must include organizationId`);
    this.name = 'TenantScopeError';
  }
}

const GUARDED_QUERIES: MongooseQueryMiddleware[] = [
  'countDocuments',
  'deleteMany',
  'deleteOne',
  'distinct',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
];

type GuardOptions = { skipTenantGuard?: boolean };

/**
 * Safety net for tenant-owned collections: any query or aggregation whose filter lacks
 * organizationId throws. Deliberate cross-tenant reads (e.g. "my memberships") must opt out
 * with `.setOptions({ skipTenantGuard: true })` and be documented at the call site.
 */
export function tenantGuardPlugin(schema: Schema): void {
  schema.pre<Query<unknown, unknown>>(GUARDED_QUERIES, function () {
    if ((this.getOptions() as GuardOptions).skipTenantGuard) return;
    if (this.getFilter().organizationId == null) {
      throw new TenantScopeError(this.model.modelName, "query");
    }
  });

  schema.pre<Aggregate<unknown>>('aggregate', function () {
    if ((this.options as GuardOptions).skipTenantGuard) return;
    const first = this.pipeline()[0] as Record<string, unknown> | undefined;
    const match = first?.$match as Record<string, unknown> | undefined;
    if (match?.organizationId == null) {
      throw new TenantScopeError(this.model().modelName, 'aggregate');
    }
  });
}
