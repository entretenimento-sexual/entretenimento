// Pure classification for a legacy nickname-index backfill.
// Do not attempt to repair conflicting records or infer identity from email.
export function classifyNicknameBackfill(input) {
  const { indexId, indexData, userData, reservationData, normalizeNickname } = input;
  const key = typeof indexId === 'string' && indexId.startsWith('nickname:')
    ? indexId.slice('nickname:'.length)
    : '';
  const uid = typeof indexData?.uid === 'string' ? indexData.uid : '';
  if (!/^[a-z0-9._-]{3,40}$/.test(key) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(uid) ||
      indexData?.type !== 'nickname' ||
      indexData?.value !== key ||
      !userData || userData.uid !== uid) {
    return 'invalid';
  }
  const normalized = normalizeNickname(userData.nickname);
  if (!normalized || normalized.key !== key) return 'invalid';
  if (reservationData) {
    return reservationData.uid === uid && reservationData.key === key &&
      reservationData.state === 'RESERVED'
      ? 'already'
      : 'conflict';
  }
  return 'candidate';
}
