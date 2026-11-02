import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isStructuralProfileTypeChange } from './profile-identity-change.policy';
import { parseProfileIdentityCursor, projectIdentityReviewItem } from './profile-identity-review-queue.policy';

describe('profile identity review queue', () => {
  it('projetar somente campos necessários de pedidos pendentes', () => {
    const item = projectIdentityReviewItem('user_12', {
      status: 'PENDING', currentIdentityCode: 'mulher',
      requestedIdentityCode: 'homem', requestedAt: 1750000000000,
      email: 'private@example.test', history: ['do-not-disclose'],
    });
    assert.deepEqual(item, {
      uid: 'user_12', status: 'PENDING', currentIdentityCode: 'mulher',
      requestedIdentityCode: 'homem', requestedAt: 1750000000000,
      structuralChange: false,
    });
    assert.equal(projectIdentityReviewItem('user_12', {
      status: 'APPROVED', requestedAt: 1750000000000,
      currentIdentityCode: 'mulher', requestedIdentityCode: 'homem',
    }), null);
  });
  it('identificar alterações estruturais para bloquear aprovação simples', () => {
    assert.equal(isStructuralProfileTypeChange('mulher', 'casal-ele-ela'), true);
    assert.equal(isStructuralProfileTypeChange('casal-ele-ela', 'homem'), true);
    assert.equal(isStructuralProfileTypeChange('casal-ele-ela', 'casal-ela-ela'), false);
    assert.equal(isStructuralProfileTypeChange('mulher', 'homem'), false);
  });
  it('validar cursor antes de qualquer consulta', () => {
    assert.equal(parseProfileIdentityCursor(null), null);
    assert.deepEqual(parseProfileIdentityCursor({ requestedAt: 1700000000000, uid: 'uid-1' }),
      { requestedAt: 1700000000000, uid: 'uid-1' });
    assert.equal(parseProfileIdentityCursor({ requestedAt: -1, uid: 'uid-1' }), null);
    assert.equal(parseProfileIdentityCursor({ requestedAt: 1700000000000, uid: '/x' }), null);
  });
});
