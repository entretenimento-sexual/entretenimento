import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { TERMS_ACCEPTANCE_VERSION } from '../compliance/platform-legal.constants';
import { db } from '../firebaseApp';

interface InteractionAccessUserDocument {
  accountStatus?: unknown;
  accountLocked?: unknown;
  loginAllowed?: unknown;
  suspended?: unknown;
  interactionBlocked?: unknown;
  moderationAutomationHold?: {
    active?: unknown;
    expiresAtMs?: unknown;
  } | null;
  acceptedTerms?: unknown;
}

export interface PlatformAccountAccessContext {
  readonly accessExpiresAtMs: number | null;
}

function cleanUid(value: unknown): string {
  const uid = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : '';
}

function hasCurrentTerms(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const terms = value as Record<string, unknown>;
  return terms['accepted'] === true &&
    String(terms['version'] ?? '').trim() === TERMS_ACCEPTANCE_VERSION &&
    terms['acknowledgedPrivacyNotice'] === true;
}

/**
 * Produto ativo = lifecycle + Termos vigentes. A admissão 18+ é verificada
 * antes de concluir o perfil; fatos etários novos materializam o lifecycle.
 * AdultConsent v1 permanece somente como histórico, sem efeito de autorização.
 */
export function assertPlatformAccountAccessData(
  user: InteractionAccessUserDocument | null | undefined
): void {
  if (!user) {
    throw new HttpsError('not-found', 'Conta não encontrada.');
  }

  const accountStatus = String(user.accountStatus ?? '')
    .trim()
    .toLowerCase();
  const holdExpiresAtMs = Number(
    user.moderationAutomationHold?.expiresAtMs ?? 0
  );
  const automationHoldActive =
    user.moderationAutomationHold?.active === true &&
    Number.isFinite(holdExpiresAtMs) &&
    Date.now() < holdExpiresAtMs;

  if (
    accountStatus !== 'active' ||
    user.accountLocked === true ||
    user.loginAllowed === false ||
    user.suspended === true ||
    user.interactionBlocked === true ||
    automationHoldActive
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Esta conta não pode realizar interações no momento.',
      {
        reason: automationHoldActive
          ? 'moderation_automation_hold'
          : 'account_interaction_blocked',
      }
    );
  }

  if (!hasCurrentTerms(user.acceptedTerms)) {
    throw new HttpsError(
      'failed-precondition',
      'Aceite os termos vigentes antes de realizar esta ação.',
      {
        reason: 'terms_required',
        recommendedAction: 'accept_terms',
      }
    );
  }

}

/**
 * A autorização em uso normal consulta o lifecycle materializado em users/{uid}.
 * Alterações de elegibilidade (inclusive menoridade confirmada) devem atualizar
 * o lifecycle transacionalmente na função de decisão etária, nunca consultar
 * age_eligibility_records a cada requisição social.
 */
export async function assertInteractionAccess(
  uid: string
): Promise<PlatformAccountAccessContext> {
  const normalizedUid = cleanUid(uid);
  if (!normalizedUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  const userSnapshot = await db
    .collection('users')
    .doc(normalizedUid)
    .get();

  assertPlatformAccountAccessData(
    userSnapshot.exists
      ? userSnapshot.data() as InteractionAccessUserDocument
      : null
  );

  return { accessExpiresAtMs: null };
}

export async function assertInteractionAccessInTransaction(
  transaction: Transaction,
  uid: string
): Promise<PlatformAccountAccessContext> {
  const normalizedUid = cleanUid(uid);
  if (!normalizedUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  const userSnapshot = await transaction.get(
    db.collection('users').doc(normalizedUid)
  );

  assertPlatformAccountAccessData(
    userSnapshot.exists
      ? userSnapshot.data() as InteractionAccessUserDocument
      : null
  );

  return { accessExpiresAtMs: null };
}
