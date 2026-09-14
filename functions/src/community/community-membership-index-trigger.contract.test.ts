import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function readTriggerSource(filename: string): string {
  return readFileSync(
    resolve(process.cwd(), `src/community/${filename}`),
    'utf8'
  );
}

test('índice privado relê membership canônico dentro de transação', () => {
  const source = readTriggerSource('sync-community-user-index.trigger.ts');

  assert.match(source, /await db\.runTransaction\(async \(transaction\) =>/);
  assert.match(source, /transaction\.get\(membershipRef\)/);
  assert.match(source, /transaction\.get\(communityRef\)/);
  assert.doesNotMatch(source, /event\.data\?\.after/);
});

test('locator público relê membership canônico dentro de transação', () => {
  const source = readTriggerSource(
    'sync-community-profile-membership-index.trigger.ts'
  );

  assert.match(source, /await db\.runTransaction\(async \(transaction\) =>/);
  assert.match(source, /transaction\.get\(membershipRef\)/);
  assert.doesNotMatch(source, /event\.data\?\.after/);
});
