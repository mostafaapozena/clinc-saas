# Help and support (milestone 5)

**Code**
- API: `apps/api/src/modules/support/`
- Web: `pages/SupportPages.tsx`, `components/support.tsx`, and the support pages in
  `operator/OperatorConsole.tsx`
- Tests: `support-ops.test.ts`, `Support.test.tsx`, `e2e/support.spec.ts`

## In the clinic workspace (`/app/:orgId/support`)

### Frequently asked questions

- Short answers written by hand in Arabic and English (locale `support.faq`).
- They can be filtered by keyword in the browser.
- The page labels them as **static help, not an AI assistant**. They never answer medical
  questions.
- There is no chatbot. Its scope is undecided (Q11).

### Contact details

- Shown only when configured: `SUPPORT_CONTACT_EMAIL`, `SUPPORT_CONTACT_PHONE`, and
  `SUPPORT_HOURS_AR` with `SUPPORT_HOURS_EN` (both or neither).
- Nothing is invented. With nothing configured, the page says the details are not published yet.

### Support requests

- **Asking.** Anyone in the organization can ask (`support.request`). Each request has a subject,
  a topic and a message, and gets a reference such as `S-7KQ2M9XA`.
- **Visibility.** People see their own requests. Owners and admins see all of the organization's
  requests (`support.read_all`). Other organizations get `404`.
- **No patient data.** The form asks people not to include any. The server cannot check this, so
  the warning appears on the form and on every reply box.
- **Statuses.**
  - `open`: waiting for raclinic.
  - `answered`: raclinic replied.
  - `closed`.
  - A reply from the customer reopens the request.
- **Conversation.** Messages are append-only, at most 2,000 characters each and 100 per request.
  Optimistic concurrency avoids lost replies.
- **Deletion.** Requests are never deleted. Retention is an open decision; see
  [RETENTION.md](../operations/RETENTION.md).
- **Audit.** Organization audit entries record only the reference and the topic, never the
  message text.

## Operator queue (`/operator/support`)

- All operator roles can read the queue. Replying and changing status needs
  `platform.support.manage`, which both `platform_admin` and `support` have.
- Each request shows the organization name and the requester's display name. The requester's
  email is **masked**: the conversation is the channel.
- An operator reply appears to the clinic as "raclinic team" and sets the status to `answered`.
- Replies and status changes go to the platform audit, without message text.
- Operators still cannot open patient or clinical data. A support request never grants access to
  them.

## Not included

- Attachments.
- Email notifications of replies (blocked on the email provider, B7).
- Service-level targets or support hours (Q11).
- Assignment, internal notes, and live chat.
