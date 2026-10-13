# Account age authority and Media boundary

Status: **target architecture accepted; admission migration pending** (2026-10-13).

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

## Admission mismatch still to migrate

Current account-admission machinery still requires **trusted VERIFIED_ADULT**:
`accept-adult-self-declaration.handler.ts` defaults to
`AGE_ADMISSION_MODE=VERIFIED_REQUIRED`;
`adult-consent.handler.ts` checks `isTrustedAdultAgeDecision`;
`firestore-rules/_helpers.rules` uses
`canonicalAgeEligibilityAllowsTrustedAdultAccess` for registration; and
`register-flow.facade.ts` / `adult-content-consent.guard.ts` use the trusted
adult predicate during onboarding. This differs from the proposed model in
which a valid initial 18+ self declaration is an account-level admission basis
and stronger verification adds assurance later.

**Do not selectively relax only one gate:** a safe follow-up must align the
backend acceptance policy, immutable declaration evidence, registration rules,
registration UI/guard, consent, account lifecycle on underage evidence, emulator
rules tests, onboarding tests and the current `check-age-authority-boundary.mjs`
contract **in one coherent migration**. Incomplete/malformed records and
confirmed underage must remain fail-closed. Any release must document legal
and provider requirements and not accidentally admit known underage accounts.

No change in this document or the associated Media tests deploys a new
admission policy or alters live user eligibility.
