import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canRequestIdentityChange, isStructuralProfileTypeChange,
  normalizeRequestedIdentityCode, PROFILE_IDENTITY_CHANGE_COOLDOWN_MS,
} from './profile-identity-change.policy';

const now = 1_800_000_000_000;
const check = (requestedCode: unknown, other: Record<string, unknown> = {}) =>
  canRequestIdentityChange({ currentCode: 'mulher', requestedCode, now, ...other });

describe('governança automática da identidade do perfil', () => {
  it('recusa códigos arbitrários e mantém opções do catálogo', () => {
    assert.equal(normalizeRequestedIdentityCode('nao-existe'), null);
    assert.equal(normalizeRequestedIdentityCode(null), null);
    assert.equal(normalizeRequestedIdentityCode('mulher'), 'mulher');
    assert.equal(check('foo'), 'invalid');
  });
  it('não modifica a identidade quando é a mesma', () => {
    assert.equal(check(' MULHER '), 'same-identity');
  });
  it('bloqueia toda mudança envolvendo casal, inclusive entre dois casais', () => {
    assert.equal(check('casal-ele-ela'), 'structural-change');
    assert.equal(isStructuralProfileTypeChange('casal-ele-ela', 'casal-ela-ela'), true);
    assert.equal(isStructuralProfileTypeChange('casal-ele-ela', 'homem'), true);
    assert.equal(check('homem'), 'allowed');
  });
  it('mantém intervalo de 90 dias entre alterações individuais aplicadas', () => {
    assert.equal(check('homem', { activeStatus: 'APPROVED',
      reviewedAt: now - PROFILE_IDENTITY_CHANGE_COOLDOWN_MS + 1 }), 'rate-limited');
    assert.equal(check('homem', { activeStatus: 'APPROVED',
      reviewedAt: now - PROFILE_IDENTITY_CHANGE_COOLDOWN_MS }), 'allowed');
    assert.equal(check('homem', { activeStatus: 'APPROVED',
      reviewedAt: now - 90_000 }), 'rate-limited');
  });
  it('não permite contornar cooldown substituindo o último registro de solicitação', () => {
    assert.equal(check('homem', { activeStatus: 'PENDING',
      lastAppliedAt: now - 1000 }), 'rate-limited');
    assert.equal(check('homem', { activeStatus: 'REJECTED',
      lastAppliedAt: now - 1000 }), 'rate-limited');
  });
  it('não deixa PENDING antigo nem rejeição antiga prender o usuário', () => {
    assert.equal(check('homem', { activeStatus: 'PENDING' }), 'allowed');
    assert.equal(check('homem', { activeStatus: 'REJECTED',
      reviewedAt: now - 1000 }), 'allowed');
  });
  it('requer revisão quando existe amizade estabelecida, independentemente do plano', () => {
    assert.equal(check('homem', { hasEstablishedSocialConnections: true }), 'review-required');
    assert.equal(check('homem', { hasEstablishedSocialConnections: false }), 'allowed');
    assert.equal(check('homem', { hasEstablishedSocialConnections: true,
      lastAppliedAt: now - 1 }), 'rate-limited');
  });
  it('não distingue perfis gratuitos, premium e VIP', () => {
    assert.equal(check('homem'), 'allowed');
  });
});
