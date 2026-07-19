import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_LIFECYCLE_REASON_LENGTH,
  assertRecentAuthentication,
  buildPublicProfileSeed,
  isUserEligibleForPublicProjection,
  normalizeOptionalReason,
  normalizeRequiredReason,
  resolveNicknameNormalized,
  type UserDoc,
} from './_shared';

function eligibleUser(overrides: Partial<UserDoc> = {}): UserDoc {
  return {
    emailVerified: true,
    profileCompleted: true,
    nickname: 'Pessoa Segura',
    acceptedTerms: { accepted: true, version: 'v1' },
    initialAdultConsentRequired: true,
    adultConsent: { accepted: true, version: 'v1' },
    role: 'vip',
    ...overrides,
  };
}

describe('account lifecycle shared guards', () => {
  it('aceita autenticação recente', () => {
    const nowSeconds = Math.floor(Date.now() / 1_000);

    assert.doesNotThrow(() =>
      assertRecentAuthentication({ auth_time: nowSeconds - 30 })
    );
  });

  it('rejeita sessão antiga ou sem auth_time', () => {
    const nowSeconds = Math.floor(Date.now() / 1_000);

    assert.throws(() =>
      assertRecentAuthentication({ auth_time: nowSeconds - 601 })
    );
    assert.throws(() => assertRecentAuthentication({}));
  });

  it('normaliza espaços e caracteres de controle do motivo', () => {
    assert.equal(
      normalizeOptionalReason('  pausa\n\t pessoal  '),
      'pausa pessoal'
    );
  });

  it('rejeita motivo acima do limite', () => {
    assert.throws(() =>
      normalizeOptionalReason('a'.repeat(MAX_LIFECYCLE_REASON_LENGTH + 1))
    );
  });

  it('exige motivo nos fluxos administrativos', () => {
    assert.throws(() => normalizeRequiredReason('   '));
    assert.equal(
      normalizeRequiredReason('violação confirmada'),
      'violação confirmada'
    );
  });

  it('só restaura projeção pública com todas as evidências necessárias', () => {
    assert.equal(isUserEligibleForPublicProjection(eligibleUser()), true);
    assert.equal(
      isUserEligibleForPublicProjection(
        eligibleUser({ emailVerified: false })
      ),
      false
    );
    assert.equal(
      isUserEligibleForPublicProjection(
        eligibleUser({ profileCompleted: false })
      ),
      false
    );
    assert.equal(
      isUserEligibleForPublicProjection(
        eligibleUser({ acceptedTerms: { accepted: false } })
      ),
      false
    );
    assert.equal(
      isUserEligibleForPublicProjection(
        eligibleUser({ adultConsent: { accepted: false } })
      ),
      false
    );
  });

  it('permite dispensa adulta somente quando explicitamente registrada', () => {
    assert.equal(
      isUserEligibleForPublicProjection(
        eligibleUser({
          initialAdultConsentRequired: false,
          adultConsent: null,
        })
      ),
      true
    );
  });

  it('normaliza apelido para índice seguro', () => {
    assert.equal(
      resolveNicknameNormalized({ nickname: '  Pessoa Segura  ' }),
      'pessoa_segura'
    );
  });

  it('não projeta papel financeiro no perfil público', () => {
    const seed = buildPublicProfileSeed(
      eligibleUser({ role: 'vip' }),
      'user-1',
      123
    );

    assert.equal(seed.role, 'free');
    assert.equal(seed.nicknameNormalized, 'pessoa_segura');
  });
});
