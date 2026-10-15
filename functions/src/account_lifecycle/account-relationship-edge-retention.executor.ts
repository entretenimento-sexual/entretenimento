// functions/src/account_lifecycle/account-relationship-edge-retention.executor.ts
// -----------------------------------------------------------------------------
// RELATIONSHIP EDGE RETENTION EXECUTOR
// -----------------------------------------------------------------------------
// Remove bloqueios operacionais ligados à conta excluída somente depois de
// preservar sua trilha em auditoria interna pseudonimizada.
// -----------------------------------------------------------------------------
import type { AccountDataDeletionDomainExecution } from './account-data-deletion.executor';

export interface BlockReferencePageSummary {
  processed: number;
  eventsArchived: number;
  statesArchived: number;
  remaining: boolean;
}

export interface AccountRelationshipEdgeRetentionAdapter {
  archiveOwnedBlockReferencePage(
    uid: string,
    eventLimit: number
  ): Promise<BlockReferencePageSummary>;
  archiveInboundBlockReferencePage(
    uid: string,
    eventLimit: number
  ): Promise<BlockReferencePageSummary>;
  deleteOwnedMediaAccessPage(uid: string, limit: number): Promise<number>;
  deleteInboundMediaAccessPage(uid: string, limit: number): Promise<number>;
}

export interface ExecuteRelationshipEdgeRetentionInput {
  uid: string;
  pageSize?: number;
  maxPagesPerDirection?: number;
}

interface DirectionExecutionSummary {
  completed: boolean;
  processed: number;
  eventsArchived: number;
  statesArchived: number;
  pages: number;
}

const DEFAULT_EVENT_PAGE_SIZE = 100;
const MAX_EVENT_PAGE_SIZE = 200;
const DEFAULT_MAX_PAGES = 30;
const MAX_PAGES = 100;

export async function executeRelationshipEdgeRetentionDomain(
  adapter: AccountRelationshipEdgeRetentionAdapter,
  input: ExecuteRelationshipEdgeRetentionInput
): Promise<AccountDataDeletionDomainExecution> {
  const uid = normalizeUid(input.uid);
  const eventPageSize = normalizeInteger(
    input.pageSize,
    DEFAULT_EVENT_PAGE_SIZE,
    1,
    MAX_EVENT_PAGE_SIZE
  );
  const maxPages = normalizeInteger(
    input.maxPagesPerDirection,
    DEFAULT_MAX_PAGES,
    1,
    MAX_PAGES
  );

  if (!uid) {
    return failedResult(new Error('UID inválido para retenção de bloqueios.'));
  }

  try {
    const owned = await executeDirection(
      () => adapter.archiveOwnedBlockReferencePage(uid, eventPageSize),
      maxPages
    );
    const inbound = await executeDirection(
      () => adapter.archiveInboundBlockReferencePage(uid, eventPageSize),
      maxPages
    );
    // Private bilateral projections are disposable; unlike canonical block
    // events, no evidence retention is required. Drain both perspectives,
    // including passive legacy viewer projections with no block documents.
    const ownedMedia = await executeMediaProjectionPages(
      () => adapter.deleteOwnedMediaAccessPage(uid, eventPageSize),
      eventPageSize, maxPages
    );
    const inboundMedia = await executeMediaProjectionPages(
      () => adapter.deleteInboundMediaAccessPage(uid, eventPageSize),
      eventPageSize, maxPages
    );
    const completed = owned.completed && inbound.completed &&
      ownedMedia.completed && inboundMedia.completed;
    const blocksIncomplete = !owned.completed || !inbound.completed;

    return {
      domain: 'relationship_edges',
      status: completed ? 'completed' : 'partial',
      processed: owned.processed + inbound.processed +
        ownedMedia.processed + inboundMedia.processed,
      pages: owned.pages + inbound.pages +
        ownedMedia.pages + inboundMedia.pages,
      ...(completed ? {} : {
        blocker: blocksIncomplete
          ? 'block-retention-pagination-limit-reached'
          : 'public-media-projection-pagination-limit-reached',
      }),
      details: {
        ownedBlockEventsArchived: owned.eventsArchived,
        ownedBlockStatesArchived: owned.statesArchived,
        inboundBlockEventsArchived: inbound.eventsArchived,
        inboundBlockStatesArchived: inbound.statesArchived,
        ownedMediaAccessDeleted: ownedMedia.processed,
        inboundMediaAccessDeleted: inboundMedia.processed,
      },
    };
  } catch (error: unknown) {
    return failedResult(error);
  }
}

async function executeDirection(
  operation: () => Promise<BlockReferencePageSummary>,
  maxPages: number
): Promise<DirectionExecutionSummary> {
  let processed = 0;
  let eventsArchived = 0;
  let statesArchived = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const summary = normalizeSummary(await operation());
    processed += summary.processed;
    eventsArchived += summary.eventsArchived;
    statesArchived += summary.statesArchived;

    if (!summary.remaining) {
      return {
        completed: true,
        processed,
        eventsArchived,
        statesArchived,
        pages: page,
      };
    }
  }

  return {
    completed: false,
    processed,
    eventsArchived,
    statesArchived,
    pages: maxPages,
  };
}

async function executeMediaProjectionPages(
  operation: () => Promise<number>,
  pageSize: number,
  maxPages: number
): Promise<{ completed: boolean; processed: number; pages: number }> {
  let processed = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    const count = normalizeCount(await operation());
    if (count > pageSize) throw new Error('invalid-media-projection-page-size');
    processed += count;
    if (count < pageSize) return { completed: true, processed, pages: page };
  }
  return { completed: false, processed, pages: maxPages };
}

function normalizeSummary(
  value: BlockReferencePageSummary
): BlockReferencePageSummary {
  return {
    processed: normalizeCount(value?.processed),
    eventsArchived: normalizeCount(value?.eventsArchived),
    statesArchived: normalizeCount(value?.statesArchived),
    remaining: value?.remaining === true,
  };
}

function normalizeUid(value: unknown): string {
  const uid = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,128}$/.test(uid) ? uid : '';
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function failedResult(error: unknown): AccountDataDeletionDomainExecution {
  const source = (error ?? {}) as { code?: unknown; message?: unknown };

  return {
    domain: 'relationship_edges',
    status: 'failed',
    processed: 0,
    pages: 0,
    errorCode: String(
      source.code ?? 'relationship-edge-retention-failed'
    ).slice(0, 120),
    details: {
      errorMessage: String(source.message ?? error ?? 'unknown').slice(0, 500),
    },
  };
}
