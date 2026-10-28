import type { RequestHandler } from 'express';
import { forbidden, notFound } from '../../http/errors.js';
import { OrganizationModel, type OrganizationType } from './organization.model.js';

// Shared ERP modules an organization can switch on or off (docs/architecture/MODULES.md). Turning a
// module off hides it and refuses its API (server-side); it never deletes data, and turning it on
// again shows everything as it was. Permissions still apply inside an enabled module.

export const ERP_MODULES = ['accounting', 'cash', 'inventory', 'purchasing', 'compensation', 'assets'] as const;
export type ErpModule = (typeof ERP_MODULES)[number];

/** Modules that need another one (cash and banks post to the ledger, and so on). */
export const MODULE_REQUIRES: Partial<Record<ErpModule, ErpModule[]>> = {
  cash: ['accounting'],
  compensation: ['accounting'],
};

/**
 * Defaults for a new organization from onboarding: a single clinic starts with the day-to-day money
 * and stock modules (the rest stay one switch away); centers and multi-branch organizations start
 * with everything.
 */
export function defaultModules(type: OrganizationType | null | undefined): ErpModule[] {
  if (type === 'clinic') return ['accounting', 'cash', 'inventory', 'purchasing'];
  return [...ERP_MODULES];
}

/** `null` (organizations created before modules existed, and API-created ones) means all enabled. */
export const enabledModulesOf = (org: { enabledModules?: string[] | null }): ErpModule[] =>
  org.enabledModules ? ERP_MODULES.filter((m) => org.enabledModules!.includes(m)) : [...ERP_MODULES];

/** Refuses the routes of a module the organization has switched off (mounted after requireMembership). */
export function requireModule(module: ErpModule): RequestHandler {
  return async (req, _res, next) => {
    if (!req.tenant) throw notFound();
    const org = await OrganizationModel.findById(req.tenant.organizationId).select('enabledModules').lean();
    if (!org) throw notFound();
    if (!enabledModulesOf(org).includes(module)) throw forbidden('MODULE_DISABLED', 'This module is switched off for the organization');
    next();
  };
}
