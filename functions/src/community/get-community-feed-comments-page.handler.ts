// -----------------------------------------------------------------------------
// GET COMMUNITY FEED CONVERSATION PAGE
// -----------------------------------------------------------------------------
// Mantém o nome da callable por compatibilidade. Novas respostas vivem na mesma
// coleção de mensagens e recebem uma citação sanitizada produzida no backend.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';
import {
  canViewerReadCommunityFeedAudience,
  resolveCommunityFeedContentAccess,
} from './community-feed-access.policy';
import {
  CommunityFeedCommentItem,
  CommunityFeedCommentPageRequest,
  CommunityFeedCommentPageResponse,
  SanitizedCommunityFeedComment,
  normalizeCommunityFeedCommentPageRequest,
  sanitizeCommunityFeedComment,
} from './community-feed-comment.model';
import { isCommunityFeedInteractivePostKind } from './community-feed-comment.policy';
import { sanitizeCommunityFeedProjection } from './community-feed.model';
import { buildCommunityPublicAuthor } from './community-public-author.model';
import { getCommunityViewerContext } from './community-viewer-access.service';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

interface ConversationReplyReference {
  commentId: string;
  authorLabel: string;
  textPreview: string;
  available: boolean;
}

type ConversationItem = CommunityFeedCommentItem & {
  replyTo: ConversationReplyReference | null;
};

interface SanitizedConversationMessage extends SanitizedCommunityFeedComment {
  replyToCommentId: string | null;
}

function assertRuntime(): void {
  if (isFunctionsEmulatorRuntime()) return;
  throw new HttpsError(
    'failed-precondition',
    'A conversa do Mural ainda não está disponível neste ambiente.'
  );
}

function isManagementRole(value: unknown): boolean {
  return value === 'owner' || value === 'admin' || value === 'moderator';
}

function normalizeOptionalSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function textPreview(value: string): string {
  return Array.from(value).slice(0, 180).join('');
}

export const getCommunityFeedCommentsPage = onCall<
  CommunityFeedCommentPageRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<CommunityFeedCommentPageResponse> => {
    assertRuntime();
    const uid = String(request.auth?.uid ?? '').trim();
    if (!uid) throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    if (request.auth?.token.email_verified !== true) {
      throw new HttpsError('failed-precondition', 'Verifique seu e-mail para continuar.');
    }
    const page = normalizeCommunityFeedCommentPageRequest(request.data);
    if (!page.communityId || !page.postId) {
      throw new HttpsError('invalid-argument', 'Publicação inválida.');
    }
    if (String(request.data?.cursor ?? '').trim() && !page.cursor) {
      throw new HttpsError('invalid-argument', 'Cursor de conversa inválido.');
    }

    const context = await getCommunityViewerContext(uid, page.communityId);
    const feedContentAccess = resolveCommunityFeedContentAccess(
      context.memberContentAccess,
      context.authenticatedPreviewAccess
    );
    const postRef = db
      .collection('community_feed_posts')
      .doc(page.communityId)
      .collection('items')
      .doc(page.postId);
    const projectionRef = db
      .collection('community_public_feed')
      .doc(page.communityId)
      .collection('items')
      .doc(page.postId);
    const [postSnapshot, projectionSnapshot] = await Promise.all([
      postRef.get(),
      projectionRef.get(),
    ]);
    const post = postSnapshot.exists ? postSnapshot.data() ?? {} : {};
    const postKind = post['kind'];
    const projection = projectionSnapshot.exists
      ? sanitizeCommunityFeedProjection(
        page.postId,
        projectionSnapshot.data()
      )
      : null;
    if (
      !postSnapshot.exists
      || !isCommunityFeedInteractivePostKind(postKind)
      || post['status'] !== 'active'
      || post['moderationState'] !== 'active'
      || !projection
      || projection.item.kind !== postKind
      || !canViewerReadCommunityFeedAudience(
        projection,
        feedContentAccess
      )
    ) {
      throw new HttpsError('not-found', 'Publicação não encontrada.');
    }

    const comments = postRef.collection('comments');
    const scanLimit = page.limit * 3 + 1;
    let query = comments.orderBy('createdAt', 'desc').limit(scanLimit);
    if (page.cursor) {
      const cursorSnapshot = await comments.doc(page.cursor).get();
      if (!cursorSnapshot.exists) {
        throw new HttpsError('invalid-argument', 'Cursor de conversa não encontrado.');
      }
      query = query.startAfter(cursorSnapshot);
    }

    const snapshot = await query.get();
    const sanitizedMessages: SanitizedConversationMessage[] = [];
    let lastConsumedIndex = -1;
    const management = context.activeMembership
      && context.memberActivityAllowed
      && isManagementRole(context.viewerRole);
    const now = Date.now();

    for (let index = 0; index < snapshot.docs.length; index += 1) {
      const document = snapshot.docs[index];
      lastConsumedIndex = index;
      const sanitized = sanitizeCommunityFeedComment(
        document.id,
        document.data(),
        now
      );
      if (!sanitized) continue;
      sanitizedMessages.push({
        ...sanitized,
        replyToCommentId: normalizeOptionalSafeId(
          document.data()['replyToCommentId']
        ),
      });
      if (sanitizedMessages.length >= page.limit) break;
    }

    const replyTargetIds = Array.from(new Set(
      sanitizedMessages
        .map((message) => message.replyToCommentId)
        .filter((commentId): commentId is string => !!commentId)
    ));
    const replyTargetSnapshots = replyTargetIds.length > 0
      ? await db.getAll(...replyTargetIds.map((commentId) => comments.doc(commentId)))
      : [];
    const replyTargetsById = new Map(
      replyTargetSnapshots.map((targetSnapshot) => {
        const sanitized = targetSnapshot.exists
          ? sanitizeCommunityFeedComment(
            targetSnapshot.id,
            targetSnapshot.data(),
            now
          )
          : null;
        return [targetSnapshot.id, sanitized] as const;
      })
    );

    const uniqueAuthorUids = Array.from(new Set([
      ...sanitizedMessages.map((message) => message.actorUid),
      ...Array.from(replyTargetsById.values())
        .filter((target): target is SanitizedCommunityFeedComment => !!target)
        .map((target) => target.actorUid),
    ].filter(Boolean)));
    const publicProfileSnapshots = uniqueAuthorUids.length > 0
      ? await db.getAll(...uniqueAuthorUids.map((authorUid) =>
        db.collection('public_profiles').doc(authorUid)
      ))
      : [];
    const publicProfilesByUid = new Map(
      publicProfileSnapshots.map((profileSnapshot) => [
        profileSnapshot.id,
        profileSnapshot.exists ? profileSnapshot.data() ?? null : null,
      ] as const)
    );

    const items: ConversationItem[] = sanitizedMessages.map((sanitized) => {
      const ownComment = sanitized.actorUid === uid;
      const target = sanitized.replyToCommentId
        ? replyTargetsById.get(sanitized.replyToCommentId) ?? null
        : null;
      const targetAuthor = target
        ? buildCommunityPublicAuthor(
          publicProfilesByUid.get(target.actorUid),
          target.item.author
        )
        : null;

      return {
        ...sanitized.item,
        author: buildCommunityPublicAuthor(
          publicProfilesByUid.get(sanitized.actorUid),
          sanitized.item.author
        ),
        replyTo: sanitized.replyToCommentId
          ? target
            ? {
              commentId: sanitized.replyToCommentId,
              authorLabel: targetAuthor?.label ?? 'Participante',
              textPreview: textPreview(target.item.text),
              available: true,
            }
            : {
              commentId: sanitized.replyToCommentId,
              authorLabel: 'Mensagem indisponível',
              textPreview: '',
              available: false,
            }
          : null,
        capabilities: {
          canDeleteOwn: ownComment,
          canModerate: management && !ownComment,
          canReport: !ownComment,
        },
      };
    });

    const lastConsumedDocument = lastConsumedIndex >= 0
      ? snapshot.docs[lastConsumedIndex]
      : null;
    const hasBufferedDocuments = lastConsumedIndex >= 0
      && lastConsumedIndex < snapshot.docs.length - 1;
    return {
      items,
      nextCursor:
        snapshot.docs.length === scanLimit || hasBufferedDocuments
          ? lastConsumedDocument?.id ?? null
          : null,
      generatedAt: now,
    };
  }
);
