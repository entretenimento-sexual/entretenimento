import { FieldPath } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { NICKNAME_INDEX_PREFIX, resolveNicknameNormalized } from '../public_index/nickname-key.policy';
import {
  getNicknameIndexOwner, nicknameIndexRef, NICKNAME_INDEX_COLLECTION,
} from '../public_index/nickname-index.service';

import {
  normalizeRegistrationNickname, normalizeRegistrationNicknameClaim,
  registrationNicknamePrincipal, type RegistrationNickname,
} from './nickname-reservation.policy';

export type PublicNicknameAvailability = 'taken' | 'available';
const MAX_ALIAS_CANDIDATES = 100;

export async function resolvePublicNicknameAvailability(
  db: FirebaseFirestore.Firestore, nickname: RegistrationNickname,
): Promise<PublicNicknameAvailability> {
  const index = await nicknameIndexRef(db, nickname.key).get();
  // Um documento presente impede nova reserva, mesmo sem projeção pública.
  if (index.exists || await hasNicknameOwnerWithoutIndex(db, nickname)) return 'taken';
  return 'available';
}

export async function canPublishNicknameIndex(
  db: FirebaseFirestore.Firestore, tx: FirebaseFirestore.Transaction,
  index: FirebaseFirestore.DocumentSnapshot | null, uid: string,
  profile: { uid?: unknown; nickname?: unknown; nicknameNormalized?: unknown },
): Promise<boolean> {
  const key = resolveNicknameNormalized(profile);
  if (profile.uid !== uid || !index || index.id !== NICKNAME_INDEX_PREFIX + key) return false;
  if (index.exists) return getNicknameIndexOwner(index) === uid;
  const display = typeof profile.nickname === 'string' ? profile.nickname : '';
  try {
    return !await hasNicknameOwnerWithoutIndex(db, { display, key }, { tx, uid });
  } catch (error) {
    if (error instanceof HttpsError && error.code === 'unavailable') return false;
    throw error;
  }
}

export async function hasNicknameOwnerWithoutIndex(
  db: FirebaseFirestore.Firestore,
  nickname: RegistrationNickname,
  current?: { tx: FirebaseFirestore.Transaction; uid: string },
): Promise<boolean> {
  // A chave na conta protege o titular quando o índice público é retirado.
  const ownersQuery = db.collection('users')
    .where('nicknameNormalized', '==', nickname.key).select().limit(current ? 2 : 1);
  const owners = await (current ? current.tx.get(ownersQuery) : ownersQuery.get());
  if (owners.docs.some(owner => owner.id !== current?.uid)) return true;

  if (normalizeRegistrationNicknameClaim(nickname.display)?.key !== nickname.key) return false;

  // O apelido completo de uma conta histórica pode continuar reservado na
  // conta privada após suspensão, sem uma entrada no índice público.
  const prefix = `${nickname.key}_`;
  const privateAliases = db.collection('users').orderBy('nicknameNormalized')
    .startAt(prefix).endAt(prefix + '\uf8ff').select('nickname').limit(MAX_ALIAS_CANDIDATES + 1);
  const indexedAliases = db.collection(NICKNAME_INDEX_COLLECTION).orderBy(FieldPath.documentId())
    .startAt(NICKNAME_INDEX_PREFIX + prefix).endAt(NICKNAME_INDEX_PREFIX + prefix + '\uf8ff')
    .select('uid').limit(MAX_ALIAS_CANDIDATES + 1);
  const [accounts, aliases] = await Promise.all([
    current ? current.tx.get(privateAliases) : privateAliases.get(),
    current ? current.tx.get(indexedAliases) : indexedAliases.get(),
  ]);
  const ownsPrincipal = (profile: FirebaseFirestore.DocumentSnapshot) => {
    const display = normalizeRegistrationNickname(profile.get('nickname'))?.display;
    return !!display && registrationNicknamePrincipal(display) === nickname.key;
  };
  if (accounts.docs.some(profile => profile.id !== current?.uid && ownsPrincipal(profile))) return true;
  if (accounts.docs.length > MAX_ALIAS_CANDIDATES || aliases.docs.length > MAX_ALIAS_CANDIDATES) {
    throw new HttpsError('unavailable', 'Não foi possível confirmar esse apelido agora. Tente novamente.');
  }
  const uids = new Set<string>();
  for (const alias of aliases.docs) {
    const uid = alias.get('uid');
    if (typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid) && uid !== current?.uid) {
      uids.add(uid);
    }
  }
  if (!uids.size) return false;

  const refs = Array.from(uids, uid => db.collection('users').doc(uid));
  const mask = { fieldMask: ['nickname'] };
  const profiles = await (current ? current.tx.getAll(...refs, mask) : db.getAll(...refs, mask));
  return profiles.some(ownsPrincipal);
}
