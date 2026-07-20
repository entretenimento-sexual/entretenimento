// functions/src/account_lifecycle/account-financial-retention.executor.ts
// -----------------------------------------------------------------------------
// FINANCIAL RECORDS AND ENTITLEMENTS RETENTION EXECUTOR
// -----------------------------------------------------------------------------
// Cancela intenções pendentes, revoga benefícios e preserva registros financeiros
// liquidados com pseudonimização. Não inventa saldo, saque ou assinatura recorrente.
// -----------------------------------------------------------------------------
import type {
  AccountDataDeletionDomainExecution,
} from './account-data-deletion.executor';

export type FinancialPartyField = 'buyerUid' | 'sellerUid';

export interface FinancialRetentionPageSummary {
  processed: number;
  pendingCheckoutsCanceled?: number;
  entitlementsArchived?: number;
  entitlementsRevoked?: number;
}

export interface AccountFinancialRetentionAdapter {
  retainCheckoutSessionsPage(
    uid: string,
    field: FinancialPartyField,
    limit: number
  ): Promise<FinancialRetentionPageSummary>;
  retainPaymentTransactionsPage(
    uid: string,
    field: FinancialPartyField,
    limit: number
  ): Promise<FinancialRetentionPageSummary>;
  archiveEntitlementsPage(
    uid: string,
    field: FinancialPartyField,
    limit: number
  ): Promise<FinancialRetentionPageSummary>;
  retainBillingAuditPage(
    uid: string,
    field: FinancialPartyField,
    limit: number
  ): Promise<FinancialRetentionPageSummary>;
}

export interface ExecuteFinancialRetentionInput {
  uid: string;
  pageSize?: number;
  maxPagesPerStep?: number;
}

interface PagedFinancialResult {
  completed: boolean;
  processed: number;
  pages: number;
  pendingCheckoutsCanceled: number;
  entitlementsArchived: number;
  entitlementsRevoked: number;
}

const PARTY_FIELDS: readonly FinancialPartyField[] = [
  'buyerUid',
  'sellerUid',
];
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const DEFAULT_MAX_PAGES = 30;
const MAX_PAGES = 100;

export async function executeFinancialRetentionDomain(
  adapter: AccountFinancialRetentionAdapter,
  input: ExecuteFinancialRetentionInput
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
    return failedResult(new Error('UID inválido para retenção financeira.'));
  }

  try {
    const checkoutResults = await executePartySteps(
      PARTY_FIELDS,
      (field) => adapter.retainCheckoutSessionsPage(uid, field, pageSize),
      pageSize,
      maxPages
    );
    const transactionResults = await executePartySteps(
      PARTY_FIELDS,
      (field) => adapter.retainPaymentTransactionsPage(uid, field, pageSize),
      pageSize,
      maxPages
    );
    const entitlementResults = await executePartySteps(
      PARTY_FIELDS,
      (field) => adapter.archiveEntitlementsPage(uid, field, pageSize),
      pageSize,
      maxPages
    );
    const auditResults = await executePartySteps(
      PARTY_FIELDS,
      (field) => adapter.retainBillingAuditPage(uid, field, pageSize),
      pageSize,
      maxPages
    );
    const allResults = [
      ...checkoutResults.values(),
      ...transactionResults.values(),
      ...entitlementResults.values(),
      ...auditResults.values(),
    ];
    const completed = allResults.every((result) => result.completed);
    const processed = sum(allResults, 'processed');
    const pages = sum(allResults, 'pages');

    return {
      domain: 'financial_records_and_entitlements',
      status: completed ? 'completed' : 'partial',
      processed,
      pages,
      ...(completed ? {} : { blocker: 'pagination-limit-reached' }),
      details: {
        checkoutReferencesRetained: sumMap(checkoutResults, 'processed'),
        pendingCheckoutsCanceled: sumMap(
          checkoutResults,
          'pendingCheckoutsCanceled'
        ),
        transactionReferencesRetained: sumMap(
          transactionResults,
          'processed'
        ),
        entitlementsArchived: sumMap(
          entitlementResults,
          'entitlementsArchived'
        ),
        entitlementsRevoked: sumMap(
          entitlementResults,
          'entitlementsRevoked'
        ),
        billingAuditReferencesRetained: sumMap(auditResults, 'processed'),
        paymentEventsRetainedWithoutDirectUid: true,
        externalRecurringSubscriptionsCanceled: 0,
        walletLedgerRecordsProcessed: 0,
        payoutAccountsProcessed: 0,
      },
    };
  } catch (error: unknown) {
    return failedResult(error);
  }
}

async function executePartySteps(
  fields: readonly FinancialPartyField[],
  operation: (
    field: FinancialPartyField
  ) => Promise<FinancialRetentionPageSummary>,
  pageSize: number,
  maxPages: number
): Promise<Map<FinancialPartyField, PagedFinancialResult>> {
  const results = new Map<FinancialPartyField, PagedFinancialResult>();

  for (const field of fields) {
    results.set(
      field,
      await executePagedStep(() => operation(field), pageSize, maxPages)
    );
  }

  return results;
}

async function executePagedStep(
  operation: () => Promise<FinancialRetentionPageSummary>,
  pageSize: number,
  maxPages: number
): Promise<PagedFinancialResult> {
  const result: PagedFinancialResult = {
    completed: false,
    processed: 0,
    pages: 0,
    pendingCheckoutsCanceled: 0,
    entitlementsArchived: 0,
    entitlementsRevoked: 0,
  };

  for (let page = 1; page <= maxPages; page += 1) {
    const summary = normalizePageSummary(await operation(), pageSize);
    result.processed += summary.processed;
    result.pendingCheckoutsCanceled += summary.pendingCheckoutsCanceled ?? 0;
    result.entitlementsArchived += summary.entitlementsArchived ?? 0;
    result.entitlementsRevoked += summary.entitlementsRevoked ?? 0;
    result.pages = page;

    if (summary.processed < pageSize) {
      result.completed = true;
      return result;
    }
  }

  return result;
}

function normalizePageSummary(
  value: FinancialRetentionPageSummary,
  maximum: number
): FinancialRetentionPageSummary {
  return {
    processed: normalizeCount(value?.processed, maximum),
    pendingCheckoutsCanceled: normalizeCount(
      value?.pendingCheckoutsCanceled,
      maximum
    ),
    entitlementsArchived: normalizeCount(
      value?.entitlementsArchived,
      maximum
    ),
    entitlementsRevoked: normalizeCount(
      value?.entitlementsRevoked,
      maximum
    ),
  };
}

function sum(
  values: readonly PagedFinancialResult[],
  field: keyof PagedFinancialResult
): number {
  return values.reduce((total, value) => {
    const current = value[field];
    return total + (typeof current === 'number' ? current : 0);
  }, 0);
}

function sumMap(
  values: Map<FinancialPartyField, PagedFinancialResult>,
  field: keyof PagedFinancialResult
): number {
  return sum([...values.values()], field);
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
    domain: 'financial_records_and_entitlements',
    status: 'failed',
    processed: 0,
    pages: 0,
    errorCode: String(
      source.code ?? 'financial-retention-failed'
    ).slice(0, 120),
    details: {
      errorMessage: String(source.message ?? error ?? 'unknown').slice(0, 500),
    },
  };
}
