// Explicit opt-in, zero mutations. gcloud only reads Cloud Resource Manager
// project metadata / ancestry / parent IAM policy and emits aggregate results.
import { spawnReadOnlyGcloud } from './nickname-gcloud-invocation.mjs';
import { classifyNicknameLoggingCliFailure } from './nickname-firestore-logging-preflight.policy.mjs';
import {
  normalizeNicknameCloudAncestor, assessNicknameCloudAuditInheritance,
} from './nickname-firestore-audit-inheritance.policy.mjs';

const projectId = String(process.env.FIREBASE_PROJECT_ID ?? '').trim();
if (!/^[a-z0-9][a-z0-9-]{3,62}$/.test(projectId) ||
  projectId.startsWith('demo-') || process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIREBASE_PROJECT_ID real e sem emulador é obrigatório.');
}
const reads = {};
function readJson(name, args) {
  const result = spawnReadOnlyGcloud([...args, '--format=json']);
  if (result.error || result.status !== 0) {
    reads[name] = classifyNicknameLoggingCliFailure({
      errorCode: result.error?.code, stderr: result.stderr, signal: result.signal,
    });
    return null;
  }
  try {
    reads[name] = 'ok';
    return JSON.parse(result.stdout);
  } catch {
    reads[name] = 'invalid_response';
    return null;
  }
}
const projectDetails = readJson('project', ['projects', 'describe', projectId]);
const ancestry = readJson('ancestry', ['projects', 'get-ancestors', projectId]);
const parentReads = [];
if (Array.isArray(ancestry) && ancestry.length <= 16) {
  // Do not query parent IDs unless the chain contains exactly the authorized
  // project, and its numeric project ID was verified against project metadata.
  const chain = ancestry.map(normalizeNicknameCloudAncestor);
  const number = String(projectDetails?.projectNumber ?? '');
  const projectMatches = projectDetails?.projectId === projectId &&
    /^\d{1,30}$/.test(number) &&
    chain.filter(x => x?.type === 'project' &&
      (x.id === number || x.id === projectId)).length === 1 &&
    chain.every(Boolean);
  if (projectMatches) {
    for (const parent of chain.filter(x => x.type !== 'project')) {
      const name = 'parent_' + parentReads.length;
      const args = parent.type === 'folder'
        ? ['resource-manager', 'folders', 'get-iam-policy', parent.id]
        : ['organizations', 'get-iam-policy', parent.id];
      const iamPolicy = readJson(name, args);
      parentReads.push({ type: parent.type, source: reads[name], iamPolicy });
    }
  }
}
const result = assessNicknameCloudAuditInheritance({
  projectId, projectDetails, ancestry,
  projectState: reads.project,
  ancestryState: reads.ancestry,
  parentReads,
});
console.log(JSON.stringify(result, null, 2));
// Status always requires independent security/privacy review; tool never
// authorizes deployment or starts D0.
process.exitCode = result.status === 'INCOMPLETE' ? 2 : 0;
