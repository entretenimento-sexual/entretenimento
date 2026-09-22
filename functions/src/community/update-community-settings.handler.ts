// functions/src/community/update-community-settings.handler.ts
// -----------------------------------------------------------------------------
// UPDATE COMMUNITY SETTINGS
// -----------------------------------------------------------------------------
// Atualiza, de forma transacional e idempotente, somente campos editoriais e
// políticas configuráveis. A projeção pública não recebe regras nem política de
// convites, e o rankScore nunca é alterado por esta operação.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertRecentAuthentication } from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import {
  resolveBusinessOfficialEntitlementInTransaction,
} from '../business-official/business-official-entitlement.service';
import { buildCommunityOperationalRequestRetention } from './community-operational-retention.policy';
import { db } from '../firebaseApp';
import {
  evaluatePlatformSubscriptionEntitlement,
} from '../payments/application/platform-subscription-entitlement.service';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  isCommunityMemberLimitAllowed,
  resolveCommunityCapacitySponsorRole,
  resolveCommunityOwnerPlanLimit,
} from './community-capacity.policy';
import {
  isOfficialCommunityCapacity,
  resolveOfficialCommunityCapacityCapabilityName,
  resolveOfficialCommunityEntitlementSubject,
} from './community-capacity.service';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import { normalizeCommunityMemberCount } from './community-member-count.policy';
import {
  normalizeCommunityOfficialAssociationKey,
} from './community-official-association.model';
import { assertCommunityMembershipActorEligibleInTransaction } from './community-membership-eligibility.service';
import {
  CommunityEditableSettings,
  UpdateCommunitySettingsRequest,
  UpdateCommunitySettingsResponse,
  normalizeUpdateCommunitySettingsRequest,
  resolveCommunitySettingsChangedFields,
  sanitizeCommunityEditableSettings,
} from './community-settings.model';
import {
  CommunitySettingsPolicyDenialReason,
  evaluateCommunitySettingsIdempotencyReplay,
  evaluateCommunitySettingsUpdate,
} from './community-settings.policy';
import type { CommunityViewerRole } from './community-preview.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'A edição de Comunidades ainda não está disponível neste ambiente.'
  );
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();

  if (!uid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail para continuar.'
    );
  }

  return uid;
}

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,128}$/.test(normalized) ? normalized : null;
}

function normalizeViewerRole(value: unknown): CommunityViewerRole | null {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function throwPolicyError(
  denialReason: CommunitySettingsPolicyDenialReason | null
): never {
  if (denialReason === 'source_unsupported') {
    throw new HttpsError(
      'failed-precondition',
      'Configurações de Comunidade não se aplicam a este espaço.'
    );
  }

  if (denialReason === 'community_unavailable') {
    throw new HttpsError(
      'failed-precondition',
      'Esta Comunidade não pode ser editada no estado atual.'
    );
  }

  if (denialReason === 'owner_required_for_capacity') {
    throw new HttpsError(
      'permission-denied',
      'Somente o proprietário pode alterar a capacidade de membros.',
      { reason: denialReason }
    );
  }

  throw new HttpsError(
    'permission-denied',
    'Você não possui permissão para editar esta Comunidade.',
    { reason: denialReason ?? 'manager_required' }
  );
}

function buildContentAccess(): {
  requiresActiveSubscription: boolean;
  minimumRole: null;
  } {
  return { requiresActiveSubscription: false, minimumRole: null };
}

function resolveSettingsReplay(
  decision: ReturnType<typeof evaluateCommunitySettingsIdempotencyReplay>
): { changedFields: string[]; generatedAt: number } {
  if (decision.state === 'valid') {
    return {
      changedFields: decision.changedFields,
      generatedAt: decision.generatedAt,
    };
  }

  if (decision.state === 'conflict') {
    throw new HttpsError(
      'permission-denied',
      'Esta solicitação de edição pertence a outra operação.'
    );
  }

  throw new HttpsError(
    'data-loss',
    'O registro idempotente da edição está inconsistente.',
    { reason: 'community_settings_idempotency_invalid' }
  );
}

function commandSettings(
  command: ReturnType<typeof normalizeUpdateCommunitySettingsRequest>
): CommunityEditableSettings {
  if (!command) {
    throw new Error('Comando normalizado ausente.');
  }

  return {
    name: command.name,
    description: command.description,
    rules: command.rules,
    joinPolicy: command.joinPolicy,
    accessTier: command.accessTier,
    membersCanInvite: command.membersCanInvite,
    memberLimit: command.memberLimit,
    tagIds: command.tagIds,
  };
}

export const updateCommunitySettings = onCall<UpdateCommunitySettingsRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<UpdateCommunitySettingsResponse> => {
    assertPreviewRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    const command = normalizeUpdateCommunitySettingsRequest(request.data);

    if (!command) {
      throw new HttpsError(
        'invalid-argument',
        'Revise as configurações obrigatórias da Comunidade.'
      );
    }

    await consumeCommunityRateLimit({
      action: 'settings_update',
      actorUid,
    });

    const nextSettings = commandSettings(command);

    return db.runTransaction(async (transaction) => {
      const requestRef = db
        .collection('community_settings_requests')
        .doc(command.requestId);
      const communityRef = db.collection('communities').doc(command.communityId);
      const membershipRef = communityRef.collection('members').doc(actorUid);
      const userRef = db.collection('users').doc(actorUid);
      const discoveryRef = db
        .collection('community_discovery_index')
        .doc(command.communityId);
      const auditRef = db
        .collection('community_settings_audit')
        .doc(`settings-${command.requestId}`);

      const [
        requestSnapshot,
        communitySnapshot,
        membershipSnapshot,
        userSnapshot,
        discoverySnapshot,
      ] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(communityRef),
        transaction.get(membershipRef),
        transaction.get(userRef),
        transaction.get(discoveryRef),
      ]);

      if (requestSnapshot.exists) {
        const replay = resolveSettingsReplay(
          evaluateCommunitySettingsIdempotencyReplay({
            rawRequest: requestSnapshot.data(),
            expectedActorUid: actorUid,
            expectedCommunityId: command.communityId,
          })
        );

        return {
          communityId: command.communityId,
          updated: false,
          changedFields: replay.changedFields,
          generatedAt: replay.generatedAt,
        };
      }

      if (!communitySnapshot.exists) {
        throw new HttpsError('not-found', 'Comunidade não encontrada.');
      }

      await assertCommunityMembershipActorEligibleInTransaction(
        transaction,
        actorUid,
        userSnapshot.exists ? userSnapshot.data() : null
      );

      const community = communitySnapshot.data() ?? {};
      const membership = membershipSnapshot.exists
        ? membershipSnapshot.data() ?? {}
        : {};
      const source = (community['source'] ?? {}) as Record<string, unknown>;
      const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;
      const currentSettings = sanitizeCommunityEditableSettings(community);

      if (!currentSettings) {
        throw new HttpsError(
          'data-loss',
          'As configurações atuais da Comunidade estão inconsistentes.'
        );
      }

      const changedFields = resolveCommunitySettingsChangedFields(
        currentSettings,
        nextSettings
      );
      const capacityChanged = changedFields.includes('memberLimit');
      const actorRole = normalizeViewerRole(membership['role']);
      const decision = evaluateCommunitySettingsUpdate({
        sourceType: source['type'] === 'community'
          ? 'community'
          : source['type'] === 'venue'
            ? 'venue'
            : null,
        communityStatus:
          typeof community['status'] === 'string' ? community['status'] : null,
        moderationState:
          typeof moderation['state'] === 'string' ? moderation['state'] : null,
        actorStatus:
          typeof membership['status'] === 'string' ? membership['status'] : null,
        actorRole,
        capacityChanged,
      });

      if (!decision.allowed) {
        throwPolicyError(decision.denialReason);
      }

      let officialCapacityAudit: Readonly<Record<string, unknown>> | null = null;

      if (capacityChanged) {
        assertRecentAuthentication(
          (request.auth?.token ?? undefined) as
            | Record<string, unknown>
            | undefined
        );

        const metrics = (community['metrics'] ?? {}) as Record<
          string,
          unknown
        >;
        const memberCount = normalizeCommunityMemberCount(
          metrics['memberCount']
        );

        if (memberCount === null) {
          throw new HttpsError(
            'data-loss',
            'A contagem atual de membros está inconsistente.'
          );
        }

        if (command.memberLimit < memberCount) {
          throw new HttpsError(
            'failed-precondition',
            'O limite não pode ser menor que a quantidade atual de membros.',
            {
              reason: 'community_capacity_below_member_count',
              memberCount,
            }
          );
        }

        if (isOfficialCommunityCapacity(community)) {
          const associationKey = normalizeCommunityOfficialAssociationKey(
            community['officialAssociationKey']
          );
          if (!associationKey) {
            throw new HttpsError(
              'data-loss',
              'A associação oficial desta Comunidade está inconsistente.'
            );
          }

          const associationSnapshot = await transaction.get(
            db.collection('community_official_associations').doc(associationKey)
          );
          const association = associationSnapshot.exists
            ? associationSnapshot.data() ?? {}
            : {};
          const associationCommunityId = normalizeSafeId(
            association['communityId']
          );
          const subject = resolveOfficialCommunityEntitlementSubject(
            community,
            association
          );

          if (
            association['status'] !== 'verified'
            || associationCommunityId !== command.communityId
            || !subject
          ) {
            throw new HttpsError(
              'data-loss',
              'A associação oficial desta Comunidade está inconsistente.'
            );
          }

          const officialEntitlement =
            await resolveBusinessOfficialEntitlementInTransaction({
              transaction,
              subjectType: subject.subjectType,
              subjectId: subject.subjectId,
              now: Date.now(),
            });
          const capabilityName =
            resolveOfficialCommunityCapacityCapabilityName(community);
          const officialCapability = officialEntitlement.allowed
            ? officialEntitlement.capabilities?.[capabilityName] ?? null
            : null;

          if (
            !officialEntitlement.allowed
            || !officialEntitlement.entitlementId
            || !officialCapability
          ) {
            const reason =
              officialEntitlement.denialReason === 'entitlement_inactive'
                ? 'official_capacity_entitlement_inactive'
                : officialEntitlement.denialReason === 'entitlement_mismatch'
                  ? 'official_capacity_entitlement_mismatch'
                  : 'official_capacity_entitlement_required';
            throw new HttpsError(
              'permission-denied',
              'A capacidade Business/Official desta Comunidade não está disponível.',
              { reason }
            );
          }

          if (command.memberLimit > officialCapability.memberLimit) {
            throw new HttpsError(
              'permission-denied',
              'A capacidade escolhida excede o entitlement Business/Official.',
              {
                reason: 'official_capacity_entitlement_exceeded',
                allowedMemberLimit: officialCapability.memberLimit,
              }
            );
          }

          officialCapacityAudit = Object.freeze({
            action: 'business_official_entitlement_capacity_validated',
            entitlementId: officialEntitlement.entitlementId,
            entitlementPolicyVersion: officialEntitlement.policyVersion,
            capability: capabilityName,
            subjectType: officialEntitlement.subjectType,
            subjectId: officialEntitlement.subjectId,
            communityId: command.communityId,
            requestedMemberLimit: command.memberLimit,
            allowedMemberLimit: officialCapability.memberLimit,
            actorUid,
          });
        } else {
          const entitlementSnapshot = await transaction.get(
            db.collection('entitlements')
              .doc(`platform_subscription_${actorUid}`)
          );
          const entitlement = evaluatePlatformSubscriptionEntitlement(
            entitlementSnapshot.exists ? entitlementSnapshot.data() : null,
            actorUid
          );
          const sponsorRole = resolveCommunityCapacitySponsorRole(
            entitlement.active ? entitlement.role : null,
            (userSnapshot.data() ?? {})['role']
          );

          if (!isCommunityMemberLimitAllowed(command.memberLimit, sponsorRole)) {
            throw new HttpsError(
              'permission-denied',
              'Seu plano atual não permite a capacidade escolhida.',
              {
                reason: 'community_capacity_upgrade_required',
                recommendedAction: 'upgrade_subscription',
                allowedMemberLimit: resolveCommunityOwnerPlanLimit(sponsorRole),
              }
            );
          }
        }
      }

      const now = Date.now();
      const contentAccess = buildContentAccess();

      if (changedFields.length > 0) {
        transaction.update(communityRef, {
          name: command.name,
          slug: command.slug,
          description: command.description,
          rules: command.rules,
          tagIds: command.tagIds,
          'access.join': command.joinPolicy,
          'access.contentAccess': contentAccess,
          'access.invites.membersCanInvite': command.membersCanInvite,
          'capacity.memberLimit': command.memberLimit,
          'capacity.policyVersion': 1,
          settingsUpdatedAt: now,
          settingsUpdatedBy: actorUid,
          updatedAt: now,
        });

        if (discoverySnapshot.exists) {
          transaction.update(discoveryRef, {
            name: command.name,
            slug: command.slug,
            description: command.description,
            tagIds: command.tagIds,
            access: {
              preview: 'authenticated',
              interaction: 'members_only',
              join: command.joinPolicy,
              contentAccess,
            },
            'capacity.memberLimit': command.memberLimit,
            'capacity.policyVersion': 1,
            updatedAt: now,
          });
        }

        transaction.create(auditRef, {
          action: 'community_settings_updated',
          communityId: command.communityId,
          actorUid,
          actorRole,
          changedFields,
          previousJoinPolicy: currentSettings.joinPolicy,
          nextJoinPolicy: command.joinPolicy,
          previousMembersCanInvite: currentSettings.membersCanInvite,
          nextMembersCanInvite: command.membersCanInvite,
          previousMemberLimit: currentSettings.memberLimit,
          nextMemberLimit: command.memberLimit,
          createdAt: now,
        });

        if (officialCapacityAudit) {
          transaction.create(
            db.collection('business_official_entitlement_usage_audit')
              .doc(`settings-${command.requestId}`),
            {
              ...officialCapacityAudit,
              createdAt: now,
            }
          );
        }
      }

      transaction.create(requestRef, {

        ...buildCommunityOperationalRequestRetention('settings', now),
        actorUid,
        communityId: command.communityId,
        status: 'completed',
        changedFields,
        generatedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      return {
        communityId: command.communityId,
        updated: changedFields.length > 0,
        changedFields,
        generatedAt: now,
      };
    });
  }
);
