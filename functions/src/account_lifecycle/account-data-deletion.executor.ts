// functions/src/account_lifecycle/account-data-deletion.executor.ts
// -----------------------------------------------------------------------------
// ACCOUNT DATA DELETION EXECUTOR
// -----------------------------------------------------------------------------
// Orquestra os primeiros domínios realmente automatizados da matriz de retenção.
//
// Garantias:
// - paginação limitada por execução para preservar timeout e memória;
// - idempotência: todas as operações podem ser repetidas;
// - falha isolada por domínio;
// - nenhuma mensagem, mídia, denúncia ou registro financeiro é apagado aqui;
// - bloqueios com eventos de segurança permanecem como bloqueador explícito.
// -----------------------------------------------------------------------------
import type { AccountDataDomain } from './account-data-retention.policy';

export type FriendRequestDirection = 'requester' | 'target';

export interface AccountBlockReferenceSummary {
  owned: number;
  inbound: number;
}

export interface AccountDataDeletionAdapter {
  deleteNotificationsPage(uid: string, limit: number): Promise<number>;
  deletePreferences(uid: string): Promise<number>;
  deleteFriendRequestsPage(
    uid: string,
    direction: FriendRequestDirection,
    limit: number
  ): Promise<number>;
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
    await executePagedDomain(
      'notifications',
      () => adapter.deleteNotificationsPage(uid, pageSize),
      pageSize,
      maxPagesPerDomain
    )
  );

  results.push(await executePreferencesDomain(adapter, uid));

  results.push(
    await executeFriendRequestsDomain(
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

async function executePagedDomain(
  domain: AccountDataDomain,
  operation: () => Promise<number>,
  pageSize: number,
  maxPages: number
): Promise<AccountDataDeletionDomainExecution> {
  try {
    const result = await executePagedStep(operation, pageSize, maxPages);

    return {
      domain,
      status: result.completed ? 'completed' : 'partial',
      processed: result.processed,
      pages: result.pages,
      ...(result.completed ? {} : { blocker: 'pagination-limit-reached' }),
    };
  } catch (error: unknown) {
    return failedResult(domain, error);
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
