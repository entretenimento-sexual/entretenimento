# Account age authority and Media boundary

Status: **18+ admission implementation on main; CI verification pending** (2026-10-13).

## Canonical split

1. `age_eligibility_records/{uid}` is the backend-only source for account age
   eligibility/assurance. Registration is only for people aged 18 or older.
   `SELF_DECLARED_ADULT` and `VERIFIED_ADULT` are **account assurance
   levels**, not separate Media entitlements.
2. Once the account is legitimately admitted, an active authorized lifecycle
   (including legal terms/consent and restriction/suspension checks) is the
   product access authority. Photos, videos, feed, discovery, comments and
   playback must not independently enforce `VERIFIED_ADULT` or re-prompt
   for `SELF_DECLARED_ADULT`.
3. Stronger account assurance can be obtained later, especially after a safety
   signal or for future KYC/provider review. Verified evidence of underage
   must be enforced on account lifecycle and its dependent surfaces.
4. Authoring, publication, ranking, private/public asset access, and signed
   URL issuance must **not** use `ageEligibilityVerifiedAdult`,
   `ageEligibilityAssurance` or `ageEligibilityValidUntil` stored on
   photo/video documents as distribution authority.
5. Potential minors **inside the content** are assessed independently under
   the canonical `media-content-safety-assessment.policy.ts` and moderation
   workflow. Content safety does not infer the owner's age from account
   assurance, and account eligibility does not clear suspicious content.

## Verified current boundaries

- `account_lifecycle/interaction-access.policy.ts` checks the account state,
  terms and adult consent, not the age assurance projection.
- `media-authoring-eligibility.service.ts` and
  `public-media-consumption-access.policy.ts` delegate to Account Access.
- `public-media-exposure.policy.ts` considers owner lifecycle, visibility,
  bilateral block, publication and moderation, not legacy age fields.
- `media-content-safety-assessment.policy.ts` independently represents
  `UNASSESSED`, `POSSIBLE_MINOR`, `CONFIRMED_MINOR` and `CLEARED`.
- `check-age-authority-boundary.mjs` enforces the critical Media boundaries
  against future regressions; unit tests cover account-authoring and
  public-exposure behavior with conflicting legacy age fields.

## Account admission implementation

The following registration gates now use a canonical **adult admission**
decision instead of equating permission to join with strong verification:

- `age-eligibility.policy.ts` exposes `isAdultAccountAdmissionDecision`.
  It recognizes a valid `SELF_DECLARED_ADULT` or a truly trusted
  `VERIFIED_ADULT`, but never `DENIED_UNDERAGE`, `REVIEW_REQUIRED`,
  expired states or a forged/untrusted verified claim.
- `accept-adult-self-declaration.handler.ts` defaults to preserving a
  one-time backend-created adult declaration. An explicit
  `AGE_ADMISSION_MODE=VERIFIED_REQUIRED` remains an operational override.
- `adult-consent.handler.ts` checks account adult admission rather than
  strong assurance.
- `firestore-rules/_helpers.rules` accepts only a backend-created,
  correctly typed, dated 18+ declaration or trusted proof during the
  one-way registration completion. Client updates to the canonical record
  are still forbidden.
- `register-flow.facade.ts`, `adult-content-consent.guard.ts` and the
  age declaration screen advance valid self-declared accounts without
  repeatedly requesting strong verification. Already admitted accounts
  continue to depend on account lifecycle/legal/consent, not assurance.
- Rules tests verify valid declaration admission and rejection of underage,
  open review, missing timestamp and mismatched declaration evidence.

The optional strong-verification workflow is **not** a registration
prerequisite. The initial admission screen does not expose the review
request action, because opening a review there could transition the
canonical record into `REVIEW_REQUIRED` before admission. Follow-up
assurance/KYC must be surfaced in an account-level workflow with explicit
policy about whether a genuine safety concern requires a lifecycle hold.

No publication/distribution entitlement is derived from owner age-assurance
fields, and `media-content-safety-assessment.policy.ts` remains the separate
content-minor safety authority.

## Release and operational cautions

The admission policy has changed in source control, not in production. Before
deploying, obtain a successful aggregate CI (including emulator Rules and
onboarding tests), review explicit legal/compliance constraints for the
platform jurisdiction, test registration with valid and malformed historical
records and confirm trusted underage evidence is enforced through account
lifecycle. Do not treat self declaration as equivalent to independently
verified age, and do not roll out an admission-policy change by deploying a
subset of backend, Rules and UI.
