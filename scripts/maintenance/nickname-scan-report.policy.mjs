// Pure shared report contract used by both registration cutover scanners.
export function shouldInspectNextDocument({ scanned, limit }) {
  if (!Number.isSafeInteger(scanned) || scanned < 0 ||
    !Number.isSafeInteger(limit) || limit < 1 || scanned > limit) {
    throw new Error('Invalid scan limit/counter');
  }
  return scanned === limit;
}

export function buildNicknameScanReport({
  projectId, mode, limit, truncated, startedAt, completedAt,
  counters, gate,
}) {
  if (!/^[a-z0-9][a-z0-9-]{3,62}$/.test(projectId) ||
    !['READ_ONLY', 'DRY_RUN', 'APPLY'].includes(mode) ||
    !Number.isSafeInteger(limit) || limit < 1 ||
    typeof truncated !== 'boolean' ||
    !Number.isFinite(Date.parse(startedAt)) ||
    !Number.isFinite(Date.parse(completedAt)) ||
    Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new Error('Invalid nickname scan report');
  }
  const safeCounters = {};
  for (const [key, value] of Object.entries(counters ?? {})) {
    if (key === 'flags') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Invalid aggregate flags');
      }
      const flags = {};
      for (const [flag, count] of Object.entries(value)) {
        if (!/^[A-Z][A-Z0-9_]{1,70}$/.test(flag) ||
          !Number.isSafeInteger(count) || count < 0) {
          throw new Error('Invalid aggregate flag');
        }
        flags[flag] = count;
      }
      safeCounters.flags = flags;
    } else {
      if (!/^[a-zA-Z][a-zA-Z0-9]{1,70}$/.test(key) ||
        !Number.isSafeInteger(value) || value < 0) {
        throw new Error('Only aggregate numeric counters are allowed');
      }
      safeCounters[key] = value;
    }
  }
  const output = {
    schemaVersion: 1, projectId, mode, truncated,
    startedAt, completedAt, ...safeCounters,
  };
  if (gate) {
    if (typeof gate.inventoryClean !== 'boolean' ||
      !Array.isArray(gate.reasons) ||
      gate.reasons.some(reason => typeof reason !== 'string')) {
      throw new Error('Invalid inventory gate');
    }
    output.inventoryClean = gate.inventoryClean;
    output.reasons = [...gate.reasons];
  }
  return output;
}
