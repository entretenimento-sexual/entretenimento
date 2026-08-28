// functions/src/community/community-purge.executor.ts
// -----------------------------------------------------------------------------
// COMMUNITY PURGE EXECUTOR
// -----------------------------------------------------------------------------
// Orquestra a remoção física de uma Comunidade somente depois que a política de
// readiness a confirma como elegível. O executor continua fail closed:
// - readiness é validada antes de qualquer limpeza;
// - referências operacionais são removidas de forma paginada;
// - referências privadas por usuário são limpas junto com memberships históricas;
// - se a paginação não terminar, nenhuma raiz destrutiva é tocada;
// - readiness é revalidada antes das projeções e novamente antes da árvore final;
// - auditorias, moderation_reports, admin_logs e evidências não fazem parte do
//   adapter e portanto não podem ser removidos por este fluxo.
// -----------------------------------------------------------------------------

export type CommunityPurgeReferenceKind =
  | 'creation_requests'
  | 'feed_requests'
  | 'topic_requests'
  | 'lifecycle_requests'
  | 'invites'
  | 'notifications'
  | 'member_scoped_refs';

export interface CommunityPurgeExecutionAdapter {
  deleteReferencePage(
    communityId: string,
    kind: CommunityPurgeReferenceKind,
    limit: number
  ): Promise<number>;
  confirmPurgeReadiness(communityId: string): Promise<boolean>;
  deleteProjectionRoots(communityId: string): Promise<number>;
  deleteCommunityRoots(communityId: string): Promise<number>;
}

export type CommunityPurgeExecutionStatus =
  | 'completed'
  | 'partial'
  | 'blocked'
  | 'failed';

export type CommunityPurgeExecutionBlocker =
  | 'pagination-limit-reached'
  | 'readiness-not-confirmed-before-cleanup'
  | 'readiness-changed-before-projections'
  | 'readiness-changed-before-final-delete';

export interface CommunityPurgeExecutionResult {
  communityId: string;
  status: CommunityPurgeExecutionStatus;
  processed: number;
  pages: number;
  blocker?: CommunityPurgeExecutionBlocker;
  errorCode?: string;
  details: Record<string, number | string>;
}

export interface ExecuteCommunityPurgeInput {
  communityId: string;
  pageSize?: number;
  maxPagesPerStep?: number;
}

interface PagedExecutionResult {
  completed: boolean;
  processed: number;
  pages: number;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const DEFAULT_MAX_PAGES = 30;
const MAX_PAGES = 100;

export const COMMUNITY_PURGE_REFERENCE_KINDS:
  readonly CommunityPurgeReferenceKind[] = Object.freeze([
    'creation_requests',
    'feed_requests',
    'topic_requests',
    'lifecycle_requests',
    'invites',
    'notifications',
    'member_scoped_refs',
  ]);

export async function executeCommunityPurge(
  adapter: CommunityPurgeExecutionAdapter,
  input: ExecuteCommunityPurgeInput
): Promise<CommunityPurgeExecutionResult> {
  const communityId = normalizeCommunityId(input.communityId);
  const pageSize = normalizeInteger(
    input.pageSize,
    DEFAULT_PAGE_SIZE,
    1,
    MAX_PAGE_SIZE
  );
  const maxPages = normalizeInteger(
    input.maxPagesPerStep,
    DEFAULT_MAX_PAGES,
    1,
    MAX_PAGES
  );

  if (!communityId) {
    return failedResult('', new Error('Community ID inválido para purge.'));
  }

  try {
    const referenceResults = new Map<
      CommunityPurgeReferenceKind,
      PagedExecutionResult
    >();

    if (!(await adapter.confirmPurgeReadiness(communityId))) {
      return blockedResult(
        communityId,
        referenceResults,
        'readiness-not-confirmed-before-cleanup'
      );
    }

    for (const kind of COMMUNITY_PURGE_REFERENCE_KINDS) {
      const result = await executePagedStep(
        () => adapter.deleteReferencePage(communityId, kind, pageSize),
        pageSize,
        maxPages
      );
      referenceResults.set(kind, result);

      if (!result.completed) {
        return partialResult(
          communityId,
          referenceResults,
          'pagination-limit-reached'
        );
      }
    }

    if (!(await adapter.confirmPurgeReadiness(communityId))) {
      return blockedResult(
        communityId,
        referenceResults,
        'readiness-changed-before-projections'
      );
    }

    const projectionRootsDeleted = normalizeProcessedCount(
      await adapter.deleteProjectionRoots(communityId)
    );

    if (!(await adapter.confirmPurgeReadiness(communityId))) {
      return blockedResult(
        communityId,
        referenceResults,
        'readiness-changed-before-final-delete',
        projectionRootsDeleted
      );
    }

    const communityRootsDeleted = normalizeProcessedCount(
      await adapter.deleteCommunityRoots(communityId)
    );
    const referenceProcessed = sumProcessed(referenceResults);
    const referencePages = sumPages(referenceResults);

    return {
      communityId,
      status: 'completed',
      processed:
        referenceProcessed + projectionRootsDeleted + communityRootsDeleted,
      pages: referencePages,
      details: {
        ...referenceDetails(referenceResults),
        projectionRootsDeleted,
        communityRootsDeleted,
      },
    };
  } catch (error: unknown) {
    return failedResult(communityId, error);
  }
}

async function executePagedStep(
  action: () => Promise<number>,
  pageSize: number,
  maxPages: number
): Promise<PagedExecutionResult> {
  let processed = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const pageProcessed = normalizeProcessedCount(await action(), pageSize);
    processed += pageProcessed;

    if (pageProcessed < pageSize) {
      return { completed: true, processed, pages: page };
    }
  }

  return { completed: false, processed, pages: maxPages };
}

function partialResult(
  communityId: string,
  results: ReadonlyMap<CommunityPurgeReferenceKind, PagedExecutionResult>,
  blocker: 'pagination-limit-reached'
): CommunityPurgeExecutionResult {
  return {
    communityId,
    status: 'partial',
    processed: sumProcessed(results),
    pages: sumPages(results),
    blocker,
    details: referenceDetails(results),
  };
}

function blockedResult(
  communityId: string,
  results: ReadonlyMap<CommunityPurgeReferenceKind, PagedExecutionResult>,
  blocker: Exclude<CommunityPurgeExecutionBlocker, 'pagination-limit-reached'>,
  projectionRootsDeleted = 0
): CommunityPurgeExecutionResult {
  return {
    communityId,
    status: 'blocked',
    processed: sumProcessed(results) + projectionRootsDeleted,
    pages: sumPages(results),
    blocker,
    details: {
      ...referenceDetails(results),
      projectionRootsDeleted,
      communityRootsDeleted: 0,
    },
  };
}

function referenceDetails(
  results: ReadonlyMap<CommunityPurgeReferenceKind, PagedExecutionResult>
): Record<string, number> {
  const details: Record<string, number> = {};

  for (const kind of COMMUNITY_PURGE_REFERENCE_KINDS) {
    details[`${kind}Deleted`] = results.get(kind)?.processed ?? 0;
  }

  return details;
}

function sumProcessed(
  results: ReadonlyMap<CommunityPurgeReferenceKind, PagedExecutionResult>
): number {
  return [...results.values()].reduce(
    (total, result) => total + result.processed,
    0
  );
}

function sumPages(
  results: ReadonlyMap<CommunityPurgeReferenceKind, PagedExecutionResult>
): number {
  return [...results.values()].reduce(
    (total, result) => total + result.pages,
    0
  );
}

function normalizeProcessedCount(
  value: unknown,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 0), maximum)
    : 0;
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

function normalizeCommunityId(value: unknown): string {
  const communityId = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,128}$/.test(communityId) ? communityId : '';
}

function failedResult(
  communityId: string,
  error: unknown
): CommunityPurgeExecutionResult {
  const source = (error ?? {}) as { code?: unknown; message?: unknown };
  const code = String(source.code ?? 'community-purge-failed').slice(0, 120);
  const message = String(source.message ?? error ?? 'unknown').slice(0, 500);

  return {
    communityId,
    status: 'failed',
    processed: 0,
    pages: 0,
    errorCode: code,
    details: { errorMessage: message },
  };
}
