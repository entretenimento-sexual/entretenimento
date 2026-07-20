// functions/src/account_lifecycle/account-shared-message-anonymization.executor.ts
// -----------------------------------------------------------------------------
// SHARED MESSAGE ANONYMIZATION EXECUTOR
// -----------------------------------------------------------------------------
// Preserva conteúdo e contexto compartilhado, removendo identificadores diretos
// da conta excluída. Nenhuma mensagem é apagada fisicamente neste domínio.
// -----------------------------------------------------------------------------
import type { AccountDataDeletionDomainExecution } from './account-data-deletion.executor';

export type SharedMessageIdentityField =
  | 'senderId'
  | 'senderUid'
  | 'recipientUid';

export interface AccountSharedMessageAnonymizationAdapter {
  anonymizeMessageIdentityPage(
    uid: string,
    field: SharedMessageIdentityField,
    limit: number
  ): Promise<number>;
  removeMessageReactionsPage(uid: string, limit: number): Promise<number>;
  anonymizeDirectChatsPage(uid: string, limit: number): Promise<number>;
  deleteDirectChatPairReferencesPage(uid: string, limit: number): Promise<number>;
}

export interface ExecuteSharedMessageAnonymizationInput {
  uid: string;
  pageSize?: number;
  maxPagesPerStep?: number;
}

interface PagedExecutionResult {
  completed: boolean;
  processed: number;
  pages: number;
}

const IDENTITY_FIELDS: readonly SharedMessageIdentityField[] = [
  'senderId',
  'senderUid',
  'recipientUid',
];
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const DEFAULT_MAX_PAGES = 30;
const MAX_PAGES = 100;

export async function executeSharedMessageAnonymizationDomain(
  adapter: AccountSharedMessageAnonymizationAdapter,
  input: ExecuteSharedMessageAnonymizationInput
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
    return failedResult(new Error('UID inválido para anonimização de mensagens.'));
  }

  try {
    const identityResults: Record<SharedMessageIdentityField, PagedExecutionResult> = {
      senderId: emptyResult(),
      senderUid: emptyResult(),
      recipientUid: emptyResult(),
    };

    for (const field of IDENTITY_FIELDS) {
      identityResults[field] = await executePagedStep(
        () => adapter.anonymizeMessageIdentityPage(uid, field, pageSize),
        pageSize,
        maxPages
      );
    }

    const reactions = await executePagedStep(
      () => adapter.removeMessageReactionsPage(uid, pageSize),
      pageSize,
      maxPages
    );
    const directChats = await executePagedStep(
      () => adapter.anonymizeDirectChatsPage(uid, pageSize),
      pageSize,
      maxPages
    );
    const pairReferences = await executePagedStep(
      () => adapter.deleteDirectChatPairReferencesPage(uid, pageSize),
      pageSize,
      maxPages
    );
    const allResults = [
      ...IDENTITY_FIELDS.map((field) => identityResults[field]),
      reactions,
      directChats,
      pairReferences,
    ];
    const completed = allResults.every((result) => result.completed);
    const processed = allResults.reduce(
      (total, result) => total + result.processed,
      0
    );
    const pages = allResults.reduce(
      (total, result) => total + result.pages,
      0
    );

    return {
      domain: 'shared_messages',
      status: completed ? 'completed' : 'partial',
      processed,
      pages,
      ...(completed ? {} : { blocker: 'pagination-limit-reached' }),
      details: {
        senderIdMessagesAnonymized: identityResults.senderId.processed,
        senderUidMessagesAnonymized: identityResults.senderUid.processed,
        recipientMessagesAnonymized: identityResults.recipientUid.processed,
        messageReactionsRemoved: reactions.processed,
        directChatsAnonymized: directChats.processed,
        directChatPairReferencesDeleted: pairReferences.processed,
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

function emptyResult(): PagedExecutionResult {
  return { completed: true, processed: 0, pages: 0 };
}

function failedResult(error: unknown): AccountDataDeletionDomainExecution {
  const source = (error ?? {}) as { code?: unknown; message?: unknown };

  return {
    domain: 'shared_messages',
    status: 'failed',
    processed: 0,
    pages: 0,
    errorCode: String(
      source.code ?? 'shared-message-anonymization-failed'
    ).slice(0, 120),
    details: {
      errorMessage: String(source.message ?? error ?? 'unknown').slice(0, 500),
    },
  };
}
