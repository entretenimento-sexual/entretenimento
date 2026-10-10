// Diagnóstico sob demanda, somente leitura. Não é exportado como Cloud Function.
// Um chamador administrativo deve fornecer um Firestore Admin autenticado.
// Não consulta subcoleções de mensagens e não persiste relatórios.
import type {
  Firestore, DocumentData, DocumentSnapshot, QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { buildDirectChatPairIdentity, ENSURE_DIRECT_CHAT_LEGACY_SCAN_LIMIT } from '../domain/direct-chat.policy';
import {
  auditDirectChatPair, type DirectChatAuditCandidate, type DirectChatAuditResult,
} from '../domain/direct-chat-reconciliation.audit';

export interface DirectChatReadOnlyReport extends DirectChatAuditResult {
  inspectedDocuments: number;
  boundedQuery: true;
}

function candidate(
  snapshot: DocumentSnapshot<DocumentData> | QueryDocumentSnapshot<DocumentData>
): DirectChatAuditCandidate {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    participants: data.participants,
    participantsKey: data.participantsKey,
    isRoom: data.isRoom,
    conversationType: data.conversationType,
    conversationStatus: data.conversationStatus,
  };
}

/**
 * Auditoria de UM par informado explicitamente. Limita a consulta histórica
 * a 11 documentos (o mesmo limite do resolver) e faz no máximo cinco leituras
 * pontuais adicionais de chat e duas de registry. Não varre usuários.
 */
export async function readDirectChatReconciliation(
  firestore: Pick<Firestore, 'collection'>,
  participants: [string, string]
): Promise<DirectChatReadOnlyReport> {
  const identity = buildDirectChatPairIdentity(...participants);
  const registries = firestore.collection('direct_chat_pairs');
  const chats = firestore.collection('chats');
  const [v2Registry, v1Registry, indexed] = await Promise.all([
    registries.doc(identity.canonicalHash).get(),
    registries.doc(identity.legacyHash).get(),
    chats.where('participantsKey', '==', identity.legacyKey)
      .limit(ENSURE_DIRECT_CHAT_LEGACY_SCAN_LIMIT).get(),
  ]);
  const canonicalRegistryChatId = v2Registry.exists
    ? v2Registry.data()?.chatId : undefined;
  const legacyRegistryChatId = v1Registry.exists
    ? v1Registry.data()?.chatId : undefined;
  // Não confiar em IDs malformados obtidos de documentos históricos.
  const validId = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0
    && value.length <= 128 && !value.includes('/');
  const ids = new Set<string>([
    `direct_${identity.canonicalHash}`,
    `direct_${identity.legacyHash}`,
  ]);
  if (validId(canonicalRegistryChatId)) ids.add(canonicalRegistryChatId);
  if (validId(legacyRegistryChatId)) ids.add(legacyRegistryChatId);
  const refs = [...ids];
  const snapshots = await Promise.all(refs.map((id) => chats.doc(id).get()));
  const verifiedReferences: Record<string, boolean> = {};
  const documents = new Map<string, DirectChatAuditCandidate>();
  for (const doc of indexed.docs) documents.set(doc.id, candidate(doc));
  for (const doc of snapshots) {
    verifiedReferences[doc.id] = doc.exists;
    if (doc.exists) documents.set(doc.id, candidate(doc));
  }
  const result = auditDirectChatPair({
    participants: identity.participants,
    chats: [...documents.values()],
    canonicalRegistryChatId: validId(canonicalRegistryChatId) ? canonicalRegistryChatId : undefined,
    legacyRegistryChatId: validId(legacyRegistryChatId) ? legacyRegistryChatId : undefined,
    verifiedReferences,
    truncated: indexed.size >= ENSURE_DIRECT_CHAT_LEGACY_SCAN_LIMIT,
  });
  // Um registry presente com ID inválido precisa de revisão, jamais de adoção.
  if ((v2Registry.exists && !validId(canonicalRegistryChatId))
    || (v1Registry.exists && !validId(legacyRegistryChatId))) {
    result.findings = [...new Set([...result.findings, 'REFERENCE_NOT_VERIFIED' as const])].sort();
    result.requiresManualReview = true;
  }
  return {
    ...result,
    inspectedDocuments: documents.size,
    boundedQuery: true,
  };
}
