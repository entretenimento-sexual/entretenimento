import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function readHandlerSource(): string {
  return readFileSync(
    resolve(
      process.cwd(),
      'src/community/community-membership-profile-visibility.handler.ts'
    ),
    'utf8'
  );
}

test('visible falha data-loss quando o consentimento persistido está inválido', () => {
  const source = readHandlerSource();
  const classifier = source.indexOf(
    'classifyCommunityMembershipProfileVisibilityState(membership)'
  );
  const invalidGuard = source.indexOf(
    "persistedVisibilityState.kind === 'invalid'"
  );
  const dataLoss = source.indexOf("'data-loss'", invalidGuard);
  const invalidReason = source.indexOf(
    'community_membership_profile_visibility_invalid',
    invalidGuard
  );

  assert.ok(classifier >= 0);
  assert.ok(invalidGuard > classifier);
  assert.ok(dataLoss > invalidGuard);
  assert.ok(invalidReason > invalidGuard);
});

test('hidden repara corrupção em vez de considerá-la idempotente', () => {
  const source = readHandlerSource();
  const hiddenIdempotency = source.indexOf(
    "persistedVisibilityState.kind === 'hidden'"
  );
  const legacyIdempotency = source.indexOf(
    "persistedVisibilityState.kind === 'legacy_hidden'"
  );
  const update = source.indexOf('transaction.update(membershipRef');

  assert.ok(hiddenIdempotency >= 0);
  assert.ok(legacyIdempotency > hiddenIdempotency);
  assert.ok(update > legacyIdempotency);
  assert.doesNotMatch(
    source.slice(hiddenIdempotency, update),
    /persistedVisibilityState\.kind === 'invalid'/
  );
});
