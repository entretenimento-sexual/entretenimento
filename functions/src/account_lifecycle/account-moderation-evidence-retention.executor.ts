// functions/src/account_lifecycle/account-moderation-evidence-retention.executor.ts
// -----------------------------------------------------------------------------
// MODERATION REPORTS AND EVIDENCE RETENTION EXECUTOR
// -----------------------------------------------------------------------------
// Mantém denúncias e trilhas necessárias à segurança, pseudonimiza referências
// diretas e remove índices/backups operacionais que não devem sobreviver.
// -----------------------------------------------------------------------------
import type { AccountDataDeletionDomainExecution } from './account-data-deletion.executor';

export type ModerationReportIdentityField =
  | 'reporterUid'
  | 'targetOwnerUid'
  | 'targetAuthorUid'
  | 'targetId'
  | 'reviewedBy';

export type ModerationDedupIdentityField = 'reporterUid' | 'targetUid';

export type AgeReverificationIdentityField =
  | 'targetUid'
  | 'requestedBy'
  | 'reviewedBy';

export type ComplianceAuditIdentityField = 'uid' | 'actorUid';
export type AdminLogIdentityField = 'adminUid' | 'targetUserUid';

export interface AccountModerationEvidenceRetentionAdapter {
  anonymizeModerationReportsPage(
    uid: string,
    field: ModerationReportIdentityField,
    limit: number
  ): Promise<number>;
  deleteModerationDedupPage(
    uid: string,
    field: ModerationDedupIdentityField,
    limit: number
  ): Promise<number>;
  anonymizeAgeReverificationCasesPage(
    uid: string,
    field: AgeReverificationIdentityField,
    limit: number
  ): Promise<number>;
  anonymizeComplianceAuditPage(
    uid: string,
    field: ComplianceAuditIdentityField,
    limit: number
  ): Promise<number>;
  anonymizeAdminLogsPage(
    uid: string,
    field: AdminLogIdentityField,
    limit: number
  ): Promise<number>;
}

export interface ExecuteModerationEvidenceRetentionInput {
  uid: string;
  pageSize?: number;
  maxPagesPerStep?: number;
}

interface PagedExecutionResult {
  completed: boolean;
  processed: number;
  pages: number;
}

const REPORT_FIELDS: readonly ModerationReportIdentityField[] = [
  'reporterUid',
  'targetOwnerUid',
  'targetAuthorUid',
  'targetId',
  'reviewedBy',
];
const DEDUP_FIELDS: readonly ModerationDedupIdentityField[] = [
  'reporterUid',
  'targetUid',
];
const AGE_CASE_FIELDS: readonly AgeReverificationIdentityField[] = [
  'targetUid',
  'requestedBy',
  'reviewedBy',
];
const COMPLIANCE_AUDIT_FIELDS: readonly ComplianceAuditIdentityField[] = [
  'uid',
  'actorUid',
];
const ADMIN_LOG_FIELDS: readonly AdminLogIdentityField[] = [
  'adminUid',
  'targetUserUid',
];
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const DEFAULT_MAX_PAGES = 30;
const MAX_PAGES = 100;

export async function executeModerationEvidenceRetentionDomain(
  adapter: AccountModerationEvidenceRetentionAdapter,
  input: ExecuteModerationEvidenceRetentionInput
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
    return failedResult(new Error('UID inválido para retenção de moderação.'));
  }

  try {
    const reportResults = await executeFieldSteps(
      REPORT_FIELDS,
      (field) => adapter.anonymizeModerationReportsPage(uid, field, pageSize),
      pageSize,
      maxPages
    );
    const dedupResults = await executeFieldSteps(
      DEDUP_FIELDS,
      (field) => adapter.deleteModerationDedupPage(uid, field, pageSize),
      pageSize,
      maxPages
    );
    const ageCaseResults = await executeFieldSteps(
      AGE_CASE_FIELDS,
      (field) => adapter.anonymizeAgeReverificationCasesPage(
        uid,
        field,
        pageSize
      ),
      pageSize,
      maxPages
    );
    const complianceResults = await executeFieldSteps(
      COMPLIANCE_AUDIT_FIELDS,
      (field) => adapter.anonymizeComplianceAuditPage(uid, field, pageSize),
      pageSize,
      maxPages
    );
    const adminLogResults = await executeFieldSteps(
      ADMIN_LOG_FIELDS,
      (field) => adapter.anonymizeAdminLogsPage(uid, field, pageSize),
      pageSize,
      maxPages
    );
    const allResults = [
      ...reportResults.values(),
      ...dedupResults.values(),
      ...ageCaseResults.values(),
      ...complianceResults.values(),
      ...adminLogResults.values(),
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
      domain: 'moderation_reports_and_evidence',
      status: completed ? 'completed' : 'partial',
      processed,
      pages,
      ...(completed ? {} : { blocker: 'pagination-limit-reached' }),
      details: {
        reportsAnonymized: sumProcessed(reportResults),
        dedupDocumentsDeleted: sumProcessed(dedupResults),
        ageCasesAnonymized: sumProcessed(ageCaseResults),
        complianceAuditRecordsAnonymized: sumProcessed(complianceResults),
        adminLogsAnonymized: sumProcessed(adminLogResults),
        documentaryStorageAssetsProcessed: 0,
      },
    };
  } catch (error: unknown) {
    return failedResult(error);
  }
}

async function executeFieldSteps<TField extends string>(
  fields: readonly TField[],
  operation: (field: TField) => Promise<number>,
  pageSize: number,
  maxPages: number
): Promise<Map<TField, PagedExecutionResult>> {
  const results = new Map<TField, PagedExecutionResult>();

  for (const field of fields) {
    results.set(
      field,
      await executePagedStep(() => operation(field), pageSize, maxPages)
    );
  }

  return results;
}

async function executePagedStep(
  operation: () => Promise<number>,
  pageSize: number,
  maxPages: number
): Promise<PagedExecutionResult> {
  let processed = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const count = normalizeCount(await operation(), pageSize);
    processed += count;

    if (count < pageSize) {
      return { completed: true, processed, pages: page };
    }
  }

  return { completed: false, processed, pages: maxPages };
}

function sumProcessed<TField extends string>(
  results: Map<TField, PagedExecutionResult>
): number {
  return [...results.values()].reduce(
    (total, result) => total + result.processed,
    0
  );
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
    domain: 'moderation_reports_and_evidence',
    status: 'failed',
    processed: 0,
    pages: 0,
    errorCode: String(
      source.code ?? 'moderation-evidence-retention-failed'
    ).slice(0, 120),
    details: {
      errorMessage: String(source.message ?? error ?? 'unknown').slice(0, 500),
    },
  };
}
