import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeModerationEvidenceRetentionDomain,
  type AccountModerationEvidenceRetentionAdapter,
  type AdminLogIdentityField,
  type AgeReverificationIdentityField,
  type ComplianceAuditIdentityField,
  type ModerationDedupIdentityField,
  type ModerationReportIdentityField,
} from './account-moderation-evidence-retention.executor';

class FakeModerationEvidenceAdapter
implements AccountModerationEvidenceRetentionAdapter
{
  reports: Record<ModerationReportIdentityField, number[]> = {
    reporterUid: [0],
    targetOwnerUid: [0],
    targetAuthorUid: [0],
    targetId: [0],
    reviewedBy: [0],
  };
  dedup: Record<ModerationDedupIdentityField, number[]> = {
    reporterUid: [0],
    targetUid: [0],
  };
  ageCases: Record<AgeReverificationIdentityField, number[]> = {
    targetUid: [0],
    requestedBy: [0],
    reviewedBy: [0],
  };
  compliance: Record<ComplianceAuditIdentityField, number[]> = {
    uid: [0],
    actorUid: [0],
  };
  adminLogs: Record<AdminLogIdentityField, number[]> = {
    adminUid: [0],
    targetUserUid: [0],
  };
  error: unknown = null;

  async anonymizeModerationReportsPage(
    _uid: string,
    field: ModerationReportIdentityField
  ): Promise<number> {
    if (this.error) throw this.error;
    return this.reports[field].shift() ?? 0;
  }

  async deleteModerationDedupPage(
    _uid: string,
    field: ModerationDedupIdentityField
  ): Promise<number> {
    return this.dedup[field].shift() ?? 0;
  }

  async anonymizeAgeReverificationCasesPage(
    _uid: string,
    field: AgeReverificationIdentityField
  ): Promise<number> {
    return this.ageCases[field].shift() ?? 0;
  }

  async anonymizeComplianceAuditPage(
    _uid: string,
    field: ComplianceAuditIdentityField
  ): Promise<number> {
    return this.compliance[field].shift() ?? 0;
  }

  async anonymizeAdminLogsPage(
    _uid: string,
    field: AdminLogIdentityField
  ): Promise<number> {
    return this.adminLogs[field].shift() ?? 0;
  }
}

test('moderation retention pseudonymizes evidence and removes operational dedup', async () => {
  const adapter = new FakeModerationEvidenceAdapter();
  adapter.reports.reporterUid = [3];
  adapter.reports.targetOwnerUid = [2];
  adapter.reports.targetAuthorUid = [1];
  adapter.reports.targetId = [1];
  adapter.reports.reviewedBy = [1];
  adapter.dedup.reporterUid = [2];
  adapter.dedup.targetUid = [1];
  adapter.ageCases.targetUid = [1];
  adapter.ageCases.requestedBy = [1];
  adapter.ageCases.reviewedBy = [1];
  adapter.compliance.uid = [2];
  adapter.compliance.actorUid = [1];
  adapter.adminLogs.adminUid = [1];
  adapter.adminLogs.targetUserUid = [2];

  const result = await executeModerationEvidenceRetentionDomain(adapter, {
    uid: 'moderation-user',
    pageSize: 20,
    maxPagesPerStep: 3,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.processed, 20);
  assert.deepEqual(result.details, {
    reportsAnonymized: 8,
    dedupDocumentsDeleted: 3,
    ageCasesAnonymized: 3,
    complianceAuditRecordsAnonymized: 3,
    adminLogsAnonymized: 3,
    documentaryStorageAssetsProcessed: 0,
  });
});

test('moderation retention remains partial at pagination limit', async () => {
  const adapter = new FakeModerationEvidenceAdapter();
  adapter.reports.reporterUid = [2, 2];

  const result = await executeModerationEvidenceRetentionDomain(adapter, {
    uid: 'moderation-pagination-user',
    pageSize: 2,
    maxPagesPerStep: 2,
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.blocker, 'pagination-limit-reached');
  assert.equal(result.details?.['reportsAnonymized'], 4);
});

test('moderation retention isolates adapter failures', async () => {
  const adapter = new FakeModerationEvidenceAdapter();
  adapter.error = Object.assign(new Error('moderation query unavailable'), {
    code: 'firestore/unavailable',
  });

  const result = await executeModerationEvidenceRetentionDomain(adapter, {
    uid: 'moderation-error-user',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'firestore/unavailable');
  assert.equal(
    result.details?.['errorMessage'],
    'moderation query unavailable'
  );
});

test('invalid uid fails before moderation evidence queries', async () => {
  const adapter = new FakeModerationEvidenceAdapter();

  const result = await executeModerationEvidenceRetentionDomain(adapter, {
    uid: '../invalid',
  });

  assert.equal(result.status, 'failed');
  assert.deepEqual(adapter.reports.reporterUid, [0]);
  assert.deepEqual(adapter.dedup.reporterUid, [0]);
  assert.deepEqual(adapter.ageCases.targetUid, [0]);
});
