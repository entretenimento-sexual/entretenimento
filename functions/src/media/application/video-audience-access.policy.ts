import { HttpsError } from 'firebase-functions/v2/https';

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
  | 'owner_restricted'
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

export type VideoAccountAccessReason =
  | 'profile_missing'
  | 'account_restricted'
  | 'email_unverified'
  | 'adult_access_required'
  | 'terms_required'
  | 'profile_incomplete';

export interface VideoAccountAccessDecision {
  readonly allowed: boolean;
  readonly reason: VideoAccountAccessReason | null;
}

export interface VideoAccountAccessOptions {
  readonly authDisabled?: boolean;
  readonly authenticatedEmailVerified?: boolean;
  readonly requireVerifiedEmail?: boolean;
  readonly requireCompletedProfile?: boolean;
}

export interface VideoAudienceAccessDecision {
  readonly allowed: boolean;
  readonly reason: VideoAudienceAccessReason | null;
}

export interface VideoAudienceAccessInput {
  readonly viewerUid: string;
  readonly ownerUid: string;
  readonly action: VideoAudienceAction;
  readonly visibility: unknown;
  readonly isPublished: boolean;
  readonly moderationStatus: unknown;
  readonly viewerLifecycleAllowed: boolean;
  readonly ownerLifecycleAllowed: boolean;
  readonly viewerBlockedOwner: boolean;
  readonly ownerBlockedViewer: boolean;
  readonly bilateralFriendship: boolean;
  readonly mutuallyCompatible: boolean;
  readonly hasCreatorSubscriberEntitlement: boolean;
  readonly hasCreatorPremiumEntitlement: boolean;
}

export interface VideoAudienceAccessTarget {
  readonly ownerUid: string;
  readonly action: VideoAudienceAction;
  readonly visibility: unknown;
  readonly isPublished: boolean;
  readonly moderationStatus: unknown;
}

export interface PublicVideoAudienceDocument {
  readonly id?: unknown;
  readonly ownerUid?: unknown;
  readonly mediaType?: unknown;
  readonly assetAccess?: unknown;
  readonly visibility?: unknown;
  readonly moderationStatus?: unknown;
}

export interface VideoPublicationAudienceDocument {
  readonly ownerUid?: unknown;
  readonly videoId?: unknown;
  readonly isPublished?: unknown;
  readonly visibility?: unknown;
  readonly moderationStatus?: unknown;
}

export interface VideoAudienceAccessEvaluator {
  evaluate(
    target: VideoAudienceAccessTarget
  ): Promise<VideoAudienceAccessDecision>;
  assert(target: VideoAudienceAccessTarget): Promise<void>;
}

interface VideoAccountDocument {
  readonly uid?: unknown;
  readonly accountStatus?: unknown;
  readonly suspended?: unknown;
  readonly interactionBlocked?: unknown;
  readonly accountLocked?: unknown;
  readonly loginAllowed?: unknown;
  readonly emailVerified?: unknown;
  readonly profileCompleted?: unknown;
  readonly idade?: unknown;
  readonly age?: unknown;
  readonly initialAdultConsentRequired?: unknown;
  readonly adultConsent?: unknown;
  readonly acceptedTerms?: unknown;
  readonly ageReverification?: unknown;
}

interface RelationshipDocument {
  readonly isBlocked?: unknown;
  readonly friendUid?: unknown;
}

interface BlockContext {
  readonly viewerBlockedOwner: boolean;
  readonly ownerBlockedViewer: boolean;
}

interface FriendshipContext {
  readonly bilateralFriendship: boolean;
}

const AGE_REVERIFICATION_RESTRICTED_STATES = new Set([
  'REQUIRED',
  'SUBMITTED',
  'UNDER_REVIEW',
  'REJECTED',
  'EXPIRED',
]);

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

function nestedRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
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

function accountDenied(
  reason: VideoAccountAccessReason
): VideoAccountAccessDecision {
  return { allowed: false, reason };
}

function accessDenied(
  reason: VideoAudienceAccessReason
): VideoAudienceAccessDecision {
  return { allowed: false, reason };
}

function hasAdultAccess(user: VideoAccountDocument): boolean {
  const declaredAge = user.idade ?? user.age;
  const adultConsent = nestedRecord(user.adultConsent);
  const ageReverification = nestedRecord(user.ageReverification);

  if (
    typeof declaredAge === 'number' &&
    Number.isFinite(declaredAge) &&
    declaredAge < 18
  ) {
    return false;
  }

  if (normalizeEnum(ageReverification['result']) === 'UNDERAGE') {
    return false;
  }

  if (
    AGE_REVERIFICATION_RESTRICTED_STATES.has(
      normalizeEnum(ageReverification['status'])
    )
  ) {
    return false;
  }

  if (adultConsent['accepted'] === false) {
    return false;
  }

  if (
    user.initialAdultConsentRequired !== false &&
    adultConsent['accepted'] !== true
  ) {
    return false;
  }

  return true;
}

function hasAcceptedTerms(user: VideoAccountDocument): boolean {
  const acceptedTerms = nestedRecord(user.acceptedTerms);

  if (acceptedTerms['accepted'] === false) {
    return false;
  }

  if (acceptedTerms['adultAccessAcknowledgement'] === false) {
    return false;
  }

  if (
    user.initialAdultConsentRequired !== false &&
    acceptedTerms['accepted'] !== true
  ) {
    return false;
  }

  return true;
}

export function evaluateVideoAccountAccess(
  rawUser: unknown,
  expectedUid: string,
  options: VideoAccountAccessOptions = {}
): VideoAccountAccessDecision {
  const user = nestedRecord(rawUser) as VideoAccountDocument;
  const uid = cleanId(user.uid);
  const accountStatus = String(user.accountStatus ?? 'active')
    .trim()
    .toLowerCase();
  const requireVerifiedEmail = options.requireVerifiedEmail !== false;
  const requireCompletedProfile = options.requireCompletedProfile !== false;

  if (!expectedUid || uid !== expectedUid) {
    return accountDenied('profile_missing');
  }

  if (
    options.authDisabled === true ||
    accountStatus !== 'active' ||
    user.suspended === true ||
    user.interactionBlocked === true ||
    user.accountLocked === true ||
    user.loginAllowed === false
  ) {
    return accountDenied('account_restricted');
  }

  if (
    requireVerifiedEmail &&
    options.authenticatedEmailVerified !== true &&
    user.emailVerified !== true
  ) {
    return accountDenied('email_unverified');
  }

  if (!hasAdultAccess(user)) {
    return accountDenied('adult_access_required');
  }

  if (!hasAcceptedTerms(user)) {
    return accountDenied('terms_required');
  }

  if (requireCompletedProfile && user.profileCompleted !== true) {
    return accountDenied('profile_incomplete');
  }

  return { allowed: true, reason: null };
}

export function resolveCanonicalVideoAudienceTarget(params: {
  readonly ownerUid: unknown;
  readonly videoId: unknown;
  readonly action: VideoAudienceAction;
  readonly publicVideo: PublicVideoAudienceDocument | null | undefined;
  readonly publication: VideoPublicationAudienceDocument | null | undefined;
}): VideoAudienceAccessTarget | null {
  const ownerUid = cleanId(params.ownerUid);
  const videoId = cleanId(params.videoId);
  const publicVideo = params.publicVideo;
  const publication = params.publication;

  if (!ownerUid || !videoId || !publicVideo || !publication) {
    return null;
  }

  const projectionVisibility = normalizeVisibility(publicVideo.visibility);
  const publicationVisibility = normalizeVisibility(publication.visibility);
  const projectionModeration = normalizeEnum(publicVideo.moderationStatus);
  const publicationModeration = normalizeEnum(publication.moderationStatus);

  if (
    cleanId(publicVideo.id) !== videoId ||
    cleanId(publicVideo.ownerUid) !== ownerUid ||
    cleanId(publication.ownerUid) !== ownerUid ||
    cleanId(publication.videoId) !== videoId ||
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
    return accessDenied('invalid_target');
  }

  if (!input.viewerLifecycleAllowed) {
    return accessDenied('viewer_restricted');
  }

  if (!input.ownerLifecycleAllowed) {
    return accessDenied('owner_restricted');
  }

  if (!input.isPublished) {
    return accessDenied('not_published');
  }

  if (normalizeEnum(input.moderationStatus) !== 'APPROVED') {
    return accessDenied('moderation_required');
  }

  const visibility = normalizeVisibility(input.visibility);

  if (!visibility) {
    return accessDenied('unsupported_visibility');
  }

  if (visibility === 'PRIVATE') {
    return accessDenied('private_content');
  }

  if (viewerUid === ownerUid) {
    return { allowed: true, reason: null };
  }

  if (input.viewerBlockedOwner || input.ownerBlockedViewer) {
    return accessDenied('blocked');
  }

  switch (visibility) {
  case 'PUBLIC':
    return { allowed: true, reason: null };

  case 'FRIENDS':
    return input.bilateralFriendship
      ? { allowed: true, reason: null }
      : accessDenied('friendship_required');

  case 'COMPATIBLE':
    return input.mutuallyCompatible
      ? { allowed: true, reason: null }
      : accessDenied('compatibility_required');

  case 'SUBSCRIBERS':
    return input.hasCreatorSubscriberEntitlement
      ? { allowed: true, reason: null }
      : accessDenied('subscriber_entitlement_required');

  case 'PREMIUM':
    return input.hasCreatorPremiumEntitlement
      ? { allowed: true, reason: null }
      : accessDenied('premium_entitlement_required');

  default:
    return accessDenied('unsupported_visibility');
  }
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

  if (reason === 'owner_restricted') {
    throw new HttpsError(
      'failed-precondition',
      'O perfil responsável por este vídeo não está disponível.',
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

function isActiveBlock(snapshot: {
  readonly exists: boolean;
  data(): RelationshipDocument | undefined;
}): boolean {
  return snapshot.exists && snapshot.data()?.isBlocked === true;
}

function isValidFriendEdge(
  snapshot: {
    readonly id: string;
    readonly exists: boolean;
    data(): RelationshipDocument | undefined;
  },
  expectedFriendUid: string
): boolean {
  if (!snapshot.exists) {
    return false;
  }

  return cleanId(snapshot.data()?.friendUid ?? snapshot.id) ===
    expectedFriendUid;
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

async function readOwnerEligibility(ownerUid: string): Promise<boolean> {
  try {
    const [ownerSnapshot, ownerAuth] = await Promise.all([
      db.doc(`users/${ownerUid}`).get(),
      auth.getUser(ownerUid),
    ]);

    return evaluateVideoAccountAccess(
      ownerSnapshot.exists ? ownerSnapshot.data() : null,
      ownerUid,
      {
        authDisabled: ownerAuth.disabled,
        authenticatedEmailVerified: ownerAuth.emailVerified,
        requireVerifiedEmail: false,
      }
    ).allowed;
  } catch {
    return false;
  }
}

function buildAccessInput(params: {
  readonly viewerUid: string;
  readonly target: VideoAudienceAccessTarget;
  readonly ownerLifecycleAllowed: boolean;
  readonly blocks: BlockContext;
  readonly bilateralFriendship: boolean;
}): VideoAudienceAccessInput {
  return {
    viewerUid: params.viewerUid,
    ownerUid: params.target.ownerUid,
    action: params.target.action,
    visibility: params.target.visibility,
    isPublished: params.target.isPublished,
    moderationStatus: params.target.moderationStatus,
    viewerLifecycleAllowed: true,
    ownerLifecycleAllowed: params.ownerLifecycleAllowed,
    ...params.blocks,
    bilateralFriendship: params.bilateralFriendship,

    // As fontes canônicas desses vínculos ainda não estão integradas a este
    // fluxo. Negar por padrão evita que o cliente transforme afinidade visual
    // ou assinatura geral da plataforma em autorização de mídia.
    mutuallyCompatible: false,
    hasCreatorSubscriberEntitlement: false,
    hasCreatorPremiumEntitlement: false,
  };
}

export async function createVideoAudienceAccessEvaluator(
  rawViewerUid: unknown,
  authenticatedEmailVerified?: boolean
): Promise<VideoAudienceAccessEvaluator> {
  const viewerUid = cleanId(rawViewerUid);

  if (!viewerUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  let viewerAuth;

  try {
    viewerAuth = await auth.getUser(viewerUid);
  } catch {
    throw new HttpsError('not-found', 'Conta não encontrada.');
  }

  const viewerSnapshot = await db.doc(`users/${viewerUid}`).get();
  const viewerDecision = evaluateVideoAccountAccess(
    viewerSnapshot.exists ? viewerSnapshot.data() : null,
    viewerUid,
    {
      authDisabled: viewerAuth.disabled,
      authenticatedEmailVerified:
        authenticatedEmailVerified === true || viewerAuth.emailVerified,
    }
  );

  if (!viewerDecision.allowed) {
    const reason = viewerDecision.reason ?? 'account_restricted';

    throw new HttpsError(
      reason === 'profile_missing' ? 'not-found' : 'failed-precondition',
      reason === 'email_unverified'
        ? 'Confirme seu e-mail antes de acessar vídeos.'
        : reason === 'adult_access_required'
          ? 'Conclua a confirmação de acesso adulto antes de acessar vídeos.'
          : reason === 'terms_required'
            ? 'Aceite os termos atuais antes de acessar vídeos.'
            : reason === 'profile_incomplete'
              ? 'Complete seu perfil antes de acessar vídeos.'
              : 'Sua conta não está disponível para acessar vídeos.',
      { reason }
    );
  }

  const blockCache = new Map<string, Promise<BlockContext>>();
  const friendshipCache = new Map<string, Promise<FriendshipContext>>();
  const ownerEligibilityCache = new Map<string, Promise<boolean>>();

  const ownerEligibility = (ownerUid: string): Promise<boolean> => {
    if (ownerUid === viewerUid) {
      return Promise.resolve(true);
    }

    let cached = ownerEligibilityCache.get(ownerUid);

    if (!cached) {
      cached = readOwnerEligibility(ownerUid);
      ownerEligibilityCache.set(ownerUid, cached);
    }

    return cached;
  };

  const blocksFor = (ownerUid: string): Promise<BlockContext> => {
    if (ownerUid === viewerUid) {
      return Promise.resolve({
        viewerBlockedOwner: false,
        ownerBlockedViewer: false,
      });
    }

    let cached = blockCache.get(ownerUid);

    if (!cached) {
      cached = readBlockContext(viewerUid, ownerUid);
      blockCache.set(ownerUid, cached);
    }

    return cached;
  };

  const friendshipFor = (ownerUid: string): Promise<FriendshipContext> => {
    let cached = friendshipCache.get(ownerUid);

    if (!cached) {
      cached = readFriendshipContext(viewerUid, ownerUid);
      friendshipCache.set(ownerUid, cached);
    }

    return cached;
  };

  const evaluate = async (
    target: VideoAudienceAccessTarget
  ): Promise<VideoAudienceAccessDecision> => {
    const ownerUid = cleanId(target.ownerUid);

    if (!ownerUid) {
      return accessDenied('invalid_target');
    }

    const [ownerLifecycleAllowed, blocks] = await Promise.all([
      ownerEligibility(ownerUid),
      blocksFor(ownerUid),
    ]);
    const visibility = normalizeVisibility(target.visibility);
    let bilateralFriendship = false;

    if (
      ownerUid !== viewerUid &&
      ownerLifecycleAllowed &&
      !blocks.viewerBlockedOwner &&
      !blocks.ownerBlockedViewer &&
      visibility === 'FRIENDS'
    ) {
      bilateralFriendship = (
        await friendshipFor(ownerUid)
      ).bilateralFriendship;
    }

    return evaluateVideoAudienceAccess(buildAccessInput({
      viewerUid,
      target: { ...target, ownerUid },
      ownerLifecycleAllowed,
      blocks,
      bilateralFriendship,
    }));
  };

  return {
    evaluate,
    assert: async (target: VideoAudienceAccessTarget): Promise<void> => {
      assertVideoAudienceAccessDecision(
        await evaluate(target),
        target.action
      );
    },
  };
}
