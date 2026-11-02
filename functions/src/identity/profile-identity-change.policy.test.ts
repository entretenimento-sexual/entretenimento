import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canRequestIdentityChange, normalizeRequestedIdentityCode } from './profile-identity-change.policy';

describe('profile identity governance policy', () => {
  it('recusa valores arbitrários sem adivinhar identidade', () => {
    assert.equal(normalizeRequestedIdentityCode('nao-existe'), null);
    assert.equal(normalizeRequestedIdentityCode(null), null);
    assert.equal(normalizeRequestedIdentityCode('mulher'), 'mulher');
  });

  it('não cria alteração quando a identidade é a mesma', () => {
    assert.equal(canRequestIdentityChange({
      currentCode: 'mulher', requestedCode: ' MULHER ', now: 1_800_000_000_000
    }), 'same-identity');
  });

  it('não permite duplicar solicitação pendente nem fazer spam após rejeição', () => {
    const now = 1_800_000_000_000;
    assert.equal(canRequestIdentityChange({
      currentCode: 'mulher', requestedCode: 'homem', activeStatus: 'PENDING', now
    }), 'pending');
    assert.equal(canRequestIdentityChange({
      currentCode: 'mulher', requestedCode: 'homem', activeStatus: 'REJECTED',
      requestedAt: now - 86_400_000, now
    }), 'rate-limited');
    assert.equal(canRequestIdentityChange({
      currentCode: 'mulher', requestedCode: 'homem', activeStatus: 'REJECTED',
      requestedAt: now - 8 * 86_400_000, now
    }), 'allowed');
  });

  it('não diferencia assinante e gratuito na decisão', () => {
    assert.equal(canRequestIdentityChange({
      currentCode: 'mulher', requestedCode: 'homem', now: 1_800_000_000_000
    }), 'allowed');
  });
});
