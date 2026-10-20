import assert from 'node:assert/strict';
import test from 'node:test';

import {
  reconcileVideoTriageFixture, type VideoTriageFixtureRecord,
  type VideoTriageFixturePage,
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
