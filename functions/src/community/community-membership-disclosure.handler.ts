// functions/src/community/community-membership-disclosure.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP DISCLOSURE MANAGEMENT
// -----------------------------------------------------------------------------
// Gestão separada da preferência individual: owner/admin define apenas se a
// Comunidade permite opt-in. Nenhum membro é publicado por esta ação. Toda troca
// de modo incrementa a policyVersion e exige novo consentimento individual.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import {
  CommunityMembershipDisclosureMode,
  resolveCommunityMembershipDisclosureTransition,
} from './community-membership-disclosure.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import {
  assertCommunitySocialAccessForUid,
} from './community-social-access.service';

interface CommunityMembershipDisclosureRequest {
  communityId?: unknown;
  mode?: unknown;
}

interface CommunityMembershipDisclosureResponse {
  communityId: string;
  mode: CommunityMembershipDisclosureMode;
  policyVersion: number;
  updated: boolean;
  generatedAt: number;
}

const COMMUNITY_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

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

function normalizeCommunityId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return COMMUNITY_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeMode(value: unknown): CommunityMembershipDisclosureMode | null {
  return value === 'disabled' || value === 'opt_in' ? value : null;
}

function assertManager(
  community: Record<string, unknown>,
  membership: Record<string, unknown>
): void {
  const source = (community['source'] ?? {}) as Record<string, unknown>;
  const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;
  const role = membership['role'];

  if (
    source['type'] !== 'community'
    || community['status'] !== 'active'
    || moderation['state'] !== 'active'
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Esta política não pode ser alterada no estado atual da Comunidade.'
    );
  }

  if (
    membership['status'] !== 'active'
    || (role !== 'owner' && role !== 'admin')
  ) {
    throw new HttpsError(
      'permission-denied',
      'Somente a gestão autorizada pode alterar esta política.',
      { reason: 'community_settings_manager_required' }
    );
  }
}

export const updateCommunityMembershipDisclosurePolicy =
  onCall<CommunityMembershipDisclosureRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityMembershipDisclosureResponse> => {
      assertCommunityCallableAppCheck(request.app);
      assertRuntime();
      const actorUid = assertAuthenticatedUid(request.auth);
      await assertCommunitySocialAccessForUid(actorUid);

      const communityId = normalizeCommunityId(request.data?.communityId);
      const mode = normalizeMode(request.data?.mode);
      if (!communityId || !mode) {
        throw new HttpsError(
          'invalid-argument',
          'Revise a política de visibilidade da Comunidade.'
        );
      }

      await consumeCommunityRateLimit({ action: 'settings_update', actorUid });

      return db.runTransaction(async (transaction) => {
        const communityRef = db.collection('communities').doc(communityId);
        const membershipRef = communityRef.collection('members').doc(actorUid);
        const auditRef = db.collection('community_settings_audit').doc();
        const [communitySnapshot, membershipSnapshot] = await Promise.all([
          transaction.get(communityRef),
          transaction.get(membershipRef),
        ]);

        if (!communitySnapshot.exists) {
          throw new HttpsError('not-found', 'Comunidade não encontrada.');
        }

        const community = communitySnapshot.data() ?? {};
        const membership = membershipSnapshot.exists
          ? membershipSnapshot.data() ?? {}
          : {};
        assertManager(community, membership);

        const transition = resolveCommunityMembershipDisclosureTransition(
          community,
          mode
        );
        const now = Date.now();

        if (transition.updated) {
          transaction.update(communityRef, {
            membershipDisclosure: {
              profileMembership: transition.nextMode,
              policyVersion: transition.nextPolicyVersion,
            },
            membershipDisclosureUpdatedAt: now,
            membershipDisclosureUpdatedBy: actorUid,
            updatedAt: now,
          });
          transaction.create(auditRef, {
            action: 'community_membership_disclosure_updated',
            communityId,
            actorUid,
            actorRole: membership['role'],
            previousMode: transition.currentMode,
            nextMode: transition.nextMode,
            previousPolicyVersion: transition.currentPolicyVersion,
            nextPolicyVersion: transition.nextPolicyVersion,
            createdAt: now,
          });
        }

        return {
          communityId,
          mode: transition.nextMode,
          policyVersion: transition.nextPolicyVersion,
          updated: transition.updated,
          generatedAt: now,
        };
      });
    }
  );
