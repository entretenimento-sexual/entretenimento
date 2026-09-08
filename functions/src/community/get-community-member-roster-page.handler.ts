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
// - o cursor é transporte opaco e não deve ser tratado como identidade pública.
//
// Custo:
// - não há listener;
// - a consulta só acontece quando a pessoa abre a listagem;
// - paginação e scan limitado evitam hidratar toda a Comunidade de uma vez.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { resolveBlockedTargetUids } from '../friendship/application/bilateral-block-access.policy';
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
const CURSOR_PREFIX = 'roster1:';
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

function buildMemberKey(communityId: string, memberId: string): string {
  return createHash('sha256')
    .update(`${communityId}\u0000${memberId}`)
    .digest('base64url')
    .slice(0, 22);
}

function buildCursor(memberId: string): string {
  return `${CURSOR_PREFIX}${Buffer.from(memberId, 'utf8').toString('base64url')}`;
}

function parseCursor(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  if (!normalized.startsWith(CURSOR_PREFIX) || normalized.length > 240) {
    return null;
  }

  try {
    const decoded = Buffer.from(
      normalized.slice(CURSOR_PREFIX.length),
      'base64url'
    ).toString('utf8');
    return SAFE_MEMBER_ID_PATTERN.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
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
      const cursorMemberId = parseCursor(request.data?.cursor);
      const limit = normalizePageLimit(request.data?.limit);

      if (!communityId || (providedCursor && !cursorMemberId)) {
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

      const membersCollection = db
        .collection('communities')
        .doc(communityId)
        .collection('members');
      const scanLimit = Math.min(limit * 2 + 1, MAX_PAGE_LIMIT * 2 + 1);
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
      let lastConsumedIndex = -1;

      for (
        let index = 0;
        index < membershipSnapshot.docs.length;
        index += 1
      ) {
        const membershipDocument = membershipSnapshot.docs[index];
        lastConsumedIndex = index;
        const memberId = membershipDocument.id;

        if (blockedUids.has(memberId)) continue;

        const membership = membershipDocument.data() ?? {};
        const role = normalizeRole(membership['role']);
        const profile = profilesByUid.get(memberId);
        const nickname = profile
          ? normalizeText(profile['nickname'], 60)
          : '';

        if (!role || nickname.length < 2) continue;

        items.push({
          memberKey: buildMemberKey(communityId, memberId),
          identity: {
            nickname,
            label: nickname,
            avatarUrl: normalizeHttpsUrl(
              profile?.['avatarUrl'] ?? profile?.['photoURL']
            ),
          },
          role,
        });

        if (items.length >= limit) break;
      }

      const lastConsumedDocument = lastConsumedIndex >= 0
        ? membershipSnapshot.docs[lastConsumedIndex]
        : null;
      const hasBufferedDocuments =
        lastConsumedIndex >= 0
        && lastConsumedIndex < membershipSnapshot.docs.length - 1;
      const mayHaveAnotherPage =
        membershipSnapshot.docs.length === scanLimit || hasBufferedDocuments;

      return {
        items,
        nextCursor: mayHaveAnotherPage && lastConsumedDocument
          ? buildCursor(lastConsumedDocument.id)
          : null,
        memberCount:
          context.capacity?.memberCount
          ?? context.community.metrics.memberCount,
        generatedAt: Date.now(),
      };
    }
  );
