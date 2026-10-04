import {
  assertPlatformAccountAccessData,
} from '../../account_lifecycle/interaction-access.policy';
import { db } from '../../firebaseApp';

interface MediaAuthoringAccountSnapshot {
  accountStatus?: unknown;
  suspended?: unknown;
  interactionBlocked?: unknown;
  moderationAutomationHold?: {
    active?: unknown;
    expiresAtMs?: unknown;
  } | null;
  acceptedTerms?: unknown;
  adultConsent?: unknown;
}

export interface MediaAuthoringEligibilityDecision {
  readonly allowed: true;
}

/**
 * Fronteira canônica de autoria de mídia.
 *
 * Uma conta ativa e autorizada pode enviar/publicar. O nível de assurance
 * etário da conta não é copiado para a mídia nem reavaliado por Media.
 * Segurança sobre possível menor no conteúdo pertence ao pipeline de
 * moderação da própria mídia.
 */
export function assertMediaAuthoringEligibilityData(
  user: MediaAuthoringAccountSnapshot | null | undefined,
  _ageEligibilityRecord?: unknown,
  _uid?: string
): MediaAuthoringEligibilityDecision {
  assertPlatformAccountAccessData(user);
  return { allowed: true };
}

export async function assertMediaAuthoringEligibility(
  uid: string
): Promise<MediaAuthoringEligibilityDecision> {
  const normalizedUid = String(uid ?? '').trim();

  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalizedUid)) {
    throw new Error('Usuário não autenticado.');
  }

  const userSnapshot = await db.doc(`users/${normalizedUid}`).get();

  return assertMediaAuthoringEligibilityData(
    userSnapshot.exists
      ? userSnapshot.data() as MediaAuthoringAccountSnapshot
      : null
  );
}
