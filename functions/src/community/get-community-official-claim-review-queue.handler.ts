// functions/src/community/get-community-official-claim-review-queue.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL CLAIM REVIEW QUEUE
// -----------------------------------------------------------------------------
// Fila administrativa backend-only para revisão de vínculos oficiais.
// Nenhuma evidência KYC/KYB bruta atravessa esta fronteira; somente referências
// opacas já persistidas no claim privado são retornadas para a equipe autorizada.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  normalizeCommunityOfficialClaimStatus,
  type CommunityOfficialClaimEvidenceReference,
  type CommunityOfficialClaimStatus,
} from './community-official-claim.model';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,192}$/;
const REVIEW_STATUSES = ['pending', 'under_review', 'disputed'] as const;
const MAX_PER_STATUS = 40;
const MAX_ITEMS = 75;

interface CommunityOfficialClaimReviewQueueItem {
  associationKey: string;
  communityId: string;
  target: {
    type: 'profile' | 'organization' | 'venue' | 'event';
    id: string;
  };
  claimantUid: string;
  authorityRole:
    | 'self'
    | 'owner'
    | 'authorized_representative'
    | 'manager'
    | 'organizer'
    | 'promoter';
  sponsorOrganizationId: string | null;
  evidenceReferences: CommunityOfficialClaimEvidenceReference[];
  status: CommunityOfficialClaimStatus;
  submittedAt: number;
  revalidationRequestedAt: number | null;
  updatedAt: number;
}

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'A revisão de Comunidades Oficiais ainda não está disponível neste ambiente.'
  );
}

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function cleanEpoch(value: unknown): number | null {
  const normalized = Math.trunc(Number(value));
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
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
      'Apenas administradores podem acessar esta fila.'
    );
  }

  return adminUid;
}

function normalizeTarget(raw: unknown): CommunityOfficialClaimReviewQueueItem['target'] | null {
  const source = (raw ?? {}) as Record<string, unknown>;
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

function normalizeAuthorityRole(
  value: unknown
): CommunityOfficialClaimReviewQueueItem['authorityRole'] | null {
  return value === 'self'
    || value === 'owner'
    || value === 'authorized_representative'
    || value === 'manager'
    || value === 'organizer'
    || value === 'promoter'
    ? value
    : null;
}

function normalizeEvidenceReferences(
  value: unknown
): CommunityOfficialClaimEvidenceReference[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((raw) => {
      const source = (raw ?? {}) as Record<string, unknown>;
      const type = source['type'];
      const referenceId = cleanId(source['referenceId']);

      if (
        !referenceId
        || (
          type !== 'profile_kyc_record'
          && type !== 'organization_kyb_record'
          && type !== 'authority_record'
          && type !== 'event_authorization_record'
        )
      ) {
        return null;
      }

      return { type, referenceId } satisfies CommunityOfficialClaimEvidenceReference;
    })
    .filter(
      (reference): reference is CommunityOfficialClaimEvidenceReference => !!reference
    )
    .slice(0, 8);
}

function normalizeQueueItem(raw: Record<string, unknown>): CommunityOfficialClaimReviewQueueItem | null {
  const associationKey = cleanId(raw['associationKey']);
  const communityId = cleanId(raw['communityId']);
  const target = normalizeTarget(raw['target']);
  const claimantUid = cleanId(raw['claimantUid']);
  const authorityRole = normalizeAuthorityRole(raw['authorityRole']);
  const status = normalizeCommunityOfficialClaimStatus(raw['status']);
  const submittedAt = cleanEpoch(raw['submittedAt']);
  const updatedAt = cleanEpoch(raw['updatedAt']);
  const revalidationRequestedAt = raw['revalidationRequestedAt'] === null
    ? null
    : cleanEpoch(raw['revalidationRequestedAt']);
  const sponsorOrganizationId = raw['sponsorOrganizationId'] === null
    || raw['sponsorOrganizationId'] === undefined
    ? null
    : cleanId(raw['sponsorOrganizationId']);

  if (
    !associationKey
    || !communityId
    || !target
    || !claimantUid
    || !authorityRole
    || !status
    || !REVIEW_STATUSES.includes(status as typeof REVIEW_STATUSES[number])
    || !submittedAt
    || !updatedAt
    || (
      raw['sponsorOrganizationId'] !== null
      && raw['sponsorOrganizationId'] !== undefined
      && !sponsorOrganizationId
    )
  ) {
    return null;
  }

  return {
    associationKey,
    communityId,
    target,
    claimantUid,
    authorityRole,
    sponsorOrganizationId,
    evidenceReferences: normalizeEvidenceReferences(raw['evidenceReferences']),
    status,
    submittedAt,
    revalidationRequestedAt,
    updatedAt,
  };
}

export const getCommunityOfficialClaimReviewQueue = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<{ items: CommunityOfficialClaimReviewQueueItem[] }> => {
    assertRuntime();
    assertCommunityCallableAppCheck(request.app);
    const adminUid = assertAdmin(request.auth);

    await consumeCommunityRateLimit({
      action: 'content_moderation',
      actorUid: adminUid,
    });

    const snapshots = await Promise.all(
      REVIEW_STATUSES.map((status) =>
        db
          .collection('community_official_claims')
          .where('status', '==', status)
          .limit(MAX_PER_STATUS)
          .get()
      )
    );

    const itemsByAssociationKey = new Map<
      string,
      CommunityOfficialClaimReviewQueueItem
    >();

    for (const snapshot of snapshots) {
      for (const document of snapshot.docs) {
        const item = normalizeQueueItem(document.data() ?? {});
        if (!item) continue;

        const previous = itemsByAssociationKey.get(item.associationKey);
        if (!previous || item.updatedAt > previous.updatedAt) {
          itemsByAssociationKey.set(item.associationKey, item);
        }
      }
    }

    const items = [...itemsByAssociationKey.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_ITEMS);

    return { items };
  }
);
