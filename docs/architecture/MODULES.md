# Module activation and workspace preparation (ERP milestone H1)

Each organization switches on only the shared ERP modules it needs, and every member opens a
workspace that matches the organization's specialties and their own role. Synthetic data only.

Code: `apps/api/src/modules/organizations/modules.ts`, `organization.routes.ts`
(`PUT /orgs/:orgId/modules`), `onboarding.routes.ts`; web `components/ModuleSettings.tsx`,
`components/PreparingWorkspace.tsx`, `pages/OnboardingPage.tsx`, `pages/WorkspacePages.tsx`
(`SpecialtyContextChooser`, `SpecialtyQuickActions`), `layouts/AppShell.tsx`. Tests:
`apps/api/test/workspace-setup.test.ts`, `apps/web/src/pages/WorkspaceSetup.test.tsx`,
`e2e/specialty-setup.spec.ts`.

## Modules

| Module | Key | Needs | Default for a clinic | Default for a center |
| --- | --- | --- | --- | --- |
| Accounting | `accounting` | | on | on |
| Cash and banks | `cash` | accounting | on | on |
| Inventory | `inventory` | | on | on |
| Purchasing | `purchasing` | | on | on |
| Practitioner fees | `compensation` | accounting | off | on |
| Equipment | `assets` | | off | on |

- **Defaults** are written once, in the same transaction that completes setup
  (`enabledModules` on the organization). A replayed or concurrent completion never writes them twice.
- **Existing organizations** have no `enabledModules`, so they keep every module on. Nothing is
  migrated or removed.
- **Switching off** hides the module from the menu, home shortcuts and focus panel. Its API then
  refuses with `403 MODULE_DISABLED`. No data is deleted, and switching it on again restores everything.
- **Dependencies** are checked on save: switching on `cash` without `accounting` is refused with a
  field error (`cash_needs_accounting`). The settings screen switches dependencies on and off together.
- Only members with `organization.update` (the owner by default) can change modules; every change
  is audited as `organization.updated`. Clinical modules (patients, appointments, visit records) are
  always on.

## Preparing the workspace

- After review, «إنشاء مساحة العمل» sends **one** completion request. While it runs, the wizard is
  replaced by «جاري تجهيز مساحة عمل {التخصص}» (`role="status"`). There is no form left to submit
  twice, and no fake steps or timers: the state ends when the real request does.
- A `sessionStorage` marker records that a completion was sent. If the response is lost (a network
  drop or a closed tab), returning to `/onboarding` asks the API. `GET /onboarding` reports
  `completed.organizationId` for a setup finished in the last 30 minutes, and the page opens that
  workspace instead of starting a new setup. The API completion is idempotent on the draft.
- If the request fails, the wizard comes back with the error and the saved steps intact.

## Resolving the workspace

The same rules apply on login, refresh and deep links (`/app/:orgId/...`):

1. The organization comes from the URL and must be one of the member's organizations; any other
   organization returns 404 and shows nothing of it.
2. Specialty context:
   - a valid saved choice for that organization;
   - else the doctor's own specialty;
   - else the organization's only specialty;
   - else **ask**: with several specialties and no choice, the home page shows the context
     chooser (one button per specialty, plus "All specialties together").
3. The choice is saved per organization and can be changed from the top bar. It is a view filter
   only: the API still decides what each member may see.

## Specialty home

With a specialty context, the home page adds that specialty's shortcuts, filtered by permission and
module:

- **Dentistry:** treatment plans, today's dental visits, patient files and dental charts, booking,
  queue, dental materials (inventory).
- **Physiotherapy:** active treatment courses, today's sessions, booking, patient files and
  assessments, queue.
- **ENT:** follow-ups to book, today's visits, queue, booking, patient files and examinations.

"Today's focus" receives the specialty too. For the front desk it counts only that specialty's
practitioners' appointments.

## Known limitations

- Module activation covers the shared ERP modules above. The modules of ERP brief 2 (consignment,
  installments, expenses, payroll and so on) will register here as they land.
- Specialty shortcuts link to the existing shared screens. Specialty-specific screens beyond the
  visit templates and worklists are not added in this milestone.
