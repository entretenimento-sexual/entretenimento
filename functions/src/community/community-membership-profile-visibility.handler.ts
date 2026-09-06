// functions/src/community/community-membership-profile-visibility.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP PROFILE VISIBILITY
// -----------------------------------------------------------------------------
// Leitura e mutação da preferência privada do próprio membro. O UID é sempre
// derivado do Auth; o cliente não informa subjectUid. `visible` só é aceito se
// a policy atual permitir e a membership estiver ativa. `hidden` permanece uma
// revogação permissiva para que o usuário consiga retirar consentimento mesmo
// se a Comunidade deixar de estar operacional.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import {
  resolveCommunityMembershipProfileVisibilityState,
} from './community-membership-visibility.policy';
import {
  CommunityMembershipProfileVisibilityReadRequest,
  CommunityMembershipProfileVisibilityRequest,
  CommunityMembershipProfileVisibilityState,
  normalizeCommunityMembershipProfileVisibilityCommunityId,
  normalizeCommunityMembershipProfileVisibilityRequest,
} from './community-membership-profile-visibility.model';
import {
  assertCommunitySocialAccessForUid,
} from './community-social-access.service';
import { consumeCommunityRateLimit } from './community-rate-limit.service';

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'As comunidades ainda não estão disponíveis neste ambiente.'
  );
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();
  if (!uid) throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError('failed-precondition', 'Verifique seu e-mail para continuar.');
  }
  return uid;
}

function assertCommunitySource(rawCommunity: Record<string, unknown>): void {
  const source = (rawCommunity['source'] ?? {}) as Record<string, unknown>;
  if (source['type'] !== 'community') {
    throw new HttpsError(
      'failed-precondition',
      'Esta preferência está disponível somente para Comunidades.'
    );
  }
}

function buildState(
  communityId: string,
  rawCommunity: unknown,
  rawMembership: unknown
): CommunityMembershipProfileVisibilityState {
  const membership = (rawMembership ?? {}) as Record<string, unknown>;
  const state = resolveCommunityMembershipProfileVisibilityState(
    rawCommunity,
    membership
  );
  const role = membership['role'];
  const canManagePolicy = membership['status'] === 'active'
    && (role === 'owner' || role === 'admin');

  return {
    communityId,
    ...state,
    canManagePolicy,
    generatedAt: Date.now(),
  };
}

export const getCommunityMembershipProfileVisibility =
  onCall<CommunityMembershipProfileVisibilityReadRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityMembershipProfileVisibilityState> => {
      assertCommunityCallableAppCheck(request.app);
      assertRuntime();
      const actorUid = assertAuthenticatedUid(request.auth);
      await assertCommunitySocialAccessForUid(actorUid);

      const communityId =
        normalizeCommunityMembershipProfileVisibilityCommunityId(
          request.data?.communityId
        );
      if (!communityId) {
        throw new HttpsError('invalid-argument', 'Comunidade inválida.');
      }

      const communityRef = db.collection('communities').doc(communityId);
      const membershipRef = communityRef.collection('members').doc(actorUid);
      const [communitySnapshot, membershipSnapshot] = await Promise.all([
        communityRef.get(),
        membershipRef.get(),
      ]);

      if (!communitySnapshot.exists) {
        throw new HttpsError('not-found', 'Comunidade não encontrada.');
      }
      if (!membershipSnapshot.exists) {
        throw new HttpsError(
          'failed-precondition',
          'Você precisa participar da Comunidade para alterar esta preferência.'
        );
      }

      const community = communitySnapshot.data() ?? {};
      assertCommunitySource(community);
      return buildState(
        communityId,
        community,
        membershipSnapshot.data() ?? {}
      );
    }
  );

export const updateCommunityMembershipProfileVisibility =
  onCall<CommunityMembershipProfileVisibilityRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityMembershipProfileVisibilityState> => {
      assertCommunityCallableAppCheck(request.app);
      assertRuntime();
      const actorUid = assertAuthenticatedUid(request.auth);
      await assertCommunitySocialAccessForUid(actorUid);

      const command = normalizeCommunityMembershipProfileVisibilityRequest(
        request.data
      );
      if (!command) {
        throw new HttpsError(
          'invalid-argument',
          'Revise a preferência de visibilidade da Comunidade.'
        );
      }

      // Compartilha o orçamento curto de alterações de configuração para impedir
      // automação de toggles sem criar outro contador operacional no Firestore.
      await consumeCommunityRateLimit({ action: 'settings_update', actorUid });

      return db.runTransaction(async (transaction) => {
        const communityRef = db.collection('communities').doc(command.communityId);
        const membershipRef = communityRef.collection('members').doc(actorUid);
        const auditRef = db.collection('community_membership_audit').doc();
        const [communitySnapshot, membershipSnapshot] = await Promise.all([
          transaction.get(communityRef),
          transaction.get(membershipRef),
        ]);

        if (!communitySnapshot.exists) {
          throw new HttpsError('not-found', 'Comunidade não encontrada.');
        }
        if (!membershipSnapshot.exists) {
          throw new HttpsError(
            'failed-precondition',
            'Você precisa participar da Comunidade para alterar esta preferência.'
          );
        }

        const community = communitySnapshot.data() ?? {};
        const membership = membershipSnapshot.data() ?? {};
        assertCommunitySource(community);

        const state = resolveCommunityMembershipProfileVisibilityState(
          community,
          membership
        );
        const previousVisibility = membership['profileVisibility'] === 'visible'
          ? 'visible'
          : 'hidden';
        const previousPolicyVersion = Number.isSafeInteger(
          membership['profileVisibilityPolicyVersion']
        ) && Number(membership['profileVisibilityPolicyVersion']) >= 1
          ? Number(membership['profileVisibilityPolicyVersion'])
          : null;
        const nextPolicyVersion = command.profileVisibility === 'visible'
          ? state.policyVersion
          : null;

        if (command.profileVisibility === 'visible' && !state.canChange) {
          throw new HttpsError(
            'failed-precondition',
            'Esta Comunidade não permite exibir a participação no perfil agora.',
            { reason: 'community_membership_profile_visibility_unavailable' }
          );
        }

        const alreadyApplied = command.profileVisibility === 'visible'
          ? previousVisibility === 'visible'
            && previousPolicyVersion === nextPolicyVersion
          : previousVisibility === 'hidden' && previousPolicyVersion === null;

        if (!alreadyApplied) {
          const now = Date.now();
          transaction.update(membershipRef, {
            profileVisibility: command.profileVisibility,
            profileVisibilityPolicyVersion: nextPolicyVersion,
            profileVisibilityUpdatedAt: now,
            updatedAt: now,
          });
          transaction.create(auditRef, {
            action: 'membership_profile_visibility_updated',
            communityId: command.communityId,
            actorUid,
            subjectUid: actorUid,
            previousProfileVisibility: previousVisibility,
            nextProfileVisibility: command.profileVisibility,
            previousPolicyVersion,
            nextPolicyVersion,
            createdAt: now,
            source: 'callable',
          });
        }

        const nextMembership = alreadyApplied
          ? membership
          : {
            ...membership,
            profileVisibility: command.profileVisibility,
            profileVisibilityPolicyVersion: nextPolicyVersion,
          };

        return buildState(command.communityId, community, nextMembership);
      });
    }
  );
