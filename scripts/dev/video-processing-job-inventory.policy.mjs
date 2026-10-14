// Pure read-only inventory rules. No Firebase clients or write operations here.
const ACTIVE = new Set(['QUEUED', 'SUBMITTING', 'PROCESSING']);
const STATES = new Set([
  ...ACTIVE, 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED',
]);

const validEpoch = value =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const present = (record, key) =>
  Object.prototype.hasOwnProperty.call(record, key);

export function inspectVideoProcessingJob(record, now) {
  const job = record && typeof record === 'object' ? record : {};
  const state = STATES.has(job.state) ? job.state : 'UNKNOWN';
  const hasDue = present(job, 'nextAttemptAt');
  const missingDue = !hasDue;
  const invalidDue = hasDue && !validEpoch(job.nextAttemptAt);
  const missingLease = state === 'SUBMITTING' &&
    !validEpoch(job.leaseUntil);
  const expiredLease = state === 'SUBMITTING' &&
    validEpoch(job.leaseUntil) && job.leaseUntil <= now;
  const missingExternalJob = state === 'PROCESSING' &&
    (typeof job.externalJobName !== 'string' ||
      job.externalJobName.trim().length === 0);
  const validVersion = typeof job.processingVersion === 'string' &&
    /^[a-zA-Z0-9:_-]{1,128}$/.test(job.processingVersion);
  return {
    state,
    missingDue: ACTIVE.has(state) && missingDue,
    invalidDue: ACTIVE.has(state) && invalidDue,
    processingLegacyMissingDue: state === 'PROCESSING' && missingDue,
    repairCandidate: state === 'PROCESSING' && missingDue && validVersion,
    submittingMissingLease: missingLease,
    submittingExpiredLease: expiredLease,
    processingMissingExternalJob: missingExternalJob,
  };
}

export function createVideoProcessingInventory() {
  return {
    scanned: 0,
    states: {},
    missingNextAttemptAt: {},
    invalidNextAttemptAt: {},
    processingLegacyMissingDue: 0,
    repairCandidates: 0,
    submittingMissingLease: 0,
    submittingExpiredLease: 0,
    processingMissingExternalJob: 0,
  };
}

export function addVideoProcessingJobToInventory(inventory, data, now) {
  const classification = inspectVideoProcessingJob(data, now);
  inventory.scanned += 1;
  inventory.states[classification.state] =
    (inventory.states[classification.state] ?? 0) + 1;

  for (const [flag, field] of [
    ['missingDue', 'missingNextAttemptAt'],
    ['invalidDue', 'invalidNextAttemptAt'],
  ]) {
    if (!classification[flag]) continue;
    inventory[field][classification.state] =
      (inventory[field][classification.state] ?? 0) + 1;
  }

  if (classification.processingLegacyMissingDue) inventory.processingLegacyMissingDue += 1;
  if (classification.repairCandidate) inventory.repairCandidates += 1;
  if (classification.submittingMissingLease) inventory.submittingMissingLease += 1;
  if (classification.submittingExpiredLease) inventory.submittingExpiredLease += 1;
  if (classification.processingMissingExternalJob) inventory.processingMissingExternalJob += 1;
  return inventory;
}
