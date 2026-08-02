import { HttpsError } from 'firebase-functions/v2/https';

import {
  assertInteractionAccessData,
} from '../../account_lifecycle/interaction-access.policy';
import { db } from '../../firebaseApp';

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

export interface VideoAudienceAccessEvaluator {
  evaluate(
    target: VideoAudienceAccessTarget
  ): Promise<VideoAudienceAccessDecision>;
}

interface RelationshipContext {
  viewerBlockedOwner: boolean;
  ownerBlockedViewer: boolean;
  bilateralFriendship: boolean;
  mutuallyCompatible: boolean;
  hasCreatorSubscriberEntitlement: boolean;
  hasCreatorPremiumEntitlement: boolean;
}

interface RelationshipDocument {
  isBlocked?: unknown;
  friendUid?: unknown;
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

function normalizeVisibility(value: unknown): VideoAudienceVisibility | null {
  const normalized = String(value ?? '').trim().toUpperCase();

  return SUPPORTED_VISIBILITIES.has(normalized as VideoAudienceVisibility)
    ? normalized as VideoAudienceVisibility
    : null;
}

function isApproved(value: unknown): boolean {
  return String(value ?? '').trim().toUpperCase() === 'APPROVED';
}

function denied(reason: VideoAudienceAccessReason): VideoAudienceAccessDecision {
  return { allowed: false, reason };
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

async function readRelationshipContext(
  viewerUid: string,
  ownerUid: string
): Promise<RelationshipContext> {
  if (viewerUid === ownerUid) {
    return {
      viewerBlockedOwner: false,
      ownerBlockedViewer: false,
      bilateralFriendship: true,
      mutuallyCompatible: true,
      hasCreatorSubscriberEntitlement: true,
      hasCreatorPremiumEntitlement: true,
    };
  }

  const [viewerBlock, ownerBlock, viewerFriend, ownerFriend] =
    await Promise.all([
      db.doc(`users/${viewerUid}/blocks/${ownerUid}`).get(),
      db.doc(`users/${ownerUid}/blocks/${viewerUid}`).get(),
      db.doc(`users/${viewerUid}/friends/${ownerUid}`).get(),
      db.doc(`users/${ownerUid}/friends/${viewerUid}`).get(),
    ]);

  return {
    viewerBlockedOwner: isActiveBlock(viewerBlock),
    ownerBlockedViewer: isActiveBlock(ownerBlock),
    bilateralFriendship:
      isValidFriendEdge(viewerFriend, ownerUid) &&
      isValidFriendEdge(ownerFriend, viewerUid),

    /**
     * COMPATIBLE ainda depende de uma projeção backend canônica. Nunca confiar
     * apenas no cálculo Angular para autorizar mídia por link direto.
     */
    mutuallyCompatible: false,

    /**
     * SUBSCRIBERS/PREMIUM permanecem fechados até existir entitlement bilateral
     * de criador, com vigência, cancelamento, chargeback e status KYC/AML.
     * A assinatura da plataforma não concede acesso ao conteúdo de um criador.
     */
    hasCreatorSubscriberEntitlement: false,
    hasCreatorPremiumEntitlement: false,
  };
}

/**
 * Cria uma sessão de autorização por requisição.
 *
 * - valida lifecycle/idade uma única vez;
 * - mantém cache das relações por proprietário no lote;
 * - usa bloqueio bilateral e amizade bilateral;
 * - nega audiências sem fonte autorizativa no backend.
 */
export async function createVideoAudienceAccessEvaluator(
  rawViewerUid: unknown
): Promise<VideoAudienceAccessEvaluator> {
  const viewerUid = cleanId(rawViewerUid);

  if (!viewerUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  const viewerSnapshot = await db.doc(`users/${viewerUid}`).get();
  assertInteractionAccessData(
    viewerSnapshot.exists ? viewerSnapshot.data() : null
  );

  const relationshipCache = new Map<
    string,
    Promise<RelationshipContext>
  >();

  return {
    evaluate: async (
      target: VideoAudienceAccessTarget
    ): Promise<VideoAudienceAccessDecision> => {
      const ownerUid = cleanId(target.ownerUid);

      if (!ownerUid) {
        return denied('invalid_target');
      }

      let relationshipPromise = relationshipCache.get(ownerUid);

      if (!relationshipPromise) {
        relationshipPromise = readRelationshipContext(viewerUid, ownerUid);
        relationshipCache.set(ownerUid, relationshipPromise);
      }

      const relationship = await relationshipPromise;

      return evaluateVideoAudienceAccess({
        viewerUid,
        ownerUid,
        action: target.action,
        visibility: target.visibility,
        isPublished: target.isPublished,
        moderationStatus: target.moderationStatus,
        viewerLifecycleAllowed: true,
        ...relationship,
      });
    },
  };
}
