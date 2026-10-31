import { describe, expect, it } from 'vitest';
import { DESTINATIONS, destinationOpen, moduleOfPath, type AccessContext } from './modules';
import type { Permission } from './types';

// One visibility rule per destination (lib/modules.ts): what the sidebar, the module gate and the
// reports center offer for a role and a set of switched-on modules.
const ctx = (permissions: Permission[], modules: string[] | null = null, specialty: string | null = null): AccessContext => ({
  can: (p) => permissions.includes(p),
  moduleOn: (m) => !modules || modules.includes(m),
  orgWide: true,
  specialty,
});
const open = (c: AccessContext) => DESTINATIONS.filter((d) => destinationOpen(d, c)).map((d) => d.id);

describe('module registry', () => {
  it('offers equipment to every role that may read it, not only to those who manage it', () => {
    expect(open(ctx(['asset.read']))).toContain('assets');
    expect(open(ctx(['asset.read'], ['accounting']))).not.toContain('assets');
  });

  it('hides a switched-off module everywhere it would be offered', () => {
    const accountant: Permission[] = ['accounting.read', 'cash.session.operate', 'inventory.read', 'purchase.read', 'compensation.read'];
    expect(open(ctx(accountant))).toEqual(expect.arrayContaining(['accounting', 'cash', 'inventory', 'purchasing', 'compensation', 'reports']));
    const clinic = open(ctx(accountant, ['accounting', 'cash', 'inventory']));
    expect(clinic).not.toContain('purchasing');
    expect(clinic).not.toContain('compensation');
    expect(moduleOfPath('purchasing/orders')).toBe('purchasing');
    expect(moduleOfPath('finance/installments')).toBeUndefined();
  });

  it('keeps patient billing and the general ledger as separate destinations', () => {
    const front = open(ctx(['finance.account.read', 'appointment.read', 'queue.read', 'patient.list']));
    expect(front).toEqual(expect.arrayContaining(['billing', 'installments', 'appointments', 'queue', 'patients']));
    expect(front).not.toContain('accounting');
  });

  it('shows the worklist only to a doctor whose specialty has one', () => {
    expect(open(ctx(['clinical.encounter.own'], null, 'dentistry'))).toContain('worklist');
    expect(open(ctx(['clinical.encounter.own'], null, null))).not.toContain('worklist');
  });

  it('gives a viewer only the destinations without data permissions', () => {
    expect(open(ctx(['organization.read', 'dashboard.read']))).toEqual(['home', 'branches', 'profile']);
  });
});
