// functions/src/community/community-official-claim.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL CLAIM HANDLERS
// -----------------------------------------------------------------------------
// Fluxo canônico backend-only de claim/revisão de Comunidades Oficiais.
// Evidências permanecem privadas; somente associação `verified` é projetável.
// -----------------------------------------------------------------------------

import type { DocumentReference } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  buildVerifiedCommunityOfficialAssociation,
  normalizeCommunityOfficialAssociationKey,
} from './community-official-association.model';
import { assertCommunityOfficialClaimEvidence } from './community-official-claim-evidence.service';
import {
  COMMUNITY_OFFICIAL_CLAIM_POLICY_VERSION,
  normalizeCommunityOfficialClaimStatus,
  normalizeReviewCommunityOfficialClaimRequest,
  normalizeSubmitCommunityOfficialClaimRequest,
  resolveCommunityOfficialClaimNextStatus,
  shouldRevokeAssociationForClaimDecision,
  type CommunityOfficialClaimRecord,
  type ReviewCommunityOfficialClaimRequest,
  type SubmitCommunityOfficialClaimRequest,
} from './community-official-claim.model';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  assertCommunitySocialAccessForUid,
} from './community-social-access.service';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'A verificação de Comunidades Oficiais ainda não está disponível neste ambiente.'
  );
}

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = cleanId(auth?.uid);
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

function assertAdmin(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const adminUid = cleanId(auth?.uid);
  const token = auth?.token ?? {};
  const roles = Array.isArray(token['roles']) ? token['roles'] : [];
  const allowed = token['admin'] === true
    || token['role'] === 'admin'
    || roles.includes('admin');

  if (!adminUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }
  if (!allowed) {
    throw new HttpsError(
      'permission-denied',
      'Apenas administradores podem revisar vínculos oficiais.'
    );
  }
  return adminUid;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeCreatedAt(value: unknown, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= fallback
    ? parsed
    : fallback;
}

export const submitCommunityOfficialClaim =
  onCall<SubmitCommunityOfficialClaimRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<{
      associationKey: string;
      status: 'pending' | 'verified' | 'under_review' | 'disputed';
      submitted: boolean;
    }> => {
      assertRuntime();
      assertCommunityCallableAppCheck(request.app);
      const actorUid = assertAuthenticatedUid(request.auth);
      await assertCommunitySocialAccessForUid(actorUid);

      const command = normalizeSubmitCommunityOfficialClaimRequest(request.data);
      if (!command) {
        throw new HttpsError(
          'invalid-argument',
          'Revise o vínculo oficial, a autoridade declarada e as referências de verificação.'
        );
      }

      await consumeCommunityRateLimit({
        action: 'official_space_create',
        actorUid,
      });

      const requestRef = db
        .collection('community_official_claim_requests')
        .doc(`${actorUid}:${command.requestId}`);
      const claimRef = db
        .collection('community_official_claims')
        .doc(command.associationKey);
      const associationRef = db
        .collection('community_official_associations')
        .doc(command.associationKey);
      const communityRef = db.collection('communities').doc(command.communityId);
      const auditRef = db.collection('community_official_claim_audit').doc();

      return db.runTransaction(async (transaction) => {
        const [
          requestSnapshot,
          claimSnapshot,
          associationSnapshot,
          communitySnapshot,
        ] = await Promise.all([
          transaction.get(requestRef),
          transaction.get(claimRef),
          transaction.get(associationRef),
          transaction.get(communityRef),
        ]);

        if (requestSnapshot.exists) {
          const existing = requestSnapshot.data() ?? {};
          if (
            existing['actorUid'] !== actorUid
            || existing['associationKey'] !== command.associationKey
            || existing['communityId'] !== command.communityId
          ) {
            throw new HttpsError(
              'already-exists',
              'O identificador desta solicitação já foi utilizado.'
            );
          }
          const status = normalizeCommunityOfficialClaimStatus(
            existing['status']
          );
          if (
            status !== 'pending'
            && status !== 'verified'
            && status !== 'under_review'
            && status !== 'disputed'
          ) {
            throw new HttpsError(
              'data-loss',
              'O registro idempotente do vínculo oficial está inconsistente.'
            );
          }
          return {
            associationKey: command.associationKey,
            status,
            submitted: false,
          };
        }

        if (!communitySnapshot.exists) {
          throw new HttpsError(
            'not-found',
            'A Comunidade informada não foi encontrada.'
          );
        }

        const community = communitySnapshot.data() ?? {};
        if (
          community['status'] !== 'active'
          || cleanId(community['ownerUid']) !== actorUid
        ) {
          throw new HttpsError(
            'permission-denied',
            'Somente o proprietário de uma Comunidade ativa pode solicitar este vínculo.'
          );
        }

        const communityAssociationKey = normalizeCommunityOfficialAssociationKey(
          community['officialAssociationKey']
        );
        if (
          communityAssociationKey
          && communityAssociationKey !== command.associationKey
        ) {
          throw new HttpsError(
            'failed-precondition',
            'Esta Comunidade já possui outro vínculo oficial.'
          );
        }

        if (associationSnapshot.exists) {
          const association = associationSnapshot.data() ?? {};
          if (association['status'] === 'verified') {
            throw new HttpsError(
              'already-exists',
              'Esta entidade já possui uma Comunidade Oficial verificada.'
            );
          }
          if (association['status'] !== 'revoked') {
            throw new HttpsError(
              'data-loss',
              'O vínculo oficial existente está em um estado inconsistente.'
            );
          }
        }

        const now = Date.now();
        const existingClaim = claimSnapshot.exists
          ? claimSnapshot.data() ?? {}
          : null;
        const existingStatus = normalizeCommunityOfficialClaimStatus(
          existingClaim?.['status']
        );

        if (
          existingClaim
          && (
            existingStatus === 'pending'
            || existingStatus === 'under_review'
            || existingStatus === 'disputed'
            || existingStatus === 'verified'
          )
        ) {
          const sameClaim = cleanId(existingClaim['claimantUid']) === actorUid
            && cleanId(existingClaim['communityId']) === command.communityId;
          if (!sameClaim) {
            throw new HttpsError(
              'already-exists',
              'Já existe uma solicitação ativa para esta entidade oficial.'
            );
          }
          if (existingStatus === 'verified') {
            throw new HttpsError(
              'already-exists',
              'Este vínculo oficial já foi verificado.'
            );
          }

          transaction.create(requestRef, {
            actorUid,
            associationKey: command.associationKey,
            communityId: command.communityId,
            status: existingStatus,
            createdAt: now,
            updatedAt: now,
          });
          return {
            associationKey: command.associationKey,
            status: existingStatus,
            submitted: false,
          };
        }

        const submissionAttempt = existingClaim
          ? normalizePositiveInteger(existingClaim['submissionAttempt'], 0) + 1
          : 1;
        const createdAt = existingClaim
          ? normalizeCreatedAt(existingClaim['createdAt'], now)
          : now;
        const claim: CommunityOfficialClaimRecord = {
          claimId: command.associationKey,
          associationKey: command.associationKey,
          communityId: command.communityId,
          target: command.target,
          claimantUid: actorUid,
          authorityRole: command.authorityRole,
          sponsorOrganizationId: command.sponsorOrganizationId,
          evidenceReferences: command.evidenceReferences,
          status: 'pending',
          policyVersion: COMMUNITY_OFFICIAL_CLAIM_POLICY_VERSION,
          submissionAttempt,
          submittedAt: now,
          revalidationRequestedAt: null,
          reviewedAt: null,
          reviewedBy: null,
          reviewResolution: null,
          verificationExpiresAt: null,
          revalidationDueAt: null,
          createdAt,
          updatedAt: now,
        };

        transaction.set(claimRef, claim);
        transaction.create(requestRef, {
          actorUid,
          associationKey: command.associationKey,
          communityId: command.communityId,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        });
        transaction.create(auditRef, {
          action: 'official_claim_submitted',
          associationKey: command.associationKey,
          communityId: command.communityId,
          target: command.target,
          claimantUid: actorUid,
          authorityRole: command.authorityRole,
          sponsorOrganizationId: command.sponsorOrganizationId,
          evidenceReferenceCount: command.evidenceReferences.length,
          submissionAttempt,
          policyVersion: COMMUNITY_OFFICIAL_CLAIM_POLICY_VERSION,
          previousStatus: existingStatus,
          nextStatus: 'pending',
          createdAt: now,
        });

        return {
          associationKey: command.associationKey,
          status: 'pending' as const,
          submitted: true,
        };
      });
    }
  );

export const reviewCommunityOfficialClaim =
  onCall<ReviewCommunityOfficialClaimRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<{
      associationKey: string;
      status:
        | 'pending'
        | 'under_review'
        | 'verified'
        | 'rejected'
        | 'disputed'
        | 'revoked'
        | 'expired';
    }> => {
      assertRuntime();
      assertCommunityCallableAppCheck(request.app);
      const adminUid = assertAdmin(request.auth);
      const now = Date.now();
      const command = normalizeReviewCommunityOfficialClaimRequest(
        request.data,
        now
      );
      if (!command) {
        throw new HttpsError(
          'invalid-argument',
          'Revise a decisão, a justificativa e a validade da verificação.'
        );
      }

      await consumeCommunityRateLimit({
        action: 'content_moderation',
        actorUid: adminUid,
      });

      const claimRef = db
        .collection('community_official_claims')
        .doc(command.associationKey);
      const associationRef = db
        .collection('community_official_associations')
        .doc(command.associationKey);
      const auditRef = db.collection('community_official_claim_audit').doc();

      return db.runTransaction(async (transaction) => {
        const [claimSnapshot, associationSnapshot] = await Promise.all([
          transaction.get(claimRef),
          transaction.get(associationRef),
        ]);
        if (!claimSnapshot.exists) {
          throw new HttpsError(
            'not-found',
            'Solicitação de vínculo oficial não encontrada.'
          );
        }

        const claim = claimSnapshot.data() ?? {};
        const currentStatus = normalizeCommunityOfficialClaimStatus(
          claim['status']
        );
        const claimAssociationKey = normalizeCommunityOfficialAssociationKey(
          claim['associationKey']
        );
        const communityId = cleanId(claim['communityId']);
        const claimantUid = cleanId(claim['claimantUid']);
        const target = (claim['target'] ?? {}) as Record<string, unknown>;
        const targetType = target['type'];
        const targetId = cleanId(target['id']);
        const authorityRole = claim['authorityRole'];
        const sponsorOrganizationId = claim['sponsorOrganizationId'] === null
          ? null
          : cleanId(claim['sponsorOrganizationId']);

        if (
          !currentStatus
          || claimAssociationKey !== command.associationKey
          || !communityId
          || !claimantUid
          || !targetId
          || (
            targetType !== 'profile'
            && targetType !== 'organization'
            && targetType !== 'venue'
            && targetType !== 'event'
          )
          || (
            authorityRole !== 'self'
            && authorityRole !== 'owner'
            && authorityRole !== 'authorized_representative'
            && authorityRole !== 'manager'
            && authorityRole !== 'organizer'
            && authorityRole !== 'promoter'
          )
          || (claim['sponsorOrganizationId'] !== null && !sponsorOrganizationId)
        ) {
          throw new HttpsError(
            'data-loss',
            'A solicitação de vínculo oficial está inconsistente.'
          );
        }

        const nextStatus = resolveCommunityOfficialClaimNextStatus(
          currentStatus,
          command.decision
        );
        if (!nextStatus) {
          throw new HttpsError(
            'failed-precondition',
            'Esta decisão não é permitida para o estado atual da solicitação.'
          );
        }

        const communityRef = db.collection('communities').doc(communityId);
        const communitySnapshot = await transaction.get(communityRef);
        if (!communitySnapshot.exists) {
          throw new HttpsError(
            'failed-precondition',
            'A Comunidade vinculada à solicitação não existe mais.'
          );
        }

        const community = communitySnapshot.data() ?? {};
        const communityAssociationKey = normalizeCommunityOfficialAssociationKey(
          community['officialAssociationKey']
        );
        const association = associationSnapshot.exists
          ? associationSnapshot.data() ?? {}
          : null;
        const associationCommunityId = association
          ? cleanId(association['communityId'])
          : null;
        const associationStatus = association?.['status'];

        let previousCommunityRef: DocumentReference | null = null;
        if (
          command.decision === 'approve'
          && associationCommunityId
          && associationCommunityId !== communityId
        ) {
          const candidateRef = db
            .collection('communities')
            .doc(associationCommunityId);
          const previousSnapshot = await transaction.get(candidateRef);
          if (
            previousSnapshot.exists
            && normalizeCommunityOfficialAssociationKey(
              previousSnapshot.data()?.['officialAssociationKey']
            ) === command.associationKey
          ) {
            previousCommunityRef = candidateRef;
          }
        }

        let verifiedEvidence: Awaited<
          ReturnType<typeof assertCommunityOfficialClaimEvidence>
        > | null = null;

        if (command.decision === 'approve') {
          if (community['status'] !== 'active') {
            throw new HttpsError(
              'failed-precondition',
              'A Comunidade precisa estar ativa para receber verificação oficial.'
            );
          }
          if (
            communityAssociationKey
            && communityAssociationKey !== command.associationKey
          ) {
            throw new HttpsError(
              'failed-precondition',
              'A Comunidade já possui outro vínculo oficial.'
            );
          }
          if (
            association
            && associationStatus !== 'verified'
            && associationStatus !== 'revoked'
          ) {
            throw new HttpsError(
              'data-loss',
              'A associação oficial existente está inconsistente.'
            );
          }
          if (
            associationStatus === 'verified'
            && associationCommunityId !== communityId
          ) {
            throw new HttpsError(
              'already-exists',
              'A entidade já está vinculada a outra Comunidade Oficial.'
            );
          }

          verifiedEvidence = await assertCommunityOfficialClaimEvidence({
            transaction,
            target: { type: targetType, id: targetId },
            claimantUid,
            authorityRole,
            sponsorOrganizationId,
            evidenceReferences: claim['evidenceReferences'],
            now,
          });

          const officialAssociation = buildVerifiedCommunityOfficialAssociation({
            target: { type: targetType, id: targetId },
            communityId,
            sponsorOrganizationId: verifiedEvidence.sponsorOrganizationId,
            holderUid: claimantUid,
            authorityRole,
            verificationSource: verifiedEvidence.verificationSource,
            verifiedAt: now,
            verificationPolicyVersion:
              verifiedEvidence.verificationPolicyVersion,
            revalidationDueAt: command.revalidationDueAt,
            verificationExpiresAt: command.verificationExpiresAt,
            createdAt: association
              ? normalizeCreatedAt(association['createdAt'], now)
              : now,
          });
          if (!officialAssociation) {
            throw new HttpsError(
              'data-loss',
              'Não foi possível construir a associação oficial verificada.'
            );
          }

          if (previousCommunityRef) {
            transaction.update(previousCommunityRef, {
              officialAssociationKey: FieldValue.delete(),
              updatedAt: now,
            });
          }
          transaction.set(associationRef, officialAssociation);
          transaction.update(communityRef, {
            officialAssociationKey: command.associationKey,
            updatedAt: now,
          });
        } else if (
          shouldRevokeAssociationForClaimDecision(
            currentStatus,
            command.decision
          )
        ) {
          if (
            !association
            || associationStatus !== 'verified'
            || associationCommunityId !== communityId
          ) {
            throw new HttpsError(
              'failed-precondition',
              'Não existe uma associação verificada consistente para revogar.'
            );
          }
          transaction.update(associationRef, {
            status: 'revoked',
            revokedAt: now,
            activeRevalidationDueAt: null,
            activeVerificationExpiresAt: null,
            updatedAt: now,
          });
          if (communityAssociationKey === command.associationKey) {
            transaction.update(communityRef, {
              officialAssociationKey: FieldValue.delete(),
              updatedAt: now,
            });
          }
        } else if (command.decision === 'request_revalidation') {
          if (
            !association
            || associationStatus !== 'verified'
            || associationCommunityId !== communityId
          ) {
            throw new HttpsError(
              'failed-precondition',
              'Não existe uma associação verificada consistente para revalidar.'
            );
          }
          transaction.update(associationRef, {
            activeRevalidationDueAt: null,
            updatedAt: now,
          });
        }

        const claimPatch: Record<string, unknown> = {
          status: nextStatus,
          reviewedAt: now,
          reviewedBy: adminUid,
          reviewResolution: command.resolution,
          updatedAt: now,
        };
        if (command.decision === 'approve') {
          claimPatch['verificationExpiresAt'] = command.verificationExpiresAt;
          claimPatch['revalidationDueAt'] = command.revalidationDueAt;
          claimPatch['revalidationRequestedAt'] = null;
          claimPatch['sponsorOrganizationId'] =
            verifiedEvidence?.sponsorOrganizationId ?? null;
        } else if (command.decision === 'request_revalidation') {
          claimPatch['revalidationRequestedAt'] = now;
        } else if (
          command.decision === 'mark_disputed'
          || command.decision === 'revoke'
          || command.decision === 'expire'
        ) {
          claimPatch['verificationExpiresAt'] = null;
          claimPatch['revalidationDueAt'] = null;
        }

        transaction.update(claimRef, claimPatch);
        transaction.create(auditRef, {
          action: `official_claim_${command.decision}`,
          associationKey: command.associationKey,
          communityId,
          target: { type: targetType, id: targetId },
          claimantUid,
          actorUid: adminUid,
          previousStatus: currentStatus,
          nextStatus,
          resolution: command.resolution,
          verificationSource: verifiedEvidence?.verificationSource ?? null,
          verifiedEvidenceType: verifiedEvidence?.evidenceType ?? null,
          verificationExpiresAt: command.verificationExpiresAt,
          revalidationDueAt: command.revalidationDueAt,
          policyVersion: COMMUNITY_OFFICIAL_CLAIM_POLICY_VERSION,
          createdAt: now,
        });

        return { associationKey: command.associationKey, status: nextStatus };
      });
    }
  );