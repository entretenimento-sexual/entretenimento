// functions/src/account_lifecycle/account-data-deletion.executor.ts
// -----------------------------------------------------------------------------
// ACCOUNT DATA DELETION EXECUTOR
// -----------------------------------------------------------------------------
// Orquestra os domínios automatizados da matriz de retenção.
//
// Garantias:
// - paginação limitada por execução para preservar timeout e memória;
// - idempotência: todas as operações podem ser repetidas;
// - falha isolada por domínio;
// - nenhuma mensagem, mídia, denúncia ou registro financeiro é apagado aqui;
// - owners de Comunidades, owners de Salas ativas e bloqueios permanecem bloqueadores.
// -----------------------------------------------------------------------------
import type { AccountDataDomain } from './account-data-retention.policy';

export type NotificationReferenceDirection = 'recipient' | 'actor';
export type FriendRequestDirection = 'requester' | 'target';
export type RoomInviteDirection = 'sender' | 'receiver';

export interface AccountBlockReferenceSummary {
  owned: number;
  inbound: number;
}

export interface RoomParticipationPageSummary {
  scanned: number;
  processed: number;
  blockingOwners: number;
}

export interface AccountDataDeletionAdapter {
  deleteNotificationsPage(
    uid: string,
    direction: NotificationReferenceDirection,
    limit: number
  ): Promise<number>;
  deletePreferences(uid: string): Promise<number>;
  deletePresence(uid: string): Promise<number>;
  clearPrivateLocation(uid: string): Promise<number>;
  deleteUserIntentStatusesPage(uid: string, limit: number): Promise<number>;
  deleteUserIntentStatusAuditPage(uid: string, limit: number): Promise<number>;
  deleteFriendRequestsPage(
    uid: string,
    direction: FriendRequestDirection,
    limit: number
  ): Promise<number>;
  unlinkCommunityMembershipsPage(uid: string, limit: number): Promise<number>;
  inspectOwnedCommunityMemberships(uid: string): Promise<number>;
  deleteRoomInvitesPage(
    uid: string,
    direction: RoomInviteDirection,
    limit: number
  ): Promise<number>;
  unlinkRoomParticipationsPage(
    uid: string,
    limit: number
  ): Promise<RoomParticipationPageSummary>;
  unlinkRoomMembershipsPage(
    uid: string,
    limit: number
  ): Promise<RoomParticipationPageSummary>;
  deleteRoomParticipantDocumentsPage(
    uid: string,
    limit: number
  ): Promise<RoomParticipationPageSummary>;
  resolveOwnedRoomReferencesPage(
    uid: string,
    limit: number
  ): Promise<RoomParticipationPageSummary>;
  anonymizeRoomAuditPage(uid: string, limit: number): Promise<number>;
  clearPrivateRoomReferences(uid: string): Promise<number>;
  unlinkOwnedFriendshipsPage(uid: string, limit: number): Promise<number>;
  deleteInboundFriendshipReferencesPage(
    uid: string,
    limit: number
  ): Promise<number>;
  inspectBlockReferences(uid: string): Promise<AccountBlockReferenceSummary>;
}

export type AccountDataDeletionExecutionStatus =
  | 'completed'
  | 'partial'
  | 'blocked'
  | 'failed';

export interface AccountDataDeletionDomainExecution {
  domain: AccountDataDomain;
  status: AccountDataDeletionExecutionStatus;
  processed: number;
  pages: number;
  blocker?: string;
  errorCode?: string;
  details?: Record<string, number | string | boolean | null>;
}

export interface AccountDataDeletionExecutionSummary {
  uid: string;
  generatedAt: number;
  completedDomains: AccountDataDomain[];
  results: AccountDataDeletionDomainExecution[];
}

export interface ExecuteAccountDataDeletionInput {
  uid: string;
  generatedAt: number;
  pageSize?: number;
  maxPagesPerDomain?: number;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const DEFAULT_MAX_PAGES_PER_DOMAIN = 10;
const MAX_PAGES_PER_DOMAIN = 25;

interface PagedExecutionResult {
  completed: boolean;
  processed: number;
  pages: number;
}

interface RoomPagedExecutionResult extends PagedExecutionResult {
  blockingOwners: number;
}

export async function executeAccountDataDeletionDomains(
  adapter: AccountDataDeletionAdapter,
  input: ExecuteAccountDataDeletionInput
): Promise<AccountDataDeletionExecutionSummary> {
  const uid = normalizeUid(input.uid);
  const generatedAt = normalizeEpoch(input.generatedAt);
  const pageSize = normalizeInteger(
    input.pageSize,
    DEFAULT_PAGE_SIZE,
    1,
    MAX_PAGE_SIZE
  );
  const maxPagesPerDomain = normalizeInteger(
    input.maxPagesPerDomain,
    DEFAULT_MAX_PAGES_PER_DOMAIN,
    1,
    MAX_PAGES_PER_DOMAIN
  );

  if (!uid) {
    throw new Error('UID inválido para execução do plano de exclusão.');
  }

  const results: AccountDataDeletionDomainExecution[] = [];

  results.push(
    await executeNotificationsDomain(
      adapter,
      uid,
      pageSize,
      maxPagesPerDomain
    )
  );

  results.push(await executePreferencesDomain(adapter, uid));

  results.push(
    await executePresenceAndLocationDomain(
      adapter,
      uid,
      pageSize,
      maxPagesPerDomain
    )
  );

  results.push(
    await executeFriendRequestsDomain(
      adapter,
      uid,
      pageSize,
      maxPagesPerDomain
    )
  );

  results.push(
    await executeCommunityMembershipsDomain(
      adapter,
      uid,
      pageSize,
      maxPagesPerDomain
    )
  );

  results.push(
    await executeRoomParticipationDomain(
      adapter,
      uid,
      pageSize,
      maxPagesPerDomain
    )
  );

  results.push(
    await executeRelationshipEdgesDomain(
      adapter,
      uid,
      pageSize,
      maxPagesPerDomain
    )
  );

  return {
    uid,
    generatedAt,
    completedDomains: results
      .filter((result) => result.status === 'completed')
      .map((result) => result.domain),
    results,
  };
}

async function executeNotificationsDomain(
  adapter: AccountDataDeletionAdapter,
  uid: string,
  pageSize: number,
  maxPages: number
): Promise<AccountDataDeletionDomainExecution> {
  try {
    const recipient = await executePagedStep(
      () => adapter.deleteNotificationsPage(uid, 'recipient', pageSize),
      pageSize,
      maxPages
    );
    const actor = await executePagedStep(
      () => adapter.deleteNotificationsPage(uid, 'actor', pageSize),
      pageSize,
      maxPages
    );
    const completed = recipient.completed && actor.completed;

    return {
      domain: 'notifications',
      status: completed ? 'completed' : 'partial',
      processed: recipient.processed + actor.processed,
      pages: recipient.pages + actor.pages,
      ...(completed ? {} : { blocker: 'pagination-limit-reached' }),
      details: {
        recipientNotificationsProcessed: recipient.processed,
        actorNotificationsProcessed: actor.processed,
      },
    };
  } catch (error: unknown) {
    return failedResult('notifications', error);
  }
}

async function executePreferencesDomain(
  adapter: AccountDataDeletionAdapter,
  uid: string
): Promise<AccountDataDeletionDomainExecution> {
  try {
    const processed = await adapter.deletePreferences(uid);
    return {
      domain: 'preferences',
      status: 'completed',
      processed: normalizeProcessedCount(processed),
      pages: 1,
    };
  } catch (error: unknown) {
    return failedResult('preferences', error);
  }
}

async function executePresenceAndLocationDomain(
  adapter: AccountDataDeletionAdapter,
  uid: string,
  pageSize: number,
  maxPages: number
): Promise<AccountDataDeletionDomainExecution> {
  try {
    const presenceProcessed = normalizeProcessedCount(
      await adapter.deletePresence(uid)
    );
    const privateLocationProcessed = normalizeProcessedCount(
      await adapter.clearPrivateLocation(uid)
    );
    const statuses = await executePagedStep(
      () => adapter.deleteUserIntentStatusesPage(uid, pageSize),
      pageSize,
      maxPages
    );
    const statusAudit = await executePagedStep(
      () => adapter.deleteUserIntentStatusAuditPage(uid, pageSize),
      pageSize,
      maxPages
    );
    const completed = statuses.completed && statusAudit.completed;

    return {
      domain: 'presence_and_location',
      status: completed ? 'completed' : 'partial',
      processed:
        presenceProcessed +
        privateLocationProcessed +
        statuses.processed +
        statusAudit.processed,
      pages: statuses.pages + statusAudit.pages + 2,
      ...(completed ? {} : { blocker: 'pagination-limit-reached' }),
      details: {
        presenceDocumentsProcessed: presenceProcessed,
        privateLocationDocumentsProcessed: privateLocationProcessed,
        intentStatusesProcessed: statuses.processed,
        intentStatusAuditProcessed: statusAudit.processed,
      },
    };
  } catch (error: unknown) {
    return failedResult('presence_and_location', error);
  }
}

async function executeFriendRequestsDomain(
  adapter: AccountDataDeletionAdapter,
  uid: string,
  pageSize: number,
  maxPages: number
): Promise<AccountDataDeletionDomainExecution> {
  try {
    const outbound = await executePagedStep(
      () => adapter.deleteFriendRequestsPage(uid, 'requester', pageSize),
      pageSize,
      maxPages
    );
    const inbound = await executePagedStep(
      () => adapter.deleteFriendRequestsPage(uid, 'target', pageSize),
      pageSize,
      maxPages
    );

    const completed = outbound.completed && inbound.completed;

    return {
      domain: 'friend_requests',
      status: completed ? 'completed' : 'partial',
      processed: outbound.processed + inbound.processed,
      pages: outbound.pages + inbound.pages,
      ...(completed ? {} : { blocker: 'pagination-limit-reached' }),
      details: {
        outboundProcessed: outbound.processed,
        inboundProcessed: inbound.processed,
      },
    };
  } catch (error: unknown) {
    return failedResult('friend_requests', error);
  }
}

async function executeCommunityMembershipsDomain(
  adapter: AccountDataDeletionAdapter,
  uid: string,
  pageSize: number,
  maxPages: number
): Promise<AccountDataDeletionDomainExecution> {
  try {
    const memberships = await executePagedStep(
      () => adapter.unlinkCommunityMembershipsPage(uid, pageSize),
      pageSize,
      maxPages
    );

    if (!memberships.completed) {
      return {
        domain: 'community_memberships',
        status: 'partial',
        processed: memberships.processed,
        pages: memberships.pages,
        blocker: 'pagination-limit-reached',
      };
    }

    const ownerMemberships = normalizeProcessedCount(
      await adapter.inspectOwnedCommunityMemberships(uid)
    );

    if (ownerMemberships > 0) {
      return {
        domain: 'community_memberships',
        status: 'blocked',
        processed: memberships.processed,
        pages: memberships.pages + 1,
        blocker: 'owner-transfer-or-community-archive-required',
        details: {
          membershipsProcessed: memberships.processed,
          ownerMemberships,
        },
      };
    }

    return {
      domain: 'community_memberships',
      status: 'completed',
      processed: memberships.processed,
      pages: memberships.pages + 1,
      details: {
        membershipsProcessed: memberships.processed,
        ownerMemberships: 0,
      },
    };
  } catch (error: unknown) {
    return failedResult('community_memberships', error);
  }
}

async function executeRoomParticipationDomain(
  adapter: AccountDataDeletionAdapter,
  uid: string,
  pageSize: number,
  maxPages: number
): Promise<AccountDataDeletionDomainExecution> {
  try {
    const sentInvites = await executePagedStep(
      () => adapter.deleteRoomInvitesPage(uid, 'sender', pageSize),
      pageSize,
      maxPages
    );
    const receivedInvites = await executePagedStep(
      () => adapter.deleteRoomInvitesPage(uid, 'receiver', pageSize),
      pageSize,
      maxPages
    );
    const legacyParticipations = await executeRoomPagedStep(
      () => adapter.unlinkRoomParticipationsPage(uid, pageSize),
      pageSize,
      maxPages
    );
    const memberships = await executeRoomPagedStep(
      () => adapter.unlinkRoomMembershipsPage(uid, pageSize),
      pageSize,
      maxPages
    );
    const participantDocuments = await executeRoomPagedStep(
      () => adapter.deleteRoomParticipantDocumentsPage(uid, pageSize),
      pageSize,
      maxPages
    );
    const ownedRooms = await executeRoomPagedStep(
      () => adapter.resolveOwnedRoomReferencesPage(uid, pageSize),
      pageSize,
      maxPages
    );
    const roomAudit = await executePagedStep(
      () => adapter.anonymizeRoomAuditPage(uid, pageSize),
      pageSize,
      maxPages
    );
    const privateReferences = normalizeProcessedCount(
      await adapter.clearPrivateRoomReferences(uid)
    );

    const blockingOwners =
      legacyParticipations.blockingOwners +
      memberships.blockingOwners +
      participantDocuments.blockingOwners +
      ownedRooms.blockingOwners;
    const paginationCompleted =
      sentInvites.completed &&
      receivedInvites.completed &&
      legacyParticipations.completed &&
      memberships.completed &&
      participantDocuments.completed &&
      ownedRooms.completed &&
      roomAudit.completed;
    const processed =
      sentInvites.processed +
      receivedInvites.processed +
      legacyParticipations.processed +
      memberships.processed +
      participantDocuments.processed +
      ownedRooms.processed +
      roomAudit.processed +
      privateReferences;
    const pages =
      sentInvites.pages +
      receivedInvites.pages +
      legacyParticipations.pages +
      memberships.pages +
      participantDocuments.pages +
      ownedRooms.pages +
      roomAudit.pages +
      1;

    if (blockingOwners > 0) {
      return {
        domain: 'room_participation',
        status: 'blocked',
        processed,
        pages,
        blocker: 'active-room-owner-close-or-transfer-required',
        details: buildRoomParticipationDetails({
          sentInvites,
          receivedInvites,
          legacyParticipations,
          memberships,
          participantDocuments,
          ownedRooms,
          roomAudit,
          privateReferences,
          blockingOwners,
        }),
      };
    }

    return {
      domain: 'room_participation',
      status: paginationCompleted ? 'completed' : 'partial',
      processed,
      pages,
      ...(paginationCompleted
        ? {}
        : { blocker: 'pagination-limit-reached' }),
      details: buildRoomParticipationDetails({
        sentInvites,
        receivedInvites,
        legacyParticipations,
        memberships,
        participantDocuments,
        ownedRooms,
        roomAudit,
        privateReferences,
        blockingOwners: 0,
      }),
    };
  } catch (error: unknown) {
    return failedResult('room_participation', error);
  }
}

function buildRoomParticipationDetails(input: {
  sentInvites: PagedExecutionResult;
  receivedInvites: PagedExecutionResult;
  legacyParticipations: RoomPagedExecutionResult;
  memberships: RoomPagedExecutionResult;
  participantDocuments: RoomPagedExecutionResult;
  ownedRooms: RoomPagedExecutionResult;
  roomAudit: PagedExecutionResult;
  privateReferences: number;
  blockingOwners: number;
}): Record<string, number> {
  return {
    sentInvitesProcessed: input.sentInvites.processed,
    receivedInvitesProcessed: input.receivedInvites.processed,
    legacyRoomParticipationsProcessed: input.legacyParticipations.processed,
    roomMembershipsProcessed: input.memberships.processed,
    roomParticipantDocumentsProcessed: input.participantDocuments.processed,
    ownedRoomReferencesProcessed: input.ownedRooms.processed,
    roomAuditRecordsProcessed: input.roomAudit.processed,
    privateRoomReferencesProcessed: input.privateReferences,
    blockingOwnedRooms: input.blockingOwners,
  };
}

async function executeRelationshipEdgesDomain(
  adapter: AccountDataDeletionAdapter,
  uid: string,
  pageSize: number,
  maxPages: number
): Promise<AccountDataDeletionDomainExecution> {
  try {
    const owned = await executePagedStep(
      () => adapter.unlinkOwnedFriendshipsPage(uid, pageSize),
      pageSize,
      maxPages
    );
    const inbound = await executePagedStep(
      () => adapter.deleteInboundFriendshipReferencesPage(uid, pageSize),
      pageSize,
      maxPages
    );

    if (!owned.completed || !inbound.completed) {
      return {
        domain: 'relationship_edges',
        status: 'partial',
        processed: owned.processed + inbound.processed,
        pages: owned.pages + inbound.pages,
        blocker: 'pagination-limit-reached',
        details: {
          ownedFriendshipsProcessed: owned.processed,
          inboundFriendshipsProcessed: inbound.processed,
        },
      };
    }

    const blockReferences = await adapter.inspectBlockReferences(uid);
    const ownedBlocks = normalizeProcessedCount(blockReferences.owned);
    const inboundBlocks = normalizeProcessedCount(blockReferences.inbound);

    if (ownedBlocks > 0 || inboundBlocks > 0) {
      return {
        domain: 'relationship_edges',
        status: 'blocked',
        processed: owned.processed + inbound.processed,
        pages: owned.pages + inbound.pages,
        blocker: 'block-event-retention-contract-required',
        details: {
          ownedFriendshipsProcessed: owned.processed,
          inboundFriendshipsProcessed: inbound.processed,
          ownedBlockReferences: ownedBlocks,
          inboundBlockReferences: inboundBlocks,
        },
      };
    }

    return {
      domain: 'relationship_edges',
      status: 'completed',
      processed: owned.processed + inbound.processed,
      pages: owned.pages + inbound.pages,
      details: {
        ownedFriendshipsProcessed: owned.processed,
        inboundFriendshipsProcessed: inbound.processed,
        ownedBlockReferences: 0,
        inboundBlockReferences: 0,
      },
    };
  } catch (error: unknown) {
    return failedResult('relationship_edges', error);
  }
}

async function executePagedStep(
  operation: () => Promise<number>,
  pageSize: number,
  maxPages: number
): Promise<PagedExecutionResult> {
  let processed = 0;
  let pages = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const rawCount = await operation();
    const count = normalizeProcessedCount(rawCount);
    processed += count;
    pages += 1;

    if (count < pageSize) {
      return { completed: true, processed, pages };
    }
  }

  return { completed: false, processed, pages };
}

async function executeRoomPagedStep(
  operation: () => Promise<RoomParticipationPageSummary>,
  pageSize: number,
  maxPages: number
): Promise<RoomPagedExecutionResult> {
  let processed = 0;
  let pages = 0;
  let blockingOwners = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const summary = normalizeRoomPageSummary(await operation());
    processed += summary.processed;
    blockingOwners += summary.blockingOwners;
    pages += 1;

    if (blockingOwners > 0) {
      return { completed: false, processed, pages, blockingOwners };
    }

    if (summary.scanned < pageSize) {
      return { completed: true, processed, pages, blockingOwners: 0 };
    }

    if (summary.scanned > 0 && summary.processed === 0) {
      return { completed: false, processed, pages, blockingOwners: 0 };
    }
  }

  return { completed: false, processed, pages, blockingOwners };
}

function normalizeRoomPageSummary(
  value: RoomParticipationPageSummary
): RoomParticipationPageSummary {
  return {
    scanned: normalizeProcessedCount(value?.scanned),
    processed: normalizeProcessedCount(value?.processed),
    blockingOwners: normalizeProcessedCount(value?.blockingOwners),
  };
}

function failedResult(
  domain: AccountDataDomain,
  error: unknown
): AccountDataDeletionDomainExecution {
  return {
    domain,
    status: 'failed',
    processed: 0,
    pages: 0,
    blocker: 'execution-failed',
    errorCode: normalizeErrorCode(error),
  };
}

function normalizeErrorCode(error: unknown): string {
  const source = error as { code?: unknown; name?: unknown } | null;
  const raw = String(source?.code ?? source?.name ?? 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .slice(0, 80);

  return raw || 'unknown';
}

function normalizeUid(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeEpoch(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : Date.now();
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function normalizeProcessedCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}
