import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertPlatformAccountAccessData } from './interaction-access.policy';
import { evaluateCanonicalOwnerLifecycle } from '../media/application/owner-lifecycle-exposure.policy';

import {
  buildAgeReviewRestrictionPatch,
  buildAgeReviewRestorePatch,
  resolveAgeReviewRestoration,
  buildConfirmedUnderageSuspensionPatch,
} from './account-age-review-lifecycle.policy';

describe('account age review lifecycle policy', () => {
  it('restringe a conta sem tocar em estado de Media', () => {
    assert.deepEqual(
      buildAgeReviewRestrictionPatch({ restrictedAt: 123 }),
      {
        publicVisibility: 'hidden',
        interactionBlocked: true,
        ageReverificationRestrictedAt: 123,
      }
    );
  });

  it('restaura apenas a restrição da revalidação quando ela não é dona da suspensão', () => {
    assert.deepEqual(
      buildAgeReviewRestorePatch({
        reviewedAt: 456,
        reviewedBy: 'admin-1',
        ownsSuspension: false,
      }),
      {
        publicVisibility: 'visible',
        interactionBlocked: false,
        ageReverificationRestrictedAt: null,
      }
    );
  });

  it('restaura lifecycle completo quando a suspensão pertence à revalidação', () => {
    assert.deepEqual(
      buildAgeReviewRestorePatch({
        reviewedAt: 456,
        reviewedBy: 'admin-1',
        ownsSuspension: true,
      }),
      {
        publicVisibility: 'visible',
        interactionBlocked: false,
        ageReverificationRestrictedAt: null,
        accountStatus: 'active',
        suspended: false,
        suspensionReason: null,
        suspensionSource: null,
        suspensionEndsAt: null,
        suspendedAtMs: null,
        suspendedBy: null,
        statusUpdatedAt: 456,
        statusUpdatedBy: 'admin-1',
        ageReverificationSuspensionCaseId: null,
      }
    );
  });

  it('não restaura suspensão ou lock pertencente a outra autoridade', () => {
    const restricted = {
      accountStatus: 'active',
      suspended: false,
      publicVisibility: 'hidden',
      interactionBlocked: true,
      ageReverificationRestrictedAt: 100,
      loginAllowed: true,
      accountLocked: false,
    };
    assert.deepEqual(resolveAgeReviewRestoration({
      caseId: 'review-1', account: restricted,
    }), { canRestore: true, ownsSuspension: false });

    for (const independent of [
      { accountLocked: true },
      { loginAllowed: false },
      { moderationAutomationHold: { active: true } },
      { accountStatus: 'self_suspended', suspended: true },
      { accountStatus: 'moderation_suspended', suspended: true,
        suspensionSource: 'moderator', ageReverificationSuspensionCaseId: 'other-case' },
      { ageReverificationRestrictedAt: null },
      { publicVisibility: 'visible' },
      { interactionBlocked: false },
    ]) {
      assert.equal(resolveAgeReviewRestoration({
        caseId: 'review-1', account: { ...restricted, ...independent },
      }).canRestore, false);
    }
  });

  it('restaura suspensão etária somente quando o caso é seu proprietário', () => {
    const account = {
      accountStatus: 'moderation_suspended',
      suspended: true,
      suspensionSource: 'moderator',
      ageReverificationSuspensionCaseId: 'review-1',
      ageReverificationRestrictedAt: 100,
      publicVisibility: 'hidden',
      interactionBlocked: true,
      loginAllowed: true,
    };
    assert.deepEqual(resolveAgeReviewRestoration({
      caseId: 'review-1', account,
    }), { canRestore: true, ownsSuspension: true });
    assert.equal(resolveAgeReviewRestoration({
      caseId: 'review-2', account,
    }).canRestore, false);
  });

  it('prova que suspeita e confirmação de menoridade bloqueiam produtos via lifecycle', () => {
    const baseAccount = {
      accountStatus: 'active',
      suspended: false,
      interactionBlocked: false,
      accountLocked: false,
      publicVisibility: 'visible',
      loginAllowed: true,
      acceptedTerms: {
        accepted: true, version: 'v3',
        acknowledgedPrivacyNotice: true,
      },
      adultConsent: { accepted: true, version: 'v1' },
    };
    assert.doesNotThrow(() => assertPlatformAccountAccessData(baseAccount));
    assert.equal(evaluateCanonicalOwnerLifecycle(baseAccount).allowed, true);

    const pendingReview = {
      ...baseAccount,
      ...buildAgeReviewRestrictionPatch({ restrictedAt: 100 }),
    };
    assert.throws(() => assertPlatformAccountAccessData(pendingReview));
    assert.equal(evaluateCanonicalOwnerLifecycle(pendingReview).allowed, false);

    const confirmedUnderage = {
      ...baseAccount,
      ...buildConfirmedUnderageSuspensionPatch({
        reviewedAt: 200, reviewedBy: 'compliance-1',
        reason: 'evidência confiável', caseId: 'case-1',
      }),
    };
    assert.throws(() => assertPlatformAccountAccessData(confirmedUnderage));
    assert.equal(evaluateCanonicalOwnerLifecycle(confirmedUnderage).allowed, false);
  });

  it('suspende a conta quando menoridade é confirmada', () => {
    assert.deepEqual(
      buildConfirmedUnderageSuspensionPatch({
        reviewedAt: 789,
        reviewedBy: 'admin-2',
        reason: 'menoridade confirmada',
        caseId: 'case-1',
      }),
      {
        accountStatus: 'moderation_suspended',
        publicVisibility: 'hidden',
        interactionBlocked: true,
        loginAllowed: true,
        suspended: true,
        suspensionReason: 'menoridade confirmada',
        suspensionSource: 'moderator',
        suspendedAtMs: 789,
        suspendedBy: 'admin-2',
        ageReverificationSuspensionCaseId: 'case-1',
        statusUpdatedAt: 789,
        statusUpdatedBy: 'admin-2',
      }
    );
  });
});
