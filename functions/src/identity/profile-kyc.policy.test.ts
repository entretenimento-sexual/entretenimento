import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateProfileKyc } from './profile-kyc.policy';

const NOW = 1_800_000_000_000;

function kyc(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'user-1',
    profileId: 'profile-1',
    status: 'verified',
    policyVersion: 2,
    verifiedAt: NOW - 10_000,
    revalidationDueAt: NOW + 20_000,
    expiresAt: NOW + 30_000,
    revokedAt: null,
    ...overrides,
  };
}

function evaluate(rawKyc: unknown) {
  return evaluateProfileKyc({
    actorUid: 'user-1',
    profileId: 'profile-1',
    rawKyc,
    now: NOW,
  });
}

describe('profile KYC policy', () => {
  it('aceita somente KYC verificado vinculado ao mesmo uid/profileId', () => {
    assert.deepEqual(evaluate(kyc()), {
      allowed: true,
      uid: 'user-1',
      profileId: 'profile-1',
      verificationPolicyVersion: 2,
      denialReason: null,
    });
  });

  it('exige verificação quando registro não existe, está pendente ou rejeitado', () => {
    for (const rawKyc of [null, kyc({ status: 'pending' }), kyc({ status: 'rejected' })]) {
      const result = evaluate(rawKyc);
      assert.equal(result.allowed, false);
      assert.equal(result.denialReason, 'verification_required');
    }
  });

  it('falha inativo para KYC revogado, expirado ou fora da janela vigente', () => {
    for (const rawKyc of [
      kyc({ status: 'revoked' }),
      kyc({ status: 'expired' }),
      kyc({ expiresAt: NOW }),
      kyc({ revalidationDueAt: NOW }),
      kyc({ revokedAt: NOW - 1 }),
    ]) {
      const result = evaluate(rawKyc);
      assert.equal(result.allowed, false);
      assert.equal(result.denialReason, 'verification_inactive');
    }
  });

  it('falha fechado para vínculo divergente de uid ou profileId', () => {
    for (const rawKyc of [
      kyc({ uid: 'user-2' }),
      kyc({ profileId: 'profile-2' }),
    ]) {
      const result = evaluate(rawKyc);
      assert.equal(result.allowed, false);
      assert.equal(result.denialReason, 'record_mismatch');
    }
  });

  it('rejeita timestamps e policyVersion malformados', () => {
    for (const rawKyc of [
      kyc({ verifiedAt: NOW + 1 }),
      kyc({ verifiedAt: 0 }),
      kyc({ policyVersion: 0 }),
      kyc({ policyVersion: 1.5 }),
    ]) {
      const result = evaluate(rawKyc);
      assert.equal(result.allowed, false);
      assert.equal(result.denialReason, 'verification_required');
    }
  });
});
