import { FieldPath } from 'firebase-admin/firestore';

import {
  normalizeRegistrationNickname, normalizeRegistrationNicknameClaim,
  registrationNicknamePrincipal, type RegistrationNickname,
} from './nickname-reservation.policy';

export type PublicNicknameAvailability = 'taken' | 'available';

export async function resolvePublicNicknameAvailability(
  db: FirebaseFirestore.Firestore, nickname: RegistrationNickname,
): Promise<PublicNicknameAvailability> {
  const index = await db.collection('public_index').doc(`nickname:${nickname.key}`).get();
  // Um documento presente impede nova reserva, mesmo sem projeção pública.
  if (index.exists || await hasNicknameOwnerWithoutIndex(db, nickname)) return 'taken';
  return 'available';
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

  // Distingue o alias de "Rafa Oficial" do principal independente "Rafa_Oficial".
  const prefix = `nickname:${nickname.key}_`;
  const aliasesQuery = db.collection('public_index').orderBy(FieldPath.documentId())
    .startAt(prefix).endAt(prefix + '\uf8ff').select('uid');
  const aliases = await (current ? current.tx.get(aliasesQuery) : aliasesQuery.get());
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
  return profiles.some(profile => {
    const display = normalizeRegistrationNickname(profile.get('nickname'))?.display;
    return !!display && registrationNicknamePrincipal(display) === nickname.key;
  });
}
