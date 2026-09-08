// functions/src/community/get-community-member-roster-page.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY MEMBER ROSTER PAGE
// -----------------------------------------------------------------------------
// Lista interna e paginada de integrantes de uma Comunidade.
//
// Privacidade:
// - somente membership ativa pode consultar;
// - visitantes e solicitações pendentes não enumeram participantes;
// - a resposta usa apenas public_profiles e nunca expõe UID, nome civil, KYC,
//   capacidades administrativas ou documentos privados;
// - bloqueios bilaterais são respeitados antes da hidratação do perfil;
// - paginação usa o profileId público canônico, nunca o UID interno.
//
// Custo:
// - não há listener;
// - a consulta só acontece quando a pessoa abre a listagem;
// - paginação e scan limitado evitam hidratar toda a Comunidade de uma vez.
// -----------------------------------------------------------------------------

import { FieldPath } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { resolveBlockedTargetUids } from '../friendship/application/bilateral-block-access.policy';
import { normalizePublicProfileId } from '../identity/public-profile-id';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import { normalizeCommunityId } from './community-preview.model';
import { getCommunityViewerContext } from './community-viewer-access.service';

type CommunityMemberRosterRole = 'owner' | 'admin' | 'moderator' | 'member';

interface CommunityMemberRosterPageRequest {
  communityId?: unknown;
  cursor?: unknown;
  limit?: unknown;
}

interface CommunityMemberRosterItem {
  memberKey: string;
  identity: {
    profileId: string;
    nickname: string;
    label: string;
    avatarUrl: string | null;
  };
  role: CommunityMemberRosterRole;
}

interface CommunityMemberRosterPageResponse {
  items: CommunityMemberRosterItem[];
  nextCursor: string | null;
  memberCount: number;
  generatedAt: number;
}

const SAFE_MEMBER_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 40;

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'A lista de integrantes ainda não está disponível neste ambiente.',
    { reason: 'community_member_roster_unavailable' }
  );
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();
  if (!SAFE_MEMBER_ID_PATTERN.test(uid)) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail para continuar.',
      { reason: 'email_verification_required' }
    );
  }

  return uid;
}

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- Sanitização intencional.
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeHttpsUrl(value: unknown): string | null {
  const normalized = normalizeText(value, 2_000);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeRole(value: unknown): CommunityMemberRosterRole | null {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function normalizePageLimit(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), MAX_PAGE_LIMIT)
    : DEFAULT_PAGE_LIMIT;
}

async function resolveCursorMemberId(
  communityId: string,
  cursorProfileId: string | null
): Promise<string | null> {
  if (!cursorProfileId) return null;

  const profileSnapshot = await db
    .collection('public_profiles')
    .where('profileId', '==', cursorProfileId)
    .limit(2)
    .get();

  if (profileSnapshot.size !== 1) {
    throw new HttpsError(
      'invalid-argument',
      'Cursor da lista de integrantes inválido.',
      { reason: 'invalid_community_member_roster_cursor' }
    );
  }

  const memberId = profileSnapshot.docs[0].id;
  if (!SAFE_MEMBER_ID_PATTERN.test(memberId)) {
    throw new HttpsError(
      'invalid-argument',
      'Cursor da lista de integrantes inválido.',
      { reason: 'invalid_community_member_roster_cursor' }
    );
  }

  const membershipSnapshot = await db
    .collection('communities')
    .doc(communityId)
    .collection('members')
    .doc(memberId)
    .get();

  if (
    !membershipSnapshot.exists
    || membershipSnapshot.data()?.['status'] !== 'active'
  ) {
    throw new HttpsError(
      'invalid-argument',
      'Cursor da lista de integrantes inválido.',
      { reason: 'invalid_community_member_roster_cursor' }
    );
  }

  return memberId;
}

export const getCommunityMemberRosterPage =
  onCall<CommunityMemberRosterPageRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityMemberRosterPageResponse> => {
      assertCommunityCallableAppCheck(request.app);
      assertRuntime();

      const actorUid = assertAuthenticatedUid(request.auth);
      const communityId = normalizeCommunityId(request.data?.communityId);
      const providedCursor = String(request.data?.cursor ?? '').trim();
      const cursorProfileId = providedCursor
        ? normalizePublicProfileId(providedCursor)
        : null;
      const limit = normalizePageLimit(request.data?.limit);

      if (!communityId || (providedCursor && !cursorProfileId)) {
        throw new HttpsError(
          'invalid-argument',
          'Consulta de integrantes inválida.',
          { reason: 'invalid_community_member_roster_query' }
        );
      }

      const context = await getCommunityViewerContext(actorUid, communityId);
      if (
        context.community.source.type !== 'community'
        || !context.activeMembership
      ) {
        throw new HttpsError(
          'permission-denied',
          'A lista de integrantes é visível somente para participantes ativos.',
          { reason: 'community_member_roster_membership_required' }
        );
      }

      const cursorMemberId = await resolveCursorMemberId(
        communityId,
        cursorProfileId
      );
      const membersCollection = db
        .collection('communities')
        .doc(communityId)
        .collection('members');
      const scanLimit = Math.min(limit * 3 + 1, MAX_PAGE_LIMIT * 3 + 1);
      let membersQuery = membersCollection
        .where('status', '==', 'active')
        .orderBy(FieldPath.documentId())
        .limit(scanLimit);

      if (cursorMemberId) {
        membersQuery = membersQuery.startAfter(cursorMemberId);
      }

      const membershipSnapshot = await membersQuery.get();
      const candidateIds = membershipSnapshot.docs.map((document) => document.id);
      const blockedUids = await resolveBlockedTargetUids(actorUid, candidateIds);
      const visibleIds = candidateIds.filter((uid) => !blockedUids.has(uid));
      const profileSnapshots = visibleIds.length > 0
        ? await db.getAll(
          ...visibleIds.map((uid) => db.collection('public_profiles').doc(uid))
        )
        : [];
      const profilesByUid = new Map(
        profileSnapshots.map((snapshot) => [
          snapshot.id,
          snapshot.exists ? snapshot.data() ?? {} : null,
        ])
      );

      const items: CommunityMemberRosterItem[] = [];
      let lastReturnedMemberId: string | null = null;
      let lastReturnedProfileId: string | null = null;

      for (const membershipDocument of membershipSnapshot.docs) {
        const memberId = membershipDocument.id;
        if (blockedUids.has(memberId)) continue;

        const membership = membershipDocument.data() ?? {};
        const role = normalizeRole(membership['role']);
        const profile = profilesByUid.get(memberId);
        const profileId = normalizePublicProfileId(profile?.['profileId']);
        const nickname = profile
          ? normalizeText(profile['nickname'], 60)
          : '';

        if (!role || !profileId || nickname.length < 2) continue;

        items.push({
          memberKey: profileId,
          identity: {
            profileId,
            nickname,
            label: nickname,
            avatarUrl: normalizeHttpsUrl(
              profile?.['avatarUrl'] ?? profile?.['photoURL']
            ),
          },
          role,
        });
        lastReturnedMemberId = memberId;
        lastReturnedProfileId = profileId;

        if (items.length >= limit) break;
      }

      const lastScannedDocument = membershipSnapshot.docs.at(-1) ?? null;
      const stoppedBeforeScanEnd =
        !!lastReturnedMemberId
        && lastReturnedMemberId !== lastScannedDocument?.id;
      const mayHaveAnotherPage =
        stoppedBeforeScanEnd
        || membershipSnapshot.docs.length === scanLimit;

      return {
        items,
        nextCursor: mayHaveAnotherPage ? lastReturnedProfileId : null,
        memberCount:
          context.capacity?.memberCount
          ?? context.community.metrics.memberCount,
        generatedAt: Date.now(),
      };
    }
  );
