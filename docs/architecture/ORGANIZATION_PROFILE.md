# Organization identity and legal profile — «ملف وهوية المنشأة» (ERP milestone H5)

The owner records the organization's legal identity once, and it appears at the top of every
printed document: invoices, receipts, purchase orders and RFQs. Synthetic data only.

Code:
- API: `apps/api/src/modules/organizations/profile.routes.ts`, `apps/api/src/storage/file-storage.ts`.
- Web: `components/OrganizationProfile.tsx` (settings card and `OrganizationLetterhead`).

Tests: `apps/api/test/organization-profile.test.ts`, `apps/web/src/pages/OrganizationProfile.test.tsx`.

## Fields

| Field | Arabic label | Notes |
| --- | --- | --- |
| `legalNameAr`, `legalNameEn` | الاسم القانوني | The printout uses the one matching the interface language, then the other, then the organization name |
| `commercialRegistration` | السجل التجاري | Kept exactly as typed (up to 40 characters) |
| `taxRegistration` | البطاقة الضريبية | Kept exactly as typed (up to 40 characters) |
| `address`, `phone`, `email` | العنوان والهاتف والبريد | The email must be a valid address or empty |
| `documentFooter` | سطر أسفل الرأس | Free text, for example the opening hours |

- **No statutory format is assumed or validated** for registration or tax numbers. That would
  need the owner's legal adviser, and it differs by country.
- Printouts stay labelled as **not** electronic tax invoices; e-invoicing integration is out of
  scope.
- Saving is version-checked (`VERSION_CONFLICT`) and audited (`organization.profile_updated`,
  with the names of the changed fields).
- **Access:** members read the profile (`organization.read`); the owner edits it
  (`organization.update`).

## Logo and file storage

- **Upload:** `PUT /orgs/:id/profile/logo` with the image as the **raw body**, up to **512 KB**
  (413 above).
  - **Accepted:** PNG, JPEG or WebP only. The real type is **sniffed from the bytes** and must
    match the declared `Content-Type`.
  - **Refused:** SVG (it can carry scripts) and anything else (`UNSUPPORTED_IMAGE`, 415).
  - The browser checks type and size before sending.
- **Serving:** `GET /orgs/:id/profile/logo` serves the logo to the organization's members only.
  Other organizations get 404, even with the exact URL. Response headers:
  - `X-Content-Type-Options: nosniff`;
  - `Content-Security-Policy: default-src 'none'; sandbox`;
  - private caching.
  - The URL carries the file id, so a new upload is never hidden by a cache.
- **Storage adapter:** the routes use the `FileStorage` interface (`put`, `get`, `remove`).
  - The current implementation keeps files in MongoDB (`org_files`), scoped to the organization
    by the tenant guard.
  - An S3-compatible object store can replace it without changing the routes. That would be an
    owner decision on provider and cost.
- **No destructive retention:**
  - Replacing a logo marks the old file `replaced`; removing it marks it `removed`.
  - Files are never deleted by the application.
  - Purging old files is a future, owner-approved retention rule.

## Known limitations

- **Single logo:** there is one logo, with no separate stamp or signature images.
- **No per-branch identity:** a branch with its own registration would need an owner decision on
  how branch documents are titled.
- **Print only:** the letterhead is applied to printouts, not to emails, because no mail is sent
  to patients yet.
