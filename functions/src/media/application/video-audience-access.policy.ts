import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  assertInteractionAccessData,
} from '../../account_lifecycle/interaction-access.policy';
import { auth, db } from '../../firebaseApp';

export type VideoAudienceAction = 'LIST' | 'PLAY' | 'INTERACT' | 'SHARE';

export type VideoAudienceVisibility =
  | 'PRIVATE'
  | 'PUBLIC'
  | 'COMPATIBLE'
  | 'FRIENDS'
  | 'SUBSCRIBERS'
  | 'PREMIUM';

export type VideoAudienceAccessReason =
  | 'viewer_restricted'
  | 'invalid_target'
  | 'not_published'
  | 'moderation_required'
  | 'private_content'
  | 'blocked'
  | 'compatibility_required'
  | 'friendship_required'
  | 'subscriber_entitlement_required'
  | 'premium_entitlement_required'
  | 'unsupported_visibility';

export interface VideoAudienceAccessDecision {
  allowed: boolean;
  reason: VideoAudienceAccessReason | null;
}

export interface VideoAudienceAccessInput {
  viewerUid: string;
  ownerUid: string;
  action: VideoAudienceAction;
  visibility: unknown;
  isPublished: boolean;
  moderationStatus: unknown;
  viewerLifecycleAllowed: boolean;
  viewerBlockedOwner: boolean;
  ownerBlockedViewer: boolean;
  bilateralFriendship: boolean;
  mutuallyCompatible: boolean;
  hasCreatorSubscriberEntitlement: boolean;
  hasCreatorPremiumEntitlement: boolean;
}

export interface VideoAudienceAccessTarget {
  ownerUid: string;
  action: VideoAudienceAction;
  visibility: unknown;
  isPublished: boolean;
  moderationStatus: unknown;
}

export interface PublicVideoAudienceDocument {
  id?: unknown;
  ownerUid?: unknown;
  mediaType?: unknown;
  assetAccess?: unknown;
  visibility?: unknown;
  moderationStatus?: unknown;
}

export interface VideoPublicationAudienceDocument {
  ownerUid?: unknown;
  videoId?: unknown;
  isPublished?: unknown;
  visibility?: unknown;
  moderationStatus?: unknown;
}

export interface VideoAudienceAccessEvaluator {
  evaluate(
    target: VideoAudienceAccessTarget
  ): Promise<VideoAudienceAccessDecision>;
  assert(target: VideoAudienceAccessTarget): Promise<void>;
  assertInTransaction(
    transaction: Transaction,
    target: VideoAudienceAccessTarget
  ): Promise<void>;
}

interface BlockContext {
  viewerBlockedOwner: boolean;
  ownerBlockedViewer: boolean;
}

interface FriendshipContext {
  bilateralFriendship: boolean;
}

interface RelationshipDocument {
  isBlocked?: unknown;
  friendUid?: unknown;
}

interface ViewerAccountDocument {
  uid?: unknown;
  accountStatus?: unknown;
  suspended?: unknown;
  interactionBlocked?: unknown;
  ageReverification?: {
    status?: unknown;
  } | null;
  accountLocked?: unknown;
  loginAllowed?: unknown;
}

const SUPPORTED_VISIBILITIES = new Set<VideoAudienceVisibility>([
  'PRIVATE',
  'PUBLIC',
  'COMPATIBLE',
  'FRIENDS',
  'SUBSCRIBERS',
  'PREMIUM',
]);

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  if (
    !normalized ||
    normalized.length > 128 ||
    normalized.includes('/')
  ) {
    return '';
  }

  return normalized;
}

function normalizeEnum(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeVisibility(value: unknown): VideoAudienceVisibility | null {
  const normalized = normalizeEnum(value);

  return SUPPORTED_VISIBILITIES.has(normalized as VideoAudienceVisibility)
    ? normalized as VideoAudienceVisibility
    : null;
}

function isApproved(value: unknown): boolean {
  return normalizeEnum(value) === 'APPROVED';
}

function denied(reason: VideoAudienceAccessReason): VideoAudienceAccessDecision {
  return { allowed: false, reason };
}

function actionLabel(action: VideoAudienceAction): string {
  switch (action) {
  case 'LIST':
    return 'listar';
  case 'PLAY':
    return 'reproduzir';
  case 'INTERACT':
    return 'interagir com';
  case 'SHARE':
    return 'compartilhar';
  default:
    return 'acessar';
  }
}

export function assertVideoAudienceAccessDecision(
  decision: VideoAudienceAccessDecision,
  action: VideoAudienceAction
): void {
  if (decision.allowed) {
    return;
  }

  const reason = decision.reason ?? 'unsupported_visibility';
  const details = { action, reason };

  if (reason === 'invalid_target') {
    throw new HttpsError(
      'invalid-argument',
      'A referência do vídeo é inválida.',
      details
    );
  }

  if (reason === 'viewer_restricted') {
    throw new HttpsError(
      'failed-precondition',
      `Sua conta não pode ${actionLabel(action)} este vídeo no momento.`,
      details
    );
  }

  if (
    reason === 'blocked' ||
    reason === 'compatibility_required' ||
    reason === 'friendship_required' ||
    reason === 'subscriber_entitlement_required' ||
    reason === 'premium_entitlement_required'
  ) {
    throw new HttpsError(
      'permission-denied',
      `Você não possui audiência válida para ${actionLabel(action)} este vídeo.`,
      details
    );
  }

  throw new HttpsError(
    'failed-precondition',
    `Este vídeo não está disponível para ${actionLabel(action)}.`,
    details
  );
}

export function resolveCanonicalVideoAudienceTarget(params: {
  ownerUid: unknown;
  videoId: unknown;
  action: VideoAudienceAction;
  publicVideo: PublicVideoAudienceDocument | null | undefined;
  publication: VideoPublicationAudienceDocument | null | undefined;
}): VideoAudienceAccessTarget | null {
  const ownerUid = cleanId(params.ownerUid);
  const videoId = cleanId(params.videoId);
  const publicVideo = params.publicVideo;
  const publication = params.publication;

  if (!ownerUid || !videoId || !publicVideo || !publication) {
    return null;
  }

  const projectionId = cleanId(publicVideo.id);
  const projectionOwnerUid = cleanId(publicVideo.ownerUid);
  const publicationOwnerUid = cleanId(publication.ownerUid);
  const publicationVideoId = cleanId(publication.videoId);
  const projectionVisibility = normalizeVisibility(publicVideo.visibility);
  const publicationVisibility = normalizeVisibility(publication.visibility);
  const projectionModeration = normalizeEnum(publicVideo.moderationStatus);
  const publicationModeration = normalizeEnum(publication.moderationStatus);

  if (
    projectionId !== videoId ||
    projectionOwnerUid !== ownerUid ||
    publicationOwnerUid !== ownerUid ||
    publicationVideoId !== videoId ||
    normalizeEnum(publicVideo.mediaType) !== 'VIDEO' ||
    normalizeEnum(publicVideo.assetAccess) !== 'SIGNED_URL' ||
    !projectionVisibility ||
    projectionVisibility !== publicationVisibility ||
    !projectionModeration ||
    projectionModeration !== publicationModeration
  ) {
    return null;
  }

  return {
    ownerUid,
    action: params.action,
    visibility: publicationVisibility,
    isPublished: publication.isPublished === true,
    moderationStatus: publicationModeration,
  };
}

export function evaluateVideoAudienceAccess(
  input: VideoAudienceAccessInput
): VideoAudienceAccessDecision {
  const viewerUid = cleanId(input.viewerUid);
  const ownerUid = cleanId(input.ownerUid);

  if (!viewerUid || !ownerUid) {
    return denied('invalid_target');
  }

  if (!input.viewerLifecycleAllowed) {
    return denied('viewer_restricted');
  }

  if (!input.isPublished) {
    return denied('not_published');
  }

  if (!isApproved(input.moderationStatus)) {
    return denied('moderation_required');
  }

  const visibility = normalizeVisibility(input.visibility);

  if (!visibility) {
    return denied('unsupported_visibility');
  }

  if (visibility === 'PRIVATE') {
    return denied('private_content');
  }

  if (viewerUid === ownerUid) {
    return { allowed: true, reason: null };
  }

  if (input.viewerBlockedOwner || input.ownerBlockedViewer) {
    return denied('blocked');
  }

  switch (visibility) {
  case 'PUBLIC':
    return { allowed: true, reason: null };

  case 'COMPATIBLE':
    return input.mutuallyCompatible
      ? { allowed: true, reason: null }
      : denied('compatibility_required');

  case 'FRIENDS':
    return input.bilateralFriendship
      ? { allowed: true, reason: null }
      : denied('friendship_required');

  case 'SUBSCRIBERS':
    return input.hasCreatorSubscriberEntitlement
      ? { allowed: true, reason: null }
      : denied('subscriber_entitlement_required');

  case 'PREMIUM':
    return input.hasCreatorPremiumEntitlement
      ? { allowed: true, reason: null }
      : denied('premium_entitlement_required');

  default:
    return denied('unsupported_visibility');
  }
}

function isActiveBlock(snapshot: {
  exists: boolean;
  data(): RelationshipDocument | undefined;
}): boolean {
  return snapshot.exists && snapshot.data()?.isBlocked === true;
}

function isValidFriendEdge(
  snapshot: {
    id: string;
    exists: boolean;
    data(): RelationshipDocument | undefined;
  },
  expectedFriendUid: string
): boolean {
  if (!snapshot.exists) {
    return false;
  }

  const friendUid = cleanId(
    snapshot.data()?.friendUid ?? snapshot.id
  );

  return friendUid === expectedFriendUid;
}

async function readBlockContext(
  viewerUid: string,
  ownerUid: string
): Promise<BlockContext> {
  const [viewerBlock, ownerBlock] = await Promise.all([
    db.doc(`users/${viewerUid}/blocks/${ownerUid}`).get(),
    db.doc(`users/${ownerUid}/blocks/${viewerUid}`).get(),
  ]);

  return {
    viewerBlockedOwner: isActiveBlock(viewerBlock),
    ownerBlockedViewer: isActiveBlock(ownerBlock),
  };
}

async function readBlockContextInTransaction(
  transaction: Transaction,
  viewerUid: string,
  ownerUid: string
): Promise<BlockContext> {
  const [viewerBlock, ownerBlock] = await Promise.all([
    transaction.get(db.doc(`users/${viewerUid}/blocks/${ownerUid}`)),
    transaction.get(db.doc(`users/${ownerUid}/blocks/${viewerUid}`)),
  ]);

  return {
    viewerBlockedOwner: isActiveBlock(viewerBlock),
    ownerBlockedViewer: isActiveBlock(ownerBlock),
  };
}

async function readFriendshipContext(
  viewerUid: string,
  ownerUid: string
): Promise<FriendshipContext> {
  const [viewerFriend, ownerFriend] = await Promise.all([
    db.doc(`users/${viewerUid}/friends/${ownerUid}`).get(),
    db.doc(`users/${ownerUid}/friends/${viewerUid}`).get(),
  ]);

  return {
    bilateralFriendship:
      isValidFriendEdge(viewerFriend, ownerUid) &&
      isValidFriendEdge(ownerFriend, viewerUid),
  };
}

async function readFriendshipContextInTransaction(
  transaction: Transaction,
  viewerUid: string,
  ownerUid: string
): Promise<FriendshipContext> {
  const [viewerFriend, ownerFriend] = await Promise.all([
    transaction.get(db.doc(`users/${viewerUid}/friends/${ownerUid}`)),
    transaction.get(db.doc(`users/${ownerUid}/friends/${viewerUid}`)),
  ]);

  return {
    bilateralFriendship:
      isValidFriendEdge(viewerFriend, ownerUid) &&
      isValidFriendEdge(ownerFriend, viewerUid),
  };
}

function assertViewerAccountAvailable(
  viewer: ViewerAccountDocument,
  expectedUid: string,
  authDisabled: boolean
): void {
  const documentUid = cleanId(viewer.uid ?? expectedUid);

  if (
    authDisabled ||
    documentUid !== expectedUid ||
    viewer.accountLocked === true ||
    viewer.loginAllowed === false
  ) {
    throw new HttpsError(
      'permission-denied',
      'Sua conta não está disponível para acessar vídeos.'
    );
  }

  assertInteractionAccessData(viewer);
}

function buildAccessInput(
  viewerUid: string,
  target: VideoAudienceAccessTarget,
  blocks: BlockContext,
  bilateralFriendship: boolean
): VideoAudienceAccessInput {
  return {
    viewerUid,
    ownerUid: target.ownerUid,
    action: target.action,
    visibility: target.visibility,
    isPublished: target.isPublished,
    moderationStatus: target.moderationStatus,
    viewerLifecycleAllowed: true,
    ...blocks,
    bilateralFriendship,

    /**
     * COMPATIBLE depende de projeção backend canônica. O cálculo Angular
     * nunca autoriza mídia por link direto.
     */
    mutuallyCompatible: false,

    /**
     * SUBSCRIBERS/PREMIUM dependem de entitlement bilateral do criador,
     * com vigência, cancelamento, chargeback e status KYC/AML. A assinatura
     * da plataforma não concede acesso ao conteúdo de um criador.
     */
    hasCreatorSubscriberEntitlement: false,
    hasCreatorPremiumEntitlement: false,
  };
}

function ownerAccessInput(
  viewerUid: string,
  target: VideoAudienceAccessTarget
): VideoAudienceAccessInput {
  return {
    viewerUid,
    ownerUid: target.ownerUid,
    action: target.action,
    visibility: target.visibility,
    isPublished: target.isPublished,
    moderationStatus: target.moderationStatus,
    viewerLifecycleAllowed: true,
    viewerBlockedOwner: false,
    ownerBlockedViewer: false,
    bilateralFriendship: true,
    mutuallyCompatible: true,
    hasCreatorSubscriberEntitlement: true,
    hasCreatorPremiumEntitlement: true,
  };
}

/**
 * Cria uma sessão de autorização por requisição.
 *
 * - valida Auth, lifecycle e idade uma única vez;
 * - mantém caches separados de bloqueios e amizades por proprietário;
 * - oferece assert transacional para impedir TOCTOU em interações e envios;
 * - vídeos públicos fazem apenas as duas leituras bilaterais de bloqueio;
 * - amizade só é consultada quando a audiência realmente é FRIENDS;
 * - audiências sem fonte autorizativa no backend permanecem negadas.
 */
export async function createVideoAudienceAccessEvaluator(
  rawViewerUid: unknown
): Promise<VideoAudienceAccessEvaluator> {
  const viewerUid = cleanId(rawViewerUid);

  if (!viewerUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  const [viewerSnapshot, authUser] = await Promise.all([
    db.doc(`users/${viewerUid}`).get(),
    auth.getUser(viewerUid),
  ]);
  const viewer = viewerSnapshot.exists
    ? viewerSnapshot.data() as ViewerAccountDocument
    : null;

  if (!viewer) {
    throw new HttpsError('not-found', 'Conta não encontrada.');
  }

  assertViewerAccountAvailable(viewer, viewerUid, authUser.disabled);

  const blockCache = new Map<string, Promise<BlockContext>>();
  const friendshipCache = new Map<string, Promise<FriendshipContext>>();

  const evaluate = async (
    target: VideoAudienceAccessTarget
  ): Promise<VideoAudienceAccessDecision> => {
    const ownerUid = cleanId(target.ownerUid);

    if (!ownerUid) {
      return denied('invalid_target');
    }

    if (viewerUid === ownerUid) {
      return evaluateVideoAudienceAccess(ownerAccessInput(viewerUid, target));
    }

    let blockPromise = blockCache.get(ownerUid);

    if (!blockPromise) {
      blockPromise = readBlockContext(viewerUid, ownerUid);
      blockCache.set(ownerUid, blockPromise);
    }

    const blocks = await blockPromise;
    const visibility = normalizeVisibility(target.visibility);
    let bilateralFriendship = false;

    if (
      !blocks.viewerBlockedOwner &&
      !blocks.ownerBlockedViewer &&
      visibility === 'FRIENDS'
    ) {
      let friendshipPromise = friendshipCache.get(ownerUid);

      if (!friendshipPromise) {
        friendshipPromise = readFriendshipContext(viewerUid, ownerUid);
        friendshipCache.set(ownerUid, friendshipPromise);
      }

      bilateralFriendship = (
        await friendshipPromise
      ).bilateralFriendship;
    }

    return evaluateVideoAudienceAccess(buildAccessInput(
      viewerUid,
      { ...target, ownerUid },
      blocks,
      bilateralFriendship
    ));
  };

  return {
    evaluate,
    assert: async (target: VideoAudienceAccessTarget): Promise<void> => {
      assertVideoAudienceAccessDecision(
        await evaluate(target),
        target.action
      );
    },
    assertInTransaction: async (
      transaction: Transaction,
      target: VideoAudienceAccessTarget
    ): Promise<void> => {
      const ownerUid = cleanId(target.ownerUid);

      if (!ownerUid) {
        assertVideoAudienceAccessDecision(
          denied('invalid_target'),
          target.action
        );
        return;
      }

      const viewerSnapshot = await transaction.get(
        db.doc(`users/${viewerUid}`)
      );
      const transactionalViewer = viewerSnapshot.exists
        ? viewerSnapshot.data() as ViewerAccountDocument
        : null;

      if (!transactionalViewer) {
        throw new HttpsError('not-found', 'Conta não encontrada.');
      }

      assertViewerAccountAvailable(
        transactionalViewer,
        viewerUid,
        authUser.disabled
      );

      if (viewerUid === ownerUid) {
        assertVideoAudienceAccessDecision(
          evaluateVideoAudienceAccess(ownerAccessInput(
            viewerUid,
            { ...target, ownerUid }
          )),
          target.action
        );
        return;
      }

      const blocks = await readBlockContextInTransaction(
        transaction,
        viewerUid,
        ownerUid
      );
      const visibility = normalizeVisibility(target.visibility);
      let bilateralFriendship = false;

      if (
        !blocks.viewerBlockedOwner &&
        !blocks.ownerBlockedViewer &&
        visibility === 'FRIENDS'
      ) {
        bilateralFriendship = (
          await readFriendshipContextInTransaction(
            transaction,
            viewerUid,
            ownerUid
          )
        ).bilateralFriendship;
      }

      assertVideoAudienceAccessDecision(
        evaluateVideoAudienceAccess(buildAccessInput(
          viewerUid,
          { ...target, ownerUid },
          blocks,
          bilateralFriendship
        )),
        target.action
      );
    },
  };
}
