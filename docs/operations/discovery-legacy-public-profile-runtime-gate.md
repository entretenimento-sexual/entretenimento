# Issue #236 — runtime hold of residual legacy private preferences

## Operational outcome

The B2.1 checkpoint-copy/verify/rollback exercise and 338/338 Rules tests passed
locally on 2026-11-07, but they are NOT a verified persistent recovery. This
change does not access that checkpoint or authorize any real-data modification.

- A single shared policy uses the canonical 21-field private-interest allowlist.
- Both Firestore triggers hold **routine mutation** of a `public_profiles/{uid}`
  document with any legacy private key while a non-deleting owner still exists.
  Existing private values remain quarantined by the Firestore Rules; their
  presence NEVER grants public visibility.
- The preference trigger may still hide an unrelated public intent status when
  the owner revokes intent visibility. This is not a legacy source deletion.
- Real account deletion/purge is higher priority; it is not blocked by this
  preservation hold. No retention outside the account lifecycle is authorized.
- The administrative backfill becomes strictly read-only. Requests asking for
  `dryRun:false` are rejected; no batch mutation path remains. Maintenance
  writers must use a separately reviewed and authorized operation.
- The backend discovery serializer rejects a public document containing any
  legacy private key instead of returning a partial card. This covers
  discovery pagination, direct UID hydration, nearby, and nickname search
  through `get-public-profiles-page` because they all use that serializer.
  Other Admin SDK or backend readers require independent auditing before deploy.

## Safety and verification gates

1. Unit test the pure hold policy for all 21 fields, clean profiles, blocked
   accounts, deleted accounts, and forged approval hints.
2. Unit test the administrative dry-run policy and the backend serializer.
3. Run the source-level integration contract on Windows and Linux.
4. Compile Cloud Functions, run the broader tests, Rules and quality gates.
5. Do not interpret CI success as a persistent-copy authorization.

## Explicit limitations

This is a code-only guard. It is not an automated sanitization, credential
scheme, recovery data writer, consent flow, migration, deployment, or production
fix. Existing contaminated public documents remain unreadable by third parties
under canonical Rules; the backend discovery serializer must also exclude them.
No production or primary emulator writes are performed by installing/testing
this patch. Stored legacy values remain pending independent review and a
verifiable private copy before any authorized field-specific deletion.

Decision: `REAL_SANITIZATION_BLOCKED` and `PERSISTENT_RECOVERY_BLOCKED`.
