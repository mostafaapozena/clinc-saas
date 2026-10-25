# Integrated acceptance (milestone 6)

The brief lists ten browser journeys. Each runs in Playwright against production builds of the web
and API apps. Every run starts from a reset database seeded with synthetic data (`npm run verify`,
CI). Each journey runs as the role that would really perform it.

**Where the tests run.** These are automated, headless browser runs in the Codespace and in CI.
They are not a person using the preview. The private preview was also checked headlessly; see
PROGRESS.md.

| # | Journey | Covered by | Language | Device |
| - | ------- | ---------- | -------- | ------ |
| 1 | Public solution → registration → multi-specialty onboarding | `public.spec.ts` "public site to workspace: solution → registration → multi-specialty setup → workspace"; `auth.spec.ts` (registration → onboarding, resume) | ar; en (`public.spec.ts` English pages) | desktop; mobile (`public.spec.ts` @mobile) |
| 2 | Patient → booking → arrival → specialty consultation → finalized record | `acceptance.spec.ts` **J2**: new patient, booking, check-in, doctor's queue, dentistry record, finalize; the desk sees the status only. `front-desk.spec.ts`, `specialty.spec.ts` (physiotherapy, ENT), `clinical.spec.ts` | ar; en (`clinical.spec.ts` two-tab conflict) | desktop; mobile (`front-desk.spec.ts`, `clinical.spec.ts` @mobile) |
| 3 | Performed service → invoice → partial/full payment → statement | `finance.spec.ts` (cashier journey; a doctor-confirmed charge billed by the accountant without clinical text) | ar | desktop; mobile (`finance.spec.ts` @mobile) |
| 4 | Doctor delegation → permitted access → revocation | `coverage.spec.ts` (share → covered access and addendum → revoke; the owner never reads; metadata-only audit) | ar | desktop |
| 5 | Subscription setup and the simulation distinction | `subscription.spec.ts`: operator grant → owner checkout **labelled as a simulator** → signed webhook → lost webhook found by reconciliation | ar → en (the owner prefers English) | desktop; mobile (support operator) |
| 6 | Operator manages inquiry/support without seeing clinical data | `acceptance.spec.ts` **J6** (inquiry: masked, audited reveal, reviewed; no clinic routes); `support.spec.ts` (support request answered by an operator) | ar | desktop; mobile (J9) |
| 7 | Password recovery / invitation through sandbox mail | `support.spec.ts` (reset through the **development mail sink**; single-use link); `acceptance.spec.ts` **J7** (invitation → register from the link → join with the role) | ar | desktop; mobile (J9) |
| 8 | Arabic and English | `i18n.spec.ts` (RTL/LTR, fonts, saved preference); English steps in J5, J10, `clinical.spec.ts`, `front-desk.spec.ts`, `public.spec.ts` | ar, en | both |
| 9 | Desktop and mobile | the `mobile` project (Pixel 7): 9 tests tagged @mobile, plus `acceptance.spec.ts` **J9** (recovery, invitation and operator pages without horizontal scroll) | ar | mobile |
| 10 | Unauthorized organization / branch / role attempts | `acceptance.spec.ts` **J10** (another organization's URLs and API, a branch-restricted receptionist, viewer and doctor and accountant limits, operator versus tenant sessions); `workspace.spec.ts`, `front-desk.spec.ts`, `auth.spec.ts` (suspended membership) | en, ar | desktop |

## Mail and payments in these journeys

| Integration | What the journey uses |
| ----------- | --------------------- |
| Payments | The **payment simulator**, labelled on every screen. **No real provider and no sandbox account exist.** |
| Email | The **development mail sink**. Nothing is sent. **No real provider and no sandbox account exist.** |

Neither counts as a working external integration. See [COMPLETION_MATRIX.md](COMPLETION_MATRIX.md).

## Bugs these journeys found (fixed)

- **The invitation preview ran into the CSRF check** when a signed-in browser opened a link before
  its CSRF token had loaded. The preview is read-only and now sits outside CSRF protection. A
  regression API test was added.
- **Earlier milestones' end-to-end tests caught:**
  - a stale "apply to" choice in the payment form (M3);
  - operator sign-in and sign-out not refreshing the console (M4, found by a web test).
