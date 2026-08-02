import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { MediaPolicyService } from './media-policy.service';

const OWNER_UID = 'owner-1';

function eligibleViewer(overrides: Record<string, unknown> = {}) {
  return {
    uid: OWNER_UID,
    emailVerified: true,
    profileCompleted: true,
    interactionBlocked: false,
    ageReverificationStatus: 'VERIFIED',
    ageReverificationResult: 'ADULT',
    ...overrides,
  };
}

describe('MediaPolicyService', () => {
  const service = new MediaPolicyService();

  it('libera upload para o proprietário elegível', async () => {
    await expect(firstValueFrom(
      service.canUploadProfileVideosForViewer$(
        eligibleViewer(),
        OWNER_UID
      )
    )).resolves.toEqual({ decision: 'ALLOW' });
  });

  it.each([
    'REQUIRED',
    'SUBMITTED',
    'UNDER_REVIEW',
    'EXPIRED',
  ])('bloqueia revalidação etária pendente em %s', async (status) => {
    await expect(firstValueFrom(
      service.canUploadProfileVideosForViewer$(
        eligibleViewer({ ageReverificationStatus: status }),
        OWNER_UID
      )
    )).resolves.toEqual({
      decision: 'DENY',
      reason: 'AGE_REVERIFICATION_REQUIRED',
    });
  });

  it('bloqueia revalidação rejeitada', async () => {
    await expect(firstValueFrom(
      service.canUploadProfileVideosForViewer$(
        eligibleViewer({ ageReverificationStatus: 'REJECTED' }),
        OWNER_UID
      )
    )).resolves.toEqual({
      decision: 'DENY',
      reason: 'AGE_REVERIFICATION_RESTRICTED',
    });
  });

  it('bloqueia resultado de menoridade mesmo com status inconsistente', async () => {
    await expect(firstValueFrom(
      service.canUploadProfileVideosForViewer$(
        eligibleViewer({
          ageReverificationStatus: 'VERIFIED',
          ageReverificationResult: 'UNDERAGE',
        }),
        OWNER_UID
      )
    )).resolves.toEqual({
      decision: 'DENY',
      reason: 'AGE_REVERIFICATION_RESTRICTED',
    });
  });

  it('nega upload em perfil diferente', async () => {
    await expect(firstValueFrom(
      service.canUploadProfileVideosForViewer$(
        eligibleViewer(),
        'other-owner'
      )
    )).resolves.toEqual({
      decision: 'DENY',
      reason: 'NOT_OWNER',
    });
  });
});
