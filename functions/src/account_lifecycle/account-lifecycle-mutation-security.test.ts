import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function source(relativePath: string): string {
  return readFileSync(
    path.resolve(process.cwd(), 'src', 'account_lifecycle', relativePath),
    'utf8'
  );
}

const MUTATION_HANDLERS = [
  'requestSelfSuspension.ts',
  'reactivateSelfSuspension.ts',
  'requestAccountDeletion.ts',
  'cancelAccountDeletion.ts',
  'moderateSuspendAccount.ts',
  'moderateUnsuspendAccount.ts',
  'moderateScheduleDeletion.ts',
] as const;

test('all account lifecycle mutations use the canonical security boundary', () => {
  for (const file of MUTATION_HANDLERS) {
    const current = source(file);

    assert.equal(
      current.includes('assertAccountLifecycleMutationSecurity'),
      true,
      `${file} must use account lifecycle mutation security`
    );
    assert.equal(
      current.includes('appContext: request.app'),
      true,
      `${file} must pass callable App Check context`
    );
  }
});

test('canonical lifecycle mutation security requires App Check and backend rate limit', () => {
  const security = source('account-lifecycle-mutation-security.ts');

  assert.equal(security.includes('assertCallableAppCheck(input.appContext)'), true);
  assert.equal(security.includes('consumeBackendRateLimitQuota({'), true);
  assert.equal(security.includes('action: `account-lifecycle:${input.action}`'), true);
});

test('staff lifecycle mutations authorize staff before consuming mutation quota', () => {
  for (const file of [
    'moderateSuspendAccount.ts',
    'moderateUnsuspendAccount.ts',
    'moderateScheduleDeletion.ts',
  ]) {
    const current = source(file);
    const authorizationIndex = current.indexOf('await assertStaffAuthorization({');
    const securityIndex = current.indexOf(
      'await assertAccountLifecycleMutationSecurity({'
    );

    assert.ok(authorizationIndex >= 0, `${file} must authorize staff`);
    assert.ok(securityIndex > authorizationIndex, `${file} security ordering drift`);
  }
});
