import type { IconName } from '../components/Icon';
import type { Permission } from './types';

// The workspace's destinations in one place (docs/DESIGN_SYSTEM.md "Module registry"): group, route,
// icon, label, the switchable module it belongs to and who may open it. The sidebar, the module
// gate on routes and the reports center read this list, so a destination is visible — or hidden —
// the same way everywhere. The API remains the authority: these rules only decide what is offered.

export type ErpModule = 'accounting' | 'cash' | 'inventory' | 'purchasing' | 'compensation' | 'assets';
export type NavGroup = 'start' | 'daily' | 'billing' | 'operations' | 'accounting' | 'organization' | 'account';

export type AccessContext = {
  can: (permission: Permission) => boolean;
  moduleOn: (module: string) => boolean;
  orgWide: boolean;
  /** The doctor's own specialty (for the worklist label and icon). */
  specialty: string | null;
};

export type Destination = {
  id: string;
  /** Path inside /app/:orgId ('' is the home page). */
  path: string;
  group: NavGroup;
  icon: IconName;
  labelKey: string;
  module?: ErpModule;
  /** Any of these permissions opens it (the route guard uses the same list). */
  anyOf?: Permission[];
  /** Extra condition, e.g. organization-wide scope. */
  when?: (ctx: AccessContext) => boolean;
  end?: boolean;
  /** Listed in the sidebar (false: reachable from its module, e.g. installments from billing). */
  nav?: boolean;
};

const WORKLIST_ICON: Record<string, IconName> = { dentistry: 'tooth', physiotherapy: 'activity', ent: 'ear' };

export const DESTINATIONS: Destination[] = [
  { id: 'home', path: '', group: 'start', icon: 'home', labelKey: 'nav.home', end: true },
  // Daily work: the day of the front desk and the doctors.
  { id: 'appointments', path: 'appointments', group: 'daily', icon: 'calendar', labelKey: 'nav.appointments', anyOf: ['appointment.read'] },
  { id: 'queue', path: 'queue', group: 'daily', icon: 'queue', labelKey: 'nav.queue', anyOf: ['queue.read'] },
  { id: 'patients', path: 'patients', group: 'daily', icon: 'patients', labelKey: 'nav.patients', anyOf: ['patient.list'] },
  { id: 'practitioners', path: 'practitioners', group: 'daily', icon: 'stethoscope', labelKey: 'nav.practitioners', anyOf: ['practitioner.read'] },
  {
    id: 'worklist',
    path: 'worklist',
    group: 'daily',
    icon: 'activity',
    labelKey: 'nav.worklist',
    anyOf: ['clinical.encounter.own'],
    when: (c) => Boolean(c.specialty && WORKLIST_ICON[c.specialty]),
  },
  { id: 'coverage', path: 'coverage', group: 'daily', icon: 'share', labelKey: 'nav.coverage', anyOf: ['clinical.encounter.own'] },
  { id: 'clinicalAudit', path: 'clinical-audit', group: 'daily', icon: 'shield', labelKey: 'nav.clinicalAudit', anyOf: ['clinical.audit.read'] },
  // Patient billing and collection (documents): distinct from the general ledger below.
  { id: 'billing', path: 'finance', group: 'billing', icon: 'wallet', labelKey: 'nav.finance', anyOf: ['finance.account.read'] },
  {
    id: 'installments',
    path: 'finance/installments',
    group: 'billing',
    icon: 'calendar',
    labelKey: 'nav.installments',
    anyOf: ['finance.account.read'],
  },
  // Operations and resources.
  { id: 'inventory', path: 'inventory', group: 'operations', icon: 'box', labelKey: 'nav.inventory', module: 'inventory', anyOf: ['inventory.read'] },
  {
    id: 'purchasing',
    path: 'purchasing',
    group: 'operations',
    icon: 'cart',
    labelKey: 'nav.purchasing',
    module: 'purchasing',
    anyOf: ['purchase.read'],
  },
  { id: 'assets', path: 'assets', group: 'operations', icon: 'tool', labelKey: 'nav.assets', module: 'assets', anyOf: ['asset.read'] },
  // Accounting and financial reporting.
  {
    id: 'reports',
    path: 'reports',
    group: 'accounting',
    icon: 'chart',
    labelKey: 'nav.reports',
    anyOf: ['accounting.read', 'finance.report.read', 'purchase.read', 'cash.session.review'],
  },
  {
    id: 'accounting',
    path: 'accounting',
    group: 'accounting',
    icon: 'book',
    labelKey: 'nav.accounting',
    module: 'accounting',
    anyOf: ['accounting.read'],
  },
  { id: 'cash', path: 'cash', group: 'accounting', icon: 'cash', labelKey: 'nav.cash', module: 'cash', anyOf: ['cash.session.operate'] },
  {
    id: 'compensation',
    path: 'compensation',
    group: 'accounting',
    icon: 'users',
    labelKey: 'nav.compensation',
    module: 'compensation',
    anyOf: ['compensation.read', 'compensation.own.read'],
  },
  // Organization and team.
  { id: 'branches', path: 'branches', group: 'organization', icon: 'building', labelKey: 'nav.branches' },
  { id: 'team', path: 'team', group: 'organization', icon: 'users', labelKey: 'nav.team', anyOf: ['member.read'] },
  { id: 'settings', path: 'settings', group: 'organization', icon: 'settings', labelKey: 'nav.settings', anyOf: ['organization.update'] },
  { id: 'subscription', path: 'subscription', group: 'organization', icon: 'card', labelKey: 'nav.subscription', anyOf: ['subscription.read'] },
  // My account and help.
  { id: 'support', path: 'support', group: 'account', icon: 'help', labelKey: 'nav.support', anyOf: ['support.request'] },
  { id: 'profile', path: 'profile', group: 'account', icon: 'user', labelKey: 'nav.profile' },
];

export const NAV_GROUPS: NavGroup[] = ['start', 'daily', 'billing', 'operations', 'accounting', 'organization', 'account'];

/** Whether a destination is offered to this member: module switched on, a permission, any extra rule. */
export function destinationOpen(d: Destination, ctx: AccessContext): boolean {
  if (d.module && !ctx.moduleOn(d.module)) return false;
  if (d.anyOf && !d.anyOf.some((p) => ctx.can(p))) return false;
  return d.when ? d.when(ctx) : true;
}

export const destination = (id: string) => DESTINATIONS.find((d) => d.id === id);

/** The module a path belongs to (its first segment), for the route gate. */
export function moduleOfPath(path: string): ErpModule | undefined {
  const first = path.split('/')[0];
  return DESTINATIONS.find((d) => d.module && d.path === first)?.module;
}

export const worklistIcon = (specialty: string | null) => (specialty ? WORKLIST_ICON[specialty] : undefined);
