import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyNicknameCutoverRecord, createNicknameCutoverSummary,
  accumulateNicknameCutover, evaluateNicknameCutoverGate,
} from '../maintenance/nickname-cutover-inventory.policy.mjs';

const normalizeNickname = text => typeof text === 'string' && text.trim()
  ? { key: text.trim().toLowerCase().replace(/\s+/g, '_') }
  : null;
const valid = {
  uid: 'owner',
  user: {
    uid: 'owner', nickname: 'Perfil Teste', profileCompleted: true,
    accountStatus: 'active', publicVisibility: 'visible',
    interactionBlocked: false,
  },
  publicProfile: { uid: 'owner', nickname: 'Perfil Teste', nicknameNormalized: 'perfil_teste' },
  index: { uid: 'owner', type: 'nickname', value: 'perfil_teste' },
  reservation: { uid: 'owner', key: 'perfil_teste', state: 'RESERVED' },
  normalizeNickname,
};
const classify = overrides => classifyNicknameCutoverRecord({ ...valid, ...overrides });

test('canonical complete owner is ready', () => {
  assert.deepEqual(classify({}), { category: 'READY', flags: [] });
});
test('not completed account is separate from anomalies', () => {
  assert.equal(classify({ user: { ...valid.user, profileCompleted: false } }).category,
    'INCOMPLETE');
  assert.deepEqual(classify({ user: { ...valid.user, uid: 'other' } }).flags,
    ['INVALID_OWNER']);
});
test('missing index and reservation produce two independent signals', () => {
  assert.deepEqual(classify({ index: null, reservation: null }).flags,
    ['MISSING_RESERVATION', 'INDEX_MISSING']);
});
test('foreign index owner and reservation cannot pass validation', () => {
  assert.deepEqual(classify({
    index: { ...valid.index, uid: 'other' },
    reservation: { ...valid.reservation, uid: 'other' },
  }).flags, ['RESERVATION_CONFLICT', 'INDEX_CONFLICT']);
});
test('public projection mismatch and reservation corruption are flagged', () => {
  assert.deepEqual(classify({
    publicProfile: { ...valid.publicProfile, nicknameNormalized: 'alias' },
    reservation: { ...valid.reservation, state: 'RELEASED' },
  }).flags, ['RESERVATION_INVALID', 'PUBLIC_PROFILE_MISMATCH']);
});
test('hidden owners must not have a public nickname index', () => {
  const user = { ...valid.user, publicVisibility: 'hidden' };
  assert.equal(classify({ user, index: null }).category, 'NOT_PUBLIC');
  assert.deepEqual(classify({ user }).flags, ['HIDDEN_INDEX_STILL_PRESENT']);
  assert.equal(classify({
    user: { ...valid.user, suspended: true }, index: null,
  }).category, 'NOT_PUBLIC');
});
test('aggregate output contains no owner names or UIDs', () => {
  const s = createNicknameCutoverSummary();
  accumulateNicknameCutover(s, classify({}));
  accumulateNicknameCutover(s, classify({ reservation: null }));
  accumulateNicknameCutover(s, classify({
    user: { ...valid.user, profileCompleted: false },
  }));
  assert.equal(s.scannedUsers, 3);
  assert.equal(s.completedUsers, 2);
  assert.equal(s.review, 1);
  assert.equal(s.flags.MISSING_RESERVATION, 1);
  assert.equal(JSON.stringify(s).includes('owner'), false);
  assert.deepEqual(evaluateNicknameCutoverGate(s, { truncated: false }).reasons,
    ['REQUIRES_RECONCILIATION']);
});
test('incomplete scan or no records cannot authorize cutover', () => {
  const s = createNicknameCutoverSummary();
  accumulateNicknameCutover(s, classify({}));
  assert.deepEqual(evaluateNicknameCutoverGate(s).reasons, ['INCOMPLETE_SCAN']);
  assert.equal(evaluateNicknameCutoverGate(s, { truncated: false }).inventoryClean,
    true);
  assert.equal(evaluateNicknameCutoverGate(createNicknameCutoverSummary(),
    { truncated: false }).inventoryClean, false);
});
