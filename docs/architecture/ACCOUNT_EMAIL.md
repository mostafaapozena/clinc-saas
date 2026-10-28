# Account email: verification, recovery and invitations (milestone 5)

**No real email is sent.** No email provider has been chosen yet (E2, B7).

**Code**
- `apps/api/src/auth/token.model.ts`, `auth/account.routes.ts`
- `modules/mail/mailer.ts`
- `modules/memberships/invitation.routes.ts`
- Web: `pages/AccountEmailPages.tsx`, `components/account.tsx`
- Tests: `apps/api/test/support-ops.test.ts`, `apps/web/src/pages/Support.test.tsx`,
  `e2e/support.spec.ts`

## Mail boundary

Flows ask for a templated message (`password_reset`, `email_verification` or `invitation`) in the
recipient's language. `MAIL_PROVIDER` decides what happens to it:

| Value | Behavior |
| ----- | -------- |
| `none` (default) | Nothing is sent. Every flow still gives the same answer. The invitation screen says plainly that no message was sent. |
| `dev_sink` | Messages are stored in `dev_mail_sink` (kept 24 hours). Platform administrators can read them in the operator console under "Development mail". Env validation refuses this in production. |

- Templates are plain text in Arabic and English.
- Links use `APP_BASE_URL`, which is required in production once mail is enabled.
- A real provider implements the same `Mailer` interface. To set one up, the owner must:
  - choose the provider;
  - verify the sending domain (SPF, DKIM, DMARC);
  - provide an API key in the server environment, never in Git.

## Tokens

| Purpose | Lifetime | Spent by |
| ------- | -------- | -------- |
| `password_reset` | 60 min | `POST /api/v1/auth/password-reset/confirm` |
| `email_verification` | 24 h | `POST /api/v1/auth/email-verification/confirm` |
| `invitation` | 7 days | `POST /api/v1/invitations/accept`, signed in with the invited address |

- **Generation and storage.** A token is 32 random bytes. Only its SHA-256 hash is stored, in
  `account_tokens`.
- **Single use.** Spending a token is one conditional update (unused, unrevoked, unexpired). Two
  concurrent attempts produce exactly one success (tested).
- **Replacement.** A new reset or verification link revokes the older unused ones.
- **Cleanup.** Spent and expired tokens are removed 7 days after expiry (TTL).
- **Links.** The token travels in the link's query string. The reset and verification pages
  remove it from the address bar as soon as they load. API request logs never include query
  strings.

## Flows

- **Password reset request.**
  - The response is `202 {accepted: true}`, the same whether or not the account exists. It is
    rate limited.
  - The remaining difference is timing. When the account exists, the server also writes a token
    and a message. This is documented, not hidden.
- **Password reset confirm.**
  - Sets the new password.
  - **Ends every session of the account**, including the one on the current device.
- **Email verification.**
  - Requesting requires a session and the CSRF token.
  - Confirming marks the address verified, and only if it is still the address the link was
    sent to.
  - Verification **does not gate** anything yet. Requiring a verified email is a policy decision
    (it ties into MFA, Q12).
- **Invitations.**
  - Owners and admins invite an address with an assignable role and a branch scope. Invitations
    count against the members entitlement when enforcement is on.
  - The response never says whether the address already has an account. The only exception is
    that it is already a member of this organization.
  - **Preview** (`POST /api/v1/invitations/preview`) shows the organization, the role and the
    invited address to whoever holds the link.
  - **Accept** requires being signed in with **the invited address**:
    - With a different address, the response is `403 INVITATION_EMAIL_MISMATCH` and the invitation
      stays usable.
    - Signing in or registering from the invitation page returns to it.
  - Owners and admins can list and revoke pending invitations.
  - The audit records the role and branch scope, never the address.

## Not included

- Email change.
- Account deletion.
- Bounce or complaint handling.
- Sending real messages: blocked on the provider decision.
