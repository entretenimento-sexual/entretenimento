// functions/src/community/community-ownership-transfer.workflow.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY OWNERSHIP TRANSFER WORKFLOW
// -----------------------------------------------------------------------------
// Fluxo autoritativo de transferência/sucessão:
// - indicação cria oferta; não altera ownership;
// - candidato aceita/recusa explicitamente;
// - aceite revalida conta, membership, entitlement, quota e capacidade;
// - sucessão terminal possui deadline próprio e nunca escolhe herdeiro sozinha;
// - todas as transições são idempotentes/auditáveis e notificadas.
// -----------------------------------------------------------------------------

import type { CallableRequest } from 'firebase-functions/v2/https';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertRecentAuthentication,
  assertStaffAuthorization,
} from '../account_lifecycle/_shared';
import {
  stopOpenCommunityBoostForCommunityInTransaction,
} from '../community-boost/community-boost-authority.service';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  evaluatePlatformSubscriptionEntitlement,
} from '../payments/application/platform-subscription-entitlement.service';
import {
  MAX_PERSONAL_COMMUNITIES_PER_OWNER,
  isCommunityMemberLimitAllowed,
  resolveCommunityCapacitySponsorRole,
  resolveCommunityConfiguredMemberLimit,
  resolvePersonalCommunityCreationPolicy,
} from './community-capacity.policy';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  assertCommunityMembershipActorEligibleForUid,
  assertCommunityMembershipActorEligibleInTransaction,
} from './community-membership-eligibility.service';
import {
  canReceiveCommunityEssentialNotification,
  type CommunityNotificationUser,
} from './community-notification.policy';
import {
  resolveCommunityNotificationMembershipCycleStartedAtMs,
} from './community-notification-membership.policy';
import {
  evaluateCommunityOwnerSuccession,
} from './community-owner-succession.policy';
import {
  evaluateCommunityOwnershipTransfer,
  type CommunityOwnershipMembershipRole,
  type CommunityOwnershipMembershipStatus,
  type CommunityOwnershipSourceType,
  type CommunityOwnershipStatus,
} from './community-ownership-lifecycle.policy';
import {
  COMMUNITY_OWNER_TERMINAL_SUCCESSION_WINDOW_MS,
  COMMUNITY_OWNERSHIP_WORKFLOW_POLICY_VERSION,
  canAcceptCommunityOwnershipTransfer,
  canNominateCommunityOwnershipCandidate,
  isCommunityOwnershipTransferExpired,
  isCommunityOwnershipTransferPending,
  resolveCommunityOwnershipTransferExpiresAt,
  type CommunityOwnerTerminalSuccessionTrigger,
  type CommunityOwnershipTransferMode,
} from './community-ownership-transfer.workflow.policy';
import { normalizeCommunityId } from './community-preview.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const ACTIVE_SLOT_COLLECTION = 'community_ownership_transfer_active';
const REQUEST_COLLECTION = 'community_ownership_transfer_requests';
const CASE_COLLECTION = 'community_owner_succession_cases';
const MAX_INBOX_ITEMS = 30;

interface OwnershipTransferRequestPayload {
  communityId?: unknown;
  targetUid?: unknown;
  requestId?: unknown;
}

interface OwnershipTransferResponsePayload {
  requestId?: unknown;
  action?: unknown;
}

interface OwnershipTransferCancelPayload {
  requestId?: unknown;
}

interface TerminalSuccessionCasePayload {
  communityId?: unknown;
  trigger?: unknown;
}

interface TerminalSuccessionNominationPayload {
  communityId?: unknown;
  targetUid?: unknown;
  requestId?: unknown;
}

interface TerminalSuccessionCancelPayload {
  communityId?: unknown;
  reason?: unknown;
}

export interface CommunityOwnershipTransferRequestResponse {
  requestId: string;
  communityId: string;
  candidateUid: string;
  status: 'pending';
  mode: CommunityOwnershipTransferMode;
  expiresAt: number;
  generatedAt: number;
}

export interface CommunityOwnershipTransferRespondResponse {
  requestId: string;
  communityId: string;
  status: 'declined' | 'expired' | 'completed';
  newOwnerUid: string | null;
  generatedAt: number;
}

export interface CommunityOwnershipTransferCancelResponse {
  requestId: string;
  communityId: string;
  status: 'canceled' | 'expired';
  generatedAt: number;
}

interface OwnershipInboxItem {
  requestId: string;
  communityId: string;
  communityName: string;
  previousOwnerUid: string;
  previousOwnerLabel: string;
  candidateUid: string;
  candidateLabel: string;
  mode: CommunityOwnershipTransferMode;
  status: string;
  expiresAt: number;
  createdAt: number;
}

interface OwnershipInboxResponse {
  incoming: OwnershipInboxItem[];
  outgoing: OwnershipInboxItem[];
  generatedAt: number;
}

interface CandidateEligibility {
  membershipActive: boolean;
  accountEligible: boolean;
  ownershipEntitlementEligible: boolean;
  ownershipQuotaAvailable: boolean;
  ownershipCapacityCompatible: boolean;
  sponsorRole: string;
  currentOwnedCommunities: number;
  maxOwnedCommunities: number | null;
  configuredMemberLimit: number;
}

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'A gestão de Comunidades ainda não está disponível neste ambiente.'
  );
}

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeText(value: unknown, maxLength = 80): string {
  return Array.from(String(value ?? ''), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function assertAuthenticatedUid(auth: unknown): string {
  const source = (auth ?? {}) as {
    uid?: unknown;
    token?: Record<string, unknown>;
  };
  const uid = normalizeSafeId(source.uid);
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }
  if (source.token?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail para continuar.'
    );
  }
  return uid;
}

function normalizeSourceType(value: unknown): CommunityOwnershipSourceType {
  return value === 'community' || value === 'venue' ? value : null;
}

function normalizeCommunityStatus(value: unknown): CommunityOwnershipStatus {
  return value === 'active' || value === 'paused' || value === 'archived'
    ? value
    : null;
}

function normalizeMembershipStatus(
  value: unknown
): CommunityOwnershipMembershipStatus {
  return value === 'active'
    || value === 'pending'
    || value === 'blocked'
    || value === 'left'
    ? value
    : null;
}

function normalizeMembershipRole(value: unknown): CommunityOwnershipMembershipRole {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function normalizeMode(value: unknown): CommunityOwnershipTransferMode | null {
  return value === 'voluntary' || value === 'terminal_succession'
    ? value
    : null;
}

function normalizeTerminalTrigger(
  value: unknown
): CommunityOwnerTerminalSuccessionTrigger | null {
  return value === 'owner_terminally_unavailable'
    || value === 'confirmed_abandonment'
    ? value
    : null;
}

function normalizeEpoch(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isCommunityStatusAvailableForOwnershipWorkflow(
  value: unknown,
  mode: CommunityOwnershipTransferMode
): boolean {
  if (value === 'active' || value === 'paused') return true;
  return mode === 'terminal_succession' && value === 'dormant';
}

function labelForUser(rawUser: unknown): string {
  const user = (rawUser ?? {}) as Record<string, unknown>;
  return normalizeText(user['nickname'], 60)
    || normalizeText(user['nome'], 60)
    || 'Participante';
}

function ownershipWorkflowRoute(requestId: string): string {
  return '/dashboard/comunidades/propriedade'
    + `?request=${encodeURIComponent(requestId)}`;
}

function notificationId(
  requestId: string,
  recipientUid: string,
  event: string
): string {
  return `community-ownership-${event}-${requestId}-${recipientUid}`.slice(
    0,
    240
  );
}

function requestDocumentToInboxItem(raw: unknown): OwnershipInboxItem | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const requestId = normalizeSafeId(source['requestId']);
  const communityId = normalizeSafeId(source['communityId']);
  const previousOwnerUid = normalizeSafeId(source['previousOwnerUid']);
  const candidateUid = normalizeSafeId(source['candidateUid']);
  const mode = normalizeMode(source['mode']);
  const expiresAt = normalizeEpoch(source['expiresAt']);
  const createdAt = normalizeEpoch(source['createdAt']);
  const status = normalizeText(source['status'], 32);

  if (
    !requestId
    || !communityId
    || !previousOwnerUid
    || !candidateUid
    || !mode
    || !expiresAt
    || !createdAt
    || !status
  ) {
    return null;
  }

  return {
    requestId,
    communityId,
    communityName:
      normalizeText(source['communityNameSnapshot'], 80) || 'Comunidade',
    previousOwnerUid,
    previousOwnerLabel:
      normalizeText(source['previousOwnerLabelSnapshot'], 60) || 'Proprietário',
    candidateUid,
    candidateLabel:
      normalizeText(source['candidateLabelSnapshot'], 60) || 'Participante',
    mode,
    status,
    expiresAt,
    createdAt,
  };
}

async function resolveCandidateEligibilityInTransaction(input: {
  transaction: FirebaseFirestore.Transaction;
  community: Readonly<Record<string, unknown>>;
  candidateUid: string;
  candidateMembership: Readonly<Record<string, unknown>>;
  candidateUser: Readonly<Record<string, unknown>> | null;
}): Promise<CandidateEligibility> {
  const { transaction, community, candidateUid } = input;
  const entitlementRef = db
    .collection('entitlements')
    .doc(`platform_subscription_${candidateUid}`);
  const ownedQuery = db
    .collection('communities')
    .where('ownerUid', '==', candidateUid)
    .where('source.type', '==', 'community')
    .where('status', 'in', ['active', 'paused', 'dormant'])
    .limit(MAX_PERSONAL_COMMUNITIES_PER_OWNER + 1);

  const [entitlementSnapshot, ownedSnapshot] = await Promise.all([
    transaction.get(entitlementRef),
    transaction.get(ownedQuery),
  ]);

  let accountEligible = true;
  try {
    await assertCommunityMembershipActorEligibleInTransaction(
      transaction,
      candidateUid,
      input.candidateUser
    );
  } catch {
    accountEligible = false;
  }

  const entitlement = evaluatePlatformSubscriptionEntitlement(
    entitlementSnapshot.exists ? entitlementSnapshot.data() : null,
    candidateUid
  );
  const sponsorRole = resolveCommunityCapacitySponsorRole(
    entitlement.active ? entitlement.role : null,
    input.candidateUser?.['role']
  );
  const ownershipPolicy = resolvePersonalCommunityCreationPolicy(sponsorRole);
  const configuredMemberLimit = resolveCommunityConfiguredMemberLimit(community);
  const ownershipQuotaAvailable =
    ownershipPolicy.maxOwnedCommunities === null
    || ownedSnapshot.size < ownershipPolicy.maxOwnedCommunities;

  return {
    membershipActive:
      normalizeMembershipStatus(input.candidateMembership['status']) === 'active'
      && normalizeMembershipRole(input.candidateMembership['role']) !== 'owner',
    accountEligible,
    ownershipEntitlementEligible: ownershipPolicy.canCreate,
    ownershipQuotaAvailable,
    ownershipCapacityCompatible: isCommunityMemberLimitAllowed(
      configuredMemberLimit,
      sponsorRole
    ),
    sponsorRole,
    currentOwnedCommunities: ownedSnapshot.size,
    maxOwnedCommunities: ownershipPolicy.maxOwnedCommunities,
    configuredMemberLimit,
  };
}

function assertCandidateEligibility(
  eligibility: CandidateEligibility
): void {
  if (!eligibility.membershipActive || !eligibility.accountEligible) {
    throw new HttpsError(
      'failed-precondition',
      'O participante selecionado não pode assumir a propriedade agora.',
      { reason: 'target_account_ineligible' }
    );
  }

  if (!eligibility.ownershipEntitlementEligible) {
    throw new HttpsError(
      'failed-precondition',
      'O plano do participante selecionado não permite assumir nova propriedade.',
      {
        reason: 'community_ownership_subscription_required',
        recommendedAction: 'upgrade_subscription',
      }
    );
  }

  if (!eligibility.ownershipQuotaAvailable) {
    throw new HttpsError(
      'resource-exhausted',
      'O participante selecionado atingiu o limite de Comunidades próprias.',
      { reason: 'community_ownership_limit_reached' }
    );
  }

  if (!eligibility.ownershipCapacityCompatible) {
    throw new HttpsError(
      'failed-precondition',
      'O plano do participante não suporta a capacidade atual desta Comunidade.',
      {
        reason: 'community_ownership_capacity_upgrade_required',
        recommendedAction: 'upgrade_subscription',
      }
    );
  }
}

async function createOwnershipOffer(input: {
  actorUid: string;
  communityId: string;
  targetUid: string;
  requestId: string;
  mode: CommunityOwnershipTransferMode;
  trigger: CommunityOwnerTerminalSuccessionTrigger | 'owner_request';
  terminalDeadlineAt?: number | null;
}): Promise<CommunityOwnershipTransferRequestResponse> {
  const now = Date.now();

  return db.runTransaction(async (transaction) => {
    const communityRef = db.collection('communities').doc(input.communityId);
    const actorMembershipRef = communityRef.collection('members').doc(input.actorUid);
    const candidateMembershipRef = communityRef
      .collection('members')
      .doc(input.targetUid);
    const actorUserRef = db.collection('users').doc(input.actorUid);
    const candidateUserRef = db.collection('users').doc(input.targetUid);
    const requestRef = db.collection(REQUEST_COLLECTION).doc(input.requestId);
    const activeSlotRef = db
      .collection(ACTIVE_SLOT_COLLECTION)
      .doc(input.communityId);

    const [
      requestSnapshot,
      communitySnapshot,
      actorMembershipSnapshot,
      candidateMembershipSnapshot,
      actorUserSnapshot,
      candidateUserSnapshot,
      activeSlotSnapshot,
    ] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(communityRef),
      transaction.get(actorMembershipRef),
      transaction.get(candidateMembershipRef),
      transaction.get(actorUserRef),
      transaction.get(candidateUserRef),
      transaction.get(activeSlotRef),
    ]);

    if (requestSnapshot.exists) {
      const existing = requestDocumentToInboxItem(requestSnapshot.data());
      if (
        existing
        && existing.communityId === input.communityId
        && existing.candidateUid === input.targetUid
        && existing.previousOwnerUid === input.actorUid
        && existing.mode === input.mode
        && isCommunityOwnershipTransferPending(
          existing.status,
          existing.expiresAt,
          now
        )
      ) {
        return {
          requestId: existing.requestId,
          communityId: existing.communityId,
          candidateUid: existing.candidateUid,
          status: 'pending',
          mode: existing.mode,
          expiresAt: existing.expiresAt,
          generatedAt: now,
        };
      }

      throw new HttpsError(
        'already-exists',
        'Esta solicitação já foi utilizada.',
        { reason: 'community_ownership_transfer_conflict' }
      );
    }

    if (!communitySnapshot.exists) {
      throw new HttpsError(
        'not-found',
        'Comunidade não encontrada.',
        { reason: 'community_not_found' }
      );
    }

    const community = (communitySnapshot.data() ?? {}) as Record<string, unknown>;
    const source = (community['source'] ?? {}) as Record<string, unknown>;
    const rawCommunityStatus = String(community['status'] ?? '').trim();
    const currentOwnerUid = normalizeSafeId(community['ownerUid']);
    const ownerTransferredAt = normalizeEpoch(community['ownerTransferredAt']);
    const actorMembership = actorMembershipSnapshot.exists
      ? actorMembershipSnapshot.data() ?? {}
      : {};
    const candidateMembership = candidateMembershipSnapshot.exists
      ? candidateMembershipSnapshot.data() ?? {}
      : {};
    const actorUser = actorUserSnapshot.exists
      ? actorUserSnapshot.data() ?? {}
      : null;
    const candidateUser = candidateUserSnapshot.exists
      ? candidateUserSnapshot.data() ?? {}
      : null;

    if (
      normalizeSourceType(source['type']) !== 'community'
      || !isCommunityStatusAvailableForOwnershipWorkflow(
        rawCommunityStatus,
        input.mode
      )
      || !currentOwnerUid
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Esta Comunidade não pode iniciar uma transferência agora.',
        { reason: 'community_unavailable' }
      );
    }

    if (input.mode === 'voluntary') {
      if (currentOwnerUid !== input.actorUid) {
        throw new HttpsError(
          'permission-denied',
          'Apenas o proprietário atual pode iniciar a transferência.',
          { reason: 'owner_required' }
        );
      }

      await assertCommunityMembershipActorEligibleInTransaction(
        transaction,
        input.actorUid,
        actorUser
      );

      if (
        normalizeMembershipStatus(actorMembership['status']) !== 'active'
        || normalizeMembershipRole(actorMembership['role']) !== 'owner'
      ) {
        throw new HttpsError(
          'permission-denied',
          'Apenas o proprietário atual pode iniciar a transferência.',
          { reason: 'owner_required' }
        );
      }
    }

    if (input.targetUid === currentOwnerUid) {
      throw new HttpsError(
        'invalid-argument',
        'Selecione outro participante.',
        { reason: 'self_transfer_forbidden' }
      );
    }

    let staleRequestRef: FirebaseFirestore.DocumentReference | null = null;
    let staleRequestShouldExpire = false;

    if (activeSlotSnapshot.exists) {
      const slot = activeSlotSnapshot.data() ?? {};
      const slotRequestId = normalizeSafeId(slot['requestId']);
      const slotExpiresAt = normalizeEpoch(slot['expiresAt']);
      if (slotRequestId && slotExpiresAt && slotExpiresAt > now) {
        throw new HttpsError(
          'failed-precondition',
          'Já existe uma transferência aguardando resposta.',
          { reason: 'community_ownership_transfer_pending' }
        );
      }

      if (slotRequestId) {
        staleRequestRef = db.collection(REQUEST_COLLECTION).doc(slotRequestId);
        const staleRequestSnapshot = await transaction.get(staleRequestRef);
        staleRequestShouldExpire =
          staleRequestSnapshot.exists
          && staleRequestSnapshot.data()?.['status'] === 'pending';
      }
    }

    const eligibility = await resolveCandidateEligibilityInTransaction({
      transaction,
      community,
      candidateUid: input.targetUid,
      candidateMembership,
      candidateUser,
    });
    assertCandidateEligibility(eligibility);

    if (!canNominateCommunityOwnershipCandidate({
      explicitlyDesignated: true,
      membershipActive: eligibility.membershipActive,
      accountEligible: eligibility.accountEligible,
      ownershipEntitlementEligible:
        eligibility.ownershipEntitlementEligible,
      ownershipQuotaAvailable: eligibility.ownershipQuotaAvailable,
      ownershipCapacityCompatible:
        eligibility.ownershipCapacityCompatible,
    })) {
      throw new HttpsError(
        'failed-precondition',
        'O participante selecionado não está elegível.',
        { reason: 'target_account_ineligible' }
      );
    }

    const expiresAt = resolveCommunityOwnershipTransferExpiresAt({
      now,
      terminalDeadlineAt: input.terminalDeadlineAt ?? null,
    });
    const communityName = normalizeText(community['name'], 80) || 'Comunidade';
    const previousOwnerLabel = labelForUser(actorUser);
    const candidateLabel = labelForUser(candidateUser);
    const candidateMembershipCycleStartedAtMs =
      resolveCommunityNotificationMembershipCycleStartedAtMs(
        candidateMembership
      );
    const requestNotificationRef = db.collection('notifications').doc(
      notificationId(input.requestId, input.targetUid, 'requested')
    );

    if (staleRequestRef && staleRequestShouldExpire) {
      transaction.set(staleRequestRef, {
        status: 'expired',
        resolvedAt: now,
        updatedAt: now,
      }, { merge: true });
    }

    transaction.set(requestRef, {
      policyVersion: COMMUNITY_OWNERSHIP_WORKFLOW_POLICY_VERSION,
      requestId: input.requestId,
      communityId: input.communityId,
      communityNameSnapshot: communityName,
      previousOwnerUid: currentOwnerUid,
      previousOwnerLabelSnapshot: previousOwnerLabel,
      candidateUid: input.targetUid,
      candidateLabelSnapshot: candidateLabel,
      mode: input.mode,
      trigger: input.trigger,
      status: 'pending',
      ownerUidSnapshot: currentOwnerUid,
      ownerTransferredAtSnapshot: ownerTransferredAt,
      candidateSponsorRoleSnapshot: eligibility.sponsorRole,
      candidateOwnedCommunitiesSnapshot: eligibility.currentOwnedCommunities,
      candidateMaxOwnedCommunitiesSnapshot: eligibility.maxOwnedCommunities,
      communityConfiguredMemberLimitSnapshot: eligibility.configuredMemberLimit,
      explicitlyDesignated: true,
      explicitlyAccepted: false,
      expiresAt,
      createdByUid: input.actorUid,
      createdAt: now,
      updatedAt: now,
      respondedAt: null,
      completedAt: null,
    });

    transaction.set(activeSlotRef, {
      requestId: input.requestId,
      candidateUid: input.targetUid,
      previousOwnerUid: currentOwnerUid,
      mode: input.mode,
      expiresAt,
      updatedAt: now,
    });

    if (input.mode === 'terminal_succession') {
      transaction.set(
        db.collection(CASE_COLLECTION).doc(input.communityId),
        {
          activeRequestId: input.requestId,
          lastCandidateUid: input.targetUid,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    transaction.set(requestNotificationRef, {
      userId: input.targetUid,
      type: 'community.ownership.transfer_requested',
      title: 'Convite para assumir uma Comunidade',
      body:
        `${previousOwnerLabel} indicou você para assumir ${communityName}. `
        + 'A propriedade só muda se você aceitar.',
      route: ownershipWorkflowRoute(input.requestId),
      communityId: input.communityId,
      ownershipRequestId: input.requestId,
      actorUid: currentOwnerUid,
      actionRequired: true,
      responseDueAt: expiresAt,
      membershipCycleStartedAtMs: candidateMembershipCycleStartedAtMs,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    transaction.set(
      db.collection('community_membership_audit').doc(),
      {
        action: 'community_ownership_transfer_requested',
        communityId: input.communityId,
        actorUid: input.actorUid,
        previousOwnerUid: currentOwnerUid,
        candidateUid: input.targetUid,
        requestId: input.requestId,
        mode: input.mode,
        trigger: input.trigger,
        expiresAt,
        createdAt: now,
        source: 'callable',
      }
    );

    return {
      requestId: input.requestId,
      communityId: input.communityId,
      candidateUid: input.targetUid,
      status: 'pending',
      mode: input.mode,
      expiresAt,
      generatedAt: now,
    };
  });
}

async function requestCommunityOwnershipTransferCore(
  request: CallableRequest<OwnershipTransferRequestPayload>,
  actorUid: string
): Promise<CommunityOwnershipTransferRequestResponse> {
  const communityId = normalizeCommunityId(request.data?.communityId);
  const targetUid = normalizeSafeId(request.data?.targetUid);
  const requestId = normalizeSafeId(request.data?.requestId);

  if (!communityId || !targetUid || !requestId) {
    throw new HttpsError('invalid-argument', 'Transferência inválida.');
  }

  return createOwnershipOffer({
    actorUid,
    communityId,
    targetUid,
    requestId,
    mode: 'voluntary',
    trigger: 'owner_request',
  });
}

export const requestCommunityOwnershipTransfer =
  onCall<OwnershipTransferRequestPayload>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityOwnershipTransferRequestResponse> => {
      assertPreviewRuntime();
      assertCommunityCallableAppCheck(request.app);
      const actorUid = assertAuthenticatedUid(request.auth);
      assertRecentAuthentication(
        (request.auth?.token ?? undefined) as Record<string, unknown> | undefined
      );

      await consumeCommunityRateLimit({
        action: 'ownership_mutation',
        actorUid,
      });

      return requestCommunityOwnershipTransferCore(request, actorUid);
    }
  );

export const getMyCommunityOwnershipTransfers = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<OwnershipInboxResponse> => {
    assertPreviewRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    await assertCommunityMembershipActorEligibleForUid(actorUid);

    const [incomingSnapshot, outgoingSnapshot] = await Promise.all([
      db.collection(REQUEST_COLLECTION)
        .where('candidateUid', '==', actorUid)
        .where('status', '==', 'pending')
        .limit(MAX_INBOX_ITEMS)
        .get(),
      db.collection(REQUEST_COLLECTION)
        .where('previousOwnerUid', '==', actorUid)
        .where('status', '==', 'pending')
        .limit(MAX_INBOX_ITEMS)
        .get(),
    ]);
    const now = Date.now();

    const normalizeList = (
      docs: readonly FirebaseFirestore.QueryDocumentSnapshot[]
    ): OwnershipInboxItem[] => docs
      .map((doc) => requestDocumentToInboxItem(doc.data()))
      .filter((item): item is OwnershipInboxItem => !!item)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, MAX_INBOX_ITEMS);

    return {
      incoming: normalizeList(incomingSnapshot.docs),
      outgoing: normalizeList(outgoingSnapshot.docs),
      generatedAt: now,
    };
  }
);

export const respondCommunityOwnershipTransfer =
  onCall<OwnershipTransferResponsePayload>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityOwnershipTransferRespondResponse> => {
      assertPreviewRuntime();
      assertCommunityCallableAppCheck(request.app);
      const actorUid = assertAuthenticatedUid(request.auth);
      assertRecentAuthentication(
        (request.auth?.token ?? undefined) as Record<string, unknown> | undefined
      );
      const requestId = normalizeSafeId(request.data?.requestId);
      const action = request.data?.action === 'accept'
        || request.data?.action === 'decline'
        ? request.data.action
        : null;

      if (!requestId || !action) {
        throw new HttpsError('invalid-argument', 'Resposta de propriedade inválida.');
      }

      await consumeCommunityRateLimit({
        action: 'ownership_mutation',
        actorUid,
      });

      const now = Date.now();

      return db.runTransaction(async (transaction) => {
        const requestRef = db.collection(REQUEST_COLLECTION).doc(requestId);
        const requestSnapshot = await transaction.get(requestRef);

        if (!requestSnapshot.exists) {
          throw new HttpsError(
            'not-found',
            'Solicitação de propriedade não encontrada.',
            { reason: 'community_ownership_transfer_not_found' }
          );
        }

        const transfer = requestSnapshot.data() ?? {};
        const communityId = normalizeCommunityId(transfer['communityId']);
        const candidateUid = normalizeSafeId(transfer['candidateUid']);
        const previousOwnerUid = normalizeSafeId(transfer['previousOwnerUid']);
        const mode = normalizeMode(transfer['mode']);
        const expiresAt = normalizeEpoch(transfer['expiresAt']);
        const status = normalizeText(transfer['status'], 32);

        if (
          !communityId
          || !candidateUid
          || !previousOwnerUid
          || !mode
          || !expiresAt
        ) {
          throw new HttpsError(
            'data-loss',
            'A solicitação de propriedade está inconsistente.',
            { reason: 'community_ownership_idempotency_invalid' }
          );
        }

        if (candidateUid !== actorUid) {
          throw new HttpsError(
            'permission-denied',
            'Esta solicitação pertence a outro participante.',
            { reason: 'community_ownership_transfer_actor_mismatch' }
          );
        }

        if (status === 'completed' && action === 'accept') {
          return {
            requestId,
            communityId,
            status: 'completed',
            newOwnerUid: actorUid,
            generatedAt: now,
          };
        }
        if (status === 'declined' && action === 'decline') {
          return {
            requestId,
            communityId,
            status: 'declined',
            newOwnerUid: null,
            generatedAt: now,
          };
        }

        const communityRef = db.collection('communities').doc(communityId);
        const candidateMembershipRef = communityRef
          .collection('members')
          .doc(actorUid);
        const previousOwnerMembershipRef = communityRef
          .collection('members')
          .doc(previousOwnerUid);
        const candidateUserRef = db.collection('users').doc(actorUid);
        const previousOwnerUserRef = db.collection('users').doc(previousOwnerUid);
        const activeSlotRef = db.collection(ACTIVE_SLOT_COLLECTION).doc(communityId);
        const caseRef = db.collection(CASE_COLLECTION).doc(communityId);
        const ownerQuery = communityRef
          .collection('members')
          .where('role', '==', 'owner')
          .where('status', '==', 'active')
          .limit(2);
        const candidateIndexRef = db
          .collection('community_user_index')
          .doc(actorUid)
          .collection('items')
          .doc(communityId);
        const previousOwnerIndexRef = db
          .collection('community_user_index')
          .doc(previousOwnerUid)
          .collection('items')
          .doc(communityId);

        const [
          communitySnapshot,
          candidateMembershipSnapshot,
          previousOwnerMembershipSnapshot,
          candidateUserSnapshot,
          previousOwnerUserSnapshot,
          activeSlotSnapshot,
          caseSnapshot,
          ownerSnapshot,
        ] = await Promise.all([
          transaction.get(communityRef),
          transaction.get(candidateMembershipRef),
          transaction.get(previousOwnerMembershipRef),
          transaction.get(candidateUserRef),
          transaction.get(previousOwnerUserRef),
          transaction.get(activeSlotRef),
          transaction.get(caseRef),
          transaction.get(ownerQuery),
        ]);

        if (!communitySnapshot.exists) {
          throw new HttpsError(
            'not-found',
            'Comunidade não encontrada.',
            { reason: 'community_not_found' }
          );
        }

        const community = (communitySnapshot.data() ?? {}) as Record<string, unknown>;
        const candidateMembership = candidateMembershipSnapshot.exists
          ? candidateMembershipSnapshot.data() ?? {}
          : {};
        const previousOwnerMembership = previousOwnerMembershipSnapshot.exists
          ? previousOwnerMembershipSnapshot.data() ?? {}
          : {};
        const candidateUser = candidateUserSnapshot.exists
          ? candidateUserSnapshot.data() ?? {}
          : null;
        const previousOwnerUser = previousOwnerUserSnapshot.exists
          ? previousOwnerUserSnapshot.data() ?? {}
          : null;
        const ownerUidSnapshot = normalizeSafeId(transfer['ownerUidSnapshot']);
        const ownerTransferredAtSnapshot =
          normalizeEpoch(transfer['ownerTransferredAtSnapshot']);
        const currentOwnerUid = normalizeSafeId(community['ownerUid']);
        const currentOwnerTransferredAt =
          normalizeEpoch(community['ownerTransferredAt']);
        const ownerSnapshotMatches =
          currentOwnerUid === ownerUidSnapshot
          && currentOwnerTransferredAt === ownerTransferredAtSnapshot;

        if (isCommunityOwnershipTransferExpired(status, expiresAt, now)) {
          transaction.set(requestRef, {
            status: 'expired',
            resolvedAt: now,
            updatedAt: now,
          }, { merge: true });
          if (
            activeSlotSnapshot.exists
            && activeSlotSnapshot.data()?.['requestId'] === requestId
          ) {
            transaction.delete(activeSlotRef);
          }
          if (
            mode === 'terminal_succession'
            && caseSnapshot.exists
            && caseSnapshot.data()?.['activeRequestId'] === requestId
          ) {
            transaction.set(caseRef, {
              activeRequestId: null,
              updatedAt: now,
            }, { merge: true });
          }

          return {
            requestId,
            communityId,
            status: 'expired',
            newOwnerUid: null,
            generatedAt: now,
          };
        }

        if (!isCommunityOwnershipTransferPending(status, expiresAt, now)) {
          throw new HttpsError(
            'failed-precondition',
            'Esta solicitação de propriedade já foi encerrada.',
            { reason: 'community_ownership_transfer_expired' }
          );
        }

        const requestNotificationRef = db.collection('notifications').doc(
          notificationId(requestId, actorUid, 'requested')
        );

        if (action === 'decline') {
          transaction.set(requestRef, {
            status: 'declined',
            explicitlyAccepted: false,
            respondedAt: now,
            resolvedAt: now,
            updatedAt: now,
          }, { merge: true });
          if (
            activeSlotSnapshot.exists
            && activeSlotSnapshot.data()?.['requestId'] === requestId
          ) {
            transaction.delete(activeSlotRef);
          }
          if (
            mode === 'terminal_succession'
            && caseSnapshot.exists
            && caseSnapshot.data()?.['activeRequestId'] === requestId
          ) {
            transaction.set(caseRef, {
              activeRequestId: null,
              lastDeclinedCandidateUid: actorUid,
              lastDeclinedAt: now,
              updatedAt: now,
            }, { merge: true });
          }
          transaction.set(requestNotificationRef, {
            readAt: FieldValue.serverTimestamp(),
            resolvedAt: FieldValue.serverTimestamp(),
            resolution: 'declined',
            actionRequired: false,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });

          if (
            canReceiveCommunityEssentialNotification(
              previousOwnerUser as CommunityNotificationUser | undefined,
              previousOwnerUid,
              actorUid
            )
          ) {
            transaction.set(
              db.collection('notifications').doc(
                notificationId(requestId, previousOwnerUid, 'declined')
              ),
              {
                userId: previousOwnerUid,
                type: 'community.ownership.transfer_declined',
                title: 'Transferência de propriedade recusada',
                body:
                  `${labelForUser(candidateUser)} recusou assumir `
                  + `${normalizeText(community['name'], 80) || 'a Comunidade'}.`,
                route: ownershipWorkflowRoute(requestId),
                communityId,
                ownershipRequestId: requestId,
                actorUid,
                actionRequired: mode === 'terminal_succession',
                membershipCycleStartedAtMs:
                  resolveCommunityNotificationMembershipCycleStartedAtMs(
                    previousOwnerMembership
                  ),
                readAt: null,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }

          transaction.set(
            db.collection('community_membership_audit').doc(),
            {
              action: 'community_ownership_transfer_declined',
              communityId,
              requestId,
              actorUid,
              previousOwnerUid,
              mode,
              createdAt: now,
              source: 'callable',
            }
          );

          return {
            requestId,
            communityId,
            status: 'declined',
            newOwnerUid: null,
            generatedAt: now,
          };
        }

        const eligibility = await resolveCandidateEligibilityInTransaction({
          transaction,
          community,
          candidateUid: actorUid,
          candidateMembership,
          candidateUser,
        });
        assertCandidateEligibility(eligibility);

        const source = (community['source'] ?? {}) as Record<string, unknown>;
        const currentStatus = normalizeCommunityStatus(community['status']);
        const rawCurrentStatus = String(community['status'] ?? '').trim();

        if (
          normalizeSourceType(source['type']) !== 'community'
          || !isCommunityStatusAvailableForOwnershipWorkflow(
            rawCurrentStatus,
            mode
          )
        ) {
          throw new HttpsError(
            'failed-precondition',
            'Esta Comunidade não pode concluir a transferência agora.',
            { reason: 'community_unavailable' }
          );
        }

        if (mode === 'voluntary') {
          if (!currentStatus) {
            throw new HttpsError(
              'failed-precondition',
              'A Comunidade não pode concluir a transferência agora.',
              { reason: 'community_unavailable' }
            );
          }

          const transferDecision = evaluateCommunityOwnershipTransfer({
            sourceType: 'community',
            communityStatus: currentStatus,
            actorUid: previousOwnerUid,
            targetUid: actorUid,
            actorStatus: normalizeMembershipStatus(
              previousOwnerMembership['status']
            ),
            actorRole: normalizeMembershipRole(previousOwnerMembership['role']),
            targetStatus: normalizeMembershipStatus(candidateMembership['status']),
            targetRole: normalizeMembershipRole(candidateMembership['role']),
            targetAccountEligible: eligibility.accountEligible,
            targetOwnershipEntitlementEligible:
              eligibility.ownershipEntitlementEligible,
            targetOwnershipQuotaAvailable:
              eligibility.ownershipQuotaAvailable,
            targetOwnershipCapacityCompatible:
              eligibility.ownershipCapacityCompatible,
            activeOwnerCount: ownerSnapshot.size,
          });

          if (!transferDecision.allowed) {
            throw new HttpsError(
              'failed-precondition',
              'A autoridade do proprietário mudou antes do aceite.',
              { reason: 'community_ownership_transfer_conflict' }
            );
          }
        } else {
          const caseData = caseSnapshot.exists ? caseSnapshot.data() ?? {} : {};
          const caseDeadlineAt = normalizeEpoch(caseData['deadlineAt']);
          const successionDecision = evaluateCommunityOwnerSuccession({
            trigger:
              normalizeTerminalTrigger(caseData['trigger'])
              ?? 'owner_terminally_unavailable',
            candidate: {
              explicitlyDesignated: transfer['explicitlyDesignated'] === true,
              explicitlyAccepted: true,
              membershipActive: eligibility.membershipActive,
              accountEligible: eligibility.accountEligible,
              ownershipEntitlementEligible:
                eligibility.ownershipEntitlementEligible,
              ownershipQuotaAvailable: eligibility.ownershipQuotaAvailable,
              ownershipCapacityCompatible:
                eligibility.ownershipCapacityCompatible,
            },
            resolutionWindowExpired:
              !caseDeadlineAt || caseDeadlineAt <= now,
          });

          if (
            successionDecision.state !== 'transfer_ready'
            || !ownerSnapshotMatches
          ) {
            throw new HttpsError(
              'failed-precondition',
              'A sucessão não pode ser concluída neste estado.',
              { reason: 'community_ownership_transfer_conflict' }
            );
          }
        }

        if (!canAcceptCommunityOwnershipTransfer({
          requestStatus: status,
          expiresAt,
          now,
          candidateMatches: candidateUid === actorUid,
          ownerSnapshotMatches,
          membershipActive: eligibility.membershipActive,
          accountEligible: eligibility.accountEligible,
          ownershipEntitlementEligible:
            eligibility.ownershipEntitlementEligible,
          ownershipQuotaAvailable: eligibility.ownershipQuotaAvailable,
          ownershipCapacityCompatible:
            eligibility.ownershipCapacityCompatible,
        })) {
          throw new HttpsError(
            'failed-precondition',
            'A transferência não pode ser aceita neste estado.',
            { reason: 'community_ownership_transfer_conflict' }
          );
        }

        await stopOpenCommunityBoostForCommunityInTransaction({
          transaction,
          communityId,
          reason: 'community_ownership_transferred',
          now,
          actorUid,
        });

        const communityName =
          normalizeText(community['name'], 80) || 'Comunidade';
        const currentCandidateRevision =
          Number.isSafeInteger(candidateUser?.['communityCreationRevision'])
          && Number(candidateUser?.['communityCreationRevision']) >= 0
            ? Number(candidateUser?.['communityCreationRevision'])
            : 0;
        const previousOwnerNextStatus =
          mode === 'terminal_succession' ? 'left' : 'active';

        transaction.update(candidateUserRef, {
          communityCreationRevision: currentCandidateRevision + 1,
          communityLastOwnershipReceivedAt: now,
        });
        transaction.update(communityRef, {
          ownerUid: actorUid,
          ownerTransferredAt: now,
          ownerTransferredBy: actorUid,
          ownershipSuccession: FieldValue.delete(),
          updatedAt: now,
        });
        if (previousOwnerMembershipSnapshot.exists) {
          transaction.set(previousOwnerMembershipRef, {
            role: 'member',
            status: previousOwnerNextStatus,
            ownershipTransferredAt: now,
            ownershipTransferredTo: actorUid,
            ...(mode === 'terminal_succession' ? { leftAt: now } : {}),
            updatedAt: now,
            source: mode === 'terminal_succession'
              ? 'terminal-ownership-succession'
              : 'ownership-transfer-accepted',
          }, { merge: true });
        }
        transaction.set(candidateMembershipRef, {
          role: 'owner',
          status: 'active',
          ownershipReceivedAt: now,
          ownershipReceivedFrom: previousOwnerUid,
          reviewedAt: now,
          reviewedBy: actorUid,
          updatedAt: now,
          source: mode === 'terminal_succession'
            ? 'terminal-ownership-succession'
            : 'ownership-transfer-accepted',
        }, { merge: true });
        transaction.set(candidateIndexRef, {
          communityId,
          name: communityName,
          source,
          role: 'owner',
          status: 'active',
          updatedAt: now,
        }, { merge: true });

        if (mode === 'terminal_succession') {
          transaction.delete(previousOwnerIndexRef);
        } else {
          transaction.set(previousOwnerIndexRef, {
            communityId,
            name: communityName,
            source,
            role: 'member',
            status: 'active',
            updatedAt: now,
          }, { merge: true });
        }

        transaction.set(requestRef, {
          status: 'completed',
          explicitlyAccepted: true,
          respondedAt: now,
          completedAt: now,
          resolvedAt: now,
          updatedAt: now,
        }, { merge: true });
        if (
          activeSlotSnapshot.exists
          && activeSlotSnapshot.data()?.['requestId'] === requestId
        ) {
          transaction.delete(activeSlotRef);
        }
        if (mode === 'terminal_succession' && caseSnapshot.exists) {
          transaction.set(caseRef, {
            status: 'completed',
            activeRequestId: null,
            completedAt: now,
            completedByUid: actorUid,
            newOwnerUid: actorUid,
            updatedAt: now,
          }, { merge: true });
        }

        transaction.set(requestNotificationRef, {
          readAt: FieldValue.serverTimestamp(),
          resolvedAt: FieldValue.serverTimestamp(),
          resolution: 'accepted',
          actionRequired: false,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        const candidateMembershipCycleStartedAtMs =
          resolveCommunityNotificationMembershipCycleStartedAtMs(
            candidateMembership
          );
        transaction.set(
          db.collection('notifications').doc(
            notificationId(requestId, actorUid, 'accepted-candidate')
          ),
          {
            userId: actorUid,
            type: 'community.ownership.transfer_accepted',
            title: 'Você agora é o proprietário',
            body: `A transferência de ${communityName} foi concluída.`,
            route: `/dashboard/comunidades/${encodeURIComponent(communityId)}`,
            communityId,
            ownershipRequestId: requestId,
            actorUid: previousOwnerUid,
            actionRequired: false,
            membershipCycleStartedAtMs:
              candidateMembershipCycleStartedAtMs,
            readAt: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        if (
          canReceiveCommunityEssentialNotification(
            previousOwnerUser as CommunityNotificationUser | undefined,
            previousOwnerUid,
            actorUid
          )
        ) {
          transaction.set(
            db.collection('notifications').doc(
              notificationId(requestId, previousOwnerUid, 'accepted-owner')
            ),
            {
              userId: previousOwnerUid,
              type: 'community.ownership.transfer_accepted',
              title: 'Transferência de propriedade concluída',
              body:
                `${labelForUser(candidateUser)} assumiu a propriedade de `
                + `${communityName}.`,
              route: `/dashboard/comunidades/${encodeURIComponent(communityId)}`,
              communityId,
              ownershipRequestId: requestId,
              actorUid,
              actionRequired: false,
              membershipCycleStartedAtMs:
                resolveCommunityNotificationMembershipCycleStartedAtMs(
                  previousOwnerMembership
                ),
              readAt: null,
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }

        transaction.set(
          db.collection('community_membership_audit').doc(),
          {
            action: 'community_ownership_transfer_completed',
            communityId,
            requestId,
            actorUid,
            previousOwnerUid,
            nextOwnerUid: actorUid,
            mode,
            candidateSponsorRole: eligibility.sponsorRole,
            candidateOwnedCommunitiesBefore:
              eligibility.currentOwnedCommunities,
            candidateMaxOwnedCommunities:
              eligibility.maxOwnedCommunities,
            communityConfiguredMemberLimit:
              eligibility.configuredMemberLimit,
            createdAt: now,
            source: 'callable',
          }
        );

        return {
          requestId,
          communityId,
          status: 'completed',
          newOwnerUid: actorUid,
          generatedAt: now,
        };
      });
    }
  );

export const cancelCommunityOwnershipTransfer =
  onCall<OwnershipTransferCancelPayload>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityOwnershipTransferCancelResponse> => {
      assertPreviewRuntime();
      assertCommunityCallableAppCheck(request.app);
      const actorUid = assertAuthenticatedUid(request.auth);
      assertRecentAuthentication(
        (request.auth?.token ?? undefined) as Record<string, unknown> | undefined
      );
      const requestId = normalizeSafeId(request.data?.requestId);
      if (!requestId) {
        throw new HttpsError('invalid-argument', 'Solicitação inválida.');
      }

      const now = Date.now();

      return db.runTransaction(async (transaction) => {
        const requestRef = db.collection(REQUEST_COLLECTION).doc(requestId);
        const requestSnapshot = await transaction.get(requestRef);
        if (!requestSnapshot.exists) {
          throw new HttpsError(
            'not-found',
            'Solicitação não encontrada.',
            { reason: 'community_ownership_transfer_not_found' }
          );
        }

        const transfer = requestSnapshot.data() ?? {};
        const communityId = normalizeCommunityId(transfer['communityId']);
        const previousOwnerUid = normalizeSafeId(transfer['previousOwnerUid']);
        const candidateUid = normalizeSafeId(transfer['candidateUid']);
        const expiresAt = normalizeEpoch(transfer['expiresAt']);
        const mode = normalizeMode(transfer['mode']);
        const status = normalizeText(transfer['status'], 32);

        if (
          !communityId
          || !previousOwnerUid
          || !candidateUid
          || !expiresAt
          || !mode
        ) {
          throw new HttpsError(
            'data-loss',
            'A solicitação está inconsistente.',
            { reason: 'community_ownership_idempotency_invalid' }
          );
        }

        if (previousOwnerUid !== actorUid || mode !== 'voluntary') {
          throw new HttpsError(
            'permission-denied',
            'Somente o proprietário que iniciou a oferta pode cancelá-la.',
            { reason: 'owner_required' }
          );
        }

        if (status === 'canceled') {
          return {
            requestId,
            communityId,
            status: 'canceled',
            generatedAt: now,
          };
        }

        const activeSlotRef = db.collection(ACTIVE_SLOT_COLLECTION).doc(communityId);
        const candidateUserRef = db.collection('users').doc(candidateUid);
        const candidateMembershipRef = db
          .collection('communities')
          .doc(communityId)
          .collection('members')
          .doc(candidateUid);
        const [
          activeSlotSnapshot,
          candidateUserSnapshot,
          candidateMembershipSnapshot,
        ] = await Promise.all([
          transaction.get(activeSlotRef),
          transaction.get(candidateUserRef),
          transaction.get(candidateMembershipRef),
        ]);

        if (isCommunityOwnershipTransferExpired(status, expiresAt, now)) {
          transaction.set(requestRef, {
            status: 'expired',
            resolvedAt: now,
            updatedAt: now,
          }, { merge: true });
          if (
            activeSlotSnapshot.exists
            && activeSlotSnapshot.data()?.['requestId'] === requestId
          ) {
            transaction.delete(activeSlotRef);
          }
          return {
            requestId,
            communityId,
            status: 'expired',
            generatedAt: now,
          };
        }

        if (status !== 'pending') {
          throw new HttpsError(
            'failed-precondition',
            'Esta solicitação já foi encerrada.',
            { reason: 'community_ownership_transfer_expired' }
          );
        }

        transaction.set(requestRef, {
          status: 'canceled',
          resolvedAt: now,
          updatedAt: now,
        }, { merge: true });
        if (
          activeSlotSnapshot.exists
          && activeSlotSnapshot.data()?.['requestId'] === requestId
        ) {
          transaction.delete(activeSlotRef);
        }
        transaction.set(
          db.collection('notifications').doc(
            notificationId(requestId, candidateUid, 'requested')
          ),
          {
            readAt: FieldValue.serverTimestamp(),
            resolvedAt: FieldValue.serverTimestamp(),
            resolution: 'canceled',
            actionRequired: false,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        if (
          canReceiveCommunityEssentialNotification(
            candidateUserSnapshot.exists
              ? candidateUserSnapshot.data() as CommunityNotificationUser
              : undefined,
            candidateUid,
            actorUid
          )
        ) {
          transaction.set(
            db.collection('notifications').doc(
              notificationId(requestId, candidateUid, 'canceled')
            ),
            {
              userId: candidateUid,
              type: 'community.ownership.transfer_canceled',
              title: 'Transferência cancelada',
              body: 'A oferta para assumir a Comunidade foi cancelada.',
              route: ownershipWorkflowRoute(requestId),
              communityId,
              ownershipRequestId: requestId,
              actorUid,
              actionRequired: false,
              membershipCycleStartedAtMs:
                resolveCommunityNotificationMembershipCycleStartedAtMs(
                  candidateMembershipSnapshot.exists
                    ? candidateMembershipSnapshot.data()
                    : null
                ),
              readAt: null,
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }

        transaction.set(
          db.collection('community_membership_audit').doc(),
          {
            action: 'community_ownership_transfer_canceled',
            communityId,
            requestId,
            actorUid,
            candidateUid,
            createdAt: now,
            source: 'callable',
          }
        );

        return {
          requestId,
          communityId,
          status: 'canceled',
          generatedAt: now,
        };
      });
    }
  );

export const openCommunityOwnerTerminalSuccessionCase =
  onCall<TerminalSuccessionCasePayload>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<{
      communityId: string;
      status: 'open';
      previousOwnerUid: string;
      deadlineAt: number;
      generatedAt: number;
    }> => {
      assertPreviewRuntime();
      assertCommunityCallableAppCheck(request.app);
      const actorUid = assertAuthenticatedUid(request.auth);
      assertRecentAuthentication(
        (request.auth?.token ?? undefined) as Record<string, unknown> | undefined
      );
      await assertStaffAuthorization({
        actorUid,
        authToken:
          (request.auth?.token ?? undefined) as Record<string, unknown> | undefined,
        requiredPermission: 'users:delete',
      });
      await consumeCommunityRateLimit({
        action: 'ownership_mutation',
        actorUid,
      });

      const communityId = normalizeCommunityId(request.data?.communityId);
      const trigger = normalizeTerminalTrigger(request.data?.trigger);
      if (!communityId || !trigger) {
        throw new HttpsError('invalid-argument', 'Caso de sucessão inválido.');
      }

      const now = Date.now();
      const caseRef = db.collection(CASE_COLLECTION).doc(communityId);

      return db.runTransaction(async (transaction) => {
        const communityRef = db.collection('communities').doc(communityId);
        const [caseSnapshot, communitySnapshot] = await Promise.all([
          transaction.get(caseRef),
          transaction.get(communityRef),
        ]);

        if (!communitySnapshot.exists) {
          throw new HttpsError(
            'not-found',
            'Comunidade não encontrada.',
            { reason: 'community_not_found' }
          );
        }

        const community = communitySnapshot.data() ?? {};
        const previousOwnerUid = normalizeSafeId(community['ownerUid']);
        const source = (community['source'] ?? {}) as Record<string, unknown>;
        const status = String(community['status'] ?? '').trim();

        if (
          !previousOwnerUid
          || normalizeSourceType(source['type']) !== 'community'
          || !['active', 'paused', 'dormant'].includes(status)
        ) {
          throw new HttpsError(
            'failed-precondition',
            'A Comunidade não pode abrir sucessão terminal neste estado.',
            { reason: 'community_unavailable' }
          );
        }

        if (caseSnapshot.exists) {
          const existing = caseSnapshot.data() ?? {};
          const existingDeadlineAt = normalizeEpoch(existing['deadlineAt']);
          if (
            existing['status'] === 'open'
            && existingDeadlineAt
            && existingDeadlineAt > now
          ) {
            return {
              communityId,
              status: 'open' as const,
              previousOwnerUid:
                normalizeSafeId(existing['previousOwnerUid'])
                ?? previousOwnerUid,
              deadlineAt: existingDeadlineAt,
              generatedAt: now,
            };
          }

          throw new HttpsError(
            'failed-precondition',
            'Este caso de sucessão já foi encerrado.',
            { reason: 'community_ownership_succession_closed' }
          );
        }

        const deadlineAt =
          now + COMMUNITY_OWNER_TERMINAL_SUCCESSION_WINDOW_MS;

        transaction.set(caseRef, {
          policyVersion: COMMUNITY_OWNERSHIP_WORKFLOW_POLICY_VERSION,
          communityId,
          previousOwnerUid,
          trigger,
          status: 'open',
          activeRequestId: null,
          openedByUid: actorUid,
          openedAt: now,
          deadlineAt,
          updatedAt: now,
        });
        transaction.set(communityRef, {
          ownershipSuccession: {
            state: 'open',
            mode: 'terminal_succession',
            trigger,
            previousOwnerUid,
            openedAt: now,
            deadlineAt,
            updatedAt: now,
          },
          updatedAt: now,
        }, { merge: true });
        transaction.set(
          db.collection('community_membership_audit').doc(),
          {
            action: 'community_owner_terminal_succession_opened',
            communityId,
            actorUid,
            previousOwnerUid,
            trigger,
            deadlineAt,
            createdAt: now,
            source: 'staff-callable',
          }
        );

        return {
          communityId,
          status: 'open' as const,
          previousOwnerUid,
          deadlineAt,
          generatedAt: now,
        };
      });
    }
  );

export const nominateCommunityOwnerTerminalSuccessor =
  onCall<TerminalSuccessionNominationPayload>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityOwnershipTransferRequestResponse> => {
      assertPreviewRuntime();
      assertCommunityCallableAppCheck(request.app);
      const actorUid = assertAuthenticatedUid(request.auth);
      assertRecentAuthentication(
        (request.auth?.token ?? undefined) as Record<string, unknown> | undefined
      );
      await assertStaffAuthorization({
        actorUid,
        authToken:
          (request.auth?.token ?? undefined) as Record<string, unknown> | undefined,
        requiredPermission: 'users:delete',
      });
      await consumeCommunityRateLimit({
        action: 'ownership_mutation',
        actorUid,
      });

      const communityId = normalizeCommunityId(request.data?.communityId);
      const targetUid = normalizeSafeId(request.data?.targetUid);
      const requestId = normalizeSafeId(request.data?.requestId);
      if (!communityId || !targetUid || !requestId) {
        throw new HttpsError('invalid-argument', 'Indicação de sucessor inválida.');
      }

      const caseSnapshot = await db.collection(CASE_COLLECTION).doc(communityId).get();
      if (!caseSnapshot.exists) {
        throw new HttpsError(
          'failed-precondition',
          'Abra o caso de sucessão antes de indicar um sucessor.',
          { reason: 'community_ownership_succession_closed' }
        );
      }

      const successionCase = caseSnapshot.data() ?? {};
      const previousOwnerUid = normalizeSafeId(successionCase['previousOwnerUid']);
      const deadlineAt = normalizeEpoch(successionCase['deadlineAt']);
      const trigger = normalizeTerminalTrigger(successionCase['trigger']);

      if (
        successionCase['status'] !== 'open'
        || !previousOwnerUid
        || !deadlineAt
        || deadlineAt <= Date.now()
        || !trigger
      ) {
        throw new HttpsError(
          'failed-precondition',
          'O caso de sucessão não está mais aberto.',
          { reason: 'community_ownership_succession_closed' }
        );
      }

      return createOwnershipOffer({
        actorUid: previousOwnerUid,
        communityId,
        targetUid,
        requestId,
        mode: 'terminal_succession',
        trigger,
        terminalDeadlineAt: deadlineAt,
      });
    }
  );

export const cancelCommunityOwnerTerminalSuccession =
  onCall<TerminalSuccessionCancelPayload>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<{
      communityId: string;
      status: 'canceled';
      generatedAt: number;
    }> => {
      assertPreviewRuntime();
      assertCommunityCallableAppCheck(request.app);
      const actorUid = assertAuthenticatedUid(request.auth);
      assertRecentAuthentication(
        (request.auth?.token ?? undefined) as Record<string, unknown> | undefined
      );
      await assertStaffAuthorization({
        actorUid,
        authToken:
          (request.auth?.token ?? undefined) as Record<string, unknown> | undefined,
        requiredPermission: 'users:delete',
      });
      await consumeCommunityRateLimit({
        action: 'ownership_mutation',
        actorUid,
      });

      const communityId = normalizeCommunityId(request.data?.communityId);
      const reason = normalizeText(request.data?.reason, 240) || null;
      if (!communityId) {
        throw new HttpsError('invalid-argument', 'Caso de sucessão inválido.');
      }

      const now = Date.now();

      return db.runTransaction(async (transaction) => {
        const caseRef = db.collection(CASE_COLLECTION).doc(communityId);
        const communityRef = db.collection('communities').doc(communityId);
        const activeSlotRef = db
          .collection(ACTIVE_SLOT_COLLECTION)
          .doc(communityId);
        const [caseSnapshot, communitySnapshot, activeSlotSnapshot] =
          await Promise.all([
            transaction.get(caseRef),
            transaction.get(communityRef),
            transaction.get(activeSlotRef),
          ]);

        if (!caseSnapshot.exists || caseSnapshot.data()?.['status'] !== 'open') {
          throw new HttpsError(
            'failed-precondition',
            'O caso de sucessão não está aberto.',
            { reason: 'community_ownership_succession_closed' }
          );
        }

        let activeRequestRef: FirebaseFirestore.DocumentReference | null = null;
        let activeRequestSnapshot: FirebaseFirestore.DocumentSnapshot | null = null;
        const activeRequestId = activeSlotSnapshot.exists
          ? normalizeSafeId(activeSlotSnapshot.data()?.['requestId'])
          : null;

        if (activeRequestId) {
          activeRequestRef = db.collection(REQUEST_COLLECTION).doc(activeRequestId);
          activeRequestSnapshot = await transaction.get(activeRequestRef);
        }

        if (activeRequestRef && activeRequestSnapshot?.exists) {
          transaction.set(activeRequestRef, {
            status: 'canceled',
            resolvedAt: now,
            updatedAt: now,
          }, { merge: true });

          const candidateUid = normalizeSafeId(
            activeRequestSnapshot.data()?.['candidateUid']
          );
          if (candidateUid) {
            transaction.set(
              db.collection('notifications').doc(
                notificationId(activeRequestId ?? '', candidateUid, 'requested')
              ),
              {
                actionRequired: false,
                resolvedAt: FieldValue.serverTimestamp(),
                resolution: 'canceled',
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
        }

        if (activeSlotSnapshot.exists) {
          transaction.delete(activeSlotRef);
        }

        transaction.set(caseRef, {
          status: 'canceled',
          activeRequestId: null,
          canceledAt: now,
          canceledByUid: actorUid,
          cancelReason: reason,
          updatedAt: now,
        }, { merge: true });

        if (communitySnapshot.exists) {
          transaction.set(communityRef, {
            ownershipSuccession: FieldValue.delete(),
            updatedAt: now,
          }, { merge: true });
        }

        transaction.set(
          db.collection('community_membership_audit').doc(),
          {
            action: 'community_owner_terminal_succession_canceled',
            communityId,
            actorUid,
            reason,
            createdAt: now,
            source: 'staff-callable',
          }
        );

        return {
          communityId,
          status: 'canceled' as const,
          generatedAt: now,
        };
      });
    }
  );
