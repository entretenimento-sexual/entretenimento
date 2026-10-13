import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  assertPublicMediaConsumptionAccessData,
  assertPublicMediaConsumptionAccessInTransaction,
  type PublicMediaConsumptionAccessReason,
} from './public-media-consumption-access.policy';

describe('public media consumption access policy', () => {
  const eligibleUser = {
    accountStatus: 'active',
    suspended: false,
    interactionBlocked: false,
    acceptedTerms: {
      accepted: true,
      version: 'v3',
      acknowledgedPrivacyNotice: true,
    },
    adultConsent: {
      accepted: true,
      version: 'v1',
    },
  };

  function assertBlockedWithReason(
    user: Parameters<typeof assertPublicMediaConsumptionAccessData>[0],
    expectedReason: PublicMediaConsumptionAccessReason
  ): void {
    assert.throws(
      () => assertPublicMediaConsumptionAccessData(user),
      (error: unknown) => {
        assert.ok(error instanceof HttpsError);
        assert.equal(
          (error.details as { reason?: unknown } | undefined)?.reason,
          expectedReason
        );
        return true;
      }
    );
  }


  it('normaliza HttpsError estrutural recebido com outra identidade de classe', () => {
    const separateRuntimeError = Object.assign(new Error('Conta suspensa.'), {
      code: 'failed-precondition',
      details: { reason: 'account_interaction_blocked' },
    });
    assert.throws(
      () => remapAccountAccessError(separateRuntimeError),
      (error: unknown) => {
        assert.ok(error instanceof HttpsError);
        assert.equal(
          (error.details as { reason?: string })?.reason,
          'ACCOUNT_UNAVAILABLE'
        );
        return true;
      }
    );
  });

  it('permite conta ativa com termos e consentimento vigentes', () => {
    assert.doesNotThrow(() =>
      assertPublicMediaConsumptionAccessData(eligibleUser)
    );
  });

  it('não cria gate de Media a partir de reverificação etária', () => {
    assert.doesNotThrow(() =>
      assertPublicMediaConsumptionAccessData({
        ...eligibleUser,
        ageReverification: { status: 'REQUIRED' },
      } as typeof eligibleUser & {
        ageReverification: { status: string };
      })
    );
  });

  it('bloqueia lifecycle restrito ou suspensão', () => {
    assertBlockedWithReason(
      {
        ...eligibleUser,
        accountStatus: 'pending_deletion',
      },
      'ACCOUNT_UNAVAILABLE'
    );
    assertBlockedWithReason(
      {
        ...eligibleUser,
        suspended: true,
      },
      'ACCOUNT_UNAVAILABLE'
    );
  });

  it('bloqueia termos desatualizados', () => {
    assertBlockedWithReason(
      {
        ...eligibleUser,
        acceptedTerms: {
          accepted: true,
          version: 'v2',
          acknowledgedPrivacyNotice: true,
        },
      },
      'TERMS_REQUIRED'
    );
  });

  it('bloqueia consentimento adulto ausente ou desatualizado', () => {
    assertBlockedWithReason(
      {
        ...eligibleUser,
        adultConsent: null,
      },
      'ADULT_CONSENT_REQUIRED'
    );
    assertBlockedWithReason(
      {
        ...eligibleUser,
        adultConsent: { accepted: true, version: 'legacy' },
      },
      'ADULT_CONSENT_REQUIRED'
    );
  });

  it('revalida a conta na mesma transação mesmo após token anterior', async () => {
    const states = [
      null,
      { ...eligibleUser, suspended: true },
      { ...eligibleUser, accountStatus: 'moderation_suspended' },
      { ...eligibleUser, accountLocked: true },
      { ...eligibleUser, loginAllowed: false },
      { ...eligibleUser, interactionBlocked: true },
      { ...eligibleUser, moderationAutomationHold: {
        active: true, expiresAtMs: Date.now() + 60_000,
      } },
    ];
    for (const state of states) {
      const reads: string[] = [];
      const transaction = {
        get: async (ref: { path: string }) => {
          reads.push(ref.path);
          return { exists: state !== null, data: () => state };
        },
      } as unknown as Transaction;
      await assert.rejects(
        assertPublicMediaConsumptionAccessInTransaction(transaction, 'viewer-media'),
        (error: unknown) => {
          assert.ok(error instanceof HttpsError);
          assert.equal((error.details as { reason?: string })?.reason, 'ACCOUNT_UNAVAILABLE');
          return true;
        }
      );
      assert.deepEqual(reads, ['users/viewer-media']);
    }
  });

  it('não exige verified assurance do visitante na transação', async () => {
    for (const assurance of ['SELF_DECLARED_ADULT', 'VERIFIED_ADULT', undefined]) {
      const transaction = {
        get: async () => ({
          exists: true,
          data: () => ({ ...eligibleUser, ageEligibilityAssurance: assurance }),
        }),
      } as unknown as Transaction;
      const context = await assertPublicMediaConsumptionAccessInTransaction(
        transaction, 'viewer-media'
      );
      assert.equal(context.accessExpiresAtMs, null);
    }
  });

  it('mantém erros canônicos de termos e consentimento na transação', async () => {
    for (const [state, reason] of [
      [{ ...eligibleUser, acceptedTerms: null }, 'TERMS_REQUIRED'],
      [{ ...eligibleUser, adultConsent: null }, 'ADULT_CONSENT_REQUIRED'],
    ] as const) {
      const transaction = {
        get: async () => ({ exists: true, data: () => state }),
      } as unknown as Transaction;
      await assert.rejects(
        assertPublicMediaConsumptionAccessInTransaction(transaction, 'viewer-media'),
        (error: unknown) => {
          assert.ok(error instanceof HttpsError);
          assert.equal((error.details as { reason?: string })?.reason, reason);
          return true;
        }
      );
    }
  });
});
