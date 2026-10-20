import assert from 'node:assert/strict';
import test from 'node:test';

import {
  reconcileVideoTriageFixture, reconcileVideoTriageClosedEpochFixture,
  type VideoTriageFixtureRecord, type VideoTriageFixturePage,
  type VideoTriageFixtureMutation,
} from './admin-video-triage-audit-session.policy';
import { VIDEO_TRIAGE_BACKFILL_STATES } from './admin-video-triage-backfill.firestore';

const initial: VideoTriageFixtureRecord[] = [
  { id: 'fixture-A', state: 'QUEUED', revision: 'v1' },
  { id: 'fixture-B', state: 'PROCESSING', revision: 'v1' },
];

function pages(
  observed: ReadonlyArray<VideoTriageFixturePage>
): VideoTriageFixturePage[] {
  return VIDEO_TRIAGE_BACKFILL_STATES.map(state =>
    observed.find(page => page.state === state) ?? {
      state, afterId: null, ids: [], hasMore: false, nextCursor: null,
    });
}

test('c18m fully stable emulator fixture can reconcile without granting global proof', () => {
  const input = pages([
    { state: 'QUEUED', afterId: null,
      ids: ['fixture-A'], hasMore: false, nextCursor: null },
    { state: 'PROCESSING', afterId: null,
      ids: ['fixture-B'], hasMore: false, nextCursor: null },
  ]);
  const result = reconcileVideoTriageFixture(initial, initial, input);
  assert.equal(result.status, 'FIXTURE_RECONCILED');
  assert.equal(result.baselineSize, 2);
  assert.equal(result.observedTotal, 2);
  assert.equal(result.uniqueObserved, 2);
  assert.equal(result.missingCount, 0);
  assert.equal(result.duplicateCount, 0);
  assert.equal(result.globalCoverageVerified, false);
  assert.equal(result.concurrentCursorSafetyVerified, false);
  assert.equal(result.globalOrderingEnabled, false);
});

test('c18m cross-lane swaps reveal duplicate and skip despite matching totals', () => {
  const moved: VideoTriageFixtureRecord[] = [
    { id: 'fixture-A', state: 'PROCESSING', revision: 'v2' },
    { id: 'fixture-B', state: 'QUEUED', revision: 'v2' },
  ];
  const input = pages([
    { state: 'QUEUED', afterId: null,
      ids: ['fixture-A'], hasMore: false, nextCursor: null },
    { state: 'PROCESSING', afterId: null,
      ids: ['fixture-A'], hasMore: false, nextCursor: null },
  ]);
  const result = reconcileVideoTriageFixture(initial, moved, input);
  assert.equal(result.observedTotal, result.baselineSize);
  assert.equal(result.uniqueObserved, 1);
  assert.equal(result.missingCount, 1);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.changedCount, 2);
  assert.equal(result.status, 'GAPS_OR_DUPLICATES');
  assert.equal(result.globalCoverageVerified, false);
});

test('c18m detects invalid cursors and inconclusive moving baseline', () => {
  const invalid = pages([
    { state: 'QUEUED', afterId: null,
      ids: ['fixture-A'], hasMore: true, nextCursor: null },
  ]);
  const problem = reconcileVideoTriageFixture(initial, initial, invalid);
  assert.equal(problem.invalidCursorPages, 1);
  assert.equal(problem.status, 'GAPS_OR_DUPLICATES');

  const incomplete = pages([
    { state: 'QUEUED', afterId: null,
      ids: ['fixture-A'], hasMore: false, nextCursor: null },
    { state: 'PROCESSING', afterId: null,
      ids: ['fixture-B'], hasMore: false, nextCursor: null },
  ]).slice(0, 1);
  const result = reconcileVideoTriageFixture(initial, initial, incomplete);
  assert.equal(result.lanesComplete, false);
  assert.equal(result.status, 'GAPS_OR_DUPLICATES');

  const onlyChanged = reconcileVideoTriageFixture(initial,
    [{ ...initial[0], revision: 'v2' }, initial[1]],
    pages([
      { state: 'QUEUED', afterId: null,
        ids: ['fixture-A'], hasMore: false, nextCursor: null },
      { state: 'PROCESSING', afterId: null,
        ids: ['fixture-B'], hasMore: false, nextCursor: null },
    ]));
  assert.equal(onlyChanged.status, 'INCONCLUSIVE');
  assert.equal(onlyChanged.changedCount, 1);
});

test('c18m rejects duplicate fixture IDs and unbounded traces', () => {
  assert.throws(() => reconcileVideoTriageFixture(
    [initial[0], initial[0]], initial, []), /Invalid or repeated/);
  assert.throws(() => reconcileVideoTriageFixture(
    initial, initial, new Array(101).fill({
      state: 'QUEUED', afterId: null,
      ids: [], hasMore: false, nextCursor: null,
    })), /Unbounded/);
});


const closedEpoch = {
  source: 'EMULATOR_TEST_WRITER_FENCE' as const,
  openedAt: 1_800_000_000_000, closedAt: 1_800_000_000_500,
  allFixtureWritersFenced: true, mutationCount: 0,
};

test('c18n stable closed fixture reconciles without production authority', () => {
  const read = pages([
    { state: 'QUEUED', afterId: null,
      ids: ['fixture-A'], hasMore: false, nextCursor: null },
    { state: 'PROCESSING', afterId: null,
      ids: ['fixture-B'], hasMore: false, nextCursor: null },
  ]);
  const result = reconcileVideoTriageClosedEpochFixture(
    initial, initial, read, closedEpoch, [], []);
  assert.equal(result.status, 'FIXTURE_RECONCILED');
  assert.equal(result.reason, 'NONE');
  assert.equal(result.requiredRepairReads, 0);
  assert.equal(result.globalCoverageVerified, false);
  assert.equal(result.concurrentCursorSafetyVerified, false);
  assert.equal(result.globalOrderingEnabled, false);
});

test('c18n state swaps require post-epoch rereads even when totals agree', () => {
  const after: VideoTriageFixtureRecord[] = [
    { id: 'fixture-A', state: 'PROCESSING', revision: 'v2' },
    { id: 'fixture-B', state: 'QUEUED', revision: 'v2' },
  ];
  const events: VideoTriageFixtureMutation[] = [
    { sequence: 1, id: 'fixture-A', before: initial[0],
      after: after[0] },
    { sequence: 2, id: 'fixture-B', before: initial[1],
      after: after[1] },
  ];
  const observed = pages([
    { state: 'QUEUED', afterId: null,
      ids: ['fixture-A'], hasMore: false, nextCursor: null },
    { state: 'PROCESSING', afterId: null,
      ids: ['fixture-A'], hasMore: false, nextCursor: null },
  ]);
  const epoch = { ...closedEpoch, mutationCount: 2 };
  const need = reconcileVideoTriageClosedEpochFixture(
    initial, after, observed, epoch, events, []);
  assert.equal(need.status, 'REPAIR_REQUIRED');
  assert.equal(need.requiredRepairReads, 2);
  assert.equal(need.detectedMissing, 1);
  assert.equal(need.detectedDuplicates, 1);
  assert.equal(need.globalCoverageVerified, false);
  const repaired = reconcileVideoTriageClosedEpochFixture(
    initial, after, observed, epoch, events, after);
  assert.equal(repaired.status, 'FIXTURE_RECONCILED');
  assert.equal(repaired.validatedRepairReads, 2);
  assert.equal(repaired.productionCostVerified, false);
  assert.equal(repaired.globalOrderingEnabled, false);
});

test('c18n rejects missing, forged, out-of-order and unclosed writer proof', () => {
  const changes: VideoTriageFixtureMutation[] = [
    { sequence: 1, id: 'fixture-A', before: initial[0],
      after: { ...initial[0], revision: 'v2' } },
  ];
  const after = [{ ...initial[0], revision: 'v2' }, initial[1]];
  const observed = pages([
    { state: 'QUEUED', afterId: null,
      ids: ['fixture-A'], hasMore: false, nextCursor: null },
    { state: 'PROCESSING', afterId: null,
      ids: ['fixture-B'], hasMore: false, nextCursor: null },
  ]);
  const epoch = { ...closedEpoch, mutationCount: 1 };
  const run = (
    events: readonly VideoTriageFixtureMutation[],
    fence = epoch
  ) => reconcileVideoTriageClosedEpochFixture(
    initial, after, observed, fence, events, after.slice(0, 1));
  assert.equal(run(changes).status, 'FIXTURE_RECONCILED');
  assert.equal(run([], epoch).reason, 'EPOCH_UNTRUSTED');
  assert.equal(run([{ ...changes[0], sequence: 2 }]).reason,
    'MUTATION_LOG_INVALID');
  assert.equal(run([{ ...changes[0],
    before: { ...initial[0], revision: 'forged' } }]).reason,
  'MUTATION_LOG_INVALID');
  assert.equal(run(changes, {
    ...epoch, allFixtureWritersFenced: false,
  }).reason, 'EPOCH_UNTRUSTED');
  const unexpected = [...observed];
  unexpected[0] = { ...unexpected[0], ids: ['fixture-A', 'fixture-B'] };
  assert.equal(reconcileVideoTriageClosedEpochFixture(
    initial, after, unexpected, epoch, changes, after.slice(0, 1)
  ).status, 'INCONCLUSIVE');
});

test('c18n reconciles fixture creation and deletion with targeted repair', () => {
  const newItem = { id: 'fixture-C', state: 'FAILED' as const,
    revision: 'v1' };
  const after = [initial[0], newItem];
  const changes: VideoTriageFixtureMutation[] = [
    { sequence: 1, id: 'fixture-B', before: initial[1], after: null },
    { sequence: 2, id: newItem.id, before: null, after: newItem },
  ];
  const observed = pages([
    { state: 'QUEUED', afterId: null,
      ids: ['fixture-A'], hasMore: false, nextCursor: null },
  ]);
  const epoch = { ...closedEpoch, mutationCount: 2 };
  const need = reconcileVideoTriageClosedEpochFixture(
    initial, after, observed, epoch, changes, []);
  assert.equal(need.status, 'REPAIR_REQUIRED');
  assert.equal(need.requiredRepairReads, 1);
  const verified = reconcileVideoTriageClosedEpochFixture(
    initial, after, observed, epoch, changes, [newItem]);
  assert.equal(verified.status, 'FIXTURE_RECONCILED');
  assert.equal(verified.finalSize, 2);
  assert.equal(verified.globalCoverageVerified, false);
});

test('c18n fails closed on incomplete lanes and oversized mutation journals', () => {
  const onePage = [{
    state: 'QUEUED' as const, afterId: null,
    ids: ['fixture-A'], hasMore: false, nextCursor: null,
  }];
  const skipped = reconcileVideoTriageClosedEpochFixture(
    initial, initial, onePage, closedEpoch, [], []);
  assert.equal(skipped.reason, 'CURSOR_OR_LANE_INVALID');
  assert.throws(() => reconcileVideoTriageClosedEpochFixture(
    initial, initial, pages([]), closedEpoch,
    new Array(41).fill({
      sequence: 1, id: 'fixture-A',
      before: initial[0], after: initial[0],
    }), []), /Unbounded/);
});
