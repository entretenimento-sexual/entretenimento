// Read-only assessment of Cloud IAM audit policy inheritance.
// Only aggregate signals are returned; never return IAM bindings, principals,
// folder IDs, organization IDs, tokens, resource names or raw policy content.
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{3,62}$/;
const NUMERIC_ID = /^\d{1,30}$/;
const MAX_LEVELS = 16;

export function normalizeNicknameCloudAncestor(raw) {
  const x = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw.resourceId ?? raw) : null;
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const kind = String(x.type ?? '').toLowerCase();
  const type = kind === 'projects' ? 'project'
    : kind === 'folders' ? 'folder'
    : kind === 'organizations' ? 'organization' : kind;
  const id = typeof x.id === 'string' ? x.id
    : Number.isSafeInteger(x.id) && x.id > 0 ? String(x.id) : '';
  if (!['project', 'folder', 'organization'].includes(type) ||
    !id || (type !== 'project' && !NUMERIC_ID.test(id))) return null;
  return { type, id };
}

function relevantWriteConfigs(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) ||
    (Object.hasOwn(policy, 'auditConfigs') &&
      !Array.isArray(policy.auditConfigs))) return null;
  const configs = policy.auditConfigs ?? [];
  return configs.filter(c => c?.service === 'datastore.googleapis.com' ||
      c?.service === 'allServices')
    .flatMap(c => Array.isArray(c.auditLogConfigs) ? c.auditLogConfigs : [])
    .filter(c => c?.logType === 'DATA_WRITE');
}

export function assessNicknameCloudAuditInheritance({
  projectId, projectDetails, ancestry, projectState = 'not_checked',
  ancestryState = 'not_checked', parentReads = [],
  collectedAt = new Date().toISOString(),
} = {}) {
  if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId) ||
    projectId.startsWith('demo-')) {
    throw new Error('Projeto Firebase real e autorizado obrigatório.');
  }
  const reasons = [];
  const projectNumber = String(projectDetails?.projectNumber ?? '');
  const projectVerified = projectState === 'ok' &&
    projectDetails?.projectId === projectId &&
    NUMERIC_ID.test(projectNumber);
  if (!projectVerified) reasons.push('PROJECT_DESCRIPTION_NOT_VERIFIED');

  const records = Array.isArray(ancestry) && ancestry.length > 0 &&
    ancestry.length <= MAX_LEVELS &&
    ancestryState === 'ok'
    ? ancestry.map(normalizeNicknameCloudAncestor) : null;
  if (!records || records.some(x => x === null)) {
    reasons.push('ANCESTRY_NOT_VERIFIED');
  }
  const valid = records && records.every(Boolean) ? records : [];
  const self = valid.filter(x => x.type === 'project');
  const projectInChain = projectVerified && self.length === 1 &&
    [projectId, projectNumber].includes(self[0].id);
  if (!projectInChain) reasons.push('PROJECT_IDENTITY_MISMATCH_IN_ANCESTRY');
  const parents = valid.filter(x => x.type !== 'project');
  const identifiers = valid.map(x => x.type + '/' + x.id);
  if (new Set(identifiers).size !== identifiers.length) {
    reasons.push('DUPLICATE_ANCESTRY_RESOURCES');
  }
  if (!Array.isArray(parentReads) || parentReads.length !== parents.length) {
    reasons.push('PARENT_POLICY_COVERAGE_INCOMPLETE');
  }
  let readableParents = 0;
  let missingOrDeniedParents = 0;
  let inheritedDataWriteScopes = 0;
  let inheritedExemptions = 0;
  const levels = [];
  for (let i = 0; i < parents.length; i++) {
    const source = Array.isArray(parentReads) ? parentReads[i] : null;
    const validSource = source?.type === parents[i].type &&
      source?.source === 'ok';
    const configs = validSource ? relevantWriteConfigs(source.iamPolicy) : null;
    const verified = configs !== null;
    if (!verified) {
      missingOrDeniedParents++;
      reasons.push('PARENT_AUDIT_POLICY_UNVERIFIED');
    } else {
      readableParents++;
      if (configs.length > 0) inheritedDataWriteScopes++;
      if (configs.some(c => c?.exemptedMembers != null &&
          (!Array.isArray(c.exemptedMembers) ||
           c.exemptedMembers.length > 0))) {
        inheritedExemptions++;
      }
    }
    levels.push({
      type: parents[i].type, policyReadable: verified,
      dataWriteConfigured: verified ? configs.length > 0 : null,
    });
  }
  if (inheritedDataWriteScopes > 0) {
    reasons.push('INHERITED_DATA_WRITE_REQUIRES_REVIEW');
  }
  if (inheritedExemptions > 0) {
    reasons.push('INHERITED_EXEMPTIONS_REQUIRE_REVIEW');
  }
  // This is an inventory, never a certification of write/denial coverage,
  // privacy, retention, cost, operational monitoring or release readiness.
  reasons.push('SINKS_RETENTION_PRIVACY_AND_COST_REQUIRE_REVIEW');
  reasons.push('CONTROLLED_WRITE_AND_DENIED_LOG_COVERAGE_UNPROVEN');

  const complete = projectInChain && !!records &&
    identifiers.length === new Set(identifiers).size &&
    Array.isArray(parentReads) && parentReads.length === parents.length &&
    missingOrDeniedParents === 0;
  return Object.freeze({
    schemaVersion: 1, mode: 'READ_ONLY',
    projectId, collectedAt,
    status: complete ? 'INVENTORY_COMPLETE_REVIEW_REQUIRED' : 'INCOMPLETE',
    observationStarted: false, deploymentAuthorized: false,
    summary: {
      projectVerified, ancestryVerified: !!records,
      hasParents: parents.length > 0, parentCount: parents.length,
      folderCount: parents.filter(x => x.type === 'folder').length,
      organizationCount: parents.filter(x => x.type === 'organization').length,
      verifiedParentPolicies: readableParents,
      unverifiedParentPolicies: missingOrDeniedParents,
      inheritedDataWriteScopes,
      inheritedExemptionScopes: inheritedExemptions,
    },
    levels, reasons: [...new Set(reasons)],
  });
}
