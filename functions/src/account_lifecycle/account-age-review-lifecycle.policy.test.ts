import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAgeReviewRestrictionPatch,
  buildAgeReviewRestorePatch,
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
