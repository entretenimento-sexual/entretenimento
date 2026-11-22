import { FieldValue } from 'firebase-admin/firestore';
import { isNicknameIndexKey, NICKNAME_INDEX_PREFIX } from './nickname-key.policy';

export const NICKNAME_INDEX_COLLECTION = 'public_index';

export function nicknameIndexRef(db: FirebaseFirestore.Firestore, key: string) {
  return db.collection(NICKNAME_INDEX_COLLECTION).doc(NICKNAME_INDEX_PREFIX + key);
}

export function readNicknameIndex(
  db: FirebaseFirestore.Firestore, tx: FirebaseFirestore.Transaction, key: string,
): Promise<FirebaseFirestore.DocumentSnapshot | null> {
  return isNicknameIndexKey(key) ? tx.get(nicknameIndexRef(db, key)) : Promise.resolve(null);
}

export function getNicknameIndexOwner(index: FirebaseFirestore.DocumentSnapshot): string | undefined {
  if (!index.exists) return undefined;
  const uid = index.get('uid');
  // Um índice existente com titular inválido exige conciliação.
  return typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : '';
}

function indexKey(index: FirebaseFirestore.DocumentSnapshot): string {
  return index.ref.parent.path === NICKNAME_INDEX_COLLECTION && index.id.startsWith(NICKNAME_INDEX_PREFIX)
    ? index.id.slice(NICKNAME_INDEX_PREFIX.length) : '';
}

export function writeNicknameIndex(
  tx: FirebaseFirestore.Transaction, index: FirebaseFirestore.DocumentSnapshot, uid: string,
  previousCreatedAt?: unknown,
): boolean {
  const key = indexKey(index);
  const owner = getNicknameIndexOwner(index);
  if (!isNicknameIndexKey(key) || (owner !== undefined && owner !== uid)) return false;
  const current = index.data();
  if (current?.type === 'nickname' && current.value === key &&
      current.createdAt != null && current.lastChangedAt != null) return true;

  const now = FieldValue.serverTimestamp();
  const data = {
    uid, type: 'nickname', value: key,
    createdAt: current?.createdAt ?? previousCreatedAt ?? now,
    lastChangedAt: current?.lastChangedAt ?? now,
    updatedAt: now,
  };
  if (index.exists) tx.set(index.ref, data, { merge: true });
  else tx.create(index.ref, data);
  return true;
}

export function deleteOwnedNicknameIndex(
  tx: FirebaseFirestore.Transaction, index: FirebaseFirestore.DocumentSnapshot | null, uid: string,
): void {
  if (index && isNicknameIndexKey(indexKey(index)) && getNicknameIndexOwner(index) === uid) {
    tx.delete(index.ref);
  }
}
