// Anonymous availability never discloses a reservation or its owner.
// Pending, hidden, suspended and unoccupied keys are indistinguishable.
export type PublicNicknameAvailability = 'taken' | 'unconfirmed';

export function resolvePublicNicknameAvailability(input: {
  key: string;
  index?: FirebaseFirestore.DocumentData | null;
  owner?: FirebaseFirestore.DocumentData | null;
  publicProfile?: FirebaseFirestore.DocumentData | null;
}): PublicNicknameAvailability {
  const { key, index, owner, publicProfile } = input;
  if (!index || index['type'] !== 'nickname' || index['value'] !== key ||
    typeof index['uid'] !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(index['uid'])) return 'unconfirmed';
  const uid = index['uid'];
  if (!publicProfile || publicProfile['uid'] !== uid ||
    publicProfile['nicknameNormalized'] !== key) return 'unconfirmed';
  if (!owner || owner['uid'] !== uid || owner['profileCompleted'] !== true ||
    owner['accountStatus'] !== 'active' ||
    owner['publicVisibility'] !== 'visible' ||
    owner['interactionBlocked'] !== false ||
    owner['accountLocked'] === true ||
    owner['suspended'] === true ||
    owner['loginAllowed'] === false ||
    owner['deletionRequestedAt'] != null) return 'unconfirmed';
  return 'taken';
}
