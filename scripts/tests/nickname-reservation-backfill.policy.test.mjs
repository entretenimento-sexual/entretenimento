import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyNicknameIndex } from '../maintenance/nickname-index-inventory.policy.mjs';

const normalize = (value) => typeof value === 'string'
  ? { key: value.toLowerCase().replace(/ /g, '_') }
  : null;
const base = {
  indexId: 'nickname:perfil_teste',
  indexData: { uid: 'owner', type: 'nickname', value: 'perfil_teste' },
  userData: { uid: 'owner', nickname: 'Perfil Teste' },
  normalizeNickname: normalize,
};

test('the current index is sufficient without a separate reservation', () => {
  assert.equal(classifyNicknameIndex(base), 'already');
});
test('validates the principal already stored on the account', () => {
  assert.equal(classifyNicknameIndex({
    ...base,
    indexId: 'nickname:perfil',
    indexData: { ...base.indexData, value: 'perfil' },
    userData: { ...base.userData, nicknameNormalized: 'perfil' },
    normalizeNickname: (_value, key) => ({ key }),
  }), 'already');
});
test('forged key, mismatched UID, absent user or invalid record is never claimed', () => {
  const bad = [
    { indexId: 'nickname:alias_falso' },
    { indexData: { uid: 'other', type: 'nickname', value: 'perfil_teste' } },
    { userData: null },
    { userData: { uid: 'owner', nickname: 'Outro Nome' } },
    { indexData: { uid: 'owner', type: 'email', value: 'perfil_teste' } },
  ];
  for (const change of bad) {
    assert.equal(classifyNicknameIndex({ ...base, ...change }), 'invalid');
  }
});
