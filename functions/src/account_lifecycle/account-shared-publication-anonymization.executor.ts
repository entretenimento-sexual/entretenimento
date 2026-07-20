// functions/src/account_lifecycle/account-shared-publication-anonymization.executor.ts
// -----------------------------------------------------------------------------
// SHARED PUBLICATION ANONYMIZATION EXECUTOR
// -----------------------------------------------------------------------------
// Preserva comentários e respostas publicados em conteúdo de terceiros, remove
// reações pessoais e elimina identificadores diretos da conta excluída.
// -----------------------------------------------------------------------------
import type { AccountDataDeletionDomainExecution } from './account-data-deletion.executor';

export interface AccountSharedPublicationAnonymizationAdapter {
  anonymizePhotoCommentAuthorsPage(
    uid: string,
    limit: number
  ): Promise<number>;
  anonymizePhotoCommentReplyTargetsPage(
    uid: string,
    limit: number
  ): Promise<number>;
  deletePhotoReactionReferencesPage(
    uid: string,
    limit: number
  ): Promise<number>;
}

export interface ExecuteSharedPublicationAnonymizationInput {
  uid: string;
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

export async function executeSharedPublicationAnonymizationDomain(
  adapter: AccountSharedPublicationAnonymizationAdapter,
  input: ExecuteSharedPublicationAnonymizationInput
): Promise<AccountDataDeletionDomainExecution> {
  const uid = normalizeUid(input.uid);
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

  if (!uid) {
    return failedResult(
      new Error('UID inválido para anonimização de publicações.')
    );
  }

  try {
    const commentAuthors = await executePagedStep(
      () => adapter.anonymizePhotoCommentAuthorsPage(uid, pageSize),
      pageSize,
      maxPages
    );
    const replyTargets = await executePagedStep(
      () => adapter.anonymizePhotoCommentReplyTargetsPage(uid, pageSize),
      pageSize,
      maxPages
    );
    const reactions = await executePagedStep(
      () => adapter.deletePhotoReactionReferencesPage(uid, pageSize),
      pageSize,
      maxPages
    );
    const results = [commentAuthors, replyTargets, reactions];
    const completed = results.every((result) => result.completed);
    const processed = results.reduce(
      (total, result) => total + result.processed,
      0
    );
    const pages = results.reduce(
      (total, result) => total + result.pages,
      0
    );

    return {
      domain: 'shared_publications',
      status: completed ? 'completed' : 'partial',
      processed,
      pages,
      ...(completed ? {} : { blocker: 'pagination-limit-reached' }),
      details: {
        photoCommentAuthorsAnonymized: commentAuthors.processed,
        photoCommentReplyTargetsAnonymized: replyTargets.processed,
        photoReactionsDeleted: reactions.processed,
      },
    };
  } catch (error: unknown) {
    return failedResult(error);
  }
}

async function executePagedStep(
  action: () => Promise<number>,
  pageSize: number,
  maxPages: number
): Promise<PagedExecutionResult> {
  let processed = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const pageProcessed = normalizeCount(await action(), pageSize);
    processed += pageProcessed;

    if (pageProcessed < pageSize) {
      return { completed: true, processed, pages: page };
    }
  }

  return { completed: false, processed, pages: maxPages };
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

function normalizeCount(value: unknown, maximum: number): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 0), maximum)
    : 0;
}

function failedResult(error: unknown): AccountDataDeletionDomainExecution {
  const source = (error ?? {}) as { code?: unknown; message?: unknown };

  return {
    domain: 'shared_publications',
    status: 'failed',
    processed: 0,
    pages: 0,
    errorCode: String(
      source.code ?? 'shared-publication-anonymization-failed'
    ).slice(0, 120),
    details: {
      errorMessage: String(source.message ?? error ?? 'unknown').slice(0, 500),
    },
  };
}
