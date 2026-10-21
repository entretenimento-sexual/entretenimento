import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { canCleanupUnpublishedVideoInteractions } from './video-unpublication-cleanup.policy';

const cleanup = (isPublished: unknown, identityState: unknown, deletionRequested: boolean,
  publicationExists = true) => canCleanupUnpublishedVideoInteractions({
  isPublished, identityState, deletionRequested, publicationExists,
});

test('VF1-B3.4 delayed cleanup never purges a currently published video', () => {
  assert.equal(cleanup(true, 'REGISTERED', true), false);
  assert.equal(cleanup(true, 'RETIRED', true), false);
  assert.equal(cleanup(null, 'REGISTERED', false, false), false);
  assert.equal(cleanup(null, 'REGISTERED', true, false), false);
});

test('VF1-B3.4 explicitly unpublished legacy videos retain interaction cleanup', () => {
  assert.equal(cleanup(false, 'REGISTERED', false), true);
  assert.equal(cleanup(false, null, false), true);
  assert.equal(cleanup(false, 'RETIRED', true), true);
});

test('VF1-B3.4 retired deletion permits idempotent cleanup without publication', () => {
  assert.equal(cleanup(null, 'RETIRED', false, false), true);
  assert.equal(cleanup(null, null, true, false), true);
  assert.equal(cleanup(null, null, false, false), false);
});

test('cleanup trigger re-reads canonical publication and identity before deletion', () => {
  const handler = readFileSync(resolve(__dirname,
    '../../../src/media/application/cleanup-unpublished-video-interactions.handler.ts'), 'utf8');
  assert.match(handler, /transaction\.get\(publicationRef\)/);
  assert.match(handler, /transaction\.get\(identityRef\)/);
  assert.match(handler, /transaction\.get\(deletionRef\)/);
  assert.match(handler, /publicationExists: publication\.exists/);
});

test('VF1-B3.4 cleanup retires identity in transaction before recursive deletion', () => {
  const handler = readFileSync(resolve(__dirname,
    '../../../src/media/application/cleanup-unpublished-video-interactions.handler.ts'), 'utf8');
  assert.match(handler, /db\.runTransaction\(async \(transaction\)/);
  assert.match(handler, /transaction\.get\(publicationRef\)/);
  assert.match(handler, /transaction\.get\(identityRef\)/);
  assert.match(handler, /transaction\.update\(identityRef/);
  assert.match(handler, /transaction\.create\(identityRef/);
  assert.match(handler, /if \(!permitted\) return;\s*await db\.recursiveDelete\(publicVideoRef\)/);
});
