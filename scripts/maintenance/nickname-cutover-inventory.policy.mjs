// Pure read-only inventory classification. No UID or nickname in output.
export const CUTOVER_FLAGS = Object.freeze([
  'INVALID_OWNER', 'INVALID_NICKNAME', 'MISSING_RESERVATION',
  'RESERVATION_CONFLICT', 'RESERVATION_INVALID',
  'PUBLIC_PROFILE_MISSING', 'PUBLIC_PROFILE_MISMATCH',
  'INDEX_MISSING', 'INDEX_CONFLICT', 'INDEX_INVALID',
  'HIDDEN_INDEX_STILL_PRESENT',
]);

export function classifyNicknameCutoverRecord({
  uid, user, publicProfile, index, reservation, normalizeNickname,
}) {
  if (user?.profileCompleted !== true) {
    return { category: 'INCOMPLETE', flags: [] };
  }
  if (typeof uid !== 'string' || user.uid !== uid) {
    return { category: 'REVIEW', flags: ['INVALID_OWNER'] };
  }
  const canonical = normalizeNickname(user.nickname);
  if (!canonical || !/^[a-z0-9._-]{3,40}$/.test(canonical.key)) {
    return { category: 'REVIEW', flags: ['INVALID_NICKNAME'] };
  }
  const flags = [];
  const key = canonical.key;
  if (!reservation) flags.push('MISSING_RESERVATION');
  else if (reservation.uid !== uid) flags.push('RESERVATION_CONFLICT');
  else if (reservation.key !== key || reservation.state !== 'RESERVED') {
    flags.push('RESERVATION_INVALID');
  }
  const visible = user.accountStatus === 'active' &&
    user.publicVisibility === 'visible' && user.interactionBlocked === false &&
    user.suspended !== true && user.accountLocked !== true;
  if (!visible) {
    if (index) flags.push('HIDDEN_INDEX_STILL_PRESENT');
    return { category: flags.length ? 'REVIEW' : 'NOT_PUBLIC', flags };
  }
  if (!publicProfile) flags.push('PUBLIC_PROFILE_MISSING');
  else if (publicProfile.uid !== uid ||
    publicProfile.nicknameNormalized !== key ||
    publicProfile.nickname !== user.nickname) {
    flags.push('PUBLIC_PROFILE_MISMATCH');
  }
  if (!index) flags.push('INDEX_MISSING');
  else if (index.uid !== uid) flags.push('INDEX_CONFLICT');
  else if (index.type !== 'nickname' || index.value !== key) {
    flags.push('INDEX_INVALID');
  }
  return { category: flags.length ? 'REVIEW' : 'READY', flags };
}

export function createNicknameCutoverSummary() {
  return {
    scannedUsers: 0, incompleteUsers: 0, completedUsers: 0,
    ready: 0, notPublic: 0, review: 0,
    flags: Object.fromEntries(CUTOVER_FLAGS.map(key => [key, 0])),
  };
}

export function accumulateNicknameCutover(summary, decision) {
  summary.scannedUsers++;
  if (decision.category === 'INCOMPLETE') {
    summary.incompleteUsers++;
    return summary;
  }
  summary.completedUsers++;
  if (decision.category === 'READY') summary.ready++;
  else if (decision.category === 'NOT_PUBLIC') summary.notPublic++;
  else summary.review++;
  for (const flag of decision.flags) {
    if (!Object.hasOwn(summary.flags, flag)) throw new Error('Unknown audit flag');
    summary.flags[flag]++;
  }
  return summary;
}

export function evaluateNicknameCutoverGate(summary, { truncated = true } = {}) {
  const reasons = [];
  if (truncated) reasons.push('INCOMPLETE_SCAN');
  if (!summary.completedUsers) reasons.push('NO_COMPLETED_ACCOUNTS_CHECKED');
  if (summary.review) reasons.push('REQUIRES_RECONCILIATION');
  return { inventoryClean: reasons.length === 0, reasons };
}
