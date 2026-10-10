// Classificador determinístico e somente leitura para inspeção de pares diretos.
// Não consulta Firestore, não manipula mensagens e não escolhe históricos vencedores.
import {
  buildDirectChatPairIdentity,
  isEligibleExistingDirectChat,
} from './direct-chat.policy';

export interface DirectChatAuditCandidate {
  id: string;
  participants?: unknown;
  participantsKey?: unknown;
  conversationType?: unknown;
  conversationStatus?: unknown;
  isRoom?: unknown;
}

export interface DirectChatAuditInput {
  participants: [string, string];
  chats: readonly DirectChatAuditCandidate[];
  canonicalRegistryChatId?: string | null;
  legacyRegistryChatId?: string | null;
  truncated?: boolean;
}

export type DirectChatAuditFinding =
  | 'SCAN_TRUNCATED'
  | 'MULTIPLE_HISTORIES'
  | 'CANONICAL_REGISTRY_MISSING_CHAT'
  | 'CANONICAL_REGISTRY_WRONG_PAIR'
  | 'LEGACY_REGISTRY_WRONG_PAIR'
  | 'DETERMINISTIC_ID_WRONG_PAIR'
  | 'LEGACY_KEY_COLLISION'
  | 'NO_ELIGIBLE_HISTORY'
  | 'SINGLE_ELIGIBLE_HISTORY';

export interface DirectChatAuditResult {
  pairHash: string;
  findings: DirectChatAuditFinding[];
  eligibleChatIds: string[];
  requiresManualReview: boolean;
}

export function auditDirectChatPair(input: DirectChatAuditInput): DirectChatAuditResult {
  const pair = buildDirectChatPairIdentity(...input.participants);
  const chats = new Map(input.chats.map((chat) => [chat.id, chat]));
  const eligible = [...chats.values()]
    .filter((chat) => isEligibleExistingDirectChat(chat, pair.participants))
    .map((chat) => chat.id).sort();
  const findings = new Set<DirectChatAuditFinding>();
  const canonicalId = `direct_${pair.canonicalHash}`;
  const legacyId = `direct_${pair.legacyHash}`;

  if (input.truncated) findings.add('SCAN_TRUNCATED');
  if (eligible.length > 1) findings.add('MULTIPLE_HISTORIES');
  if (eligible.length === 0) findings.add('NO_ELIGIBLE_HISTORY');
  if (eligible.length === 1) findings.add('SINGLE_ELIGIBLE_HISTORY');

  if (input.canonicalRegistryChatId) {
    const referenced = chats.get(input.canonicalRegistryChatId);
    if (!referenced) findings.add('CANONICAL_REGISTRY_MISSING_CHAT');
    else if (!isEligibleExistingDirectChat(referenced, pair.participants)) {
      findings.add('CANONICAL_REGISTRY_WRONG_PAIR');
    }
  }
  if (input.legacyRegistryChatId) {
    const referenced = chats.get(input.legacyRegistryChatId);
    if (referenced && !isEligibleExistingDirectChat(referenced, pair.participants)) {
      findings.add('LEGACY_REGISTRY_WRONG_PAIR');
    }
  }
  for (const chat of chats.values()) {
    if ((chat.id === canonicalId || chat.id === legacyId)
      && !isEligibleExistingDirectChat(chat, pair.participants)) {
      findings.add('DETERMINISTIC_ID_WRONG_PAIR');
    }
    if (chat.participantsKey === pair.legacyKey
      && !isEligibleExistingDirectChat(chat, pair.participants)) {
      findings.add('LEGACY_KEY_COLLISION');
    }
  }

  const manual = [...findings].some((finding) =>
    finding !== 'NO_ELIGIBLE_HISTORY' && finding !== 'SINGLE_ELIGIBLE_HISTORY'
  );
  return {
    pairHash: pair.canonicalHash,
    findings: [...findings].sort(),
    eligibleChatIds: eligible,
    requiresManualReview: manual,
  };
}
