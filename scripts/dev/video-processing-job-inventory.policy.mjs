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
  const cancelled = state === 'CANCEL_REQUESTED';
  const cancellationDue = cancelled && validEpoch(job.nextAttemptAt) &&
    job.nextAttemptAt <= now;
  const cancellationDeferred = cancelled && validEpoch(job.nextAttemptAt) &&
    job.nextAttemptAt > now;
  const cancellationReviewRequired = cancelled &&
    (job.cancellationReviewRequired === true ||
      job.lastErrorCode === 'CANCELLATION_UNCONFIRMED');
  const cancelledAt = job.cancelRequestedAt;
  const cancellationAgeMs = state === 'CANCEL_REQUESTED' &&
    validEpoch(cancelledAt) && cancelledAt <= now
    ? now - cancelledAt
    : null;
  const cancellationAgeBand = state !== 'CANCEL_REQUESTED'
    ? null
    : cancellationAgeMs === null
      ? 'UNKNOWN'
      : cancellationAgeMs < 90 * 60_000
        ? 'UNDER_90_MIN'
        : cancellationAgeMs < 24 * 60 * 60_000
          ? '90_MIN_TO_24_H'
          : 'OVER_24_H';
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
    cancellationAgeBand,
    cancellationOverdue24h: cancellationAgeBand === 'OVER_24_H' &&
      cancellationDue,
    cancellationDue,
    cancellationDeferred,
    cancellationReviewRequired,
    cancellationMissingDue: cancelled && missingDue,
    cancellationInvalidDue: cancelled && invalidDue,
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
    cancellationScheduling: {
      due: 0,
      overdue24h: 0,
      deferred: 0,
      missingDue: 0,
      invalidDue: 0,
      reviewRequired: 0,
    },
    cancellationAgeBands: {
      UNDER_90_MIN: 0,
      '90_MIN_TO_24_H': 0,
      OVER_24_H: 0,
      UNKNOWN: 0,
    },
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
  if (classification.cancellationAgeBand) {
    inventory.cancellationAgeBands[classification.cancellationAgeBand] += 1;
  }
  for (const [flag, metric] of [
    ['cancellationDue', 'due'],
    ['cancellationOverdue24h', 'overdue24h'],
    ['cancellationDeferred', 'deferred'],
    ['cancellationMissingDue', 'missingDue'],
    ['cancellationInvalidDue', 'invalidDue'],
    ['cancellationReviewRequired', 'reviewRequired'],
  ]) {
    if (classification[flag]) inventory.cancellationScheduling[metric] += 1;
  }
  return inventory;
}
