import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { REGISTRATION_FLOW_VERSION } from '../auth/user-registration-seed';
import { hasAcceptedCurrentTerms } from '../compliance/platform-legal.constants';
import { db } from '../firebaseApp';

interface InteractionAccessUserDocument {
  accountStatus?: unknown;
  accountLocked?: unknown;
  loginAllowed?: unknown;
  suspended?: unknown;
  interactionBlocked?: unknown;
  profileCompleted?: unknown;
  publicVisibility?: unknown;
  registrationCompletedAt?: unknown;
  registrationFlowVersion?: unknown;
  registrationSeedSource?: unknown;
  deletionRequestedAt?: unknown;
  deletedAt?: unknown;
  ageReverificationRestrictedAt?: unknown;
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

export function isRegistrationInteractionBlock(user: InteractionAccessUserDocument): boolean {
  return user.interactionBlocked === true &&
    user.profileCompleted === false &&
    user.registrationCompletedAt == null &&
    user.publicVisibility === 'hidden' &&
    user.loginAllowed === true &&
    (user.registrationFlowVersion === REGISTRATION_FLOW_VERSION ||
      user.registrationSeedSource === 'auth-trigger' ||
      user.registrationSeedSource === 'registration-recovery');
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

  const holdExpiresAtMs = Number(
    user.moderationAutomationHold?.expiresAtMs ?? 0
  );
  const automationHoldActive =
    user.moderationAutomationHold?.active === true &&
    Number.isFinite(holdExpiresAtMs) &&
    Date.now() < holdExpiresAtMs;

  const administrativelyRestricted =
    user.accountStatus !== 'active' || user.accountLocked === true ||
    user.loginAllowed === false || user.suspended === true ||
    user.ageReverificationRestrictedAt != null || user.deletionRequestedAt != null ||
    user.deletedAt != null || automationHoldActive ||
    (user.profileCompleted !== true && user.moderationAutomationHold?.active === true);
  const independentlyBlocked = user.interactionBlocked === true && !isRegistrationInteractionBlock(user);

  if (administrativelyRestricted || independentlyBlocked) {
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

  if (user.profileCompleted !== true) {
    throw new HttpsError('failed-precondition', 'Conclua o cadastro para realizar esta ação.', {
      reason: 'registration_pending',
    });
  }

  if (!hasAcceptedCurrentTerms(user.acceptedTerms)) {
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
