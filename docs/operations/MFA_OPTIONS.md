# MFA options — not implemented (decision B6 / Q12)

raclinic does **not** offer multi-factor authentication today. This document lists the options so
the owner can decide. Nothing here is claimed as built.

## Who needs it first (proposal)

1. **Platform operators.** They see every organization's metadata and manage subscriptions.
   Recommendation: required before any production use.
2. **Owners and admins**, who manage team access.
3. **Doctors**, who read clinical records. This could be optional at first, then required by
   organization policy.

## Factors

| Option | Pros | Cons | Dependencies |
| ------ | ---- | ---- | ------------ |
| TOTP authenticator app (RFC 6238) | No per-message cost; works offline; widely understood | Users must install an app; needs recovery codes | None beyond a library; secrets stored encrypted |
| WebAuthn / passkeys | Phishing-resistant; good UX on modern phones | Device loss handling; older devices | Browser support; recovery process |
| SMS one-time codes | Familiar in Egypt and Saudi Arabia | SIM-swap risk; per-message cost; sender registration | SMS provider and budget (E7), consent rules |
| Email one-time codes | No extra app | Weak if the email account is compromised | Email provider (E2) |

**Recommendation:** TOTP plus recovery codes first, with passkeys next. Avoid SMS as the only
factor.

## Design notes for later

- **Enrollment:** shown as a QR code, confirmed with a first code. Recovery codes are hashed and
  can each be used once.
- **Step-up:** require a second factor at sign-in, and again for sensitive actions. Examples:
  operator subscription changes, and the clinical-lead coverage grant once enabled.
- **Loss:**
  - operators: reset by CLI with an audit entry;
  - tenant users: an owner-assisted reset that ends sessions.
- **Sessions:** a session would record that MFA was completed. The idle timeouts already exist.

## Decisions needed

- Which roles must use MFA, and from when.
- Which factors.
- How recovery works and who is allowed to perform it.
- Budget, if SMS is chosen.
