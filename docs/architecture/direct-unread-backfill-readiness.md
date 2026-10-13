# Direct unread backfill — operational readiness

Status: **NOT READY FOR PRODUCTION** (2026-10-13). This document describes the
experimental Firestore Emulator implementation, not a deployment procedure.

## Current safety boundary

- An isolated localhost Firestore Emulator and the project
  `demo-entretenimento` are required. External credentials are rejected.
- The CLI `--initialize-emulator CHAT_ID` processes one conversation at a time.
  No production Cloud Function export, scheduled job, or UI/badge switch is enabled.
- Only **1–100 messages** and exactly two valid participants are supported.
  Histories above 100 messages have an inconclusive audit and are not backfilled.
- Both participants' checkpoints and counters must agree before a resumed run.
  The per-message transaction checks the participant set and all message IDs
  again before writing. An inconsistent state aborts rather than self-heals.
- Failed runs can leave partial, transactionally committed checkpoints; validated
  retries are idempotent. Recovery outside that contract requires manual review.

## Workload model: estimates, not billing caps

Let `n` be the number of messages (1 <= n <= 100). A single successful run
may read the chat, messages, both projections and both checkpoint collections.
Each of the `n` reconciliations reads the bounded message set within its
Firestore transaction; the redundant nontransactional scan was removed.

The deliberately conservative model is:

| Metric | Formula | At 100 messages |
| --- | --- | ---: |
| Estimated document reads, no retry | `n² + 11n + 11` | 11,111 |
| Estimated document reads, up to 3 transaction attempts | `3n² + 27n + 23` | 32,723 |
| Maximum checkpoint/projection writes committed by one pass | `4n` | 400 |

The second estimate includes repeated reads by the two transactional audits
and each per-message reconciliation. Failed transaction writes are not counted
as committed writes. It does **not** bound actual billing: Firestore index-entry
reads, query minimums, additional concurrency or application-level retries,
other readers/writers and changes to SDK behavior may change total cost.
Emulator execution itself does not incur production Firestore billing.

The implementation checks the model before any backfill writes. These are
per-execution limits, **not** global concurrency limits or billing guarantees.

## Recovery and monitoring

- Review the dry-run consolidated conversation audit first. A mismatched,
  missing or inconclusive projection must not be silently declared healthy.
- The emulator initialization returns before/after classifications, processed
  message count and estimated workload. It does not expose message contents.
- On conflict or unexpected state, stop and investigate; a failed run does
  not mean its earlier committed transactions were rolled back.
- A successful run requires `MATCH` for both participants in the final audit.
- Operational logging, durable attempt journals, throughput limiting, alerts,
  authorization for operators, and fail-safe production rollback are **not**
  implemented.

## Release gates (all currently blocking)

1. Verify Quality Gate and deterministic emulator tests, including retries,
   conflicts, participant replacement, physical deletion and partial recovery.
2. Provide production-grade authorization, per-tenant quotas, concurrency
   control, resumable durable progress tracking and a kill switch.
3. Establish cost monitoring and real load estimates at expected scale;
   design a bounded snapshot-safe path for histories larger than 100 messages.
4. Define retention/privacy handling for historical checkpoints and establish
   a rollback/recomputation protocol for inconsistent projections.
5. Validate shadow comparisons independently before enabling a read path.
   Do not switch the badge or deploy the trigger during this phase.
