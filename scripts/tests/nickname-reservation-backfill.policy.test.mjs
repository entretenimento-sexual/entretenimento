import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyNicknameBackfill } from '../maintenance/nickname-reservation-backfill.policy.mjs';

const normalize = (value) => typeof value === 'string'
  ? { key: value.toLowerCase().replace(/ /g, '_') }
  : null;
const base = {
  indexId: 'nickname:perfil_teste',
  indexData: { uid: 'owner', type: 'nickname', value: 'perfil_teste' },
  userData: { uid: 'owner', nickname: 'Perfil Teste' },
  reservationData: null,
  normalizeNickname: normalize,
};

test('the current index is sufficient without a separate reservation', () => {
  assert.equal(classifyNicknameBackfill(base), 'already');
});
test('reservation is idempotent for same UID, never overwritten for another UID', () => {
  assert.equal(classifyNicknameBackfill({
    ...base,
    reservationData: { uid: 'owner', key: 'perfil_teste', state: 'RESERVED' },
  }), 'already');
  assert.equal(classifyNicknameBackfill({
    ...base,
    reservationData: { uid: 'another', key: 'perfil_teste', state: 'RESERVED' },
  }), 'conflict');
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
    assert.equal(classifyNicknameBackfill({ ...base, ...change }), 'invalid');
  }
});
