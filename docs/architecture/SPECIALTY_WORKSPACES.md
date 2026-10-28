# Specialty workspaces (milestone 2)

Dentistry, physiotherapy and ENT documentation on top of the shared visit record
([CLINICAL.md](CLINICAL.md)). **First version, synthetic data only, pending review by practising
clinicians of each specialty ([CLINICIAN_REVIEW.md](../CLINICIAN_REVIEW.md)); not clinically
validated.** Every field is entered by the clinician: nothing is suggested, scored, diagnosed or
generated, and no named clinical scale is used.

Code: `apps/api/src/modules/clinical/templates.ts` (definitions), `specialty-refs.ts` (cross-record
references), `specialty.routes.ts` (derived views); web `components/specialty.tsx`,
`lib/templates.ts`. Tests: `apps/api/test/specialty-records.test.ts`, `apps/web/src/pages/Specialty.test.tsx`,
`e2e/specialty.spec.ts`.

## One record, versioned templates

A specialty record **is** a visit record: same appointment link, same treating-doctor and coverage
access, same draft → finalize → addenda lifecycle, same audit. It adds `specialty: { template,
version, data }`:

- The template follows the practitioner's specialty (`templatesForSpecialty`): dentistry →
  `dentistry.visit`; physiotherapy → `physiotherapy.assessment` (default), `.session`,
  `.discharge`; ENT → `ent.visit`; any other specialty → general record only. A template that
  does not fit is refused (`400 TEMPLATE_NOT_ALLOWED`).
- The record keeps the **template id and version** it was created with. Saves and finalization
  validate with exactly that version (`templateVersion`); a record of an unknown version is shown
  as stored and never rewritten (tested). New versions are added beside old ones and never edited.
- Schemas are explicit and bounded (lengths, list sizes, enumerations); errors return field codes,
  never the submitted text.
- Specialty data is finalized together with the sections and is then immutable like them;
  corrections are addenda. Finalization also applies the template's own minimum (below).

## Dentistry (`dentistry.visit@1`)

- **Notation:** FDI two-digit (ISO 3950): permanent teeth 11–48, primary teeth 51–85; surfaces
  M, O (occlusal/incisal), D, B (buccal/labial), L (lingual/palatal). Dentition: permanent, primary
  or mixed. _Choice of notation to be confirmed by dentists._
- **Per visit:** findings (tooth, surfaces, clinician's note), procedures performed (optional
  tooth, description), new treatment-plan items, and status changes (`in_progress`, `done`,
  `cancelled`) of plan items recorded at earlier **finalized** visits of the same patient that the
  author may read.
- **Chart and plan** (`GET /patients/:id/dental-chart`) are computed from finalized visits only:
  every finding/procedure per tooth in time order — nothing is overwritten — and each plan item with
  its current status and full status history. Drafts never appear.
- **Charges:** performed procedures are where clinic finances (milestone 3) will link services —
  explicitly, with confirmation; nothing is charged automatically.

## Physiotherapy

- `physiotherapy.assessment@1`: functional limitations (free text), goals (up to 10), planned
  number of sessions (1–60, required to finalize), frequency, course notes. A finalized assessment
  opens a **treatment course**.
- `physiotherapy.session@1`: the course it belongs to (required to finalize), treatment performed,
  progress, a note per course goal.
- `physiotherapy.discharge@1`: the course, a discharge summary (required), notes per goal.
- **No second scheduler:** each session record belongs to a real appointment. The course view
  (`GET /patients/:id/physio-courses`) counts finalized sessions against the planned number, shows
  the discharge, and counts the patient's upcoming appointments with the same physiotherapist (own
  courses only).
- References are checked on save and finalize: the course must be a finalized assessment of the
  same patient, readable by the author; goal notes must name that course's goals.

## ENT (`ent.visit@1`)

History by region (ear, nose, throat), examination by region (right ear, left ear, nose, throat,
neck), follow-up instructions — all free text — alongside the general sections (assessment and plan).

## Summaries without clinical content

`GET /clinical/specialty-summary` (`clinical.documentation_status.read`): counts of draft and
finalized records per template for the last 30 days — the doctor's own (plus their open plan
items and active courses), or organization-wide within the branch scope for owners and admins.
No text, no patient identity. Shown on the home page.

## Demo data

Dr. Hala (dentist): a finding and a plan item on tooth 26, completed at a later visit; a draft with a
finding on tooth 11. Dr. Sami (physiotherapist): two initial assessments (courses). The e2e tests
use other appointments for new records.

## Known limitations

- Pending clinician review of every field, label and finalization rule, per specialty.
- No images, attachments, periodontal charting, imaging, device data, prescriptions or coded
  diagnoses; no named scales or scores (deliberately).
- A plan-item status change refers to items the author can read; covered colleagues see the chart
  only while coverage lasts.
- Specialty dashboards are counts; there are no clinical analytics.
