// Read-only classification of the current index and its owner.
export function classifyNicknameIndex(input) {
  const { indexId, indexData, userData, normalizeNickname } = input;
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
  const normalized = normalizeNickname(userData.nickname, userData.nicknameNormalized);
  if (!normalized || normalized.key !== key) return 'invalid';
  return 'already';
}
