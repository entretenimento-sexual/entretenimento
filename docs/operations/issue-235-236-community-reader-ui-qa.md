# Issues #235/#236 — community public-profile reader boundary and UI acceptance

## Scope and decision

Base commit: `2e8f234ac5f952f0f1bf8e86f72d6f8bea783249`. This patch changes **code and tests only**. The B2.9.3g synthetic preservation/sanitization/rollback E2E was certified by GitHub Actions on Windows and Ubuntu, along with Quality Gate and Media E2E on 2026-11-07. The real-data persistence/sanitization decision remains **BLOCKED**.

This delivery extends the canonical 21-key legacy private-field exclusion to:
- `getProfilePublicCommunities` resolving `public_profiles` by public `profileId`;
- `buildCommunityMemberSearchIndexProjection`, which is used both in the community member index trigger and in the callable search revalidation;
- `communityMemberSearchPublicProfileFingerprint`: a **boolean-only** contamination transition triggers deletion/recreation of a stale index when a public document changes. No private values enter the index or public output.

Existing public discovery serializer, Firestore Rules and lifecycle/bilateral checks are **not relaxed**. Clean profiles are unaffected. These tests are necessary but do not prove comprehensive safety of other Admin SDK paths.

## Backend reader inventory (read-only)

Run from a clean project root:

```
node scripts/quality/audit-public-profile-readers.mjs --check-known
node scripts/quality/audit-public-profile-readers.mjs --json
```

The script scans executable-line references to the literal `public_profiles` in `functions/src` and `scripts/maintenance`; it only reports filenames and line numbers. It does not read document data, write reports to disk, connect to Firebase or classify authorization. **Review every reported production reader** for (a) parent-document reads versus subcollections, (b) return payloads or projections, (c) lifecycle and bilateral access, (d) explicit 21-key fail-closed guard, and (e) stale caches/indexes. Dynamic path construction is not guaranteed to be found. The `--check-known` PASS is **inventory coverage only**, not a security certification.

## Issue #235 — manual Angular two-session acceptance, emulators only

Prepare two adult, eligible **synthetic users A and B** in independent browser profiles, with an existing eligible friendship/chat thread. Do not use real personal data. Do not run `npm ci` while Angular or emulator processes are active.

| ID | Action in browsers | Expected observable evidence | Result | Evidence reference |
|---|---|---|---|---|
| UI-01 | A and B view each other's discovery cards, visited profile, allowed photo/video and chat before block | Only authorized surfaces are visible | NOT RUN | — |
| UI-02 | A blocks B from visited profile while discovery is open | A immediately loses actions; B card disappears without full reload | NOT RUN | — |
| UI-03 | A navigates away/back; reload cached discovery in second tab of A | No stale card or action; own block propagation updates | NOT RUN | — |
| UI-04 | In B, refetch discovery and open A via direct profile URL | Backend denies; generic UI with no blocker identity | NOT RUN | — |
| UI-05 | B opens previously authorized photo/video URLs and tries chat send | No unauthorized media access or new message; thread history retained per policy | NOT RUN | — |
| UI-06 | B blocks A; then A unblocks B | B's remaining block continues to deny reciprocal access | NOT RUN | — |
| UI-07 | Both unblock and refetch | Only currently authorized access returns; former friendship not silently restored | NOT RUN | — |
| UI-08 | Simulate error and pending request while block is applied | Accessible loading/retry/error; centralized handling via global-error-handler and error-notification services | NOT RUN | — |
| UI-09 | Keyboard, screen reader labels, responsive mobile and desktop | Focus, 44px target where applicable, no inaccessible controls or broken navigation | NOT RUN | — |
| UI-10 | Inspect Network/Firestore listeners in two sessions | No client reads of `users/{otherUid}/blocks`; no IDs or private data in feedback; no per-card block listeners | NOT RUN | — |
| UI-11 | With synthetic legacy fields in isolated emulator, open Discovery, direct profile, community member search and public communities tab | No third-party card, membership disclosure or index result; original fields preserved | NOT RUN | — |
| UI-12 | Repeat UI-11 for clean synthetic profile | Normal authorized surface remains available | NOT RUN | — |

Record date/time, browser versions, tested commit, emulated service configuration, screenshot filename and **sanitized** Network snippets per case. Record FAIL and reproduce defects before issue closure; do not precheck any NOT RUN line. Retest failures after a targeted fix. No deploy or production data changes are authorized by this checklist.

## Remaining decision barriers

- Issue #236: private legacy copy, provenance, owner consent, retention and independent approval for any real sanitization remain unresolved. Runtime hold must remain.
- Issue #235: UI evidence in two independent sessions, including routing, media and chat, remains unexecuted here.
- Unknown Admin SDK readers from inventory still need semantic classification. A textual scan is not a complete call graph.
- No commits or pushes from this package. Full local tests and remote CI certification must pass before any subsequent release decision.
