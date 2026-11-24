import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const read = (name: string) => readFileSync(
  join(__dirname, '../../../src/media/application', name), 'utf8'
);

test('photo removal revises gallery atomically in regular and orphan paths', () => {
  const source = read('delete-profile-photo.handler.ts');
  assert.match(source, /tx\.delete\(publicPhotoRef\)/);
  assert.equal(
    source.match(/publicMediaRevision:\s*FieldValue\.increment\(1\)/g)?.length,
    2
  );
  assert.match(source, /if \(publicProfile\.exists && currentProjection\.exists\)/);
  assert.match(source, /if \(publicProfile\.exists && currentPublication\.exists\)/);
  assert.doesNotMatch(source, /tx\.set\(publicProfileRef/);
});

test('video removal revises gallery in the same transaction as projection removal', () => {
  const source = read('video-profile-deletion-commit.firestore.ts');
  assert.match(source, /transaction\.delete\(publicVideoRef\)/);
  assert.match(source, /if \(publicProfile\.exists && publicVideo\.exists\)/);
  assert.match(source, /transaction\.update\(publicProfileRef,\s*\{\s*publicMediaRevision:\s*FieldValue\.increment\(1\)/);
  assert.doesNotMatch(source, /transaction\.set\(publicProfileRef/);
});
