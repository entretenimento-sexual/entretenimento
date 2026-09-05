// functions/src/community/get-my-community-official-claim.handler.ts
// -----------------------------------------------------------------------------
// GET MY COMMUNITY OFFICIAL CLAIM
// -----------------------------------------------------------------------------
// Leitura privada e sanitizada do claim oficial do próprio solicitante.
// Evidências, KYC/KYB, reviewerUid e notas internas nunca atravessam esta fronteira.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  buildCommunityOfficialAssociationKey,
  type CommunityOfficialTarget,
} from './community-official-association.model';
import {
  normalizeCommunityOfficialClaimStatus,
  type CommunityOfficialClaimStatus,
} from './community-official-claim.model';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  assertCommunitySocialAccessForUid,
} from './community-social-access.service';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

interface GetMyCommunityOfficialClaimRequest {
  readonly target?: unknown;
}

interface MyCommunityOfficialClaimView {
  readonly associationKey: string;
  readonly communityId: string;
  readonly target: CommunityOfficialTarget;
  readonly status: CommunityOfficialClaimStatus;
  readonly submittedAt: number;
  readonly updatedAt: number;
  readonly revalidationDueAt: number | null;
  readonly verificationExpiresAt: number | null;
}

interface GetMyCommunityOfficialClaimResponse {
  readonly claim: MyCommunityOfficialClaimView | null;
  readonly generatedAt: number;
}

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

function normalizeTarget(value: unknown): CommunityOfficialTarget | null {
  const source = (value ?? {}) as Record<string, unknown>;
  const type = source['type'];
  const id = cleanId(source['id']);

  if (
    !id
    || (
      type !== 'profile'
      && type !== 'organization'
      && type !== 'venue'
      && type !== 'event'
    )
  ) {
    return null;
  }

  return { type, id };
}

function normalizeEpoch(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeOptionalEpoch(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return normalizeEpoch(value);
}

function sameTarget(
  left: CommunityOfficialTarget,
  right: CommunityOfficialTarget
): boolean {
  return left.type === right.type && left.id === right.id;
}

export const getMyCommunityOfficialClaim =
  onCall<GetMyCommunityOfficialClaimRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<GetMyCommunityOfficialClaimResponse> => {
      assertCommunityCallableAppCheck(request.app);
      assertRuntime();

      const uid = cleanId(request.auth?.uid);
      if (!uid) {
        throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
      }

      if (request.auth?.token?.['email_verified'] !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Verifique seu e-mail para continuar.'
        );
      }

      await assertCommunitySocialAccessForUid(uid);

      const target = normalizeTarget(request.data?.target);
      const associationKey = target
        ? buildCommunityOfficialAssociationKey(target)
        : null;

      if (!target || !associationKey) {
        throw new HttpsError(
          'invalid-argument',
          'A entidade oficial informada não é válida.'
        );
      }

      const snapshot = await db
        .collection('community_official_claims')
        .doc(associationKey)
        .get();
      const generatedAt = Date.now();

      if (!snapshot.exists) {
        return { claim: null, generatedAt };
      }

      const raw = snapshot.data() ?? {};

      // Não revela a existência de claim pertencente a outra pessoa. Isso evita
      // transformar o endpoint privado em um oráculo de ownership/claim.
      if (cleanId(raw['claimantUid']) !== uid) {
        return { claim: null, generatedAt };
      }

      const rawTarget = normalizeTarget(raw['target']);
      const communityId = cleanId(raw['communityId']);
      const status = normalizeCommunityOfficialClaimStatus(raw['status']);
      const submittedAt = normalizeEpoch(raw['submittedAt']);
      const updatedAt = normalizeEpoch(raw['updatedAt']);
      const revalidationDueAt = normalizeOptionalEpoch(raw['revalidationDueAt']);
      const verificationExpiresAt = normalizeOptionalEpoch(
        raw['verificationExpiresAt']
      );

      if (
        raw['associationKey'] !== associationKey
        || !rawTarget
        || !sameTarget(rawTarget, target)
        || !communityId
        || !status
        || !submittedAt
        || !updatedAt
        || updatedAt < submittedAt
      ) {
        throw new HttpsError(
          'data-loss',
          'A solicitação de vínculo oficial está inconsistente.'
        );
      }

      return {
        claim: {
          associationKey,
          communityId,
          target,
          status,
          submittedAt,
          updatedAt,
          revalidationDueAt,
          verificationExpiresAt,
        },
        generatedAt,
      };
    }
  );
