# Issues #235/#236 — quarantine consistency for public media and community readers

## Decision (code-only, no data mutation)

The canonical 21 `PRIVATE_DISCOVERY_INTEREST_FIELDS` are private even when a contaminated historical `public_profiles/{uid}` has an otherwise valid identity. A backend/Admin SDK reader must not treat that document as publicly usable merely because it exists. The shared `hasLegacyPrivateDiscoveryFields()` policy is authoritative; do not duplicate or relax the 21 field names.

This stage extends the **same fail-closed hold** to:

- `evaluatePublicMediaOwnerExposure`: public media discovery, authorization and signed URL consumers through their common owner-exposure policy. A contaminated owner receives the same `OWNER_NOT_PUBLIC` reason as a missing public profile. Canonical lifecycle, bilateral block and moderation remain independent checks. The check does not inspect age assurance or change audience policy.
- `getCommunityMemberRosterPage`: public roster identity and pagination cursor cannot use a quarantined public profile.
- `getProfileOfficialCommunities` and `getOfficialCommunitiesForTarget` (only the profile target): no official association disclosure for contaminated profiles. Non-profile target types retain their existing behavior.

The change deliberately does not mutate `public_profiles`, preferences, recovery copies, approved media, or account deletion records. It does not perform or authorize deployment, migration, production deletion, or persistent recovery.

## Validation and evidence

1. Run new compiled policy and contract tests from `functions/`, not the repository root. They exercise all 21 private keys including an own key with `null` value.
2. Run existing Discovery policy, Community reader and Media exposure tests. Preserve Firestore Rules 338/338 and the media E2E gate.
3. CI `Discovery Legacy Recovery Transaction Guard` must pass Ubuntu and Windows; separate Quality Gate and Media E2E must pass for the exact same commit.
4. Review user-visible responses for generic, non-identifying denial states. Do not reveal private field names or which counterpart has blocked whom.
5. Issue #235 still needs manual two-browser Angular QA for Discovery, profile visited, gallery, chat, deep links, accessibility, cache, and bilateral revocation.

## Limitations and follow-ups

The read-only source inventory scans 97 files / 126 explicit references on the prior checkout and is **not** a proof that all backend or dynamic callers are safe. Community post/comment author hydration, other signed media flows, and non-explicit document-path builders need separate semantic review. Do not mark #235 or #236 closed on the basis of this stage alone.

Decision: `CODE_QUARANTINE_HOLD_PENDING_CI`; `REAL_SANITIZATION_BLOCKED`; `UI_TWO_SESSION_PENDING`.
