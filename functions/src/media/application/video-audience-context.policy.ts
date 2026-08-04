import {
  assertVideoAudienceAccessDecision,
  evaluateVideoAccountAccess,
  evaluateVideoAudienceAccess,
  resolveCanonicalVideoAudienceTarget,
  type PublicVideoAudienceDocument,
  type VideoAccountAccessDecision,
  type VideoAudienceAccessDecision,
  type VideoAudienceAction,
  type VideoAudienceAccessTarget,
  type VideoPublicationAudienceDocument,
} from './video-audience-access.policy';

export interface VideoAudienceAuthContext {
  readonly disabled?: boolean;
  readonly emailVerified?: boolean;
}

export interface CanonicalVideoAudienceContextInput {
  readonly viewerUid: string;
  readonly ownerUid: string;
  readonly videoId: string;
  readonly action: VideoAudienceAction;
  readonly viewerUser: unknown;
  readonly ownerUser: unknown;
  readonly viewerAuth: VideoAudienceAuthContext;
  readonly ownerAuth: VideoAudienceAuthContext;
  readonly publicVideo:
    | (PublicVideoAudienceDocument & Readonly<Record<string, unknown>>)
    | null
    | undefined;
  readonly publication:
    | (VideoPublicationAudienceDocument & Readonly<Record<string, unknown>>)
    | null
    | undefined;
  readonly viewerBlockedOwner: boolean;
  readonly ownerBlockedViewer: boolean;
  readonly bilateralFriendship: boolean;
  readonly mutuallyCompatible?: boolean;
  readonly hasCreatorSubscriberEntitlement?: boolean;
  readonly hasCreatorPremiumEntitlement?: boolean;
}

export interface CanonicalVideoAudienceContextResult {
  readonly target: VideoAudienceAccessTarget | null;
  readonly decision: VideoAudienceAccessDecision;
  readonly viewerDecision: VideoAccountAccessDecision | null;
  readonly ownerDecision: VideoAccountAccessDecision | null;
}

export function evaluateCanonicalVideoAudienceContext(
  input: CanonicalVideoAudienceContextInput
): CanonicalVideoAudienceContextResult {
  const target = resolveCanonicalVideoAudienceTarget({
    ownerUid: input.ownerUid,
    videoId: input.videoId,
    action: input.action,
    publicVideo: input.publicVideo,
    publication: input.publication,
  });

  if (!target) {
    return {
      target: null,
      decision: { allowed: false, reason: 'invalid_target' },
      viewerDecision: null,
      ownerDecision: null,
    };
  }

  const viewerDecision = evaluateVideoAccountAccess(
    input.viewerUser,
    input.viewerUid,
    {
      authDisabled: input.viewerAuth.disabled === true,
      authenticatedEmailVerified: input.viewerAuth.emailVerified === true,
    }
  );
  const ownerDecision = evaluateVideoAccountAccess(
    input.ownerUser,
    input.ownerUid,
    {
      authDisabled: input.ownerAuth.disabled === true,
      authenticatedEmailVerified: input.ownerAuth.emailVerified === true,
      requireVerifiedEmail: false,
    }
  );
  const decision = evaluateVideoAudienceAccess({
    viewerUid: input.viewerUid,
    ownerUid: input.ownerUid,
    action: input.action,
    visibility: target.visibility,
    isPublished: target.isPublished,
    moderationStatus: target.moderationStatus,
    viewerLifecycleAllowed: viewerDecision.allowed,
    ownerLifecycleAllowed: ownerDecision.allowed,
    viewerBlockedOwner: input.viewerBlockedOwner,
    ownerBlockedViewer: input.ownerBlockedViewer,
    bilateralFriendship: input.bilateralFriendship,
    mutuallyCompatible: input.mutuallyCompatible === true,
    hasCreatorSubscriberEntitlement:
      input.hasCreatorSubscriberEntitlement === true,
    hasCreatorPremiumEntitlement:
      input.hasCreatorPremiumEntitlement === true,
  });

  return {
    target,
    decision,
    viewerDecision,
    ownerDecision,
  };
}

export function assertCanonicalVideoAudienceContext(
  input: CanonicalVideoAudienceContextInput
): VideoAudienceAccessTarget {
  const result = evaluateCanonicalVideoAudienceContext(input);

  assertVideoAudienceAccessDecision(result.decision, input.action);

  if (!result.target) {
    // A asserção acima já lança HttpsError. Esta guarda preserva o tipo de
    // retorno sem enfraquecer a validação em caso de alteração futura.
    throw new Error('Contexto canônico de audiência ausente.');
  }

  return result.target;
}
