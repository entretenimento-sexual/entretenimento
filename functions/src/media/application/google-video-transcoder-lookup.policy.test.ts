import assert from 'node:assert/strict';
import test from 'node:test';

import { lookupUniqueTranscoderJob } from './google-video-transcoder-lookup.policy';

test('finds a matching job on page two without treating page one as absence', async () => {
  const seen: Array<string | undefined> = [];
  const result = await lookupUniqueTranscoderJob('version-a', async token => {
    seen.push(token);
    return token
      ? { jobs: [{ name: 'jobs/current', labels: { processing_version: 'version-a' } }] }
      : { jobs: [], nextPageToken: 'next-page' };
  });
  assert.equal(result?.name, 'jobs/current');
  assert.deepEqual(seen, [undefined, 'next-page']);
});

test('rejects duplicate provider jobs for the same version', async () => {
  await assert.rejects(
    lookupUniqueTranscoderJob('version-a', async () => ({
      jobs: [
        { name: 'jobs/first', labels: { processing_version: 'version-a' } },
        { name: 'jobs/second', labels: { processing_version: 'version-a' } },
      ],
    })),
    /Mais de um job/
  );
});

test('rejects circular provider page tokens instead of returning a false negative', async () => {
  await assert.rejects(
    lookupUniqueTranscoderJob('version-a', async () => ({
      jobs: [], nextPageToken: 'same-page',
    })),
    /Paginação circular/
  );
});

test('discards jobs with another label and returns null only at last page', async () => {
  const result = await lookupUniqueTranscoderJob('version-a', async () => ({
    jobs: [{ name: 'jobs/foreign', labels: { processing_version: 'version-b' } }],
  }));
  assert.equal(result, null);
});
