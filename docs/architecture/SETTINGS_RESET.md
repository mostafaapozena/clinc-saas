# Safe settings reset (ERP milestone H7)

The owner can put chosen settings back to their defaults:

1. preview the exact changes;
2. confirm by typing the organization's name;
3. the current values are snapshotted;
4. the defaults are applied, and the reset is audited.

Every reset can be restored once from its snapshot. **Only configuration is touched**: patients,
appointments, invoices, receipts, journal entries, stock and every other record stay exactly as
they are.

Code: `apps/api/src/modules/organizations/settings-reset.routes.ts`; web
`components/SettingsReset.tsx` (in Settings). Tests: `apps/api/test/settings-reset.test.ts`,
`apps/web/src/pages/SettingsReset.test.tsx`.

## Sections

| Section | What is reset | Default | Who |
| --- | --- | --- | --- |
| `modules` | Enabled ERP modules | The organization type's defaults (docs/architecture/MODULES.md) | owner (`organization.update`) |
| `accounting` | Posting map and the cashier-session rule | The template chart's posting accounts; no session required | owner (`accounting.settings.manage` as well) |

- If a template account was **archived**, its current mapping is kept. It is listed in `skipped`
  and never guessed.
- **Out of reach of a reset** (they are records or decisions, not defaults):
  - the organization's identity and legal profile;
  - the chart of accounts itself;
  - the ledger cutover and closed months;
  - the currency;
  - specialties and branches.

## Flow and safety

1. **Preview.** `GET /orgs/:id/settings-reset/preview?sections=modules,accounting` returns the
   list of changes (key, from, to), the skipped keys, and a **token** derived from the current
   values. Nothing changes.
2. **Reset.** `POST /orgs/:id/settings-reset { sections, token, confirmName }`.
   - `confirmName` must equal the organization's name (`does_not_match`).
   - The token must match the current values. If anything changed since the preview, the reset
     is refused (`SETTINGS_CHANGED`) and the owner previews again.
   - A **snapshot** (`org_settings_snapshots`) of the values before and after is written first,
     then the defaults are applied in one transaction.
   - The reset is audited (`organization.settings_reset`, with the snapshot id and the changed
     keys).
3. **Restore.** `POST /orgs/:id/settings-reset/snapshots/:snapshotId/restore { confirmName }`
   puts the snapshot's earlier values back, once (`ALREADY_RESTORED` after that).
   - The restore itself is snapshotted, so it can be traced.
   - It is audited (`organization.settings_restored`).
   - Mappings pointing at accounts archived since keep today's value and are reported.
4. **History.** `GET /orgs/:id/settings-reset/snapshots` lists the latest 50.

Snapshots are append-only and never deleted. The web screen shows the preview, keeps the reset
button disabled until the name is typed exactly, and lists the history with a restore button.
