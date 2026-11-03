import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeNicknameCloudAncestor, assessNicknameCloudAuditInheritance,
} from '../maintenance/nickname-firestore-audit-inheritance.policy.mjs';

const base = {
  projectId: 'entretenimento-sexual',
  projectDetails: {
    projectId: 'entretenimento-sexual', projectNumber: '123456789012',
  },
  projectState: 'ok', ancestryState: 'ok',
  ancestry: [{ type: 'project', id: '123456789012' }],
  parentReads: [],
  collectedAt: '2026-11-03T12:00:00.000Z',
};
const assess = (changes = {}) =>
  assessNicknameCloudAuditInheritance({ ...base, ...changes });
const parent = {
  source: 'ok',
  iamPolicy: {
    auditConfigs: [{
      service: 'datastore.googleapis.com',
      auditLogConfigs: [{ logType: 'DATA_WRITE' }],
    }],
  },
};

test('personal project without parent can inventory, never approve D0', () => {
  const report = assess();
  assert.equal(report.status, 'INVENTORY_COMPLETE_REVIEW_REQUIRED');
  assert.equal(report.summary.parentCount, 0);
  assert.equal(report.summary.inheritedDataWriteScopes, 0);
  assert.equal(report.observationStarted, false);
  assert.equal(report.deploymentAuthorized, false);
  assert.ok(report.reasons.includes('CONTROLLED_WRITE_AND_DENIED_LOG_COVERAGE_UNPROVEN'));
});

test('detects inherited Firestore DATA_WRITE and exemptions without identities', () => {
  const report = assess({
    ancestry: [
      { resourceId: { type: 'project', id: '123456789012' } },
      { resourceId: { type: 'folder', id: '888111' } },
      { resourceId: { type: 'organization', id: '999222' } },
    ],
    parentReads: [
      { type: 'folder', ...parent,
        iamPolicy: { auditConfigs: [{
          service: 'allServices',
          auditLogConfigs: [{ logType: 'DATA_WRITE',
            exemptedMembers: ['user:private@example.test'] }],
        }] } },
      { type: 'organization', ...parent },
    ],
  });
  assert.equal(report.status, 'INVENTORY_COMPLETE_REVIEW_REQUIRED');
  assert.equal(report.summary.parentCount, 2);
  assert.equal(report.summary.inheritedDataWriteScopes, 2);
  assert.equal(report.summary.inheritedExemptionScopes, 1);
  assert.ok(report.reasons.includes('INHERITED_DATA_WRITE_REQUIRES_REVIEW'));
  assert.ok(report.reasons.includes('INHERITED_EXEMPTIONS_REQUIRE_REVIEW'));
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes('888111'));
  assert.ok(!serialized.includes('999222'));
  assert.ok(!serialized.includes('private@example.test'));
});

test('missing parent IAM permissions fail closed; do not claim no inheritance', () => {
  const report = assess({
    ancestry: [
      { type: 'project', id: '123456789012' },
      { type: 'organization', id: '12345' },
    ],
    parentReads: [{ type: 'organization', source: 'permission_denied',
      iamPolicy: null }],
  });
  assert.equal(report.status, 'INCOMPLETE');
  assert.equal(report.summary.unverifiedParentPolicies, 1);
  assert.equal(report.levels[0].dataWriteConfigured, null);
  assert.ok(report.reasons.includes('PARENT_AUDIT_POLICY_UNVERIFIED'));
});

test('readable parent with no auditConfigs is not mistaken for read failure', () => {
  const report = assess({
    ancestry: [
      { type: 'project', id: '123456789012' },
      { type: 'organization', id: '12345' },
    ],
    parentReads: [{ type: 'organization', source: 'ok', iamPolicy: {} }],
  });
  assert.equal(report.status, 'INVENTORY_COMPLETE_REVIEW_REQUIRED');
  assert.equal(report.summary.inheritedDataWriteScopes, 0);
});

test('mismatched project / invalid ancestry cannot be certified', () => {
  for (const altered of [
    { projectDetails: { projectId: 'other', projectNumber: '123456789012' } },
    { ancestry: [{ type: 'project', id: 'other-id' }] },
    { ancestry: [] },
    { ancestry: null, ancestryState: 'permission_denied' },
    { ancestry: [{ type: 'project', id: '123456789012' },
      { type: 'project', id: '123456789012' }] },
    { ancestry: [{ type: 'project', id: '123456789012' },
      { type: 'organization', id: 'not-numeric' }] },
  ]) {
    const result = assess(altered);
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.deploymentAuthorized, false);
  }
});

test('normalizes resourceId nesting and rejects unsupported resources', () => {
  assert.deepEqual(
    normalizeNicknameCloudAncestor({
      resourceId: { type: 'organizations', id: 987 },
    }),
    { type: 'organization', id: '987' },
  );
  assert.equal(normalizeNicknameCloudAncestor({ type: 'billingAccount', id: 4 }), null);
  assert.equal(normalizeNicknameCloudAncestor({ type: 'folder', id: 'a123' }), null);
});

test('unknown IAM policy shapes never count as verified', () => {
  const report = assess({
    ancestry: [{ type: 'project', id: '123456789012' },
      { type: 'folder', id: '555' }],
    parentReads: [{ type: 'folder', source: 'ok',
      iamPolicy: { auditConfigs: 'not-an-array' } }],
  });
  assert.equal(report.status, 'INCOMPLETE');
  assert.equal(report.summary.verifiedParentPolicies, 0);
});

test('rejects demo and malformed cloud projects', () => {
  assert.throws(() => assess({ projectId: 'demo-entertainment' }));
  assert.throws(() => assess({ projectId: 'invalid; command' }));
});
