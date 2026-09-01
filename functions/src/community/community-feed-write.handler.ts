// functions/src/community/community-feed-write.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED WRITES
// -----------------------------------------------------------------------------
// Mensagens idempotentes do Mural. Texto, foto e respostas pertencem à mesma
// timeline. Uma resposta é uma publicação normal com `replyToPostId`; não é
// armazenada como filha da mensagem original.
// -----------------------------------------------------------------------------

import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, getDefaultStorageBucket, Timestamp } from '../firebaseApp';
import {
  copyPrivatePhotoToPublishedAsset,
  deletePublishedPhotoAssetOrQueue,
} from '../media/application/published-photo-asset.service';
import { extractOwnedPrivatePhotoPath } from '../media/application/photo-storage-path';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  CommunityFeedPostCreateRequest,
  CommunityFeedPostWriteResponse,
  normalizeCommunityFeedPostCreateRequest,
  sanitizeCommunityFeedProjection,
} from './community-feed.model';
import {
  CommunityFeedWriterRole,
  evaluateCommunityFeedRateWindow,
  evaluateCommunityFeedWrite,
  resolveCommunityFeedAudience,
  resolveCommunityFeedWriteLimit,
} from './community-feed-write.policy';
import { isCommunityMemberActivityEnabledStatus } from './community-lifecycle.policy';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import { buildCommunityPublicAuthor } from './community-public-author.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import { getCommunityViewerContext } from './community-viewer-access.service';

const ALLOWED_COMMUNITY_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);
const MAX_COMMUNITY_IMAGE_BYTES = 10 * 1024 * 1024;

interface CommunityFeedTransactionResult extends CommunityFeedPostWriteResponse {
  imageStoragePathToKeep: string | null;
}

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'As publicações de Comunidades ainda não estão disponíveis neste ambiente.',
    { reason: 'community_feed_unavailable' }
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

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function normalizeWriterRole(value: unknown): CommunityFeedWriterRole {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function throwWriteDecision(reason: string | null): never {
  if (reason === 'active_membership_required') {
    throw new HttpsError(
      'permission-denied',
      'Participe da Comunidade para publicar no Mural.',
      { reason }
    );
  }

  throw new HttpsError(
    'failed-precondition',
    'O Mural desta Comunidade não aceita publicações agora.',
    { reason: reason ?? 'community_unavailable' }
  );
}

function existingWriteResponse(
  raw: FirebaseFirestore.DocumentData,
  actorUid: string,
  communityId: string,
  postId: string,
  replyToPostId: string | null,
  existingPost: FirebaseFirestore.DocumentData | undefined
): CommunityFeedTransactionResult | null {
  const storedReplyToPostId = String(raw['replyToPostId'] ?? '').trim() || null;
  if (
    raw['actorUid'] !== actorUid
    || raw['communityId'] !== communityId
    || raw['postId'] !== postId
    || storedReplyToPostId !== replyToPostId
  ) {
    return null;
  }

  const image = (existingPost?.['image'] ?? {}) as Record<string, unknown>;
  const storagePath = String(image['storagePath'] ?? '').trim();

  return {
    communityId,
    postId,
    created: false,
    deduplicated: true,
    imageStoragePathToKeep: storagePath || null,
  };
}

async function validatePrivateCommunityImage(storagePath: string): Promise<void> {
  const [metadata] = await getDefaultStorageBucket().file(storagePath).getMetadata();
  const contentType = String(metadata.contentType ?? '').trim().toLowerCase();
  const sizeBytes = Number(metadata.size ?? 0);

  if (!ALLOWED_COMMUNITY_IMAGE_TYPES.has(contentType)) {
    throw new HttpsError(
      'invalid-argument',
      'A foto deve ser JPG, PNG ou WEBP.',
      { reason: 'invalid_image_type' }
    );
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new HttpsError(
      'invalid-argument',
      'Não foi possível validar a foto enviada.',
      { reason: 'invalid_image' }
    );
  }

  if (sizeBytes > MAX_COMMUNITY_IMAGE_BYTES) {
    throw new HttpsError(
      'invalid-argument',
      'A foto excede o limite de 10 MB.',
      { reason: 'image_too_large' }
    );
  }
}

async function deletePrivateDraftQuietly(storagePath: string | null): Promise<void> {
  if (!storagePath) return;

  try {
    await getDefaultStorageBucket().file(storagePath).delete({ ignoreNotFound: true });
  } catch (error) {
    logger.warn('[communityFeed] Upload privado temporário aguardando limpeza.', {
      hasStoragePath: true,
      error: error instanceof Error ? error.message.slice(0, 300) : String(error),
    });
  }
}

export const createCommunityFeedPost = onCall<CommunityFeedPostCreateRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityFeedPostWriteResponse> => {
    assertPreviewRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    const command = normalizeCommunityFeedPostCreateRequest(request.data);
    const rawReplyToPostId = String(request.data?.replyToPostId ?? '').trim();

    if (
      !command.requestId
      || !command.communityId
      || (rawReplyToPostId && !command.replyToPostId)
      || command.replyToPostId === command.requestId
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Mensagem inválida para o Mural.',
        { reason: 'invalid_post_request' }
      );
    }

    if (command.imageUploadPath && command.location) {
      throw new HttpsError(
        'invalid-argument',
        'Adicione apenas um tipo de anexo por publicação.',
        { reason: 'multiple_attachments_not_allowed' }
      );
    }

    if (!command.text && !command.imageUploadPath && !command.location) {
      throw new HttpsError(
        'invalid-argument',
        'Escreva uma mensagem ou adicione uma foto ou localização.',
        { reason: 'empty_post' }
      );
    }

    const communityId = command.communityId;
    const postId = command.requestId;
    const requestRef = db.collection('community_feed_requests').doc(postId);
    const privateImagePath = command.imageUploadPath
      ? extractOwnedPrivatePhotoPath(actorUid, command.imageUploadPath)
      : null;

    if (command.imageUploadPath && !privateImagePath) {
      throw new HttpsError(
        'invalid-argument',
        'A foto deve pertencer ao usuário autenticado.',
        { reason: 'image_not_owned' }
      );
    }

    const preexistingRequest = await requestRef.get();
    if (preexistingRequest.exists) {
      const existingPostSnapshot = await db
        .collection('community_feed_posts')
        .doc(communityId)
        .collection('items')
        .doc(postId)
        .get();
      const existing = existingWriteResponse(
        preexistingRequest.data() ?? {},
        actorUid,
        communityId,
        postId,
        command.replyToPostId,
        existingPostSnapshot.exists ? existingPostSnapshot.data() : undefined
      );

      await deletePrivateDraftQuietly(privateImagePath);

      if (!existing) {
        throw new HttpsError(
          'already-exists',
          'Este identificador de requisição já foi utilizado.',
          { reason: 'request_id_conflict' }
        );
      }

      const {
        imageStoragePathToKeep: _imageStoragePathToKeep,
        ...publicResponse
      } = existing;
      return publicResponse;
    }

    const context = await getCommunityViewerContext(actorUid, communityId);
    if (
      context.community.source.type !== 'community'
      || !context.canInteract
    ) {
      throwWriteDecision('active_membership_required');
    }

    await consumeCommunityRateLimit({
      action: 'feed_post',
      actorUid,
    });

    let promotedStoragePath: string | null = null;

    try {
      if (privateImagePath) {
        await validatePrivateCommunityImage(privateImagePath);
        promotedStoragePath = await copyPrivatePhotoToPublishedAsset({
          ownerUid: actorUid,
          photoId: postId,
          sourceStoragePath: privateImagePath,
        });
      }

      const nowMs = Date.now();
      const transactionResult = await db.runTransaction(
        async (transaction): Promise<CommunityFeedTransactionResult> => {
          const communityRef = db.collection('communities').doc(communityId);
          const membershipRef = communityRef.collection('members').doc(actorUid);
          const userRef = db.collection('users').doc(actorUid);
          const publicProfileRef = db.collection('public_profiles').doc(actorUid);
          const configRef = db.collection('platform_config').doc('community');
          const userStateRef = db.collection('community_feed_user_state').doc(actorUid);
          const userPostRef = db
            .collection('community_feed_user_posts')
            .doc(actorUid)
            .collection('items')
            .doc(`${communityId}:${postId}`);
          const postsCollection = db
            .collection('community_feed_posts')
            .doc(communityId)
            .collection('items');
          const publicFeedCollection = db
            .collection('community_public_feed')
            .doc(communityId)
            .collection('items');
          const postRef = postsCollection.doc(postId);
          const projectionRef = publicFeedCollection.doc(postId);
          const replyTargetRef = command.replyToPostId
            ? postsCollection.doc(command.replyToPostId)
            : null;
          const replyTargetProjectionRef = command.replyToPostId
            ? publicFeedCollection.doc(command.replyToPostId)
            : null;
          const discoveryRef = db
            .collection('community_discovery_index')
            .doc(communityId);
          const auditRef = db
            .collection('community_feed_audit')
            .doc(`post-${postId}`);
          const replyTargetPromise = replyTargetRef
            ? transaction.get(replyTargetRef)
            : Promise.resolve(null);
          const replyTargetProjectionPromise = replyTargetProjectionRef
            ? transaction.get(replyTargetProjectionRef)
            : Promise.resolve(null);
          const [
            communitySnapshot,
            membershipSnapshot,
            userSnapshot,
            publicProfileSnapshot,
            configSnapshot,
            requestSnapshot,
            userStateSnapshot,
            postSnapshot,
            projectionSnapshot,
            discoverySnapshot,
            replyTargetSnapshot,
            replyTargetProjectionSnapshot,
          ] = await Promise.all([
            transaction.get(communityRef),
            transaction.get(membershipRef),
            transaction.get(userRef),
            transaction.get(publicProfileRef),
            transaction.get(configRef),
            transaction.get(requestRef),
            transaction.get(userStateRef),
            transaction.get(postRef),
            transaction.get(projectionRef),
            transaction.get(discoveryRef),
            replyTargetPromise,
            replyTargetProjectionPromise,
          ]);

          if (!communitySnapshot.exists) {
            throw new HttpsError(
              'not-found',
              'Comunidade não encontrada.',
              { reason: 'community_not_found' }
            );
          }

          if (requestSnapshot.exists) {
            const existing = existingWriteResponse(
              requestSnapshot.data() ?? {},
              actorUid,
              communityId,
              postId,
              command.replyToPostId,
              postSnapshot.exists ? postSnapshot.data() : undefined
            );
            if (!existing) {
              throw new HttpsError(
                'already-exists',
                'Este identificador de requisição já foi utilizado.',
                { reason: 'request_id_conflict' }
              );
            }
            return existing;
          }

          assertCommunityMembershipActorEligible(
            userSnapshot.exists ? userSnapshot.data() : null,
            actorUid
          );

          const community = communitySnapshot.data() ?? {};
          const source = (community['source'] ?? {}) as Record<string, unknown>;
          const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;
          const membership = membershipSnapshot.exists
            ? membershipSnapshot.data() ?? {}
            : {};
          const decision = evaluateCommunityFeedWrite({
            sourceType: source['type'],
            memberActivityAllowed:
              isCommunityMemberActivityEnabledStatus(community['status'])
              && moderation['state'] === 'active',
            membershipStatus: membership['status'],
            viewerRole: normalizeWriterRole(membership['role']),
          });

          if (!decision.allowed) throwWriteDecision(decision.denialReason);

          if (postSnapshot.exists || projectionSnapshot.exists) {
            throw new HttpsError(
              'already-exists',
              'Esta publicação já existe.',
              { reason: 'post_already_exists' }
            );
          }

          if (command.replyToPostId) {
            const replyTargetProjection = replyTargetProjectionSnapshot?.exists
              ? sanitizeCommunityFeedProjection(
                command.replyToPostId,
                replyTargetProjectionSnapshot.data(),
                nowMs
              )
              : null;
            const replyTargetRaw = replyTargetSnapshot?.exists
              ? replyTargetSnapshot.data() ?? {}
              : {};
            if (
              !replyTargetSnapshot?.exists
              || !replyTargetProjection
              || replyTargetRaw['status'] !== 'active'
              || replyTargetRaw['moderationState'] !== 'active'
            ) {
              throw new HttpsError(
                'failed-precondition',
                'A mensagem original não está disponível para resposta.',
                { reason: 'referenced_post_unavailable' }
              );
            }
          }

          const limit = resolveCommunityFeedWriteLimit(
            configSnapshot.exists ? configSnapshot.data() : null
          );
          const rateDecision = evaluateCommunityFeedRateWindow(
            userStateSnapshot.exists ? userStateSnapshot.data() : null,
            nowMs,
            limit
          );

          if (!rateDecision.allowed) {
            throw new HttpsError(
              'resource-exhausted',
              'Você atingiu o limite temporário de publicações. Tente novamente mais tarde.',
              {
                reason: 'community_feed_rate_limited',
                recommendedAction: 'retry_later',
              }
            );
          }

          const metrics = (community['metrics'] ?? {}) as Record<string, unknown>;
          const nextPostCount = normalizeCount(metrics['postCount']) + 1;
          const nextMediaCount = normalizeCount(metrics['mediaCount'])
            + (promotedStoragePath ? 1 : 0);
          const effectiveAudience = resolveCommunityFeedAudience(
            community['visibility']
          );
          // A identidade persistida no Mural vem da projeção pública canônica;
          // nome civil/KYC nunca é fallback de superfície social.
          const author = buildCommunityPublicAuthor(
            publicProfileSnapshot.exists ? publicProfileSnapshot.data() : null,
            { label: 'Participante', avatarUrl: null }
          );
          const now = Timestamp.fromMillis(nowMs);
          const kind = promotedStoragePath
            ? 'photo'
            : command.location
              ? 'location'
              : 'text';
          const image = promotedStoragePath
            ? {
              storagePath: promotedStoragePath,
              alt: `Foto compartilhada por ${author.label}`.slice(0, 140),
            }
            : null;
          const projection = {
            kind,
            audience: effectiveAudience,
            status: 'active',
            moderationState: 'active',
            author,
            text: command.text || null,
            image,
            location: command.location,
            replyToPostId: command.replyToPostId,
            metrics: {
              commentCount: 0,
              reactionCount: 0,
            },
            publishedAt: now,
            updatedAt: now,
          };

          transaction.create(postRef, {
            ...projection,
            actorUid,
            postId,
            communityId,
            createdAt: now,
            source: command.replyToPostId ? 'reply' : 'callable',
          });
          transaction.create(projectionRef, projection);
          transaction.create(userPostRef, {
            actorUid,
            communityId,
            postId,
            replyToPostId: command.replyToPostId,
            createdAt: nowMs,
          });
          transaction.set(
            userStateRef,
            {
              windowStartedAt: rateDecision.windowStartedAt,
              writesInWindow: rateDecision.nextCount,
              updatedAt: nowMs,
            },
            { merge: true }
          );
          transaction.create(requestRef, {
            requestId: command.requestId,
            actorUid,
            communityId,
            postId,
            kind,
            location: command.location,
            replyToPostId: command.replyToPostId,
            createdAt: nowMs,
          });
          transaction.create(auditRef, {
            action: command.replyToPostId
              ? 'community-feed-reply-created'
              : 'community-feed-post-created',
            actorUid,
            communityId,
            postId,
            replyToPostId: command.replyToPostId,
            kind,
            hasText: command.text.length > 0,
            hasLocation: command.location !== null,
            audience: effectiveAudience,
            createdAt: nowMs,
          });
          transaction.update(communityRef, {
            'metrics.postCount': nextPostCount,
            ...(promotedStoragePath ? { 'metrics.mediaCount': nextMediaCount } : {}),
            'lifecycle.lastMeaningfulActivityAt': nowMs,
            updatedAt: nowMs,
          });

          if (discoverySnapshot.exists) {
            transaction.update(discoveryRef, {
              'metrics.postCount': nextPostCount,
              ...(promotedStoragePath ? { 'metrics.mediaCount': nextMediaCount } : {}),
              updatedAt: nowMs,
            });
          }

          return {
            communityId,
            postId,
            created: true,
            deduplicated: false,
            imageStoragePathToKeep: promotedStoragePath,
          };
        }
      );

      if (
        promotedStoragePath
        && transactionResult.imageStoragePathToKeep !== promotedStoragePath
      ) {
        await deletePublishedPhotoAssetOrQueue({
          ownerUid: actorUid,
          photoId: postId,
          storagePath: promotedStoragePath,
          reason: 'community-feed-deduplicated-copy',
        });
      }

      await deletePrivateDraftQuietly(privateImagePath);

      const {
        imageStoragePathToKeep: _imageStoragePathToKeep,
        ...publicResponse
      } = transactionResult;
      return publicResponse;
    } catch (error) {
      if (promotedStoragePath) {
        await deletePublishedPhotoAssetOrQueue({
          ownerUid: actorUid,
          photoId: postId,
          storagePath: promotedStoragePath,
          reason: 'community-feed-write-rollback',
        });
      }
      await deletePrivateDraftQuietly(privateImagePath);
      throw error;
    }
  }
);
