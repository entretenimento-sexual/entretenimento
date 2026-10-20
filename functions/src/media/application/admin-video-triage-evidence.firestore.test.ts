import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAuthenticatedTriageIndexPage,
  TRIAGE_INDEX_METADATA_PAGE_SIZE,
} from './admin-video-triage-evidence.firestore';
import { matchesVideoTriageIndexManifest } from './admin-video-triage-readiness.policy';

const project = 'entretenimento-test';
const prefix = 'projects/' + project + '/databases/(default)/collectionGroups/' +
  'media_video_processing_jobs/indexes/';
const fields = (paths: string[]) =>
  paths.map(fieldPath => ({ fieldPath, order: 'ASCENDING' }));
const index = (name: string, paths: string[], state = 'READY') =>
  ({ name: prefix + name, state, queryScope: 'COLLECTION', fields: fields(paths) });

test('c18h parses real REST index envelope with bounded project/database identity', () => {
  const indexes = [
    index('a', ['adminTriageTier', 'adminTriageSince', '__name__']),
    index('b', ['adminTriageReevaluateAt', '__name__']),
  ];
  const parsed = parseAuthenticatedTriageIndexPage({ indexes }, project);
  assert.equal(parsed.hasMore, false);
  assert.equal(matchesVideoTriageIndexManifest(parsed.indexes), true);
  const partial = parseAuthenticatedTriageIndexPage({
    indexes, nextPageToken: 'next',
  }, project);
  assert.equal(partial.hasMore, true);
  const building = parseAuthenticatedTriageIndexPage({
    indexes: [indexes[0], index('b', [
      'adminTriageReevaluateAt', '__name__',
    ], 'CREATING')],
  }, project);
  assert.equal(matchesVideoTriageIndexManifest(building.indexes), false);
});

test('c18h fails closed for cross-project, foreign database and oversized index metadata', () => {
  const good = index('safe', ['adminTriageTier', 'adminTriageSince', '__name__']);
  for (const input of [
    null, [], { indexes: {} },
    { indexes: [{ ...good, name: good.name.replace(project, 'foreign') }] },
    { indexes: [{ ...good, name: good.name.replace('(default)', 'foreign') }] },
    { indexes: [{ ...good, name: prefix + '../bad' }] },
    { indexes: [{ ...good, fields: [{ fieldPath: 7, order: 'ASCENDING' }] }] },
    { indexes: Array.from({ length: TRIAGE_INDEX_METADATA_PAGE_SIZE + 1 },
      () => good) },
    { indexes: [], nextPageToken: 42 },
  ]) assert.throws(() => parseAuthenticatedTriageIndexPage(input, project));
  assert.throws(() => parseAuthenticatedTriageIndexPage({}, '../bad'));
});
