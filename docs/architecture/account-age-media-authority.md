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

## Lifecycle revocation contract (backend and Rules)

Account lifecycle is the authority for a restricted owner, whether a public
projection has already been deleted or is still present. A newly discovered
safety concern can first set `interactionBlocked=true` and
`publicVisibility=hidden`; trusted confirmation sets
`accountStatus=moderation_suspended`, `suspended=true`, and preserves
account-level status/review access.

The following paths now reject or omit restricted accounts without querying
age-assurance records in product domains:

| Path | Lifecycle enforcement |
| --- | --- |
| Chat, Media consumption and publishing, discovery requester | Canonical `assertInteractionAccess`, including `accountLocked` and `loginAllowed` |
| Public photo and video owner eligibility | Shared `account_lifecycle/public-owner-exposure.policy.ts` |
| Firestore profile/photo/video direct reads | `canonicalOwnerLifecycleAllowsPublicMediaExposure` checks suspension, visibility and account/interactions locks |
| Public profile discovery (UID, nickname, nearby, cursor) | Batch-check `users/{uid}` before returning any candidate |
| Public "Status de Hoje" discovery | Batch-check status owner account before returning public status |

The lifecycle checks consume additional Firestore reads, independent of
assurance. Public-profile discovery now examines **at most 480** candidate
profiles per call (at most four times a 120-item page), and revalidates
candidate owners in batches of at most 120. UID lookups remain bounded to
50 and public intent-status results to 60 owner lookups. This raises
read costs during heavily filtered searches; actual billing must be measured.

Cursor-based discovery accumulates visible items across bounded batches and
sets the next cursor to the **last item actually returned**, rather than the
last prefetched candidate. Nickname-prefix and nearby searches can also
replace excluded candidates within the same bounded scan, but do not yet
offer cursors. Results may legitimately remain underfilled when the scan
budget is exhausted. Lifecycle data is authoritative; stale public projections
never override it.

Account flags, rather than `SELF_DECLARED_ADULT` or `VERIFIED_ADULT`,
control access once a valid account has been admitted. Content-minor
safety still uses an independent Media assessment/moderation authority.

## Restoring access after successful age review

Review approval is not a universal unsuspend operation. The canonical
`resolveAgeReviewRestoration` requires the age-review restriction marker,
hidden profile and blocked interactions, plus a currently compatible account
status and **no unrelated account lock, disabled login or active automation
hold**. An age-owned suspension must also match the exact review case and
moderator suspension source. The review decision can update account assurance
without automatically restoring exposure where this proof is absent.

Case ownership is represented by existing markers, not by a complete per-flag
provenance ledger. Operations that introduce independent restrictions must
preserve their own ownership and cannot rely on age-review approval to clear
them. Before production rollout, include end-to-end tests for concurrent
independent restrictions and audited manual recovery of ambiguous histories.

## Signed media URLs, cached access and playback revocation

Account lifecycle controls **new authorization decisions**, not the validity
of a previously minted cloud-storage signature. Public photo/video access
Functions re-check requester account access, owner lifecycle, bilateral blocks,
publication and moderation on each **new** signed URL request. Their current
technical URL lifetime is **five minutes**, further constrained by applicable
account access deadlines. A URL already delivered can remain independently
usable until cryptographic expiry even if the owner is suspended.

Video playback-session tokens are now persisted only after a Firestore
transaction re-reads the owner account lifecycle and video publication state.
Metrics for photo views, video views and video retention also re-check the
canonical owner account inside their write transactions. Their transactions now
also revalidate the viewer's canonical Account Access, including terms/consent
and lifecycle, without inspecting age assurance. Photo views already validate
friend audience and bilateral block atomically; video playback issuance, video
views and retention also re-check blocks in both directions before writing.
A token already issued cannot authorize **new metric writes** after a committed
restriction or block. This does not revoke downloaded bytes or signed URLs.
Expect one extra viewer read per metric transaction and two block reads per
video transaction attempt. Track billing and retries before lifting quotas.

The browser's signed URL cache is session-scoped and expiry-bounded, but it
does not cryptographically revoke already downloaded content or signed links.
For genuinely immediate binary revocation, investigate short-lived
authorization through a revocable backend/CDN delivery boundary; do not
misrepresent clearing browser state or stopping new signatures as retroactive
URL revocation. Such a delivery system is **not implemented**.

Media must not independently check `SELF_DECLARED_ADULT` or
`VERIFIED_ADULT`. All account restrictions are lifecycle decisions, while
suspected minors in media files are handled by the independent content-safety
moderation authority.

## Release and operational cautions

The admission policy has changed in source control, not in production. Before
deploying, obtain a successful aggregate CI (including emulator Rules and
onboarding tests), review explicit legal/compliance constraints for the
platform jurisdiction, test registration with valid and malformed historical
records and confirm trusted underage evidence is enforced through account
lifecycle. Do not treat self declaration as equivalent to independently
verified age, and do not roll out an admission-policy change by deploying a
subset of backend, Rules and UI.
