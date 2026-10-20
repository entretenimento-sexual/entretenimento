# Media video triage — c18k durable journal (emulator only)

This change is an offline, manually authorized audit protocol. It is **not**
a production migration, autonomous job scanner, scheduler, or global ordering
feature. The global readiness gate remains blocked.

## Transaction invariants

- The only supported one-page executor is the registered durable journal.
  The c18i `runOneVideoTriageAuditPage` method remains as a compatibility
  facade and calls the durable executor. Unregistered checkpoints fail closed
  before any job query.
- `CLAIMED` means a Firestore transaction has first reserved the complete
  conservative query-read upper bound. A page must never be read without it.
- Every settled attempt records its owner, generation, attempt UUID,
  evidence digest and opaque result digest within the same transaction that
  updates the ledger. `DUPLICATE` requires a matching applied receipt and
  matching evidence; an empty active lease is not sufficient.
- A timed-out attempt is marked `ABANDONED` even when the next claim is
  forbidden by the budget. Fencing generation increases on this terminal
  closure. No cursor or completed page credit is granted.
- `recoverDurableVideoTriageAuditAttempt` performs one journal document
  read, not a processing-jobs query. It returns applied, conclusively
  not applied, superseded, or inconclusive. An ambiguous settlement response
  is reconciled against the receipt before any further activity. A still-live
  attempt without a receipt is inconclusive, not an assumed failure or success.
- The transaction uses Firestore's document `readTime` as its shared time
  authority; caller time is only checked against a 120-second drift bound.
  Regressing server timestamps are rejected.
- The journal records `journalReservedOperations` as a worst-case envelope
  for claim, settlement and one recovery, capped by the signed maxPages.
  It is **not** a measurement of billed operations, transaction contention,
  repeated manual status reads or retried external calls. Production cost
  proof requires a separate measured reconciliation and load exercise.
- Evidence must match the lane, evaluation clock, reread totals, integrity
  count sum, query-read envelope and strictly advancing cursor shape.
  A malformed page leaves the reservation active and advances no cursor.

## Versioning and operator safety

c18k writes journal schema version 2. Existing schema 1 emulator records
cannot be silently recovered as if they carried attempt receipts. Recreate
an explicitly authorized, pristine local emulator session where appropriate;
no automatic schema migration is provided.

Test-only expiry simulation writes the dedicated emulator journal fixture,
never any processing job. The Emulator integration suite includes expired
budget, lost acknowledgement, replay, rejected conflicting evidence, skew
and the legacy facade barrier.

The c18k check does **not** prove global coverage under concurrent job
transitions, deployed Firestore index readiness, legacy backfill completeness,
continuous due-time maintenance, actual cost ceilings, or production activation.
Those need independent evidence and a separate explicit approval.
