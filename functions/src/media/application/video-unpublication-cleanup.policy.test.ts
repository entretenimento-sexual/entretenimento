import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { canCleanupUnpublishedVideoInteractions } from './video-unpublication-cleanup.policy';

const cleanup = (isPublished: unknown, identityState: unknown, deletionRequested: boolean) =>
  canCleanupUnpublishedVideoInteractions({ isPublished, identityState, deletionRequested });

test('VF1-B3.4 old and duplicate events cannot purge registered publication', () => {
  assert.equal(cleanup(true, 'REGISTERED', true), false);
  assert.equal(cleanup(false, 'REGISTERED', true), false);
  assert.equal(cleanup(null, 'REGISTERED', false), false);
  assert.equal(cleanup(false, null, false), false);
});

test('VF1-B3.4 retired and legacy deletion states may clean idempotently', () => {
  assert.equal(cleanup(null, 'RETIRED', false), true);
  assert.equal(cleanup(false, 'RETIRED', true), true);
  assert.equal(cleanup(null, null, true), true);
  assert.equal(cleanup(true, 'RETIRED', true), false);
});

test('cleanup trigger re-reads canonical publication and permanent identity before deletion', () => {
  const handler = readFileSync(resolve(__dirname,
    '../../../src/media/application/cleanup-unpublished-video-interactions.handler.ts'), 'utf8');
  assert.match(handler, /publicationRef\.get\(\)/);
  assert.match(handler, /identityRef\.get\(\)/);
  assert.match(handler, /deletionRef\.get\(\)/);
  assert.match(handler, /if \(!canCleanupUnpublishedVideoInteractions\(/);
});
