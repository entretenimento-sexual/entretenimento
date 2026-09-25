// functions/src/community/get-community-search-page.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY SEARCH PAGE
// -----------------------------------------------------------------------------
// Busca interna paginada de Comunidades. A primeira fase cobre Membros e
// Discussões. Mural será integrado em fase posterior sem alterar este boundary.
//
// Segurança:
// - o browser nunca acessa os índices diretamente;
// - membro é revalidado na membership canônica, no perfil público vigente e nos
//   bloqueios bilaterais antes de ser devolvido;
// - Discussões reutilizam exatamente a policy de audiência dos Tópicos;
// - cursores de membros não transportam UID.
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
import { isCurrentCommunityMemberPublicProfile } from './community-member-public-profile.policy';
import { normalizeCommunityId } from './community-preview.model';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  normalizeCommunitySearchQuery,
  normalizeCommunitySearchText,
} from './community-search-text.policy';
import {
  canViewerReadCommunityTopicProjection,
  resolveCommunityTopicContentAccess,
} from './community-topic-access.policy';
import {
  type CommunityTopicListItem,
  sanitizeCommunityTopicProjection,
} from './community-topic.model';
import { getCommunityViewerContext } from './community-viewer-access.service';

type CommunitySearchScope = 'members' | 'topics';
type CommunityMemberRole = 'owner' | 'admin' | 'moderator' | 'member';

interface CommunitySearchPageRequest {
  communityId?: unknown;
  query?: unknown;
  scope?: unknown;
  cursor?: unknown;
  limit?: unknown;
}

interface CommunitySearchMemberItem {
  type: 'member';
  memberKey: string;
  identity: {
    profileId: string;
    nickname: string;
    label: string;
    avatarUrl: string | null;
  };
  role: CommunityMemberRole;
}

interface CommunitySearchTopicItem extends CommunityTopicListItem {
  type: 'topic';
}

type CommunitySearchItem = CommunitySearchMemberItem | CommunitySearchTopicItem;

interface CommunitySearchPageResponse {
  scope: CommunitySearchScope;
  query: string;
  available: boolean;
  items: CommunitySearchItem[];
  nextCursor: string | null;
  generatedAt: number;
}

interface MemberCursor {
  query: string;
  sortLabel: string;
  searchKey: string;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9:_-]{1,512}$/;
const SEARCH_KEY_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_PAGE_LIMIT = 12;
const MAX_PAGE_LIMIT = 20;

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'A busca interna ainda não está disponível neste ambiente.',
    { reason: 'community_search_unavailable' }
  );
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();
  if (!SAFE_ID_PATTERN.test(uid)) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.', {
      reason: 'authentication_required',
    });
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

function normalizeScope(value: unknown): CommunitySearchScope | null {
  return value === 'members' || value === 'topics' ? value : null;
}

function normalizePageLimit(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), MAX_PAGE_LIMIT)
    : DEFAULT_PAGE_LIMIT;
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

function normalizeRole(value: unknown): CommunityMemberRole | null {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function normalizeCursorToken(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  return CURSOR_PATTERN.test(normalized) ? normalized : null;
}

function encodeMemberCursor(position: MemberCursor): string {
  const payload = JSON.stringify({
    q: position.query,
    s: position.sortLabel,
    k: position.searchKey,
  });
  return `m1_${Buffer.from(payload, 'utf8').toString('base64url')}`;
}

function decodeMemberCursor(
  token: string,
  expectedQuery: string
): MemberCursor | null {
  if (!token.startsWith('m1_')) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(token.slice(3), 'base64url').toString('utf8')
    ) as Record<string, unknown>;
    const query = normalizeCommunitySearchQuery(parsed['q']);
    const sortLabel = normalizeCommunitySearchText(parsed['s']);
    const searchKey = String(parsed['k'] ?? '').trim();

    if (
      !query
      || query !== expectedQuery
      || !sortLabel
      || !SEARCH_KEY_PATTERN.test(searchKey)
    ) {
      return null;
    }

    return { query, sortLabel, searchKey };
  } catch {
    return null;
  }
}

async function searchMembers(input: {
  actorUid: string;
  communityId: string;
  query: string;
  cursor: string;
  limit: number;
  activeMembership: boolean;
}): Promise<Pick<CommunitySearchPageResponse, 'available' | 'items' | 'nextCursor'>> {
  if (!input.activeMembership) {
    return { available: false, items: [], nextCursor: null };
  }

  const cursorPosition = input.cursor
    ? decodeMemberCursor(input.cursor, input.query)
    : null;
  if (input.cursor && !cursorPosition) {
    throw new HttpsError(
      'invalid-argument',
      'Cursor de busca de membros inválido.',
      { reason: 'invalid_community_search_cursor' }
    );
  }

  const scanLimit = Math.min(input.limit * 3 + 1, MAX_PAGE_LIMIT * 3 + 1);
  let query = db
    .collection('community_member_management_index')
    .where('communityId', '==', input.communityId)
    .where('status', '==', 'active')
    .where('publicSearchPrefixes', 'array-contains', input.query)
    .orderBy('publicSearchSortLabel')
    .orderBy('searchKey')
    .limit(scanLimit);

  if (cursorPosition) {
    query = query.startAfter(
      cursorPosition.sortLabel,
      cursorPosition.searchKey
    );
  }

  const snapshot = await query.get();
  const candidateIds = snapshot.docs
    .map((document) => String(document.data()?.['memberId'] ?? '').trim())
    .filter((memberId) => SAFE_ID_PATTERN.test(memberId));
  const blocked = await resolveBlockedTargetUids(input.actorUid, candidateIds);
  const communityRef = db.collection('communities').doc(input.communityId);
  const visibleIds = candidateIds.filter((memberId) => !blocked.has(memberId));
  const [membershipSnapshots, profileSnapshots] = visibleIds.length > 0
    ? await Promise.all([
      db.getAll(
        ...visibleIds.map((memberId) => communityRef.collection('members').doc(memberId))
      ),
      db.getAll(
        ...visibleIds.map((memberId) => db.collection('public_profiles').doc(memberId))
      ),
    ])
    : [[], []];

  const memberships = new Map(
    membershipSnapshots.map((document) => [document.id, document] as const)
  );
  const profiles = new Map(
    profileSnapshots.map((document) => [document.id, document] as const)
  );
  const nowMs = Date.now();
  const items: CommunitySearchMemberItem[] = [];
  let lastConsumedIndex = -1;

  for (let index = 0; index < snapshot.docs.length; index += 1) {
    const projectionDocument = snapshot.docs[index];
    lastConsumedIndex = index;
    const memberId = String(
      projectionDocument.data()?.['memberId'] ?? ''
    ).trim();

    if (!SAFE_ID_PATTERN.test(memberId) || blocked.has(memberId)) continue;

    const membershipSnapshot = memberships.get(memberId);
    const profileSnapshot = profiles.get(memberId);
    const membership = membershipSnapshot?.exists
      ? membershipSnapshot.data() ?? {}
      : null;
    const profile = profileSnapshot?.exists
      ? profileSnapshot.data() ?? {}
      : null;
    const role = membership ? normalizeRole(membership['role']) : null;
    const profileId = profile ? normalizePublicProfileId(profile['profileId']) : null;
    const nickname = profile ? normalizeText(profile['nickname'], 60) : '';

    if (
      membership?.['status'] !== 'active'
      || !role
      || !profileId
      || nickname.length < 2
      || !isCurrentCommunityMemberPublicProfile(profile, nowMs)
    ) {
      continue;
    }

    items.push({
      type: 'member',
      memberKey: profileId,
      identity: {
        profileId,
        nickname,
        label: nickname,
        avatarUrl: normalizeHttpsUrl(profile['avatarUrl'] ?? profile['photoURL']),
      },
      role,
    });

    if (items.length >= input.limit) break;
  }

  const lastConsumedDocument = lastConsumedIndex >= 0
    ? snapshot.docs[lastConsumedIndex]
    : null;
  const buffered = lastConsumedIndex >= 0
    && lastConsumedIndex < snapshot.docs.length - 1;
  const mayHaveAnotherPage =
    snapshot.docs.length === scanLimit || buffered;
  const lastSortLabel = String(
    lastConsumedDocument?.data()?.['publicSearchSortLabel'] ?? ''
  ).trim();
  const lastSearchKey = String(
    lastConsumedDocument?.data()?.['searchKey'] ?? ''
  ).trim();

  return {
    available: true,
    items,
    nextCursor:
      mayHaveAnotherPage
      && lastSortLabel
      && SEARCH_KEY_PATTERN.test(lastSearchKey)
        ? encodeMemberCursor({
          query: input.query,
          sortLabel: lastSortLabel,
          searchKey: lastSearchKey,
        })
        : null,
  };
}

async function searchTopics(input: {
  communityId: string;
  query: string;
  cursor: string;
  limit: number;
  topicContentAccess: boolean;
}): Promise<Pick<CommunitySearchPageResponse, 'available' | 'items' | 'nextCursor'>> {
  const topicsCollection = db
    .collection('community_public_topics')
    .doc(input.communityId)
    .collection('items');
  const scanLimit = Math.min(input.limit * 3 + 1, MAX_PAGE_LIMIT * 3 + 1);
  let query = topicsCollection
    .where('searchPrefixes', 'array-contains', input.query)
    .orderBy('lastActivityAt', 'desc')
    .orderBy(FieldPath.documentId())
    .limit(scanLimit);

  if (input.cursor) {
    const cursorTopicId = String(input.cursor).trim();
    if (!SAFE_ID_PATTERN.test(cursorTopicId)) {
      throw new HttpsError(
        'invalid-argument',
        'Cursor de busca de Discussões inválido.',
        { reason: 'invalid_community_search_cursor' }
      );
    }

    const cursorSnapshot = await topicsCollection.doc(cursorTopicId).get();
    const cursorProjection = cursorSnapshot.exists
      ? sanitizeCommunityTopicProjection(
        cursorSnapshot.id,
        cursorSnapshot.data(),
        Date.now()
      )
      : null;
    const cursorPrefixes = Array.isArray(cursorSnapshot.data()?.['searchPrefixes'])
      ? cursorSnapshot.data()?.['searchPrefixes'] as unknown[]
      : [];

    if (
      !cursorProjection
      || !cursorPrefixes.includes(input.query)
      || !canViewerReadCommunityTopicProjection(
        cursorProjection,
        input.topicContentAccess
      )
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Cursor de busca de Discussões inválido.',
        { reason: 'invalid_community_search_cursor' }
      );
    }

    query = query.startAfter(cursorSnapshot);
  }

  const snapshot = await query.get();
  const items: CommunitySearchTopicItem[] = [];
  let lastConsumedIndex = -1;
  const nowMs = Date.now();

  for (let index = 0; index < snapshot.docs.length; index += 1) {
    const document = snapshot.docs[index];
    lastConsumedIndex = index;
    const projection = sanitizeCommunityTopicProjection(
      document.id,
      document.data(),
      nowMs
    );

    if (
      !projection
      || !canViewerReadCommunityTopicProjection(
        projection,
        input.topicContentAccess
      )
    ) {
      continue;
    }

    items.push({ type: 'topic', ...projection.item });
    if (items.length >= input.limit) break;
  }

  const lastConsumedDocument = lastConsumedIndex >= 0
    ? snapshot.docs[lastConsumedIndex]
    : null;
  const buffered = lastConsumedIndex >= 0
    && lastConsumedIndex < snapshot.docs.length - 1;
  const mayHaveAnotherPage =
    snapshot.docs.length === scanLimit || buffered;

  return {
    available: true,
    items,
    nextCursor: mayHaveAnotherPage
      ? lastConsumedDocument?.id ?? null
      : null,
  };
}

export const getCommunitySearchPage = onCall<CommunitySearchPageRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunitySearchPageResponse> => {
    assertCommunityCallableAppCheck(request.app);
    assertRuntime();

    const actorUid = assertAuthenticatedUid(request.auth);
    const communityId = normalizeCommunityId(request.data?.communityId);
    const query = normalizeCommunitySearchQuery(request.data?.query);
    const scope = normalizeScope(request.data?.scope);
    const cursor = normalizeCursorToken(request.data?.cursor);
    const providedCursor = String(request.data?.cursor ?? '').trim();
    const limit = normalizePageLimit(request.data?.limit);

    if (
      !communityId
      || !scope
      || !query
      || (providedCursor && cursor === null)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Consulta de busca interna inválida.',
        { reason: 'invalid_community_search_query' }
      );
    }

    const context = await getCommunityViewerContext(actorUid, communityId);
    if (context.community.source.type !== 'community') {
      throw new HttpsError(
        'failed-precondition',
        'A busca interna está disponível apenas em Comunidades.',
        { reason: 'community_search_not_supported' }
      );
    }

    const page = scope === 'members'
      ? await searchMembers({
        actorUid,
        communityId,
        query,
        cursor: cursor ?? '',
        limit,
        activeMembership: Boolean(context.activeMembership),
      })
      : await searchTopics({
        communityId,
        query,
        cursor: cursor ?? '',
        limit,
        topicContentAccess: resolveCommunityTopicContentAccess(
          context.memberContentAccess,
          context.authenticatedPreviewAccess
        ),
      });

    return {
      scope,
      query,
      ...page,
      generatedAt: Date.now(),
    };
  }
);
