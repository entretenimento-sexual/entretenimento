// -----------------------------------------------------------------------------
// COMMUNITY HIGHLIGHT MANAGEMENT
// -----------------------------------------------------------------------------
// Mantém um único destaque editorial por Comunidade. O destaque referencia a
// publicação original e nunca altera publishedAt nem a paginação cronológica do
// Mural. A V1 aceita somente targetType=feed_post.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  normalizeCommunityHighlightRequest,
  normalizeCommunityHighlightSnapshot,
  resolveCommunityHighlightExpiresAt,
  type CommunityHighlightRequest,
  type CommunityHighlightResponse,
  type CommunityHighlightSnapshot,
} from './community-highlight.model';
import {
  evaluateCommunityHighlightAction,
  type CommunityHighlightDenialReason,
} from './community-highlight.policy';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import type { CommunityFeedWriterRole } from './community-feed-write.policy';

function assertHighlightRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'Os destaques da Comunidade ainda não estão disponíveis neste ambiente.',
    { reason: 'community_highlight_unavailable' }
  );
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();
  if (!uid) {
    throw new HttpsError(
      'unauthenticated',
      'Usuário não autenticado.',
      { reason: 'authentication_required' }
    );
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

function normalizeRole(value: unknown): CommunityFeedWriterRole {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function throwDenied(reason: CommunityHighlightDenialReason | null): never {
  if (reason === 'community_source_not_supported') {
    throw new HttpsError(
      'failed-precondition',
      'Este tipo de espaço não oferece destaque editorial.',
      { reason }
    );
  }
  if (reason === 'community_unavailable') {
    throw new HttpsError(
      'failed-precondition',
      'Esta Comunidade não permite alterar o destaque neste momento.',
      { reason }
    );
  }
  if (reason === 'active_management_required') {
    throw new HttpsError(
      'permission-denied',
      'A gestão ativa da Comunidade é necessária para alterar o destaque.',
      { reason }
    );
  }
  throw new HttpsError(
    'failed-precondition',
    'Esta publicação não pode ser fixada no Mural.',
    { reason: reason ?? 'post_unavailable' }
  );
}

export const manageCommunityHighlight = onCall<CommunityHighlightRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityHighlightResponse> => {
    assertHighlightRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    const command = normalizeCommunityHighlightRequest(request.data);

    if (!command.requestId || !command.communityId || !command.action) {
      throw new HttpsError(
        'invalid-argument',
        'Ação de destaque inválida.',
        { reason: 'invalid_highlight_action' }
      );
    }
    if (
      command.action === 'pin'
      && (!command.targetType || !command.targetId || !command.duration)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Publicação ou duração de destaque inválida.',
        { reason: 'invalid_highlight_target' }
      );
    }

    await consumeCommunityRateLimit({
      action: 'highlight_management',
      actorUid,
    });

    return db.runTransaction(async (transaction): Promise<CommunityHighlightResponse> => {
      const communityId = command.communityId!;
      const requestId = command.requestId!;
      const action = command.action!;
      const communityRef = db.collection('communities').doc(communityId);
      const membershipRef = communityRef.collection('members').doc(actorUid);
      const userRef = db.collection('users').doc(actorUid);
      const highlightRef = db.collection('community_highlights').doc(communityId);
      const requestRef = db.collection('community_highlight_requests').doc(requestId);
      const auditRef = db.collection('community_highlight_audit').doc(requestId);

      const [
        communitySnapshot,
        membershipSnapshot,
        userSnapshot,
        highlightSnapshot,
        requestSnapshot,
      ] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(membershipRef),
        transaction.get(userRef),
        transaction.get(highlightRef),
        transaction.get(requestRef),
      ]);

      if (requestSnapshot.exists) {
        const existing = requestSnapshot.data() ?? {};
        if (
          existing['actorUid'] !== actorUid
          || existing['kind'] !== 'community_highlight_action'
          || existing['communityId'] !== communityId
          || existing['action'] !== action
          || (action === 'pin' && existing['targetId'] !== command.targetId)
          || (action === 'pin' && existing['duration'] !== command.duration)
        ) {
          throw new HttpsError(
            'already-exists',
            'Este identificador já foi utilizado.',
            { reason: 'request_id_conflict' }
          );
        }

        const generatedAt = Number(existing['generatedAt']);
        if (!Number.isFinite(generatedAt)) {
          throw new HttpsError(
            'data-loss',
            'O registro deste destaque está inconsistente.',
            { reason: 'highlight_record_inconsistent' }
          );
        }

        return {
          communityId,
          action,
          highlight: normalizeCommunityHighlightSnapshot(existing['highlight']),
          changed: existing['changed'] === true,
          deduplicated: true,
          generatedAt: Math.trunc(generatedAt),
        };
      }

      if (!communitySnapshot.exists) {
        throw new HttpsError(
          'not-found',
          'Comunidade não encontrada.',
          { reason: 'community_not_found' }
        );
      }

      assertCommunityMembershipActorEligible(
        userSnapshot.exists ? userSnapshot.data() : null,
        actorUid
      );

      const community = communitySnapshot.data() ?? {};
      const source = (community['source'] ?? {}) as Record<string, unknown>;
      const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;
      const communityOperational = community['status'] === 'active'
        && moderation['state'] === 'active';
      const membership = membershipSnapshot.exists
        ? membershipSnapshot.data() ?? {}
        : {};
      const actorRole = normalizeRole(membership['role']);

      let targetPostStatus: unknown;
      let targetPostModerationState: unknown;
      if (action === 'pin') {
        const postRef = db
          .collection('community_feed_posts')
          .doc(communityId)
          .collection('items')
          .doc(command.targetId!);
        const projectionRef = db
          .collection('community_public_feed')
          .doc(communityId)
          .collection('items')
          .doc(command.targetId!);
        const [postSnapshot, projectionSnapshot] = await Promise.all([
          transaction.get(postRef),
          transaction.get(projectionRef),
        ]);

        if (!postSnapshot.exists || !projectionSnapshot.exists) {
          throw new HttpsError(
            'not-found',
            'Publicação não encontrada ou indisponível.',
            { reason: 'community_feed_post_not_found' }
          );
        }
        const post = postSnapshot.data() ?? {};
        targetPostStatus = post['status'];
        targetPostModerationState = post['moderationState'];
      }

      const decision = evaluateCommunityHighlightAction({
        action,
        sourceType: source['type'],
        communityOperational,
        membershipStatus: membership['status'],
        viewerRole: actorRole,
        targetPostStatus,
        targetPostModerationState,
      });
      if (!decision.allowed) throwDenied(decision.denialReason);

      const nowMs = Date.now();
      const previousHighlight = highlightSnapshot.exists
        ? highlightSnapshot.data() ?? null
        : null;
      let highlight: CommunityHighlightSnapshot | null = null;
      let changed = false;

      if (action === 'pin') {
        const expiresAt = resolveCommunityHighlightExpiresAt(
          command.duration!,
          nowMs
        );
        highlight = {
          targetType: 'feed_post',
          targetId: command.targetId!,
          duration: command.duration!,
          pinnedAt: nowMs,
          expiresAt,
        };
        changed = true;
        transaction.set(highlightRef, {
          communityId,
          ...highlight,
          pinnedBy: actorUid,
          pinnedByRole: actorRole,
          updatedAt: nowMs,
        });
      } else if (highlightSnapshot.exists) {
        changed = true;
        transaction.delete(highlightRef);
      }

      transaction.create(auditRef, {
        action: action === 'pin'
          ? 'community-highlight-pinned'
          : 'community-highlight-unpinned',
        actorUid,
        actorRole,
        communityId,
        targetType: highlight?.targetType
          ?? previousHighlight?.['targetType']
          ?? null,
        targetId: highlight?.targetId
          ?? previousHighlight?.['targetId']
          ?? null,
        duration: highlight?.duration ?? null,
        previousTargetType: previousHighlight?.['targetType'] ?? null,
        previousTargetId: previousHighlight?.['targetId'] ?? null,
        changed,
        createdAt: nowMs,
        source: 'callable',
      });

      const response: CommunityHighlightResponse = {
        communityId,
        action,
        highlight,
        changed,
        deduplicated: false,
        generatedAt: nowMs,
      };

      transaction.create(requestRef, {
        requestId,
        kind: 'community_highlight_action',
        actorUid,
        actorRole,
        communityId,
        action,
        targetType: command.targetType,
        targetId: command.targetId,
        duration: command.duration,
        highlight,
        changed,
        generatedAt: nowMs,
        createdAt: nowMs,
      });

      return response;
    });
  }
);
