// Read-only evidence shape validation. This never queries telemetry or attests
// the authenticity of a report. Operational owners must inspect source logs.
const HOUR_MS = 60 * 60 * 1000;
const MIN_HOURS = 30 * 24;
const MAX_HOURS = 62 * 24;
const HOURLY_KEYS = Object.freeze([
  'hourStart', 'dataWriteMonitoringActive',
  'acceptedWriteCoverageComplete', 'deniedWriteCoverageComplete',
  'clientAttributionComplete', 'registrationCompletionPathsCovered',
  'nicknameIndexPathsCovered', 'legacyCompletionWriteAttempts',
  'unattributedCompletionWriteAttempts',
]);
const REQUIRED_TRUE = HOURLY_KEYS.slice(1, 7);

export function validateNicknameLegacyHourlyCoverage(observation) {
  const issues = [];
  const rows = observation?.hourlyCoverage;
  const start = Date.parse(observation?.startedAt ?? '');
  const end = Date.parse(observation?.completedAt ?? '');
  if (!Array.isArray(rows) || rows.length < MIN_HOURS ||
    rows.length > MAX_HOURS) {
    return ['LEGACY_HOURLY_COVERAGE_MISSING'];
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) ||
    start % HOUR_MS !== 0 || end % HOUR_MS !== 0 ||
    end - start < MIN_HOURS * HOUR_MS ||
    rows.length !== (end - start) / HOUR_MS) {
    return ['LEGACY_HOURLY_WINDOW_INVALID'];
  }
  let continuityFailed = false;
  let coverageFailed = false;
  let invalidCount = false;
  let unsafeFields = false;
  let legacyTotal = 0;
  let unattributedTotal = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      unsafeFields = true;
      break;
    }
    if (Object.keys(row).some(key => !HOURLY_KEYS.includes(key))) {
      unsafeFields = true;
    }
    if (row.hourStart !== new Date(start + i * HOUR_MS).toISOString()) {
      continuityFailed = true;
    }
    if (REQUIRED_TRUE.some(key => row[key] !== true)) {
      coverageFailed = true;
    }
    const legacy = row.legacyCompletionWriteAttempts;
    const unknown = row.unattributedCompletionWriteAttempts;
    if (!Number.isSafeInteger(legacy) || legacy < 0 ||
      !Number.isSafeInteger(unknown) || unknown < 0) {
      invalidCount = true;
    } else {
      legacyTotal += legacy;
      unattributedTotal += unknown;
    }
  }
  if (unsafeFields) issues.push('LEGACY_HOURLY_UNSAFE_OR_UNKNOWN_FIELDS');
  if (continuityFailed) issues.push('LEGACY_HOURLY_GAPS_OR_DUPLICATES');
  if (coverageFailed) issues.push('LEGACY_HOURLY_MONITORING_GAPS');
  if (invalidCount || !Number.isSafeInteger(legacyTotal) ||
    !Number.isSafeInteger(unattributedTotal)) {
    issues.push('LEGACY_HOURLY_COUNTERS_INVALID');
  } else if (legacyTotal !== observation.legacyCompletionWriteAttempts ||
    unattributedTotal !== observation.unattributedCompletionWriteAttempts) {
    issues.push('LEGACY_HOURLY_TOTALS_MISMATCH');
  }
  if (legacyTotal !== 0 || unattributedTotal !== 0) {
    issues.push('LEGACY_HOURLY_WRITE_ATTEMPTS_DETECTED');
  }
  return issues;
}
