import { FieldValue } from '../../firebaseApp';

/**
 * Sinal privado de invalidação da lista de amizades, não de autorização.
 * Alterar na mesma transação das arestas. Não recriar contas ausentes.
 */
export function stageFriendshipMembershipInvalidation(
  tx: FirebaseFirestore.Transaction,
  ...owners: FirebaseFirestore.DocumentSnapshot[]
): void {
  for (const owner of owners) {
    if (owner.exists) {
      tx.update(owner.ref, { friendshipMembershipRevision: FieldValue.increment(1) });
    }
  }
}
