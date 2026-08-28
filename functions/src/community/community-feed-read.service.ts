// functions/src/community/community-feed-read.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED READ HYDRATION
// -----------------------------------------------------------------------------
// Centraliza a hidratação segura de itens do Mural. A projeção operacional
// continua privada; a UI recebe apenas conteúdo sanitizado, URL temporária,
// identidade pública coarse, contexto de resposta e capacidades calculadas.
// -----------------------------------------------------------------------------

import * as logger from 'firebase-functions/logger';

import { db } from '../firebaseApp';
import { createTemporaryStorageReadUrl } from '../media/application/temporary-storage-read-url.service';
import {
  buildCommunityPublicAuthor,
} from './community-public-author.model';
import {
  sanitizeCommunityFeedProjection,
  type CommunityFeedItem,
  type CommunityFeedReplyReference,
  type SanitizedCommunityFeedProjection,
} from './community-feed.model';
import type { CommunityViewerContext } from './community-viewer-access.service';

const MEDIA_URL_TTL_MS = 20 * 60_000;

type FeedViewerContext = Pick<
  CommunityViewerContext,
  'activeMembership' | 'viewerRole' | 'canInteract'
>;

function isManagementRole(value: unknown): boolean {
  return value === 'owner' || value === 'admin' || value === 'moderator';
}

async function hydratePhotoItem(
  projection: SanitizedCommunityFeedProjection,
  now: number
): Promise<CommunityFeedItem | null> {
  if (projection.item.kind !== 'photo') return projection.item;
  if (projection.item.image?.url) return projection.item;
  if (!projection.imageStoragePath) return null;

  try {
    const url = await createTemporaryStorageReadUrl(
      projection.imageStoragePath,
      now + MEDIA_URL_TTL_MS
    );

    return {
      ...projection.item,
      image: {
        url,
        alt: projection.imageAlt || 'Foto publicada na comunidade',
      },
    };
  } catch (error) {
    logger.warn('[communityFeed] Foto indisponível na leitura do Mural.', {
      postId: projection.item.postId,
      error: error instanceof Error ? error.message.slice(0, 300) : String(error),
    });
    return null;
  }
}

function unavailableReply(postId: string): CommunityFeedReplyReference {
  return {
    postId,
    authorLabel: 'Publicação',
    textPreview: 'Conteúdo original indisponível',
    available: false,
  };
}

export async function hydrateCommunityFeedItemsForViewer(params: {
  communityId: string;
  uid: string;
  projections: readonly SanitizedCommunityFeedProjection[];
  context: FeedViewerContext;
  now: number;
}): Promise<CommunityFeedItem[]> {
  const { communityId, uid, projections, context, now } = params;
  if (projections.length === 0) return [];

  const postsCollection = db
    .collection('community_feed_posts')
    .doc(communityId)
    .collection('items');
  const publicFeedCollection = db
    .collection('community_public_feed')
    .doc(communityId)
    .collection('items');

  const operationalSnapshots = await db.getAll(...projections.map((projection) =>
    postsCollection.doc(projection.item.postId)
  ));
  const reactionSnapshots = await db.getAll(...projections.map((projection) =>
    postsCollection
      .doc(projection.item.postId)
      .collection('reactions')
      .doc(uid)
  ));
  const hydratedItems = await Promise.all(
    projections.map((projection) => hydratePhotoItem(projection, now))
  );

  const replyTargetIds = Array.from(new Set(
    projections
      .map((projection) => projection.replyToPostId)
      .filter((postId): postId is string => !!postId)
  ));
  const replyProjectionSnapshots = replyTargetIds.length > 0
    ? await db.getAll(...replyTargetIds.map((postId) => publicFeedCollection.doc(postId)))
    : [];
  const replyOperationalSnapshots = replyTargetIds.length > 0
    ? await db.getAll(...replyTargetIds.map((postId) => postsCollection.doc(postId)))
    : [];

  const authorUids = operationalSnapshots.map((snapshot) =>
    snapshot?.exists ? String(snapshot.data()?.['actorUid'] ?? '').trim() : ''
  );
  const replyAuthorUids = replyOperationalSnapshots.map((snapshot) =>
    snapshot?.exists ? String(snapshot.data()?.['actorUid'] ?? '').trim() : ''
  );
  const uniqueAuthorUids = Array.from(new Set(
    [...authorUids, ...replyAuthorUids].filter(Boolean)
  ));
  const publicProfileSnapshots = uniqueAuthorUids.length > 0
    ? await db.getAll(...uniqueAuthorUids.map((authorUid) =>
      db.collection('public_profiles').doc(authorUid)
    ))
    : [];
  const publicProfilesByUid = new Map(
    publicProfileSnapshots.map((snapshot) => [
      snapshot.id,
      snapshot.exists ? snapshot.data() ?? null : null,
    ] as const)
  );

  const replyReferencesById = new Map<string, CommunityFeedReplyReference>();
  replyTargetIds.forEach((replyTargetId, index) => {
    const publicSnapshot = replyProjectionSnapshots[index];
    const operationalSnapshot = replyOperationalSnapshots[index];
    const targetProjection = publicSnapshot?.exists
      ? sanitizeCommunityFeedProjection(
        replyTargetId,
        publicSnapshot.data(),
        now
      )
      : null;
    const targetOperational = operationalSnapshot?.exists
      ? operationalSnapshot.data() ?? {}
      : {};
    const targetActorUid = String(targetOperational['actorUid'] ?? '').trim();
    const activeTarget = targetProjection
      && targetOperational['status'] === 'active'
      && targetOperational['moderationState'] === 'active'
      && targetActorUid.length > 0;

    if (!activeTarget || !targetProjection) {
      replyReferencesById.set(replyTargetId, unavailableReply(replyTargetId));
      return;
    }

    const targetAuthor = buildCommunityPublicAuthor(
      publicProfilesByUid.get(targetActorUid),
      targetProjection.item.author
    );
    const textPreview = targetProjection.item.text
      || (targetProjection.item.kind === 'photo'
        ? 'Foto publicada no Mural'
        : targetProjection.item.kind === 'location'
          ? 'Localização compartilhada no Mural'
          : 'Publicação no Mural');

    replyReferencesById.set(replyTargetId, {
      postId: replyTargetId,
      authorLabel: targetAuthor.label,
      textPreview: textPreview.slice(0, 180),
      available: true,
    });
  });

  return hydratedItems
    .map((item, index): CommunityFeedItem | null => {
      if (!item) return null;

      const operational = operationalSnapshots[index];
      const raw = operational?.exists ? operational.data() ?? {} : {};
      const authorUid = authorUids[index] ?? '';
      const activePost =
        (item.kind === 'text' || item.kind === 'photo' || item.kind === 'location')
        && raw['status'] === 'active'
        && raw['moderationState'] === 'active'
        && authorUid.length > 0;
      const ownPost = activePost && authorUid === uid;
      const canModerate = activePost
        && !ownPost
        && context.activeMembership
        && isManagementRole(context.viewerRole);
      const canReact = activePost && context.canInteract;
      const author = buildCommunityPublicAuthor(
        publicProfilesByUid.get(authorUid),
        item.author
      );
      const replyToPostId = projections[index]?.replyToPostId ?? null;

      return {
        ...item,
        author,
        replyTo: replyToPostId
          ? replyReferencesById.get(replyToPostId) ?? unavailableReply(replyToPostId)
          : null,
        capabilities: {
          canDeleteOwn: ownPost,
          canModerate,
          canReport: activePost && !ownPost,
          canReact,
          viewerReacted: canReact && reactionSnapshots[index]?.exists === true,
          canViewComments: activePost,
          canComment: activePost && context.canInteract,
        },
      };
    })
    .filter((item): item is CommunityFeedItem => item !== null);
}
